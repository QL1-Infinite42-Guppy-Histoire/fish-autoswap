"use strict";
/* FISH AutoSwap — registration site. Vanilla JS only, no web3 library.
   Reads go through public 42 Chain RPCs; writes go through the user's
   own wallet (an injected EIP-1193 provider). This site NEVER asks for a seed phrase
   or a private key.

   Until CONFIG.CONTRACT_ADDRESS is filled in (the owner deploys the
   contract from admin.html, then pastes the address here), the
   registration actions stay in an honest "coming soon" state — the
   drop display, countdowns and explanations already work. */

var CONFIG = {
  CONTRACT_ADDRESS: "0x478bd3bbd12b906a83c803aa6c14684d150ab994", // deployed 2026-11-07 by the owner
  WORKER_URL: "https://fish-autoswap.nepicobsv.workers.dev"
};

/* Maintenance mode (owner decision 2026-11-09): the morning keeper run
   failed for a reason still being investigated, so the service is
   publicly marked "under maintenance". While this is true, every write
   action is disabled EXCEPT withdrawing deposited gas money ([42]) —
   users must always be able to take their own deposit back. All reads,
   the wallet connection and the withdrawal flow work exactly as before.
   Set back to false to reopen the service. */
var MAINTENANCE = true;

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
  executedToday: "0x59a2398c",
  depositGas: "0xae9bb692",
  withdrawGas: "0x91657544",
  gasCredit: "0x894912ac",
  gasStipend: "0x9434c910",
  usersCount: "0x6ba13a82",
  userAt: "0x598a96bf"
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
    step2: "Register once on this page: pick the token you want, how much of the FISH, and a daily limit — and deposit a little [42] to cover the morning runs' network fees",
    step3: "Every morning at 09:10, that day's FISH is swapped automatically. The new token comes straight into your wallet",
    howNote: "Only the FISH that arrived that morning is swapped — FISH you already had is not touched. Swapping uses the usual Don't Panic / Nutri-Matic pools on 42 Chain.",
    clockTitle: "Today's schedule (Japan time)",
    nextDropLabel: "Next FISH drop ≈ 09:06",
    nextRunLabel: "Next auto-swap 09:10",
    arrivesIn: "in {time}",
    noWalletTitle: "You need a wallet app",
    noWalletText: "No wallet was found in this browser. If you have MetaMask, tap the button below to open this page inside it. With another wallet app (such as FoxWallet), copy this page's URL below and paste it into that app's browser. Never share your recovery phrase or private key with anyone — this site will never ask for it.",
    openMetaMaskBtn: "Open in MetaMask",
    copyUrlBtn: "Copy this page's URL",
    urlCopied: "Copied! Open your wallet app and paste the URL into its browser.",
    urlCopyFail: "Could not copy automatically — please copy this URL by hand: ",
    connectBtn: "Connect wallet",
    connectWithBtn: "Connect with {name}",
    walletGeneric: "Wallet",
    checkingWallet: "Check your wallet app…",
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
    maintenanceTitle: "🛠️ Under maintenance",
    maintenanceText: "The auto-swap service is currently under maintenance. New registrations, settings changes and gas deposits are paused. You can still withdraw your deposited [42] at any time.",
    statusMaintenance: "🛠️ Under maintenance",
    maintenanceRegNote: "🛠️ Under maintenance — new registrations, settings changes, approvals and gas deposits are paused. The only action available is withdrawing your deposited [42] (step ③, “Take back”).",
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
    stepGasTitle: "Step ③ — Deposit gas money ([42])",
    gasNote: "Each morning run needs a little of the chain's own coin, [42], as its network fee. You pay it yourself, in advance: deposit a small amount here, and each successful run takes exactly the per-run amount below from your deposit and gives it to the helper program (the keeper) that sent the swap. A run that does not happen takes nothing. Whatever is left is yours — you can take it back at any time below.",
    gasCreditLabel: "Gas money you have deposited",
    gasRunsLabel: "That covers about",
    gasRunsValue: "≈ {runs} runs (about {runs} days)",
    gasPerRun: "One run costs exactly {amount} [42] from your deposit.",
    gasWarn: "⚠️ Your gas deposit is below one run's fee, so the auto-swap is paused. Please deposit a little [42].",
    gasDepositLabel: "Deposit amount ([42])",
    gasDepositBtn: "Deposit gas money",
    gasWithdrawLabel: "Take back unused gas money ([42])",
    gasWithdrawBtn: "Take back",
    badGasAmount: "Please enter an amount above 0.",
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
    trustCan2: "Pay the morning run's network fee from the [42] you deposited on this page — exactly the one per-run amount, and only after a successful swap",
    trustCannotTitle: "It CANNOT",
    trustCannot1: "Take out or move any of your other tokens — the permission covers FISH only, up to the amount you approved",
    trustCannot2: "Change your chosen token, share, or limit — those are stored under your address and only you can change them",
    trustCannot3: "Keep the swapped tokens — they are sent straight to your wallet",
    trustCannot4: "Run more than once a day for you",
    trustCannot5: "Touch the [42] you deposited for gas — only you can take it back, and the service operator never pays your gas for you",
    safeTitle: "Please keep this safe",
    safe1: "Never enter your recovery phrase or private key anywhere. This site never asks for it.",
    safe2: "The morning swap's network fee is paid from the [42] you deposit in step ③ — exactly the per-run amount shown there, nothing more, and only when a swap succeeds. The operator does not pay it for you. If your deposit runs out, swaps pause until you top it up; unused money can be taken back at any time.",
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
    notYetToday: "Today's swap has not run yet.",
    statusChecking: "Checking the service status…",
    statusRunning: "🟢 Running",
    statusStopped: "🔴 Not running",
    statusUnknown: "Could not check the service status",
    statusScope: "Covers: FISH (each morning's drop) → the token you choose",
    statusUsers: "Registered users: {n}",
    statusReasonPrefix: "Reason: ",
    myStatusTitle: "Your auto-swap status",
    myRunning: "🟢 Running: FISH → {symbol}",
    myPaused: "⏸ Paused: auto-swap is OFF",
    myNotRegistered: "Not registered yet",
    myNotRegDetail: "Register below and the morning auto-swap will start for you.",
    myDetail: "{percent}% of the morning FISH · daily limit {cap} FISH",
    myLoading: "Checking…",
    myLoadFailed: "Could not read your status. Please tap “Check again” in a little while.",
    nativeSymbol: "[42]",
    boardTitle: "Registered addresses",
    boardTitleCount: "Registered addresses ({n})",
    boardNote: "Everyone registered for the morning auto-swap, read straight from the contract — anyone can check this list.",
    boardRefresh: "Refresh",
    boardLoading: "Loading…",
    boardEmpty: "No registrations yet",
    boardFailed: "Could not load the list. Please tap Refresh in a little while.",
    boardRoute: "FISH → {symbol}",
    boardShare: "share {percent}%",
    boardActive: "Active",
    boardPaused: "Paused",
    boardYou: "You",
    boardMore: "Showing the newest {shown} of {n} registrations."
  },
  ja: {
    pageTitle: "FISH オートスワップ 🐟",
    pageSub: "毎朝届く FISH を、09:10 に自動で交換します",
    howTitle: "仕組みはかんたん 3ステップ",
    step1: "毎朝 09:06 ごろ（日本時間）、流動性提供や TOWEL ロックの報酬として FISH がウォレットに届きます",
    step2: "このページで1回だけ登録します。もらいたいトークン、交換する割合、1日の上限を決めて、朝の実行のネットワーク手数料用に [42] を少し預けます",
    step3: "毎朝 09:10 に、その朝届いた FISH が自動で交換され、選んだトークンがそのままあなたのウォレットに入ります",
    howNote: "交換されるのは「その朝届いた FISH」だけです。もともと持っていた FISH には触りません。交換には 42 Chain のいつものプール（Don't Panic / Nutri-Matic）を使います。",
    clockTitle: "今日の予定（日本時間）",
    nextDropLabel: "次の FISH 配布 ≈ 09:06",
    nextRunLabel: "次の自動交換 09:10",
    arrivesIn: "あと {time}",
    noWalletTitle: "ウォレットアプリが必要です",
    noWalletText: "このブラウザではウォレットが見つかりませんでした。MetaMask がある方は、下のボタンでこのページを MetaMask の中で開けます。FoxWallet など他のウォレットアプリの方は、下のボタンでURLをコピーして、アプリの中のブラウザに貼り付けて開いてください。復旧フレーズや秘密鍵は絶対に誰にも教えないでください — このサイトが聞くことはありません。",
    openMetaMaskBtn: "MetaMask で開く",
    copyUrlBtn: "このページのURLをコピー",
    urlCopied: "コピーしました！ウォレットアプリを開いて、その中のブラウザに貼り付けてください。",
    urlCopyFail: "自動でコピーできませんでした。このURLを手でコピーしてください： ",
    connectBtn: "ウォレットをつなぐ",
    connectWithBtn: "{name} でつなぐ",
    walletGeneric: "ウォレット",
    checkingWallet: "ウォレットアプリで確認してください…",
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
    maintenanceTitle: "🛠️ メンテナンス中",
    maintenanceText: "自動スワップは現在メンテナンス中です。新規登録・設定変更・ガス代の預け入れは停止しています。預けた [42] の引き出しはいつでもできます。",
    statusMaintenance: "🛠️ メンテナンス中",
    maintenanceRegNote: "🛠️ メンテナンス中 — 新規登録・設定変更・許可・ガス代の預け入れは停止しています。使えるのは、預けた [42] の引き出し（手順③の「取り戻す」）だけです。",
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
    stepGasTitle: "手順 ③ — ガス代を預ける（[42]）",
    gasNote: "毎朝の実行には、ネットワーク手数料としてチェーン自体のコイン [42] が少しだけ必要です。その手数料は、あなた自身が前もって払う形です。ここに少額を預けておくと、交換が成功した実行のたびに、下の「1回分」ちょうどが預かりから実行役のプログラム（キーパー）に渡ります。実行されなければ何も引かれません。余った分はあなたのもので、下のボタンからいつでも取り戻せます。",
    gasCreditLabel: "預けているガス代",
    gasRunsLabel: "あと約",
    gasRunsValue: "約 {runs} 回分（約 {runs} 日分）",
    gasPerRun: "実行1回ごとに、預かりからちょうど {amount} [42] が使われます。",
    gasWarn: "⚠️ ガス代の預かりが不足しているため、自動交換は止まっています。少し [42] を預けてください。",
    gasDepositLabel: "預ける量（[42]）",
    gasDepositBtn: "ガス代を預ける",
    gasWithdrawLabel: "余ったガス代を取り戻す（[42]）",
    gasWithdrawBtn: "取り戻す",
    badGasAmount: "0 より大きい金額を入れてください。",
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
    trustCan2: "このページで預けた [42] から、朝の実行のネットワーク手数料を払うこと — 引かれるのは「1回分」ちょうどで、交換が成功したときだけです",
    trustCannotTitle: "できないこと",
    trustCannot1: "あなたの他のトークンを取り出したり動かしたりすること — 許可の対象は FISH だけ、しかも許可した量までです",
    trustCannot2: "交換先・割合・上限を変えること — それらはあなたのアドレスにひも付いて保存され、変えられるのはあなただけです",
    trustCannot3: "交換したトークンを預かること — 交換結果はそのままあなたのウォレットに送られます",
    trustCannot4: "1日に2回以上実行すること",
    trustCannot5: "ガス代として預けた [42] に触ること — 取り戻せるのはあなただけで、運営者があなたのガス代を肩代わりすることもありません",
    safeTitle: "安全のためのお願い",
    safe1: "復旧フレーズや秘密鍵は、どこにも入力しないでください。このサイトが聞くことは決してありません。",
    safe2: "朝の交換のネットワーク手数料は、手順③で預けた [42] から払われます。引かれるのはそこに表示される「1回分」ちょうどだけで、交換が成功したときだけです。運営者が肩代わりすることはありません。預かりが無くなると交換は止まりますが、余った分はいつでも取り戻せます。",
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
    notYetToday: "今日の交換はまだ実行されていません。",
    statusChecking: "サービスの状態を確認しています…",
    statusRunning: "🟢 稼働中",
    statusStopped: "🔴 停止中",
    statusUnknown: "状態を確認できませんでした",
    statusScope: "対象： FISH（毎朝の配布分）→ あなたが選んだトークン",
    statusUsers: "登録者数： {n}人",
    statusReasonPrefix: "理由： ",
    myStatusTitle: "あなたの稼働状態",
    myRunning: "🟢 稼働中： FISH → {symbol}",
    myPaused: "⏸ 停止中：自動交換は OFF です",
    myNotRegistered: "まだ登録していません",
    myNotRegDetail: "下のフォームから登録すると、毎朝の自動交換が始まります。",
    myDetail: "割合 {percent}% ・ 1日上限 {cap} FISH",
    myLoading: "確認しています…",
    myLoadFailed: "状態を読み取れませんでした。少し待ってから「もう一度調べる」を押してください。",
    nativeSymbol: "[42]",
    boardTitle: "登録済みアドレス",
    boardTitleCount: "登録済みアドレス（{n}件）",
    boardNote: "毎朝の自動交換に登録しているアドレスの一覧です。コントラクトから直接読み取っているので、誰でも確認できます。",
    boardRefresh: "更新",
    boardLoading: "読み込んでいます…",
    boardEmpty: "まだ登録がありません",
    boardFailed: "一覧を読み込めませんでした。少し待ってから「更新」を押してください。",
    boardRoute: "FISH → {symbol}",
    boardShare: "割合 {percent}%",
    boardActive: "有効",
    boardPaused: "停止中",
    boardYou: "あなた",
    boardMore: "全 {n} 件のうち、最新の {shown} 件を表示しています。"
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
function ethCallReq(to, data) {
  return { method: "eth_call", params: [{ to: to, data: data }, "latest"] };
}
/* Batched JSON-RPC: many calls in one HTTP round-trip, results aligned
   with the request order. Throws if any item fails, so callers can
   show an honest error state instead of a half-filled list. */
async function rpcBatch(calls) {
  var lastErr = null;
  for (var i = 0; i < RPCS.length; i++) {
    try {
      var base = rpcId;
      var payload = calls.map(function (c, j) {
        return { jsonrpc: "2.0", id: base + j, method: c.method, params: c.params };
      });
      rpcId += calls.length;
      var res = await fetch(RPCS[i], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!Array.isArray(data)) throw new Error("bad batch response");
      var byId = {};
      data.forEach(function (d) { byId[d.id] = d; });
      return payload.map(function (p) {
        var d = byId[p.id];
        if (!d) throw new Error("missing batch item");
        if (d.error) throw new Error(d.error.message || "rpc error");
        return d.result;
      });
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all RPC endpoints failed");
}
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

/* ---------- wallet providers ---------- */
/* Visitors arrive through some wallet app's in-app browser (MetaMask,
   FoxWallet, ...). A provider can show up as window.ethereum, inside its
   .providers array, as window.foxwallet.ethereum / .provider, or via an
   EIP-6963 announcement — and mobile wallets often inject only AFTER
   this script starts. So discovery collects candidates from all of
   those sources and init waits briefly for a late injection instead of
   giving up on the first check. Every wallet call in this file goes
   through provider() — the one the user picked (MetaMask by default). */
var account = null;
var selectedProvider = null;
var announcedProviders = []; // {provider, name} collected via EIP-6963
var providerWaiters = [];

function isProviderLike(p) { return !!p && typeof p.request === "function"; }

function candidateProviders() {
  var out = [];
  function push(p, name) {
    if (!isProviderLike(p)) return;
    for (var i = 0; i < out.length; i++) {
      if (out[i].provider === p) {
        if (name && !out[i].name) out[i].name = name;
        return;
      }
    }
    out.push({ provider: p, name: name || null });
  }
  announcedProviders.forEach(function (a) { push(a.provider, a.name); });
  var eth = typeof window !== "undefined" ? window.ethereum : null;
  if (eth) {
    if (Array.isArray(eth.providers)) {
      eth.providers.forEach(function (p) { push(p); });
    }
    push(eth);
  }
  var fw = typeof window !== "undefined" ? window.foxwallet : null;
  if (fw) {
    push(fw.ethereum, "FoxWallet");
    push(fw.provider, "FoxWallet");
  }
  return out;
}
function providerName(entry) {
  if (entry.name) return entry.name;
  var p = entry.provider;
  if (p.isMetaMask) return "MetaMask";
  if (p.isFoxWallet) return "FoxWallet";
  var fw = typeof window !== "undefined" ? window.foxwallet : null;
  if (fw && (fw.ethereum === p || fw.provider === p)) return "FoxWallet";
  return t("walletGeneric");
}
function provider() { return selectedProvider; }
function hasWallet() { return candidateProviders().length > 0; }
function pickDefaultProvider(cands) {
  var i;
  for (i = 0; i < cands.length; i++) {
    if (cands[i].provider.isMetaMask) return cands[i].provider;
  }
  var eth = typeof window !== "undefined" ? window.ethereum : null;
  if (eth) {
    for (i = 0; i < cands.length; i++) {
      if (cands[i].provider === eth) return eth;
    }
  }
  return cands.length ? cands[0].provider : null;
}

/* EIP-6963: listen for announcements from the moment this script loads
   (wallets answer the request dispatched in waitForAnyProvider). */
function notifyProviderArrival() {
  var w = providerWaiters.slice();
  providerWaiters = [];
  w.forEach(function (fn) { fn(); });
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("eip6963:announceProvider", function (ev) {
    try {
      var d = ev && ev.detail;
      if (d && isProviderLike(d.provider)) {
        announcedProviders.push({
          provider: d.provider,
          name: d.info && d.info.name ? String(d.info.name) : null
        });
        notifyProviderArrival();
      }
    } catch (e) {}
  });
}

/* Wait up to timeoutMs for any candidate provider to appear (late
   mobile-wallet injection). Resolves true if one is available. */
function waitForAnyProvider(timeoutMs) {
  if (hasWallet()) return Promise.resolve(true);
  return new Promise(function (resolve) {
    var done = false;
    var iv = null, to = null;
    function cleanup() {
      if (iv) clearInterval(iv);
      if (to) clearTimeout(to);
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("ethereum#initialized", check);
      }
      var i = providerWaiters.indexOf(check);
      if (i >= 0) providerWaiters.splice(i, 1);
    }
    function finish(ok) {
      if (done) return;
      done = true;
      cleanup();
      resolve(ok);
    }
    function check() { if (hasWallet()) finish(true); }
    iv = setInterval(check, 100);
    to = setTimeout(function () { finish(hasWallet()); }, timeoutMs);
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("ethereum#initialized", check);
    }
    providerWaiters.push(check);
    try {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    } catch (e) {}
    check();
  });
}

function attachProviderListeners(p) {
  if (!p || typeof p.on !== "function" || p.__fishAutoSwapListeners) return;
  p.__fishAutoSwapListeners = true;
  p.on("accountsChanged", function (accs) {
    if (provider() !== p) return;
    account = accs && accs[0] ? accs[0] : null;
    if (account) showAccount();
    else el("myStatusPanel").hidden = true;
    loadBoard();
  });
  p.on("chainChanged", function () {
    if (provider() === p) location.reload();
  });
}

async function walletChainId() {
  var p = provider();
  if (!p) throw new Error("no wallet");
  return p.request({ method: "eth_chainId" });
}
async function ensureChain() {
  var p = provider();
  if (!p) return false;
  var cid = await walletChainId();
  if (cid === CHAIN_ID_HEX) return true;
  try {
    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }]
    });
    return true;
  } catch (e) {
    if (e && e.code === 4902) {
      await p.request({
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

/* One connect button per candidate when several wallets are injected;
   a single candidate keeps the one big button. */
function buildConnectButtons(cands) {
  var list = el("connectBtnList");
  var single = el("connectBtn");
  list.innerHTML = "";
  if (cands.length <= 1) {
    list.hidden = true;
    single.hidden = false;
    return;
  }
  single.hidden = true;
  list.hidden = false;
  cands.forEach(function (entry) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "big-btn";
    b.textContent = t("connectWithBtn", { name: providerName(entry) });
    b.addEventListener("click", function () { connectWith(entry.provider, b); });
    list.appendChild(b);
  });
}

async function connectWith(p, btn) {
  var res = el("connectResult");
  if (!p) return;
  selectedProvider = p;
  attachProviderListeners(p);
  var orig = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("checkingWallet");
  }
  try {
    var accounts = await p.request({ method: "eth_requestAccounts" });
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
  } finally {
    if (btn) {
      btn.disabled = false;
      if (orig) btn.textContent = orig;
    }
  }
}

/* If the wallet already authorised this page, restore the session
   without a tap. Never auto-switch chains (some wallets block that
   without a tap) — a wrong chain shows the switch button instead. */
async function tryAutoReconnect() {
  var p = provider();
  if (!p) return;
  try {
    var accs = await p.request({ method: "eth_accounts" });
    if (!accs || !accs.length || !accs[0]) return;
    account = accs[0];
    var cid = null;
    try { cid = await walletChainId(); } catch (e) { cid = null; }
    var res = el("connectResult");
    if (cid && cid !== CHAIN_ID_HEX) {
      res.className = "result error";
      res.textContent = t("wrongChain");
      el("switchChainBtn").hidden = false;
      return;
    }
    res.className = "result ok";
    res.textContent = t("connected");
    showAccount();
  } catch (e) { /* stay on the manual connect flow */ }
}

async function setupWallet() {
  var found = await waitForAnyProvider(3000);
  var cands = candidateProviders();
  if (!found || !cands.length) {
    el("noWalletPanel").hidden = false;
    el("connectPanel").hidden = true;
    return;
  }
  selectedProvider = pickDefaultProvider(cands);
  attachProviderListeners(selectedProvider);
  buildConnectButtons(cands);
  tryAutoReconnect();
}

async function copyPageUrl() {
  var out = el("copyUrlResult");
  var url = location.href;
  var ok = false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      ok = true;
    }
  } catch (e) { ok = false; }
  if (!ok) {
    try {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = !!document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
  }
  out.className = "result " + (ok ? "ok" : "error");
  out.textContent = ok ? t("urlCopied") : t("urlCopyFail") + url;
}
async function sendTx(to, data, resultEl, valueWei) {
  var p = provider();
  if (!p) throw new Error("no wallet");
  var hash = await p.request({
    method: "eth_sendTransaction",
    params: [{
      from: account,
      to: to,
      data: data,
      value: valueWei ? "0x" + BigInt(valueWei).toString(16) : "0x0"
    }]
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

/* Maintenance gating — see the MAINTENANCE flag at the top. Hides the
   schedule displays that would imply a run is coming, explains the
   situation inside the registration panel, and disables every write
   action except gas-money withdrawal (gasWithdrawBtn and its amount
   input are deliberately NOT touched). */
function applyMaintenance() {
  if (!MAINTENANCE) return;
  var note = el("comingSoon");
  note.textContent = t("maintenanceRegNote");
  note.hidden = false;
  ["approveBtn", "registerBtn", "disableBtn", "revokeBtn",
   "gasDepositBtn", "gasDepositAmount"].forEach(function (id) {
    var n = el(id);
    if (n) n.disabled = true;
  });
  var card = el("nextRunCard");
  if (card) card.hidden = true;
  var clock = el("clockPanel");
  if (clock) clock.hidden = true;
}

function applyI18n() {
  document.title = t("pageTitle") + " — 42 Chain";
  setText("maintenanceTitle", "maintenanceTitle");
  setText("maintenanceText", "maintenanceText");
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
  setText("statusScope", "statusScope");
  setText("myStatusTitle", "myStatusTitle");
  setText("boardTitle", "boardTitle");
  setText("boardNote", "boardNote");
  setText("boardRefreshBtn", "boardRefresh");
  setText("noWalletTitle", "noWalletTitle");
  setText("noWalletText", "noWalletText");
  setText("mmOpenLink", "openMetaMaskBtn");
  setText("copyUrlBtn", "copyUrlBtn");
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
  setText("stepGasTitle", "stepGasTitle");
  setText("gasNote", "gasNote");
  setText("gasCreditLabel", "gasCreditLabel");
  setText("gasRunsLabel", "gasRunsLabel");
  setText("gasDepositLabel", "gasDepositLabel");
  setText("gasDepositBtn", "gasDepositBtn");
  setText("gasWithdrawLabel", "gasWithdrawLabel");
  setText("gasWithdrawBtn", "gasWithdrawBtn");
  setText("stopTitle", "stopTitle");
  setText("disableBtn", "disableBtn");
  setText("revokeBtn", "revokeBtn");
  setText("stopNote", "stopNote");
  setText("histTitle", "histTitle");
  setText("trustTitle", "trustTitle");
  setText("trustCanTitle", "trustCanTitle");
  setText("trustCan1", "trustCan1");
  setText("trustCan2", "trustCan2");
  setText("trustCannotTitle", "trustCannotTitle");
  setText("trustCannot1", "trustCannot1");
  setText("trustCannot2", "trustCannot2");
  setText("trustCannot3", "trustCannot3");
  setText("trustCannot4", "trustCannot4");
  setText("trustCannot5", "trustCannot5");
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
    ["approveBtn", "registerBtn", "disableBtn", "revokeBtn", "gasDepositBtn", "gasWithdrawBtn"].forEach(function (id) {
      el(id).disabled = true;
    });
  }
  applyMaintenance();
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
      var creditOut = await ethCall(CONFIG.CONTRACT_ADDRESS, SEL.gasCredit + encodeAddress(account));
      var stipendOut = await ethCall(CONFIG.CONTRACT_ADDRESS, SEL.gasStipend);
      lastGasCredit = decodeUint(creditOut);
      lastGasStipend = decodeUint(stipendOut);
      renderGas(lastGasCredit, lastGasStipend);
      renderMyStatus();
    } catch (e) {
      el("currentBody").textContent = t("dropFailed");
      setMyStatusFailed();
    }
  } else {
    renderMyStatus();
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

/* Gas credit display. Both values are read live from the contract on
   every load — the per-run stipend is never a hardcoded constant.
   runs ~= days, since there is at most one run per day. */
function renderGas(credit, stipend) {
  if (credit === null || credit === undefined) return;
  el("gasCredit").textContent = formatToken(credit) + " [42]";
  var warn = el("gasWarn");
  if (stipend && stipend > 0n) {
    el("gasRuns").textContent = t("gasRunsValue", { runs: (credit / stipend).toString() });
    el("gasPerRunNote").textContent = t("gasPerRun", { amount: formatToken(stipend) });
    var low = credit < stipend;
    warn.hidden = !low;
    if (low) {
      warn.className = "result error";
      warn.textContent = t("gasWarn");
    }
  } else {
    el("gasRuns").textContent = "—";
    el("gasPerRunNote").textContent = "";
    warn.hidden = true;
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
      div.appendChild(main);
      if (rec.txHash) {
        var a = document.createElement("a");
        a.href = rec.txUrl || (EXPLORER + "/tx/" + rec.txHash);
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = t("histTx");
        div.appendChild(a);
      }
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

/* ---------- service status banner (Worker /status) ---------- */
async function loadServiceStatus() {
  var dot = el("statusDot");
  var txt = el("statusText");
  var reason = el("statusReason");
  var users = el("statusUsers");
  if (MAINTENANCE) {
    /* Maintenance supersedes the keeper's own status: never show the
       green "running" state while the service is paused on purpose. */
    dot.className = "status-dot";
    txt.textContent = t("statusMaintenance");
    reason.hidden = true;
    reason.textContent = "";
    return;
  }
  try {
    var res = await fetch(CONFIG.WORKER_URL + "/status");
    var data = await res.json();
    if (!data || typeof data.ready !== "boolean") throw new Error("bad status");
    if (data.ready) {
      dot.className = "status-dot on";
      txt.textContent = t("statusRunning");
      reason.hidden = true;
      reason.textContent = "";
    } else {
      dot.className = "status-dot off";
      txt.textContent = t("statusStopped");
      var r = data.detail || data.reason || "";
      reason.hidden = !r;
      reason.textContent = r ? t("statusReasonPrefix") + r : "";
    }
    users.textContent = typeof data.users === "number" ? t("statusUsers", { n: data.users }) : "";
  } catch (e) {
    /* Honest fallback: never claim "running" when the check failed. */
    dot.className = "status-dot";
    txt.textContent = t("statusUnknown");
    reason.hidden = true;
    reason.textContent = "";
    users.textContent = "";
  }
}

/* ---------- your running status panel ---------- */
var lastGasCredit = null;
var lastGasStipend = null;
var targetSymbolCache = {};

/* The target token's symbol, read from the token contract itself
   (symbol()). Falls back to a shortened address — never a guess. */
async function resolveTargetSymbol(address) {
  if (!address || address === ZERO_ADDRESS) return t("nativeSymbol");
  var a = address.toLowerCase();
  if (targetSymbolCache[a]) return targetSymbolCache[a];
  var sym = null;
  try {
    sym = decodeSymbol(await ethCall(a, SEL.symbol));
  } catch (e) { sym = null; }
  if (!sym) sym = a.slice(0, 6) + "…" + a.slice(-4);
  targetSymbolCache[a] = sym;
  return sym;
}

function setMyStatusFailed() {
  if (!account) return;
  el("myStatusPanel").hidden = false;
  el("myStatusMain").textContent = t("myLoadFailed");
  el("myStatusDetail").textContent = "";
  el("myStatusNote").hidden = true;
}

async function renderMyStatus() {
  if (!account) { el("myStatusPanel").hidden = true; return; }
  el("myStatusPanel").hidden = false;
  var main = el("myStatusMain");
  var detail = el("myStatusDetail");
  var note = el("myStatusNote");
  note.hidden = true;
  if (!ready) {
    main.textContent = t("statusStopped");
    detail.textContent = "";
    return;
  }
  var cfg = currentConfig;
  if (!cfg) {
    main.textContent = t("myLoading");
    detail.textContent = "";
    return;
  }
  if (!cfg.registered) {
    main.textContent = t("myNotRegistered");
    detail.textContent = t("myNotRegDetail");
    return;
  }
  var sym = await resolveTargetSymbol(cfg.targetToken);
  if (currentConfig !== cfg || !account) return; /* changed while resolving */
  var det = t("myDetail", {
    percent: (Number(cfg.percentBps) / 100).toString(),
    cap: formatToken(cfg.dailyCap)
  });
  if (cfg.enabled) {
    main.textContent = t("myRunning", { symbol: sym });
    detail.textContent = det;
    if (lastGasStipend && lastGasStipend > 0n && lastGasCredit !== null && lastGasCredit < lastGasStipend) {
      note.hidden = false;
      note.textContent = t("gasWarn");
    }
  } else {
    main.textContent = t("myPaused");
    detail.textContent = det;
  }
}

/* ---------- registered addresses board (public — no wallet needed) ----------
   Enumerates the contract's own users list (usersCount / userAt /
   configOf) in batched RPC calls and renders one row per registered
   address. At most the newest BOARD_MAX rows are rendered, so the RPC
   fan-out stays bounded no matter how many users register. */
var BOARD_MAX = 100;
var BOARD_CHUNK = 40;

async function boardSymbol(address) {
  if (!address || address === ZERO_ADDRESS) return t("nativeSymbol");
  var a = address.toLowerCase();
  for (var i = 0; i < TOKENS.length; i++) {
    if (TOKENS[i].address === a) return TOKENS[i].symbol;
  }
  return resolveTargetSymbol(a);
}

function boardRow(row) {
  var div = document.createElement("div");
  div.className = "board-row";
  var me = account && row.user === String(account).toLowerCase();
  if (me) div.className += " me";
  var a = document.createElement("a");
  a.className = "mono";
  a.href = EXPLORER + "/address/" + row.user;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = row.user.slice(0, 6) + "…" + row.user.slice(-4);
  div.appendChild(a);
  var chip = document.createElement("span");
  chip.className = "board-chip";
  chip.textContent = t("boardRoute", { symbol: row.symbol });
  div.appendChild(chip);
  var meta = document.createElement("span");
  meta.className = "board-meta";
  var st = document.createElement("span");
  st.className = row.cfg.enabled ? "board-on" : "board-off";
  st.textContent = row.cfg.enabled ? t("boardActive") : t("boardPaused");
  meta.appendChild(st);
  meta.appendChild(document.createTextNode(
    " · " + t("boardShare", { percent: (Number(row.cfg.percentBps) / 100).toString() })
  ));
  div.appendChild(meta);
  if (me) {
    var badge = document.createElement("span");
    badge.className = "you-badge";
    badge.textContent = t("boardYou");
    div.appendChild(badge);
  }
  return div;
}

function boardMessage(key) {
  var p = document.createElement("p");
  p.className = "note";
  p.textContent = t(key);
  return p;
}

async function loadBoard() {
  var list = el("boardList");
  if (!list) return;
  var more = el("boardMore");
  more.textContent = "";
  list.innerHTML = "";
  list.appendChild(boardMessage("boardLoading"));
  try {
    if (!ready) throw new Error("contract not set");
    var countOut = await ethCall(CONFIG.CONTRACT_ADDRESS, SEL.usersCount);
    var total = Number(decodeUint(countOut) || 0n);
    el("boardTitle").textContent = t("boardTitleCount", { n: total });
    if (total === 0) {
      list.innerHTML = "";
      list.appendChild(boardMessage("boardEmpty"));
      return;
    }
    var shown = Math.min(total, BOARD_MAX);
    var idx = [];
    for (var k = total - 1; k >= total - shown; k--) idx.push(k);
    var addrWords = [];
    for (var b = 0; b < idx.length; b += BOARD_CHUNK) {
      var chunk = idx.slice(b, b + BOARD_CHUNK).map(function (i) {
        return ethCallReq(CONFIG.CONTRACT_ADDRESS, SEL.userAt + encodeUint(i));
      });
      addrWords = addrWords.concat(await rpcBatch(chunk));
    }
    var users = addrWords.map(function (h) { return h ? decodeAddressWord(h.slice(2)) : null; });
    var cfgHexes = [];
    for (var c = 0; c < users.length; c += BOARD_CHUNK) {
      var chunk2 = users.slice(c, c + BOARD_CHUNK).map(function (u) {
        return ethCallReq(CONFIG.CONTRACT_ADDRESS, SEL.configOf + encodeAddress(u));
      });
      cfgHexes = cfgHexes.concat(await rpcBatch(chunk2));
    }
    var rows = await Promise.all(users.map(async function (u, i) {
      var cfg = u ? decodeConfig(cfgHexes[i]) : null;
      if (!u || !cfg || !cfg.registered) return null;
      return { user: u, cfg: cfg, symbol: await boardSymbol(cfg.targetToken) };
    }));
    rows = rows.filter(function (r) { return r !== null; });
    list.innerHTML = "";
    if (rows.length === 0) {
      list.appendChild(boardMessage("boardEmpty"));
      return;
    }
    rows.forEach(function (row) { list.appendChild(boardRow(row)); });
    if (total > shown) more.textContent = t("boardMore", { shown: shown, n: total });
  } catch (e) {
    /* Honest failure state — never fabricate rows. */
    el("boardTitle").textContent = t("boardTitle");
    list.innerHTML = "";
    list.appendChild(boardMessage("boardFailed"));
  }
}

/* ---------- events ---------- */
function init() {
  applyI18n();
  tickClocks();
  setInterval(tickClocks, 1000);
  el("statusText").textContent = t("statusChecking");
  loadServiceStatus();
  setInterval(loadServiceStatus, 60000);
  loadBoard();
  el("boardRefreshBtn").addEventListener("click", loadBoard);

  el("langSel").addEventListener("change", function () {
    try { localStorage.setItem("fishautoswap_lang", this.value); } catch (e) {}
    location.href = this.value + ".html";
  });

  /* No-wallet escape hatches (deep link into MetaMask / copy the URL
     for FoxWallet and other wallet browsers). The deep link is built
     from the current host + path, so both language pages work. */
  var mmLink = el("mmOpenLink");
  if (mmLink) {
    mmLink.href = "https://metamask.app.link/dapp/" + location.host + location.pathname;
  }
  el("copyUrlBtn").addEventListener("click", copyPageUrl);

  el("connectBtn").addEventListener("click", function () {
    connectWith(provider(), el("connectBtn"));
  });

  /* Providers (FoxWallet included) may inject late — wait briefly
     before deciding there is no wallet at all. */
  setupWallet();

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
    if (MAINTENANCE) return;
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
    if (MAINTENANCE) return;
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
    if (MAINTENANCE) return;
    res.textContent = t("sending");
    try {
      await sendTx(CONFIG.CONTRACT_ADDRESS, SEL.disable, res);
      loadOnChain();
    } catch (e) { txError(res, e); }
  });

  document.querySelectorAll(".chip[data-gas]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      el("gasDepositAmount").value = chip.getAttribute("data-gas");
      document.querySelectorAll(".chip[data-gas]").forEach(function (c) {
        c.classList.toggle("active", c === chip);
      });
    });
  });

  el("gasDepositBtn").addEventListener("click", async function () {
    var res = el("gasResult");
    if (!account) { res.textContent = t("needConnect"); return; }
    if (!ready) return;
    if (MAINTENANCE) return;
    var amount = parseToken(el("gasDepositAmount").value);
    if (amount === null || amount <= 0n) {
      res.className = "result error";
      res.textContent = t("badGasAmount");
      return;
    }
    res.textContent = t("sending");
    try {
      await sendTx(CONFIG.CONTRACT_ADDRESS, SEL.depositGas, res, amount);
      loadOnChain();
    } catch (e) { txError(res, e); }
  });

  el("gasWithdrawBtn").addEventListener("click", async function () {
    var res = el("gasResult");
    if (!account) { res.textContent = t("needConnect"); return; }
    if (!ready) return;
    var amount = parseToken(el("gasWithdrawAmount").value);
    if (amount === null || amount <= 0n) {
      res.className = "result error";
      res.textContent = t("badGasAmount");
      return;
    }
    res.textContent = t("sending");
    try {
      await sendTx(CONFIG.CONTRACT_ADDRESS, SEL.withdrawGas + encodeUint(amount), res);
      loadOnChain();
    } catch (e) { txError(res, e); }
  });

  el("revokeBtn").addEventListener("click", async function () {
    var res = el("regResult");
    if (!account) { res.textContent = t("needConnect"); return; }
    if (!ready) return;
    if (MAINTENANCE) return;
    res.textContent = t("sending");
    try {
      await sendTx(FISH, SEL.approve + encodeAddress(CONFIG.CONTRACT_ADDRESS) + encodeUint(0n), res);
      loadOnChain();
    } catch (e) { txError(res, e); }
  });

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
  el("myStatusPanel").hidden = false;
  el("myStatusMain").textContent = t("myLoading");
  el("myStatusDetail").textContent = "";
  el("myStatusNote").hidden = true;
  loadOnChain();
  loadBoard();
}

document.addEventListener("DOMContentLoaded", init);
