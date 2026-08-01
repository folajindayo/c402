import {
  C402Error,
  createCreditOffer,
  createCreditRequest,
  createErc8004CreditFeedback,
  createErc8004CreditValidationRequest,
  createLiquidationReceipt,
  createRepaymentReceipt,
  formatAtomic,
  generateSigningKeyPair,
  parseAtomic,
  randomHex,
  scoreLenderForRequest,
  underwriteReceivable,
  verifyCreditOffer,
  type AgentCreditPassportEvent,
  type CreditAdvance,
  type CreditOffer,
  type CreditRequest,
  type CollateralPosition,
  type Erc8004AgentRef,
  type Erc8004FeedbackSignal,
  type Erc8004ValidationRequest,
  type FundedJob,
  type LenderMatch,
  type LenderProfile,
  type LiquidationReceipt,
  type Purpose,
  type ReceivableLien,
  type RepaymentReceipt,
  type SpendingPolicy,
  type UnderwritingDecision
} from "@c402/protocol";

export interface CreditFlowState {
  jobs: FundedJob[];
  requests: CreditRequest[];
  offers: CreditOffer[];
  lenders: LenderProfile[];
  matches: LenderMatch[];
  advances: CreditAdvance[];
  liens: ReceivableLien[];
  collateral: CollateralPosition[];
  repayments: RepaymentReceipt[];
  liquidations: LiquidationReceipt[];
  passport: AgentCreditPassportEvent[];
  erc8004Feedback: Erc8004FeedbackSignal[];
  erc8004ValidationRequests: Erc8004ValidationRequest[];
  insuranceReserveAtomic: string;
  directLenderReceivables: Array<{ lender: string; amountAtomic: string }>;
  lenderShortfalls: Array<{ lender: string; amountAtomic: string }>;
}

export interface AgentCreditServiceOptions {
  endpoint?: string;
  network?: string;
  asset?: string;
}

export class AgentCreditService {
  private readonly signer = generateSigningKeyPair();
  private readonly jobs = new Map<string, FundedJob>();
  private readonly requests = new Map<string, CreditRequest>();
  private readonly offers = new Map<string, CreditOffer>();
  private readonly lenders = new Map<string, LenderProfile>();
  private readonly matches = new Map<string, LenderMatch>();
  private readonly advances = new Map<string, CreditAdvance>();
  private readonly liens = new Map<string, ReceivableLien>();
  private readonly collateral = new Map<string, CollateralPosition>();
  private readonly repayments = new Map<string, RepaymentReceipt>();
  private readonly liquidations = new Map<string, LiquidationReceipt>();
  private readonly passport: AgentCreditPassportEvent[] = [];
  private readonly erc8004Feedback: Erc8004FeedbackSignal[] = [];
  private readonly erc8004ValidationRequests: Erc8004ValidationRequest[] = [];
  private readonly directLenderReceivables = new Map<string, bigint>();
  private readonly lenderShortfalls = new Map<string, bigint>();
  private insuranceReserve = 0n;
  private readonly minCollateralBps = 2000;

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

  depositCollateral(input: { jobId: string; pledgor: string; amountAtomic: string }): CollateralPosition {
    const job = this.getJob(input.jobId);
    if (job.status !== "funded" && job.status !== "accepted") {
      throw new C402Error("job_not_fundable", "collateral can only be posted against a funded job", 409);
    }
    const amount = parseAtomic(input.amountAtomic, "amountAtomic");
    const existing = this.collateral.get(input.jobId);
    const nextAmount = amount + BigInt(existing?.amountAtomic ?? "0");
    const nextLocked = BigInt(existing?.lockedAtomic ?? "0");
    const position: CollateralPosition = {
      jobId: input.jobId,
      pledgor: existing?.pledgor ?? input.pledgor,
      amountAtomic: nextAmount.toString(),
      lockedAtomic: nextLocked.toString(),
      status: "locked",
      updatedAt: new Date().toISOString()
    };
    this.collateral.set(input.jobId, position);
    return position;
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

  registerLender(input: {
    lenderId?: string;
    agent: string;
    availableLiquidityAtomic: string;
    asset?: string;
    networks?: string[];
    minFeeBps?: number;
    maxDurationSeconds?: number;
    allowedPurposes?: Purpose[];
    allowedSupplierDomains?: string[];
    acceptedRiskBands?: Array<UnderwritingDecision["riskBand"]>;
    reputationScore?: number;
    status?: LenderProfile["status"];
  }): LenderProfile {
    const lenderId = input.lenderId || `lender-${randomHex(8)}`;
    const lender: LenderProfile = {
      lenderId,
      agent: input.agent,
      availableLiquidityAtomic: input.availableLiquidityAtomic,
      asset: input.asset ?? this.options.asset ?? "USDC",
      networks: input.networks?.length ? input.networks : [this.options.network ?? "eip155:84532"],
      minFeeBps: input.minFeeBps ?? 300,
      maxDurationSeconds: input.maxDurationSeconds ?? 86_400,
      allowedPurposes: input.allowedPurposes?.length ? input.allowedPurposes : this.policy.allowedUses,
      allowedSupplierDomains: input.allowedSupplierDomains?.length ? input.allowedSupplierDomains : this.policy.allowedDomains,
      acceptedRiskBands: input.acceptedRiskBands?.length ? input.acceptedRiskBands : ["A", "B"],
      reputationScore: input.reputationScore ?? 50,
      status: input.status ?? "active",
      updatedAt: new Date().toISOString()
    };
    parseAtomic(lender.availableLiquidityAtomic, "availableLiquidityAtomic");
    if (lender.minFeeBps < 0 || lender.minFeeBps > 10_000) {
      throw new C402Error("invalid_lender_fee", "minFeeBps must be between 0 and 10000", 400);
    }
    if (lender.maxDurationSeconds <= 0) {
      throw new C402Error("invalid_lender_duration", "maxDurationSeconds must be positive", 400);
    }
    if (lender.reputationScore < 0) {
      throw new C402Error("invalid_lender_reputation", "reputationScore must be non-negative", 400);
    }
    this.lenders.set(lenderId, lender);
    return lender;
  }

  matchCredit(offerId: string): { offer: CreditOffer; request: CreditRequest; decision: UnderwritingDecision; match?: LenderMatch; eligibleLenders: number } {
    const offer = this.getOffer(offerId);
    verifyCreditOffer(offer, this.signer.publicKey);
    const request = this.getRequest(offer.requestId);
    const job = this.getJob(request.repaymentSource);
    const decision = underwriteReceivable(job, request, this.policy);
    if (!decision.approved) {
      return { offer, request, decision, eligibleLenders: 0 };
    }

    const candidates = Array.from(this.lenders.values())
      .map((lender) => ({
        lender,
        score: scoreLenderForRequest({
          lender,
          request,
          decision,
          offer,
          network: this.options.network ?? "eip155:84532",
          asset: this.options.asset ?? "USDC"
        })
      }))
      .filter((item): item is { lender: LenderProfile; score: number } => typeof item.score === "number")
      .sort((a, b) => b.score - a.score || a.lender.minFeeBps - b.lender.minFeeBps);

    const selected = candidates[0];
    if (!selected) {
      return { offer, request, decision, eligibleLenders: 0 };
    }

    const existing = Array.from(this.matches.values()).find((item) => item.offerId === offer.offerId);
    if (existing) {
      return { offer, request, decision, match: existing, eligibleLenders: candidates.length };
    }

    const match: LenderMatch = {
      matchId: `match-${randomHex(8)}`,
      offerId: offer.offerId,
      requestId: request.requestId,
      lenderId: selected.lender.lenderId,
      lenderAgent: selected.lender.agent,
      score: selected.score,
      amountAtomic: offer.approvedAmountAtomic,
      feeAtomic: offer.feeAtomic,
      supplier: request.supplier,
      supplierDomain: request.supplierDomain,
      expiresAt: offer.expiresAt,
      createdAt: new Date().toISOString()
    };
    this.matches.set(match.matchId, match);
    return { offer, request, decision, match, eligibleLenders: candidates.length };
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
    const match = Array.from(this.matches.values()).find((item) => item.offerId === offer.offerId);
    if (match && match.lenderAgent !== input.lender) {
      throw new C402Error("lender_mismatch", "supplier payment lender does not match the selected lender agent", 409);
    }
    const advance: CreditAdvance = {
      advanceId: `adv-${offer.requestId}`,
      offerId: offer.offerId,
      requestId: offer.requestId,
      lender: input.lender,
      fundingSource: "direct-lender",
      supplier: request.supplier,
      amountAtomic: offer.approvedAmountAtomic,
      feeAtomic: offer.feeAtomic,
      collateralLockedAtomic: this.lockCollateral(request.repaymentSource, offer.approvedAmountAtomic),
      deadline: offer.expiresAt,
      status: "advanced",
      paidAt: new Date().toISOString(),
      supplierPaymentId: input.supplierPaymentId
    };
    this.advances.set(advance.advanceId, advance);
    const lien: ReceivableLien = {
      lienId: `lien-${offer.requestId}`,
      jobId: request.repaymentSource,
      advanceId: advance.advanceId,
      lender: input.lender,
      borrower: offer.agent,
      principalAtomic: offer.approvedAmountAtomic,
      feeAtomic: offer.feeAtomic,
      collateralLockedAtomic: advance.collateralLockedAtomic,
      seniorClaimAtomic: (BigInt(offer.approvedAmountAtomic) + BigInt(offer.feeAtomic)).toString(),
      status: "active",
      createdAt: new Date().toISOString()
    };
    this.liens.set(lien.lienId, lien);
    if (match) {
      const lender = this.lenders.get(match.lenderId);
      if (lender) {
        lender.availableLiquidityAtomic = (BigInt(lender.availableLiquidityAtomic) - BigInt(offer.approvedAmountAtomic)).toString();
        lender.updatedAt = new Date().toISOString();
      }
    }
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
      const match = Array.from(this.matches.values()).find((item) => item.offerId === advance.offerId);
      if (match) {
        const lender = this.lenders.get(match.lenderId);
        if (lender) {
          lender.availableLiquidityAtomic = (BigInt(lender.availableLiquidityAtomic) + lenderRepayment).toString();
          lender.reputationScore += 3;
          lender.updatedAt = new Date().toISOString();
        }
      }
    } else {
      throw new C402Error("unsupported_funding_source", "repayment requires a direct lender advance", 409);
    }
    this.insuranceReserve += BigInt(receipt.reserveAtomic);
    this.releaseLienAndCollateral(job.jobId, advance.advanceId);
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

  liquidateAdvance(advanceId: string, reason = "deadline_or_default"): LiquidationReceipt {
    const advance = this.getAdvance(advanceId);
    if (advance.status !== "advanced" && advance.status !== "defaulted") {
      throw new C402Error("advance_not_liquidatable", "only active or defaulted advances can be liquidated", 409);
    }
    if (advance.status === "advanced" && Date.parse(advance.deadline) > Date.now()) {
      throw new C402Error("advance_not_matured", "advance deadline has not passed", 409);
    }
    if (!advance.lender) {
      throw new C402Error("missing_lender", "advance has no lender", 409);
    }
    const lien = this.getLienForAdvance(advance.advanceId);
    const collateral = this.collateral.get(lien.jobId);
    const seniorClaim = BigInt(lien.seniorClaimAtomic);
    const lockedCollateral = BigInt(collateral?.lockedAtomic ?? "0");
    const collateralPaid = lockedCollateral > seniorClaim ? seniorClaim : lockedCollateral;
    const remainingAfterCollateral = seniorClaim - collateralPaid;
    const reservePaid = this.insuranceReserve > remainingAfterCollateral ? remainingAfterCollateral : this.insuranceReserve;
    const shortfall = remainingAfterCollateral - reservePaid;

    if (collateral) {
      collateral.lockedAtomic = "0";
      collateral.amountAtomic = (BigInt(collateral.amountAtomic) - collateralPaid).toString();
      collateral.status = collateralPaid > 0n ? "liquidated" : collateral.status;
      collateral.updatedAt = new Date().toISOString();
    }
    this.insuranceReserve -= reservePaid;
    this.directLenderReceivables.set(advance.lender, (this.directLenderReceivables.get(advance.lender) ?? 0n) + collateralPaid + reservePaid);
    if (shortfall > 0n) {
      this.lenderShortfalls.set(advance.lender, (this.lenderShortfalls.get(advance.lender) ?? 0n) + shortfall);
    }
    advance.status = "defaulted";
    lien.status = "liquidated";
    const job = this.getJob(lien.jobId);
    job.status = "failed";

    const receipt = createLiquidationReceipt({
      jobId: lien.jobId,
      advanceId: advance.advanceId,
      lender: advance.lender,
      collateralPaidAtomic: collateralPaid.toString(),
      reservePaidAtomic: reservePaid.toString(),
      shortfallAtomic: shortfall.toString(),
      signerPrivateKeyPem: this.signer.privateKey
    });
    this.liquidations.set(receipt.liquidationId, receipt);

    const event: AgentCreditPassportEvent = {
      agent: job.agent,
      jobId: job.jobId,
      event: "credit_suspended",
      scoreDelta: -25,
      creditLimitAtomic: "0",
      createdAt: new Date().toISOString()
    };
    this.passport.push(event);
    this.recordErc8004Feedback(job, event, advance);
    void reason;
    return receipt;
  }

  failJob(jobId: string, advanceId?: string): AgentCreditPassportEvent {
    const job = this.getJob(jobId);
    job.status = "failed";
    if (advanceId) {
      const advance = this.getAdvance(advanceId);
      if (advance.status === "advanced") {
        advance.status = "defaulted";
        const lien = this.getLienForAdvance(advance.advanceId);
        lien.status = "defaulted";
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
      lenders: Array.from(this.lenders.values()),
      matches: Array.from(this.matches.values()),
      advances: Array.from(this.advances.values()),
      liens: Array.from(this.liens.values()),
      collateral: Array.from(this.collateral.values()),
      repayments: Array.from(this.repayments.values()),
      liquidations: Array.from(this.liquidations.values()),
      passport: this.passport,
      erc8004Feedback: this.erc8004Feedback,
      erc8004ValidationRequests: this.erc8004ValidationRequests,
      insuranceReserveAtomic: this.insuranceReserve.toString(),
      directLenderReceivables: Array.from(this.directLenderReceivables.entries()).map(([lender, amount]) => ({
        lender,
        amountAtomic: amount.toString()
      })),
      lenderShortfalls: Array.from(this.lenderShortfalls.entries()).map(([lender, amount]) => ({
        lender,
        amountAtomic: amount.toString()
      })),
      formatted: {
        insuranceReserve: `${formatAtomic(this.insuranceReserve)} USDC`,
        directLenderReceivables: Array.from(this.directLenderReceivables.entries()).map(([lender, amount]) => `${lender}: ${formatAtomic(amount)} USDC`),
        lenderShortfalls: Array.from(this.lenderShortfalls.entries()).map(([lender, amount]) => `${lender}: ${formatAtomic(amount)} USDC`)
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

  private getLienForAdvance(advanceId: string): ReceivableLien {
    const lien = Array.from(this.liens.values()).find((item) => item.advanceId === advanceId);
    if (!lien) throw new C402Error("lien_not_found", `lien for advance ${advanceId} not found`, 404);
    return lien;
  }

  private lockCollateral(jobId: string, principalAtomic: string): string {
    const position = this.collateral.get(jobId);
    const required = (BigInt(principalAtomic) * BigInt(this.minCollateralBps)) / 10_000n;
    const available = BigInt(position?.amountAtomic ?? "0") - BigInt(position?.lockedAtomic ?? "0");
    if (available < required) {
      throw new C402Error("collateral_insufficient", `job requires at least ${required.toString()} collateral atomic units for this advance`, 409);
    }
    if (position) {
      position.lockedAtomic = (BigInt(position.lockedAtomic) + required).toString();
      position.updatedAt = new Date().toISOString();
    }
    return required.toString();
  }

  private releaseLienAndCollateral(jobId: string, advanceId: string): void {
    const lien = this.getLienForAdvance(advanceId);
    lien.status = "released";
    const position = this.collateral.get(jobId);
    if (position) {
      const locked = BigInt(position.lockedAtomic);
      const release = BigInt(lien.collateralLockedAtomic);
      position.lockedAtomic = (locked > release ? locked - release : 0n).toString();
      position.status = "released";
      position.updatedAt = new Date().toISOString();
    }
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
