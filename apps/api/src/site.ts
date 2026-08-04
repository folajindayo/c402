const DOCS_NAV = [
  ["Overview", "/docs"],
  ["Get Started", "/docs/get-started"],
  ["Borrowers", "/docs/borrowers"],
  ["Lenders", "/docs/lenders"],
  ["Protocol", "/docs/protocol"],
  ["API Reference", "/docs/api-reference"],
  ["Security", "/docs/security"],
  ["x402 Compatibility", "/docs/x402-compatibility"]
] as const;

type DocsPage = {
  title: string;
  description: string;
  body: string;
};

const DOCS: Record<string, DocsPage> = {
  "/docs": {
    title: "c402 Documentation",
    description: "Agent credit over HTTP: borrow, lend, repay, and liquidate through inspectable protocol flows.",
    body: `
      <h1>c402 Documentation</h1>
      <p class="lead">c402 is a credit protocol for AI agents. It lets agents borrow to pay suppliers, while lenders receive a senior repayment claim against a verified source.</p>
      <h2>Start Here</h2>
      <div class="link-grid">
        <a href="/docs/get-started"><strong>How to get started with c402</strong><span>Register a lender, create a borrower source, request credit, match, pay, repay.</span></a>
        <a href="/docs/borrowers"><strong>Borrower agents</strong><span>How an agent borrows without receiving unrestricted funds.</span></a>
        <a href="/docs/lenders"><strong>Lender agents</strong><span>How idle agent balances become purpose-bound credit offers.</span></a>
        <a href="/docs/security"><strong>Security model</strong><span>Liens, hard recovery value, direct supplier payment, and liquidation.</span></a>
      </div>
      <h2>Core Invariant</h2>
      <pre><code>principal + maximum borrower fee <= hard liquidatable recovery value</code></pre>
      <p>Projected revenue can size a credit line, but it cannot replace collateral. Every approved loan needs something recoverable.</p>
    `
  },
  "/docs/get-started": {
    title: "How to get started with c402",
    description: "A short agent-friendly guide to borrowing and lending through c402.",
    body: `
      <h1>How to get started with c402</h1>
      <p class="lead">Use c402 when an agent has work to do, needs to pay a supplier first, and has a verified repayment source.</p>
      <h2>1. Discover the service</h2>
      <pre><code>curl https://c402.site/.well-known/c402.json</code></pre>
      <p>Agents should read the catalog before calling credit endpoints. The catalog lists supported products, networks, and endpoints.</p>
      <h2>2. Register a lender agent</h2>
      <pre><code>curl -X POST https://c402.site/lenders/register \\
  -H 'content-type: application/json' \\
  -d '{
    "availableLiquidityAtomic":"25000000",
    "asset":"USDC",
    "networks":["eip155:84532"],
    "minFeeBps":300,
    "maxDurationSeconds":86400,
    "allowedPurposes":["data","compute"],
    "allowedSupplierDomains":["data.example.com"],
    "acceptedRiskBands":["A","B"],
    "reputationScore":75
  }'</code></pre>
      <p>If <code>agent</code> is omitted, registration creates a testnet lender wallet and returns its private key once. If the lender already has an agent wallet, include <code>"agent":"0x..."</code>.</p>
      <h2>3. Fund and inspect the lender wallet</h2>
      <pre><code>curl https://c402.site/lenders/0xLenderAgent/wallet</code></pre>
      <p>Fund the lender agent wallet with Base Sepolia ETH for the current native-token testnet credit contract.</p>
      <h2>4. Create or register a repayment source</h2>
      <p>For a funded job, create a job receivable. For asset, subscription, or earnings credit, register a backing source with hard liquidation value.</p>
      <pre><code>curl -X POST https://c402.site/credit/backing-sources \\
  -H 'content-type: application/json' \\
  -d '{
    "sourceId":"asset-source-1",
    "productType":"asset-backed",
    "agent":"0xBorrowerAgent",
    "valueAtomic":"5000000",
    "liquidationValueAtomic":"5000000",
    "advanceRateBps":6500,
    "evidenceId":"ftso-proof-1"
  }'</code></pre>
      <h2>5. Request credit</h2>
      <pre><code>curl -X POST https://c402.site/credit/request \\
  -H 'content-type: application/json' \\
  -d '{
    "agent":"0xBorrowerAgent",
    "productType":"asset-backed",
    "amountAtomic":"1000000",
    "purpose":"data",
    "supplier":"Market Data API",
    "supplierDomain":"data.example.com",
    "repaymentSource":"asset-source-1",
    "maximumFeeAtomic":"100000"
  }'</code></pre>
      <h2>6. Match a lender</h2>
      <pre><code>curl -X POST https://c402.site/credit/match \\
  -H 'content-type: application/json' \\
  -d '{"offerId":"offer-id"}'</code></pre>
      <p>c402 selects the lowest-rate eligible lender. Reputation and liquidity are tie-breakers.</p>
      <h2>7. Lender wallet signs supplier payment</h2>
      <pre><code>curl https://c402.site/lenders/0xLenderAgent/actions</code></pre>
      <p>The lender agent runner signs the returned transaction from the funded wallet. The borrower never receives the principal.</p>
      <pre><code>curl -X POST https://c402.site/credit/offers/offer-id/supplier-payment \\
  -H 'content-type: application/json' \\
  -d '{
    "lender":"0xLenderAgent",
    "supplierPaymentId":"0xSupplierPaymentTxHash"
  }'</code></pre>
      <h2>8. Repay or liquidate</h2>
      <p>When revenue arrives, repay the advance. If terms are broken, liquidation uses locked collateral, hard backing value, and reserve before recording shortfall.</p>
    `
  },
  "/docs/borrowers": {
    title: "Borrower Agents",
    description: "How borrower agents use c402 credit without taking custody of unrestricted lender funds.",
    body: `
      <h1>Borrower Agents</h1>
      <p class="lead">Borrower agents use c402 to pay approved suppliers before revenue arrives.</p>
      <h2>What a borrower provides</h2>
      <ul>
        <li>Agent address</li>
        <li>Requested amount</li>
        <li>Purpose: compute, data, storage, or approved x402 service</li>
        <li>Supplier and supplier domain</li>
        <li>Repayment source</li>
        <li>Maximum fee the borrower is willing to pay</li>
      </ul>
      <h2>What the borrower does not receive</h2>
      <p>The borrower does not receive unrestricted loan principal. The lender pays the supplier directly.</p>
      <h2>Supported credit products</h2>
      <table>
        <thead><tr><th>Product</th><th>Repayment source</th><th>Recovery source</th></tr></thead>
        <tbody>
          <tr><td>Job-backed</td><td>Funded job escrow</td><td>Escrow plus optional bond</td></tr>
          <tr><td>Asset-backed</td><td>Verified asset source</td><td>Liquidatable collateral value</td></tr>
          <tr><td>Subscription-backed</td><td>Recurring revenue route</td><td>Escrow, reserve, or sponsor bond</td></tr>
          <tr><td>Earnings-backed</td><td>Verified earnings route</td><td>Reserve, bond, or sweep balance</td></tr>
        </tbody>
      </table>
    `
  },
  "/docs/lenders": {
    title: "Lender Agents",
    description: "How lender agents publish liquidity and get matched to borrower requests.",
    body: `
      <h1>Lender Agents</h1>
      <p class="lead">Lender agents provide liquidity to borrower agents and receive a senior repayment claim.</p>
      <h2>How matching works</h2>
      <p>The borrower specifies an amount and maximum fee. Lenders publish their own ask rate. c402 filters by policy and selects the cheapest eligible lender.</p>
      <pre><code>Borrower maximum fee: 10%
Lender A ask: 9%
Lender B ask: 2.5%
Selected lender: B</code></pre>
      <h2>Lender policy fields</h2>
      <ul>
        <li>Available liquidity</li>
        <li>Asset and supported networks</li>
        <li>Minimum fee in basis points</li>
        <li>Maximum duration</li>
        <li>Allowed purposes</li>
        <li>Allowed supplier domains</li>
        <li>Accepted risk bands</li>
        <li>Reputation score</li>
      </ul>
      <h2>Funded lender wallet flow</h2>
      <ol>
        <li>Register with <code>POST /lenders/register</code>. Omit <code>agent</code> to create a testnet lender wallet, or include an existing wallet address.</li>
        <li>Fund the registered wallet with Base Sepolia ETH for the current testnet contract.</li>
        <li>Inspect wallet state with <code>GET /lenders/{address}/wallet</code> or <code>GET /lenders/wallets</code>.</li>
        <li>Poll <code>GET /lenders/{address}/actions</code>.</li>
        <li>Sign the returned <code>paySupplier</code> transaction from the funded wallet.</li>
        <li>Report the transaction hash to <code>POST /credit/offers/{offerId}/supplier-payment</code>.</li>
      </ol>
      <h2>Recovery order</h2>
      <ol>
        <li>Repayment source revenue</li>
        <li>Posted collateral</li>
        <li>Hard backing liquidation value</li>
        <li>Insurance reserve</li>
        <li>Recorded shortfall and reputation penalty</li>
      </ol>
    `
  },
  "/docs/protocol": {
    title: "Protocol",
    description: "The c402 credit state machine and HTTP flow.",
    body: `
      <h1>Protocol</h1>
      <p class="lead">c402 is an HTTP credit flow for agent-to-agent commerce.</p>
      <h2>Credit lifecycle</h2>
      <ol>
        <li>Borrower registers or references a repayment source.</li>
        <li>Borrower requests supplier-specific credit.</li>
        <li>c402 underwrites amount, purpose, supplier, and recovery value.</li>
        <li>c402 signs an offer.</li>
        <li>Lender agents are filtered and ranked.</li>
        <li>Selected lender pays the supplier directly.</li>
        <li>c402 records an advance and lien.</li>
        <li>Revenue repays lender before borrower proceeds.</li>
        <li>Default triggers liquidation and reputation events.</li>
      </ol>
      <h2>State objects</h2>
      <ul>
        <li>Funded job</li>
        <li>Backing source</li>
        <li>Credit request</li>
        <li>Credit offer</li>
        <li>Lender match</li>
        <li>Advance</li>
        <li>Lien</li>
        <li>Repayment receipt</li>
        <li>Liquidation receipt</li>
        <li>Agent credit passport event</li>
      </ul>
      <h2>Networks</h2>
      <table>
        <thead><tr><th>Network</th><th>Chain ID</th><th>Role</th><th>Payment asset</th><th>Facilitator</th></tr></thead>
        <tbody>
          <tr><td>Base Sepolia</td><td><code>eip155:84532</code></td><td>Primary credit and x402 testnet</td><td>USDC</td><td><code>https://x402.org/facilitator</code></td></tr>
          <tr><td>Flare Coston2</td><td><code>eip155:114</code></td><td>Flare and confidential-compute testnet</td><td>testUSDT0</td><td><code>/x402/flare-facilitator</code></td></tr>
        </tbody>
      </table>
    `
  },
  "/docs/api-reference": {
    title: "API Reference",
    description: "HTTP endpoints exposed by c402.",
    body: `
      <h1>API Reference</h1>
      <p class="lead">Base URL: <code>https://c402.site</code></p>
      <h2>Discovery</h2>
      <pre><code>GET /health
GET /.well-known/c402.json
GET /openapi.json
GET /llms.txt</code></pre>
      <h2>x402 Facilitators</h2>
      <pre><code>GET  /x402/flare-facilitator/supported
POST /x402/flare-facilitator/verify
POST /x402/flare-facilitator/settle</code></pre>
      <p>Base Sepolia uses the public x402 facilitator. Flare Coston2 uses c402's facilitator endpoint.</p>
      <h2>Credit</h2>
      <pre><code>GET  /credit/state
POST /credit/jobs
POST /credit/jobs/{jobId}/collateral
POST /credit/backing-sources
GET  /credit/backing-sources
POST /credit/request
POST /credit/match
POST /credit/offers/{offerId}/supplier-payment
POST /credit/jobs/{jobId}/complete
POST /credit/advances/{advanceId}/repay
POST /credit/advances/{advanceId}/liquidate</code></pre>
      <h2>Lenders</h2>
      <pre><code>GET  /lenders
POST /lenders/register
GET  /lenders/wallets
GET  /lenders/{address}/wallet
GET  /lenders/{address}/actions</code></pre>
      <h2>Compute</h2>
      <pre><code>POST /credit-score</code></pre>
      <p><code>/credit-score</code> is disabled in the current production deployment until FCC is configured.</p>
    `
  },
  "/docs/security": {
    title: "Security Model",
    description: "The money-safety model for c402 credit.",
    body: `
      <h1>Security Model</h1>
      <p class="lead">The central rule is simple: lender funds do not go to the borrower wallet.</p>
      <h2>Controls</h2>
      <ul>
        <li>Direct lender-to-supplier payment</li>
        <li>Purpose-bound credit requests</li>
        <li>Supplier domain allowlists</li>
        <li>Senior repayment liens</li>
        <li>Hard liquidation value requirement</li>
        <li>Insurance reserve accounting</li>
        <li>ERC-8004-compatible reputation events</li>
      </ul>
      <h2>Default handling</h2>
      <p>On missed deadline or default, c402 liquidates available recovery sources and records any remaining shortfall against the borrower profile.</p>
      <pre><code>recovery = collateral + backing liquidation value + reserve
shortfall = senior claim - recovery</code></pre>
      <h2>Current limitation</h2>
      <p>The deployed service currently uses in-memory state. Production public credit markets should add durable storage before relying on it for real balances.</p>
    `
  },
  "/docs/x402-compatibility": {
    title: "x402 Compatibility",
    description: "How c402 relates to x402.",
    body: `
      <h1>x402 Compatibility</h1>
      <p class="lead">x402 is the payment primitive. c402 adds credit and optional confidential compute around agent payments.</p>
      <h2>x402 flow</h2>
      <ol>
        <li>Client requests a resource.</li>
        <li>Server returns <code>402 Payment Required</code>.</li>
        <li>Client retries with a payment payload.</li>
        <li>Server verifies and settles payment through a facilitator.</li>
        <li>Server returns the resource.</li>
      </ol>
      <h2>c402 compute extension</h2>
      <p>The optional compute endpoint follows the x402 payment flow and adds compute headers:</p>
      <pre><code>PAYMENT-REQUIRED
PAYMENT-SIGNATURE
PAYMENT-RESPONSE
COMPUTE-REQUIRED
COMPUTE-PAYLOAD
COMPUTE-RECEIPT</code></pre>
      <h2>c402 credit endpoints</h2>
      <p>The credit endpoints are plain JSON APIs today. They model borrowing, lending, liens, repayment, and liquidation. They can be wrapped with x402 payment challenges later if paid API access is required.</p>
      <h2>Networks</h2>
      <table>
        <thead><tr><th>Network</th><th>Chain ID</th><th>Asset</th><th>Transfer</th><th>Facilitator</th></tr></thead>
        <tbody>
          <tr><td>Base Sepolia</td><td><code>eip155:84532</code></td><td>USDC</td><td>EIP-3009</td><td><code>https://x402.org/facilitator</code></td></tr>
          <tr><td>Flare Coston2</td><td><code>eip155:114</code></td><td>testUSDT0</td><td>Permit2</td><td><code>/x402/flare-facilitator</code></td></tr>
        </tbody>
      </table>
    `
  }
};

export function renderLanding(baseUrl: string): string {
  return pageShell({
    title: "c402",
    description: "Purpose-bound credit for AI agents.",
    body: `
      <main class="landing">
        <nav class="topbar">
          <a class="brand" href="/">c402</a>
          <div>
            <a href="https://docs.c402.site">Docs</a>
            <a href="/dashboard">Dashboard</a>
            <a href="/.well-known/c402.json">Catalog</a>
          </div>
        </nav>
        <section class="hero">
          <div class="hero-inner">
            <p class="eyebrow">Credit for agentic commerce</p>
            <h1>Purpose-bound credit for AI agents.</h1>
            <p class="hero-copy">c402 lets agents borrow to pay APIs and suppliers, while lenders receive a senior claim against verified repayment sources.</p>
            <div class="actions">
              <a class="button" href="https://docs.c402.site/docs/get-started">Start with c402</a>
              <a class="button secondary" href="/.well-known/c402.json">View service catalog</a>
            </div>
          </div>
        </section>
        <section class="metrics">
          <div><strong>4</strong><span>credit products</span></div>
          <div><strong>0</strong><span>borrower custody of principal</span></div>
          <div><strong>1st</strong><span>lender repayment claim</span></div>
          <div><strong>HTTP</strong><span>agent-native interface</span></div>
        </section>
        <section class="code-card">
          <h2>Borrow to pay a supplier</h2>
          <pre><code>POST /credit/request
{
  "agent": "0xAgent",
  "productType": "job-backed",
  "amountAtomic": "1000000",
  "purpose": "data",
  "supplierDomain": "data.example.com",
  "repaymentSource": "job-4021",
  "maximumFeeAtomic": "100000"
}</code></pre>
          <p>c402 checks the repayment source, verifies hard recovery value, matches the cheapest eligible lender, and records a lien when the lender pays the supplier.</p>
        </section>
        <section class="split">
          <div>
            <p class="eyebrow">Borrower agents</p>
            <h2>Get work done before revenue arrives.</h2>
            <p>Borrowers request credit for approved suppliers. Funds go directly from the lender to the supplier, not into the borrower wallet.</p>
            <a href="https://docs.c402.site/docs/borrowers">Read borrower docs</a>
          </div>
          <div>
            <p class="eyebrow">Lender agents</p>
            <h2>Put idle agent balances to work.</h2>
            <p>Lenders publish liquidity, fee, duration, supplier, and risk policies. c402 selects the lowest-rate eligible lender.</p>
            <a href="https://docs.c402.site/docs/lenders">Read lender docs</a>
          </div>
        </section>
        <section class="principles">
          <h2>What c402 enforces</h2>
          <div class="principle-grid">
            <article><strong>Direct supplier payment</strong><span>Loan principal is not sent to the borrower wallet.</span></article>
            <article><strong>Hard recovery value</strong><span>Projected revenue cannot replace liquidatable collateral or reserves.</span></article>
            <article><strong>Senior liens</strong><span>Lenders are repaid before unrestricted agent proceeds.</span></article>
            <article><strong>Agent reputation</strong><span>Repayment and default events emit portable credit evidence.</span></article>
          </div>
        </section>
        <section class="compare">
          <div>
            <h2>The old way</h2>
            <ol>
              <li>Create supplier accounts</li>
              <li>Pre-fund every API</li>
              <li>Store API keys</li>
              <li>Run out of balance mid-job</li>
              <li>Wait for customer revenue</li>
            </ol>
          </div>
          <div>
            <h2>With c402</h2>
            <ol>
              <li>Agent receives paid job or registers backing</li>
              <li>Agent requests purpose-bound credit</li>
              <li>Lender pays supplier directly</li>
              <li>Revenue repays lender first</li>
              <li>Agent keeps remaining proceeds</li>
            </ol>
          </div>
        </section>
        <section class="faq">
          <h2>FAQ</h2>
          <details open><summary>Is c402 the same as x402?</summary><p>No. x402 is the payment primitive. c402 adds agent credit and optional confidential compute around that payment flow.</p></details>
          <details><summary>Does the borrower receive lender funds?</summary><p>No. The matched lender pays the approved supplier directly.</p></details>
          <details><summary>What can lenders liquidate?</summary><p>Each loan requires a repayment source and hard recovery value: job escrow, posted collateral, asset value, escrowed receipts, reserves, or bonds.</p></details>
        </section>
        <footer>
          <span>c402</span>
          <a href="${baseUrl}/llms.txt">llms.txt</a>
          <a href="https://docs.c402.site">Docs</a>
          <a href="/dashboard">Dashboard</a>
        </footer>
      </main>
    `
  });
}

export function renderDocs(pathname: string): string {
  const page = DOCS[pathname] ?? DOCS["/docs"];
  return pageShell({
    title: `${page.title} - c402 Docs`,
    description: page.description,
    body: `
      <div class="docs-layout">
        <aside>
          <a class="brand" href="/">c402</a>
          <nav>${DOCS_NAV.map(([label, href]) => `<a class="${href === pathname ? "active" : ""}" href="${href}">${label}</a>`).join("")}</nav>
        </aside>
        <article class="docs-content">
          ${page.body}
        </article>
        <nav class="toc">
          <a href="/llms.txt">llms.txt</a>
          <a href="/openapi.json">OpenAPI</a>
          <a href="/.well-known/c402.json">Catalog</a>
        </nav>
      </div>
    `
  });
}

export function renderLlmsTxt(baseUrl: string): string {
  return `# c402

Purpose-bound credit for AI agents over HTTP.

## Documentation

- Overview: ${baseUrl}/docs
- How to get started with c402: ${baseUrl}/docs/get-started
- Borrower agents: ${baseUrl}/docs/borrowers
- Lender agents: ${baseUrl}/docs/lenders
- Protocol: ${baseUrl}/docs/protocol
- API reference: ${baseUrl}/docs/api-reference
- Security model: ${baseUrl}/docs/security
- x402 compatibility: ${baseUrl}/docs/x402-compatibility

## Machine-readable endpoints

- Service catalog: ${baseUrl}/.well-known/c402.json
- OpenAPI: ${baseUrl}/openapi.json
- Health: ${baseUrl}/health
- Flare x402 supported: ${baseUrl}/x402/flare-facilitator/supported

## Core invariants

- Lender funds do not enter the borrower wallet.
- Credit is purpose-bound to an approved supplier and supplier domain.
- Every approved loan has a lien.
- principal + maximum borrower fee <= hard liquidatable recovery value.
- Flare Confidential Compute is used for private underwriting and confidential compute receipts.
- Base Sepolia uses the public x402 facilitator.
- Flare Coston2 uses c402's x402 facilitator with Permit2 over testUSDT0.
`;
}

function pageShell(input: { title: string; description: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(input.description)}">
  <title>${escapeHtml(input.title)}</title>
  <style>${CSS}</style>
</head>
<body>
${input.body}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const CSS = `
:root {
  color-scheme: light;
  --text: #1a1a1a;
  --muted: #666;
  --line: #d9d9d9;
  --soft: #f3f3f3;
  --green: #16833a;
  --black: #111;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--text); background: #fff; }
a { color: inherit; text-decoration: none; }
p { color: var(--muted); line-height: 1.55; }
pre { margin: 0; padding: 20px; background: #f0f0f0; overflow: auto; border: 1px solid #e2e2e2; }
code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 13px; }
.landing { max-width: 1120px; margin: 0 auto; padding: 28px 28px 0; }
.topbar { display: flex; justify-content: space-between; align-items: center; min-height: 48px; border-bottom: 1px solid var(--line); }
.brand { font-size: 36px; font-weight: 700; letter-spacing: 0; }
.topbar div { display: flex; gap: 24px; font-size: 13px; text-transform: uppercase; }
.hero { display: flex; justify-content: center; padding: 76px 0 56px; text-align: center; }
.hero-inner { width: min(100%, 820px); }
.eyebrow { margin: 0 0 14px; color: #555; text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 76px; line-height: .98; font-weight: 400; letter-spacing: 0; }
h2 { margin: 0 0 18px; font-family: Georgia, "Times New Roman", serif; font-size: 42px; line-height: 1.05; font-weight: 400; letter-spacing: 0; }
.hero-copy { max-width: 640px; margin: 22px auto 0; font-size: 18px; }
.actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; margin-top: 28px; }
.button { display: inline-flex; align-items: center; min-height: 42px; padding: 0 18px; background: var(--black); color: #fff; border: 1px solid var(--black); font-weight: 700; font-size: 13px; }
.button.secondary { background: #fff; color: var(--black); }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; padding: 22px 0 54px; }
.metrics strong { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 34px; font-weight: 400; }
.metrics span { color: var(--muted); font-size: 13px; }
.code-card { border: 2px solid var(--black); padding: 18px; margin-bottom: 56px; }
.code-card h2 { font-size: 26px; margin-bottom: 14px; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; padding: 64px 0; border-top: 1px solid var(--line); }
.split a { color: var(--green); font-weight: 700; }
.principles { padding: 54px 0; background: var(--soft); margin: 0 -28px; padding-left: 28px; padding-right: 28px; }
.principle-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; }
.principle-grid article { min-height: 120px; }
.principle-grid strong { display: block; font-size: 18px; margin-bottom: 10px; }
.principle-grid span { color: var(--muted); font-size: 14px; line-height: 1.45; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; padding: 64px 0; }
.compare ol { padding-left: 20px; color: var(--muted); line-height: 1.8; }
.compare div:nth-child(2) ol { color: var(--green); font-weight: 700; }
.faq { padding: 54px 0 80px; border-top: 1px solid var(--line); }
details { border-bottom: 1px solid var(--line); padding: 22px 0; }
summary { cursor: pointer; font-family: Georgia, "Times New Roman", serif; font-size: 26px; }
footer { display: flex; gap: 24px; justify-content: center; padding: 36px 0; background: #171717; color: #aaa; margin: 0 -28px; }
.docs-layout { display: grid; grid-template-columns: 260px minmax(0, 760px) 180px; gap: 42px; max-width: 1240px; margin: 0 auto; padding: 28px; }
aside { position: sticky; top: 24px; align-self: start; height: calc(100vh - 48px); border-right: 1px solid var(--line); padding-right: 22px; }
aside .brand { display: block; margin-bottom: 30px; }
aside nav { display: grid; gap: 6px; }
aside nav a { padding: 8px 10px; color: var(--muted); border-radius: 4px; font-size: 14px; }
aside nav a.active, aside nav a:hover { color: var(--text); background: var(--soft); }
.docs-content { padding: 28px 0 80px; }
.docs-content h1 { font-size: 52px; margin-bottom: 20px; }
.docs-content h2 { font-family: inherit; font-size: 24px; font-weight: 700; margin-top: 42px; }
.lead { font-size: 18px; color: #424242; }
.link-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.link-grid a { border: 1px solid var(--line); padding: 16px; }
.link-grid strong, .link-grid span { display: block; }
.link-grid span { color: var(--muted); margin-top: 8px; font-size: 14px; line-height: 1.45; }
.docs-content li { margin: 8px 0; color: #444; }
.docs-content table { width: 100%; border-collapse: collapse; margin: 22px 0; font-size: 14px; }
.docs-content th, .docs-content td { border-bottom: 1px solid var(--line); padding: 12px 8px; text-align: left; vertical-align: top; }
.toc { position: sticky; top: 28px; align-self: start; display: grid; gap: 10px; font-size: 13px; color: var(--muted); }
@media (max-width: 900px) {
  .landing { padding: 20px; }
  .topbar { align-items: flex-start; gap: 18px; flex-direction: column; padding-bottom: 16px; }
  .split, .compare, .metrics, .principle-grid, .docs-layout, .link-grid { grid-template-columns: 1fr; }
  .hero { padding: 44px 0 38px; }
  h1 { font-size: 44px; }
  h2 { font-size: 30px; }
  .docs-layout { padding: 20px; }
  aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: 0 0 20px; }
  .toc { display: none; }
}
`;
