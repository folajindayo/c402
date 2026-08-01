import { assertC402 } from "./errors.js";
import type {
  ComputePayload,
  ComputeReceipt,
  ComputeRequirement,
  CreditAssessmentInput,
  CreditAssessmentResult,
  PaymentRequirement
} from "./types.js";

export function assertComputeRequirement(value: ComputeRequirement): void {
  assertC402(value.protocol === "c402", "invalid_compute_requirement", "compute requirement protocol must be c402");
  assertC402(value.version === 1, "invalid_compute_requirement", "unsupported c402 version");
  assertNonEmpty(value.requestId, "requestId");
  assertNonEmpty(value.price, "price");
  assertNonEmpty(value.asset, "asset");
  assertNonEmpty(value.network, "network");
  assertNonEmpty(value.teeId, "teeId");
  assertNonEmpty(value.extensionId, "extensionId");
  assertNonEmpty(value.codeHash, "codeHash");
  assertNonEmpty(value.inputEncryptionKey, "inputEncryptionKey");
  assertNonEmpty(value.teeSigningKey, "teeSigningKey");
  assertNonEmpty(value.outputSchema, "outputSchema");
  assertC402(value.timeoutSeconds > 0 && value.timeoutSeconds <= 300, "invalid_timeout", "timeout must be between 1 and 300 seconds");
  assertC402(value.paymentPolicy === "release-on-valid-receipt", "invalid_payment_policy", "unsupported payment policy");
  assertC402(Date.parse(value.expiresAt) > Date.now(), "expired_requirement", "compute requirement has expired", 402);
}

export function assertPaymentRequirement(value: PaymentRequirement): void {
  assertC402(value.x402Version === 2, "invalid_payment_requirement", "unsupported x402 version");
  assertC402(Array.isArray(value.accepts) && value.accepts.length > 0, "invalid_payment_requirement", "payment requirement must include accepts");
  for (const accept of value.accepts) {
    assertC402(accept.scheme === "exact", "unsupported_payment_scheme", "only exact payments are supported in this MVP");
    assertNonEmpty(accept.requestId, "accept.requestId");
    assertNonEmpty(accept.amount, "accept.amount");
    assertNonEmpty(accept.asset, "accept.asset");
    assertNonEmpty(accept.network, "accept.network");
    assertNonEmpty(accept.payTo, "accept.payTo");
    assertC402(accept.maxTimeoutSeconds > 0, "invalid_payment_requirement", "maxTimeoutSeconds must be positive");
  }
  assertComputeRequirement(value.extensions["c402-confidential-compute"]);
}

export function assertComputePayload(value: ComputePayload): void {
  assertC402(value.protocol === "c402", "invalid_compute_payload", "compute payload protocol must be c402");
  assertC402(value.version === 1, "invalid_compute_payload", "unsupported c402 payload version");
  assertNonEmpty(value.requestId, "requestId");
  assertNonEmpty(value.requirementHash, "requirementHash");
  assertNonEmpty(value.clientOutputEncryptionKey, "clientOutputEncryptionKey");
  assertNonEmpty(value.inputCommitment, "inputCommitment");
  assertC402(value.encryptedInput?.algorithm === "RSA-OAEP-256+A256GCM", "invalid_envelope", "encrypted input must use RSA-OAEP-256+A256GCM");
  assertNonEmpty(value.encryptedInput.encryptedKey, "encryptedInput.encryptedKey");
  assertNonEmpty(value.encryptedInput.iv, "encryptedInput.iv");
  assertNonEmpty(value.encryptedInput.tag, "encryptedInput.tag");
  assertNonEmpty(value.encryptedInput.ciphertext, "encryptedInput.ciphertext");
}

export function assertComputeReceipt(value: ComputeReceipt): void {
  assertC402(value.protocol === "c402", "invalid_receipt", "receipt protocol must be c402");
  assertC402(value.version === 1, "invalid_receipt", "unsupported receipt version");
  assertNonEmpty(value.requestId, "requestId");
  assertNonEmpty(value.inputCommitment, "inputCommitment");
  assertNonEmpty(value.outputCommitment, "outputCommitment");
  assertNonEmpty(value.codeHash, "codeHash");
  assertNonEmpty(value.teeId, "teeId");
  assertNonEmpty(value.extensionId, "extensionId");
  assertC402(["success", "failed", "timeout"].includes(value.status), "invalid_receipt_status", "unsupported receipt status");
  assertNonEmpty(value.signature, "signature");
}

export function assertCreditAssessmentInput(value: CreditAssessmentInput): void {
  assertNonEmpty(value.customerId, "customerId");
  assertC402(Number.isSafeInteger(value.monthlyIncomeCents) && value.monthlyIncomeCents >= 0, "invalid_credit_input", "monthlyIncomeCents must be a non-negative integer");
  assertC402(Number.isSafeInteger(value.currentDebtCents) && value.currentDebtCents >= 0, "invalid_credit_input", "currentDebtCents must be a non-negative integer");
  assertC402(Number.isSafeInteger(value.averageBalanceCents), "invalid_credit_input", "averageBalanceCents must be an integer");
  assertC402(Number.isSafeInteger(value.overdraftCount90d) && value.overdraftCount90d >= 0, "invalid_credit_input", "overdraftCount90d must be a non-negative integer");
  assertC402(Number.isSafeInteger(value.missedPaymentCount12m) && value.missedPaymentCount12m >= 0, "invalid_credit_input", "missedPaymentCount12m must be a non-negative integer");
  assertC402(Array.isArray(value.transactions), "invalid_credit_input", "transactions must be an array");
}

export function assertCreditAssessmentResult(value: CreditAssessmentResult): void {
  assertC402(typeof value.approved === "boolean", "invalid_credit_result", "approved must be boolean");
  assertC402(Number.isSafeInteger(value.maximumCredit) && value.maximumCredit >= 0, "invalid_credit_result", "maximumCredit must be a non-negative integer");
  assertC402(["A", "B", "C", "D"].includes(value.riskBand), "invalid_credit_result", "invalid riskBand");
  assertC402(Number.isSafeInteger(value.validUntil) && value.validUntil > 0, "invalid_credit_result", "validUntil must be a unix timestamp");
}

function assertNonEmpty(value: unknown, field: string): void {
  assertC402(typeof value === "string" && value.length > 0, "missing_field", `${field} is required`);
}
