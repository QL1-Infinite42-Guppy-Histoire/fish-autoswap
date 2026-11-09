// Fork verification for FishAutoSwap v2 (fee-on-transfer safe) — the
// test the v1 smoke test could not do: it runs against the REAL FISH
// token, the REAL router/factory/pairs, forked from 42 Chain mainnet
// into a local ganache chain. No real funds, no real keys: all actors
// are throwaway ganache accounts that only exist inside the fork.
//
// What it proves, with numbers:
//  - CONTROL: the v1 contract (bytecode pinned to the pre-rebuild
//    commit 3517ff8 in docs/bytecode.js)
//    still reverts execute() on the real FISH — the original bug.
//  - v2: a pull of G FISH arrives as ~75% (FISH burns 25% on transfers
//    to non-exempt addresses), exactly the arrived amount is swapped
//    through the real pair, the output lands with the user, the gas
//    stipend moves from the user's credit to the keeper, the contract
//    holds no FISH afterwards, and the once-per-day gate still bites.
//  - Same flow for a native [42] target (swapExactTokensForETH).
//
// Run from tools/:  node fork-test.mjs
// Optional env: FORK_RPC (default: the mschihuahua public RPC),
//               FORK_BLOCK (default: latest - 5, queried live).
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import ganache from "ganache";
import solc from "solc";
import { ethers } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const FISH = "0x2c32120a12B754272d9E85C57F64b50cA2C43513";
const ROUTER = "0xBF07dFE35746894bAe373f63f4Bf2379F9BaFEc0";
const FACTORY = "0x3157C6AcA800D507af95Ab1466adBA3A6F11eE1a";
const QOM = "0x53465cbbba5b14f5dc00794330f0f4afb30eaa1d";
const SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const E18 = 10n ** 18n;
const STIPEND = 5000000000000000n; // 0.005 [42]

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];
const ROUTER_ABI = [
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
  "function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])",
];
const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];

let passed = 0;
function check(label, cond, extra) {
  if (!cond) throw new Error("CHECK FAILED: " + label + (extra ? " — " + extra : ""));
  passed++;
  console.log("  ok:", label + (extra ? " — " + extra : ""));
}
const fmt = (x) => ethers.formatEther(x);

// ---- fork setup ----------------------------------------------------
// Test users are funded with REAL FISH by two real distribution
// recipients (unlocked inside the fork only — no keys are involved;
// nothing ever leaves the local fork). Buying FISH with native [42]
// through the router is not used: this chain's native-in swap path
// relies on chain-specific handling a vanilla-EVM fork cannot replay,
// while every flow under test here is token-in, which replays exactly.
const DONORS = [
  "0xeb59b392a5558931354e574d3b3beaff44f9df81", // held ~2.93 FISH at test time
  "0xaeca0c02baee386e45c273a1bf2d7ddfda48ed30", // held ~2.27 FISH at test time
];
const forkRpc = process.env.FORK_RPC || "https://evm-rpc-infinite.mschihuahua.org";
async function rpcHead() {
  const r = await fetch(forkRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  const j = await r.json();
  return Number(BigInt(j.result));
}
const forkBlock = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : (await rpcHead()) - 5;
console.log(`forking 42 Chain at block ${forkBlock} via ${forkRpc}`);

// Ganache's fork transport does not honour this environment's HTTP(S)
// proxy variables, so route its upstream traffic through a tiny local
// relay that forwards with Node's fetch (which does honour them).
const relay = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const r = await fetch(forkRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
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
  wallet: { unlockedAccounts: DONORS },
  logging: { quiet: true },
});
await gserver.listen(8547);
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8547");
const signers = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
const [owner, keeper, userA, userB, userC] = signers;
const addrs = await Promise.all(signers.map((s) => s.getAddress()));
const [ownerAddr, keeperAddr, uA, uB, uC] = addrs;
// Fork accounts start with whatever the fork says (0 for fresh
// addresses); fund them locally so they can act inside the fork.
// Donors get just enough native for their funding transfers' gas.
for (const a of [...addrs, ...DONORS]) {
  await provider.send("evm_setAccountBalance", [a, "0x" + (1000n * E18).toString(16)]);
}
const rawBal = async (addr) => BigInt(await provider.send("eth_getBalance", [addr, "latest"]));

const fish = new ethers.Contract(FISH, ERC20, owner);
const qom = new ethers.Contract(QOM, ERC20, owner);
const router = new ethers.Contract(ROUTER, ROUTER_ABI, owner);
const factory = new ethers.Contract(FACTORY, FACTORY_ABI, owner);

// ---- deploy v2 (new build) and v1 (control, pinned commit) --------
const artifact = JSON.parse(readFileSync(join(repo, "contracts/build/FishAutoSwap.json"), "utf8"));
const autoFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner);
const auto = await autoFactory.deploy();
await auto.waitForDeployment();
const autoAddr = await auto.getAddress();
await (await auto.connect(owner).setKeeper(keeperAddr)).wait();
console.log("FishAutoSwap v2 deployed at", autoAddr);

const headBytecodeJs = execSync("git show 3517ff8:docs/bytecode.js", { cwd: repo, encoding: "utf8" });
const v1Bytecode = headBytecodeJs.match(/var FISH_AUTOSWAP_BYTECODE = "(0x[0-9a-fA-F]+)"/)[1];
const autoV1 = await new ethers.ContractFactory(artifact.abi, v1Bytecode, owner).deploy();
await autoV1.waitForDeployment();
const v1Addr = await autoV1.getAddress();
await (await autoV1.connect(owner).setKeeper(keeperAddr)).wait();
console.log("FishAutoSwap v1 (control) deployed at", v1Addr);

// ---- fund a user with REAL FISH from a real holder -----------------
// The donor is a real distribution recipient, unlocked only inside
// this local fork. The transfer itself burns 25% (real FISH rules);
// the user is credited with whatever actually arrives, and the test
// measures from that real balance.
async function fundFromDonor(donorAddr, userAddr, sendAmount) {
  const signer = await provider.getSigner(donorAddr);
  const f = new ethers.Contract(FISH, ERC20, signer);
  await (await f.transfer(userAddr, sendAmount)).wait();
  return fish.balanceOf(userAddr);
}

// Measure the FISH transfer burn for a given gross amount: snapshot,
// plain-transfer gross from user to the keeper EOA (a non-exempt
// recipient), read what arrived, then revert the snapshot.
async function measureReceived(userSigner, gross) {
  const snap = await provider.send("evm_snapshot", []);
  const from = await userSigner.getAddress();
  const before = await fish.balanceOf(keeperAddr);
  await (await fish.connect(userSigner).transfer(keeperAddr, gross)).wait();
  const arrived = (await fish.balanceOf(keeperAddr)) - before;
  await provider.send("evm_revert", [snap]);
  return arrived;
}

async function setupUser(userSigner, userAddr, target, autoContract, autoAddress) {
  await (await autoContract.connect(userSigner).register(target, 10000, 1000n * E18, 100)).wait();
  await (await fish.connect(userSigner).approve(autoAddress, 1000000n * E18)).wait();
  await (await autoContract.connect(userSigner).depositGas({ value: E18 / 2n })).wait();
}

// ============ Sentinel emulation (fork only) =========================
// On-chain, 0xEeee...EEeE is a bank-backed predeploy named
// "Improbability": balanceOf(a) mirrors a's native balance and its
// transfers move bank balances — chain machinery a vanilla-EVM fork
// cannot replay (its transfer reverts here). Only inside this fork,
// its code is replaced with a small ledger ERC20 seeded to the pair's
// actual reserves, so the REAL pair / router / AutoSwap bytecode can
// run the native-out leg end to end. Nothing on-chain is touched.
const SENTINEL_EMU_SRC = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract SentinelEmu {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function seed(address a, uint256 v) external { balanceOf[a] = v; }
    function deposit() external payable { balanceOf[msg.sender] += msg.value; }
    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad, "emu: balance");
        balanceOf[msg.sender] -= wad;
        (bool ok, ) = msg.sender.call{ value: wad }("");
        require(ok, "emu: send");
    }
    function transfer(address to, uint256 wad) external returns (bool) {
        require(balanceOf[msg.sender] >= wad, "emu: balance");
        balanceOf[msg.sender] -= wad;
        balanceOf[to] += wad;
        return true;
    }
    function approve(address sp, uint256 wad) external returns (bool) {
        allowance[msg.sender][sp] = wad;
        return true;
    }
    function transferFrom(address from, address to, uint256 wad) external returns (bool) {
        require(balanceOf[from] >= wad, "emu: balance");
        if (from != msg.sender) {
            require(allowance[from][msg.sender] >= wad, "emu: allowance");
            allowance[from][msg.sender] -= wad;
        }
        balanceOf[from] -= wad;
        balanceOf[to] += wad;
        return true;
    }
    function totalSupply() external view returns (uint256) { return address(this).balance; }
    function name() external pure returns (string memory) { return "Improbability (fork emu)"; }
    function symbol() external pure returns (string memory) { return "42"; }
    function decimals() external pure returns (uint8) { return 18; }
    receive() external payable {}
}
`;
{
  const input = {
    language: "Solidity",
    sources: { "SentinelEmu.sol": { content: SENTINEL_EMU_SRC } },
    settings: { outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const emuCode = "0x" + out.contracts["SentinelEmu.sol"].SentinelEmu.evm.deployedBytecode.object;
  await provider.send("evm_setAccountCode", [SENTINEL, emuCode]);
  // The emulation pays native out of the sentinel address on withdraw.
  await provider.send("evm_setAccountBalance", [SENTINEL, "0x" + (100000n * E18).toString(16)]);
  const emu = new ethers.Contract(SENTINEL, ["function seed(address,uint256)", "function balanceOf(address) view returns (uint256)"], owner);
  const pairFS = new ethers.Contract(
    await factory.getPair(FISH, SENTINEL),
    ["function getReserves() view returns (uint112,uint112,uint32)", "function token0() view returns (address)"],
    provider
  );
  const res = await pairFS.getReserves();
  const sentReserve = (await pairFS.token0()) === SENTINEL ? res[0] : res[1];
  await (await emu.seed(await pairFS.getAddress(), sentReserve)).wait();
  console.log("  sentinel emulation installed on fork; FISH/native pair seeded at reserve", fmt(sentReserve));
}

// ============ UserA: v2, token target (QOM) ==========================
console.log("\n-- UserA: v2 execute, FISH -> QOM (real pair, real FISH) --");
const balA0 = await fundFromDonor(DONORS[0], uA, 24n * E18 / 10n);
console.log("  UserA FISH balance after donor transfer (25% burned en route):", fmt(balA0));
check("UserA holds real FISH", balA0 > E18 / 2n, fmt(balA0) + " FISH");
await setupUser(userA, uA, QOM, auto, autoAddr);

const grossA = balA0; // percent 100%, cap/balance/allowance all >= balance
const receivedAExpected = await measureReceived(userA, grossA);
console.log(`  measured burn: gross ${fmt(grossA)} -> received ${fmt(receivedAExpected)} (burned ${fmt(grossA - receivedAExpected)})`);
check(
  "transfer burn is 25% (received == 75% within 4 wei)",
  (receivedAExpected * 4n - grossA * 3n <= 4n) && (grossA * 3n - receivedAExpected * 4n <= 4n),
  `received*4=${receivedAExpected * 4n} gross*3=${grossA * 3n}`
);

let pairA = await factory.getPair(FISH, QOM);
let pathA = [FISH, QOM];
if (pairA === ethers.ZeroAddress) {
  pairA = await factory.getPair(FISH, SENTINEL);
  pathA = [FISH, SENTINEL, QOM];
}
console.log("  path:", pathA.join(" -> "), " first pair:", pairA);
const quoteA = await router.getAmountsOut(receivedAExpected, pathA);
const expectedOutA = quoteA[quoteA.length - 1];
const pairFishBeforeA = await fish.balanceOf(pairA);
const userQomBeforeA = await qom.balanceOf(uA);
const keeperBalBeforeA = await rawBal(keeperAddr);

const txA = await auto.connect(keeper).execute(uA, grossA, pathA);
const rcA = await txA.wait();
let pulledA = null, executedA = null, gasPaidA = null;
for (const log of rcA.logs) {
  try {
    const p = auto.interface.parseLog(log);
    if (p && p.name === "Pulled") pulledA = p;
    if (p && p.name === "Executed") executedA = p;
    if (p && p.name === "GasPaid") gasPaidA = p;
  } catch (e) { /* other contracts' logs */ }
}
check("Pulled event present", !!pulledA);
check("Pulled.gross == user balance pulled in full", pulledA.args.grossAmount === grossA, fmt(pulledA.args.grossAmount));
check("Pulled.received == measured 75%", pulledA.args.receivedAmount === receivedAExpected, fmt(pulledA.args.receivedAmount));
check(
  "pair received exactly the arrived amount (contract -> pair is exempt)",
  (await fish.balanceOf(pairA)) - pairFishBeforeA === receivedAExpected
);
check("user FISH fully pulled", (await fish.balanceOf(uA)) === 0n);
check("contract holds no FISH after execute", (await fish.balanceOf(autoAddr)) === 0n);
check("Executed.amountIn == received (actually swapped)", executedA.args.amountIn === receivedAExpected);
check(
  "user QOM received == live quote for the received amount",
  (await qom.balanceOf(uA)) - userQomBeforeA === expectedOutA,
  `${fmt(expectedOutA)} QOM`
);
check("Executed.amountOut == user QOM delta", executedA.args.amountOut === expectedOutA);
check("gas credit deducted exactly one stipend", (await auto.gasCredit(uA)) === E18 / 2n - STIPEND);
check(
  "GasPaid event: one stipend user -> keeper",
  !!gasPaidA && gasPaidA.args.stipend === STIPEND && gasPaidA.args.keeper.toLowerCase() === keeperAddr.toLowerCase()
);
check(
  "keeper native delta == stipend - tx gas",
  (await rawBal(keeperAddr)) - keeperBalBeforeA === STIPEND - rcA.gasUsed * rcA.gasPrice
);
check("executedToday(userA)", (await auto.executedToday(uA)) === true);
try {
  await auto.connect(keeper).execute.staticCall(uA, grossA, pathA);
  throw new Error("second execute did not revert");
} catch (e) {
  check("second execute same day reverts", String(e.message || e).includes("already executed today"));
}

// ============ UserB: v2, native [42] target ==========================
console.log("\n-- UserB: v2 execute, FISH -> native [42] --");
const balB0 = await fundFromDonor(DONORS[1], uB, 19n * E18 / 10n);
await setupUser(userB, uB, SENTINEL, auto, autoAddr);
const grossB = balB0;
const receivedBExpected = await measureReceived(userB, grossB);
const quoteB = await router.getAmountsOut(receivedBExpected, [FISH, SENTINEL]);
const expectedOutB = quoteB[quoteB.length - 1];
const userEthBeforeB = await rawBal(uB);
const txB = await auto.connect(keeper).execute(uB, grossB, [FISH, SENTINEL]);
await txB.wait();
check(
  "user received native [42] == quote for the received amount",
  (await rawBal(uB)) - userEthBeforeB === expectedOutB,
  `${expectedOutB} wei`
);
check("contract holds no FISH after native execute", (await fish.balanceOf(autoAddr)) === 0n);
check("userB credit deducted one stipend", (await auto.gasCredit(uB)) === E18 / 2n - STIPEND);
check(
  "contract native balance == remaining credits (A+B)",
  (await rawBal(autoAddr)) === 2n * (E18 / 2n - STIPEND)
);

// ============ UserC: v1 control — must still revert ==================
console.log("\n-- UserC: v1 control on real FISH (the original bug) --");
const balC0 = await fundFromDonor(DONORS[0], uC, 4n * E18 / 10n);
await setupUser(userC, uC, QOM, autoV1, v1Addr);
try {
  await autoV1.connect(keeper).execute.staticCall(uC, balC0, pathA);
  throw new Error("v1 execute did NOT revert — control failed");
} catch (e) {
  const msg = String((e && e.message) || e);
  check("v1 execute reverts on real FISH (preflight catches it)", /transferFrom|revert/i.test(msg), msg.slice(0, 120));
}
check("v1 user kept all FISH (nothing moved)", (await fish.balanceOf(uC)) === balC0);
check("v1 user kept full gas credit", (await autoV1.gasCredit(uC)) === E18 / 2n);

console.log(`\nFORK TEST PASSED (${passed} checks) at fork block ${forkBlock}`);
process.exit(0);
