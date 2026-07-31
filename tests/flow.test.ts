import test from "node:test";
import assert from "node:assert/strict";
import { c402Fetch } from "@c402/client";
import { sampleBankStatement, CREDIT_MODEL_CODE_HASH } from "@c402/credit-model";
import { LocalFccAdapter } from "@c402/fcc-adapter";
import { ConfidentialPaymentService, createConfigFromEnv } from "@c402/server";

test("confidential payment flow quotes, executes, verifies, settles, and decrypts", async () => {
  const service = new ConfidentialPaymentService(
    createConfigFromEnv(
      {
        C402_PAYMENT_MODE: "demo",
        ALLOW_LOCAL_DEMO: "true",
        C402_DEMO_PAYMENT_SECRET: "test-secret",
        C402_EXPECTED_CODE_HASH: CREDIT_MODEL_CODE_HASH
      },
      new LocalFccAdapter()
    )
  );
  await service.warmup();

  const fetchImpl: typeof fetch = async (_url, init) => {
    if (!init?.headers) {
      const quote = await service.quote();
      return jsonResponse(quote.status, quote.body, quote.headers);
    }
    const headers = new Headers(init.headers);
    const result = await service.execute(headers);
    return jsonResponse(result.status, result.body, result.headers);
  };

  const response = await c402Fetch("http://local.test/credit-score", {
    privateInput: sampleBankStatement(),
    verifyCodeHash: CREDIT_MODEL_CODE_HASH,
    demoPaymentSecret: "test-secret",
    allowDemoPayment: true,
    fetchImpl
  });

  assert.equal(response.result.approved, true);
  assert.equal(response.result.riskBand, "B");
  assert.equal(response.receipt.status, "success");
  assert.equal(service.store.list()[0]?.state, "delivered");
});

test("client rejects unexpected code hash before sending private input", async () => {
  const service = new ConfidentialPaymentService(
    createConfigFromEnv(
      {
        C402_PAYMENT_MODE: "demo",
        ALLOW_LOCAL_DEMO: "true",
        C402_DEMO_PAYMENT_SECRET: "test-secret",
        C402_EXPECTED_CODE_HASH: CREDIT_MODEL_CODE_HASH
      },
      new LocalFccAdapter()
    )
  );
  await service.warmup();

  const fetchImpl: typeof fetch = async () => {
    const quote = await service.quote();
    return jsonResponse(quote.status, quote.body, quote.headers);
  };

  await assert.rejects(
    c402Fetch("http://local.test/credit-score", {
      privateInput: sampleBankStatement(),
      verifyCodeHash: "0xwrong",
      demoPaymentSecret: "test-secret",
      allowDemoPayment: true,
      fetchImpl
    }),
    /expected 0xwrong/
  );
  assert.equal(service.store.list()[0]?.state, "quoted");
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}
