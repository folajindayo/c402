import {
  assertComputePayload,
  assertCreditAssessmentResult,
  decryptJson,
  encryptJson,
  type AttestationInfo,
  type ComputePayload,
  type ComputeReceipt,
  type CreditAssessmentResult
} from "@c402/protocol";

export interface ExecuteComputeInput {
  requestId: string;
  paymentId: string;
  priceAtomic: string;
  payload: ComputePayload;
}

export interface ExecuteComputeOutput {
  encryptedResult: ReturnType<typeof encryptJson>;
  outputCommitment: string;
  receipt: ComputeReceipt;
}

export interface FccAdapter {
  getAttestation(): Promise<AttestationInfo>;
  executeCreditAssessment(input: ExecuteComputeInput): Promise<ExecuteComputeOutput>;
}

export interface Coston2FccAdapterOptions {
  proxyUrl: string;
  expectedCodeHash: string;
  extensionId: string;
  teeId?: string;
  timeoutMs?: number;
}

export class Coston2FccAdapter implements FccAdapter {
  constructor(private readonly options: Coston2FccAdapterOptions) {}

  async getAttestation(): Promise<AttestationInfo> {
    const info = await this.fetchJson<{ machineData?: Record<string, unknown> }>("/info");
    const machine = info.machineData ?? {};
    const codeHash = String(machine.codeHash ?? "");
    const extensionId = String(machine.extensionId ?? this.options.extensionId);
    const teeId = String(machine.teeId ?? this.options.teeId ?? "");
    const inputEncryptionKey = String(machine.publicKey ?? machine.inputEncryptionKey ?? "");
    const teeSigningKey = String(machine.signingKey ?? machine.teeSigningKey ?? "");

    if (!codeHash || codeHash !== this.options.expectedCodeHash) {
      throw new Error(`Coston2 FCC code hash mismatch: expected ${this.options.expectedCodeHash}, got ${codeHash || "<missing>"}`);
    }
    if (!extensionId || extensionId !== this.options.extensionId) {
      throw new Error(`Coston2 FCC extension mismatch: expected ${this.options.extensionId}, got ${extensionId || "<missing>"}`);
    }
    if (!teeId || !inputEncryptionKey || !teeSigningKey) {
      throw new Error("Coston2 FCC proxy did not expose teeId, input encryption key, and signing key");
    }

    return {
      teeId,
      extensionId,
      codeHash,
      inputEncryptionKey,
      teeSigningKey,
      mode: "coston2",
      verifiedAt: new Date().toISOString()
    };
  }

  async executeCreditAssessment(input: ExecuteComputeInput): Promise<ExecuteComputeOutput> {
    assertComputePayload(input.payload);
    const response = await this.fetchJson<ExecuteComputeOutput>("/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opType: "CREDIT_SCORE",
        opCommand: "ASSESS",
        requestId: input.requestId,
        paymentId: input.paymentId,
        priceAtomic: input.priceAtomic,
        payload: input.payload
      })
    });

    return response;
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const response = await fetch(new URL(path, this.options.proxyUrl), {
        ...init,
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`FCC proxy ${path} returned ${response.status}: ${await response.text()}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createFccAdapterFromEnv(env: NodeJS.ProcessEnv): FccAdapter {
  if (env.C402_FCC_MODE !== "coston2") {
    throw new Error("C402_FCC_MODE=coston2 is required when C402_ENABLE_COMPUTE=true.");
  }
  const proxyUrl = requiredEnv(env, "C402_FCC_PROXY_URL");
  const expectedCodeHash = requiredEnv(env, "C402_EXPECTED_CODE_HASH");
  const extensionId = requiredEnv(env, "C402_FCC_EXTENSION_ID");
  return new Coston2FccAdapter({ proxyUrl, expectedCodeHash, extensionId, teeId: env.C402_FCC_TEE_ID });
}

export function decodeCreditResult(privateKeyPem: string, output: ExecuteComputeOutput): CreditAssessmentResult {
  const result = decryptJson<CreditAssessmentResult>(privateKeyPem, output.encryptedResult);
  assertCreditAssessmentResult(result);
  return result;
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}
