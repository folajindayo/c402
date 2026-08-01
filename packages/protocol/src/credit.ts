import { C402Error, assertC402 } from "./errors.js";
import { commitment } from "./canonical.js";
import { randomHex, signObject, verifyObjectSignature, objectWithoutSignature } from "./crypto.js";

export type JobStatus = "funded" | "accepted" | "completed" | "failed" | "settled";
export type CreditStatus = "offered" | "advanced" | "repaid" | "defaulted" | "cancelled";
export type Purpose = "compute" | "data" | "storage" | "gas" | "approved-x402-service";
export type CreditProductType = "job-backed" | "asset-backed" | "subscription-backed" | "earnings-backed";

export interface SpendingPolicy {
  allowedUses: Purpose[];
  allowedDomains: string[];
  maxAdvanceAtomic: string;
  minGrossMarginBps: number;
}

export interface LenderProfile {
  lenderId: string;
  agent: string;
  availableLiquidityAtomic: string;
  asset: string;
  networks: string[];
  minFeeBps: number;
  maxDurationSeconds: number;
  allowedPurposes: Purpose[];
  allowedSupplierDomains: string[];
  acceptedRiskBands: Array<UnderwritingDecision["riskBand"]>;
  reputationScore: number;
  status: "active" | "paused";
  updatedAt: string;
}

export interface LenderMatch {
  matchId: string;
  offerId: string;
  requestId: string;
  lenderId: string;
  lenderAgent: string;
  score: number;
  feeBps: number;
  amountAtomic: string;
  feeAtomic: string;
  supplier: string;
  supplierDomain: string;
  expiresAt: string;
  createdAt: string;
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

export interface CreditBackingSource {
  sourceId: string;
  productType: Exclude<CreditProductType, "job-backed">;
  agent: string;
  asset: string;
  network: string;
  valueAtomic: string;
  liquidationValueAtomic: string;
  lockedAtomic: string;
  advanceRateBps: number;
  verifier: "ftso" | "fdc" | "x402" | "operator";
  evidenceId: string;
  status: "active" | "paused" | "exhausted";
  updatedAt: string;
}

export interface CollateralPosition {
  jobId: string;
  pledgor: string;
  amountAtomic: string;
  lockedAtomic: string;
  status: "locked" | "released" | "liquidated";
  updatedAt: string;
}

export interface CreditRequest {
  requestId: string;
  productType: CreditProductType;
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
  productType: CreditProductType;
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
  feeAtomic: string;
  collateralLockedAtomic: string;
  backingLockedAtomic: string;
  deadline: string;
  status: CreditStatus;
  paidAt: string;
  supplierPaymentId: string;
}

export interface ReceivableLien {
  lienId: string;
  repaymentSource: string;
  productType: CreditProductType;
  advanceId: string;
  lender: string;
  borrower: string;
  principalAtomic: string;
  feeAtomic: string;
  collateralLockedAtomic: string;
  seniorClaimAtomic: string;
  status: "active" | "released" | "defaulted" | "liquidated";
  createdAt: string;
}

export interface RepaymentReceipt {
  repaymentId: string;
  repaymentSource: string;
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

export interface LiquidationReceipt {
  liquidationId: string;
  repaymentSource: string;
  advanceId: string;
  lender: string;
  collateralPaidAtomic: string;
  reservePaidAtomic: string;
  shortfallAtomic: string;
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
  if (request.productType !== "job-backed") {
    return decline("request is not job-backed");
  }
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
  const maximumFee = parseAtomic(request.maximumFeeAtomic, "maximumFeeAtomic");
  const requiredRevenue = amount + maximumFee;
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

export function underwriteBackingSource(source: CreditBackingSource, request: CreditRequest, policy: SpendingPolicy): UnderwritingDecision {
  if (source.status !== "active") {
    return decline("backing source is not active");
  }
  if (source.sourceId !== request.repaymentSource || source.agent !== request.agent || source.productType !== request.productType) {
    return decline("backing source does not belong to request");
  }
  if (!policy.allowedUses.includes(request.purpose)) {
    return decline("purpose is not allowed");
  }
  if (!policy.allowedDomains.includes(request.supplierDomain)) {
    return decline("supplier domain is not allowed");
  }

  const amount = parseAtomic(request.amountAtomic, "amountAtomic");
  const maxAdvance = parseAtomic(policy.maxAdvanceAtomic, "maxAdvanceAtomic");
  const maximumFee = parseAtomic(request.maximumFeeAtomic, "maximumFeeAtomic");
  const value = parseAtomic(source.valueAtomic, "valueAtomic");
  const liquidationValue = parseAtomic(source.liquidationValueAtomic, "liquidationValueAtomic");
  const locked = parseAtomic(source.lockedAtomic, "lockedAtomic");
  const available = ((value * BigInt(source.advanceRateBps)) / 10_000n) - locked;
  const liquidationAvailable = liquidationValue - locked;

  if (amount > maxAdvance) return decline("request exceeds policy max advance");
  if (amount + maximumFee > available) return decline("request exceeds verified backing capacity");
  if (amount + maximumFee > liquidationAvailable) return decline("request has insufficient hard liquidation value");

  const utilizationBps = Number(((amount + maximumFee) * 10_000n) / (available || 1n));
  return {
    approved: true,
    maximumCreditAtomic: available.toString(),
    riskBand: utilizationBps <= 2500 ? "A" : utilizationBps <= 5000 ? "B" : utilizationBps <= 7500 ? "C" : "D",
    maximumDurationSeconds: request.durationSeconds,
    requiredRevenueSweepBps: request.productType === "asset-backed" ? 10_000 : 5000,
    validUntil: Math.floor(Date.now() / 1000) + request.durationSeconds
  };
}

export function createCreditOffer(
  request: CreditRequest,
  policy: SpendingPolicy,
  signerPrivateKeyPem: string
): CreditOffer {
  parseAtomic(request.amountAtomic, "amountAtomic");
  parseAtomic(request.maximumFeeAtomic, "maximumFeeAtomic");
  const unsigned = {
    offerId: randomHex(16),
    requestId: request.requestId,
    productType: request.productType,
    agent: request.agent,
    approvedAmountAtomic: request.amountAtomic,
    feeAtomic: request.maximumFeeAtomic,
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

export function scoreLenderForRequest(input: {
  lender: LenderProfile;
  request: CreditRequest;
  decision: UnderwritingDecision;
  offer: CreditOffer;
  network: string;
  asset: string;
}): number | undefined {
  if (input.lender.status !== "active") return undefined;
  if (input.lender.asset !== input.asset) return undefined;
  if (!input.lender.networks.includes(input.network)) return undefined;
  if (!input.lender.allowedPurposes.includes(input.request.purpose)) return undefined;
  if (!input.lender.allowedSupplierDomains.includes(input.request.supplierDomain)) return undefined;
  if (!input.lender.acceptedRiskBands.includes(input.decision.riskBand)) return undefined;
  if (input.request.durationSeconds > input.lender.maxDurationSeconds) return undefined;

  const amount = parseAtomic(input.offer.approvedAmountAtomic, "approvedAmountAtomic");
  const fee = lenderFeeFor(amount, input.lender.minFeeBps);
  const liquidity = parseAtomic(input.lender.availableLiquidityAtomic, "availableLiquidityAtomic");
  const maximumFee = parseAtomic(input.request.maximumFeeAtomic, "maximumFeeAtomic");
  if (amount > liquidity) return undefined;
  if (fee > maximumFee) return undefined;

  const liquidityHeadroom = Number(((liquidity - amount) * 1_000n) / liquidity);
  const riskScore = { A: 400, B: 300, C: 150, D: 0 }[input.decision.riskBand];
  return input.lender.reputationScore * 10 + riskScore + liquidityHeadroom;
}

export function createRepaymentReceipt(input: {
  repaymentSource: string;
  grossRevenueAtomic: string;
  advance: CreditAdvance;
  reserveBps: number;
  signerPrivateKeyPem: string;
}): RepaymentReceipt {
  const grossRevenue = parseAtomic(input.grossRevenueAtomic, "grossRevenueAtomic");
  const principal = parseAtomic(input.advance.amountAtomic, "amountAtomic");
  const fee = parseAtomic(input.advance.feeAtomic, "feeAtomic");
  const reserve = (fee * BigInt(input.reserveBps)) / 10_000n;
  const agentProceeds = grossRevenue - principal - fee;
  if (agentProceeds < 0n) {
    throw new C402Error("insufficient_repayment_source", "repayment source cannot cover principal and fee", 409);
  }
  const unsigned = {
    repaymentId: randomHex(16),
    repaymentSource: input.repaymentSource,
    advanceId: input.advance.advanceId,
    escrowAmountAtomic: grossRevenue.toString(),
    principalAtomic: principal.toString(),
    feeAtomic: fee.toString(),
    agentProceedsAtomic: agentProceeds.toString(),
    reserveAtomic: reserve.toString(),
    status: "repaid" as const,
    createdAt: new Date().toISOString()
  };
  return { ...unsigned, signature: signObject(input.signerPrivateKeyPem, unsigned) };
}

export function createLiquidationReceipt(input: {
  repaymentSource: string;
  advanceId: string;
  lender: string;
  collateralPaidAtomic: string;
  reservePaidAtomic: string;
  shortfallAtomic: string;
  signerPrivateKeyPem: string;
}): LiquidationReceipt {
  const unsigned = {
    liquidationId: randomHex(16),
    repaymentSource: input.repaymentSource,
    advanceId: input.advanceId,
    lender: input.lender,
    collateralPaidAtomic: input.collateralPaidAtomic,
    reservePaidAtomic: input.reservePaidAtomic,
    shortfallAtomic: input.shortfallAtomic,
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

export function lenderFeeFor(amount: bigint, feeBps: number): bigint {
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new C402Error("invalid_lender_fee", "feeBps must be between 0 and 10000");
  }
  return (amount * BigInt(feeBps)) / 10_000n;
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
