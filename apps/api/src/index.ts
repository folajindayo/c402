import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { C402Error, type CreditProductType, type Purpose } from "@c402/protocol";
import { createFccAdapterFromEnv } from "@c402/fcc-adapter";
import { AgentCreditService, ConfidentialPaymentService, createConfigFromEnv } from "@c402/server";
import { createPublicClient, http, isAddress, keccak256, toBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  flareX402Asset,
  flareX402FacilitatorConfigured,
  flareX402FacilitatorUrl,
  flareX402Network,
  handleFlareFacilitator
} from "./flare-facilitator.js";
import { renderDocs, renderLanding, renderLlmsTxt } from "./site.js";

const computeEnabled = env("C402_ENABLE_COMPUTE") === "true";
const service = computeEnabled ? createConfidentialPaymentService() : undefined;
const lenderActionTtlSeconds = optionalEnvInteger("C402_LENDER_ACTION_TTL_SECONDS");
const credit = new AgentCreditService({
  endpoint: env("C402_CREDIT_ENDPOINT") ?? env("C402_PUBLIC_URL"),
  network: env("C402_NETWORK"),
  asset: env("C402_ASSET"),
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
      return sendJson(res, 201, registerLender(await readJson(req)));
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
      return sendJson(res, 200, credit.matchCredit(requiredString(body, "offerId")));
    }
    if (req.method === "POST" && url.pathname === "/credit/dispatch") {
      return sendJson(res, 200, { dispatched: credit.dispatchPendingCredit() });
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
    description: "Receivable-backed, purpose-bound credit for AI agents with automatic repayment from funded jobs.",
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
        purpose: "Create a funded receivable for an agent job."
      },
      {
        method: "POST",
        path: "/credit/backing-sources",
        price: "free",
        purpose: "Register verified asset, subscription, or earnings backing plus hard liquidation value for non-job credit."
      },
      {
        method: "POST",
        path: "/credit/request",
        price: "free",
        purpose: "Request a purpose-bound advance against a job, asset, subscription, or earnings backing source."
      },
      {
        method: "POST",
        path: "/lenders/register",
        price: "free",
        purpose: "Register a lender and create its c402-managed testnet lender wallet. The private key is returned once."
      },
      {
        method: "GET",
        path: "/lenders/wallets",
        price: "free",
        purpose: "List registered lender wallets, balances, receivables, and pending supplier-payment actions."
      },
      {
        method: "GET",
        path: "/lenders/{lender}/wallet",
        price: "free",
        purpose: "Inspect one lender wallet balance, receivables, shortfalls, advances, and pending actions."
      },
      {
        method: "GET",
        path: "/lenders/{lender}/actions",
        price: "free",
        purpose: "List pending supplier-payment transactions for a funded lender agent wallet."
      },
      {
        method: "POST",
        path: "/credit/match",
        price: "free",
        purpose: "Match an approved credit offer to the best eligible lender agent."
      },
      {
        method: "POST",
        path: "/credit/dispatch",
        price: "free",
        purpose: "Expire missed lender leases and rematch pending offers to the next eligible lender."
      },
      {
        method: "POST",
        path: "/credit/jobs/{jobId}/collateral",
        price: "free",
        purpose: "Post borrower or sponsor collateral that can be liquidated if repayment terms are broken."
      },
      {
        method: "POST",
        path: "/credit/offers/{offerId}/supplier-payment",
        price: "free",
        purpose: "Record a lender-to-supplier x402 payment before repayment is claimed from the receivable."
      },
      {
        method: "POST",
        path: "/credit/jobs/{jobId}/complete",
        price: "free",
        purpose: "Complete a job and route repayment before agent proceeds."
      },
      {
        method: "POST",
        path: "/credit/advances/{advanceId}/repay",
        price: "free",
        purpose: "Repay any active credit advance from its pledged backing source."
      },
      {
        method: "POST",
        path: "/credit/advances/{advanceId}/liquidate",
        price: "free",
        purpose: "Liquidate locked collateral and reserve after missed deadline or default."
      },
      {
        method: "POST",
        path: "/credit-score",
        price: env("C402_PRICE_USD") ?? "0.10",
        payment: "x402",
        enabled: computeEnabled,
        purpose: "Optional confidential credit scoring over c402 Compute."
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
      role: "confidential-compute-testnet",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
      creditContract: env("C402_COSTON2_CREDIT_CONTRACT") ?? "0x170864d2086D3ee15B43dD1092347D6FA73E0702",
      creditContractStatus: "legacy-testnet",
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
  const explicit = env("C402_BASE_SEPOLIA_CREDIT_CONTRACT");
  if (explicit) return explicit;
  return env("C402_CREDIT_NETWORK") === "eip155:84532" ? env("C402_CREDIT_CONTRACT") ?? "" : "";
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

function optionalEnvInteger(name: string): number | undefined {
  const value = env(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function registerLender(body: Record<string, unknown>): Record<string, unknown> {
  const wallet = createTestnetLenderWallet();
  const lender = credit.registerLender(asLenderProfileInput({
    ...body,
    agent: wallet.address
  }));
  return {
    lender,
    wallet,
    warning: "The private key is returned once and is not stored by c402. Fund this lender agent wallet before it signs supplier-payment actions."
  };
}

function createTestnetLenderWallet(): { address: string; privateKey: Hex; custody: string; network: string; fundWith: string } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
    custody: "client-controlled",
    network: "eip155:84532",
    fundWith: "Base Sepolia ETH for the current native-token credit contract"
  };
}

async function lenderWalletSummaries(): Promise<Record<string, unknown>[]> {
  return Promise.all(credit.state().lenders.map((lender) => lenderWalletSummary(lender.agent)));
}

async function lenderWalletSummary(lenderAgent: string): Promise<Record<string, unknown>> {
  const queue = credit.lenderFundingActions(lenderAgent);
  const state = credit.state();
  const address = queue.lender.agent;
  const nativeBalanceAtomic = await nativeBalance(address);
  const advances = state.advances.filter((advance) => typeof advance.lender === "string" && sameAddress(advance.lender, address));
  return {
    address,
    network: "eip155:84532",
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

async function nativeBalance(address: string): Promise<string | undefined> {
  if (!isAddress(address)) return undefined;
  try {
    const client = createPublicClient({ transport: http(env("C402_CREDIT_RPC_URL") ?? "https://sepolia.base.org") });
    return (await client.getBalance({ address })).toString();
  } catch {
    return undefined;
  }
}

function withFundingTransaction(action: ReturnType<AgentCreditService["lenderFundingActions"]>["actions"][number]): Record<string, unknown> {
  const contract = baseSepoliaCreditContract();
  const jobIdBytes32 = idToBytes32(action.repaymentSource);
  const advanceIdBytes32 = idToBytes32(action.offerId);
  return {
    ...action,
    transaction: contract ? {
      chainId: 84532,
      network: "eip155:84532",
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
      afterSubmit: {
        method: "POST",
        path: `/credit/offers/${encodeURIComponent(action.offerId)}/supplier-payment`,
        body: {
          lender: action.lender,
          supplierPaymentId: "<transaction-hash>"
        }
      }
    } : undefined,
    transactionWarning: contract
      ? "The current Base Sepolia C402CreditIntent contract debits native testnet token from the lender agent wallet."
      : "C402_BASE_SEPOLIA_CREDIT_CONTRACT is not configured, so no transaction target is available."
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
    asset: typeof body.asset === "string" ? body.asset : undefined,
    networks: optionalStringArray(body, "networks")?.map(normalizeNetwork),
    minFeeBps: optionalNumber(body, "minFeeBps"),
    maxDurationSeconds: optionalNumber(body, "maxDurationSeconds"),
    acceptedRiskBands: optionalRiskBands(body, "acceptedRiskBands"),
    reputationScore: initialLenderReputation(body),
    status: body.status === "paused" ? "paused" as const : "active" as const
  };
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
