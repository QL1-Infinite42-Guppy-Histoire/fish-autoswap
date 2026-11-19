// One-off fork check against the DEPLOYED v2 contract (0x67e99d8a…f1290d)
// at the current chain state, with a realistic amount: today's actual
// drop was 0.074499808268332887 FISH received, so the test user is
// funded with 0.0993 FISH gross from a real holder (donor -> user burns
// 25% en route, ~0.0745 arrives — the same shape as a real morning).
// Everything happens inside a local ganache fork; nothing on-chain.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import ganache from "ganache";
import { ethers } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const FISH = "0x2c32120a12B754272d9E85C57F64b50cA2C43513";
const ROUTER = "0xBF07dFE35746894bAe373f63f4Bf2379F9BaFEc0";
const QOM = "0x53465CbBBA5b14f5Dc00794330f0f4aFb30EAA1d";
const V2 = "0x67e99d8a7bf5f71370391732847e038578f1290d";
const KEEPER = "0x2236bc8dA1DfF19F860e12C0E8854D8EC941dDA2";
const DONOR = "0xeb59b392a5558931354e574d3b3beaff44f9df81";
const E18 = 10n ** 18n;
const STIPEND = 5000000000000000n;
const fmt = (x) => ethers.formatEther(x);

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];
const forkRpc = process.env.FORK_RPC || "https://evm-rpc-infinite.mschihuahua.org";
async function rpcHead() {
  const r = await fetch(forkRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  return Number(BigInt((await r.json()).result));
}
const forkBlock = (await rpcHead()) - 5;
console.log(`forking 42 Chain at block ${forkBlock}; deployed v2 = ${V2}`);

const relay = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const r = await fetch(forkRpc, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(await r.text());
    } catch (e) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(String((e && e.message) || e));
    }
  });
});
await new Promise((resolve) => relay.listen(8548, "127.0.0.1", resolve));

const gserver = ganache.server({
  fork: { url: "http://127.0.0.1:8548", blockNumber: forkBlock },
  wallet: { unlockedAccounts: [KEEPER, DONOR] },
  logging: { quiet: true },
});
await gserver.listen(8547);
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8547");
const user = await provider.getSigner(0);
const userAddr = await user.getAddress();
await provider.send("evm_setAccountBalance", [userAddr, "0x" + (1000n * E18).toString(16)]);

const artifact = JSON.parse(readFileSync(join(repo, "contracts/build/FishAutoSwap.json"), "utf8"));
const auto = new ethers.Contract(V2, artifact.abi, provider);
const fish = new ethers.Contract(FISH, ERC20, provider);
const qom = new ethers.Contract(QOM, ERC20, provider);
const router = new ethers.Contract(ROUTER, ["function getAmountsOut(uint256,address[]) view returns (uint256[])"], provider);

let passed = 0;
const check = (label, cond, extra) => {
  if (!cond) throw new Error("CHECK FAILED: " + label + (extra ? " — " + extra : ""));
  passed++;
  console.log("  ok:", label + (extra ? " — " + extra : ""));
};

check("deployed keeper matches", (await auto.keeper()).toLowerCase() === KEEPER.toLowerCase());
check("deployed not paused", (await auto.paused()) === false);

// Fund the test user with real FISH from a real holder (burns en route).
const donorSigner = await provider.getSigner(DONOR);
const GROSS_FUND = 99300000000000000n; // 0.0993 FISH
await (await fish.connect(donorSigner).transfer(userAddr, GROSS_FUND)).wait();
const bal = await fish.balanceOf(userAddr);
console.log(`  funded: sent ${fmt(GROSS_FUND)} FISH, user holds ${fmt(bal)} (25% burned en route)`);
check("user holds ~a real daily drop", bal > 70000000000000000n && bal < 80000000000000000n, fmt(bal));

// Register exactly like the real user would on the site.
await (await auto.connect(user).register(QOM, 10000, 50n * E18, 100)).wait();
await (await fish.connect(user).approve(V2, 1500n * E18)).wait();
await (await auto.connect(user).depositGas({ value: E18 / 2n })).wait();
check("registered + gas credit 0.5", (await auto.gasCredit(userAddr)) === E18 / 2n);

// Expected: the pull arrives at 75% of the balance; quote for that.
const expectedReceived = (bal * 3n) / 4n;
const quote = await router.getAmountsOut(expectedReceived, [FISH, QOM]);
const expectedOut = quote[quote.length - 1];
const qomBefore = await qom.balanceOf(userAddr);

// The real keeper executes, as the Worker will at 09:10.
const keeperSigner = await provider.getSigner(KEEPER);
const tx = await auto.connect(keeperSigner).execute(userAddr, bal, [FISH, QOM]);
const rc = await tx.wait();
check("execute() did NOT revert on the deployed v2", rc.status === 1, "tx " + tx.hash);
let pulled = null, executed = null;
for (const log of rc.logs) {
  try {
    const p = auto.interface.parseLog(log);
    if (p && p.name === "Pulled") pulled = p;
    if (p && p.name === "Executed") executed = p;
  } catch (e) { /* other contracts */ }
}
check("Pulled.gross == full balance", pulled && pulled.args.grossAmount === bal, fmt(bal));
check("Pulled.received == 75% (within 4 wei)", pulled && (pulled.args.receivedAmount * 4n - bal * 3n <= 4n) && (bal * 3n - pulled.args.receivedAmount * 4n <= 4n), fmt(pulled ? pulled.args.receivedAmount : 0n));
check("Executed.amountIn == received", executed && executed.args.amountIn === pulled.args.receivedAmount);
const qomDelta = (await qom.balanceOf(userAddr)) - qomBefore;
check("user received QOM == live quote for the 75%", qomDelta === expectedOut, `${fmt(expectedOut)} QOM`);
check("contract holds no FISH after", (await fish.balanceOf(V2)) === 0n);
check("gas credit 0.5 -> 0.495 (one stipend)", (await auto.gasCredit(userAddr)) === E18 / 2n - STIPEND);
check("executedToday set", (await auto.executedToday(userAddr)) === true);

console.log(`\nDEPLOYED-V2 FORK CHECK PASSED (${passed} checks) at fork block ${forkBlock}`);
console.log(`Summary: ${fmt(bal)} FISH in -> ${fmt(pulled.args.receivedAmount)} actually swapped (25% = ${fmt(bal - pulled.args.receivedAmount)} burned by FISH itself) -> ${fmt(qomDelta)} QOM to the user.`);
process.exit(0);
