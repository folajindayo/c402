import {
  assertComputeRequirement,
  assertComputeReceipt,
  assertCreditAssessmentResult,
  assertPaymentRequirement,
  C402Error,
  C402_HEADERS,
  C402_EXTENSION_KEY,
  commitment,
  decodeHeaderJson,
  decryptJson,
  encodeHeaderJson,
  encryptJson,
  envelopeCommitment,
  generateEncryptionKeyPair,
  hmacSignature,
  objectWithoutSignature,
  verifyObjectSignature,
  type ComputePayload,
  type ComputeReceipt,
  type ComputeRequirement,
  type CreditAssessmentResult,
  type PaymentRequirement
} from "@c402/protocol";

export interface C402FetchOptions {
  privateInput: unknown;
  verifyCodeHash: string;
  payer?: string;
  demoPaymentSecret?: string;
  allowDemoPayment?: boolean;
  x402PaymentPayload?: unknown;
  createX402PaymentPayload?: (paymentRequirement: PaymentRequirement) => Promise<unknown>;
  fetchImpl?: typeof fetch;
}

export interface C402FetchResult {
  result: CreditAssessmentResult;
  receipt: ComputeReceipt;
  paymentResponse: unknown;
  raw: unknown;
}

export async function c402Fetch(url: string, options: C402FetchOptions): Promise<C402FetchResult> {
  const fetcher = options.fetchImpl ?? fetch;
  const initial = await fetcher(url, { method: "POST" });
  if (initial.status !== 402) {
    throw new C402Error("expected_402", `expected 402 challenge, got ${initial.status}`, initial.status);
  }

  const paymentRequirement = decodeHeaderJson<PaymentRequirement>(initial.headers.get(C402_HEADERS.paymentRequired), C402_HEADERS.paymentRequired);
  const computeRequirement = decodeHeaderJson<ComputeRequirement>(initial.headers.get(C402_HEADERS.computeRequired), C402_HEADERS.computeRequired);
  assertPaymentRequirement(paymentRequirement);
  assertComputeRequirement(computeRequirement);
  verifyRequirement(paymentRequirement, computeRequirement, options.verifyCodeHash);

  const outputKeys = generateEncryptionKeyPair();
  const encryptedInput = encryptJson(computeRequirement.inputEncryptionKey, options.privateInput);
  const payload: ComputePayload = {
    protocol: "c402",
    version: 1,
    requestId: computeRequirement.requestId,
    requirementHash: commitment(computeRequirement),
    encryptedInput,
    clientOutputEncryptionKey: outputKeys.publicKey,
    inputCommitment: envelopeCommitment(encryptedInput),
    nonce: computeRequirement.nonce
  };

  const accept = paymentRequirement.accepts[0];
  const paymentSignature = options.x402PaymentPayload
    ?? await options.createX402PaymentPayload?.(paymentRequirement)
    ?? createDemoPaymentPayload(options, accept);

  const paid = await fetcher(url, {
    method: "POST",
    headers: {
      [C402_HEADERS.computePayload]: encodeHeaderJson(payload),
      [C402_HEADERS.paymentSignature]: encodeHeaderJson(paymentSignature)
    }
  });

  const raw = await paid.json();
  if (!paid.ok) {
    throw new C402Error("paid_request_failed", `paid request failed with ${paid.status}`, paid.status, raw);
  }

  const receipt = decodeHeaderJson<ComputeReceipt>(paid.headers.get(C402_HEADERS.computeReceipt), C402_HEADERS.computeReceipt);
  assertComputeReceipt(receipt);
  verifyReceipt(receipt, computeRequirement, payload, raw);

  const result = decryptJson<CreditAssessmentResult>(outputKeys.privateKey, (raw as { encryptedResult: never }).encryptedResult);
  assertCreditAssessmentResult(result);

  return {
    result,
    receipt,
    paymentResponse: decodeHeaderJson<unknown>(paid.headers.get(C402_HEADERS.paymentResponse), C402_HEADERS.paymentResponse),
    raw
  };
}

function verifyRequirement(payment: PaymentRequirement, compute: ComputeRequirement, expectedCodeHash: string): void {
  if (payment.extensions[C402_EXTENSION_KEY].requestId !== compute.requestId || payment.accepts[0]?.requestId !== compute.requestId) {
    throw new C402Error("requirement_request_mismatch", "payment and compute requirements disagree on requestId", 400);
  }
  if (compute.codeHash !== expectedCodeHash) {
    throw new C402Error("code_hash_mismatch", `expected ${expectedCodeHash}, got ${compute.codeHash}`, 412);
  }
  if (compute.paymentPolicy !== "release-on-valid-receipt") {
    throw new C402Error("unsupported_payment_policy", "client requires release-on-valid-receipt", 412);
  }
}

function createDemoPaymentPayload(options: C402FetchOptions, accept: PaymentRequirement["accepts"][number]): unknown {
  if (!options.allowDemoPayment) {
    throw new C402Error("missing_x402_payment_payload", "No real x402 payment payload was provided. Pass x402PaymentPayload from an official x402 wallet/client, or set allowDemoPayment=true only for local demos.", 402);
  }
  const paymentSignatureUnsigned = {
    protocol: "x402-demo",
    version: 1,
    requestId: accept.requestId,
    payer: options.payer ?? "agent-demo",
    amount: accept.amount,
    asset: accept.asset,
    network: accept.network
  } as const;
  return {
    ...paymentSignatureUnsigned,
    signature: hmacSignature(options.demoPaymentSecret ?? "dev-secret-change-me", paymentSignatureUnsigned)
  };
}

function verifyReceipt(
  receipt: ComputeReceipt,
  requirement: ComputeRequirement,
  payload: ComputePayload,
  body: unknown
): void {
  if (receipt.requestId !== payload.requestId) {
    throw new C402Error("receipt_request_mismatch", "receipt requestId mismatch", 502);
  }
  if (receipt.codeHash !== requirement.codeHash || receipt.teeId !== requirement.teeId || receipt.extensionId !== requirement.extensionId) {
    throw new C402Error("receipt_attestation_mismatch", "receipt attestation fields differ from requirement", 502);
  }
  if (receipt.inputCommitment !== payload.inputCommitment) {
    throw new C402Error("receipt_input_mismatch", "receipt input commitment mismatch", 502);
  }
  if (receipt.status !== "success") {
    throw new C402Error("compute_failed", "TEE did not report successful execution", 502);
  }
  if (!verifyObjectSignature(requirement.teeSigningKey, objectWithoutSignature(receipt), receipt.signature)) {
    throw new C402Error("invalid_receipt_signature", "receipt signature failed verification", 502);
  }
  const encryptedResult = (body as { encryptedResult?: unknown }).encryptedResult;
  if (receipt.outputCommitment !== commitment(encryptedResult)) {
    throw new C402Error("receipt_output_mismatch", "receipt output commitment does not match response body", 502);
  }
}
