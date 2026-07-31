import {
  assertComputePayload,
  assertComputeReceipt,
  assertPaymentRequirement,
  C402Error,
  C402_EXTENSION_KEY,
  commitment,
  decodeHeaderJson,
  encodeHeaderJson,
  envelopeCommitment,
  objectWithoutSignature,
  randomHex,
  verifyObjectSignature,
  type AttestationInfo,
  type ComputePayload,
  type ComputeReceipt,
  type ComputeRequirement,
  type PaymentRequirement
} from "@c402/protocol";
import type { FccAdapter } from "@c402/fcc-adapter";
import { CREDIT_OUTPUT_SCHEMA } from "@c402/credit-model";
import { DemoPaymentAdapter, X402FacilitatorPaymentAdapter, type PaymentAdapter } from "./payment.js";
import { RequestStore } from "./state.js";

export * from "./payment.js";
export * from "./state.js";
export * from "./credit.js";

export interface C402ServerConfig {
  price: string;
  amountAtomic: string;
  asset: string;
  network: string;
  payTo: string;
  expectedCodeHash: string;
  paymentMode: "demo" | "x402-testnet";
  demoPaymentSecret: string;
  resourceUrl: string;
  facilitatorUrl?: string;
  facilitatorBearerToken?: string;
  allowLocalDemo: boolean;
  requirementTtlSeconds: number;
  fcc: FccAdapter;
}

export interface C402Quote {
  status: 402;
  headers: Record<string, string>;
  body: {
    error: "payment_required";
    requestId: string;
    message: string;
  };
}

export interface C402Success {
  status: 200;
  headers: Record<string, string>;
  body: {
    encryptedResult: unknown;
    outputCommitment: string;
    settlementTx?: string;
    executedBy: string;
  };
}

export class ConfidentialPaymentService {
  readonly store = new RequestStore();
  private readonly payment: PaymentAdapter;
  private lastRequirementById = new Map<string, PaymentRequirement>();

  constructor(private readonly config: C402ServerConfig) {
    this.payment =
      config.paymentMode === "demo"
        ? new DemoPaymentAdapter({
            amount: config.amountAtomic,
            asset: config.asset,
            network: config.network,
            payTo: config.payTo,
            secret: config.demoPaymentSecret,
            resourceUrl: config.resourceUrl,
            expiresAt: () => new Date(Date.now() + config.requirementTtlSeconds * 1000).toISOString(),
            attachCompute: (accept, expiresAt) => this.createComputeRequirement(accept.requestId, expiresAt)
          })
        : new X402FacilitatorPaymentAdapter({
            amount: config.amountAtomic,
            asset: config.asset,
            network: config.network,
            payTo: config.payTo,
            resourceUrl: config.resourceUrl,
            facilitatorUrl: config.facilitatorUrl,
            facilitatorBearerToken: config.facilitatorBearerToken,
            expiresAt: () => new Date(Date.now() + config.requirementTtlSeconds * 1000).toISOString(),
            attachCompute: (accept, expiresAt) => this.createComputeRequirement(accept.requestId, expiresAt)
          });
  }

  async attestation(): Promise<AttestationInfo> {
    return this.config.fcc.getAttestation();
  }

  async quote(): Promise<C402Quote> {
    const requestId = randomHex(16);
    const requirement = this.payment.createRequirement(requestId);
    assertPaymentRequirement(requirement);
    const requirementHash = commitment(requirement.extensions[C402_EXTENSION_KEY]);
    this.store.create(requestId, requirementHash);
    this.lastRequirementById.set(requestId, requirement);

    return {
      status: 402,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "PAYMENT-REQUIRED": encodeHeaderJson(requirement),
        "COMPUTE-REQUIRED": encodeHeaderJson(requirement.extensions[C402_EXTENSION_KEY])
      },
      body: {
        error: "payment_required",
        requestId,
        message: "Payment and confidential compute authorization are required."
      }
    };
  }

  async execute(headers: Headers): Promise<C402Success> {
    const payload = decodeHeaderJson<ComputePayload>(headers.get("COMPUTE-PAYLOAD"), "COMPUTE-PAYLOAD");
    assertComputePayload(payload);

    const requirement = this.lastRequirementById.get(payload.requestId);
    if (!requirement) {
      throw new C402Error("unknown_request", "requestId was not quoted by this server", 404);
    }
    const computeRequirement = requirement.extensions[C402_EXTENSION_KEY];
    if (payload.requirementHash !== commitment(computeRequirement)) {
      throw new C402Error("requirement_hash_mismatch", "compute payload does not match current requirement", 400);
    }
    if (payload.nonce !== computeRequirement.nonce) {
      throw new C402Error("nonce_mismatch", "compute payload nonce does not match requirement", 400);
    }
    if (payload.inputCommitment !== envelopeCommitment(payload.encryptedInput)) {
      throw new C402Error("input_commitment_mismatch", "input commitment does not match encrypted input", 400);
    }

    const existing = this.store.get(payload.requestId);
    if (existing?.state === "delivered" && existing.receipt && existing.encryptedResult) {
      return {
        status: 200,
        headers: {
          "content-type": "application/json",
          "COMPUTE-RECEIPT": encodeHeaderJson(existing.receipt),
          "PAYMENT-RESPONSE": encodeHeaderJson({ paymentId: existing.paymentId, idempotent: true })
        },
        body: {
          encryptedResult: existing.encryptedResult,
          outputCommitment: (existing.receipt as { outputCommitment: string }).outputCommitment,
          executedBy: (existing.receipt as { teeId: string }).teeId
        }
      };
    }

    const paymentSignature = decodeHeaderJson<unknown>(headers.get("PAYMENT-SIGNATURE"), "PAYMENT-SIGNATURE");
    const verifiedPayment = await this.payment.verify(paymentSignature, requirement);
    this.store.transition(payload.requestId, "payment_authorized", { paymentId: verifiedPayment.paymentId });
    this.store.transition(payload.requestId, "submitted_to_tee");

    const execution = await this.config.fcc.executeCreditAssessment({
      requestId: payload.requestId,
      paymentId: verifiedPayment.paymentId,
      priceAtomic: this.config.amountAtomic,
      payload
    });
    this.store.transition(payload.requestId, "executed");

    assertComputeReceipt(execution.receipt);
    this.verifyReceipt(execution.receipt, computeRequirement, payload, execution.outputCommitment);
    this.store.transition(payload.requestId, "receipt_verified", { receipt: execution.receipt, encryptedResult: execution.encryptedResult });

    const settlement = await this.payment.release(verifiedPayment, execution.receipt.status);
    const settlementTx = settlement.settlementTx ?? execution.receipt.settlementTx;
    this.store.transition(payload.requestId, "settled", { receipt: execution.receipt });
    this.store.transition(payload.requestId, "delivered", { receipt: execution.receipt, encryptedResult: execution.encryptedResult });

    return {
      status: 200,
      headers: {
        "content-type": "application/json",
        "COMPUTE-RECEIPT": encodeHeaderJson(execution.receipt),
        "PAYMENT-RESPONSE": encodeHeaderJson({ paymentId: verifiedPayment.paymentId, settlementTx })
      },
      body: {
        encryptedResult: execution.encryptedResult,
        outputCommitment: execution.outputCommitment,
        settlementTx,
        executedBy: execution.receipt.teeId
      }
    };
  }

  fail(requestId: string | undefined, error: unknown): void {
    if (requestId && this.store.get(requestId)) {
      this.store.transition(requestId, "failed", { failureReason: error instanceof Error ? error.message : String(error) });
    }
  }

  private createComputeRequirement(requestId: string, expiresAt: string): ComputeRequirement {
    const attestation = this.cachedAttestation();
    if (attestation.codeHash !== this.config.expectedCodeHash) {
      throw new C402Error("code_hash_mismatch", `expected ${this.config.expectedCodeHash}, got ${attestation.codeHash}`, 503);
    }
    return {
      protocol: "c402",
      version: 1,
      requestId,
      price: this.config.amountAtomic,
      asset: this.config.asset,
      network: this.config.network,
      teeId: attestation.teeId,
      extensionId: attestation.extensionId,
      codeHash: attestation.codeHash,
      inputEncryptionKey: attestation.inputEncryptionKey,
      teeSigningKey: attestation.teeSigningKey,
      outputSchema: CREDIT_OUTPUT_SCHEMA,
      timeoutSeconds: 30,
      paymentPolicy: "release-on-valid-receipt",
      nonce: randomHex(16),
      expiresAt
    };
  }

  private cached?: AttestationInfo;

  private cachedAttestation(): AttestationInfo {
    if (!this.cached) {
      throw new C402Error("attestation_not_ready", "attestation cache is not initialized", 503);
    }
    return this.cached;
  }

  async warmup(): Promise<void> {
    this.cached = await this.config.fcc.getAttestation();
  }

  private verifyReceipt(
    receipt: ComputeReceipt,
    requirement: ComputeRequirement,
    payload: ComputePayload,
    outputCommitment: string
  ): void {
    if (receipt.requestId !== payload.requestId) {
      throw new C402Error("receipt_request_mismatch", "receipt requestId does not match payload", 502);
    }
    if (receipt.inputCommitment !== payload.inputCommitment || receipt.outputCommitment !== outputCommitment) {
      throw new C402Error("receipt_commitment_mismatch", "receipt commitments do not match execution output", 502);
    }
    if (receipt.codeHash !== requirement.codeHash || receipt.teeId !== requirement.teeId || receipt.extensionId !== requirement.extensionId) {
      throw new C402Error("receipt_attestation_mismatch", "receipt does not match advertised attestation", 502);
    }
    if (receipt.status !== "success") {
      throw new C402Error("compute_failed", "TEE receipt did not report success", 502);
    }
    if (!verifyObjectSignature(requirement.teeSigningKey, objectWithoutSignature(receipt), receipt.signature)) {
      throw new C402Error("invalid_receipt_signature", "TEE receipt signature failed verification", 502);
    }
  }
}

export function createConfigFromEnv(env: NodeJS.ProcessEnv, fcc: FccAdapter): C402ServerConfig {
  const allowLocalDemo = env.ALLOW_LOCAL_DEMO === "true";
  const paymentMode = env.C402_PAYMENT_MODE === "demo" ? "demo" : "x402-testnet";
  if (paymentMode === "demo" && !allowLocalDemo) {
    throw new C402Error("local_demo_disabled", "C402_PAYMENT_MODE=demo requires ALLOW_LOCAL_DEMO=true; set C402_PAYMENT_MODE=x402-testnet for real x402 facilitator settlement.", 500);
  }
  if (paymentMode !== "demo" && !env.C402_PAY_TO) {
    throw new C402Error("missing_pay_to", "Real x402 mode requires C402_PAY_TO to be set to the receiver wallet address.", 500);
  }
  return {
    price: env.C402_PRICE_USD ?? "0.10",
    amountAtomic: env.C402_AMOUNT_ATOMIC ?? centsAtomic(env.C402_PRICE_USD ?? "0.10"),
    asset: env.C402_ASSET ?? "USDC",
    network: env.C402_NETWORK ?? "eip155:84532",
    payTo: env.C402_PAY_TO ?? "0x0000000000000000000000000000000000000402",
    expectedCodeHash: env.C402_EXPECTED_CODE_HASH ?? "0xcredit_model_v1",
    paymentMode,
    demoPaymentSecret: env.C402_DEMO_PAYMENT_SECRET ?? "dev-secret-change-me",
    resourceUrl: env.C402_RESOURCE_URL ?? `${env.C402_BASE_URL ?? "http://127.0.0.1:4021"}/credit-score`,
    facilitatorUrl: env.X402_FACILITATOR_URL,
    facilitatorBearerToken: env.X402_FACILITATOR_BEARER_TOKEN,
    allowLocalDemo,
    requirementTtlSeconds: Number(env.C402_REQUIREMENT_TTL_SECONDS ?? 120),
    fcc
  };
}

function centsAtomic(price: string): string {
  const numeric = Number(price.replace(/^\$/, ""));
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new C402Error("invalid_price", `invalid price ${price}`, 500);
  }
  return String(Math.round(numeric * 1_000_000));
}
