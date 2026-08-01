import {
  C402Error,
  createCreditOffer,
  createCreditRequest,
  createErc8004CreditFeedback,
  createErc8004CreditValidationRequest,
  createRepaymentReceipt,
  formatAtomic,
  generateSigningKeyPair,
  underwriteReceivable,
  verifyCreditOffer,
  type AgentCreditPassportEvent,
  type CreditAdvance,
  type CreditOffer,
  type CreditRequest,
  type Erc8004AgentRef,
  type Erc8004FeedbackSignal,
  type Erc8004ValidationRequest,
  type FundedJob,
  type Purpose,
  type RepaymentReceipt,
  type SpendingPolicy,
  type UnderwritingDecision
} from "@c402/protocol";

export interface CreditFlowState {
  jobs: FundedJob[];
  requests: CreditRequest[];
  offers: CreditOffer[];
  advances: CreditAdvance[];
  repayments: RepaymentReceipt[];
  passport: AgentCreditPassportEvent[];
  erc8004Feedback: Erc8004FeedbackSignal[];
  erc8004ValidationRequests: Erc8004ValidationRequest[];
  insuranceReserveAtomic: string;
  directLenderReceivables: Array<{ lender: string; amountAtomic: string }>;
}

export interface AgentCreditServiceOptions {
  endpoint?: string;
}

export class AgentCreditService {
  private readonly signer = generateSigningKeyPair();
  private readonly jobs = new Map<string, FundedJob>();
  private readonly requests = new Map<string, CreditRequest>();
  private readonly offers = new Map<string, CreditOffer>();
  private readonly advances = new Map<string, CreditAdvance>();
  private readonly repayments = new Map<string, RepaymentReceipt>();
  private readonly passport: AgentCreditPassportEvent[] = [];
  private readonly erc8004Feedback: Erc8004FeedbackSignal[] = [];
  private readonly erc8004ValidationRequests: Erc8004ValidationRequest[] = [];
  private readonly directLenderReceivables = new Map<string, bigint>();
  private insuranceReserve = 0n;

  constructor(private readonly options: AgentCreditServiceOptions = {}) {}

  readonly policy: SpendingPolicy = {
    allowedUses: ["compute", "data", "storage", "approved-x402-service"],
    allowedDomains: ["data.example.com", "api.openai.com", "storage.example.com"],
    maxAdvanceAtomic: "15000000",
    minGrossMarginBps: 3000
  };

  createFundedJob(input: {
    buyer: string;
    agent: string;
    agentRef?: Erc8004AgentRef;
    escrowAmountAtomic: string;
    asset?: string;
    description: string;
  }): FundedJob {
    const job: FundedJob = {
      jobId: `job-${Math.floor(Date.now() / 1000)}-${this.jobs.size + 1}`,
      buyer: input.buyer,
      agent: input.agent,
      agentRef: input.agentRef,
      escrowAmountAtomic: input.escrowAmountAtomic,
      asset: input.asset ?? "USDC",
      description: input.description,
      status: "funded",
      createdAt: new Date().toISOString()
    };
    this.jobs.set(job.jobId, job);
    return job;
  }

  requestCredit(input: {
    agent: string;
    amountAtomic: string;
    purpose: Purpose;
    supplier: string;
    supplierDomain: string;
    repaymentSource: string;
    maximumFeeAtomic: string;
    durationSeconds?: number;
  }): { request: CreditRequest; decision: UnderwritingDecision; offer?: CreditOffer } {
    const request = createCreditRequest({
      ...input,
      durationSeconds: input.durationSeconds ?? 3600
    });
    this.requests.set(request.requestId, request);

    const job = this.getJob(request.repaymentSource);
    const decision = underwriteReceivable(job, request, this.policy);
    if (!decision.approved) {
      return { request, decision };
    }

    const offer = createCreditOffer(request, this.policy, this.signer.privateKey);
    this.offers.set(offer.offerId, offer);
    return { request, decision, offer };
  }

  recordDirectSupplierPayment(input: { offerId: string; lender: string; supplierPaymentId: string }): CreditAdvance {
    if (!input.lender) {
      throw new C402Error("missing_lender", "lender is required", 400);
    }
    if (!input.supplierPaymentId) {
      throw new C402Error("missing_supplier_payment", "supplierPaymentId is required", 400);
    }
    const offer = this.getOffer(input.offerId);
    verifyCreditOffer(offer, this.signer.publicKey);
    const request = this.getRequest(offer.requestId);
    const advance: CreditAdvance = {
      advanceId: `adv-${offer.requestId}`,
      offerId: offer.offerId,
      requestId: offer.requestId,
      lender: input.lender,
      fundingSource: "direct-lender",
      supplier: request.supplier,
      amountAtomic: offer.approvedAmountAtomic,
      status: "advanced",
      paidAt: new Date().toISOString(),
      supplierPaymentId: input.supplierPaymentId
    };
    this.advances.set(advance.advanceId, advance);
    return advance;
  }

  completeJob(jobId: string, advanceId: string): RepaymentReceipt {
    const job = this.getJob(jobId);
    const advance = this.getAdvance(advanceId);
    const offer = this.getOffer(advance.offerId);
    job.status = "completed";

    const receipt = createRepaymentReceipt({
      job,
      advance,
      offer,
      reserveBps: 2000,
      signerPrivateKeyPem: this.signer.privateKey
    });
    this.repayments.set(receipt.repaymentId, receipt);

    const lenderRepayment = BigInt(receipt.principalAtomic) + BigInt(receipt.feeAtomic) - BigInt(receipt.reserveAtomic);
    if (advance.fundingSource === "direct-lender" && advance.lender) {
      this.directLenderReceivables.set(advance.lender, (this.directLenderReceivables.get(advance.lender) ?? 0n) + lenderRepayment);
    } else {
      throw new C402Error("unsupported_funding_source", "repayment requires a direct lender advance", 409);
    }
    this.insuranceReserve += BigInt(receipt.reserveAtomic);
    advance.status = "repaid";
    job.status = "settled";
    const event: AgentCreditPassportEvent = {
      agent: job.agent,
      jobId: job.jobId,
      event: "advance_repaid",
      scoreDelta: 8,
      creditLimitAtomic: "20000000",
      createdAt: new Date().toISOString()
    };
    this.passport.push(event);
    this.recordErc8004Feedback(job, event, advance, receipt);
    this.erc8004ValidationRequests.push(createErc8004CreditValidationRequest({
      agentRef: agentRefFor(job),
      validatorAddress: "0x0000000000000000000000000000000000008004",
      requestURI: `c402://credit/jobs/${job.jobId}/repayment/${receipt.repaymentId}`,
      job,
      kind: "repayment-receipt",
      evidence: receipt
    }));
    return receipt;
  }

  failJob(jobId: string, advanceId?: string): AgentCreditPassportEvent {
    const job = this.getJob(jobId);
    job.status = "failed";
    if (advanceId) {
      const advance = this.getAdvance(advanceId);
      if (advance.status === "advanced") {
        advance.status = "defaulted";
      }
    }
    const event: AgentCreditPassportEvent = {
      agent: job.agent,
      jobId,
      event: "credit_suspended",
      scoreDelta: -25,
      creditLimitAtomic: "0",
      createdAt: new Date().toISOString()
    };
    this.passport.push(event);
    this.recordErc8004Feedback(job, event);
    return event;
  }

  state(): CreditFlowState & { formatted: Record<string, string | string[]> } {
    return {
      jobs: Array.from(this.jobs.values()),
      requests: Array.from(this.requests.values()),
      offers: Array.from(this.offers.values()),
      advances: Array.from(this.advances.values()),
      repayments: Array.from(this.repayments.values()),
      passport: this.passport,
      erc8004Feedback: this.erc8004Feedback,
      erc8004ValidationRequests: this.erc8004ValidationRequests,
      insuranceReserveAtomic: this.insuranceReserve.toString(),
      directLenderReceivables: Array.from(this.directLenderReceivables.entries()).map(([lender, amount]) => ({
        lender,
        amountAtomic: amount.toString()
      })),
      formatted: {
        insuranceReserve: `${formatAtomic(this.insuranceReserve)} USDC`,
        directLenderReceivables: Array.from(this.directLenderReceivables.entries()).map(([lender, amount]) => `${lender}: ${formatAtomic(amount)} USDC`)
      }
    };
  }

  private getJob(jobId: string): FundedJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new C402Error("job_not_found", `job ${jobId} not found`, 404);
    return job;
  }

  private getRequest(requestId: string): CreditRequest {
    const request = this.requests.get(requestId);
    if (!request) throw new C402Error("credit_request_not_found", `request ${requestId} not found`, 404);
    return request;
  }

  private getOffer(offerId: string): CreditOffer {
    const offer = this.offers.get(offerId);
    if (!offer) throw new C402Error("credit_offer_not_found", `offer ${offerId} not found`, 404);
    return offer;
  }

  private getAdvance(advanceId: string): CreditAdvance {
    const advance = this.advances.get(advanceId);
    if (!advance) throw new C402Error("credit_advance_not_found", `advance ${advanceId} not found`, 404);
    return advance;
  }

  private recordErc8004Feedback(
    job: FundedJob,
    passportEvent: AgentCreditPassportEvent,
    advance?: CreditAdvance,
    repayment?: RepaymentReceipt
  ): void {
    this.erc8004Feedback.push(createErc8004CreditFeedback({
      agentRef: agentRefFor(job),
      passportEvent,
      endpoint: this.options.endpoint ?? "c402://credit",
      feedbackURI: `c402://credit/jobs/${job.jobId}/feedback/${passportEvent.event}`,
      advance,
      repayment
    }));
  }
}

function agentRefFor(job: FundedJob): Erc8004AgentRef {
  return job.agentRef ?? {
    agentRegistry: "eip155:114:0x0000000000000000000000000000000000008004",
    agentId: job.agent.replace(/^0x/i, "") || job.jobId
  };
}
