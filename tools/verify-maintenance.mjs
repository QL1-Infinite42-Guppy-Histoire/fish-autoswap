// Maintenance-mode checks for docs/app.js (MAINTENANCE = true):
//   - both HTML files carry the maintenance banner panel
//   - with a connected wallet: write buttons (approve / register /
//     disable / revoke / gas deposit + its amount input) are disabled
//     and clicking one sends NO transaction
//   - the status banner shows the maintenance label (dot not green),
//     and the schedule displays (next-run card, clock panel) are hidden
//   - the gas-withdrawal flow still works end to end: clicking
//     "Take back" sends a withdrawGas (0x91657544) transaction
// Runs the real docs/app.js in the same fake-DOM style as
// verify-wallet-ux.mjs. Checked in BOTH languages.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CHAIN_HEX = "0x66c9a"; // 421018
const flush = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok -", msg);
}

class FakeEl {
  constructor(tag) {
    this.tagName = tag || "div";
    this.children = [];
    this.className = "";
    this._text = "";
    this.hidden = false;
    this.disabled = false;
    this.style = {};
    this.value = "";
    this.href = "";
    this._handlers = {};
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set innerHTML(v) { if (v === "") { this.children = []; this._text = ""; } }
  get innerHTML() { return ""; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  addEventListener(ev, fn) { (this._handlers[ev] ||= []).push(fn); }
  click() {
    if (this.disabled) return;
    (this._handlers.click || []).forEach((fn) => fn.call(this, { preventDefault() {} }));
  }
  setAttribute(k, v) { this["attr_" + k] = v; }
  getAttribute(k) { return this["attr_" + k]; }
  select() { this._selected = true; }
  querySelectorAll() { return []; }
}

function makeDocument(els) {
  let readyFn = null;
  return {
    body: new FakeEl("body"),
    _fireReady() { if (readyFn) readyFn(); },
    addEventListener(ev, fn) { if (ev === "DOMContentLoaded") readyFn = fn; },
    getElementById(id) { return els[id] || (els[id] = new FakeEl("div")); },
    createElement(tag) { return new FakeEl(tag); },
    createTextNode(txt) { const n = new FakeEl("#text"); n.textContent = txt; return n; },
    querySelectorAll() { return []; },
    execCommand() { return true; },
  };
}

function rpcResult(method) {
  switch (method) {
    case "eth_blockNumber": return "0x1000";
    case "eth_getBlockByNumber":
      return { number: "0x1000", timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16) };
    case "eth_call": return "0x" + "0".repeat(64 * 6);
    case "eth_getLogs": return [];
    case "eth_getTransactionReceipt": return { status: "0x1" };
    default: return "0x";
  }
}
async function fetchStub(url, opts) {
  const u = String(url);
  if (u.includes("workers.dev")) {
    const payload = u.includes("/history") ? { ok: true, items: [] } : { ready: true, users: 1 };
    return { json: async () => payload };
  }
  const body = JSON.parse(opts.body);
  if (Array.isArray(body)) {
    return { json: async () => body.map((c) => ({ jsonrpc: "2.0", id: c.id, result: rpcResult(c.method) })) };
  }
  return { json: async () => ({ jsonrpc: "2.0", id: body.id, result: rpcResult(body.method) }) };
}

const INITIALLY_HIDDEN = [
  "noWalletPanel", "accountBox", "dropPanel", "histPanel", "myStatusPanel",
  "connectBtnList", "switchChainBtn", "customBox", "gasWarn", "statusReason",
  "myStatusNote", "comingSoon",
];
function buildEnv(lang) {
  const els = {};
  const documentStub = makeDocument(els);
  const winHandlers = {};
  const pathname = "/fish-autoswap/" + lang + ".html";
  const sandbox = {
    console, fetch: fetchStub,
    setTimeout: (fn, ms, ...a) => { const h = setTimeout(fn, ms, ...a); if (h && h.unref) h.unref(); return h; },
    setInterval: (fn, ms, ...a) => { const h = setInterval(fn, ms, ...a); if (h && h.unref) h.unref(); return h; },
    clearTimeout, clearInterval,
    escape, unescape,
    Event: class { constructor(type) { this.type = type; } },
    navigator: {},
    location: { pathname, host: "h.test", href: "https://h.test" + pathname, reload() {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: documentStub,
    addEventListener(ev, fn) { (winHandlers[ev] ||= []).push(fn); },
    removeEventListener(ev, fn) {
      if (winHandlers[ev]) winHandlers[ev] = winHandlers[ev].filter((f) => f !== fn);
    },
    dispatchEvent(ev) { (winHandlers[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = readFileSync(new URL("../docs/app.js", import.meta.url), "utf8");
  vm.runInContext(src, sandbox);
  INITIALLY_HIDDEN.forEach((id) => { documentStub.getElementById(id).hidden = true; });
  return { sandbox, els, documentStub };
}

/* HTML-level: the banner panel exists in both language pages. */
for (const lang of ["en", "ja"]) {
  const html = readFileSync(new URL("../docs/" + lang + ".html", import.meta.url), "utf8");
  assert(html.includes('id="maintenancePanel"'), lang + ".html: maintenance banner panel present");
  assert(html.includes('id="maintenanceTitle"'), lang + ".html: banner title element present");
  assert(html.includes('id="maintenanceText"'), lang + ".html: banner text element present");
  assert(html.includes("app.js?v=7"), lang + ".html: cache-buster bumped to v=7");
}

async function testMaintenance(lang) {
  console.log("scenario: maintenance mode (" + lang + ")");
  const ADDR = "0x7777777777777777777777777777777777777777";
  const sentTxs = [];
  const provider = {
    isMetaMask: true,
    on() {},
    request(req) {
      if (req.method === "eth_accounts") return Promise.resolve([ADDR]);
      if (req.method === "eth_requestAccounts") return Promise.resolve([ADDR]);
      if (req.method === "eth_chainId") return Promise.resolve(CHAIN_HEX);
      if (req.method === "eth_sendTransaction") {
        sentTxs.push(req.params[0]);
        return Promise.resolve("0x" + "ef".repeat(32));
      }
      return Promise.resolve(null);
    },
  };
  const env = buildEnv(lang);
  env.sandbox.ethereum = provider;
  env.documentStub._fireReady();
  await flush(600); // auto-reconnect + first renders settle
  const els = env.els;

  assert(els.accountBox.hidden === false, lang + ": wallet auto-reconnected (reads keep working)");

  // Banner content filled from i18n.
  assert(els.maintenanceTitle.textContent.includes("🛠️"), lang + ": banner title: " + els.maintenanceTitle.textContent);
  assert(els.maintenanceText.textContent.length > 20, lang + ": banner text present");
  // app.js never touches the panel element itself (it is plain visible
  // markup); materialise it the way the real page provides it.
  assert(env.documentStub.getElementById("maintenancePanel").hidden === false,
    lang + ": banner panel visible");

  // Status banner: maintenance label, dot not green, schedule hidden.
  assert(els.statusText.textContent.includes("🛠️"), lang + ": status shows maintenance: " + els.statusText.textContent);
  assert(!/(^|\s)on(\s|$)/.test(els.statusDot.className), lang + ": status dot not green (" + els.statusDot.className + ")");
  assert(els.nextRunCard.hidden === true, lang + ": next-run card hidden");
  assert(els.clockPanel.hidden === true, lang + ": clock panel hidden");

  // Registration panel note shown.
  assert(els.comingSoon.hidden === false, lang + ": maintenance note shown in registration panel");
  assert(els.comingSoon.textContent.includes("🛠️"), lang + ": note text is the maintenance note");

  // Write actions gated.
  for (const id of ["approveBtn", "registerBtn", "disableBtn", "revokeBtn", "gasDepositBtn", "gasDepositAmount"]) {
    assert(els[id].disabled === true, lang + ": " + id + " disabled");
  }
  // Withdrawal untouched. (The amount input is materialised via the
  // document the way the real page provides it in markup.)
  assert(els.gasWithdrawBtn.disabled === false, lang + ": gasWithdrawBtn NOT disabled");
  assert(env.documentStub.getElementById("gasWithdrawAmount").disabled === false,
    lang + ": gasWithdrawAmount NOT disabled");

  // Clicking a gated button sends nothing.
  els.approveAmount.value = "5";
  els.approveBtn.click();
  els.gasDepositAmount.value = "0.15";
  els.gasDepositBtn.click();
  await flush(200);
  assert(sentTxs.length === 0, lang + ": gated buttons sent no transaction");

  // Withdrawal works end to end via withdrawGas.
  env.documentStub.getElementById("gasWithdrawAmount").value = "0.1";
  els.gasWithdrawBtn.click();
  await flush(3800); // sendTx waits one 3s receipt poll
  assert(sentTxs.length === 1, lang + ": withdrawal sent exactly one transaction");
  const tx = sentTxs[0];
  assert(String(tx.data).startsWith("0x91657544"),
    lang + ": withdrawal calls withdrawGas (0x91657544): " + String(tx.data).slice(0, 10));
  assert(String(tx.to).toLowerCase() === "0x478bd3bbd12b906a83c803aa6c14684d150ab994",
    lang + ": withdrawal targets the AutoSwap contract");
}

await testMaintenance("en");
await testMaintenance("ja");
console.log("MAINTENANCE VERIFY OK — banner, gating and withdrawal all pass.");
