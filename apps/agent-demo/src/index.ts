import { c402Fetch } from "@c402/client";
import { CREDIT_MODEL_CODE_HASH, sampleBankStatement } from "@c402/credit-model";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const baseUrl = process.env.C402_BASE_URL ?? "http://127.0.0.1:4021";
const mode = process.env.C402_DEMO_MODE ?? "credit";

if (mode === "confidential-compute" || mode === "x402") {
  const x402 = mode === "x402" ? createX402PayloadFactory() : undefined;
  const result = await c402Fetch(`${baseUrl}/credit-score`, {
    privateInput: sampleBankStatement(),
    verifyCodeHash: process.env.C402_EXPECTED_CODE_HASH ?? CREDIT_MODEL_CODE_HASH,
    payer: process.env.C402_AGENT_ID ?? "ai-lending-agent",
    demoPaymentSecret: process.env.C402_DEMO_PAYMENT_SECRET ?? "dev-secret-change-me",
    allowDemoPayment: process.env.ALLOW_LOCAL_DEMO === "true",
    createX402PaymentPayload: x402
  });

  console.log(JSON.stringify({
    decision: result.result,
    receipt: {
      requestId: result.receipt.requestId,
      teeId: result.receipt.teeId,
      codeHash: result.receipt.codeHash,
      inputCommitment: result.receipt.inputCommitment,
      outputCommitment: result.receipt.outputCommitment,
      settlementTx: result.receipt.settlementTx
    }
  }, null, 2));
} else {
  const success = await postJson(`${baseUrl}/credit/demo/success`);
  const failure = await postJson(`${baseUrl}/credit/demo/failure`);
  const state = await fetch(`${baseUrl}/credit/state`).then(response => response.json());

  console.log(JSON.stringify({
    story: "Just-in-Time x402 Credit",
    success: {
      job: success.job,
      request: success.request,
      decision: success.decision,
      supplierPayment: success.advance,
      repayment: success.repayment
    },
    failure: {
      job: failure.job,
      declinedReason: failure.decision.reason,
      passportEvent: failure.passportEvent
    },
    vault: state.formatted,
    passport: state.passport
  }, null, 2));
}

async function postJson(url: string): Promise<any> {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function createX402PayloadFactory(): (paymentRequirement: any) => Promise<unknown> {
  const privateKey = process.env.X402_PAYER_PRIVATE_KEY ?? process.env.DEPLOYMENT_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("C402_DEMO_MODE=x402 requires X402_PAYER_PRIVATE_KEY or DEPLOYMENT_PRIVATE_KEY");
  }
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(normalized as `0x${string}`);
  const client = new x402Client().register("eip155:*", new ExactEvmScheme(account, {
    84532: { rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org" }
  }));
  return paymentRequirement => client.createPaymentPayload(paymentRequirement);
}
