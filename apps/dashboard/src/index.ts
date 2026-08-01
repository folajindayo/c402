import { createServer } from "node:http";

const apiBase = process.env.C402_BASE_URL ?? "http://127.0.0.1:4021";
const port = Number(process.env.DASHBOARD_PORT ?? 4022);
const host = process.env.HOST ?? "127.0.0.1";

const server = createServer((_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(render(apiBase));
});

server.listen(port, host, () => {
  console.log(`c402 dashboard listening at http://127.0.0.1:${port}`);
});

function render(apiBaseUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>c402 Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111314; color: #f4f1ea; }
    body { margin: 0; background: #111314; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 48px; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 28px; }
    h1 { margin: 0 0 8px; font-size: 32px; letter-spacing: 0; }
    p { margin: 0; color: #b9b6ad; line-height: 1.5; }
    button { background: #f0b429; color: #171717; border: 0; padding: 10px 14px; border-radius: 6px; font-weight: 700; cursor: pointer; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .metric, .panel { border: 1px solid #34383a; border-radius: 8px; background: #181b1d; padding: 16px; }
    .metric strong { display: block; font-size: 12px; color: #98948b; text-transform: uppercase; margin-bottom: 8px; }
    .metric span { font-size: 18px; word-break: break-word; }
    .flow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .step { min-height: 96px; border: 1px solid #3b4143; border-radius: 8px; padding: 14px; background: #151819; }
    .step h2 { margin: 0 0 8px; font-size: 15px; }
    .step p { font-size: 13px; }
    pre { overflow: auto; white-space: pre-wrap; font-size: 13px; color: #d8d4ca; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { text-align: left; border-bottom: 1px solid #303437; padding: 10px 8px; vertical-align: top; }
    th { color: #aaa49a; font-weight: 600; }
    @media (max-width: 860px) { .grid, .flow { grid-template-columns: 1fr; } header { flex-direction: column; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>c402 Confidential Credit Compute</h1>
      <p>Payment, encrypted input, attested execution, signed receipt, encrypted result.</p>
    </div>
    <button id="refresh">Refresh</button>
  </header>
  <section class="grid">
    <div class="metric"><strong>API</strong><span>${apiBaseUrl}</span></div>
    <div class="metric"><strong>TEE</strong><span id="tee">loading</span></div>
    <div class="metric"><strong>Code Hash</strong><span id="codeHash">loading</span></div>
    <div class="metric"><strong>Mode</strong><span id="mode">loading</span></div>
  </section>
  <section class="flow">
    <div class="step"><h2>1. Fund Job</h2><p>Buyer locks a receivable before any lender funds are advanced.</p></div>
    <div class="step"><h2>2. Approve Spend</h2><p>Underwriting checks purpose, supplier, margin, and repayment source.</p></div>
    <div class="step"><h2>3. Pay Supplier</h2><p>Credit goes directly to the x402/API supplier, not the agent wallet.</p></div>
    <div class="step"><h2>4. Repay First</h2><p>Completed job revenue repays principal, fee, and reserve before agent profit.</p></div>
  </section>
  <section class="grid">
    <div class="metric"><strong>Lender Receivables</strong><span id="lenderReceivables">loading</span></div>
    <div class="metric"><strong>Insurance Reserve</strong><span id="insuranceReserve">loading</span></div>
    <div class="metric"><strong>Funded Jobs</strong><span id="fundedJobs">loading</span></div>
    <div class="metric"><strong>Advances</strong><span id="advancesCount">loading</span></div>
  </section>
  <section class="panel">
    <h2>c402 Credit</h2>
    <table>
      <thead><tr><th>Job</th><th>Status</th><th>Receivable</th><th>Advance</th><th>Repayment</th></tr></thead>
      <tbody id="creditJobs"><tr><td colspan="5">loading</td></tr></tbody>
    </table>
  </section>
  <section class="panel" style="margin-top: 16px;">
    <h2>Agent Credit Passport</h2>
    <table>
      <thead><tr><th>Agent</th><th>Event</th><th>Score</th><th>Limit</th><th>Time</th></tr></thead>
      <tbody id="passport"><tr><td colspan="5">loading</td></tr></tbody>
    </table>
  </section>
  <section class="panel" style="margin-top: 16px;">
    <h2>ERC-8004 Reputation Signals</h2>
    <table>
      <thead><tr><th>Agent ID</th><th>Tag</th><th>Value</th><th>Evidence Hash</th></tr></thead>
      <tbody id="erc8004"><tr><td colspan="4">loading</td></tr></tbody>
    </table>
  </section>
  <section class="panel">
    <h2>Requests</h2>
    <table>
      <thead><tr><th>Request</th><th>State</th><th>Payment</th><th>Updated</th><th>Failure</th></tr></thead>
      <tbody id="requests"><tr><td colspan="5">loading</td></tr></tbody>
    </table>
  </section>
  <section class="panel" style="margin-top: 16px;">
    <h2>Attestation</h2>
    <pre id="attestation">loading</pre>
  </section>
</main>
<script>
const apiBase = ${JSON.stringify(apiBaseUrl)};
async function refresh() {
  const [attestationResult, requests, credit] = await Promise.all([
    getJsonAllowError(apiBase + "/attestation"),
    getJson(apiBase + "/requests"),
    getJson(apiBase + "/credit/state")
  ]);
  const attestation = attestationResult.ok ? attestationResult.body : undefined;
  document.getElementById("tee").textContent = attestation ? attestation.teeId : "disabled";
  document.getElementById("codeHash").textContent = attestation ? attestation.codeHash : "disabled";
  document.getElementById("mode").textContent = attestation ? attestation.mode : "credit-only";
  document.getElementById("attestation").textContent = JSON.stringify(attestation ? redact(attestation) : attestationResult.body, null, 2);
  document.getElementById("requests").innerHTML = (requests.requests || []).map(row => "<tr><td>" + row.requestId + "</td><td>" + row.state + "</td><td>" + (row.paymentId || "") + "</td><td>" + row.updatedAt + "</td><td>" + (row.failureReason || "") + "</td></tr>").join("") || "<tr><td colspan='5'>No requests yet</td></tr>";
  document.getElementById("lenderReceivables").textContent = (credit.formatted.directLenderReceivables || []).join("\\n") || "$0 USDC";
  document.getElementById("insuranceReserve").textContent = credit.formatted.insuranceReserve;
  document.getElementById("fundedJobs").textContent = String((credit.jobs || []).length);
  document.getElementById("advancesCount").textContent = String((credit.advances || []).length);
  document.getElementById("creditJobs").innerHTML = (credit.jobs || []).map(job => {
    const request = (credit.requests || []).find(item => item.repaymentSource === job.jobId);
    const offer = request ? (credit.offers || []).find(item => item.requestId === request.requestId) : undefined;
    const advance = offer ? (credit.advances || []).find(item => item.offerId === offer.offerId) : undefined;
    const repayment = advance ? (credit.repayments || []).find(item => item.advanceId === advance.advanceId) : undefined;
    return "<tr><td>" + job.jobId + "</td><td>" + job.status + "</td><td>" + money(job.escrowAmountAtomic) + " " + job.asset + "</td><td>" + (advance ? money(advance.amountAtomic) + " paid to " + advance.supplier : request ? "not advanced" : "") + "</td><td>" + (repayment ? money(repayment.principalAtomic) + " + " + money(repayment.feeAtomic) + " fee; agent " + money(repayment.agentProceedsAtomic) : "") + "</td></tr>";
  }).join("") || "<tr><td colspan='5'>No credit jobs yet</td></tr>";
  document.getElementById("passport").innerHTML = (credit.passport || []).map(row => "<tr><td>" + row.agent + "</td><td>" + row.event + "</td><td>" + row.scoreDelta + "</td><td>" + money(row.creditLimitAtomic) + "</td><td>" + row.createdAt + "</td></tr>").join("") || "<tr><td colspan='5'>No passport events yet</td></tr>";
  document.getElementById("erc8004").innerHTML = (credit.erc8004Feedback || []).map(row => "<tr><td>" + row.agentId + "</td><td>" + row.tag1 + " / " + row.tag2 + "</td><td>" + row.value + "</td><td>" + row.feedbackHash + "</td></tr>").join("") || "<tr><td colspan='4'>No ERC-8004 signals yet</td></tr>";
}
async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " returned " + response.status);
  return response.json();
}
async function getJsonAllowError(url) {
  const response = await fetch(url);
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}
function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  for (const id of ["tee", "codeHash", "mode", "lenderReceivables", "insuranceReserve", "fundedJobs", "advancesCount"]) {
    document.getElementById(id).textContent = "error";
  }
  document.getElementById("requests").innerHTML = "<tr><td colspan='5'>" + message + "</td></tr>";
  document.getElementById("creditJobs").innerHTML = "<tr><td colspan='5'>" + message + "</td></tr>";
  document.getElementById("passport").innerHTML = "<tr><td colspan='5'>" + message + "</td></tr>";
  document.getElementById("erc8004").innerHTML = "<tr><td colspan='4'>" + message + "</td></tr>";
  document.getElementById("attestation").textContent = message;
}
function money(value) {
  const raw = BigInt(value || "0");
  const whole = raw / 1000000n;
  const fraction = String(raw % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return "$" + (fraction ? whole + "." + fraction : whole);
}
function redact(value) {
  return { ...value, inputEncryptionKey: value.inputEncryptionKey ? value.inputEncryptionKey.slice(0, 48) + "..." : "", teeSigningKey: value.teeSigningKey ? value.teeSigningKey.slice(0, 48) + "..." : "" };
}
document.getElementById("refresh").addEventListener("click", refresh);
refresh().catch(showError);
</script>
</body>
</html>`;
}
