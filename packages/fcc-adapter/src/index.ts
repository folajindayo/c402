import {
  assertComputePayload,
  assertCreditAssessmentResult,
  commitment,
  decryptJson,
  encryptJson,
  envelopeCommitment,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  objectWithoutSignature,
  randomHex,
  signObject,
  type AttestationInfo,
  type ComputePayload,
  type ComputeReceipt,
  type CreditAssessmentInput,
  type CreditAssessmentResult
} from "@c402/protocol";
import {
  assessCredit,
  CREDIT_MODEL_CODE_HASH,
  CREDIT_OUTPUT_SCHEMA
} from "@c402/credit-model";

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

export interface LocalFccAdapterOptions {
  teeId?: string;
  extensionId?: string;
  codeHash?: string;
}

export class LocalFccAdapter implements FccAdapter {
  private readonly encryptionKeys = generateEncryptionKeyPair();
  private readonly signingKeys = generateSigningKeyPair();
  private readonly teeId: string;
  private readonly extensionId: string;
  private readonly codeHash: string;

  constructor(options: LocalFccAdapterOptions = {}) {
    this.teeId = options.teeId ?? "local-tee-001";
    this.extensionId = options.extensionId ?? "credit-score-extension-local";
    this.codeHash = options.codeHash ?? CREDIT_MODEL_CODE_HASH;
  }

  async getAttestation(): Promise<AttestationInfo> {
    return {
      teeId: this.teeId,
      extensionId: this.extensionId,
      codeHash: this.codeHash,
      inputEncryptionKey: this.encryptionKeys.publicKey,
      teeSigningKey: this.signingKeys.publicKey,
      mode: "local",
      verifiedAt: new Date().toISOString()
    };
  }

  async executeCreditAssessment(input: ExecuteComputeInput): Promise<ExecuteComputeOutput> {
    assertComputePayload(input.payload);

    const statement = decryptJson<CreditAssessmentInput>(this.encryptionKeys.privateKey, input.payload.encryptedInput);
    const result = assessCredit(statement);
    assertCreditAssessmentResult(result);

    const encryptedResult = encryptJson(input.payload.clientOutputEncryptionKey, result);
    const outputCommitment = envelopeCommitment(encryptedResult);
    const receiptUnsigned = {
      protocol: "c402" as const,
      version: 1 as const,
      requestId: input.requestId,
      paymentId: input.paymentId,
      inputCommitment: input.payload.inputCommitment,
      outputCommitment,
      codeHash: this.codeHash,
      teeId: this.teeId,
      extensionId: this.extensionId,
      outputSchema: CREDIT_OUTPUT_SCHEMA,
      status: "success" as const,
      priceAtomic: input.priceAtomic,
      timestamp: Math.floor(Date.now() / 1000),
      settlementTx: `local:${randomHex(12)}`
    };
    const receipt: ComputeReceipt = {
      ...receiptUnsigned,
      signature: signObject(this.signingKeys.privateKey, receiptUnsigned)
    };

    return { encryptedResult, outputCommitment, receipt };
  }
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

    if (commitment(objectWithoutSignature(response.receipt)) !== commitment(objectWithoutSignature(response.receipt))) {
      throw new Error("unreachable receipt canonicalization check failed");
    }
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
  if (env.C402_FCC_MODE === "coston2") {
    const proxyUrl = requiredEnv(env, "C402_FCC_PROXY_URL");
    const expectedCodeHash = requiredEnv(env, "C402_EXPECTED_CODE_HASH");
    const extensionId = requiredEnv(env, "C402_FCC_EXTENSION_ID");
    return new Coston2FccAdapter({ proxyUrl, expectedCodeHash, extensionId, teeId: env.C402_FCC_TEE_ID });
  }

  if (env.ALLOW_LOCAL_DEMO !== "true") {
    throw new Error("C402_FCC_MODE=local requires ALLOW_LOCAL_DEMO=true; set C402_FCC_MODE=coston2 for real Flare FCC execution.");
  }

  return new LocalFccAdapter({
    codeHash: env.C402_EXPECTED_CODE_HASH || CREDIT_MODEL_CODE_HASH,
    extensionId: env.C402_FCC_EXTENSION_ID
  });
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
