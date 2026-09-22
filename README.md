# cookie-clicker-jev

ブラウザで [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) を回す、最小限のループです。選択が本当に僅差のときだけ、**Jev**（[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) 経由）が決めます。

モードは二つあります。

- **デフォルト（efficient）** — 買えるものがなければ、間隔を置いて大クッキーを稼ぐ。購入候補が一つだけ、またはアップグレードがあるときは、ローカルで買う。建物が複数で僅差のときだけ、Jev の Choice を使う。`EFFICIENT=false` にすると、毎ステップ Jev が一つ選ぶように戻る（`click` / `wait` / `buy` / `stop`）。
- **1 Heavenly Chip** — 同じブラウザ起動で行う、タイム計測つきのスピードラン。クリックとゴールデンクッキーの回収は、ページ自身が行う。建物とアップグレードはローカルの ROI で買う。Jev を呼ぶのは、購入が僅差のときだけ。

アーキテクチャ（DOM の観測 → 候補 → ローカルのルールまたは Jev の Choice → 実行）:

1. **Playwright** が Cookie Clicker を開く。または `CDP_URL` で接続する
2. アプリのコードがゲームを観測し、行動の候補を作る（efficient モードでは ROI 付き）
3. 選択が明らかなら、ローカルのルールが稼ぐか買う。明らかでなければ **Jev**（`typesafe-ai/jev`）が `experimental_evaluate` の Choice で選ぶ
4. アプリのコードがクリック、ファーム、待機、購入を実行し、ループする

Jev は画面を**見ません**。コードも**書きません**。

## 必要なもの

- Node.js **22+**（AI SDK 7）
- Vercel AI Gateway の API キー

## セットアップ

```bash
git clone https://github.com/uzuraDev/cookie-clicker-jev.git
cd cookie-clicker-jev
cp .env.example .env
# .env を編集し、AI_GATEWAY_API_KEY=... を設定する

npm install
npx playwright install chromium
```

### 環境変数

| 変数 | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `AI_GATEWAY_API_KEY` | デフォルトループでは必須。1HC では `JEV_ON_TIE` がオンのとき必須 | — | Vercel AI Gateway の API キー。TypeSafe の直接キーは使わない |
| `HEADLESS` | いいえ | `true` | `HEADLESS=false` でブラウザを表示する |
| `CHROME_CHANNEL` | いいえ | — | 起動時の Playwright チャネル。例: `chrome` |
| `MAX_STEPS` | いいえ | `50` | デフォルトループのみ。終了までの最大ステップ数 |
| `EFFICIENT` | いいえ | オン | デフォルトループ。`false` にすると毎ステップ Jev に聞く（`click` / `wait` / `buy`） |
| `STEP_DELAY_MS` | いいえ | `0` | デフォルトループで、各行動のあとに入れる待ち |
| `FARM_MS` | いいえ | `8000` | `farm_to_next` 1回の上限 |
| `SPEEDRUN_1HC` | いいえ | オフ | `true` で 1 Heavenly Chip の挑戦を始める |
| `MODE` | いいえ | — | `1hc` は `SPEEDRUN_1HC=true` と同じスイッチ |
| `CDP_URL` | いいえ | — | Chromium を起動せず接続する（`http://127.0.0.1:9222`） |
| `KEEP_TAB` | いいえ | `true` | CDP の切断時、Chrome は終了せずに切り離す。`false` だとゲームのタブも閉じる |
| `CLICK_INTERVAL_MS` | いいえ | `25` | 1HC の大クッキー間隔。21 より小さい指定は 21 に引き上げる。下記を参照 |
| `JEV_ON_TIE` | いいえ | `true` | 1HC では、ROI の回収時間が近いとき Jev に聞く。`false` はローカルの ROI のみ |
| `JEV_TIE_RATIO` | いいえ | `1.25` | 2位の回収時間が、最良のこの倍率以内なら Jev を呼ぶ |
| `JEV_MIN_INTERVAL_MS` | いいえ | `12000` | Jev の購入判断を呼ぶ最短間隔 |
| `BUY_INTERVAL_MS` | いいえ | `250` | 1HC ループが購入を検討する間隔 |
| `LOG_INTERVAL_MS` | いいえ | `5000` | ステータス行を出す間隔 |
| `MAX_PAYBACK_SEC` | いいえ | `180` | 加重した回収時間がこれより短ければ買う |
| `LUCKY_RESERVE` | いいえ | `true` | 焼成が 1e6 を超えたあと、バフ中でなければ Lucky 用の所持金を残す |
| `SPEEDRUN_MAX_MS` | いいえ | — | 昇天せずに早めに止める（デバッグ）。成功扱いにはならない |

## 実行

efficient ループ（デフォルト）。ローカルで 80ms 間隔のファームを行い、購入が一つなら Jev を飛ばす。建物が複数で競うときだけ Jev を呼ぶ。

```bash
npm start
```

ゲームを表示する。インストール済みの Chrome でもよい。

```bash
HEADLESS=false CHROME_CHANNEL=chrome npm start
```

毎ステップ Jev が一つ選ぶ（間隔を置いたファームはしない）。

```bash
EFFICIENT=false npm start
```

短い実行。

```bash
MAX_STEPS=10 npm start
```

いつでも `Ctrl+C` で止められる。

起動済みの Chromium に接続する（`--remote-debugging-port=9222` を付けて起動しておく）。ボットを閉じると切断し、Chrome とタブは開いたまま残る（`KEEP_TAB` の既定は true）。`KEEP_TAB=false` はゲームのタブを閉じるが、Chrome 自体は終了しない。

```bash
CDP_URL=http://127.0.0.1:9222 npm start
```

## 1 Heavenly Chip の挑戦

カテゴリの参照は [speedrun.com — 1 Heavenly Chip](https://www.speedrun.com/cclicker)。Dumpe、**5時間18分16秒**、Cookie Clicker **~2.052**、Golden Cookies + Fast Click（マウスホイール）。目標はプレステージ 1 段階。**通算の焼成クッキー 1e12** に達したら昇天する。

```bash
SPEEDRUN_1HC=true HEADLESS=false npm start
```

または:

```bash
HEADLESS=false npm run speedrun:1hc
```

既存の Chromium に接続する（`--remote-debugging-port=9222` を付けて起動しておく）。Cookie Clicker のタブがすでに開いていれば、再読み込みせずそのタブを使う。`KEEP_TAB` の既定は true なので、終了時は CDP を切断し、Chrome とタブはそのまま動き続ける。`KEEP_TAB=false` が閉じるのはゲームのタブだけ。

```bash
SPEEDRUN_1HC=true CDP_URL=http://127.0.0.1:9222 npm start
```

`CDP_URL` は、接続したブラウザを使う。**この実行は `Game.HardReset(2)` を呼ぶ**。接続先プロファイルの Cookie Clicker セーブ（実績、天界チップ、進行状況）は消える。このプロセスが自分で起動したブラウザは新しいコンテキストなので、消去はそのセッションの中に留まる。`CHROME_CHANNEL=chrome` は、同梱の Chromium ではなくインストール済みの Chrome を起動する。

ローカルの ROI だけ。ゲートウェイは呼ばない。

```bash
SPEEDRUN_1HC=true JEV_ON_TIE=false npm start
```

やっていることは次のとおり。

1. 公式ページ（または `CDP_URL` のタブ）を開き、プレイできるまで待つ。
2. セーブを消す。**時計が始まる**のは、その新しいランがクリックを受け付けたとき（`Game.T >= 3`、通算の焼成クッキーは 0、昇天中ではない）。
3. ページ内のループが、`CLICK_INTERVAL_MS` ごとに `Game.ClickCookie()` を呼ぶ（既定は 25 で、およそ秒間 40 クリック）。Click frenzy、Dragonflight、Cursed finger のあいだは、間隔を 21ms まで詰める。素の `Game.ClickCookie()` は、20ms より近いクリックを**破棄する**（`1000/50`）。秒間およそ 15 回を超えるクリックでもカウントはされ、Uncanny clicker が付くことがある。これはファストクリックやマウスホイールのペースに合わせたもので、ゲームが無視する連打ではない。デフォルトの efficient ループは別のペースで、`farm_clicks_*` と `farm_to_next` の間隔は 80ms（およそ秒間 12 回）。80ms は、破棄の下限（20ms）も Uncanny clicker のしきい値（約 67ms）も上回る。1HC はこの 80ms のファームを使わない。
4. 同じループが `Game.shimmers`（ゴールデンクッキー、ラスクッキー、トナカイ、クッキーステームのドロップ）を割る。配列が空なら `.shimmer` にフォールバックする。購入側が考えているあいだ、ゴールデンクッキーを画面に残さない。
5. 購入はローカルで決める。ページは `Game.CalculateGains` をドライランし（実績とアンロックはスタブ）、有効なバフを含めて CpS とクリック増加を見積もる。序盤は、カーソル、クリック強化、グランマ、ファーム、鉱山の順で買う。焼成がおよそ 1e6 を超えると、回収時間が最良のものを買い、クリック強化、指のアップグレード、キトンには追加の重みを付ける。**Lucky day、Serendipity、Get lucky** は、買えるようになったらすぐ買う。Frenzy、Dragon Harvest、Elder frenzy、建物スペシャル（CpS 倍率が 2 以上）では所持金を使い、より長い回収時間も許す。Click frenzy では、ライブのシミュレーションでクリックの増加分が乗算されるため、クリック強化が順位で勝つ。ラス系のアップグレード（One mind と、それ以降のグランマポカリプス）は買わない。
6. Jev（`typesafe-ai/jev`、`experimental_evaluate` の Choice、`criteria`）が動くのは、それらの購入のうち二つ以上が `JEV_TIE_RATIO` 以内に入り、かつ `JEV_MIN_INTERVAL_MS` につき多くても一度のときだけ。クリックとゴールデンクッキーは、Jev を待たない。
7. 通算の焼成クッキーが 1e12 以上で、取得見込みのプレステージが 1 以上なら、`Game.Ascend(1)` を呼ぶ。昇天 UI が見えた時点で**時計を止める**（`#game.ascendIntro` / `#game.ascending`、または Ascending のノート）。およそ 5 秒のイントロは加算しない。そのあと昇天画面を待ち、プレステージと天界チップが実際に付与されるまで確認する。**転生はしない**。Rebirth と From scratch が付くのは Reincarnate のときであり、昇天のクリックではない。

ステータス行は次のような形になる。

```text
[t+0:01:02.000] baked=1.234e4 bank=500.0 cps=12.5 mouse=4.0 gc=1 clicks=2400 buys=6 buffs=Frenzy
```

終了時は次のように出る。

```text
RESULT: time=5:18:16.000 target=5:18:16 met=yes
```

`met=yes` は、時計が 5:18:16 以下**であり**、その昇天で天界チップが少なくとも 1 個得られることを意味する。`Ctrl+C` か `SPEEDRUN_MAX_MS` のときは `met=no` になる。

### この時計と speedrun.com の対応

speedrun.com（SRC）は **Wipe Save** のクリックでタイマーを開始する（ゴールデンクッキーのタイマーをリセットするため、新規セーブでもワイプがカテゴリの条件になっている）。終了は昇天したとき。このボットのワイプは `Game.HardReset(2)` で、確認の 2 回目が呼ぶのと同じ関数であり、ダイアログの待ちはない。時計はそのあと、クリックが通るまで待つ（およそ 0.1 秒）。これは、文字どおりの Wipe Save クリックより少し遅く、人間が両方の確認を待つよりは少し早い。終了は、昇天の操作に加えて昇天中の UI が見えた時点であり、ランナーが Ascend をクリックした瞬間に相当する。合唱のアニメーションが終わる時点ではない。

### リーダーボードへの投稿にはならない

speedrun.com の Cookie Clicker ルールは、オートクリッカーとアドオンを禁止している。完全に自動のランは、**タイムを上回るため**のものであり、ボードへ投稿するためのものではない。`met=yes` の行は、手元の結果として扱う。

公開中のサイトが、ちょうど 2.052 とは限らない。ログは `Game.version` を出し、食い違いがあれば知らせる。ボットはそのままプレイし、古いビルドには固定しない。

5 時間の成否を分けやすいのは、ゴールデンクッキー効果が出ている時間と、Frenzy / Click frenzy / 建物スペシャルのあいだの購入である。ファーム側はシマーを見逃さず、購入側はライブのゲームから、バフ後の CpS とクリック値を使う。人手で組んだ世界記録のルートではない。

## デフォルトループの動き

- **起動**（`src/browser.ts`）: 公式ページを開く。または `CDP_URL` で接続し、既存の Cookie Clicker タブを再利用する。言語は英語にあらかじめ設定する（`CookieClickerLang`）。同意クッキーも入れる（既存の CDP コンテキストへの書き込みはベストエフォート）。そのあと、ローダーとオフゲームのメッセージが消え、`Game.ready` になるまで待つ。`CHROME_CHANNEL` は、このプロセスがブラウザを起動するときに、インストール済みの Chrome を選ぶ。CDP では `close()` は切断するだけで、Chrome は終了しない。タブは `KEEP_TAB=false` でない限り残る。
- **オーバーレイ**: 言語の選択がまだ出ていれば、`#langSelect-EN` をクリックする。ノート（`.note .close`）は閉じる。同意バナーはページ内で取り除く。「Got it!」は `<a target="_blank">` なので、普通にクリックするとゲームから離れてしまう。`#prefsButton` はクリックしない。押すと Options が開く。
- **観測**: クッキー数、CPS、クリック威力、アンロック済みで最安の建物（`nextBuildingPrice`）、`cpsGain / price` で順位を付けた購入可能な建物、購入可能なアップグレード。efficient モードでは、上位 5 つの建物が購入候補になる。
- **efficient の判断**（`EFFICIENT` の既定はオン）:
  - 買えるものがない → `farm_to_next`（アンロック済みの建物がすべて買えるなら `farm_clicks_200`）。Jev は呼ばない。
  - `buy_*` のキーがちょうど一つ → それを買う。Jev は呼ばない。
  - 買えるアップグレードがある → 最安のアップグレードを買う。Jev は呼ばない。
  - それ以外では、Jev に購入候補と `farm_*` / `stop` を渡す（click と wait のキーは除く）。
- **`EFFICIENT=false` の候補**: `click_cookie`、`buy_building_N`、`buy_upgrade_N`、`wait_1s`、`wait_5s`、`stop`。毎ステップ Jev に聞く。
- **判断**（`src/jev.ts`）: AI SDK の `experimental_evaluate`。モデルは `typesafe-ai/jev`、質問は `choice`。選択肢マップのフィールドは `criteria`（キー → 説明）。指示は、アップグレードを優先し、次に回収時間が最良のもの、その次に待機より `farm_to_next` / `farm_clicks_*` を優先する。認証は AI Gateway（`AI_GATEWAY_API_KEY`）だけ。TypeSafe の API を直接呼ぶことはない。Jev がエラーのときは、一覧にある最安のアップグレード、なければ効率が最良の建物、それもなければ `farm_clicks_200` に戻る。
- **実行**:
  - `click_cookie` は `Game.ClickCookie()` を呼ぶ（DOM クリックはフォールバックだけ。オーバーレイが `#bigCookie` を覆っていることが多い）。
  - `farm_clicks_N` と `farm_to_next` は、**80ms** 間隔で `Game.ClickCookie()` を呼ぶ（およそ秒間 12 クリック）。Cookie Clicker は 20ms より近いクリックを破棄し、間隔がおよそ 67ms 未満だと Uncanny clicker が付くことがある。80ms はそのどちらにも掛からない。`farm_to_next` は、アンロック済みで最安の建物が買えるようになるか、`FARM_MS`（既定 8000）を過ぎると止まる。
  - `buy_building_N` は `Game.ObjectsById[N].buy(1)` を呼び、所持数が増えたことを確認する。建物がロックされている、高すぎる、ストアが Sell モード、のいずれかでは拒否する。
  - `buy_upgrade_N` は `Game.UpgradesById[N].buy()` を呼び、購入済みフラグを確認する。
  - `wait_1s` / `wait_5s` は待つだけ（候補に入るのは `EFFICIENT=false` のときだけ）。

各ステップは `state:` を出し、続いて `local:` または `jev: <action>`、そして `result: ok|fail` を出す。

## うまく動かないとき

タブが Cloudflare の “Just a moment…” のままなら、ブラウザを表示して実行する。

```bash
HEADLESS=false npm start
```

ヘッドレスの Chromium の方が、チャレンジされやすい。既定はヘッドレスのまま（`HEADLESS` が未設定、または `false` 以外）。

## 型チェックとユニットテスト

```bash
npm run typecheck
npm test
```

テストがカバーするのは、時計、クリック間隔の下限、購入の選び方（序盤ルート、ゴールデンクッキーのアップグレード、Frenzy 中の所持金、Click frenzy の順位、Jev の僅差）である。5 時間のゲーム自体はプレイしない。

## ライセンス

MIT
