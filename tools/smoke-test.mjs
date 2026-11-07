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
const [owner, keeper, user1, user2, user3] = await Promise.all(
  [0, 1, 2, 3, 4].map((i) => provider.getSigner(i))
);
const ownerAddr = await owner.getAddress();
const keeperAddr = await keeper.getAddress();
const u1 = await user1.getAddress();
const u2 = await user2.getAddress();
const u3 = await user3.getAddress();

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

// Execute: gross 8 FISH, 50% -> 4 FISH in, mock pays 2x -> 8 USDT out.
await (await auto.connect(keeper).execute(u1, 8n * E18, [FISH, USDT])).wait();
check("user1 FISH reduced by 4", (await fish.balanceOf(u1)) === 96n * E18);
check("user1 received 8 USDT", (await usdt.balanceOf(u1)) === 8n * E18);
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
// Raw eth_getBalance: ethers' getBalance() intermittently returned a
// stale cached value in this setup (the payout itself was proven by
// the router's balance drop and the Executed event).
const rawBal = async (addr) => BigInt(await provider.send("eth_getBalance", [addr, "latest"]));
const u2EthBefore = await rawBal(u2);
await (await auto.connect(keeper).execute(u2, 10n * E18, [FISH, SENTINEL])).wait();
const u2EthAfter = await rawBal(u2);
check("user2 FISH reduced by 10", (await fish.balanceOf(u2)) === 90n * E18);
check("user2 received native [42] (10 FISH * 2 / 1e12 wei)", u2EthAfter - u2EthBefore === 20000000n);

// --- User3: daily cap binds (percent 100%, gross 50, cap 3) ---
await (await fish.mint(u3, 100n * E18)).wait();
await (await fish.connect(user3).approve(autoAddr, 1000n * E18)).wait();
await (await auto.connect(user3).register(USDT, 10000, 3n * E18, 100)).wait();
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

console.log(`\nALL SMOKE TESTS PASSED (${passed} checks)`);
process.exit(0);
