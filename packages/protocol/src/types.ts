export const C402_EXTENSION_KEY = "c402-confidential-compute";

export const C402_HEADERS = {
  computeRequired: "COMPUTE-REQUIRED",
  computePayload: "COMPUTE-PAYLOAD",
  computeReceipt: "COMPUTE-RECEIPT",
  paymentRequired: "PAYMENT-REQUIRED",
  paymentSignature: "PAYMENT-SIGNATURE",
  paymentResponse: "PAYMENT-RESPONSE"
} as const;

export type ComputeStatus = "success" | "failed" | "timeout";
export type PaymentPolicy = "release-on-valid-receipt";

export interface ComputeRequirement {
  protocol: "c402";
  version: 1;
  requestId: string;
  price: string;
  asset: string;
  network: string;
  teeId: string;
  extensionId: string;
  codeHash: string;
  inputEncryptionKey: string;
  teeSigningKey: string;
  outputSchema: string;
  timeoutSeconds: number;
  paymentPolicy: PaymentPolicy;
  nonce: string;
  expiresAt: string;
}

export interface PaymentRequirement {
  x402Version: 2;
  error?: string;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
    serviceName?: string;
    tags?: string[];
  };
  accepts: PaymentAccept[];
  extensions: {
    [C402_EXTENSION_KEY]: ComputeRequirement;
  };
}

export interface PaymentAccept {
  requestId: string;
  scheme: "exact";
  amount: string;
  asset: string;
  network: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface ComputePayload {
  protocol: "c402";
  version: 1;
  requestId: string;
  requirementHash: string;
  encryptedInput: EncryptedEnvelope;
  clientOutputEncryptionKey: string;
  inputCommitment: string;
  nonce: string;
}

export interface EncryptedEnvelope {
  algorithm: "RSA-OAEP-256+A256GCM";
  encryptedKey: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface ComputeReceipt {
  protocol: "c402";
  version: 1;
  requestId: string;
  paymentId: string;
  inputCommitment: string;
  outputCommitment: string;
  codeHash: string;
  teeId: string;
  extensionId: string;
  outputSchema: string;
  status: ComputeStatus;
  priceAtomic: string;
  timestamp: number;
  settlementTx?: string;
  errorCode?: string;
  signature: string;
}

export interface CreditAssessmentInput {
  customerId: string;
  monthlyIncomeCents: number;
  currentDebtCents: number;
  averageBalanceCents: number;
  overdraftCount90d: number;
  missedPaymentCount12m: number;
  transactions: Array<{
    postedAt: string;
    description: string;
    amountCents: number;
  }>;
}

export interface CreditAssessmentResult {
  approved: boolean;
  maximumCredit: number;
  riskBand: "A" | "B" | "C" | "D";
  validUntil: number;
}

export interface AttestationInfo {
  teeId: string;
  extensionId: string;
  codeHash: string;
  inputEncryptionKey: string;
  teeSigningKey: string;
  mode: "coston2";
  verifiedAt: string;
}
