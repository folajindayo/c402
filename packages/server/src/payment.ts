import {
  C402Error,
  C402_EXTENSION_KEY,
  type ComputeRequirement,
  type PaymentAccept,
  type PaymentRequirement
} from "@c402/protocol";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

export interface VerifiedPayment {
  paymentId: string;
  payer: string;
  amount: string;
  asset: string;
  network: string;
}

export interface PaymentAdapter {
  createRequirement(requestId: string): PaymentRequirement;
  verify(signature: unknown, requirement: PaymentRequirement): Promise<VerifiedPayment>;
  release(payment: VerifiedPayment, receiptStatus: "success" | "failed" | "timeout"): Promise<{ settlementTx?: string }>;
}

export interface X402FacilitatorPaymentAdapterOptions {
  amount: string;
  asset: string;
  network: string;
  payTo: string;
  resourceUrl: string;
  expiresAt: () => string;
  facilitatorUrl?: string;
  facilitatorBearerToken?: string;
  attachCompute: (accept: PaymentAccept, expiresAt: string) => ComputeRequirement;
}

export class X402FacilitatorPaymentAdapter implements PaymentAdapter {
  private readonly facilitator: HTTPFacilitatorClient;
  private readonly payloads = new Map<string, PaymentPayload>();
  private readonly accepts = new Map<string, PaymentRequirements>();

  constructor(private readonly options: X402FacilitatorPaymentAdapterOptions) {
    this.facilitator = new HTTPFacilitatorClient({
      url: options.facilitatorUrl ?? "https://x402.org/facilitator",
      createAuthHeaders: options.facilitatorBearerToken
        ? async () => {
            const headers = { Authorization: `Bearer ${options.facilitatorBearerToken}` };
            return { verify: headers, settle: headers, supported: headers };
          }
        : undefined
    });
  }

  createRequirement(requestId: string): PaymentRequirement {
    const accept: PaymentAccept = {
      requestId,
      scheme: "exact",
      amount: this.options.amount,
      asset: this.options.asset,
      network: this.options.network,
      payTo: this.options.payTo,
      maxTimeoutSeconds: 30,
      extra: { requestId, ...assetExtra(this.options.network, this.options.asset) }
    };
    const expiresAt = this.options.expiresAt();
    return {
      x402Version: 2,
      error: "payment required",
      resource: {
        url: this.options.resourceUrl,
        description: "c402 confidential credit assessment",
        mimeType: "application/json",
        serviceName: "c402",
        tags: ["confidential-compute", "credit"]
      },
      accepts: [accept],
      extensions: {
        [C402_EXTENSION_KEY]: this.options.attachCompute(accept, expiresAt)
      }
    };
  }

  async verify(signature: unknown, requirement: PaymentRequirement): Promise<VerifiedPayment> {
    const paymentPayload = signature as PaymentPayload;
    const accept = this.toX402Accept(requirement);
    const result = await this.facilitator.verify(paymentPayload, accept);
    if (!result.isValid) {
      throw new C402Error("x402_verify_failed", result.invalidMessage ?? result.invalidReason ?? "facilitator rejected payment", 402, result);
    }

    this.payloads.set(requirement.extensions[C402_EXTENSION_KEY].requestId, paymentPayload);
    this.accepts.set(requirement.extensions[C402_EXTENSION_KEY].requestId, accept);
    return {
      paymentId: `x402:${requirement.extensions[C402_EXTENSION_KEY].requestId}:${result.payer ?? "unknown"}`,
      payer: result.payer ?? "unknown",
      amount: accept.amount,
      asset: accept.asset,
      network: accept.network
    };
  }

  async release(payment: VerifiedPayment, receiptStatus: "success" | "failed" | "timeout"): Promise<{ settlementTx?: string }> {
    if (receiptStatus !== "success") {
      return {};
    }
    const requestId = payment.paymentId.split(":")[1];
    const payload = this.payloads.get(requestId);
    const accept = this.accepts.get(requestId);
    if (!payload || !accept) {
      throw new C402Error("missing_verified_payment", "cannot settle payment before successful verification", 500);
    }
    const settlement = await this.facilitator.settle(payload, accept);
    if (!settlement.success) {
      throw new C402Error("x402_settle_failed", settlement.errorMessage ?? settlement.errorReason ?? "facilitator settlement failed", 502, settlement);
    }
    return { settlementTx: settlement.transaction };
  }

  private toX402Accept(requirement: PaymentRequirement): PaymentRequirements {
    const accept = requirement.accepts[0];
    return {
      scheme: accept.scheme,
      network: accept.network as `${string}:${string}`,
      amount: accept.amount,
      asset: accept.asset,
      payTo: accept.payTo,
      maxTimeoutSeconds: accept.maxTimeoutSeconds,
      extra: {
        ...accept.extra,
        [C402_EXTENSION_KEY]: requirement.extensions[C402_EXTENSION_KEY]
      }
    };
  }
}

function assetExtra(network: string, asset: string): Record<string, string> {
  if (network === "eip155:84532" && asset.toLowerCase() === "0x036cbd53842c5426634e7929541ec2318f3dcf7e") {
    return { name: "USDC", version: "2" };
  }
  return {};
}
