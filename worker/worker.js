// FishAutoSwap keeper worker — 42 Chain (mainnet, EVM 421018).
//
// Every day at 00:10 UTC (09:10 JST), a few minutes after the daily
// FISH drop lands (~00:05 UTC), this worker walks the users registered
// in the FishAutoSwap contract and triggers one swap per user:
//
//   1. Sum today's FISH mints to the user (Transfer logs from the zero
//      address since 00:00 UTC — that is exactly "today's drop").
//   2. Build the path: FISH -> target directly if a pair exists, else
//      FISH -> [42] -> target (checked against the factory).
//   3. Check the user's prepaid gas credit (gasCredit) against the
//      contract's per-run gasStipend: users pay their own execution
//      gas. When credit < stipend the user is skipped and logged as
//      "skipped_gas_credit" — no transaction is sent.
//   4. Preflight execute() with eth_call; skip + log when it reverts.
//   5. Send execute() from the keeper wallet. The CONTRACT enforces
//      the user's registered target / percent / daily cap / slippage,
//      the one-run-per-day rule, pays the proceeds straight to the
//      user, and — only after a successful swap — moves exactly
//      gasStipend of the user's credit to the keeper. The keeper can
//      never move funds anywhere else.
//
// Configuration:
//   CONTRACT_ADDRESS  (plain variable; empty until the owner deploys
//                      the contract via docs/admin.html — while empty
//                      everything answers "not_ready")
//   RPCS              (plain variable, optional; comma-separated RPC
//                      URLs overriding the built-in list)
//   FISH_ADDRESS      (plain variable, optional; overrides FISH)
// Secrets:
//   KEEPER_PRIVATE_KEY (the keeper wallet's key — set ONLY in the
//                      Cloudflare dashboard, never in code or repo.
//                      While missing, /status answers "not_ready" and
//                      the daily run does nothing.)
//   RUN_SECRET         (optional; when set, POST /run requires the
//                      header "x-run-secret" to match; when unset,
//                      POST /run is disabled entirely)
// Bindings:
//   AUTOSWAP_KV        (KV namespace: day-start block cache + history)
//
// History lives in KV under "hist:<user>:<padded ts>:<txHash>" and is
// served per user at GET /history?user=0x... Skip / failure outcomes
// are recorded there too (same record shape, txHash null, a status
// like "skipped_preflight" and the reason in "why"), deduplicated to
// one record per user per day per status via "skipmark:" keys, so
// 10-minute retries cannot flood the history. Run-level outcomes
// (not ready / paused / error) go under "runlog:<padded ts>" with a
// 30-day TTL; they are not part of the per-user history.

import { ethers } from "ethers";

const CHAIN_ID = 421018;
const DEFAULT_RPCS = [
  "https://evm-rpc.infinitedrive.xyz",
  "https://evm-rpc-infinite.mschihuahua.org",
  "https://evm-rpc-infinitepanda.xyz",
];
const DEFAULT_FISH = "0x2c32120a12B754272d9E85C57F64b50cA2C43513";
const FACTORY = "0x3157C6AcA800D507af95Ab1466adBA3A6F11eE1a";
const SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // native [42] in paths
const ZERO = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const EXPLORER_TX = "https://scan.infinitedrive.xyz/tx/";
const LOG_CHUNK_BLOCKS = 2000;
const GAS_FALLBACK = 600000n;
// Per-attempt RPC timeout. Without it, one hanging endpoint stalls
// the whole failover loop (observed with the panda endpoint); with
// it, a hung endpoint is abandoned and the next one is tried.
const RPC_TIMEOUT_MS = 10000;

const AUTO_IFACE = new ethers.Interface([
  "function usersCount() view returns (uint256)",
  "function userAt(uint256) view returns (address)",
  "function configOf(address) view returns (tuple(address targetToken, uint256 percentBps, uint256 dailyCap, uint256 slippageBps, bool enabled, bool registered))",
  "function executedToday(address) view returns (bool)",
  "function gasCredit(address) view returns (uint256)",
  "function gasStipend() view returns (uint256)",
  "function keeper() view returns (address)",
  "function paused() view returns (bool)",
  "function execute(address, uint256, address[])",
]);

const ERC20_IFACE = new ethers.Interface([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function symbol() view returns (string)",
]);

const FACTORY_IFACE = new ethers.Interface([
  "function getPair(address, address) view returns (address)",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-run-secret",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function rpcUrls(env) {
  const raw = String(env.RPCS || "").trim();
  if (!raw) return DEFAULT_RPCS;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_RPCS;
}

function fishAddress(env) {
  const raw = String(env.FISH_ADDRESS || "").trim();
  try {
    if (raw) return ethers.getAddress(raw);
  } catch (e) { /* fall through */ }
  return DEFAULT_FISH;
}

function contractAddress(env) {
  const raw = String(env.CONTRACT_ADDRESS || "").trim();
  if (!raw) return null;
  try {
    return ethers.getAddress(raw);
  } catch (e) {
    return null;
  }
}

function keeperWallet(env) {
  const key = String(env.KEEPER_PRIVATE_KEY || "").trim();
  if (!key) return null;
  try {
    return new ethers.Wallet(key.startsWith("0x") ? key : "0x" + key);
  } catch (e) {
    return null;
  }
}

// JSON-RPC with failover across the configured endpoints, in order.
// Each attempt is aborted after RPC_TIMEOUT_MS so a hung endpoint
// cannot stall the run; only the outcome of a call that previously
// hung changes (it now falls through to the next endpoint).
async function rpc(env, method, params) {
  let lastErr = null;
  for (const url of rpcUrls(env)) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctl.signal,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "rpc error");
      return data.result;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("all RPC endpoints failed");
}

// One history record for a run-level outcome (not ready / paused /
// error / finished), under "runlog:" — operational visibility only,
// never shown in the per-user /history. Best-effort.
async function logRun(kv, summary) {
  if (!kv) return;
  const ts = Math.floor(Date.now() / 1000);
  const rec = {
    ts,
    source: summary.source || null,
    date: summary.date || null,
    ran: Boolean(summary.ran),
    reason: summary.reason || null,
    users: summary.users ?? null,
    executed: (summary.executed || []).length,
    skipped: (summary.skipped || []).length,
    failed: (summary.failed || []).length,
  };
  try {
    await kv.put("runlog:" + String(ts).padStart(12, "0"), JSON.stringify(rec), {
      expirationTtl: 30 * 24 * 3600,
    });
  } catch (e) { /* best-effort */ }
}

// One history record for a per-user skip / failure, in exactly the
// shape /history serves (txHash null, reason in "why"). Deduplicated
// to one record per user per UTC day per status via "skipmark:" keys
// so the 10-minute retry cron cannot flood a user's history.
// amountInWei, when given, is the day's minted FISH the run was
// considering for this user (the swap itself never happened).
async function logSkip(env, kv, { user, dateStr, status, why, cfg, amountInWei }) {
  if (!kv || !user) return;
  try {
    const markKey = "skipmark:" + user.toLowerCase() + ":" + dateStr + ":" + status;
    if (await kv.get(markKey)) return;
    await kv.put(markKey, "1", { expirationTtl: 2 * 24 * 3600 });
  } catch (e) { /* fall through and write the record anyway */ }
  let targetSymbol = null;
  if (cfg) {
    try {
      targetSymbol = await tokenSymbol(env, cfg.targetToken);
    } catch (e) { /* leave null */ }
  }
  const wei = amountInWei != null ? String(amountInWei) : "0";
  const rec = {
    date: dateStr,
    ts: Math.floor(Date.now() / 1000),
    user,
    amountIn: wei === "0" ? "0" : ethers.formatEther(BigInt(wei)),
    amountInWei: wei,
    target: cfg ? cfg.targetToken : null,
    targetSymbol,
    txHash: null,
    status,
    why: why ? String(why).slice(0, 200) : null,
  };
  const key = "hist:" + user.toLowerCase() + ":" + String(rec.ts).padStart(12, "0") + ":" + status;
  try {
    await kv.put(key, JSON.stringify(rec));
  } catch (e) { /* history is best-effort */ }
}

async function ethCall(env, to, data, from) {
  const tx = { to, data };
  if (from) tx.from = from;
  return rpc(env, "eth_call", [tx, "latest"]);
}

async function callUint(env, to, data) {
  const out = await ethCall(env, to, data);
  return BigInt(out);
}

async function blockTimestamp(env, n) {
  const b = await rpc(env, "eth_getBlockByNumber", ["0x" + n.toString(16), false]);
  if (!b) throw new Error("block not found: " + n);
  return Number(BigInt(b.timestamp));
}

// First block whose timestamp is >= the start of the current UTC day.
// Binary search over block timestamps; the result is cached in KV per
// UTC date ("dayblock:YYYY-MM-DD") so a run searches at most once a day.
async function dayStartBlock(env, kv) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dayTs = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
  const cacheKey = "dayblock:" + dateStr;
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached) return { block: Number(cached), dateStr, dayTs };
  }
  const latest = Number(BigInt(await rpc(env, "eth_blockNumber", [])));
  let lo = 0;
  let hi = latest;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const ts = await blockTimestamp(env, mid);
    if (ts < dayTs) lo = mid + 1;
    else hi = mid;
  }
  if (kv) {
    await kv.put(cacheKey, String(lo), { expirationTtl: 3 * 24 * 3600 });
  }
  return { block: lo, dateStr, dayTs };
}

// Sum of FISH minted to `user` today: Transfer logs with from == zero
// address, in chunks of at most LOG_CHUNK_BLOCKS blocks.
async function sumMintsToday(env, fish, user, fromBlock, toBlock) {
  const fromTopic = "0x" + "0".repeat(64);
  const toTopic = "0x" + "0".repeat(24) + user.slice(2).toLowerCase();
  let total = 0n;
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
    const end = Math.min(start + LOG_CHUNK_BLOCKS - 1, toBlock);
    const logs = await rpc(env, "eth_getLogs", [
      {
        address: fish,
        topics: [TRANSFER_TOPIC, fromTopic, toTopic],
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
      },
    ]);
    for (const log of logs || []) {
      try {
        total += BigInt(log.data);
      } catch (e) { /* skip malformed log */ }
    }
  }
  return total;
}

async function pairExists(env, a, b) {
  try {
    const data = FACTORY_IFACE.encodeFunctionData("getPair", [a, b]);
    const out = await ethCall(env, FACTORY, data);
    const pair = ethers.getAddress("0x" + String(out).slice(-40));
    return pair !== ZERO;
  } catch (e) {
    return false;
  }
}

// Direct pair, else via the native [42] sentinel — same rule as
// GuppyWallet's findPath. Returns null when no route exists.
async function buildPath(env, fish, cfg) {
  const target = cfg.targetToken;
  if (target.toLowerCase() === fish.toLowerCase()) return null; // cannot swap FISH into FISH
  const effTarget = target === ZERO ? SENTINEL : target;
  if (await pairExists(env, fish, effTarget)) return [fish, effTarget];
  if (effTarget !== SENTINEL) {
    const a = await pairExists(env, fish, SENTINEL);
    const b = a && (await pairExists(env, SENTINEL, effTarget));
    if (a && b) return [fish, SENTINEL, effTarget];
  }
  return null;
}

const symbolCache = new Map();
async function tokenSymbol(env, addr) {
  if (addr === ZERO) return "42";
  const key = addr.toLowerCase();
  if (symbolCache.has(key)) return symbolCache.get(key);
  let sym = null;
  try {
    const out = await ethCall(env, addr, ERC20_IFACE.encodeFunctionData("symbol"));
    const decoded = ERC20_IFACE.decodeFunctionResult("symbol", out);
    sym = String(decoded[0] || "") || null;
  } catch (e) { /* non-standard token */ }
  if (!sym) sym = addr.slice(0, 6) + "…" + addr.slice(-4);
  symbolCache.set(key, sym);
  return sym;
}

async function waitReceipt(env, txHash, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rc = await rpc(env, "eth_getTransactionReceipt", [txHash]);
    if (rc) return rc;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

// The daily run. Returns a summary object; never throws.
async function runAll(env, source) {
  const summary = { source, ran: false, executed: [], skipped: [], failed: [] };
  const kv = env.AUTOSWAP_KV || null;
  // Every exit goes through finish() so the run-level outcome always
  // lands in KV ("runlog:") — including the not-ready and error
  // outcomes that used to exist only in the cron console log.
  const finish = async (s) => {
    await logRun(kv, s);
    return s;
  };
  const contract = contractAddress(env);
  const wallet = keeperWallet(env);
  if (!contract) {
    summary.reason = "not_ready: CONTRACT_ADDRESS not set";
    return finish(summary);
  }
  if (!wallet) {
    summary.reason = "not_ready: KEEPER_PRIVATE_KEY not set";
    return finish(summary);
  }
  const fish = fishAddress(env);
  try {
    const paused = await ethCall(env, contract, AUTO_IFACE.encodeFunctionData("paused"));
    if (AUTO_IFACE.decodeFunctionResult("paused", paused)[0]) {
      summary.reason = "contract paused";
      return finish(summary);
    }
    const count = Number(await callUint(env, contract, AUTO_IFACE.encodeFunctionData("usersCount")));
    summary.users = count;
    // Per-run gas reimbursement, read live from the contract.
    const stipend = await callUint(env, contract, AUTO_IFACE.encodeFunctionData("gasStipend"));
    summary.gasStipendWei = stipend.toString();
    const { block: startBlock, dateStr } = await dayStartBlock(env, kv);
    const latest = Number(BigInt(await rpc(env, "eth_blockNumber", [])));
    summary.date = dateStr;
    summary.dayStartBlock = startBlock;

    let nonce = Number(await rpc(env, "eth_getTransactionCount", [wallet.address, "pending"]));
    const gasPrice = BigInt(await rpc(env, "eth_gasPrice", []));

    for (let i = 0; i < count; i++) {
      let user = null;
      try {
        const out = await ethCall(env, contract, AUTO_IFACE.encodeFunctionData("userAt", [i]));
        user = ethers.getAddress("0x" + String(out).slice(-40));
        const cfgOut = await ethCall(env, contract, AUTO_IFACE.encodeFunctionData("configOf", [user]));
        const cfgRaw = AUTO_IFACE.decodeFunctionResult("configOf", cfgOut)[0];
        const cfg = {
          targetToken: cfgRaw.targetToken || cfgRaw[0],
          percentBps: BigInt(cfgRaw.percentBps ?? cfgRaw[1]),
          dailyCap: BigInt(cfgRaw.dailyCap ?? cfgRaw[2]),
          slippageBps: BigInt(cfgRaw.slippageBps ?? cfgRaw[3]),
          enabled: Boolean(cfgRaw.enabled ?? cfgRaw[4]),
          registered: Boolean(cfgRaw.registered ?? cfgRaw[5]),
        };
        if (!cfg.registered || !cfg.enabled) {
          summary.skipped.push({ user, why: "not enabled" });
          await logSkip(env, kv, { user, dateStr, status: "skipped_not_enabled", why: "not enabled", cfg });
          continue;
        }
        const doneOut = await ethCall(env, contract, AUTO_IFACE.encodeFunctionData("executedToday", [user]));
        if (AUTO_IFACE.decodeFunctionResult("executedToday", doneOut)[0]) {
          summary.skipped.push({ user, why: "already executed today" });
          await logSkip(env, kv, { user, dateStr, status: "skipped_executed_today", why: "already executed today", cfg });
          continue;
        }
        // Users pay their own execution gas from prepaid credit. If
        // the credit cannot cover one stipend, do not even try: the
        // contract would revert. Skip + log "skipped_gas_credit".
        const credit = await callUint(env, contract, AUTO_IFACE.encodeFunctionData("gasCredit", [user]));
        if (credit < stipend) {
          summary.skipped.push({
            user,
            why: "gas credit insufficient",
            status: "skipped_gas_credit",
            gasCreditWei: credit.toString(),
          });
          await logSkip(env, kv, {
            user,
            dateStr,
            status: "skipped_gas_credit",
            why: "gas credit insufficient",
            cfg,
          });
          continue;
        }
        const gross = await sumMintsToday(env, fish, user, startBlock, latest);
        if (gross === 0n) {
          summary.skipped.push({ user, why: "no FISH minted today" });
          await logSkip(env, kv, { user, dateStr, status: "skipped_no_mint", why: "no FISH minted today", cfg });
          continue;
        }
        const path = await buildPath(env, fish, cfg);
        if (!path) {
          summary.skipped.push({ user, why: "no swap path to target" });
          await logSkip(env, kv, {
            user,
            dateStr,
            status: "skipped_no_path",
            why: "no swap path to target",
            cfg,
            amountInWei: gross,
          });
          continue;
        }
        const data = AUTO_IFACE.encodeFunctionData("execute", [user, gross, path]);

        // Preflight: a reverting execute() is skipped and logged —
        // to KV history as well as the summary. (Before 2026-11-09
        // this branch only reached the console, which is why a
        // structurally reverting contract went unnoticed for a day.)
        try {
          await ethCall(env, contract, data, wallet.address);
        } catch (e) {
          const why = "preflight reverted: " + String(e && e.message).slice(0, 160);
          summary.skipped.push({ user, why });
          await logSkip(env, kv, { user, dateStr, status: "skipped_preflight", why, cfg, amountInWei: gross });
          continue;
        }

        // Expected amountIn (the contract recomputes it on-chain; this
        // is only for the history record).
        let amountIn = (gross * cfg.percentBps) / 10000n;
        if (amountIn > cfg.dailyCap) amountIn = cfg.dailyCap;
        try {
          const bal = await callUint(env, fish, ERC20_IFACE.encodeFunctionData("balanceOf", [user]));
          if (amountIn > bal) amountIn = bal;
          const allow = await callUint(
            env, fish, ERC20_IFACE.encodeFunctionData("allowance", [user, contract])
          );
          if (amountIn > allow) amountIn = allow;
        } catch (e) { /* keep the percent/cap estimate */ }

        let gasLimit = GAS_FALLBACK;
        try {
          const est = await rpc(env, "eth_estimateGas", [
            { from: wallet.address, to: contract, data },
          ]);
          const v = BigInt(est);
          if (v > 0n) gasLimit = (v * 120n) / 100n;
        } catch (e) { /* fallback */ }

        const signed = await wallet.signTransaction({
          to: contract,
          value: 0n,
          data,
          gasLimit: Number(gasLimit),
          gasPrice,
          nonce,
          chainId: CHAIN_ID,
        });
        const txHash = await rpc(env, "eth_sendRawTransaction", [signed]);
        nonce += 1;

        const receipt = await waitReceipt(env, txHash);
        const ok = receipt && receipt.status === "0x1";
        const targetSymbol = await tokenSymbol(env, cfg.targetToken);
        const record = {
          date: dateStr,
          ts: Math.floor(Date.now() / 1000),
          user,
          amountIn: ethers.formatEther(amountIn),
          amountInWei: amountIn.toString(),
          target: cfg.targetToken,
          targetSymbol,
          txHash,
          status: ok ? "success" : "failed",
        };
        if (kv) {
          const key = "hist:" + user.toLowerCase() + ":" + String(record.ts).padStart(12, "0") + ":" + txHash;
          await kv.put(key, JSON.stringify(record));
        }
        if (ok) summary.executed.push(record);
        else summary.failed.push({ user, txHash, why: receipt ? "tx reverted on-chain" : "no receipt in time" });
      } catch (e) {
        const why = String(e && e.message).slice(0, 200);
        summary.failed.push({ user, why });
        await logSkip(env, kv, { user, dateStr, status: "error", why, cfg: null });
      }
    }
    summary.ran = true;
    return finish(summary);
  } catch (e) {
    summary.reason = "error: " + String(e && e.message).slice(0, 200);
    return finish(summary);
  }
}

async function handleStatus(env) {
  const contract = contractAddress(env);
  const wallet = keeperWallet(env);
  const base = {
    contract,
    fish: fishAddress(env),
    keeperAddress: wallet ? wallet.address : null,
    chainId: CHAIN_ID,
  };
  if (!contract) {
    return json({ ready: false, reason: "not_ready", detail: "CONTRACT_ADDRESS not set", ...base });
  }
  let users = null;
  try {
    users = Number(await callUint(env, contract, AUTO_IFACE.encodeFunctionData("usersCount")));
  } catch (e) { /* RPC may be down; the key check below still applies */ }
  if (!wallet) {
    return json({ ready: false, reason: "not_ready", detail: "KEEPER_PRIVATE_KEY not set", users, ...base });
  }
  let keeperBalance = null;
  try {
    keeperBalance = ethers.formatEther(await rpc(env, "eth_getBalance", [wallet.address, "latest"]));
  } catch (e) { /* leave null */ }
  return json({ ready: true, reason: null, users, keeperBalance, ...base });
}

const HISTORY_MAX = 100;
async function handleHistory(env, url) {
  const rawUser = String(url.searchParams.get("user") || "").trim();
  let user;
  try {
    user = ethers.getAddress(rawUser);
  } catch (e) {
    return json({ ok: false, code: "invalid_address" }, 400);
  }
  const kv = env.AUTOSWAP_KV;
  if (!kv) return json({ ok: false, code: "misconfigured" }, 500);
  const prefix = "hist:" + user.toLowerCase() + ":";
  const listed = await kv.list({ prefix, limit: 1000 });
  const keys = listed.keys.map((k) => k.name).sort().reverse();
  const items = [];
  for (const key of keys.slice(0, HISTORY_MAX)) {
    const raw = await kv.get(key);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw);
      items.push({ ...rec, txUrl: rec.txHash ? EXPLORER_TX + rec.txHash : null });
    } catch (e) { /* skip corrupt record */ }
  }
  return json({ ok: true, user, total: keys.length, items });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      if (url.pathname === "/status" && request.method === "GET") {
        return await handleStatus(env);
      }
      if (url.pathname === "/history" && request.method === "GET") {
        return await handleHistory(env, url);
      }
      if (url.pathname === "/run" && request.method === "POST") {
        const secret = String(env.RUN_SECRET || "");
        if (!secret) return json({ ok: false, code: "run_disabled" }, 403);
        if (request.headers.get("x-run-secret") !== secret) {
          return json({ ok: false, code: "unauthorized" }, 401);
        }
        const summary = await runAll(env, "manual");
        return json({ ok: true, summary });
      }
      if (url.pathname === "/" && request.method === "GET") {
        return new Response(
          "FishAutoSwap keeper worker (42 Chain)\n" +
            "Cron: 10 0 * * * (00:10 UTC = 09:10 JST) — one execute() per registered user per day.\n" +
            "GET  /status\n" +
            "GET  /history?user=0x...\n" +
            "POST /run (header x-run-secret, only when RUN_SECRET is set)\n",
          { headers: { "Content-Type": "text/plain", ...CORS } }
        );
      }
      return json({ ok: false, code: "not_found" }, 404);
    } catch (e) {
      return json({ ok: false, code: "internal_error" }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runAll(env, "cron").then((s) => console.log("fish-autoswap run:", JSON.stringify(s)))
    );
  },
};
