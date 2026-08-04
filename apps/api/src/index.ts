import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { C402Error, type CreditProductType, type Purpose } from "@c402/protocol";
import { createFccAdapterFromEnv } from "@c402/fcc-adapter";
import { AgentCreditService, ConfidentialPaymentService, createConfigFromEnv } from "@c402/server";

const computeEnabled = env("C402_ENABLE_COMPUTE") === "true";
const service = computeEnabled ? createConfidentialPaymentService() : undefined;
const credit = new AgentCreditService({
  endpoint: env("C402_CREDIT_ENDPOINT") ?? env("C402_PUBLIC_URL"),
  network: env("C402_NETWORK"),
  asset: env("C402_ASSET")
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
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, service: "c402-api" });
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/.well-known/c402.json" || url.pathname === "/v1/services/catalog")) {
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
    if (req.method === "POST" && url.pathname === "/lenders/register") {
      return sendJson(res, 201, credit.registerLender(asLenderProfileInput(await readJson(req))));
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
      creditContract: env("C402_CREDIT_CONTRACT") ?? "0x170864d2086D3ee15B43dD1092347D6FA73E0702",
      creditNetwork: env("C402_CREDIT_NETWORK") ?? "eip155:114",
      x402Network: env("C402_NETWORK") ?? "eip155:84532",
      x402Asset: env("C402_ASSET") ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: env("C402_PAY_TO") ?? "0x21b805BBC4bfFA7769868BF7f488D77b71756d3E",
      erc8004AgentId: env("ERC8004_AGENT_ID") ?? "8681"
    },
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
        purpose: "Register an agent lender profile with liquidity, fee, supplier, and risk preferences."
      },
      {
        method: "POST",
        path: "/credit/match",
        price: "free",
        purpose: "Match an approved credit offer to the best eligible lender agent."
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
      "/credit/match": {
        post: { summary: "Match offer to lender agent", responses: { "200": { description: "Selected lender match" } } }
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
    networks: optionalStringArray(body, "networks"),
    minFeeBps: optionalNumber(body, "minFeeBps"),
    maxDurationSeconds: optionalNumber(body, "maxDurationSeconds"),
    allowedPurposes: optionalPurposes(body, "allowedPurposes"),
    allowedSupplierDomains: optionalStringArray(body, "allowedSupplierDomains"),
    acceptedRiskBands: optionalRiskBands(body, "acceptedRiskBands"),
    reputationScore: optionalNumber(body, "reputationScore"),
    status: body.status === "paused" ? "paused" as const : "active" as const
  };
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
