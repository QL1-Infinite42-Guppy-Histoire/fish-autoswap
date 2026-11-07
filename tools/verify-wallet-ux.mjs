// Exercise the wallet-connection UX of docs/app.js in a fake DOM:
//   1. no provider (ja + en) -> no-wallet panel with a correctly built
//      metamask.app.link deep link + a working copy-URL fallback
//   2. eth_accounts auto-reconnect restores the session without a tap
//   3. auto-reconnect on the wrong chain -> switch button, no auto-switch
//   4. single provider -> one button, "check your wallet app" pending
//      state, repeat taps ignored while pending, label restored after
//   5. multiple providers -> one labelled button each, and requests +
//      transactions + listeners all go through the CHOSEN provider
//   6. provider injected 500ms late -> picked up without a reload
//   7. FoxWallet-only environment (window.foxwallet.ethereum, no
//      window.ethereum) -> connect + chain switch work end to end
//   8. EIP-6963 announcements -> become labelled candidates
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CHAIN_HEX = "0x66c9a"; // 421018
const flush = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok -", msg);
}

/* ---------- fake DOM ---------- */
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
  removeChild(c) {
    this.children = this.children.filter((x) => x !== c);
    return c;
  }
  addEventListener(ev, fn) { (this._handlers[ev] ||= []).push(fn); }
  click() {
    if (this.disabled) return; // real browsers do not fire clicks on disabled buttons
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
    createTextNode(txt) {
      const n = new FakeEl("#text");
      n.textContent = txt;
      return n;
    },
    querySelectorAll() { return []; },
    execCommand() { return true; },
  };
}

/* ---------- fetch stub (public RPC + worker) ---------- */
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
    return {
      json: async () => body.map((c) => ({ jsonrpc: "2.0", id: c.id, result: rpcResult(c.method) })),
    };
  }
  return { json: async () => ({ jsonrpc: "2.0", id: body.id, result: rpcResult(body.method) }) };
}

/* ---------- mock wallet provider ---------- */
function mockProvider(opts = {}) {
  const state = {
    chainId: opts.chainId || CHAIN_HEX,
    accounts: opts.accounts || [],
    requestAccounts: opts.requestAccounts || [],
  };
  const calls = [];
  const listeners = {};
  const p = {
    calls, listeners, state,
    isMetaMask: !!opts.isMetaMask,
    isFoxWallet: !!opts.isFoxWallet,
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    request(req) {
      calls.push(req.method);
      if (opts.onRequest) {
        const r = opts.onRequest(req, p);
        if (r !== undefined) return r;
      }
      switch (req.method) {
        case "eth_accounts": return Promise.resolve(state.accounts);
        case "eth_requestAccounts": return Promise.resolve(state.requestAccounts);
        case "eth_chainId": return Promise.resolve(state.chainId);
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          state.chainId = req.params[0].chainId;
          return Promise.resolve(null);
        case "eth_sendTransaction": return Promise.resolve("0x" + "cd".repeat(32));
        default: return Promise.resolve(null);
      }
    },
  };
  if (opts.providers) p.providers = opts.providers;
  return p;
}

/* ---------- environment ---------- */
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
    // unref'd timers: app.js sets long-lived intervals (clocks, status
    // polling) that must not keep this harness process alive at the end.
    setTimeout: (fn, ms, ...a) => {
      const h = setTimeout(fn, ms, ...a);
      if (h && h.unref) h.unref();
      return h;
    },
    setInterval: (fn, ms, ...a) => {
      const h = setInterval(fn, ms, ...a);
      if (h && h.unref) h.unref();
      return h;
    },
    clearTimeout, clearInterval,
    escape, unescape,
    Event: class { constructor(type) { this.type = type; } },
    navigator: {},
    location: {
      pathname, host: "h.test",
      href: "https://h.test" + pathname,
      reload() {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: documentStub,
    addEventListener(ev, fn) { (winHandlers[ev] ||= []).push(fn); },
    removeEventListener(ev, fn) {
      if (winHandlers[ev]) winHandlers[ev] = winHandlers[ev].filter((f) => f !== fn);
    },
    dispatchEvent(ev) {
      (winHandlers[ev.type] || []).slice().forEach((fn) => fn(ev));
      return true;
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = readFileSync(new URL("../docs/app.js", import.meta.url), "utf8");
  vm.runInContext(src, sandbox);
  INITIALLY_HIDDEN.forEach((id) => { documentStub.getElementById(id).hidden = true; });
  return { sandbox, els, documentStub };
}

/* ---------- scenarios ---------- */
async function testNoProvider(lang) {
  console.log("scenario: no provider (" + lang + ")");
  const { els, documentStub } = buildEnv(lang);
  documentStub._fireReady();
  await flush(3400); // the full ~3s late-injection wait window
  assert(els.noWalletPanel.hidden === false, lang + ": no-wallet panel shown");
  assert(els.connectPanel.hidden === true, lang + ": connect panel hidden");
  const want = "https://metamask.app.link/dapp/h.test/fish-autoswap/" + lang + ".html";
  assert(els.mmOpenLink.href === want, lang + ": deep link = " + els.mmOpenLink.href);
  assert(els.mmOpenLink.textContent.length > 0, lang + ": MetaMask button labelled");
  assert(els.copyUrlBtn.textContent.length > 0, lang + ": copy button labelled");
  if (lang === "en") {
    els.copyUrlBtn.click(); // clipboard API absent -> textarea fallback (execCommand stub)
    await flush(100);
    assert(els.copyUrlResult.textContent.includes("Copied!"),
      "en: copy fallback reports success: " + els.copyUrlResult.textContent);
  }
}

async function testAutoRestore() {
  console.log("scenario: eth_accounts auto-reconnect");
  const ADDR = "0x1111111111111111111111111111111111111111";
  const mm = mockProvider({ isMetaMask: true, accounts: [ADDR] });
  const env = buildEnv("en");
  env.sandbox.ethereum = mm;
  env.documentStub._fireReady();
  await flush(400);
  assert(mm.calls.includes("eth_accounts"), "eth_accounts probed on load");
  assert(!mm.calls.includes("eth_requestAccounts"), "no eth_requestAccounts without a tap");
  assert(env.els.accountBox.hidden === false, "session restored (account box shown)");
  assert(env.els.walletAddr.textContent === ADDR, "restored address displayed");
}

async function testAutoRestoreWrongChain() {
  console.log("scenario: auto-reconnect on wrong chain");
  const ADDR = "0x2222222222222222222222222222222222222222";
  const mm = mockProvider({ isMetaMask: true, accounts: [ADDR], chainId: "0x1" });
  const env = buildEnv("ja");
  env.sandbox.ethereum = mm;
  env.documentStub._fireReady();
  await flush(400);
  assert(!mm.calls.includes("wallet_switchEthereumChain"), "no auto chain switch attempted");
  assert(env.els.switchChainBtn.hidden === false, "switch button shown prominently");
  assert(env.els.connectResult.textContent.includes("42 Chain"), "wrong-chain message shown");
  assert(env.els.accountBox.hidden === true, "account box held back until switch");
  env.els.switchChainBtn.click();
  await flush(300);
  assert(mm.calls.includes("wallet_switchEthereumChain"), "manual switch went through the provider");
  assert(env.els.accountBox.hidden === false, "account box shown after switch");
}

async function testSingleProviderPending() {
  console.log("scenario: single provider + pending feedback");
  const ADDR = "0x3333333333333333333333333333333333333333";
  let release;
  const gate = new Promise((r) => { release = r; });
  const mm = mockProvider({
    isMetaMask: true,
    onRequest(req) {
      if (req.method === "eth_requestAccounts") return gate.then(() => [ADDR]);
      return undefined;
    },
  });
  const env = buildEnv("en");
  env.sandbox.ethereum = mm;
  env.documentStub._fireReady();
  await flush(300);
  assert(env.els.connectBtnList.hidden === true, "button list hidden for a single provider");
  assert(env.els.connectBtn.hidden === false, "single connect button visible");
  const btn = env.els.connectBtn;
  const origText = btn.textContent;
  btn.click();
  await flush(30);
  assert(btn.disabled === true, "button disabled while the request is pending");
  assert(btn.textContent === "Check your wallet app…", "pending label shown: " + btn.textContent);
  btn.click(); // disabled -> must not fire again
  await flush(30);
  assert(mm.calls.filter((m) => m === "eth_requestAccounts").length === 1,
    "repeat tap did not re-request accounts");
  release();
  await flush(400);
  assert(env.els.accountBox.hidden === false, "connected after approval");
  assert(btn.disabled === false && btn.textContent === origText, "button label/state restored");
}

async function testMultiProvider() {
  console.log("scenario: multiple providers -> labelled buttons, chosen one used");
  const ADDR = "0x4444444444444444444444444444444444444444";
  const mm = mockProvider({ isMetaMask: true });
  const fox = mockProvider({ isFoxWallet: true, requestAccounts: [ADDR] });
  mm.providers = [mm, fox];
  const env = buildEnv("en");
  env.sandbox.ethereum = mm;
  env.sandbox.foxwallet = { ethereum: fox };
  env.documentStub._fireReady();
  await flush(300);
  assert(env.els.connectBtn.hidden === true, "generic button hidden in multi mode");
  const list = env.els.connectBtnList;
  assert(list.hidden === false && list.children.length === 2,
    "exactly two candidate buttons (deduped): " + list.children.length);
  const labels = list.children.map((b) => b.textContent);
  assert(labels.some((x) => x.includes("MetaMask")), "MetaMask label present: " + labels.join(" / "));
  assert(labels.some((x) => x.includes("FoxWallet")), "FoxWallet label present: " + labels.join(" / "));
  list.children.find((b) => b.textContent.includes("FoxWallet")).click();
  await flush(300);
  assert(fox.calls.includes("eth_requestAccounts"), "chosen FoxWallet got eth_requestAccounts");
  assert(!mm.calls.includes("eth_requestAccounts"), "MetaMask was not asked");
  assert(env.els.accountBox.hidden === false, "connected through FoxWallet");
  assert(fox.listeners.accountsChanged && fox.listeners.accountsChanged.length === 1,
    "accountsChanged listener attached to the chosen provider");
  env.els.approveAmount.value = "5";
  env.els.approveBtn.click();
  await flush(3800); // sendTx waits one 3s receipt poll
  assert(fox.calls.includes("eth_sendTransaction"), "transaction sent through FoxWallet");
  assert(!mm.calls.includes("eth_sendTransaction"), "transaction NOT sent through MetaMask");
}

async function testLateInjection() {
  console.log("scenario: provider injected 500ms late");
  const ADDR = "0x5555555555555555555555555555555555555555";
  const env = buildEnv("ja");
  env.documentStub._fireReady();
  const mm = mockProvider({ isMetaMask: true, accounts: [ADDR] });
  setTimeout(() => { env.sandbox.ethereum = mm; }, 500);
  await flush(2000);
  assert(env.els.noWalletPanel.hidden === true, "no-wallet panel never shown");
  assert(env.documentStub.getElementById("connectPanel").hidden === false, "connect panel available");
  assert(mm.calls.includes("eth_accounts"), "auto-reconnect ran for the late provider");
  assert(env.els.accountBox.hidden === false, "session restored without a reload");
}

async function testFoxOnly() {
  console.log("scenario: FoxWallet-only environment (no window.ethereum)");
  const ADDR = "0x6666666666666666666666666666666666666666";
  const fox = mockProvider({ isFoxWallet: true, requestAccounts: [ADDR], chainId: "0x1" });
  const env = buildEnv("ja");
  env.sandbox.foxwallet = { ethereum: fox };
  env.documentStub._fireReady();
  await flush(300);
  assert(env.els.noWalletPanel.hidden === true, "no-wallet panel not shown");
  assert(env.els.connectBtn.hidden === false, "single connect button offered");
  env.els.connectBtn.click();
  await flush(400);
  assert(fox.calls.includes("eth_requestAccounts"), "connect went through foxwallet.ethereum");
  assert(fox.calls.includes("wallet_switchEthereumChain"), "chain switch to 421018 through FoxWallet");
  assert(env.els.accountBox.hidden === false, "connected in a FoxWallet-only environment");
}

async function testEip6963() {
  console.log("scenario: EIP-6963 announcements");
  const a = mockProvider({});
  const b = mockProvider({});
  const env = buildEnv("en");
  env.documentStub._fireReady();
  setTimeout(() => {
    env.sandbox.dispatchEvent({
      type: "eip6963:announceProvider",
      detail: { info: { name: "Wallet Alpha", uuid: "a" }, provider: a },
    });
    env.sandbox.dispatchEvent({
      type: "eip6963:announceProvider",
      detail: { info: { name: "Wallet Beta", uuid: "b" }, provider: b },
    });
  }, 200);
  await flush(1600);
  assert(env.els.noWalletPanel.hidden === true, "announced providers picked up (no dead end)");
  const list = env.els.connectBtnList;
  assert(list.hidden === false && list.children.length === 2, "two announced candidates rendered");
  const labels = list.children.map((x) => x.textContent);
  assert(labels.some((x) => x.includes("Wallet Alpha")), "info.name label used (Alpha): " + labels.join(" / "));
  assert(labels.some((x) => x.includes("Wallet Beta")), "info.name label used (Beta): " + labels.join(" / "));
  assert(a.calls.includes("eth_accounts"), "auto-reconnect probed the default announced provider");
}

await Promise.all([testNoProvider("ja"), testNoProvider("en")]);
await testAutoRestore();
await testAutoRestoreWrongChain();
await testSingleProviderPending();
await testMultiProvider();
await testLateInjection();
await testFoxOnly();
await testEip6963();
console.log("WALLET UX VERIFY OK — all scenarios passed.");
