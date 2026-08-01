import test from "node:test";
import assert from "node:assert/strict";
import {
  createCreditRequest,
  createErc8004CreditFeedback,
  createRepaymentReceipt,
  generateSigningKeyPair,
  underwriteReceivable,
  verifyCreditOffer,
  createCreditOffer,
  type CreditAdvance,
  type FundedJob,
  type SpendingPolicy
} from "@c402/protocol";
import { AgentCreditService } from "@c402/server";

const job: FundedJob = {
  jobId: "job-4021",
  buyer: "0xBuyer",
  agent: "0xAgent",
  escrowAmountAtomic: "10000000",
  asset: "USDC",
  description: "Research job",
  status: "funded",
  createdAt: "2026-07-30T00:00:00.000Z"
};

const policy: SpendingPolicy = {
  allowedUses: ["data", "compute"],
  allowedDomains: ["data.example.com"],
  maxAdvanceAtomic: "1500000",
  minGrossMarginBps: 3000
};

test("receivable-backed underwriting approves purpose-bound supplier credit", () => {
  const request = createCreditRequest({
    agent: job.agent,
    amountAtomic: "1000000",
    purpose: "data",
    supplier: "Market Data API",
    supplierDomain: "data.example.com",
    repaymentSource: job.jobId,
    maximumFeeAtomic: "100000",
    durationSeconds: 3600
  });

  const decision = underwriteReceivable(job, request, policy);

  assert.equal(decision.approved, true);
  assert.equal(decision.riskBand, "A");
  assert.equal(decision.requiredRevenueSweepBps, 10000);
});

test("underwriting rejects unapproved supplier domains", () => {
  const request = createCreditRequest({
    agent: job.agent,
    amountAtomic: "1000000",
    purpose: "data",
    supplier: "Unknown API",
    supplierDomain: "unknown.example.com",
    repaymentSource: job.jobId,
    maximumFeeAtomic: "100000",
    durationSeconds: 3600
  });

  const decision = underwriteReceivable(job, request, policy);

  assert.equal(decision.approved, false);
  assert.equal(decision.reason, "supplier domain is not allowed");
});

test("signed credit offers reject tampering", () => {
  const keys = generateSigningKeyPair();
  const request = createCreditRequest({
    agent: job.agent,
    amountAtomic: "1000000",
    purpose: "data",
    supplier: "Market Data API",
    supplierDomain: "data.example.com",
    repaymentSource: job.jobId,
    maximumFeeAtomic: "100000",
    durationSeconds: 3600
  });

  const offer = createCreditOffer(request, policy, keys.privateKey);
  assert.doesNotThrow(() => verifyCreditOffer(offer, keys.publicKey));
  assert.throws(() => verifyCreditOffer({ ...offer, approvedAmountAtomic: "2000000" }, keys.publicKey), /signature/);
});

test("repayment receipt repays lender before agent proceeds", () => {
  const keys = generateSigningKeyPair();
  const request = createCreditRequest({
    agent: job.agent,
    amountAtomic: "1000000",
    purpose: "data",
    supplier: "Market Data API",
    supplierDomain: "data.example.com",
    repaymentSource: job.jobId,
    maximumFeeAtomic: "100000",
    durationSeconds: 3600
  });
  const offer = createCreditOffer(request, policy, keys.privateKey);
  const advance: CreditAdvance = {
    advanceId: "adv-1",
    offerId: offer.offerId,
    requestId: request.requestId,
    supplier: request.supplier,
    amountAtomic: offer.approvedAmountAtomic,
    status: "advanced",
    paidAt: "2026-07-30T00:00:00.000Z",
    supplierPaymentId: "x402-paid:data.example.com"
  };

  const receipt = createRepaymentReceipt({ job, advance, offer, reserveBps: 2000, signerPrivateKeyPem: keys.privateKey });

  assert.equal(receipt.principalAtomic, "1000000");
  assert.equal(receipt.feeAtomic, "50000");
  assert.equal(receipt.reserveAtomic, "10000");
  assert.equal(receipt.agentProceedsAtomic, "8950000");
});

test("hackathon credit service demonstrates success and failed-job paths", () => {
  const service = new AgentCreditService();
  const success = service.seedHackathonSuccess();
  const failure = service.seedHackathonFailure();
  const state = service.state();

  assert.equal(success.repayment.agentProceedsAtomic, "8950000");
  assert.equal(failure.decision.approved, false);
  assert.equal(failure.passportEvent.event, "credit_suspended");
  assert.equal(state.advances.length, 1);
  assert.equal(state.passport.length, 2);
  assert.equal(state.erc8004Feedback.length, 2);
  assert.equal(state.erc8004Feedback[0]?.tag1, "c402-credit");
  assert.equal(state.erc8004Feedback[0]?.tag2, "advance-repaid");
  assert.equal(state.erc8004Feedback[1]?.tag2, "credit-suspended");
  assert.equal(state.erc8004ValidationRequests[0]?.payload.kind, "repayment-receipt");
});

test("direct lender-to-supplier flow keeps pooled vault funds out of the advance", () => {
  const service = new AgentCreditService();
  const before = service.state();
  const success = service.seedDirectSupplierSuccess();
  const after = service.state();

  assert.equal(success.advance.fundingSource, "direct-lender");
  assert.equal(success.advance.lender, "0xLender");
  assert.match(success.advance.supplierPaymentId, /^x402-direct:/);
  assert.equal(success.repayment.principalAtomic, "1000000");
  assert.equal(success.repayment.feeAtomic, "50000");
  assert.equal(success.repayment.reserveAtomic, "10000");
  assert.equal(success.repayment.agentProceedsAtomic, "8950000");
  assert.equal(after.lenderVaultAtomic, before.lenderVaultAtomic);
  assert.deepEqual(after.directLenderReceivables, [{ lender: "0xLender", amountAtomic: "1040000" }]);
});

test("erc-8004 feedback payload commits to c402 repayment evidence", () => {
  const feedback = createErc8004CreditFeedback({
    agentRef: { agentRegistry: "eip155:114:0xRegistry", agentId: "4021" },
    endpoint: "https://c402.example/credit",
    passportEvent: {
      agent: "0xAgent",
      jobId: "job-4021",
      event: "advance_repaid",
      scoreDelta: 8,
      creditLimitAtomic: "20000000",
      createdAt: "2026-07-30T00:00:00.000Z"
    },
    repayment: {
      repaymentId: "repay-1",
      jobId: "job-4021",
      advanceId: "adv-1",
      escrowAmountAtomic: "10000000",
      principalAtomic: "1000000",
      feeAtomic: "50000",
      agentProceedsAtomic: "8950000",
      reserveAtomic: "10000",
      status: "repaid",
      createdAt: "2026-07-30T00:00:00.000Z",
      signature: "sig"
    }
  });

  assert.equal(feedback.agentId, "4021");
  assert.equal(feedback.value, "8");
  assert.equal(feedback.valueDecimals, 0);
  assert.equal(feedback.payload.evidence.repaymentId, "repay-1");
  assert.match(feedback.feedbackHash, /^0x[0-9a-f]{64}$/);
});
