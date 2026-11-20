// Live-service checks for docs/app.js (MAINTENANCE = false).
// History: usable-with-maintenance-note from 2026-11-19; maintenance
// ENDED by owner decision on 2026-11-20 after the first successful
// live auto-swap, and the note banner was removed entirely:
//   - neither HTML file carries the retired banner panel (app.js?v=13)
//   - with a connected wallet: every write button (approve / register /
//     disable / revoke / gas deposit + its amount input) is ENABLED
//   - the status banner follows the Worker status (running, green dot)
//     instead of a forced maintenance label; the schedule displays
//     (next-run card, clock panel) are visible again
//   - a gas deposit click sends exactly one depositGas transaction with
//     the entered value, and a withdrawal click sends one withdrawGas
//     transaction — both to the AutoSwap contract
// Runs the real docs/app.js in the same fake-DOM style as
// verify-maintenance.mjs. Checked in BOTH languages.
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

function rpcResult(method, params) {
  switch (method) {
    case "eth_blockNumber": return "0x1000";
    case "eth_getBlockByNumber":
      return { number: "0x1000", timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16) };
    case "eth_call": {
      const data = (params && params[0] && params[0].data) || "";
      const to = ((params && params[0] && params[0].to) || "").toLowerCase();
      // The retired v1 contract still holds a 0.5 [42] gas credit.
      if (to === "0x478bd3bbd12b906a83c803aa6c14684d150ab994" && data.indexOf("0x894912ac") === 0)
        return "0x" + (500000000000000000n).toString(16).padStart(64, "0");
      // The approve-button state sync reads the FISH allowance: give
      // the test account a real one (2000 FISH) to exercise it.
      if (data.indexOf("0xdd62ed3e") === 0) return "0x" + (2000n * (10n ** 18n)).toString(16).padStart(64, "0");
      return "0x" + "0".repeat(64 * 6);
    }
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
    return { json: async () => body.map((c) => ({ jsonrpc: "2.0", id: c.id, result: rpcResult(c.method, c.params) })) };
  }
  return { json: async () => ({ jsonrpc: "2.0", id: body.id, result: rpcResult(body.method, body.params) }) };
}

const INITIALLY_HIDDEN = [
  "noWalletPanel", "accountBox", "dropPanel", "histPanel", "myStatusPanel",
  "connectBtnList", "switchChainBtn", "customBox", "gasWarn", "statusReason", "v1Panel",
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

/* The flag itself: usable mode must be the shipped state. */
{
  const src = readFileSync(new URL("../docs/app.js", import.meta.url), "utf8");
  assert(/var MAINTENANCE = false;/.test(src), "app.js: MAINTENANCE flag is false (usable mode)");
}

/* HTML-level: the retired maintenance banner is gone from both pages. */
for (const lang of ["en", "ja"]) {
  const html = readFileSync(new URL("../docs/" + lang + ".html", import.meta.url), "utf8");
  assert(!html.includes('id="maintenancePanel"'), lang + ".html: maintenance banner panel removed");
  assert(!html.includes('id="maintenanceText"'), lang + ".html: banner text element removed");
  assert(html.includes("app.js?v=13"), lang + ".html: cache-buster bumped to v=13");
}
const CONTRACT = "0x67e99d8a7bf5f71370391732847e038578f1290d";

async function testUsable(lang) {
  console.log("scenario: live service mode (" + lang + ")");
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

  // No maintenance banner exists anymore (removed 2026-11-20); the
  // status assertions below pin the normal live-service presentation.

  // Status banner follows the Worker (stub: ready) — running + green dot,
  // NOT the forced maintenance label. Schedule displays are back.
  assert(!els.statusText.textContent.includes("使用可能（メンテナンス中）") &&
         !els.statusText.textContent.includes("Usable (under maintenance)"),
    lang + ": status not forced to maintenance: " + els.statusText.textContent);
  assert(/(^|\s)on(\s|$)/.test(els.statusDot.className), lang + ": status dot green (" + els.statusDot.className + ")");
  // In usable mode app.js never touches the card/panel elements (they
  // are plain visible markup); materialise them via the document the
  // way the real page provides them.
  assert(env.documentStub.getElementById("nextRunCard").hidden === false, lang + ": next-run card visible");
  assert(env.documentStub.getElementById("clockPanel").hidden === false, lang + ": clock panel visible");

  // Registration panel note is NOT forced to the maintenance note.
  assert(els.comingSoon.hidden === true, lang + ": registration note stays hidden (service open)");

  // Every write action enabled again. (Some elements are only touched
  // by app.js at click time in usable mode; materialise via document.)
  const E = (id) => env.documentStub.getElementById(id);
  for (const id of ["approveBtn", "registerBtn", "disableBtn", "revokeBtn",
                    "gasDepositBtn", "gasDepositAmount", "gasWithdrawBtn", "gasWithdrawAmount"]) {
    assert(E(id).disabled === false, lang + ": " + id + " NOT disabled");
  }

  // Approve button mirrors the on-chain allowance (stub: 2000 FISH).
  // An amount the allowance covers flips it to the disabled done
  // state; raising the amount past the allowance re-enables it.
  E("approveAmount").value = "1500";
  E("rescanBtn").click();
  await flush(900);
  assert(E("approveBtn").disabled === true, lang + ": approve disabled when the allowance covers the amount");
  assert(E("approveBtn").textContent === (lang === "ja" ? "許可しました" : "Approved"),
    lang + ": approve shows the done label: " + E("approveBtn").textContent);
  E("approveAmount").value = "2500";
  E("rescanBtn").click();
  await flush(900);
  assert(E("approveBtn").disabled === false, lang + ": approve re-enabled above the allowance");
  assert(E("approveBtn").textContent === (lang === "ja" ? "許可する" : "Approve"),
    lang + ": approve label restored: " + E("approveBtn").textContent);

  // Gas deposit sends exactly one depositGas tx carrying the value.
  E("gasDepositAmount").value = "0.15";
  E("gasDepositBtn").click();
  await flush(3800); // sendTx waits one 3s receipt poll
  assert(sentTxs.length === 1, lang + ": deposit sent exactly one transaction");
  let tx = sentTxs[0];
  assert(String(tx.data).startsWith("0xae9bb692"),
    lang + ": deposit calls depositGas (0xae9bb692): " + String(tx.data).slice(0, 10));
  assert(String(tx.to).toLowerCase() === CONTRACT, lang + ": deposit targets the AutoSwap contract");
  assert(BigInt(tx.value) === 150000000000000000n, lang + ": deposit carries 0.15 [42]");

  // Withdrawal still works end to end via withdrawGas.
  sentTxs.length = 0;
  E("gasWithdrawAmount").value = "0.1";
  E("gasWithdrawBtn").click();
  await flush(3800);
  assert(sentTxs.length === 1, lang + ": withdrawal sent exactly one transaction");
  tx = sentTxs[0];
  assert(String(tx.data).startsWith("0x91657544"),
    lang + ": withdrawal calls withdrawGas (0x91657544): " + String(tx.data).slice(0, 10));
  assert(String(tx.to).toLowerCase() === CONTRACT, lang + ": withdrawal targets the AutoSwap contract");

  // v1 leftover: the panel shows the retired contract's credit and
  // its button withdraws the full amount from the v1 address.
  assert(E("v1Panel").hidden === false, lang + ": v1 leftover panel shown");
  assert(E("v1Credit").textContent === "0.5 [42]", lang + ": v1 credit shown: " + E("v1Credit").textContent);
  sentTxs.length = 0;
  E("v1WithdrawBtn").click();
  await flush(3800);
  assert(sentTxs.length === 1, lang + ": v1 withdrawal sent exactly one transaction");
  tx = sentTxs[0];
  assert(String(tx.data).startsWith("0x91657544"),
    lang + ": v1 withdrawal calls withdrawGas (0x91657544): " + String(tx.data).slice(0, 10));
  assert(String(tx.to).toLowerCase() === "0x478bd3bbd12b906a83c803aa6c14684d150ab994",
    lang + ": v1 withdrawal targets the v1 contract");
  assert(BigInt("0x" + String(tx.data).slice(10)) === 500000000000000000n,
    lang + ": v1 withdrawal takes the full 0.5 [42]");
}

await testUsable("en");
await testUsable("ja");
console.log("USABLE VERIFY OK — live service (no maintenance banner), enabled writes, deposit + withdrawal all pass.");
