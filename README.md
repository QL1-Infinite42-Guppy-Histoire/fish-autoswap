# FISH オートスワップ / FISH AutoSwap

毎朝 09:06（日本時間）ごろに届く FISH（流動性提供・TOWEL ロックの報酬）を、09:10 に自動で好きなトークンに交換するサービスです。登録は1回だけ。交換結果はそのままあなたのウォレットに入ります。

A service that swaps the FISH you receive every morning (~09:06 Japan time, the reward for providing liquidity or locking TOWEL) into a token of your choice, automatically at 09:10. Register once; the proceeds go straight to your wallet.

- サイト / Site: https://ql1-infinite42-guppy-histoire.github.io/fish-autoswap/
- キーパー Worker / Keeper worker: https://fish-autoswap.nepicobsv.workers.dev

## 仕組み / How it works

1. **配布（09:06 JST）** — FISH は毎朝 00:05 UTC（= 09:05〜09:06 JST）に1回のバッチ mint で配布されます（2026-11-06 / 11-07 の実績をチェーンで確認済み）。
   **The drop (~09:06 JST)** — FISH is distributed once a day in a single batch-mint transaction at ~00:05 UTC (verified on-chain for 2026-11-06 and 2026-11-07).
2. **登録（1回だけ）** — サイトでウォレットをつなぎ、① FISH の使用許可（approve、上限つき）② 設定の登録（交換先・割合・1日の上限・スリッページ）をチェーン上に置きます。
   **Register (once)** — On the site you connect your wallet and put two things on-chain: ① a capped FISH allowance (approve) for the contract, ② your settings (target token, percent, daily cap, slippage).
3. **自動交換（09:10 JST）** — Cloudflare Worker のキーパーが毎日 00:10 UTC にコントラクトの `execute()` を呼びます。当日 mint された FISH 量はチェーンの Transfer ログ（from = 0x0）から数え、経路は factory で実在確認してから実行します。
   **Auto-swap (09:10 JST)** — A keeper (Cloudflare Worker cron `10 0 * * *`) calls the contract's `execute()` every day at 00:10 UTC. The day's minted amount is measured from Transfer logs (from = the zero address); the path is verified against the factory before sending.

## 信頼モデル / Trust model

コントラクト `contracts/FishAutoSwap.sol` は意図的に小さく作ってあります:

- コントラクトは交換結果を**一切保持しません**。スワップの受け取り先は常にあなた自身のアドレスです（`to = user`）。
- 触れるのは、あなたが approve した **FISH だけ**、しかも1日あたり「その日の mint 量 × あなたの割合」「あなたの1日上限」「残高」「残りの許可量」のうち最小のものまで。
- 交換先はあなたが登録したトークンのみ。経路は 2〜3 ホップで、全ホップのペア実在をコントラクト側でも検証します。スリッページ下限は実行時点のオンチェーン見積もりから計算します。
- キーパーは `execute()` を呼べるだけです（1ユーザーあたり1日1回まで、コントラクトが強制）。設定の変更も出金もできません。
- オーナー（デプロイ者）ができるのは `setKeeper` と一時停止だけ。**出金関数は存在しません**。
- 止め方は即時です: サイトの「OFF」ボタン（`disable()`）と「許可を取り消す」（approve 0）の2段構え。

The contract is deliberately small:

- It **never holds swap output** — proceeds are sent by the router directly to your address (`to = user`).
- It can only ever touch **FISH you approved**, per day at most the minimum of (today's mint × your percent, your daily cap, your balance, your remaining allowance).
- It only swaps into **the target you registered**, over a validated 2–3 hop path; the minimum output is computed on-chain from the live quote and your slippage setting.
- The keeper can only trigger `execute()` (the once-per-day rule is enforced by the contract). It cannot change settings or withdraw anything.
- The owner can only set the keeper and pause. **There is no withdraw function at all.**
- Stopping is immediate: `disable()` on the site, plus revoking the allowance (approve 0).

## 構成 / Layout

| パス | 内容 |
|---|---|
| `contracts/FishAutoSwap.sol` | 本体コントラクト（Solidity 0.8、外部依存なし） |
| `contracts/build/FishAutoSwap.json` | コンパイル済み ABI + バイトコード（solc 0.8.38、7,091 bytes） |
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
5. **確認** — `https://fish-autoswap.nepicobsv.workers.dev/status` が `ready: true` を返せば稼働開始。最初の登録は自分のウォレットで少額設定（上限小さめ）で試すのがおすすめです。
   **Verify** — `/status` should answer `ready: true`. Do the first registration from your own wallet with a small cap.

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

- コントラクト: `cd tools && npm install && node compile.mjs` でコンパイル。`node smoke-test.mjs` でローカル EVM（ganache）上にモックの FISH / ルーター / ファクトリーを実アドレスへ配置し、登録→実行・1日1回制限・上限・無効化・一時停止・経路検証など21項目を検証済み（全て合格）。
- サイト読み取り: `node verify-site-reads.mjs` で「今日の配布」集計がエクスプローラーの実績値と wei 単位で一致することを確認済み。
- Worker: デプロイ済み。`CONTRACT_ADDRESS` 未設定の間は `/status` が `not_ready` を返し、Cron が来ても何もしません。

- Contract: compile with `node compile.mjs`; `node smoke-test.mjs` runs 21 checks on a local ganache chain with mocks placed at the real mainnet addresses (register → execute, once-per-day gate, cap, disable, pause, path validation — all passing).
- Site reads: `verify-site-reads.mjs` confirmed the "today's drop" total matches the explorer's record to the wei.
- Worker: deployed; while `CONTRACT_ADDRESS` is unset, `/status` answers `not_ready` and the daily cron does nothing.

## 開発メモ / Development notes

- チェーン: 42 Chain（EVM 421018）、DEX は Don't Panic / Nutri-Matic V2（router `0xBF07dFE35746894bAe373f63f4Bf2379F9BaFEc0`、factory `0x3157C6AcA800D507af95Ab1466adBA3A6F11eE1a`）。経路内のネイティブ [42] は `0xEeee…EEeE` センチネル。設定上の「ネイティブ指定」は `address(0)` に正規化されます。
- 「その日の FISH」は UTC 日付で数えます。配布（00:05 UTC）と実行（00:10 UTC）は同じ UTC 日なので、1日1回制限とずれません。
- Worker の API: `GET /status`、`GET /history?user=0x…`、`POST /run`（任意 Secret 設定時のみ）。
- エクスプローラー: https://scan.infinitedrive.xyz

## License

MIT
