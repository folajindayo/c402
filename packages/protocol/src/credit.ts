import { C402Error, assertC402 } from "./errors.js";
import { commitment } from "./canonical.js";
import { randomHex, signObject, verifyObjectSignature, objectWithoutSignature } from "./crypto.js";

export type JobStatus = "funded" | "accepted" | "completed" | "failed" | "settled";
export type CreditStatus = "offered" | "advanced" | "repaid" | "defaulted" | "cancelled";
export type Purpose = "compute" | "data" | "storage" | "gas" | "approved-x402-service";

export interface SpendingPolicy {
  allowedUses: Purpose[];
  allowedDomains: string[];
  maxAdvanceAtomic: string;
  minGrossMarginBps: number;
}

export interface FundedJob {
  jobId: string;
  buyer: string;
  agent: string;
  agentRef?: {
    agentRegistry: string;
    agentId: string;
  };
  escrowAmountAtomic: string;
  asset: string;
  description: string;
  status: JobStatus;
  createdAt: string;
}

export interface CreditRequest {
  requestId: string;
  agent: string;
  amountAtomic: string;
  purpose: Purpose;
  supplier: string;
  supplierDomain: string;
  repaymentSource: string;
  maximumFeeAtomic: string;
  durationSeconds: number;
  createdAt: string;
}

export interface CreditOffer {
  offerId: string;
  requestId: string;
  agent: string;
  approvedAmountAtomic: string;
  feeAtomic: string;
  repaymentSource: string;
  expiresAt: string;
  policyCommitment: string;
  signature: string;
}

export interface CreditAdvance {
  advanceId: string;
  offerId: string;
  requestId: string;
  lender?: string;
  fundingSource?: "pooled-vault" | "direct-lender";
  supplier: string;
  amountAtomic: string;
  status: CreditStatus;
  paidAt: string;
  supplierPaymentId: string;
}

export interface RepaymentReceipt {
  repaymentId: string;
  jobId: string;
  advanceId: string;
  escrowAmountAtomic: string;
  principalAtomic: string;
  feeAtomic: string;
  agentProceedsAtomic: string;
  reserveAtomic: string;
  status: "repaid" | "defaulted";
  createdAt: string;
  signature: string;
}

export interface AgentCreditPassportEvent {
  agent: string;
  jobId: string;
  event: "advance_repaid" | "job_failed" | "credit_suspended";
  scoreDelta: number;
  creditLimitAtomic: string;
  createdAt: string;
}

export interface UnderwritingDecision {
  approved: boolean;
  maximumCreditAtomic: string;
  riskBand: "A" | "B" | "C" | "D";
  maximumDurationSeconds: number;
  requiredRevenueSweepBps: number;
  validUntil: number;
  reason?: string;
}

export function createCreditRequest(input: Omit<CreditRequest, "requestId" | "createdAt">): CreditRequest {
  return {
    ...input,
    requestId: randomHex(16),
    createdAt: new Date().toISOString()
  };
}

export function underwriteReceivable(job: FundedJob, request: CreditRequest, policy: SpendingPolicy): UnderwritingDecision {
  if (job.status !== "funded" && job.status !== "accepted") {
    return decline("repayment source is not funded");
  }
  if (job.jobId !== request.repaymentSource || job.agent !== request.agent) {
    return decline("repayment source does not belong to agent");
  }
  if (!policy.allowedUses.includes(request.purpose)) {
    return decline("purpose is not allowed");
  }
  if (!policy.allowedDomains.includes(request.supplierDomain)) {
    return decline("supplier domain is not allowed");
  }

  const amount = parseAtomic(request.amountAtomic, "amountAtomic");
  const maxAdvance = parseAtomic(policy.maxAdvanceAtomic, "maxAdvanceAtomic");
  const receivable = parseAtomic(job.escrowAmountAtomic, "escrowAmountAtomic");
  const fee = feeFor(amount);
  const requiredRevenue = amount + fee;
  const marginBps = Number(((receivable - requiredRevenue) * 10_000n) / receivable);

  if (amount > maxAdvance) return decline("request exceeds policy max advance");
  if (requiredRevenue >= receivable) return decline("advance plus fee exceeds receivable");
  if (marginBps < policy.minGrossMarginBps) return decline("gross margin is too low");

  return {
    approved: true,
    maximumCreditAtomic: policy.maxAdvanceAtomic,
    riskBand: marginBps >= 8000 ? "A" : marginBps >= 6500 ? "B" : marginBps >= 4500 ? "C" : "D",
    maximumDurationSeconds: request.durationSeconds,
    requiredRevenueSweepBps: 10_000,
    validUntil: Math.floor(Date.now() / 1000) + request.durationSeconds
  };
}

export function createCreditOffer(
  request: CreditRequest,
  policy: SpendingPolicy,
  signerPrivateKeyPem: string
): CreditOffer {
  const amount = parseAtomic(request.amountAtomic, "amountAtomic");
  const fee = feeFor(amount);
  const unsigned = {
    offerId: randomHex(16),
    requestId: request.requestId,
    agent: request.agent,
    approvedAmountAtomic: request.amountAtomic,
    feeAtomic: fee.toString(),
    repaymentSource: request.repaymentSource,
    expiresAt: new Date(Date.now() + request.durationSeconds * 1000).toISOString(),
    policyCommitment: commitment(policy)
  };
  return { ...unsigned, signature: signObject(signerPrivateKeyPem, unsigned) };
}

export function verifyCreditOffer(offer: CreditOffer, signerPublicKeyPem: string): void {
  assertC402(verifyObjectSignature(signerPublicKeyPem, objectWithoutSignature(offer), offer.signature), "invalid_credit_offer", "credit offer signature failed verification", 402);
  assertC402(Date.parse(offer.expiresAt) > Date.now(), "expired_credit_offer", "credit offer has expired", 402);
}

export function createRepaymentReceipt(input: {
  job: FundedJob;
  advance: CreditAdvance;
  offer: CreditOffer;
  reserveBps: number;
  signerPrivateKeyPem: string;
}): RepaymentReceipt {
  const escrow = parseAtomic(input.job.escrowAmountAtomic, "escrowAmountAtomic");
  const principal = parseAtomic(input.offer.approvedAmountAtomic, "approvedAmountAtomic");
  const fee = parseAtomic(input.offer.feeAtomic, "feeAtomic");
  const reserve = (fee * BigInt(input.reserveBps)) / 10_000n;
  const agentProceeds = escrow - principal - fee;
  if (agentProceeds < 0n) {
    throw new C402Error("insufficient_receivable", "escrow cannot cover principal and fee", 409);
  }
  const unsigned = {
    repaymentId: randomHex(16),
    jobId: input.job.jobId,
    advanceId: input.advance.advanceId,
    escrowAmountAtomic: escrow.toString(),
    principalAtomic: principal.toString(),
    feeAtomic: fee.toString(),
    agentProceedsAtomic: agentProceeds.toString(),
    reserveAtomic: reserve.toString(),
    status: "repaid" as const,
    createdAt: new Date().toISOString()
  };
  return { ...unsigned, signature: signObject(input.signerPrivateKeyPem, unsigned) };
}

export function parseAtomic(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new C402Error("invalid_atomic_amount", `${field} must be an unsigned integer string`);
  }
  return BigInt(value);
}

export function formatAtomic(value: string | bigint, decimals = 6): string {
  const amount = typeof value === "bigint" ? value : parseAtomic(value, "amount");
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function feeFor(amount: bigint): bigint {
  return (amount * 500n) / 10_000n;
}

function decline(reason: string): UnderwritingDecision {
  return {
    approved: false,
    maximumCreditAtomic: "0",
    riskBand: "D",
    maximumDurationSeconds: 0,
    requiredRevenueSweepBps: 0,
    validUntil: 0,
    reason
  };
}
