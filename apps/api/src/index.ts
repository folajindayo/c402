import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { C402Error, type CreditProductType, type Purpose } from "@c402/protocol";
import { createFccAdapterFromEnv } from "@c402/fcc-adapter";
import { AgentCreditService, ConfidentialPaymentService, createConfigFromEnv } from "@c402/server";
import { createPublicClient, encodeFunctionData, http, isAddress, keccak256, toBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  flareX402Asset,
  flareX402FacilitatorConfigured,
  flareX402FacilitatorUrl,
  flareX402Network,
  handleFlareFacilitator
} from "./flare-facilitator.js";
import { renderDocs, renderLanding, renderLlmsTxt } from "./site.js";

const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const COSTON2_TEST_USDT0 = "0x21709E63fC7F264F329e0826Ea82197694B82775";
const NATIVE_ASSET = "native";
const BASE_SEPOLIA_NETWORK = "eip155:84532";
const COSTON2_NETWORK = "eip155:114";

type CreditNetworkConfig = {
  chainId: number;
  network: string;
  name: string;
  rpcUrl: string;
  defaultAsset: string;
  creditContractEnv: string;
  moduleEnv: string;
  proxyFactory: string;
  singleton: string;
};

const CREDIT_NETWORK_CONFIG: Record<string, CreditNetworkConfig> = {
  [BASE_SEPOLIA_NETWORK]: {
    chainId: 84532,
    network: BASE_SEPOLIA_NETWORK,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    defaultAsset: BASE_SEPOLIA_USDC,
    creditContractEnv: "C402_BASE_SEPOLIA_CREDIT_CONTRACT",
    moduleEnv: "C402_BASE_SEPOLIA_SAFE_SESSION_MODULE_CONTRACT",
    proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0xfb1bffC9d739B8D520DaF37dF666da4C687191EA"
  },
  [COSTON2_NETWORK]: {
    chainId: 114,
    network: COSTON2_NETWORK,
    name: "Flare Coston2",
    rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    defaultAsset: COSTON2_TEST_USDT0,
    creditContractEnv: "C402_COSTON2_CREDIT_CONTRACT",
    moduleEnv: "C402_COSTON2_SAFE_SESSION_MODULE_CONTRACT",
    proxyFactory: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
    singleton: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E"
  }
};
const computeEnabled = env("C402_ENABLE_COMPUTE") === "true";
const service = computeEnabled ? createConfidentialPaymentService() : undefined;
const lenderActionTtlSeconds = optionalEnvInteger("C402_LENDER_ACTION_TTL_SECONDS");
const credit = new AgentCreditService({
  endpoint: env("C402_CREDIT_ENDPOINT") ?? env("C402_PUBLIC_URL"),
  network: env("C402_NETWORK"),
  asset: defaultCreditAsset(),
  lenderActionTtlMs: lenderActionTtlSeconds ? lenderActionTtlSeconds * 1000 : undefined
});
if (service) await service.warmup();

export default async function apiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (await handleFlareFacilitator(req, res, url.pathname)) return;

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, service: "c402-api" });
    }
    if (req.method === "GET" && url.pathname === "/") {
      return sendHtml(res, 200, isDocsHost(req) ? renderDocs("/docs") : renderLanding(publicBaseUrl(req)));
    }
    if (req.method === "GET" && (url.pathname === "/docs" || url.pathname.startsWith("/docs/"))) {
      return sendHtml(res, 200, renderDocs(url.pathname.replace(/\/$/, "")));
    }
    if (req.method === "GET" && (url.pathname === "/llms.txt" || url.pathname === "/docs/llms.txt")) {
      return sendText(res, 200, renderLlmsTxt(publicBaseUrl(req)));
    }
    if (req.method === "GET" && (url.pathname === "/.well-known/c402.json" || url.pathname === "/v1/services/catalog")) {
      return sendJson(res, 200, serviceCatalog(publicBaseUrl(req)));
    }
    if (req.method === "GET" && url.pathname === "/openapi.json") {
      return sendJson(res, 200, openApi(publicBaseUrl(req)));
    }
    if (req.method === "GET" && url.pathname === "/attestation") {
      if (!service) return sendComputeDisabled(res);
      return sendJson(res, 200, await service.attestation());
    }
    if (req.method === "GET" && url.pathname === "/requests") {
      return sendJson(res, 200, { requests: service?.store.list() ?? [] });
    }
    if (req.method === "GET" && url.pathname === "/credit/state") {
      return sendJson(res, 200, credit.state());
    }
    if (req.method === "GET" && url.pathname === "/lenders") {
      return sendJson(res, 200, { lenders: credit.state().lenders });
    }
    if (req.method === "GET" && url.pathname === "/lenders/wallets") {
      return sendJson(res, 200, { wallets: await lenderWalletSummaries() });
    }
    if (req.method === "POST" && url.pathname === "/lenders/register") {
      return sendJson(res, 201, await registerLender(await readJson(req)));
    }
    if (req.method === "GET" && url.pathname.startsWith("/lenders/") && url.pathname.endsWith("/actions")) {
      const lender = decodeURIComponent(url.pathname.slice("/lenders/".length, -"/actions".length));
      const queue = credit.lenderFundingActions(lender);
      return sendJson(res, 200, {
        lender: queue.lender,
        actions: queue.actions.map(withFundingTransaction)
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/lenders/") && url.pathname.endsWith("/wallet")) {
      const lender = decodeURIComponent(url.pathname.slice("/lenders/".length, -"/wallet".length));
      return sendJson(res, 200, await lenderWalletSummary(lender));
    }
    if (req.method === "POST" && url.pathname === "/credit/jobs") {
      return sendJson(res, 201, credit.createFundedJob(asFundedJobInput(await readJson(req))));
    }
    if (req.method === "GET" && url.pathname === "/credit/backing-sources") {
      return sendJson(res, 200, { backingSources: credit.state().backingSources });
    }
    if (req.method === "POST" && url.pathname === "/credit/backing-sources") {
      return sendJson(res, 201, credit.registerBackingSource(asBackingSourceInput(await readJson(req))));
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/jobs/") && url.pathname.endsWith("/collateral")) {
      const jobId = decodeURIComponent(url.pathname.slice("/credit/jobs/".length, -"/collateral".length));
      const body = await readJson(req);
      return sendJson(res, 201, credit.depositCollateral({
        jobId,
        pledgor: requiredString(body, "pledgor"),
        amountAtomic: requiredString(body, "amountAtomic")
      }));
    }
    if (req.method === "POST" && url.pathname === "/credit/request") {
      return sendJson(res, 200, credit.requestCredit(asCreditRequestInput(await readJson(req))));
    }
    if (req.method === "POST" && url.pathname === "/credit/match") {
      const body = await readJson(req);
      return sendJson(res, 200, await matchCreditWithFundingCheck(requiredString(body, "offerId")));
    }
    if (req.method === "POST" && url.pathname === "/credit/dispatch") {
      return sendJson(res, 200, { dispatched: await dispatchCreditWithFundingCheck() });
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/offers/") && url.pathname.endsWith("/supplier-payment")) {
      const offerId = decodeURIComponent(url.pathname.slice("/credit/offers/".length, -"/supplier-payment".length));
      const body = await readJson(req);
      return sendJson(res, 200, credit.recordDirectSupplierPayment({
        offerId,
        lender: requiredString(body, "lender"),
        supplierPaymentId: requiredString(body, "supplierPaymentId")
      }));
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/jobs/") && url.pathname.endsWith("/complete")) {
      const jobId = decodeURIComponent(url.pathname.slice("/credit/jobs/".length, -"/complete".length));
      const body = await readJson(req);
      return sendJson(res, 200, credit.completeJob(jobId, String(body.advanceId)));
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/advances/") && url.pathname.endsWith("/repay")) {
      const advanceId = decodeURIComponent(url.pathname.slice("/credit/advances/".length, -"/repay".length));
      const body = await readJson(req);
      return sendJson(res, 200, credit.repayAdvance({
        advanceId,
        repaymentSource: requiredString(body, "repaymentSource"),
        grossRevenueAtomic: requiredString(body, "grossRevenueAtomic")
      }));
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/jobs/") && url.pathname.endsWith("/fail")) {
      const jobId = decodeURIComponent(url.pathname.slice("/credit/jobs/".length, -"/fail".length));
      const body = await readJson(req);
      return sendJson(res, 200, credit.failJob(jobId, typeof body.advanceId === "string" ? body.advanceId : undefined));
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/advances/") && url.pathname.endsWith("/liquidate")) {
      const advanceId = decodeURIComponent(url.pathname.slice("/credit/advances/".length, -"/liquidate".length));
      const body = await readJson(req);
      return sendJson(res, 200, credit.liquidateAdvance(advanceId, typeof body.reason === "string" ? body.reason : undefined));
    }
    if (req.method === "GET" && url.pathname.startsWith("/receipts/")) {
      if (!service) return sendComputeDisabled(res);
      const requestId = decodeURIComponent(url.pathname.slice("/receipts/".length));
      const record = service.store.get(requestId);
      return record ? sendJson(res, 200, record) : sendJson(res, 404, { error: "not_found" });
    }
    if (req.method === "POST" && url.pathname === "/credit-score") {
      if (!service) return sendComputeDisabled(res);
      await drain(req);
      if (!req.headers["compute-payload"] || !req.headers["payment-signature"]) {
        const quote = await service.quote();
        return sendJson(res, quote.status, quote.body, quote.headers);
      }

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
      }
      const success = await service.execute(headers);
      return sendJson(res, success.status, success.body, success.headers);
    }

    return sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    const requestId = extractRequestId(req);
    service?.fail(requestId, error);
    const status = error instanceof C402Error ? error.status : 500;
    return sendJson(res, status, {
      error: error instanceof C402Error ? error.code : "internal_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

const port = Number(process.env.PORT ?? 4021);
const host = process.env.HOST ?? "127.0.0.1";
if (process.env.VERCEL !== "1") {
  const server = createServer(apiHandler);
  server.listen(port, host, () => {
    console.log(`c402 API listening at http://127.0.0.1:${port}`);
    console.log(`confidential compute ${computeEnabled ? "enabled" : "disabled"}; credit endpoints are available`);
  });
}

function createConfidentialPaymentService(): ConfidentialPaymentService {
  const fcc = createFccAdapterFromEnv(process.env);
  return new ConfidentialPaymentService(createConfigFromEnv(process.env, fcc));
}

function sendComputeDisabled(res: ServerResponse): void {
  sendJson(res, 503, {
    error: "compute_disabled",
    message: "Confidential compute is disabled. Set C402_ENABLE_COMPUTE=true and configure C402_FCC_MODE to enable /credit-score."
  });
}

function publicBaseUrl(req: IncomingMessage): string {
  return env("C402_PUBLIC_URL") ?? `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost"}`;
}

function isDocsHost(req: IncomingMessage): boolean {
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").toLowerCase();
  return host.startsWith("docs.");
}

function serviceCatalog(baseUrl: string): Record<string, unknown> {
  return {
    protocol: "c402",
    name: "c402 Credit",
      description: "Agents borrow to pay suppliers. Lenders are repaid from revenue.",
    baseUrl,
    status: {
      credit: "available",
      confidentialCompute: computeEnabled ? "available" : "disabled_until_fcc_proxy_registered"
    },
    testnet: {
      creditContract: baseSepoliaCreditContract(),
      creditNetwork: env("C402_CREDIT_NETWORK") ?? "eip155:84532",
      x402Network: env("C402_NETWORK") ?? "eip155:84532",
      x402Asset: env("C402_ASSET") ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: env("C402_PAY_TO") ?? "0x21b805BBC4bfFA7769868BF7f488D77b71756d3E",
      erc8004AgentId: env("ERC8004_AGENT_ID") ?? "8681"
    },
    supportedNetworks: supportedNetworks(baseUrl),
    endpoints: [
      {
        method: "POST",
        path: "/credit/jobs",
        price: "free",
        purpose: "Create a job that can repay credit."
      },
      {
        method: "POST",
        path: "/credit/backing-sources",
        price: "free",
        purpose: "Register a non-job repayment source."
      },
      {
        method: "POST",
        path: "/credit/request",
        price: "free",
        purpose: "Request money to pay a supplier."
      },
      {
        method: "POST",
        path: "/lenders/register",
        price: "free",
        purpose: "Register a lender and receive a session key."
      },
      {
        method: "GET",
        path: "/lenders/wallets",
        price: "free",
        purpose: "List lender wallets and balances."
      },
      {
        method: "GET",
        path: "/lenders/{lender}/wallet",
        price: "free",
        purpose: "Inspect one lender wallet."
      },
      {
        method: "GET",
        path: "/lenders/{lender}/actions",
        price: "free",
        purpose: "List supplier payments waiting for the lender."
      },
      {
        method: "POST",
        path: "/credit/match",
        price: "free",
        purpose: "Match a request to an eligible lender."
      },
      {
        method: "POST",
        path: "/credit/dispatch",
        price: "free",
        purpose: "Retry missed lender matches."
      },
      {
        method: "POST",
        path: "/credit/jobs/{jobId}/collateral",
        price: "free",
        purpose: "Lock collateral for a job."
      },
      {
        method: "POST",
        path: "/credit/offers/{offerId}/supplier-payment",
        price: "free",
        purpose: "Record the supplier payment."
      },
      {
        method: "POST",
        path: "/credit/jobs/{jobId}/complete",
        price: "free",
        purpose: "Complete the job and repay the lender."
      },
      {
        method: "POST",
        path: "/credit/advances/{advanceId}/repay",
        price: "free",
        purpose: "Repay an active advance."
      },
      {
        method: "POST",
        path: "/credit/advances/{advanceId}/liquidate",
        price: "free",
        purpose: "Recover funds after default."
      },
      {
        method: "POST",
        path: "/credit-score",
        price: env("C402_PRICE_USD") ?? "0.10",
        payment: "x402",
        enabled: computeEnabled,
        purpose: "Score credit privately when FCC is enabled."
      }
    ]
  };
}

function supportedNetworks(baseUrl: string): Array<Record<string, unknown>> {
  return [
    {
      chainId: 84532,
      network: "eip155:84532",
      name: "Base Sepolia",
      role: "primary-testnet",
      rpcUrl: "https://sepolia.base.org",
      creditContract: baseSepoliaCreditContract(),
      creditContractStatus: baseSepoliaCreditContract() ? "deployed" : "deployment_required",
      x402: {
        asset: env("C402_ASSET") ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        assetSymbol: "USDC",
        assetDecimals: 6,
        facilitatorUrl: env("X402_FACILITATOR_URL") ?? "https://x402.org/facilitator",
        payTo: env("C402_PAY_TO") ?? "0x21b805BBC4bfFA7769868BF7f488D77b71756d3E"
      },
      erc8004: {
        identityRegistry: env("ERC8004_IDENTITY_REGISTRY") ?? "0x8004A818BFB912233c491871b3d84c89A494BD9e",
        reputationRegistry: env("ERC8004_REPUTATION_REGISTRY") ?? "0x8004B663056A597Dffe9eCcC1965A193B7388713",
        writer: env("ERC8004_WRITER") ?? "0x319C508cb5b4ffd0e04b628e21B1399a4413C4e7",
        agentId: env("ERC8004_AGENT_ID") ?? "8681"
      }
    },
    {
      chainId: 114,
      network: "eip155:114",
      name: "Flare Coston2",
      role: "credit-and-confidential-compute-testnet",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
      creditContract: creditContractForNetwork(COSTON2_NETWORK),
      creditContractStatus: creditContractForNetwork(COSTON2_NETWORK) ? "deployed" : "deployment_required",
      x402: {
        status: flareX402FacilitatorConfigured(process.env) ? "active" : "facilitator_key_required",
        network: flareX402Network(process.env),
        asset: flareX402Asset(process.env),
        assetSymbol: "testUSDT0",
        assetDecimals: 6,
        assetTransferMethod: "permit2",
        facilitatorUrl: flareX402FacilitatorUrl(process.env, baseUrl),
        payTo: env("C402_PAY_TO") ?? "0x21b805BBC4bfFA7769868BF7f488D77b71756d3E"
      },
      confidentialCompute: {
        enabled: computeEnabled,
        proxyUrlConfigured: Boolean(env("C402_FCC_PROXY_URL")),
        extensionId: env("C402_FCC_EXTENSION_ID") ?? ""
      }
    }
  ];
}

function baseSepoliaCreditContract(): string {
  return creditContractForNetwork(BASE_SEPOLIA_NETWORK);
}

function openApi(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "c402 Credit API",
      version: "0.1.0",
      description: "Receivable-backed credit endpoints for AI agents. FCC compute is optional."
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/.well-known/c402.json": {
        get: { summary: "Machine-readable c402 service catalog", responses: { "200": { description: "Catalog" } } }
      },
      "/credit/state": {
        get: { summary: "Inspect credit state", responses: { "200": { description: "Credit state" } } }
      },
      "/credit/jobs": {
        post: { summary: "Create a funded job", responses: { "201": { description: "Funded job" } } }
      },
      "/credit/backing-sources": {
        get: { summary: "List verified non-job backing sources", responses: { "200": { description: "Backing sources" } } },
        post: { summary: "Register a verified asset, subscription, or earnings backing source", responses: { "201": { description: "Backing source" } } }
      },
      "/credit/request": {
        post: { summary: "Request credit", responses: { "200": { description: "Underwriting decision and optional offer" } } }
      },
      "/credit/jobs/{jobId}/collateral": {
        post: { summary: "Post collateral for a receivable", responses: { "201": { description: "Collateral position" } } }
      },
      "/lenders": {
        get: { summary: "List active lender agents", responses: { "200": { description: "Lender profiles" } } }
      },
      "/lenders/register": {
        post: { summary: "Register lender agent profile", responses: { "201": { description: "Lender profile" } } }
      },
      "/lenders/wallets": {
        get: { summary: "List registered lender wallets", responses: { "200": { description: "Wallet balances and activity" } } }
      },
      "/lenders/{lender}/wallet": {
        get: { summary: "Inspect one lender wallet", responses: { "200": { description: "Wallet balance and activity" } } }
      },
      "/lenders/{lender}/actions": {
        get: { summary: "List pending lender wallet funding actions", responses: { "200": { description: "Pending funding actions with transaction data" } } }
      },
      "/credit/match": {
        post: { summary: "Match offer to lender agent", responses: { "200": { description: "Selected lender match" } } }
      },
      "/credit/dispatch": {
        post: { summary: "Expire stale matches and dispatch pending credit offers", responses: { "200": { description: "Dispatch results" } } }
      },
      "/credit/offers/{offerId}/supplier-payment": {
        post: { summary: "Record lender-to-supplier payment", responses: { "200": { description: "Supplier advance" } } }
      },
      "/credit/jobs/{jobId}/complete": {
        post: { summary: "Complete and repay a job", responses: { "200": { description: "Repayment receipt" } } }
      },
      "/credit/advances/{advanceId}/repay": {
        post: { summary: "Repay a non-job or generic advance", responses: { "200": { description: "Repayment receipt" } } }
      },
      "/credit/jobs/{jobId}/fail": {
        post: { summary: "Fail a job and suspend credit", responses: { "200": { description: "Passport event" } } }
      },
      "/credit/advances/{advanceId}/liquidate": {
        post: { summary: "Liquidate collateral", responses: { "200": { description: "Liquidation receipt" } } }
      },
      "/credit-score": {
        post: { summary: "Optional x402/c402 confidential compute endpoint", responses: { "200": { description: "Encrypted result" }, "402": { description: "Payment required" }, "503": { description: "Compute disabled" } } }
      }
    }
  };
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function defaultCreditAsset(): string {
  return normalizeAsset(env("C402_ASSET") ?? creditNetworkConfig(activeCreditNetwork()).defaultAsset);
}

function normalizeAsset(asset: string): string {
  const value = asset.trim();
  const lower = value.toLowerCase();
  if (lower === "usdc" || lower === "base-sepolia-usdc") return BASE_SEPOLIA_USDC;
  if (lower === "usdt0" || lower === "flare-usdt0" || lower === "coston2-usdt0") return COSTON2_TEST_USDT0;
  if (lower === "eth" || lower === "native" || lower === "base-sepolia-eth") return NATIVE_ASSET;
  if (isAddress(value)) return value;
  throw new C402Error("invalid_asset", `unsupported asset ${asset}`, 400);
}

function activeCreditNetwork(): string {
  return normalizeNetworkValue(env("C402_CREDIT_NETWORK") ?? BASE_SEPOLIA_NETWORK);
}

function normalizeNetworkValue(network: string): string {
  const value = network.trim().toLowerCase();
  if (value === "base-sepolia" || value === "base_sepolia") return BASE_SEPOLIA_NETWORK;
  if (value === "flare-testnet" || value === "flare-coston2" || value === "coston2") return COSTON2_NETWORK;
  return value;
}

function creditNetworkConfig(network: string): CreditNetworkConfig {
  const config = CREDIT_NETWORK_CONFIG[normalizeNetworkValue(network)];
  if (!config) throw new C402Error("unsupported_network", `unsupported credit network ${network}`, 400);
  return config;
}

function creditContractForNetwork(network: string): string {
  const config = creditNetworkConfig(network);
  return env(config.creditContractEnv) ?? (config.network === activeCreditNetwork() ? env("C402_CREDIT_CONTRACT") ?? "" : "");
}

function tokenForAsset(asset: string): string {
  return asset === NATIVE_ASSET ? "0x0000000000000000000000000000000000000000" : asset;
}

function optionalEnvInteger(name: string): number | undefined {
  const value = env(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

async function registerLender(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const recoveryKey = createRecoveryKey();
  const lenderNetworks = optionalStringArray(body, "networks")?.map(normalizeNetwork) ?? [activeCreditNetwork()];
  const sessionKey = createTestnetLenderSessionKey(lenderNetworks[0]);
  const safeAddresses = body.safeAddresses && typeof body.safeAddresses === "object" && !Array.isArray(body.safeAddresses)
    ? body.safeAddresses as Record<string, unknown>
    : {};
  const safeAccounts = lenderNetworks.map((network) => createSafeAccountPlan({
    safeAddress: typeof safeAddresses[network] === "string" ? safeAddresses[network] as string : typeof body.safeAddress === "string" ? body.safeAddress : undefined,
    recoveryOwner: recoveryKey.address,
    sessionSigner: sessionKey.address,
    asset: normalizeAsset(assetForNetworkInput(body, network)),
    network,
    spendLimitAtomic: requiredString(body, "availableLiquidityAtomic"),
    maxDurationSeconds: optionalNumber(body, "maxDurationSeconds") ?? 86_400
  }));
  const safeAccount = safeAccounts[0];
  const allReady = safeAccounts.every((account) => account.status === "ready");
  const lender = credit.registerLender(asLenderProfileInput({
    ...body,
    asset: typeof body.asset === "string" ? body.asset : creditNetworkConfig(lenderNetworks[0]).defaultAsset,
    assets: parseNetworkAssets(body),
    networks: lenderNetworks,
    agent: safeAccount.address ?? sessionKey.address,
    status: allReady ? "active" : "paused"
  }));
  return {
    registrationStatus: allReady ? "active" : "setup_required",
    lender,
    recoveryKey,
    sessionKey: {
      ...sessionKey,
      policy: lenderSessionPolicy(lender, safeAccount)
    },
    wallet: {
      address: sessionKey.address,
      privateKey: sessionKey.privateKey,
      deprecated: "Use sessionKey. wallet is kept only for older clients."
    },
    safeAccount,
    safeAccounts,
    warning: "Keys are returned once and are not stored. Submit each Safe setup bundle before funding it."
  };
}

function createRecoveryKey(): { address: string; privateKey: Hex; keyType: string; custody: string } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
    keyType: "lender-recovery-owner",
    custody: "client-controlled"
  };
}

function createTestnetLenderSessionKey(network = activeCreditNetwork()): { address: string; privateKey: Hex; custody: string; network: string; fundWith: string; keyType: string } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
    custody: "session-key",
    network,
    fundWith: "Fund with only the amount this lender session is allowed to deploy.",
    keyType: "lender-session-key"
  };
}

function createSafeAccountPlan(input: {
  safeAddress?: string;
  recoveryOwner: string;
  sessionSigner: string;
  asset: string;
  network: string;
  spendLimitAtomic: string;
  maxDurationSeconds: number;
}): Record<string, unknown> & { address?: string } {
  const network = creditNetworkConfig(input.network);
  const module = env(network.moduleEnv) ?? (network.network === activeCreditNetwork() ? env("C402_SAFE_SESSION_MODULE_CONTRACT") : undefined);
  const creditContract = creditContractForNetwork(network.network);
  const safeProxyFactory = env(`${network.network === COSTON2_NETWORK ? "C402_COSTON2" : "C402_BASE_SEPOLIA"}_SAFE_PROXY_FACTORY`) ?? (network.network === activeCreditNetwork() ? env("C402_SAFE_PROXY_FACTORY") : undefined) ?? network.proxyFactory;
  const safeSingleton = env(`${network.network === COSTON2_NETWORK ? "C402_COSTON2" : "C402_BASE_SEPOLIA"}_SAFE_SINGLETON`) ?? (network.network === activeCreditNetwork() ? env("C402_SAFE_SINGLETON") : undefined) ?? network.singleton;
  const expiresAt = Math.floor(Date.now() / 1000) + input.maxDurationSeconds;
  const safeSaltNonce = BigInt(Date.now());
  const moduleAbi = [{
    type: "function",
    name: "configureSession",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionSigner", type: "address" },
      { name: "creditContract", type: "address" },
      { name: "token", type: "address" },
      { name: "spendLimit", type: "uint256" },
      { name: "expiresAt", type: "uint256" }
    ],
    outputs: []
  }] as const;
  const safeAbi = [{
    type: "function",
    name: "enableModule",
    stateMutability: "nonpayable",
    inputs: [{ name: "module", type: "address" }],
    outputs: []
  }] as const;
  const safeFactoryAbi = [{
    type: "function",
    name: "createProxyWithNonce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_singleton", type: "address" },
      { name: "initializer", type: "bytes" },
      { name: "saltNonce", type: "uint256" }
    ],
    outputs: [{ name: "proxy", type: "address" }]
  }] as const;
  const safeSetupAbi = [{
    type: "function",
    name: "setup",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owners", type: "address[]" },
      { name: "_threshold", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
      { name: "fallbackHandler", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" }
    ],
    outputs: []
  }] as const;

  if (!module || !creditContract) {
    return {
      status: "module_not_configured",
      network: network.network,
      module: module ?? "",
      creditContract,
      recoveryOwner: input.recoveryOwner,
      address: input.safeAddress,
      sessionSigner: input.sessionSigner,
      token: tokenForAsset(input.asset),
      spendLimitAtomic: input.spendLimitAtomic,
      expiresAt,
      note: `Safe session module is not configured for ${network.name}.`
    };
  }

  const setupTransactions: Record<string, unknown>[] = [];
  if (!input.safeAddress) {
    if (!safeProxyFactory || !safeSingleton) {
      return {
        status: "safe_factory_not_configured",
        network: network.network,
        module,
        creditContract,
        safeProxyFactory: safeProxyFactory ?? "",
        safeSingleton: safeSingleton ?? "",
        sessionSigner: input.sessionSigner,
        token: tokenForAsset(input.asset),
        spendLimitAtomic: input.spendLimitAtomic,
        expiresAt,
        note: `Safe deployment addresses are not configured for ${network.name}.`
      };
    }
    const initializer = encodeFunctionData({
      abi: safeSetupAbi,
      functionName: "setup",
      args: [[input.recoveryOwner as Hex], 1n, "0x0000000000000000000000000000000000000000", "0x", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 0n, "0x0000000000000000000000000000000000000000"]
    });
    setupTransactions.push({
      chainId: network.chainId,
      network: network.network,
      sponsor: "lender-agent",
      to: safeProxyFactory,
      value: "0",
      functionName: "createProxyWithNonce",
      args: [safeSingleton, initializer, String(safeSaltNonce)],
      data: encodeFunctionData({
        abi: safeFactoryAbi,
        functionName: "createProxyWithNonce",
        args: [safeSingleton as Hex, initializer, safeSaltNonce]
      }),
      note: "The lender agent signs and pays gas for this direct deployment transaction. The deployed Safe owner is the recovery owner, not the session signer."
    });
  }

  const safeAddress = input.safeAddress ?? "<safe-address-from-createProxyWithNonce>";
  setupTransactions.push(
    {
      chainId: network.chainId,
      network: network.network,
      sponsor: "safe-owner",
      executor: "safe-transaction",
      to: safeAddress,
      value: "0",
      functionName: "enableModule",
      args: [module],
      data: encodeFunctionData({
        abi: safeAbi,
        functionName: "enableModule",
        args: [module as Hex]
      })
    },
    {
      chainId: network.chainId,
      network: network.network,
      sponsor: "safe-owner",
      executor: "safe-transaction",
      to: module,
      value: "0",
      functionName: "configureSession",
      args: [input.sessionSigner, creditContract, tokenForAsset(input.asset), input.spendLimitAtomic, String(expiresAt)],
      data: encodeFunctionData({
        abi: moduleAbi,
        functionName: "configureSession",
        args: [input.sessionSigner as Hex, creditContract as Hex, tokenForAsset(input.asset) as Hex, BigInt(input.spendLimitAtomic), BigInt(expiresAt)]
      })
    }
  );

  return {
    status: input.safeAddress ? "ready" : "safe_required",
    network: network.network,
    address: input.safeAddress,
    module,
    creditContract,
    recoveryOwner: input.recoveryOwner,
    sessionSigner: input.sessionSigner,
    spendLimitAtomic: input.spendLimitAtomic,
    expiresAt,
    setupTransactions,
    note: input.safeAddress
      ? `Submit the setup transactions on ${network.name}. The session signer can then call only c402 supplier payments.`
      : `The lender agent submits Safe deployment and pays gas. Then the Safe owner enables and configures the c402 module on ${network.name}.`
  };
}

function lenderSessionPolicy(lender: ReturnType<AgentCreditService["registerLender"]>, safeAccount: Record<string, unknown>): Record<string, unknown> {
  return {
    version: "c402-session-policy-v1",
    holder: lender.agent,
    networks: lender.networks,
    asset: lender.asset,
    assets: lender.assets,
    maxAvailableLiquidityAtomic: lender.availableLiquidityAtomic,
    maxFeeBps: lender.minFeeBps,
    maxDurationSeconds: lender.maxDurationSeconds,
    acceptedRiskBands: lender.acceptedRiskBands,
    allowedActions: [
      {
        contract: typeof safeAccount.creditContract === "string" ? safeAccount.creditContract : "",
        functionName: lender.asset === NATIVE_ASSET ? "paySupplier" : "paySupplierToken",
        selectorScope: "c402-credit-intent-only"
      }
    ],
    enforcement: safeAccount.status === "ready" ? "safe-module" : "safe-module-pending",
    custody: "Safe module enforced; lender funds remain in the Safe."
  };
}

async function lenderWalletSummaries(): Promise<Record<string, unknown>[]> {
  return Promise.all(credit.state().lenders.map((lender) => lenderWalletSummary(lender.agent)));
}

async function lenderWalletSummary(lenderAgent: string): Promise<Record<string, unknown>> {
  const queue = credit.lenderFundingActions(lenderAgent);
  const state = credit.state();
  const address = queue.lender.agent;
  const lenderNetwork = networkForLender(address);
  const nativeBalanceAtomic = await nativeBalance(address, lenderNetwork);
  const advances = state.advances.filter((advance) => typeof advance.lender === "string" && sameAddress(advance.lender, address));
  return {
    address,
    network: lenderNetwork,
    nativeBalanceAtomic,
    nativeBalanceStatus: nativeBalanceAtomic === undefined ? "unavailable" : "available",
    lender: queue.lender,
    receivable: state.directLenderReceivables.find((item) => sameAddress(item.lender, address)) ?? { lender: address, amountAtomic: "0" },
    shortfall: state.lenderShortfalls.find((item) => sameAddress(item.lender, address)) ?? { lender: address, amountAtomic: "0" },
    pendingActions: queue.actions.map(withFundingTransaction),
    transactions: advances.map((advance) => ({
      type: "supplier-payment",
      offerId: advance.offerId,
      advanceId: advance.advanceId,
      supplier: advance.supplier,
      amountAtomic: advance.amountAtomic,
      feeAtomic: advance.feeAtomic,
      status: advance.status,
      supplierPaymentId: advance.supplierPaymentId,
      paidAt: advance.paidAt
    }))
  };
}

async function matchCreditWithFundingCheck(offerId: string): Promise<Record<string, unknown>> {
  const skipped: Array<{ lender: string; matchId: string; observedBalanceAtomic: string; requiredAtomic: string }> = [];
  for (;;) {
    const result = credit.matchCredit(offerId);
    if (!result.match) return { ...result, fundingCheck: { status: "no_match", skipped } };
    const check = await lenderHasEnoughBalance(result.match.lenderAgent, result.match.amountAtomic);
    if (check.status === "unavailable") {
      return { ...result, fundingCheck: { status: "unavailable", skipped } };
    }
    if (check.ok) {
      return { ...result, fundingCheck: { status: "sufficient", observedBalanceAtomic: check.balanceAtomic, requiredAtomic: result.match.amountAtomic, skipped } };
    }
    credit.expireMatchForInsufficientBalance(result.match.matchId, check.balanceAtomic);
    skipped.push({
      lender: result.match.lenderAgent,
      matchId: result.match.matchId,
      observedBalanceAtomic: check.balanceAtomic,
      requiredAtomic: result.match.amountAtomic
    });
  }
}

async function dispatchCreditWithFundingCheck(): Promise<Record<string, unknown>[]> {
  const dispatched = credit.dispatchPendingCredit();
  const checked: Record<string, unknown>[] = [];
  for (const item of dispatched) {
    checked.push(item.match ? await matchCreditWithFundingCheck(item.offer.offerId) : { ...item, fundingCheck: { status: "no_match", skipped: [] } });
  }
  return checked;
}

async function lenderHasEnoughBalance(address: string, requiredAtomic: string): Promise<{ status: "available"; ok: boolean; balanceAtomic: string } | { status: "unavailable" }> {
  const network = networkForLender(address);
  const asset = assetForLender(address, network);
  const balanceAtomic = asset === NATIVE_ASSET ? await nativeBalance(address, network) : await erc20Balance(asset, address, network);
  if (balanceAtomic === undefined) return { status: "unavailable" };
  return {
    status: "available",
    ok: BigInt(balanceAtomic) >= BigInt(requiredAtomic),
    balanceAtomic
  };
}

async function nativeBalance(address: string, network = activeCreditNetwork()): Promise<string | undefined> {
  if (!isAddress(address)) return undefined;
  try {
    const client = createPublicClient({ transport: http(creditNetworkConfig(network).rpcUrl) });
    return (await client.getBalance({ address })).toString();
  } catch {
    return undefined;
  }
}

async function erc20Balance(token: string, holder: string, network = activeCreditNetwork()): Promise<string | undefined> {
  if (!isAddress(token) || !isAddress(holder)) return undefined;
  try {
    const client = createPublicClient({ transport: http(creditNetworkConfig(network).rpcUrl) });
    return (await client.readContract({
      address: token as Hex,
      abi: [{
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "balance", type: "uint256" }]
      }],
      functionName: "balanceOf",
      args: [holder as Hex]
    })).toString();
  } catch {
    return undefined;
  }
}

function assetForLender(lenderAgent: string, network = networkForLender(lenderAgent)): string {
  const lender = credit.state().lenders.find((item) => sameAddress(item.agent, lenderAgent));
  return lender?.assets?.[network] ?? lender?.asset ?? defaultCreditAsset();
}

function networkForLender(lenderAgent: string): string {
  return credit.state().lenders.find((lender) => sameAddress(lender.agent, lenderAgent))?.networks[0] ?? activeCreditNetwork();
}

function withFundingTransaction(action: ReturnType<AgentCreditService["lenderFundingActions"]>["actions"][number]): Record<string, unknown> {
  const network = creditNetworkConfig(action.network);
  const contract = creditContractForNetwork(network.network);
  const module = env(network.moduleEnv) ?? (network.network === activeCreditNetwork() ? env("C402_SAFE_SESSION_MODULE_CONTRACT") : undefined);
  const jobIdBytes32 = idToBytes32(action.repaymentSource);
  const advanceIdBytes32 = idToBytes32(action.offerId);
  const isNative = action.asset === NATIVE_ASSET;
  const token = tokenForAsset(action.asset);
  if (contract && module) {
    return {
      ...action,
      transaction: {
        chainId: network.chainId,
        network: network.network,
        to: module,
        value: "0",
        functionName: isNative ? "executePaySupplier" : "executePaySupplierToken",
        args: [action.lender, jobIdBytes32, advanceIdBytes32, action.supplierDomain, action.purpose, action.durationSeconds, action.amountAtomic],
        token,
        valueUnits: isNative ? "native-token-wei" : "erc20-atomic-units",
        abi: [{
          type: "function",
          name: isNative ? "executePaySupplier" : "executePaySupplierToken",
          stateMutability: "nonpayable",
          inputs: [
            { name: "safe", type: "address" },
            { name: "jobId", type: "bytes32" },
            { name: "advanceId", type: "bytes32" },
            { name: "supplierDomain", type: "string" },
            { name: "purpose", type: "string" },
            { name: "durationSeconds", type: "uint256" },
            { name: "amount", type: "uint256" }
          ],
          outputs: []
        }],
        afterSubmit: supplierPaymentCallback(action)
      },
      transactionWarning: "The c402 Safe session module enforces the configured asset, spend limit, expiry, and paySupplier-only route."
    };
  }
  if (!isNative) {
    return {
      ...action,
      transaction: undefined,
      transactionWarning: `Token funding on ${network.name} requires its c402 Safe session module.`
    };
  }
  return {
    ...action,
    transaction: contract ? {
      chainId: network.chainId,
      network: network.network,
      to: contract,
      value: action.amountAtomic,
      valueUnits: "native-token-wei",
      functionName: "paySupplier",
      args: [jobIdBytes32, advanceIdBytes32, action.supplierDomain, action.purpose, action.durationSeconds],
      abi: [{
        type: "function",
        name: "paySupplier",
        stateMutability: "payable",
        inputs: [
          { name: "jobId", type: "bytes32" },
          { name: "advanceId", type: "bytes32" },
          { name: "supplierDomain", type: "string" },
          { name: "purpose", type: "string" },
          { name: "durationSeconds", type: "uint256" }
        ],
        outputs: []
      }],
      idDerivation: {
        jobIdBytes32: `keccak256(utf8:${action.repaymentSource})`,
        advanceIdBytes32: `keccak256(utf8:${action.offerId})`
      },
      afterSubmit: supplierPaymentCallback(action)
    } : undefined,
    transactionWarning: contract
      ? `${network.name} C402CreditIntent debits the network's native test token from the lender Safe.`
      : `C402CreditIntent is not configured for ${network.name}.`
  };
}

function supplierPaymentCallback(action: ReturnType<AgentCreditService["lenderFundingActions"]>["actions"][number]): Record<string, unknown> {
  return {
    method: "POST",
    path: `/credit/offers/${encodeURIComponent(action.offerId)}/supplier-payment`,
    body: {
      lender: action.lender,
      supplierPaymentId: "<transaction-hash>"
    }
  };
}

function idToBytes32(value: string): Hex {
  return keccak256(toBytes(value));
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  setCorsHeaders(res);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  if (!res.hasHeader("content-type")) {
    res.setHeader("content-type", "application/json");
  }
  res.statusCode = status;
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
  setCorsHeaders(res);
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.statusCode = status;
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  setCorsHeaders(res);
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.statusCode = status;
  res.end(body);
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,compute-payload,payment-signature");
  res.setHeader("access-control-expose-headers", "compute-required,payment-required,compute-receipt");
}

async function drain(req: IncomingMessage): Promise<void> {
  for await (const _chunk of req) {
    // Request body is intentionally unused. Private input must arrive encrypted in COMPUTE-PAYLOAD.
  }
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new C402Error("invalid_json_body", "request body must be a JSON object", 400);
  }
  return parsed as Record<string, unknown>;
}

function extractRequestId(req: IncomingMessage): string | undefined {
  const raw = req.headers["compute-payload"];
  if (typeof raw !== "string") return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { requestId?: string };
    return decoded.requestId;
  } catch {
    return undefined;
  }
}

function asFundedJobInput(body: Record<string, unknown>): {
  buyer: string;
  agent: string;
  escrowAmountAtomic: string;
  asset?: string;
  description: string;
} {
  return {
    buyer: requiredString(body, "buyer"),
    agent: requiredString(body, "agent"),
    escrowAmountAtomic: requiredString(body, "escrowAmountAtomic"),
    asset: typeof body.asset === "string" ? body.asset : undefined,
    description: requiredString(body, "description")
  };
}

function asCreditRequestInput(body: Record<string, unknown>): {
  agent: string;
  network?: string;
  asset?: string;
  productType?: CreditProductType;
  amountAtomic: string;
  purpose: Purpose;
  supplier: string;
  supplierDomain: string;
  repaymentSource: string;
  maximumFeeAtomic: string;
  durationSeconds?: number;
} {
  const purpose = requiredString(body, "purpose");
  if (!["compute", "data", "storage", "gas", "approved-x402-service"].includes(purpose)) {
    throw new C402Error("invalid_credit_purpose", "purpose is not supported", 400);
  }
  const productType = typeof body.productType === "string" ? body.productType : "job-backed";
  if (!isCreditProductType(productType)) {
    throw new C402Error("invalid_credit_product", "productType is not supported", 400);
  }
  const durationSeconds = body.durationSeconds;
  return {
    agent: requiredString(body, "agent"),
    network: typeof body.network === "string" ? normalizeNetwork(body.network) : undefined,
    asset: typeof body.asset === "string" ? normalizeAsset(body.asset) : undefined,
    productType,
    amountAtomic: requiredString(body, "amountAtomic"),
    purpose: purpose as Purpose,
    supplier: requiredString(body, "supplier"),
    supplierDomain: requiredString(body, "supplierDomain"),
    repaymentSource: requiredString(body, "repaymentSource"),
    maximumFeeAtomic: requiredString(body, "maximumFeeAtomic"),
    durationSeconds: typeof durationSeconds === "number" ? durationSeconds : undefined
  };
}

function asBackingSourceInput(body: Record<string, unknown>) {
  const productType = requiredString(body, "productType");
  if (!["asset-backed", "subscription-backed", "earnings-backed"].includes(productType)) {
    throw new C402Error("invalid_backing_source_type", "productType must be asset-backed, subscription-backed, or earnings-backed", 400);
  }
  const verifier = typeof body.verifier === "string" ? body.verifier : undefined;
  if (verifier && !["ftso", "fdc", "x402", "operator"].includes(verifier)) {
    throw new C402Error("invalid_verifier", "verifier must be ftso, fdc, x402, or operator", 400);
  }
  return {
    sourceId: typeof body.sourceId === "string" ? body.sourceId : undefined,
    productType: productType as Exclude<CreditProductType, "job-backed">,
    agent: requiredString(body, "agent"),
    asset: typeof body.asset === "string" ? body.asset : undefined,
    network: typeof body.network === "string" ? body.network : undefined,
    valueAtomic: requiredString(body, "valueAtomic"),
    liquidationValueAtomic: typeof body.liquidationValueAtomic === "string" ? body.liquidationValueAtomic : undefined,
    advanceRateBps: optionalNumber(body, "advanceRateBps"),
    verifier: verifier as "ftso" | "fdc" | "x402" | "operator" | undefined,
    evidenceId: requiredString(body, "evidenceId")
  };
}

function asLenderProfileInput(body: Record<string, unknown>) {
  return {
    lenderId: typeof body.lenderId === "string" ? body.lenderId : undefined,
    agent: requiredString(body, "agent"),
    availableLiquidityAtomic: requiredString(body, "availableLiquidityAtomic"),
    asset: typeof body.asset === "string" ? normalizeAsset(body.asset) : defaultCreditAsset(),
    assets: body.assets && typeof body.assets === "object" && !Array.isArray(body.assets) ? body.assets as Record<string, string> : undefined,
    networks: optionalStringArray(body, "networks")?.map(normalizeNetwork),
    minFeeBps: optionalNumber(body, "minFeeBps"),
    maxDurationSeconds: optionalNumber(body, "maxDurationSeconds"),
    acceptedRiskBands: optionalRiskBands(body, "acceptedRiskBands"),
    reputationScore: initialLenderReputation(body),
    status: body.status === "paused" ? "paused" as const : "active" as const
  };
}

function parseNetworkAssets(body: Record<string, unknown>): Record<string, string> | undefined {
  const value = body.assets;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new C402Error("invalid_json_body", "assets must be an object keyed by network", 400);
  }
  return Object.fromEntries(Object.entries(value).map(([network, asset]) => {
    if (typeof asset !== "string") throw new C402Error("invalid_asset", `assets.${network} must be a string`, 400);
    return [normalizeNetwork(network), normalizeAsset(asset)];
  }));
}

function assetForNetworkInput(body: Record<string, unknown>, network: string): string {
  const assets = parseNetworkAssets(body);
  return assets?.[network] ?? (typeof body.asset === "string" ? body.asset : creditNetworkConfig(network).defaultAsset);
}

function initialLenderReputation(body: Record<string, unknown>): number {
  const agentRef = body.agentRef;
  if (agentRef && typeof agentRef === "object") return 60;
  return 50;
}

function normalizeNetwork(network: string): string {
  const value = network.trim().toLowerCase();
  if (value === "base-sepolia" || value === "base_sepolia") return "eip155:84532";
  if (value === "flare-testnet" || value === "flare-coston2" || value === "coston2") return "eip155:114";
  if (/^eip155:\d+$/.test(value)) return value;
  throw new C402Error("invalid_network", `unsupported network ${network}`, 400);
}

function optionalStringArray(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new C402Error("invalid_json_body", `${field} must be an array of non-empty strings`, 400);
  }
  return value;
}

function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new C402Error("invalid_json_body", `${field} must be an integer`, 400);
  }
  return value;
}

function optionalPurposes(body: Record<string, unknown>, field: string): Purpose[] | undefined {
  const values = optionalStringArray(body, field);
  if (!values) return undefined;
  for (const value of values) {
    if (!["compute", "data", "storage", "gas", "approved-x402-service"].includes(value)) {
      throw new C402Error("invalid_credit_purpose", `${field} contains an unsupported purpose`, 400);
    }
  }
  return values as Purpose[];
}

function optionalRiskBands(body: Record<string, unknown>, field: string): Array<"A" | "B" | "C" | "D"> | undefined {
  const values = optionalStringArray(body, field);
  if (!values) return undefined;
  for (const value of values) {
    if (!["A", "B", "C", "D"].includes(value)) {
      throw new C402Error("invalid_risk_band", `${field} contains an unsupported risk band`, 400);
    }
  }
  return values as Array<"A" | "B" | "C" | "D">;
}

function isCreditProductType(value: string): value is CreditProductType {
  return ["job-backed", "asset-backed", "subscription-backed", "earnings-backed"].includes(value);
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new C402Error("invalid_json_body", `${field} is required`, 400);
  }
  return value;
}
