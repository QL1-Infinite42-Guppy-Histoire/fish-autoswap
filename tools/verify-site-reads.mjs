// Load docs/app.js with minimal browser stubs and exercise its live
// read path (dayStartBlock + todaysDrop) against the real 42 Chain.
// The expected value comes from the explorer's record of today's
// batch-mint (2026-11-07T00:05:33Z, tx 0x64b3cd33...).
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../docs/app.js", import.meta.url), "utf8");
const sandbox = {
  console,
  fetch,
  setInterval: () => {},
  setTimeout,
  location: { pathname: "/en.html", href: "" },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: {
    addEventListener: () => {},
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({})
  },
  window: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const ADDR = "0x9d6ED0365145FfdA3216f6a3B81848F1D82FaF99";
const EXPECTED = 791531300645460722n; // exact wei from the explorer record total.value
const range = await sandbox.dayStartBlock();
console.log("dayStartBlock:", range.start, "latest:", range.latest);
const ts = await sandbox.blockTimestamp(range.start);
const prev = await sandbox.blockTimestamp(range.start - 1);
const dayTs = Math.floor(Date.UTC(2026, 10, 7) / 1000);
console.log("block ts:", ts, "prev:", prev, "day start ts:", dayTs);
if (!(ts >= dayTs && prev < dayTs)) throw new Error("dayStartBlock boundary wrong");
const drop = await sandbox.todaysDrop(ADDR);
console.log("todaysDrop:", drop.toString(), "=", sandbox.formatToken(drop), "FISH");
const bal = await sandbox.tokenBalance(sandbox.FISH, ADDR);
console.log("fish balance:", sandbox.formatToken(bal), "FISH");
if (drop !== EXPECTED) throw new Error(`drop mismatch: got ${drop}, expected ${EXPECTED}`);
console.log("SITE READ PATH VERIFIED: todaysDrop matches the explorer record exactly");
