# FISH 自動スワップ（毎朝 09:06 受取 → 09:10 スワップ）

## 確定事項
- 実行方式は **B（サイト＋許可型）** に決定（ユーザー判断、2026-11-07）
- 対象は「その日届いた FISH だけ」（UTC日付の mint 合計）。残高全部ではない
- スワップ先は任意トークン（Don't Panic 17トークン + ネイティブ[42] + CA指定）
- ガス代は **利用者の事前預かり方式**（ユーザー判断、2026-11-07）: 利用者が [42] をコントラクトに預け（`gasCredit`）、成功した実行ごとに `gasStipend`（初期値 0.005 [42]、上限 0.02 のハードキャップ）ちょうどが本人の預かりからキーパーへ。失敗時は課金なし、余りは本人だけがいつでも出金可。運営者は肩代わりしない

## 検証済みの事実
- 配布は 00:05:34 UTC = 09:05:34 JST の1回のバッチミントtx（2026-11-06分、tx 0x288a5a7ee5…、約90アドレス）。2026-11-07分も 00:05:33 UTC のバッチ mint（tx 0x64b3cd33…）で同パターンを再確認
- FISH: `0x2c32120a12B754272d9E85C57F64b50cA2C43513` / DEX router `0xBF07dFE35746894bAe373f63f4Bf2379F9BaFEc0` / factory `0x3157C6AcA800D507af95Ab1466adBA3A6F11eE1a` / ネイティブは経路内で `0xEeee…EEeE`

## 最終アーキテクチャ（構築済み）
1. **コントラクト** `contracts/FishAutoSwap.sol`（solc 0.8.38、8,842 bytes）
   - ユーザー設定をオンチェーン保持（target / percentBps / dailyCap / slippageBps / enabled）、users 列挙
   - `execute(user, grossMintToday, path)` は keeper のみ・1日1回（UTC日）・paused で停止
   - amountIn = min(mint×割合, 上限, 残高, allowance)。経路検証（2〜3ホップ、factory でペア実在）、amountOutMin はオンチェーン見積もり×(1−slippage)
   - 成果物は `to = user` で直接ユーザーへ。一般的な出金関数は無し。オーナーは setKeeper / setPaused / setGasStipend（上限 0.02 [42]）のみ
   - **ガス預かり**: `gasCredit[user]`（本人のみ入金 `depositGas` / 出金 `withdrawGas`）、`gasStipend` 初期値 0.005 [42]。execute は実行前に credit >= stipend を確認し、スワップ成功後にだけ stipend ちょうどをキーパーへ送る（`GasPaid` イベント）
2. **キーパー Worker** `worker/`（Cloudflare、Cron `10 0 * * *` = 09:10 JST）
   - 登録ユーザーを列挙 → `gasStipend()` と `gasCredit(user)` を読み、credit < stipend なら送らずに履歴へ `skipped_gas_credit` を記録 → 当日 mint 合計（eth_getLogs、from=0x0、日次開始ブロックは二分探索＋KVキャッシュ）→ 経路構築（直接 or FISH→42→target）→ eth_call 予行 → execute 送信 → 履歴を KV へ
   - `GET /status`（ready / not_ready）、`GET /history?user=`、`POST /run`（RUN_SECRET 設定時のみ）
   - デプロイ済み: https://fish-autoswap.nepicobsv.workers.dev（CONTRACT_ADDRESS 未設定のため not_ready で安全停止中。2026-11-07 にガスチェック版へ再デプロイ済み、Cron 維持を確認）
3. **登録サイト** `docs/`（GitHub Pages、EN デフォルト＋JP）
   - ウォレット接続、「今日届いた FISH」表示（サイト側でも同じ集計ロジック、実績と wei 単位で一致を検証済み）、カウントダウン（09:06 / 09:10）
   - 登録フォーム: 交換先（17トークン＋[42]＋CA検索）、割合チップ 25/50/75/100%、上限（デフォルト50 FISH）、スリッページ 0.5/1/3/5%、①Approve（標準は上限×30日）→ ②Register → **③ガス代の預け**（残高・1回分はコントラクトから実読み、「あと約N回分（約N日分）」表示、クイック額 0.05/0.15/0.5 [42]、出金フォーム、残高不足時は警告表示）、Disable / Revoke
   - CONTRACT_ADDRESS 未設定の間は登録操作（ガス入金/出金ボタン含む）が「準備中」表示（表示系とガス方式の説明文は稼働）
   - `docs/admin.html`: オーナー専用デプロイページ（ブラウザウォレットからデプロイ＋setKeeper）

## テスト結果
- コンパイル成功（contracts/build/FishAutoSwap.json、バイトコード 8,842 bytes）
- ローカル EVM（ganache、モックを実アドレスに配置）スモークテスト **49項目すべて合格**: 登録→実行（トークン/ネイティブ）、割合・上限の効き方、同日2回目の revert、keeper 以外の revert、disable / pause、経路検証、allowance 0 の revert、翌日の再実行可、＋ガス預かり方式（入金で残高増、実行で stipend ちょうどがキーパーへ＆残高減、残高ゼロ/不足で revert・課金なし、失敗スワップで課金なし、出金は本人の分のみ・超過 revert、他人の預かり金に届かない、setGasStipend の owner 限定と上限キャップ、最終残高＝残り預かり合計と一致）
- サイト読み取り検証: todaysDrop がエクスプローラーの実績値と完全一致（2026-11-07、0.791531300645460722 FISH）
- ウォレット接続UX改善（2026-11-08）: 通常ブラウザでの行き止まり解消（ウォレット無しパネルに MetaMask ディープリンク＋URLコピーボタン）、eth_accounts による自動再接続（チェーン違い時は自動切替せず切替ボタンを表示）、複数プロバイダ時の候補別ボタン（MetaMask/FoxWallet/EIP-6963 の info.name）＋選択したプロバイダ経由で全リクエスト送信、接続待ち中のボタン文言変更＋二重タップ防止、FoxWallet 等の遅延注入対策（最大3秒ポーリング＋ethereum#initialized＋EIP-6963 発見）と window.foxwallet.ethereum のみの環境への対応。`node tools/verify-wallet-ux.mjs`（モックプロバイダによる8シナリオ）で検証済み
- 登録済みアドレスボード（2026-11-08 追加）: ステータス表示の下に公開ボードを追加。コントラクトの users リスト（usersCount/userAt/configOf）をバッチ RPC で列挙し、全登録者のアドレス（エクスプローラーへのリンク）・交換先チップ「FISH → {symbol}」・有効/停止中・割合を表示。ウォレット未接続でも表示され、接続中アドレスは「あなた」バッジ付きでハイライト。100件超は最新100件＋総件数注記。`node tools/verify-board.mjs` で実チェーン（登録1件: 0xa33e…3a23 → QOM、有効、100%）と描画結果（日英）の一致を検証済み
- Worker ローカル検証: 空 env で /status=not_ready、/run=403、scheduled が例外なく安全終了。再デプロイ後も /status=not_ready を実確認
- メインネットへのデプロイはしていない（オーナーが admin.html から実施）

## 残りのオーナー手順
1. admin.html でコントラクトをデプロイ（自分のウォレット、ガスは少量の [42]）
2. キーパー用ウォレットを新規作成し、少量の [42] を入金 → admin.html で setKeeper
3. Cloudflare ダッシュボードで Worker に `CONTRACT_ADDRESS`（変数）と `KEEPER_PRIVATE_KEY`（Secret）を設定
4. `docs/app.js` の `CONFIG.CONTRACT_ADDRESS` にアドレスを入れて push
5. /status が ready:true を確認 → 自分のウォレットで少額上限の初回登録テスト（①Approve → ②Register → ③ガス代の預け、までが初回登録）

## 配布遅延時のリトライ作戦（ユーザー決定 2026-11-08）
- 2026-11-08 は朝の FISH 配布が 09:30 時点で未着で、09:10 の初回実行は「配布なし」で見送りになった（失敗ではない）。
- ユーザー決定: 「届かなかったら10分おきに試みる作戦に切り替える」→ Worker スケジュールに `*/10 * * * *` を追加し、`10 0 * * *`（毎日 09:10 JST）と併存させる（2026-11-08 09:36 JST に Cloudflare API で設定・確認済み）。
- 安全性: 配布ゼロの間は Worker がトランザクションを送らず見送るだけ。実行はコントラクトの executedToday で1日1回に制限され、ガス代の預かり金は成功時にだけ 0.005 [42] 引かれる。届いた後は最大10分以内に自動実行される。
- 確認予定: 2026-11-08 13:30 途中確認、2026-11-09 09:25 最終確認（いずれも goal 配下の runonce）。

## メンテナンスモード（オーナー指示 2026-11-09）
- 初回実行が成立しなかった原因が未解明のため、サイトは公開したまま「🛠️ メンテナンス中」表示に切り替え。新規登録・設定変更・許可・ガス代の預け入れは停止し、預けた [42] の引き出し（withdrawGas）と読み取り専用表示だけを継続利用可能にした。制御は docs/app.js の MAINTENANCE フラグ（解除は false に戻すだけ）。検証: tools/verify-maintenance.mjs（バナー・書き込み停止・引き出しの end-to-end を EN/JA で確認）。
