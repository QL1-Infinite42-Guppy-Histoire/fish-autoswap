// Local smoke test for FishAutoSwap on a throwaway ganache chain.
//
// The contract hardcodes the mainnet FISH / router / factory addresses,
// so the mocks' runtime code is copied onto those exact addresses (and
// onto the real USDT address as the target token) with
// evm_setAccountCode. Everything runs locally; no real funds, no keys.
//
// Run from tools/:  node smoke-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import ganache from "ganache";
import { ethers } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));

const FISH = "0x2c32120a12B754272d9E85C57F64b50cA2C43513";
const ROUTER = "0xBF07dFE35746894bAe373f63f4Bf2379F9BaFEc0";
const FACTORY = "0x3157C6AcA800D507af95Ab1466adBA3A6F11eE1a";
const USDT = "0xC2684966e5c95B2bc636FB4a1f3Da9Ad23d94753";
const SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const E18 = 10n ** 18n;

function compile(file) {
  const source = readFileSync(join(here, file), "utf8");
  const name = file.replace(".sol", "");
  const input = {
    language: "Solidity",
    sources: { [file]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (output.errors || []).filter((e) => e.severity === "error");
  if (errs.length) {
    for (const e of errs) console.error(e.formattedMessage);
    process.exit(1);
  }
  return output.contracts[file];
}

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error("CHECK FAILED: " + label);
  passed++;
  console.log("  ok:", label);
}
async function expectRevert(label, method, args, needle) {
  try {
    await method.staticCall(...args);
  } catch (e) {
    const msg = String((e && (e.revert && e.revert.args ? e.revert.args.join(" ") : e.message)) || e);
    const full = JSON.stringify(e && e.info ? e.info : {}) + msg + String(e && e.reason || "");
    if (needle && !full.includes(needle) && !msg.includes(needle)) {
      throw new Error(`CHECK FAILED: ${label} — reverted but without "${needle}": ${(full).slice(0, 300)}`);
    }
    passed++;
    console.log("  ok:", label, "(reverted as expected)");
    return;
  }
  throw new Error("CHECK FAILED: " + label + " — did not revert");
}
const main = compile("../contracts/FishAutoSwap.sol")["FishAutoSwap"];
const mocks = compile("mocks.sol");

// Serve ganache over HTTP and use JsonRpcProvider: BrowserProvider's
// balance caching over an in-process ganache provider returned stale
// eth_getBalance values in this setup.
const gserver = ganache.server({ logging: { quiet: true } });
await gserver.listen(8546);
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8546");
const [owner, keeper, user1, user2, user3, user4] = await Promise.all(
  [0, 1, 2, 3, 4, 5].map((i) => provider.getSigner(i))
);
const ownerAddr = await owner.getAddress();
const keeperAddr = await keeper.getAddress();
const u1 = await user1.getAddress();
const u2 = await user2.getAddress();
const u3 = await user3.getAddress();
const u4 = await user4.getAddress();

// Deploy the real contract.
const auto = await new ethers.ContractFactory(main.abi, "0x" + main.evm.bytecode.object, owner).deploy();
await auto.waitForDeployment();
const autoAddr = await auto.getAddress();
console.log("FishAutoSwap deployed at", autoAddr);

// Deploy mocks, then copy their code onto the mainnet addresses.
async function deployMock(name, signer) {
  const c = mocks[name];
  const f = new ethers.ContractFactory(c.abi, "0x" + c.evm.bytecode.object, signer);
  const d = await f.deploy();
  await d.waitForDeployment();
  return d;
}
const fishMock = await deployMock("MockERC20", owner);
const usdtMock = await deployMock("MockERC20", owner);
const factoryMock = await deployMock("MockFactory", owner);
const routerMock = await deployMock("MockRouter", owner);
await provider.send("evm_setAccountCode", [FISH, await provider.getCode(await fishMock.getAddress())]);
await provider.send("evm_setAccountCode", [USDT, await provider.getCode(await usdtMock.getAddress())]);
await provider.send("evm_setAccountCode", [FACTORY, await provider.getCode(await factoryMock.getAddress())]);
await provider.send("evm_setAccountCode", [ROUTER, await provider.getCode(await routerMock.getAddress())]);
await provider.send("evm_setAccountBalance", [ROUTER, "0x" + (10n * E18).toString(16)]);

const ERC20_ABI = mocks["MockERC20"].abi;
const fish = new ethers.Contract(FISH, ERC20_ABI, owner);
const usdt = new ethers.Contract(USDT, ERC20_ABI, owner);

// Raw eth_getBalance: ethers' getBalance() intermittently returned a
// stale cached value in this setup (see the native-target test below).
const rawBal = async (addr) => BigInt(await provider.send("eth_getBalance", [addr, "latest"]));
const STIPEND = 5000000000000000n; // default gasStipend: 0.005 [42]
const DEPOSIT = 50000000000000000n; // 0.05 [42]

// --- Setup: owner sets the keeper ---
await (await auto.connect(owner).setKeeper(keeperAddr)).wait();
check("keeper set", (await auto.keeper()) === keeperAddr);

// --- User1: token target, 50% of gross, cap 10 FISH ---
await (await fish.mint(u1, 100n * E18)).wait();
await (await fish.connect(user1).approve(autoAddr, 1000n * E18)).wait();
await (await auto.connect(user1).register(USDT, 5000, 10n * E18, 100)).wait();
const cfg1 = await auto.configOf(u1);
check("user1 config stored + enabled", cfg1.enabled === true && cfg1.targetToken.toLowerCase() === USDT.toLowerCase());
check("usersCount == 1", (await auto.usersCount()) === 1n);
check("userAt(0) == user1", (await auto.userAt(0)).toLowerCase() === u1.toLowerCase());

// Gas credit: executions are paid from the user's own pre-deposit.
await (await auto.connect(user1).depositGas({ value: DEPOSIT })).wait();
check("depositGas increases credit by the exact amount", (await auto.gasCredit(u1)) === DEPOSIT);
check("default gasStipend is 0.005 [42]", (await auto.gasStipend()) === STIPEND);

// Execute: gross 8 FISH, 50% -> 4 FISH in, mock pays 2x -> 8 USDT out.
const keeperBalBefore1 = await rawBal(keeperAddr);
const execTx1 = await auto.connect(keeper).execute(u1, 8n * E18, [FISH, USDT]);
const execRc1 = await execTx1.wait();
check("user1 FISH reduced by 4", (await fish.balanceOf(u1)) === 96n * E18);
check("user1 received 8 USDT", (await usdt.balanceOf(u1)) === 8n * E18);
let gasPaid1 = null;
for (const log of execRc1.logs) {
  try {
    const p = auto.interface.parseLog(log);
    if (p && p.name === "GasPaid") gasPaid1 = p;
  } catch (e) { /* not our event */ }
}
check(
  "GasPaid event: exactly one stipend, user1 -> keeper",
  !!gasPaid1 &&
    gasPaid1.args.user.toLowerCase() === u1.toLowerCase() &&
    gasPaid1.args.keeper.toLowerCase() === keeperAddr.toLowerCase() &&
    gasPaid1.args.stipend === STIPEND
);
check("execute deducted exactly one stipend from credit", (await auto.gasCredit(u1)) === DEPOSIT - STIPEND);
check(
  "keeper received exactly the stipend (net of the tx gas it paid)",
  (await rawBal(keeperAddr)) - keeperBalBefore1 === STIPEND - execRc1.gasUsed * execRc1.gasPrice
);
check("contract native balance == remaining credit", (await rawBal(autoAddr)) === DEPOSIT - STIPEND);
check("contract holds no FISH", (await fish.balanceOf(autoAddr)) === 0n);
check("executedToday(user1)", (await auto.executedToday(u1)) === true);

// Same day again -> revert.
await expectRevert("second execute same day", auto.connect(keeper).execute, [u1, 8n * E18, [FISH, USDT]], "already executed today");
// Non-keeper -> revert.
await expectRevert("non-keeper cannot execute", auto.connect(owner).execute, [u1, 8n * E18, [FISH, USDT]], "not keeper");

// --- User2: native [42] target via sentinel register (normalizes to address(0)) ---
await (await fish.mint(u2, 100n * E18)).wait();
await (await fish.connect(user2).approve(autoAddr, 1000n * E18)).wait();
await (await auto.connect(user2).register(SENTINEL, 10000, 50n * E18, 100)).wait();
const cfg2 = await auto.configOf(u2);
check("sentinel target normalized to address(0)", cfg2.targetToken === ethers.ZeroAddress);
await (await auto.connect(user2).depositGas({ value: DEPOSIT })).wait();
// Raw eth_getBalance (rawBal, defined above): ethers' getBalance()
// intermittently returned a stale cached value in this setup (the
// payout itself was proven by the router's balance drop and the
// Executed event).
const u2EthBefore = await rawBal(u2);
await (await auto.connect(keeper).execute(u2, 10n * E18, [FISH, SENTINEL])).wait();
const u2EthAfter = await rawBal(u2);
check("user2 FISH reduced by 10", (await fish.balanceOf(u2)) === 90n * E18);
check("user2 credit deducted one stipend (native target too)", (await auto.gasCredit(u2)) === DEPOSIT - STIPEND);
check("user2 received native [42] (10 FISH * 2 / 1e12 wei)", u2EthAfter - u2EthBefore === 20000000n);

// --- User3: daily cap binds (percent 100%, gross 50, cap 3) ---
await (await fish.mint(u3, 100n * E18)).wait();
await (await fish.connect(user3).approve(autoAddr, 1000n * E18)).wait();
await (await auto.connect(user3).register(USDT, 10000, 3n * E18, 100)).wait();
await (await auto.connect(user3).depositGas({ value: DEPOSIT })).wait();
await (await auto.connect(keeper).execute(u3, 50n * E18, [FISH, USDT])).wait();
check("user3 capped at 3 FISH in", (await fish.balanceOf(u3)) === 97n * E18);
check("user3 received 6 USDT", (await usdt.balanceOf(u3)) === 6n * E18);

// --- Next UTC day: user1 disables; execute must revert ---
await provider.send("evm_increaseTime", [86400]);
await provider.send("evm_mine", []);
check("executedToday resets next day", (await auto.executedToday(u1)) === false);
await (await auto.connect(user1).disable()).wait();
await expectRevert("disabled user cannot execute", auto.connect(keeper).execute, [u1, 8n * E18, [FISH, USDT]], "not enabled");

// --- Path validation: user2 (native target) with a token-ending path ---
await expectRevert(
  "path not ending in target reverts",
  auto.connect(keeper).execute,
  [u2, 10n * E18, [FISH, USDT]],
  "path must end with target"
);

// --- Nothing to swap: user2 re-registers, allowance revoked ---
await (await auto.connect(user2).register(ethers.ZeroAddress, 10000, 50n * E18, 100)).wait();
await (await fish.connect(user2).approve(autoAddr, 0n)).wait();
await expectRevert(
  "zero allowance -> nothing to swap",
  auto.connect(keeper).execute,
  [u2, 10n * E18, [FISH, SENTINEL]],
  "nothing to swap"
);

// --- Pause: owner pauses; execute reverts even for a good user ---
await (await auto.connect(user3).register(USDT, 10000, 3n * E18, 100)).wait();
await (await auto.connect(owner).setPaused(true)).wait();
await expectRevert("paused blocks execute", auto.connect(keeper).execute, [u3, 50n * E18, [FISH, USDT]], "paused");
await (await auto.connect(owner).setPaused(false)).wait();
await (await auto.connect(keeper).execute(u3, 50n * E18, [FISH, USDT])).wait();
check("unpaused execute works again", (await usdt.balanceOf(u3)) === 12n * E18);
check("user3 second execute deducted a second stipend", (await auto.gasCredit(u3)) === DEPOSIT - 2n * STIPEND);

// ============ Gas pre-deposit model (user4, fresh) ============
await (await fish.mint(u4, 100n * E18)).wait();
await (await fish.connect(user4).approve(autoAddr, 1000n * E18)).wait();
await (await auto.connect(user4).register(USDT, 10000, 10n * E18, 100)).wait();

// Zero credit -> execute reverts and charges nothing at all.
await expectRevert(
  "execute with zero gas credit",
  auto.connect(keeper).execute,
  [u4, 8n * E18, [FISH, USDT]],
  "insufficient gas credit"
);
check(
  "zero-credit revert charged nothing and swapped nothing",
  (await auto.gasCredit(u4)) === 0n &&
    (await auto.executedToday(u4)) === false &&
    (await fish.balanceOf(u4)) === 100n * E18
);

// Credit below the stipend (0.004 < 0.005) -> still reverts, credit kept.
await (await auto.connect(user4).depositGas({ value: 4000000000000000n })).wait();
await expectRevert(
  "execute with credit below stipend",
  auto.connect(keeper).execute,
  [u4, 8n * E18, [FISH, USDT]],
  "insufficient gas credit"
);
check("below-stipend revert kept the partial credit", (await auto.gasCredit(u4)) === 4000000000000000n);

// Enough credit but a failing swap (bad path) -> revert, no stipend taken.
await (await auto.connect(user4).depositGas({ value: 46000000000000000n })).wait(); // credit now 0.05
await expectRevert(
  "failed swap (bad path) charges no stipend",
  auto.connect(keeper).execute,
  [u4, 8n * E18, [FISH, SENTINEL]],
  "path must end with target"
);
check("failed swap kept the full credit", (await auto.gasCredit(u4)) === DEPOSIT);

// Successful execute: exactly one stipend moves user4 -> keeper.
const keeperBalBefore4 = await rawBal(keeperAddr);
const execTx4 = await auto.connect(keeper).execute(u4, 8n * E18, [FISH, USDT]);
const execRc4 = await execTx4.wait();
check("user4 swapped 8 FISH for 16 USDT", (await usdt.balanceOf(u4)) === 16n * E18);
check("user4 credit reduced by exactly one stipend", (await auto.gasCredit(u4)) === DEPOSIT - STIPEND);
check(
  "keeper got exactly the stipend for user4's run (net of tx gas)",
  (await rawBal(keeperAddr)) - keeperBalBefore4 === STIPEND - execRc4.gasUsed * execRc4.gasPrice
);

// withdrawGas: the caller gets their own unused credit back, exactly.
const u4BalBeforeW = await rawBal(u4);
const wTx = await auto.connect(user4).withdrawGas(20000000000000000n); // 0.02 [42]
const wRc = await wTx.wait();
check("withdrawGas deducted the amount from credit", (await auto.gasCredit(u4)) === DEPOSIT - STIPEND - 20000000000000000n);
check(
  "withdrawGas returned the amount to the user (net of tx gas)",
  (await rawBal(u4)) - u4BalBeforeW === 20000000000000000n - wRc.gasUsed * wRc.gasPrice
);
await expectRevert(
  "withdraw above own credit reverts",
  auto.connect(user4).withdrawGas,
  [26000000000000000n],
  "exceeds your gas credit"
);

// Another user cannot reach user4's credit: user2 empties its OWN
// credit, user4's is untouched, and user2 then cannot take even 1 wei
// more even though the contract still holds user4's money.
await (await auto.connect(user2).withdrawGas(DEPOSIT - STIPEND)).wait();
check("user2 withdrew all of its own credit", (await auto.gasCredit(u2)) === 0n);
check("user4 credit untouched by user2's withdrawal", (await auto.gasCredit(u4)) === DEPOSIT - STIPEND - 20000000000000000n);
await expectRevert(
  "user2 cannot withdraw user4's credit",
  auto.connect(user2).withdrawGas,
  [1n],
  "exceeds your gas credit"
);

// setGasStipend: owner-only, hard cap 0.02 [42].
await expectRevert(
  "non-owner cannot set the stipend",
  auto.connect(user1).setGasStipend,
  [10000000000000000n],
  "not owner"
);
await expectRevert(
  "stipend above the hard cap reverts",
  auto.connect(owner).setGasStipend,
  [21000000000000000n],
  "hard cap"
);
await (await auto.connect(owner).setGasStipend(10000000000000000n)).wait();
check("owner can set the stipend within the cap", (await auto.gasStipend()) === 10000000000000000n);
await (await auto.connect(owner).setGasStipend(STIPEND)).wait();
check("stipend restored to the 0.005 [42] default", (await auto.gasStipend()) === STIPEND);

// Final accounting: the contract's native balance is exactly the sum
// of the remaining credits (u1 0.045 + u3 0.040 + u4 0.025; u2 = 0).
check(
  "contract native balance == sum of remaining credits",
  (await rawBal(autoAddr)) === 110000000000000000n
);

console.log(`\nALL SMOKE TESTS PASSED (${passed} checks)`);
process.exit(0);
