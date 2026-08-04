import type { IncomingMessage, ServerResponse } from "node:http";
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_FLARE_X402_NETWORK = "eip155:114";
const DEFAULT_FLARE_X402_RPC_URL = "https://coston2-api.flare.network/ext/C/rpc";
const DEFAULT_FLARE_X402_ASSET = "0x21709E63fC7F264F329e0826Ea82197694B82775";

export function flareX402Network(env: NodeJS.ProcessEnv): string {
  return clean(env.X402_FLARE_NETWORK) ?? DEFAULT_FLARE_X402_NETWORK;
}

export function flareX402RpcUrl(env: NodeJS.ProcessEnv): string {
  return clean(env.X402_FLARE_RPC_URL) ?? DEFAULT_FLARE_X402_RPC_URL;
}

export function flareX402Asset(env: NodeJS.ProcessEnv): string {
  return clean(env.X402_FLARE_ASSET) ?? DEFAULT_FLARE_X402_ASSET;
}

export function flareX402FacilitatorConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(flareX402PrivateKey(env));
}

export function flareX402FacilitatorUrl(env: NodeJS.ProcessEnv, baseUrl: string): string {
  return clean(env.X402_FLARE_FACILITATOR_URL) ?? `${baseUrl.replace(/\/+$/, "")}/x402/flare-facilitator`;
}

export async function handleFlareFacilitator(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (!pathname.startsWith("/x402/flare-facilitator")) return false;

  const operation = pathname.slice("/x402/flare-facilitator".length).replace(/^\/+/, "") || "supported";
  if (operation === "supported" && req.method === "GET") {
    const facilitator = createFlareFacilitator();
    if (!facilitator) {
      return sendJson(res, 503, facilitatorNotConfigured());
    }
    return sendJson(res, 200, facilitator.getSupported());
  }

  if ((operation === "verify" || operation === "settle") && req.method === "POST") {
    const facilitator = createFlareFacilitator();
    if (!facilitator) {
      return sendJson(res, 503, facilitatorNotConfigured());
    }
    const body = await readJson(req);
    const paymentPayload = body.paymentPayload;
    const paymentRequirements = body.paymentRequirements;
    if (!paymentPayload || !paymentRequirements) {
      return sendJson(res, 400, {
        error: "invalid_facilitator_request",
        message: "paymentPayload and paymentRequirements are required"
      });
    }
    const result = operation === "verify"
      ? await facilitator.verify(paymentPayload as PaymentPayload, paymentRequirements as PaymentRequirements)
      : await facilitator.settle(paymentPayload as PaymentPayload, paymentRequirements as PaymentRequirements);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: "not_found" });
}

function createFlareFacilitator(): x402Facilitator | undefined {
  const privateKey = flareX402PrivateKey(process.env);
  if (!privateKey) return undefined;

  const network = flareX402Network(process.env);
  const chainId = Number(network.replace("eip155:", ""));
  if (!Number.isSafeInteger(chainId)) {
    throw new Error(`invalid X402_FLARE_NETWORK ${network}`);
  }

  const chain = defineChain({
    id: chainId,
    name: chainId === 114 ? "Flare Coston2" : "Flare",
    nativeCurrency: {
      name: chainId === 114 ? "Coston2 Flare" : "Flare",
      symbol: chainId === 114 ? "C2FLR" : "FLR",
      decimals: 18
    },
    rpcUrls: {
      default: { http: [flareX402RpcUrl(process.env)] }
    }
  });
  const account = privateKeyToAccount(privateKey);
  const transport = http(flareX402RpcUrl(process.env));
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const signer = toFacilitatorEvmSigner({
    address: account.address,
    readContract: (args) => publicClient.readContract(args),
    verifyTypedData: (args) => publicClient.verifyTypedData(args as Parameters<typeof publicClient.verifyTypedData>[0]),
    writeContract: (args) => walletClient.writeContract({ account, chain, ...args }),
    sendTransaction: (args) => walletClient.sendTransaction({ account, chain, ...args }),
    waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args),
    getCode: (args) => publicClient.getCode(args)
  });

  const facilitator = new x402Facilitator();
  registerExactEvmScheme(facilitator, {
    signer,
    networks: network as `eip155:${string}`,
    simulateInSettle: true
  });
  return facilitator;
}

function flareX402PrivateKey(env: NodeJS.ProcessEnv): Hex | undefined {
  const value = clean(env.X402_FLARE_FACILITATOR_PRIVATE_KEY);
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("X402_FLARE_FACILITATOR_PRIVATE_KEY must be a 32-byte hex private key");
  }
  return value as Hex;
}

function facilitatorNotConfigured(): Record<string, string> {
  return {
    error: "flare_x402_facilitator_not_configured",
    message: "Set X402_FLARE_FACILITATOR_PRIVATE_KEY on the deployment to enable Flare x402 verification and settlement."
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): true {
  res.setHeader("content-type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(jsonSafe(body), null, 2));
  return true;
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
