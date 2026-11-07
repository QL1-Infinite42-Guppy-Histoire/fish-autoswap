# FISH オートスワップ / FISH AutoSwap

毎朝 09:06（日本時間）ごろに届く FISH（流動性提供・TOWEL ロックの報酬）を、09:10 に自動で好きなトークンに交換するサービスです。登録は1回だけ。交換結果はそのままあなたのウォレットに入ります。

A service that swaps the FISH you receive every morning (~09:06 Japan time, the reward for providing liquidity or locking TOWEL) into a token of your choice, automatically at 09:10. Register once; the proceeds go straight to your wallet.

- サイト / Site: https://ql1-infinite42-guppy-histoire.github.io/fish-autoswap/
- キーパー Worker / Keeper worker: https://fish-autoswap.nepicobsv.workers.dev

## 仕組み / How it works

1. **配布（09:06 JST）** — FISH は毎朝 00:05 UTC（= 09:05〜09:06 JST）に1回のバッチ mint で配布されます（2026-11-06 / 11-07 の実績をチェーンで確認済み）。
   **The drop (~09:06 JST)** — FISH is distributed once a day in a single batch-mint transaction at ~00:05 UTC (verified on-chain for 2026-11-06 and 2026-11-07).
2. **登録（1回だけ）** — サイトでウォレットをつなぎ、① FISH の使用許可（approve、上限つき）② 設定の登録（交換先・割合・1日の上限・スリッページ）③ ガス代の事前預け（下記）をチェーン上に置きます。
   **Register (once)** — On the site you connect your wallet and put three things on-chain: ① a capped FISH allowance (approve) for the contract, ② your settings (target token, percent, daily cap, slippage), ③ a small [42] gas pre-deposit (below).
   **ガス代は本人が事前に預ける方式** — 毎朝の実行のガス代は、利用者本人が [42] をコントラクトに預けて払います。交換が成功した実行のたびに、預かりから「1回分」（`gasStipend`、初期値 0.005 [42]、サイトに実値を表示）ちょうどがキーパーへ渡ります。失敗した実行では何も引かれません。余った預かり金は本人がいつでも全額取り戻せます（`withdrawGas`）。運営者は利用者のガス代を肩代わりしません。
   **Gas is prepaid by each user** — Every user funds their own morning runs by depositing [42] into the contract. Each *successful* run moves exactly one `gasStipend` (default 0.005 [42]; the live value is read from the contract and shown on the site) from that user's credit to the keeper. A failed run charges nothing. Unused credit is withdrawable by its owner at any time (`withdrawGas`). The operator never pays users' gas.
3. **自動交換（09:10 JST）** — Cloudflare Worker のキーパーが毎日 00:10 UTC にコントラクトの `execute()` を呼びます。当日 mint された FISH 量はチェーンの Transfer ログ（from = 0x0）から数え、経路は factory で実在確認してから実行します。
   **Auto-swap (09:10 JST)** — A keeper (Cloudflare Worker cron `10 0 * * *`) calls the contract's `execute()` every day at 00:10 UTC. The day's minted amount is measured from Transfer logs (from = the zero address); the path is verified against the factory before sending.

## 信頼モデル / Trust model

コントラクト `contracts/FishAutoSwap.sol` は意図的に小さく作ってあります:

- コントラクトは交換結果を**一切保持しません**。スワップの受け取り先は常にあなた自身のアドレスです（`to = user`）。
- 触れるのは、あなたが approve した **FISH だけ**、しかも1日あたり「その日の mint 量 × あなたの割合」「あなたの1日上限」「残高」「残りの許可量」のうち最小のものまで。
- 交換先はあなたが登録したトークンのみ。経路は 2〜3 ホップで、全ホップのペア実在をコントラクト側でも検証します。スリッページ下限は実行時点のオンチェーン見積もりから計算します。
- キーパーは `execute()` を呼べるだけです（1ユーザーあたり1日1回まで、コントラクトが強制）。設定の変更も出金もできません。
- ガス代の預かり金（`gasCredit`）に触れる関数は、本人の入金（`depositGas`）と本人だけの出金（`withdrawGas`、自分の預かり分まで）だけです。他人の預かり金を動かす関数は存在せず、オーナーにもキーパーにもできません。コントラクトから [42] が出るのは「本人の出金」と「成功した実行の stipend（上限 0.02 [42] にハードキャップ、`setGasStipend` はオーナーのみ）」の2通りだけです。
- オーナー（デプロイ者）ができるのは `setKeeper`、一時停止、`setGasStipend`（上限つき）だけ。**一般的な出金関数は存在しません**。
- 止め方は即時です: サイトの「OFF」ボタン（`disable()`）と「許可を取り消す」（approve 0）の2段構え。

The contract is deliberately small:

- It **never holds swap output** — proceeds are sent by the router directly to your address (`to = user`).
- It can only ever touch **FISH you approved**, per day at most the minimum of (today's mint × your percent, your daily cap, your balance, your remaining allowance).
- It only swaps into **the target you registered**, over a validated 2–3 hop path; the minimum output is computed on-chain from the live quote and your slippage setting.
- The keeper can only trigger `execute()` (the once-per-day rule is enforced by the contract). It cannot change settings or withdraw anything.
- Gas credits can only be added by their owner (`depositGas`) and withdrawn by their owner (`withdrawGas`, up to their own balance). No function lets anyone — owner and keeper included — touch another user's credit. Native [42] leaves the contract in exactly two ways: a user's own withdrawal, and one `gasStipend` per successful run (owner-settable only up to a hard cap of 0.02 [42]).
- The owner can only set the keeper, pause, and set the gas stipend within its hard cap. **There is no general withdraw function.**
- Stopping is immediate: `disable()` on the site, plus revoking the allowance (approve 0).

## 構成 / Layout

| パス | 内容 |
|---|---|
| `contracts/FishAutoSwap.sol` | 本体コントラクト（Solidity 0.8、外部依存なし） |
| `contracts/build/FishAutoSwap.json` | コンパイル済み ABI + バイトコード（solc 0.8.38、8,842 bytes） |
| `worker/worker.js` | キーパー Worker（Cron 00:10 UTC、履歴は KV） |
| `docs/` | 登録サイト（GitHub Pages、英語デフォルト＋日本語、`admin.html` は管理者のデプロイ用） |
| `tools/` | コンパイル（`compile.mjs`）、ローカル EVM スモークテスト（`smoke-test.mjs`）、サイト読み取り検証（`verify-site-reads.mjs`） |

## セットアップ手順（管理者向け）/ Setup (for the owner)

1. **コントラクトをデプロイ** — サイトのフッター「Owner」→ `admin.html` を開き、自分のウォレットで Deploy。コントラクトアドレスが表示されます。コントラクト自体はこの repo からはデプロイしません（あなたのウォレットからだけ）。
   **Deploy the contract** — Open `admin.html` (footer "Owner" link on the site) and deploy from your own wallet. The contract address is shown on the page.
2. **キーパー用ウォレットを作る** — 新規ウォレットを作り、少量の [42]（ガス代）を入金。そのアドレスを `admin.html` の Step 2 で `setKeeper` します。
   **Create a keeper wallet** — Fresh wallet, funded with a little [42] for gas. Set its address on `admin.html` Step 2.
3. **Worker に値を入れる** — Cloudflare ダッシュボード → Workers & Pages → `fish-autoswap` → Settings → Variables and Secrets:
   - 変数 / Variable: `CONTRACT_ADDRESS` = 手順1のアドレス
   - Secret: `KEEPER_PRIVATE_KEY` = キーパーウォレットの秘密鍵（**ダッシュボードの Secret 欄だけに貼ること。チャットや GitHub には絶対に貼らない**）
   **Configure the worker** — variable `CONTRACT_ADDRESS`, secret `KEEPER_PRIVATE_KEY` (dashboard only — never in chat or GitHub).
4. **サイトを有効化** — `docs/app.js` の `CONFIG.CONTRACT_ADDRESS` にアドレスを入れて push すると、サイトの「準備中」が外れます。
   **Enable the site** — Put the address into `CONFIG.CONTRACT_ADDRESS` in `docs/app.js` and push.
5. **確認** — `https://fish-autoswap.nepicobsv.workers.dev/status` が `ready: true` を返せば稼働開始。最初の登録は自分のウォレットで少額設定（上限小さめ）で試すのがおすすめです。初回登録には手順③のガス代の預け（例: 0.15 [42] で約30回分）も含まれます — 預かりが 1回分（0.005 [42]）未満だと、その利用者の自動交換は止まります（Worker は `skipped_gas_credit` として履歴に残します）。
   **Verify** — `/status` should answer `ready: true`. Do the first registration from your own wallet with a small cap. The first registration also includes step ③, the gas deposit (0.15 [42] covers ~30 runs). If a user's credit falls below one stipend (0.005 [42]), their runs pause — the keeper logs them as `skipped_gas_credit` instead of sending a reverting transaction.

任意 / Optional: Worker の Secret `RUN_SECRET` を設定すると、`POST /run`（ヘッダー `x-run-secret`）で手動実行テストができます。未設定の間は `/run` は無効です。 Worker の変数 `RPCS`（カンマ区切り）と `FISH_ADDRESS` で RPC と FISH アドレスを上書きできます。

## 再デプロイ / Redeploying the worker

```sh
cd worker
npm install
npm run build        # -> dist/worker.bundle.js (ethers をバンドル)
# この VM の Cloudflare ヘルパーで、KV バインド付きでデプロイ
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf.py deploy-bind \
  <ACCOUNT_ID> fish-autoswap dist/worker.bundle.js bindings.json
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf.py put-schedules \
  <ACCOUNT_ID> fish-autoswap "10 0 * * *"
```

注意：再デプロイ後は Cloudflare ダッシュボードで Secret（`KEEPER_PRIVATE_KEY` 等）が残っているか必ず確認してください。
Note: after redeploying, verify in the dashboard that the secrets are still present; re-add them if not.

## テスト / Testing

- コントラクト: `cd tools && npm install && node compile.mjs` でコンパイル。`node smoke-test.mjs` でローカル EVM（ganache）上にモックの FISH / ルーター / ファクトリーを実アドレスへ配置し、登録→実行・1日1回制限・上限・無効化・一時停止・経路検証に加えて、ガス預かり方式の検証（入金で残高が増える／実行で stipend ちょうどがキーパーに渡り残高が減る／残高不足では revert して何も引かれない／失敗したスワップでは引かれない／出金は本人の分だけ・上限超えは revert／他人の預かり金には届かない／stipend の上限キャップ）を含む **49項目すべて合格**。
- サイト読み取り: `node verify-site-reads.mjs` で「今日の配布」集計がエクスプローラーの実績値と wei 単位で一致することを確認済み。
- 登録済みアドレスボード: サイトに全登録者の一覧（アドレス・交換先トークン・有効/停止中・割合）を公開表示（ウォレット未接続でも閲覧可）。`node tools/verify-board.mjs` で描画結果が実チェーンと一致することを確認済み。
- Worker: デプロイ済み。`CONTRACT_ADDRESS` 未設定の間は `/status` が `not_ready` を返し、Cron が来ても何もしません。

- Contract: compile with `node compile.mjs`; `node smoke-test.mjs` runs **49 checks, all passing**, on a local ganache chain with mocks placed at the real mainnet addresses — register → execute, once-per-day gate, cap, disable, pause, path validation, plus the gas pre-deposit model (deposit credits the exact amount; a successful execute pays exactly one stipend to the keeper and deducts it; insufficient credit reverts and charges nothing; a failed swap charges nothing; withdrawals return only the caller's own credit and cannot exceed it; another user cannot reach your credit; the stipend setter is owner-only and hard-capped).
- Site reads: `verify-site-reads.mjs` confirmed the "today's drop" total matches the explorer's record to the wei.
- Registered-addresses board: the site publicly lists every registered address with its chosen token, active/paused state and share (no wallet connection needed); `verify-board.mjs` checks the rendered board against the live chain.
- Worker: deployed; while `CONTRACT_ADDRESS` is unset, `/status` answers `not_ready` and the daily cron does nothing.

## 開発メモ / Development notes

- チェーン: 42 Chain（EVM 421018）、DEX は Don't Panic / Nutri-Matic V2（router `0xBF07dFE35746894bAe373f63f4Bf2379F9BaFEc0`、factory `0x3157C6AcA800D507af95Ab1466adBA3A6F11eE1a`）。経路内のネイティブ [42] は `0xEeee…EEeE` センチネル。設定上の「ネイティブ指定」は `address(0)` に正規化されます。
- 「その日の FISH」は UTC 日付で数えます。配布（00:05 UTC）と実行（00:10 UTC）は同じ UTC 日なので、1日1回制限とずれません。
- Worker の API: `GET /status`、`GET /history?user=0x…`、`POST /run`（任意 Secret 設定時のみ）。
- エクスプローラー: https://scan.infinitedrive.xyz

## License

MIT
