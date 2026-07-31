import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { C402Error, type Purpose } from "@c402/protocol";
import { createFccAdapterFromEnv } from "@c402/fcc-adapter";
import { AgentCreditService, ConfidentialPaymentService, createConfigFromEnv } from "@c402/server";

const computeEnabled = process.env.C402_ENABLE_COMPUTE === "true";
const service = computeEnabled ? createConfidentialPaymentService() : undefined;
const credit = new AgentCreditService();
if (service) await service.warmup();

const server = createServer(async (req, res) => {
  try {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
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
    if (req.method === "POST" && url.pathname === "/credit/jobs") {
      return sendJson(res, 201, credit.createFundedJob(asFundedJobInput(await readJson(req))));
    }
    if (req.method === "POST" && url.pathname === "/credit/request") {
      return sendJson(res, 200, credit.requestCredit(asCreditRequestInput(await readJson(req))));
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/offers/") && url.pathname.endsWith("/accept")) {
      const offerId = decodeURIComponent(url.pathname.slice("/credit/offers/".length, -"/accept".length));
      return sendJson(res, 200, credit.acceptOffer(offerId));
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/jobs/") && url.pathname.endsWith("/complete")) {
      const jobId = decodeURIComponent(url.pathname.slice("/credit/jobs/".length, -"/complete".length));
      const body = await readJson(req);
      return sendJson(res, 200, credit.completeJob(jobId, String(body.advanceId)));
    }
    if (req.method === "POST" && url.pathname.startsWith("/credit/jobs/") && url.pathname.endsWith("/fail")) {
      const jobId = decodeURIComponent(url.pathname.slice("/credit/jobs/".length, -"/fail".length));
      const body = await readJson(req);
      return sendJson(res, 200, credit.failJob(jobId, typeof body.advanceId === "string" ? body.advanceId : undefined));
    }
    if (req.method === "POST" && url.pathname === "/credit/demo/success") {
      return sendJson(res, 200, credit.seedHackathonSuccess());
    }
    if (req.method === "POST" && url.pathname === "/credit/demo/failure") {
      return sendJson(res, 200, credit.seedHackathonFailure());
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
});

const port = Number(process.env.PORT ?? 4021);
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(`c402 API listening at http://127.0.0.1:${port}`);
  console.log(`confidential compute ${computeEnabled ? "enabled" : "disabled"}; credit endpoints are available`);
});

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
  return process.env.C402_PUBLIC_URL ?? `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost"}`;
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
      creditContract: process.env.C402_CREDIT_CONTRACT ?? "0x170864d2086D3ee15B43dD1092347D6FA73E0702",
      creditNetwork: process.env.C402_CREDIT_NETWORK ?? "eip155:114",
      x402Network: process.env.C402_NETWORK ?? "eip155:84532",
      x402Asset: process.env.C402_ASSET ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: process.env.C402_PAY_TO ?? "0x21b805BBC4bfFA7769868BF7f488D77b71756d3E",
      erc8004AgentId: process.env.ERC8004_AGENT_ID ?? "8681"
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
        path: "/credit/request",
        price: "free",
        purpose: "Request a purpose-bound advance against a funded job."
      },
      {
        method: "POST",
        path: "/credit/offers/{offerId}/accept",
        price: "free",
        purpose: "Accept a signed credit offer and pay the supplier path."
      },
      {
        method: "POST",
        path: "/credit/jobs/{jobId}/complete",
        price: "free",
        purpose: "Complete a job and route repayment before agent proceeds."
      },
      {
        method: "POST",
        path: "/credit-score",
        price: process.env.C402_PRICE_USD ?? "0.10",
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
      "/credit/request": {
        post: { summary: "Request credit", responses: { "200": { description: "Underwriting decision and optional offer" } } }
      },
      "/credit/offers/{offerId}/accept": {
        post: { summary: "Accept a credit offer", responses: { "200": { description: "Supplier advance" } } }
      },
      "/credit/jobs/{jobId}/complete": {
        post: { summary: "Complete and repay a job", responses: { "200": { description: "Repayment receipt" } } }
      },
      "/credit/jobs/{jobId}/fail": {
        post: { summary: "Fail a job and suspend credit", responses: { "200": { description: "Passport event" } } }
      },
      "/credit-score": {
        post: { summary: "Optional x402/c402 confidential compute endpoint", responses: { "200": { description: "Encrypted result" }, "402": { description: "Payment required" }, "503": { description: "Compute disabled" } } }
      }
    }
  };
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
  const durationSeconds = body.durationSeconds;
  return {
    agent: requiredString(body, "agent"),
    amountAtomic: requiredString(body, "amountAtomic"),
    purpose: purpose as Purpose,
    supplier: requiredString(body, "supplier"),
    supplierDomain: requiredString(body, "supplierDomain"),
    repaymentSource: requiredString(body, "repaymentSource"),
    maximumFeeAtomic: requiredString(body, "maximumFeeAtomic"),
    durationSeconds: typeof durationSeconds === "number" ? durationSeconds : undefined
  };
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new C402Error("invalid_json_body", `${field} is required`, 400);
  }
  return value;
}
