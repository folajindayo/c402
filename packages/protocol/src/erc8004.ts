import { commitment } from "./canonical.js";
import type { AgentCreditPassportEvent, CreditAdvance, FundedJob, RepaymentReceipt } from "./credit.js";
import type { ComputeReceipt } from "./types.js";

export interface Erc8004AgentRef {
  agentRegistry: string;
  agentId: string;
}

export interface Erc8004FeedbackSignal {
  agentId: string;
  value: string;
  valueDecimals: number;
  tag1: "c402-credit";
  tag2: "advance-repaid" | "credit-suspended" | "job-failed";
  endpoint: string;
  feedbackURI: string;
  feedbackHash: string;
  payload: Erc8004CreditFeedbackPayload;
}

export interface Erc8004CreditFeedbackPayload {
  protocol: "c402";
  version: 1;
  agent: string;
  agentRegistry: string;
  agentId: string;
  jobId: string;
  event: AgentCreditPassportEvent["event"];
  scoreDelta: number;
  creditLimitAtomic: string;
  evidence: {
    advanceId?: string;
    repaymentId?: string;
    principalAtomic?: string;
    feeAtomic?: string;
    reserveAtomic?: string;
    supplierPaymentId?: string;
  };
  createdAt: string;
}

export interface Erc8004ValidationRequest {
  validatorAddress: string;
  agentId: string;
  requestURI: string;
  requestHash: string;
  payload: Erc8004CreditValidationPayload;
}

export interface Erc8004CreditValidationPayload {
  protocol: "c402";
  version: 1;
  kind: "credit-underwriting" | "repayment-receipt" | "compute-receipt";
  agent: string;
  agentRegistry: string;
  agentId: string;
  jobId: string;
  evidenceHash: string;
  computeReceipt?: ComputeReceipt;
  createdAt: string;
}

export function createErc8004CreditFeedback(input: {
  agentRef: Erc8004AgentRef;
  passportEvent: AgentCreditPassportEvent;
  endpoint: string;
  feedbackURI?: string;
  advance?: CreditAdvance;
  repayment?: RepaymentReceipt;
}): Erc8004FeedbackSignal {
  const payload: Erc8004CreditFeedbackPayload = {
    protocol: "c402",
    version: 1,
    agent: input.passportEvent.agent,
    agentRegistry: input.agentRef.agentRegistry,
    agentId: input.agentRef.agentId,
    jobId: input.passportEvent.jobId,
    event: input.passportEvent.event,
    scoreDelta: input.passportEvent.scoreDelta,
    creditLimitAtomic: input.passportEvent.creditLimitAtomic,
    evidence: {
      advanceId: input.advance?.advanceId,
      repaymentId: input.repayment?.repaymentId,
      principalAtomic: input.repayment?.principalAtomic,
      feeAtomic: input.repayment?.feeAtomic,
      reserveAtomic: input.repayment?.reserveAtomic,
      supplierPaymentId: input.advance?.supplierPaymentId
    },
    createdAt: input.passportEvent.createdAt
  };
  return {
    agentId: input.agentRef.agentId,
    value: input.passportEvent.scoreDelta.toString(),
    valueDecimals: 0,
    tag1: "c402-credit",
    tag2: toFeedbackTag(input.passportEvent.event),
    endpoint: input.endpoint,
    feedbackURI: input.feedbackURI ?? "",
    feedbackHash: commitment(payload),
    payload
  };
}

export function createErc8004CreditValidationRequest(input: {
  agentRef: Erc8004AgentRef;
  validatorAddress: string;
  requestURI: string;
  job: FundedJob;
  kind: Erc8004CreditValidationPayload["kind"];
  evidence: unknown;
  computeReceipt?: ComputeReceipt;
}): Erc8004ValidationRequest {
  const payload: Erc8004CreditValidationPayload = {
    protocol: "c402",
    version: 1,
    kind: input.kind,
    agent: input.job.agent,
    agentRegistry: input.agentRef.agentRegistry,
    agentId: input.agentRef.agentId,
    jobId: input.job.jobId,
    evidenceHash: commitment(input.evidence),
    computeReceipt: input.computeReceipt,
    createdAt: new Date().toISOString()
  };
  return {
    validatorAddress: input.validatorAddress,
    agentId: input.agentRef.agentId,
    requestURI: input.requestURI,
    requestHash: commitment(payload),
    payload
  };
}

function toFeedbackTag(event: AgentCreditPassportEvent["event"]): Erc8004FeedbackSignal["tag2"] {
  if (event === "advance_repaid") return "advance-repaid";
  if (event === "job_failed") return "job-failed";
  return "credit-suspended";
}
