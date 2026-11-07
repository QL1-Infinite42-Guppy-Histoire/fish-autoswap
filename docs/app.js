"use strict";
/* FISH AutoSwap — registration site. Vanilla JS only, no web3 library.
   Reads go through public 42 Chain RPCs; writes go through the user's
   own wallet (window.ethereum). This site NEVER asks for a seed phrase
   or a private key.

   Until CONFIG.CONTRACT_ADDRESS is filled in (the owner deploys the
   contract from admin.html, then pastes the address here), the
   registration actions stay in an honest "coming soon" state — the
   drop display, countdowns and explanations already work. */

var CONFIG = {
  CONTRACT_ADDRESS: "", // <-- owner: paste the deployed FishAutoSwap address here
  WORKER_URL: "https://fish-autoswap.nepicobsv.workers.dev"
};

var FISH = "0x2c32120a12b754272d9e85c57f64b50ca2c43513";
var CHAIN_ID_HEX = "0x66c9a"; // 421018
var RPCS = [
  "https://evm-rpc.infinitedrive.xyz",
  "https://evm-rpc-infinite.mschihuahua.org",
  "https://evm-rpc-infinitepanda.xyz"
];
var EXPLORER = "https://scan.infinitedrive.xyz";
var TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
var ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

var SEL = {
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  register: "0x3a774b48",
  disable: "0x2f2770db",
  configOf: "0x19091452",
  executedToday: "0x59a2398c"
};

/* Target candidates: the Don't Panic token list (FISH itself excluded —
   you cannot swap FISH into FISH) plus the native coin handled as
   value "native". Any other token can be added by contract address. */
var TOKENS = [
  { symbol: "USDT", address: "0xc2684966e5c95b2bc636fb4a1f3da9ad23d94753" },
  { symbol: "CAT42", address: "0x7386719ebbbeb4d810ff89027bfb8a1cdf696310" },
  { symbol: "ZAP", address: "0x89195ca5c954b6f99b78f4a2aa5435a75dc5b256" },
  { symbol: "FATHER", address: "0x8981f00e92f31a87af12f980383d2217706258e7" },
  { symbol: "KET", address: "0xb749d42e6004db590b2f04f32b87485402a061e2" },
  { symbol: "BABY", address: "0x77479226c103cc3c142faff6691bc7f849ce9c92" },
  { symbol: "QOM", address: "0x53465cbbba5b14f5dc00794330f0f4afb30eaa1d" },
  { symbol: "MARVIN", address: "0xa307362f8a756722541dde6255aecf64f35ba337" },
  { symbol: "O", address: "0xf4c14c0322e361f35eb9465c992fb1c21c91c156" },
  { symbol: "PANIC", address: "0xfaa842c8871f7f99c183f77871f79ce07dd056cd" },
  { symbol: "OSAK", address: "0x404f3a213ff6c5d654f4e95e6a7ed098b1c3d3b3" },
  { symbol: "FOXXEY", address: "0x68d5a28d3bf09a32d3b9c35714ab7a6166ae2a00" },
  { symbol: "BFOXX", address: "0x3a921a988099374c65433208a452195ea6a1e116" },
  { symbol: "HAWK", address: "0x4e3e79981a64d5678e2e70fd7b4b9550c2b41db2" },
  { symbol: "CAW", address: "0xce8aee7148daa8943453239c42b7b93f984a49f0" }
];

/* ---------- i18n ---------- */
var I18N = {
  en: {
    pageTitle: "FISH AutoSwap 🐟",
    pageSub: "Your morning FISH, swapped for you at 09:10",
    howTitle: "How it works — 3 easy steps",
    step1: "Every morning around 09:06 (Japan time), FISH arrives in your wallet — the reward for providing liquidity or locking TOWEL",
    step2: "Register once on this page: pick the token you want, how much of the FISH, and a daily limit",
    step3: "Every morning at 09:10, that day's FISH is swapped automatically. The new token comes straight into your wallet",
    howNote: "Only the FISH that arrived that morning is swapped — FISH you already had is not touched. Swapping uses the usual Don't Panic / Nutri-Matic pools on 42 Chain.",
    clockTitle: "Today's schedule (Japan time)",
    nextDropLabel: "Next FISH drop ≈ 09:06",
    nextRunLabel: "Next auto-swap 09:10",
    arrivesIn: "in {time}",
    noWalletTitle: "You need a wallet app",
    noWalletText: "No wallet was found in this browser. Please install a wallet app such as MetaMask, then open this page inside that app's browser. Never share your recovery phrase or private key with anyone — this site will never ask for it.",
    connectBtn: "Connect wallet",
    connectNote: "Tap to connect. We only read your public address — connecting alone cannot move your money.",
    yourWalletLabel: "Your wallet",
    rescanBtn: "Check again",
    switchChainBtn: "Switch to 42 Chain",
    dropTitle: "Your FISH today",
    dropTodayLabel: "FISH that arrived today",
    fishBalanceLabel: "Your FISH balance",
    dropNote: "Counted from this morning's delivery on the chain itself, so it matches what actually arrived.",
    dropLoading: "Checking the chain…",
    dropFailed: "Could not read the chain. Please tap “Check again” in a little while.",
    connectFirst: "Connect your wallet to see your numbers.",
    regTitle: "Your auto-swap registration",
    comingSoon: "🚧 Coming soon — registration is not open yet. The contract is being prepared. Everything else on this page (your drop, the countdowns) already works.",
    currentTitle: "Your current settings",
    notRegistered: "Not registered yet. Fill in the form below and do steps ① and ②.",
    cfgTarget: "Swap into",
    cfgPercent: "Share of the morning FISH",
    cfgCap: "Daily limit",
    cfgSlippage: "Price-move allowance (slippage)",
    cfgEnabledOn: "Auto-swap is ON",
    cfgEnabledOff: "Auto-swap is OFF",
    cfgAllowance: "FISH you have approved for this service",
    formTargetLabel: "Token you want to receive",
    nativeOption: "[42] (the chain's own coin)",
    customOption: "Other token (enter its address)…",
    customPlaceholder: "Token contract address (0x…)",
    lookupBtn: "Look up",
    lookupOk: "Found: {symbol} (decimals {decimals})",
    lookupFail: "That address does not look like a token on 42 Chain. Please check the address.",
    customIsFish: "That is FISH itself — please pick a different token.",
    formPercentLabel: "How much of the morning FISH to swap",
    formCapLabel: "Daily limit (FISH)",
    formSlippageLabel: "Price-move allowance",
    stepApproveTitle: "Step ① — Approve FISH",
    approveNote: "This gives the swap contract permission to use your FISH — only up to the amount below, and only FISH. The standard amount is your daily limit × 30 days, so you do not have to redo it every day. You can change it.",
    approveAmountLabel: "Approve amount (FISH)",
    approveBtn: "Approve",
    stepRegisterTitle: "Step ② — Register",
    registerBtn: "Register / Update settings",
    stopTitle: "Stop the service",
    disableBtn: "Turn OFF auto-swap",
    revokeBtn: "Take back the FISH permission (approve 0)",
    stopNote: "Both take effect right away. Turning OFF keeps your settings; taking back the permission means no FISH can be swapped at all until you approve again.",
    histTitle: "Your swap history",
    histEmpty: "No swaps yet. After the first morning run, it will show up here.",
    histFailed: "History is not available yet.",
    histAmount: "{amount} FISH → {target}",
    histTx: "See the record",
    trustTitle: "What this service can and cannot do",
    trustCanTitle: "It CAN",
    trustCan1: "Once a day at 09:10, swap the FISH that arrived that morning — only into the token you picked, only the share and up to the daily limit you set",
    trustCannotTitle: "It CANNOT",
    trustCannot1: "Take out or move any of your other tokens — the permission covers FISH only, up to the amount you approved",
    trustCannot2: "Change your chosen token, share, or limit — those are stored under your address and only you can change them",
    trustCannot3: "Keep the swapped tokens — they are sent straight to your wallet",
    trustCannot4: "Run more than once a day for you",
    safeTitle: "Please keep this safe",
    safe1: "Never enter your recovery phrase or private key anywhere. This site never asks for it.",
    safe2: "Each swap is done by a helper program (the “keeper”); it pays its own network fees. You do not need [42] in your wallet for the morning swap itself.",
    safe3: "Amounts are small and pools can be thin, so the received amount moves with the morning's prices. The price-move allowance you set is the limit.",
    contractLine: "FISH: 0x2c32120a12B754272d9E85C57F64b50cA2C43513 · Chain: 42 Chain (421018)",
    contractReadyLine: "AutoSwap contract: {addr}",
    footerText: "For 42 Chain (EVM chain ID 421018). The morning times are Japan time (drop ≈09:06, swap 09:10). Not affiliated with the chain operators.",
    ownerLink: "Owner",
    connected: "Connected.",
    rejected: "You cancelled in your wallet. Nothing happened — tap Connect when you are ready.",
    wrongChain: "Your wallet is on a different network. Please switch to 42 Chain.",
    switchOk: "Switched to 42 Chain.",
    sending: "Please confirm in your wallet…",
    waitingTx: "Waiting for the network to finish…",
    txDone: "Done!",
    txFailed: "It did not go through. Nothing was changed. You can try again.",
    txLink: "See the record",
    needConnect: "Please connect your wallet first.",
    badForm: "Please check the form: choose a token, a share between 1 and 100, and a daily limit above 0.",
    approveFirst: "Note: your approved amount is 0 right now. Do step ① (Approve) as well, or the morning swap cannot run.",
    alreadyToday: "Today's swap has already run.",
    notYetToday: "Today's swap has not run yet."
  },
  ja: {
    pageTitle: "FISH オートスワップ 🐟",
    pageSub: "毎朝届く FISH を、09:10 に自動で交換します",
    howTitle: "仕組みはかんたん 3ステップ",
    step1: "毎朝 09:06 ごろ（日本時間）、流動性提供や TOWEL ロックの報酬として FISH がウォレットに届きます",
    step2: "このページで1回だけ登録します。もらいたいトークン、交換する割合、1日の上限を決めます",
    step3: "毎朝 09:10 に、その朝届いた FISH が自動で交換され、選んだトークンがそのままあなたのウォレットに入ります",
    howNote: "交換されるのは「その朝届いた FISH」だけです。もともと持っていた FISH には触りません。交換には 42 Chain のいつものプール（Don't Panic / Nutri-Matic）を使います。",
    clockTitle: "今日の予定（日本時間）",
    nextDropLabel: "次の FISH 配布 ≈ 09:06",
    nextRunLabel: "次の自動交換 09:10",
    arrivesIn: "あと {time}",
    noWalletTitle: "ウォレットアプリが必要です",
    noWalletText: "このブラウザではウォレットが見つかりませんでした。MetaMask などのウォレットアプリを入れて、そのアプリの中のブラウザでこのページを開いてください。復旧フレーズや秘密鍵は絶対に誰にも教えないでください — このサイトが聞くことはありません。",
    connectBtn: "ウォレットをつなぐ",
    connectNote: "押すとつながります。あなたの公開アドレスを読むだけです — つなぐだけでお金が動くことはありません。",
    yourWalletLabel: "あなたのウォレット",
    rescanBtn: "もう一度調べる",
    switchChainBtn: "42 Chain に切り替える",
    dropTitle: "今日のあなたの FISH",
    dropTodayLabel: "今日届いた FISH",
    fishBalanceLabel: "いま持っている FISH",
    dropNote: "チェーン上の今朝の配布そのものを数えているので、実際に届いた量と一致します。",
    dropLoading: "チェーンを調べています…",
    dropFailed: "チェーンを読み込めませんでした。少し待ってから「もう一度調べる」を押してください。",
    connectFirst: "ウォレットをつなぐと、あなたの数字が見られます。",
    regTitle: "自動交換の登録",
    comingSoon: "🚧 準備中 — 登録はまだ始まっていません。コントラクトの準備ができ次第、ここで登録できるようになります。このページの他の部分（今日の配布・カウントダウン）はすでに動いています。",
    currentTitle: "いまの設定",
    notRegistered: "まだ登録されていません。下のフォームを入れて、①と②を行ってください。",
    cfgTarget: "交換先",
    cfgPercent: "朝届く FISH の割合",
    cfgCap: "1日の上限",
    cfgSlippage: "価格のブレの許容（スリッページ）",
    cfgEnabledOn: "自動交換は ON です",
    cfgEnabledOff: "自動交換は OFF です",
    cfgAllowance: "このサービスに許可している FISH",
    formTargetLabel: "もらいたいトークン",
    nativeOption: "[42]（チェーン自体のコイン）",
    customOption: "その他のトークン（アドレスを入力）…",
    customPlaceholder: "トークンのコントラクトアドレス（0x…）",
    lookupBtn: "調べる",
    lookupOk: "見つかりました: {symbol}（小数 {decimals} 桁）",
    lookupFail: "そのアドレスは 42 Chain のトークンではないようです。アドレスをご確認ください。",
    customIsFish: "それは FISH 自体です — 別のトークンを選んでください。",
    formPercentLabel: "朝届く FISH のうち交換する割合",
    formCapLabel: "1日の上限（FISH）",
    formSlippageLabel: "価格のブレの許容",
    stepApproveTitle: "手順 ① — FISH の使用を許可する",
    approveNote: "交換用コントラクトに、あなたの FISH を使ってよい許可を出します。対象は FISH だけ、量も下の金額までだけです。標準は「1日の上限 × 30日分」で、毎日やり直さなくて済みます。金額は変えられます。",
    approveAmountLabel: "許可する量（FISH）",
    approveBtn: "許可する",
    stepRegisterTitle: "手順 ② — 登録する",
    registerBtn: "登録 / 設定を更新",
    stopTitle: "サービスを止める",
    disableBtn: "自動交換を OFF にする",
    revokeBtn: "FISH の許可を取り消す（許可 0）",
    stopNote: "どちらもすぐに効きます。OFF は設定を残したまま止めます。許可を取り消すと、再び許可するまで FISH は一切交換されません。",
    histTitle: "あなたの交換履歴",
    histEmpty: "まだ交換履歴はありません。最初の朝の実行のあと、ここに表示されます。",
    histFailed: "履歴はまだ利用できません。",
    histAmount: "{amount} FISH → {target}",
    histTx: "記録を見る",
    trustTitle: "このサービスに「できること」「できないこと」",
    trustCanTitle: "できること",
    trustCan1: "1日1回 09:10 に、その朝届いた FISH を、あなたが選んだトークンへ、あなたが決めた割合・1日の上限の範囲で交換すること",
    trustCannotTitle: "できないこと",
    trustCannot1: "あなたの他のトークンを取り出したり動かしたりすること — 許可の対象は FISH だけ、しかも許可した量までです",
    trustCannot2: "交換先・割合・上限を変えること — それらはあなたのアドレスにひも付いて保存され、変えられるのはあなただけです",
    trustCannot3: "交換したトークンを預かること — 交換結果はそのままあなたのウォレットに送られます",
    trustCannot4: "1日に2回以上実行すること",
    safeTitle: "安全のためのお願い",
    safe1: "復旧フレーズや秘密鍵は、どこにも入力しないでください。このサイトが聞くことは決してありません。",
    safe2: "毎朝の交換は「キーパー」というお手伝いプログラムが行い、ネットワーク手数料はキーパー側が払います。朝の交換のためにあなたのウォレットに [42] は要りません。",
    safe3: "金額が小さくプールも薄いため、受け取る量はその朝の相場で変わります。あなたが設定した「価格のブレの許容」が上限です。",
    contractLine: "FISH: 0x2c32120a12B754272d9E85C57F64b50cA2C43513 · チェーン: 42 Chain (421018)",
    contractReadyLine: "オートスワップ用コントラクト: {addr}",
    footerText: "42 Chain（EVM チェーンID 421018）向けです。時刻は日本時間（配布 ≈09:06、交換 09:10）。チェーン運営者とは関係ありません。",
    ownerLink: "管理者",
    connected: "つながりました。",
    rejected: "ウォレットでキャンセルされました。何も起きていません — 準備ができたらもう一度つないでください。",
    wrongChain: "ウォレットが別のネットワークになっています。42 Chain に切り替えてください。",
    switchOk: "42 Chain に切り替えました。",
    sending: "ウォレットで確認してください…",
    waitingTx: "ネットワークの完了を待っています…",
    txDone: "できました！",
    txFailed: "完了しませんでした。何も変わっていません。もう一度お試しください。",
    txLink: "記録を見る",
    needConnect: "先にウォレットをつないでください。",
    badForm: "フォームをご確認ください: トークンを選び、割合は 1〜100、上限は 0 より大きくしてください。",
    approveFirst: "注意: いま許可量が 0 です。手順 ①（許可）も行わないと、朝の交換が実行されません。",
    alreadyToday: "今日の交換はすでに実行済みです。",
    notYetToday: "今日の交換はまだ実行されていません。"
  }
};

var LANG = (function () {
  if (/ja\.html/.test(location.pathname)) return "ja";
  if (/en\.html/.test(location.pathname)) return "en";
  try {
    return localStorage.getItem("fishautoswap_lang") === "ja" ? "ja" : "en";
  } catch (e) { return "en"; }
})();
var T = I18N[LANG];
function t(key, vars) {
  var s = T[key] || key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] !== undefined ? String(vars[k]) : "{" + k + "}";
    });
  }
  return s;
}
function el(id) { return document.getElementById(id); }
function setText(id, key) { var n = el(id); if (n) n.textContent = t(key); }

/* ---------- pure helpers ---------- */
function pad32(hexNoPrefix) {
  var h = String(hexNoPrefix).toLowerCase();
  while (h.length < 64) h = "0" + h;
  return h;
}
function encodeUint(v) { return pad32(BigInt(v).toString(16)); }
function encodeAddress(addr) { return pad32(String(addr).replace(/^0x/i, "")); }
function decodeUint(hex) {
  if (!hex || hex === "0x") return null;
  return BigInt(hex);
}
function decodeAddressWord(word) {
  if (!word || word.length < 40) return null;
  return "0x" + word.slice(-40).toLowerCase();
}
function isAddress(s) { return /^0x[0-9a-fA-F]{40}$/.test(String(s || "").trim()); }
function commas(digits) { return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
/* Format a wei BigInt (18 decimals) with up to 4 decimals, trimmed. */
function formatToken(wei, decimals) {
  var w = typeof wei === "bigint" ? wei : BigInt(wei);
  var dec = decimals === undefined ? 18 : decimals;
  var neg = w < 0n; if (neg) w = -w;
  var base = 10n ** BigInt(dec);
  var whole = w / base;
  var frac4 = (w % base) * 10000n / base;
  var frac = frac4.toString();
  while (frac.length < 4) frac = "0" + frac;
  frac = frac.replace(/0+$/, "");
  var s = commas(whole.toString()) + (frac ? "." + frac : "");
  return neg ? "-" + s : s;
}
/* Parse a human decimal string into wei (18 decimals). Returns null if invalid. */
function parseToken(str) {
  var s = String(str || "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  var parts = s.split(".");
  var whole = BigInt(parts[0]);
  var frac = (parts[1] || "") + "000000000000000000";
  frac = frac.slice(0, 18);
  return whole * (10n ** 18n) + BigInt(frac);
}

/* ---------- RPC (public, read-only) ---------- */
var rpcId = 1;
async function rpc(method, params) {
  var lastErr = null;
  for (var i = 0; i < RPCS.length; i++) {
    try {
      var res = await fetch(RPCS[i], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: method, params: params })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error.message || "rpc error");
      return data.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all RPC endpoints failed");
}
async function ethCall(to, data) { return rpc("eth_call", [{ to: to, data: data }, "latest"]); }
async function tokenBalance(token, addr) {
  var out = await ethCall(token, SEL.balanceOf + encodeAddress(addr));
  var v = decodeUint(out);
  return v === null ? 0n : v;
}
async function tokenAllowance(token, owner, spender) {
  var out = await ethCall(token, SEL.allowance + encodeAddress(owner) + encodeAddress(spender));
  var v = decodeUint(out);
  return v === null ? 0n : v;
}
async function blockTimestamp(n) {
  var b = await rpc("eth_getBlockByNumber", ["0x" + n.toString(16), false]);
  return Number(BigInt(b.timestamp));
}
/* First block at or after today's 00:00 UTC, by binary search. */
async function dayStartBlock() {
  var now = new Date();
  var dayTs = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
  var latest = Number(BigInt(await rpc("eth_blockNumber", [])));
  var lo = 0, hi = latest;
  while (lo < hi) {
    var mid = Math.floor((lo + hi) / 2);
    var ts = await blockTimestamp(mid);
    if (ts < dayTs) lo = mid + 1; else hi = mid;
  }
  return { start: lo, latest: latest };
}
/* Sum of today's FISH mints to addr (Transfer logs from the zero address). */
async function todaysDrop(addr) {
  var range = await dayStartBlock();
  var fromTopic = "0x" + pad32("");
  var toTopic = "0x" + encodeAddress(addr);
  var total = 0n;
  for (var s = range.start; s <= range.latest; s += 2000) {
    var e = Math.min(s + 1999, range.latest);
    var logs = await rpc("eth_getLogs", [{
      address: FISH,
      topics: [TRANSFER_TOPIC, fromTopic, toTopic],
      fromBlock: "0x" + s.toString(16),
      toBlock: "0x" + e.toString(16)
    }]);
    for (var i = 0; i < (logs || []).length; i++) {
      try { total += BigInt(logs[i].data); } catch (err) {}
    }
  }
  return total;
}

/* ---------- wallet ---------- */
var account = null;
function hasWallet() { return typeof window.ethereum !== "undefined"; }
async function walletChainId() {
  return window.ethereum.request({ method: "eth_chainId" });
}
async function ensureChain() {
  var cid = await walletChainId();
  if (cid === CHAIN_ID_HEX) return true;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }]
    });
    return true;
  } catch (e) {
    if (e && e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: "42 Chain",
          nativeCurrency: { name: "42", symbol: "42", decimals: 18 },
          rpcUrls: RPCS,
          blockExplorerUrls: [EXPLORER]
        }]
      });
      return (await walletChainId()) === CHAIN_ID_HEX;
    }
    return false;
  }
}
async function sendTx(to, data, resultEl) {
  var hash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: account, to: to, data: data, value: "0x0" }]
  });
  resultEl.className = "result";
  resultEl.innerHTML = t("waitingTx") + " ";
  var link = document.createElement("a");
  link.href = EXPLORER + "/tx/" + hash;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = t("txLink");
  resultEl.appendChild(link);
  for (var i = 0; i < 40; i++) {
    await new Promise(function (r) { setTimeout(r, 3000); });
    try {
      var rc = await rpc("eth_getTransactionReceipt", [hash]);
      if (rc) {
        if (rc.status === "0x1") {
          resultEl.className = "result ok";
          resultEl.innerHTML = t("txDone") + " ";
          resultEl.appendChild(link);
          return hash;
        }
        throw new Error("reverted");
      }
    } catch (e) {
      if (e && e.message === "reverted") throw e;
    }
  }
  throw new Error("timeout");
}
function txError(resultEl, e) {
  resultEl.className = "result error";
  resultEl.textContent = t("txFailed");
}

/* ---------- state / rendering ---------- */
var ready = isAddress(CONFIG.CONTRACT_ADDRESS);
var currentConfig = null;
var customToken = null; // {symbol, address, decimals}

function applyI18n() {
  document.title = t("pageTitle") + " — 42 Chain";
  setText("pageTitle", "pageTitle");
  setText("pageSub", "pageSub");
  setText("howTitle", "howTitle");
  setText("step1", "step1");
  setText("step2", "step2");
  setText("step3", "step3");
  setText("howNote", "howNote");
  setText("clockTitle", "clockTitle");
  setText("nextDropLabel", "nextDropLabel");
  setText("nextRunLabel", "nextRunLabel");
  setText("noWalletTitle", "noWalletTitle");
  setText("noWalletText", "noWalletText");
  setText("connectBtn", "connectBtn");
  setText("connectNote", "connectNote");
  setText("yourWalletLabel", "yourWalletLabel");
  setText("rescanBtn", "rescanBtn");
  setText("switchChainBtn", "switchChainBtn");
  setText("dropTitle", "dropTitle");
  setText("dropTodayLabel", "dropTodayLabel");
  setText("fishBalanceLabel", "fishBalanceLabel");
  setText("dropNote", "dropNote");
  setText("regTitle", "regTitle");
  setText("comingSoon", "comingSoon");
  setText("currentTitle", "currentTitle");
  setText("formTargetLabel", "formTargetLabel");
  setText("lookupBtn", "lookupBtn");
  setText("formPercentLabel", "formPercentLabel");
  setText("formCapLabel", "formCapLabel");
  setText("formSlippageLabel", "formSlippageLabel");
  setText("stepApproveTitle", "stepApproveTitle");
  setText("approveNote", "approveNote");
  setText("approveAmountLabel", "approveAmountLabel");
  setText("approveBtn", "approveBtn");
  setText("stepRegisterTitle", "stepRegisterTitle");
  setText("registerBtn", "registerBtn");
  setText("stopTitle", "stopTitle");
  setText("disableBtn", "disableBtn");
  setText("revokeBtn", "revokeBtn");
  setText("stopNote", "stopNote");
  setText("histTitle", "histTitle");
  setText("trustTitle", "trustTitle");
  setText("trustCanTitle", "trustCanTitle");
  setText("trustCan1", "trustCan1");
  setText("trustCannotTitle", "trustCannotTitle");
  setText("trustCannot1", "trustCannot1");
  setText("trustCannot2", "trustCannot2");
  setText("trustCannot3", "trustCannot3");
  setText("trustCannot4", "trustCannot4");
  setText("safeTitle", "safeTitle");
  setText("safe1", "safe1");
  setText("safe2", "safe2");
  setText("safe3", "safe3");
  setText("footerText", "footerText");
  setText("ownerLink", "ownerLink");
  el("customAddr").placeholder = t("customPlaceholder");
  var line = t("contractLine");
  if (ready) line += " · " + t("contractReadyLine", { addr: CONFIG.CONTRACT_ADDRESS });
  el("contractLine").textContent = line;
  var sel = el("langSel");
  if (sel) sel.value = LANG;
  buildTargetOptions();
  if (!ready) {
    el("comingSoon").hidden = false;
    ["approveBtn", "registerBtn", "disableBtn", "revokeBtn"].forEach(function (id) {
      el(id).disabled = true;
    });
  }
}

function buildTargetOptions() {
  var sel = el("targetSel");
  var prev = sel.value;
  sel.innerHTML = "";
  var optNative = document.createElement("option");
  optNative.value = "native";
  optNative.textContent = t("nativeOption");
  sel.appendChild(optNative);
  TOKENS.forEach(function (tk) {
    var o = document.createElement("option");
    o.value = tk.address;
    o.textContent = tk.symbol;
    sel.appendChild(o);
  });
  var optCustom = document.createElement("option");
  optCustom.value = "custom";
  optCustom.textContent = t("customOption");
  sel.appendChild(optCustom);
  if (prev) sel.value = prev;
  el("customBox").hidden = sel.value !== "custom";
}

function selectedTarget() {
  var v = el("targetSel").value;
  if (v === "native") return { address: ZERO_ADDRESS, symbol: "42" };
  if (v === "custom") return customToken;
  for (var i = 0; i < TOKENS.length; i++) {
    if (TOKENS[i].address === v) return TOKENS[i];
  }
  return null;
}

function symbolOf(address) {
  if (!address || address === ZERO_ADDRESS) return "42";
  var a = address.toLowerCase();
  for (var i = 0; i < TOKENS.length; i++) {
    if (TOKENS[i].address === a) return TOKENS[i].symbol;
  }
  if (customToken && customToken.address === a) return customToken.symbol;
  return a.slice(0, 6) + "…" + a.slice(-4);
}

/* Decode configOf's six returned words. */
function decodeConfig(hex) {
  if (!hex || hex === "0x" || hex.length < 2 + 64 * 6) return null;
  var h = hex.slice(2);
  var word = function (i) { return h.slice(i * 64, (i + 1) * 64); };
  return {
    targetToken: decodeAddressWord(word(0)),
    percentBps: BigInt("0x" + word(1)),
    dailyCap: BigInt("0x" + word(2)),
    slippageBps: BigInt("0x" + word(3)),
    enabled: BigInt("0x" + word(4)) !== 0n,
    registered: BigInt("0x" + word(5)) !== 0n
  };
}

async function loadOnChain() {
  if (!account) return;
  var dropEl = el("dropToday");
  var balEl = el("fishBalance");
  dropEl.textContent = t("dropLoading");
  try {
    var bal = await tokenBalance(FISH, account);
    balEl.textContent = formatToken(bal) + " FISH";
    var drop = await todaysDrop(account);
    dropEl.textContent = formatToken(drop) + " FISH";
  } catch (e) {
    dropEl.textContent = "—";
    el("dropResult").textContent = t("dropFailed");
  }
  if (ready) {
    try {
      var out = await ethCall(CONFIG.CONTRACT_ADDRESS, SEL.configOf + encodeAddress(account));
      currentConfig = decodeConfig(out);
      var allow = await tokenAllowance(FISH, account, CONFIG.CONTRACT_ADDRESS);
      renderConfig(allow);
      var done = await ethCall(CONFIG.CONTRACT_ADDRESS, SEL.executedToday + encodeAddress(account));
      el("executedLine").textContent =
        decodeUint(done) !== 0n ? t("alreadyToday") : t("notYetToday");
    } catch (e) {
      el("currentBody").textContent = t("dropFailed");
    }
  }
  loadHistory();
}

function renderConfig(allowance) {
  var box = el("currentBody");
  box.innerHTML = "";
  if (!currentConfig || !currentConfig.registered) {
    box.textContent = t("notRegistered");
    if (allowance !== undefined) {
      var p0 = document.createElement("p");
      p0.className = "note";
      p0.textContent = t("cfgAllowance") + ": " + formatToken(allowance) + " FISH";
      box.appendChild(p0);
    }
    return;
  }
  var rows = [
    [t("cfgTarget"), symbolOf(currentConfig.targetToken)],
    [t("cfgPercent"), (Number(currentConfig.percentBps) / 100).toString() + "%"],
    [t("cfgCap"), formatToken(currentConfig.dailyCap) + " FISH"],
    [t("cfgSlippage"), (Number(currentConfig.slippageBps) / 100).toString() + "%"],
    [t("cfgAllowance"), formatToken(allowance) + " FISH"]
  ];
  rows.forEach(function (r) {
    var div = document.createElement("div");
    div.className = "cfg-row";
    var a = document.createElement("span");
    a.className = "cfg-label";
    a.textContent = r[0];
    var b = document.createElement("span");
    b.className = "cfg-value";
    b.textContent = r[1];
    div.appendChild(a);
    div.appendChild(b);
    box.appendChild(div);
  });
  var st = document.createElement("p");
  st.className = "note";
  st.textContent = currentConfig.enabled ? t("cfgEnabledOn") : t("cfgEnabledOff");
  box.appendChild(st);
  // Prefill the form from the current config.
  el("percentInput").value = String(Number(currentConfig.percentBps) / 100);
  el("capInput").value = formatToken(currentConfig.dailyCap);
  syncApproveDefault();
  var targetAddr = currentConfig.targetToken;
  el("targetSel").value =
    targetAddr === ZERO_ADDRESS ? "native" : targetAddr;
  if (el("targetSel").value !== targetAddr && targetAddr !== ZERO_ADDRESS) {
    el("targetSel").value = "custom";
    el("customBox").hidden = false;
    el("customAddr").value = targetAddr;
  }
}

async function loadHistory() {
  var list = el("histList");
  var note = el("histNote");
  list.innerHTML = "";
  try {
    var res = await fetch(CONFIG.WORKER_URL + "/history?user=" + account);
    var data = await res.json();
    if (!data.ok) throw new Error("bad");
    if (!data.items || data.items.length === 0) {
      note.textContent = t("histEmpty");
      return;
    }
    note.textContent = "";
    data.items.forEach(function (rec) {
      var div = document.createElement("div");
      div.className = "hist-item";
      var main = document.createElement("div");
      var d = new Date((rec.ts || 0) * 1000);
      main.textContent =
        d.toLocaleDateString() + " " + d.toLocaleTimeString() + " — " +
        t("histAmount", { amount: rec.amountIn, target: rec.targetSymbol || rec.target });
      if (rec.status && rec.status !== "success") main.textContent += " (" + rec.status + ")";
      var a = document.createElement("a");
      a.href = rec.txUrl || (EXPLORER + "/tx/" + rec.txHash);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = t("histTx");
      div.appendChild(main);
      div.appendChild(a);
      list.appendChild(div);
    });
  } catch (e) {
    note.textContent = t("histFailed");
  }
}

/* ---------- countdowns (drop 00:06 UTC = 09:06 JST, run 00:10 UTC = 09:10 JST) ---------- */
function nextUtcTime(hour, minute) {
  var now = new Date();
  var c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0));
  if (c <= now) c = new Date(c.getTime() + 24 * 3600 * 1000);
  return c;
}
function fmtCountdown(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return (h > 0 ? h + ":" : "") + p(m) + ":" + p(sec);
}
function tickClocks() {
  var now = new Date();
  var drop = nextUtcTime(0, 6);
  var run = nextUtcTime(0, 10);
  el("nextDrop").textContent = t("arrivesIn", { time: fmtCountdown(drop - now) });
  el("nextRun").textContent = t("arrivesIn", { time: fmtCountdown(run - now) });
}

/* ---------- events ---------- */
function init() {
  applyI18n();
  tickClocks();
  setInterval(tickClocks, 1000);

  el("langSel").addEventListener("change", function () {
    try { localStorage.setItem("fishautoswap_lang", this.value); } catch (e) {}
    location.href = this.value + ".html";
  });

  if (!hasWallet()) {
    el("noWalletPanel").hidden = false;
    el("connectPanel").hidden = true;
  }

  el("connectBtn").addEventListener("click", async function () {
    var res = el("connectResult");
    try {
      var accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      account = accounts[0];
      var ok = await ensureChain();
      if (!ok) {
        res.className = "result error";
        res.textContent = t("wrongChain");
        el("switchChainBtn").hidden = false;
        return;
      }
      res.className = "result ok";
      res.textContent = t("connected");
      showAccount();
    } catch (e) {
      res.className = "result error";
      res.textContent = t("rejected");
    }
  });

  el("switchChainBtn").addEventListener("click", async function () {
    var res = el("connectResult");
    var ok = await ensureChain();
    if (ok) {
      res.className = "result ok";
      res.textContent = t("switchOk");
      el("switchChainBtn").hidden = true;
      if (account) showAccount();
    }
  });

  el("rescanBtn").addEventListener("click", loadOnChain);
  el("targetSel").addEventListener("change", function () {
    el("customBox").hidden = this.value !== "custom";
  });

  el("lookupBtn").addEventListener("click", async function () {
    var out = el("lookupResult");
    var addr = el("customAddr").value.trim().toLowerCase();
    out.className = "result";
    if (!isAddress(addr)) { out.textContent = t("lookupFail"); customToken = null; return; }
    if (addr === FISH) { out.textContent = t("customIsFish"); customToken = null; return; }
    try {
      var symHex = await ethCall(addr, SEL.symbol);
      var decHex = await ethCall(addr, SEL.decimals);
      var sym = decodeSymbol(symHex);
      var dec = Number(decodeUint(decHex));
      if (!sym || isNaN(dec)) throw new Error("not a token");
      customToken = { symbol: sym, address: addr, decimals: dec };
      out.className = "result ok";
      out.textContent = t("lookupOk", { symbol: sym, decimals: dec });
    } catch (e) {
      customToken = null;
      out.textContent = t("lookupFail");
    }
  });

  document.querySelectorAll(".chip[data-percent]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      el("percentInput").value = chip.getAttribute("data-percent");
      document.querySelectorAll(".chip[data-percent]").forEach(function (c) {
        c.classList.toggle("active", c === chip);
      });
    });
  });
  document.querySelectorAll(".chip[data-slippage]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      el("slippageInput").value = chip.getAttribute("data-slippage");
      document.querySelectorAll(".chip[data-slippage]").forEach(function (c) {
        c.classList.toggle("active", c === chip);
      });
    });
  });

  el("capInput").addEventListener("input", syncApproveDefault);
  el("approveAmount").addEventListener("input", function () {
    this.setAttribute("data-touched", "1");
  });

  el("approveBtn").addEventListener("click", async function () {
    var res = el("regResult");
    if (!account) { res.textContent = t("needConnect"); return; }
    if (!ready) return;
    var amount = parseToken(el("approveAmount").value);
    if (amount === null || amount < 0n) { res.textContent = t("badForm"); return; }
    res.textContent = t("sending");
    try {
      await sendTx(FISH, SEL.approve + encodeAddress(CONFIG.CONTRACT_ADDRESS) + encodeUint(amount), res);
      loadOnChain();
    } catch (e) { txError(res, e); }
  });

  el("registerBtn").addEventListener("click", async function () {
    var res = el("regResult");
    if (!account) { res.textContent = t("needConnect"); return; }
    if (!ready) return;
    var target = selectedTarget();
    var percent = Number(el("percentInput").value);
    var cap = parseToken(el("capInput").value);
    var slippage = Number(el("slippageInput").value);
    if (!target || !(percent >= 1 && percent <= 100) || cap === null || cap <= 0n || !(slippage >= 0 && slippage <= 5000)) {
      res.className = "result error";
      res.textContent = t("badForm");
      return;
    }
    var data = SEL.register +
      encodeAddress(target.address) +
      encodeUint(Math.round(percent * 100)) +
      encodeUint(cap) +
      encodeUint(slippage);
    res.textContent = t("sending");
    try {
      await sendTx(CONFIG.CONTRACT_ADDRESS, data, res);
      var allow = await tokenAllowance(FISH, account, CONFIG.CONTRACT_ADDRESS);
      if (allow === 0n) {
        res.innerHTML = t("txDone") + "<br>" + t("approveFirst");
      }
      loadOnChain();
    } catch (e) { txError(res, e); }
  });

  el("disableBtn").addEventListener("click", async function () {
    var res = el("regResult");
    if (!account) { res.textContent = t("needConnect"); return; }
    if (!ready) return;
    res.textContent = t("sending");
    try {
      await sendTx(CONFIG.CONTRACT_ADDRESS, SEL.disable, res);
      loadOnChain();
    } catch (e) { txError(res, e); }
  });

  el("revokeBtn").addEventListener("click", async function () {
    var res = el("regResult");
    if (!account) { res.textContent = t("needConnect"); return; }
    if (!ready) return;
    res.textContent = t("sending");
    try {
      await sendTx(FISH, SEL.approve + encodeAddress(CONFIG.CONTRACT_ADDRESS) + encodeUint(0n), res);
      loadOnChain();
    } catch (e) { txError(res, e); }
  });

  if (hasWallet() && window.ethereum.on) {
    window.ethereum.on("accountsChanged", function (accs) {
      account = accs && accs[0] ? accs[0] : null;
      if (account) showAccount();
    });
    window.ethereum.on("chainChanged", function () { location.reload(); });
  }
}

function decodeSymbol(hex) {
  if (!hex || hex === "0x") return null;
  try {
    var h = hex.slice(2);
    // ABI string: offset word, length word, then UTF-8 bytes.
    if (h.length >= 128) {
      var len = Number(BigInt("0x" + h.slice(64, 128)));
      var bytes = h.slice(128, 128 + len * 2);
      var out = "";
      for (var i = 0; i < bytes.length; i += 2) {
        out += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
      }
      return decodeURIComponent(escape(out));
    }
    // bytes32-style symbol
    var s = "";
    for (var j = 0; j < h.length; j += 2) {
      var c = parseInt(h.slice(j, j + 2), 16);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s || null;
  } catch (e) { return null; }
}

function syncApproveDefault() {
  var amt = el("approveAmount");
  if (amt.getAttribute("data-touched")) return;
  var cap = parseToken(el("capInput").value);
  if (cap === null) return;
  amt.value = formatToken(cap * 30n);
}

function showAccount() {
  el("connectBox").hidden = true;
  el("accountBox").hidden = false;
  el("walletAddr").textContent = account;
  el("dropPanel").hidden = false;
  el("histPanel").hidden = false;
  loadOnChain();
}

document.addEventListener("DOMContentLoaded", init);
