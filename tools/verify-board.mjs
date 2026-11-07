// Load docs/app.js with minimal browser stubs and exercise the REAL
// registered-addresses board (loadBoard) against the live 42 Chain
// contract — then compare the rendered rows with an independent
// ground-truth read done with raw batched eth_calls in this script.
//
// Ground truth is read fresh here (no hardcoded expectations beyond
// the contract address); the assertions check that the board renders
// exactly what the chain says: count, addresses, target symbols,
// enabled flags and percents.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CONTRACT = "0x478bd3bbd12b906a83c803aa6c14684d150ab994";
const RPC = "https://evm-rpc.infinitedrive.xyz";
const EXPLORER = "https://scan.infinitedrive.xyz";

/* ---------- independent ground truth (raw JSON-RPC batch) ---------- */
let rid = 1;
async function batch(calls) {
  const body = calls.map((c) => ({
    jsonrpc: "2.0", id: rid++, method: "eth_call",
    params: [{ to: c.to, data: c.data }, "latest"],
  }));
  const r = await fetch(RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  const byId = {};
  j.forEach((d) => { byId[d.id] = d; });
  return body.map((p) => {
    const d = byId[p.id];
    if (!d || d.error) throw new Error("ground truth rpc failed");
    return d.result;
  });
}
const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const TOKENS = {
  "0x53465cbbba5b14f5dc00794330f0f4afb30eaa1d": "QOM",
  "0xc2684966e5c95b2bc636fb4a1f3da9ad23d94753": "USDT",
  "0x7386719ebbbeb4d810ff89027bfb8a1cdf696310": "CAT42",
  "0x89195ca5c954b6f99b78f4a2aa5435a75dc5b256": "ZAP",
  "0x8981f00e92f31a87af12f980383d2217706258e7": "FATHER",
  "0xb749d42e6004db590b2f04f32b87485402a061e2": "KET",
  "0x77479226c103cc3c142faff6691bc7f849ce9c92": "BABY",
  "0xa307362f8a756722541dde6255aecf64f35ba337": "MARVIN",
  "0xf4c14c0322e361f35eb9465c992fb1c21c91c156": "O",
  "0xfaa842c8871f7f99c183f77871f79ce07dd056cd": "PANIC",
  "0x404f3a213ff6c5d654f4e95e6a7ed098b1c3d3b3": "OSAK",
  "0x68d5a28d3bf09a32d3b9c35714ab7a6166ae2a00": "FOXXEY",
  "0x3a921a988099374c65433208a452195ea6a1e116": "BFOXX",
  "0x4e3e79981a64d5678e2e70fd7b4b9550c2b41db2": "HAWK",
  "0xce8aee7148daa8943453239c42b7b93f984a49f0": "CAW",
};
function decodeSymbolRaw(hex) {
  if (!hex || hex === "0x") return null;
  const h = hex.slice(2);
  if (h.length >= 128) {
    const len = Number(BigInt("0x" + h.slice(64, 128)));
    const bytes = h.slice(128, 128 + len * 2);
    let out = "";
    for (let i = 0; i < bytes.length; i += 2) out += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
    return out || null;
  }
  return null;
}
async function groundTruth() {
  const [cntHex] = await batch([{ to: CONTRACT, data: "0x6ba13a82" }]);
  const total = Number(BigInt(cntHex));
  const rows = [];
  if (total > 0) {
    const shown = Math.min(total, 100);
    const idx = [];
    for (let k = total - 1; k >= total - shown; k--) idx.push(k);
    const words = await batch(idx.map((i) => ({ to: CONTRACT, data: "0x598a96bf" + pad(BigInt(i).toString(16)) })));
    const users = words.map((h) => "0x" + h.slice(-40));
    const cfgs = await batch(users.map((a) => ({ to: CONTRACT, data: "0x19091452" + pad(a) })));
    for (let i = 0; i < users.length; i++) {
      const h = cfgs[i].slice(2);
      const w = (k) => h.slice(k * 64, (k + 1) * 64);
      const target = "0x" + w(0).slice(-40);
      const registered = BigInt("0x" + w(5)) !== 0n;
      if (!registered) continue;
      let symbol;
      if (target === "0x" + "0".repeat(40)) symbol = "[42]";
      else if (TOKENS[target]) symbol = TOKENS[target];
      else {
        const [symHex] = await batch([{ to: target, data: "0x95d89b41" }]);
        symbol = decodeSymbolRaw(symHex) || (target.slice(0, 6) + "…" + target.slice(-4));
      }
      rows.push({
        user: users[i],
        short: users[i].slice(0, 6) + "…" + users[i].slice(-4),
        symbol,
        enabled: BigInt("0x" + w(4)) !== 0n,
        percent: (Number(BigInt("0x" + w(1))) / 100).toString(),
      });
    }
  }
  return { total, rows };
}

/* ---------- tiny fake DOM ---------- */
class FakeEl {
  constructor(tag) {
    this.tagName = tag || "div";
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.style = {};
  }
  set innerHTML(v) { if (v === "") this.children = []; }
  get innerHTML() { return ""; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  setAttribute() {}
  querySelectorAll() { return []; }
}
function serialize(node, out) {
  out = out || { text: [], hrefs: [] };
  if (node.textContent) out.text.push(node.textContent);
  if (node.href) out.hrefs.push(node.href);
  (node.children || []).forEach((c) => serialize(c, out));
  return out;
}

async function runBoard(lang) {
  const src = readFileSync(new URL("../docs/app.js", import.meta.url), "utf8");
  const els = {};
  const documentStub = {
    addEventListener: () => {},
    getElementById: (id) => els[id] || (els[id] = new FakeEl("div")),
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (txt) => { const n = new FakeEl("#text"); n.textContent = txt; return n; },
    querySelectorAll: () => [],
  };
  const sandbox = {
    console, fetch, setInterval: () => {}, setTimeout,
    location: { pathname: "/" + lang + ".html", href: "" },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: documentStub,
    window: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  await sandbox.loadBoard();
  const listSer = serialize(els.boardList);
  return {
    title: els.boardTitle.textContent,
    text: listSer.text.join(" | "),
    hrefs: listSer.hrefs,
    more: els.boardMore.textContent,
  };
}

/* ---------- compare ---------- */
const truth = await groundTruth();
console.log("ground truth: total =", truth.total);
truth.rows.forEach((r) => console.log("  ", r.short, "FISH →", r.symbol, r.enabled ? "enabled" : "disabled", r.percent + "%"));

for (const lang of ["en", "ja"]) {
  const board = await runBoard(lang);
  console.log(lang, "title:", board.title);
  console.log(lang, "rows text:", board.text);
  console.log(lang, "hrefs:", board.hrefs.join(", "));
  if (!board.title.includes(String(truth.total))) throw new Error(lang + ": title count mismatch");
  if (truth.rows.length === 0) {
    if (!/No registrations yet|まだ登録がありません/.test(board.text)) throw new Error(lang + ": expected empty state");
    continue;
  }
  for (const r of truth.rows) {
    if (!board.text.includes(r.short)) throw new Error(lang + ": missing address " + r.short);
    if (!board.text.includes("FISH → " + r.symbol)) throw new Error(lang + ": missing route for " + r.short);
    const statusWord = lang === "ja" ? (r.enabled ? "有効" : "停止中") : (r.enabled ? "Active" : "Paused");
    if (!board.text.includes(statusWord)) throw new Error(lang + ": missing status " + statusWord);
    if (!board.text.includes(r.percent + "%")) throw new Error(lang + ": missing percent");
    const wantHref = EXPLORER + "/address/" + r.user;
    if (!board.hrefs.includes(wantHref)) throw new Error(lang + ": missing explorer link " + wantHref);
  }
}
console.log("BOARD VERIFY OK — rendered board matches the chain exactly (en + ja).");
