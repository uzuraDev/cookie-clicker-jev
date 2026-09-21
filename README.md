# cookie-clicker-jev

Minimal loop that plays [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) in a browser, while **Jev** (via [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)) decides only when a choice is actually close.

Two modes:

- **Default (efficient)** — paced big-cookie farms when nothing is affordable, a local buy when there is a single purchase or an upgrade, and a Jev Choice only when several buildings are close. `EFFICIENT=false` restores one Jev Choice per step (`click` / `wait` / `buy` / `stop`).
- **1 Heavenly Chip** — a timed speedrun on the same browser boot. The page clicks and pops golden cookies itself. Local ROI buys buildings and upgrades. Jev is called only to break a close purchase tie.

Architecture (DOM observe → candidates → local rule or Jev Choice → execute):

1. **Playwright** opens Cookie Clicker, or attaches with `CDP_URL`
2. App code observes the game and builds action candidates (ROI in efficient mode)
3. Local rules farm or buy when the choice is obvious; **Jev** (`typesafe-ai/jev`) picks via `experimental_evaluate` Choice when it is not
4. App code executes the click, farm, wait, or buy and loops

Jev does **not** see the screen and does **not** write code.

## Requirements

- Node.js **22+** (AI SDK 7)
- Vercel AI Gateway API key

## Setup

```bash
git clone https://github.com/uzuraDev/cookie-clicker-jev.git
cd cookie-clicker-jev
cp .env.example .env
# Edit .env and set AI_GATEWAY_API_KEY=...

npm install
npx playwright install chromium
```

### Environment

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `AI_GATEWAY_API_KEY` | yes for the default loop, and for 1HC when `JEV_ON_TIE` is on | — | Vercel AI Gateway API key. Never a TypeSafe direct key |
| `HEADLESS` | no | `true` | Set `HEADLESS=false` to watch the browser |
| `CHROME_CHANNEL` | no | — | Playwright channel when launching, e.g. `chrome` |
| `MAX_STEPS` | no | `50` | Default loop only. Max steps before exit |
| `EFFICIENT` | no | on | Default loop. `false` asks Jev every step (`click` / `wait` / `buy`) |
| `STEP_DELAY_MS` | no | `0` | Pause after each default-loop action |
| `FARM_MS` | no | `8000` | Cap for one `farm_to_next` action |
| `SPEEDRUN_1HC` | no | off | `true` starts the 1 Heavenly Chip attempt |
| `MODE` | no | — | `1hc` is the same switch as `SPEEDRUN_1HC=true` |
| `CDP_URL` | no | — | Attach to Chromium (`http://127.0.0.1:9222`) instead of launching one |
| `KEEP_TAB` | no | `true` | On CDP close, disconnect without quitting Chrome. `false` also closes the game tab |
| `CLICK_INTERVAL_MS` | no | `25` | 1HC big-cookie gap. Raised to 21 if lower. See below |
| `JEV_ON_TIE` | no | `true` | 1HC: ask Jev when ROI paybacks are close. `false` = local ROI only |
| `JEV_TIE_RATIO` | no | `1.25` | Second payback within this multiple of the best triggers Jev |
| `JEV_MIN_INTERVAL_MS` | no | `12000` | Minimum time between Jev purchase calls |
| `BUY_INTERVAL_MS` | no | `250` | How often the 1HC loop considers a purchase |
| `LOG_INTERVAL_MS` | no | `5000` | Status line interval |
| `MAX_PAYBACK_SEC` | no | `180` | Buy when weighted payback is shorter than this |
| `LUCKY_RESERVE` | no | `true` | After 1e6 baked, keep a Lucky bank unless a buff is up |
| `SPEEDRUN_MAX_MS` | no | — | Stop early without ascending (debug). Not a successful finish |

## Run

Efficient loop (default): local 80ms farms, skip Jev on a single buy, Jev when several buildings compete.

```bash
npm start
```

Watch the game, optionally in installed Chrome:

```bash
HEADLESS=false CHROME_CHANNEL=chrome npm start
```

One Jev choice every step (no paced farm):

```bash
EFFICIENT=false npm start
```

Short run:

```bash
MAX_STEPS=10 npm start
```

Stop anytime with `Ctrl+C`.

Attach to a running Chromium (start it with `--remote-debugging-port=9222`). Closing the bot disconnects and leaves Chrome and the tab open (`KEEP_TAB` defaults to true). `KEEP_TAB=false` closes the game tab and still does not quit Chrome.

```bash
CDP_URL=http://127.0.0.1:9222 npm start
```

## 1 Heavenly Chip attempt

Category reference: [speedrun.com — 1 Heavenly Chip](https://www.speedrun.com/cclicker), Dumpe, **5h 18m 16s**, Cookie Clicker **~2.052**, Golden Cookies + Fast Click (mouse-wheel). The goal is one prestige level: **1e12 cookies baked all time**, then ascend.

```bash
SPEEDRUN_1HC=true HEADLESS=false npm start
```

or:

```bash
HEADLESS=false npm run speedrun:1hc
```

Attach to an existing Chromium (start it with `--remote-debugging-port=9222`). If a Cookie Clicker tab is already open, that tab is reused and not reloaded. `KEEP_TAB` defaults to true, so shutdown disconnects CDP and leaves Chrome and the tab running. `KEEP_TAB=false` closes the game tab only.

```bash
SPEEDRUN_1HC=true CDP_URL=http://127.0.0.1:9222 npm start
```

`CDP_URL` uses the browser you attached. **The run calls `Game.HardReset(2)`**, which wipes that profile's Cookie Clicker save (achievements, heavenly chips, and progress). A browser this process launches uses a fresh context, so the wipe stays inside that session. `CHROME_CHANNEL=chrome` launches installed Chrome instead of bundled Chromium.

Local ROI only, no gateway call:

```bash
SPEEDRUN_1HC=true JEV_ON_TIE=false npm start
```

What it does:

1. Opens the official page (or the `CDP_URL` tab) and waits until the game is playable.
2. Wipes the save. **The clock starts** when that fresh run accepts clicks (`Game.T >= 3`, cookies baked all time is 0, not ascending).
3. An in-page loop calls `Game.ClickCookie()` every `CLICK_INTERVAL_MS` (default 25, about 40 clicks/s). During Click frenzy, Dragonflight, or Cursed finger the gap tightens to 21ms. Bare `Game.ClickCookie()` **drops** clicks closer than 20ms (`1000/50`). Clicks faster than ~15/s still count; the game may award Uncanny clicker. That matches a fast-click / mouse-wheel pace, not a burst the game ignores. The default efficient loop is a different pace: `farm_clicks_*` and `farm_to_next` wait 80ms between clicks (~12/s), which stays above both the discard floor and the ~67ms Uncanny threshold. 1HC does not use that 80ms farm.
4. The same loop pops `Game.shimmers` (golden cookies, wrath cookies, reindeer, cookie-storm drops) and falls back to `.shimmer` if the array is empty. Golden cookies are not left on screen while the buyer thinks.
5. Purchases are local. The page dry-runs `Game.CalculateGains` (achievements and unlocks stubbed) to estimate CpS and click gain, including the active buff. Early on it follows a cursor / click-upgrade / grandma / farm / mine order. After about 1e6 cookies baked it buys the best payback, with extra weight on click upgrades, finger upgrades, and kittens. **Lucky day, Serendipity, and Get lucky** are bought as soon as they are affordable. Frenzy, Dragon Harvest, Elder frenzy, and building specials (CpS multiplier ≥ 2) spend the bank and allow a longer payback. Click frenzy makes click upgrades win the ranking because their click delta is multiplied in the live sim. Wrath upgrades (One mind and the rest of the grandmapocalypse) are never bought.
6. Jev (`typesafe-ai/jev`, `experimental_evaluate` Choice, `criteria`) runs only when two or more of those purchases are within `JEV_TIE_RATIO`, and at most once per `JEV_MIN_INTERVAL_MS`. Clicks and golden cookies never wait on Jev.
7. At ≥ 1e12 cookies baked all time and ≥ 1 pending prestige, it calls `Game.Ascend(1)` and **stops the clock** when the ascending UI is visible (`#game.ascendIntro` / `#game.ascending`, or the Ascending note). The ~5 second intro is not added. It then waits for the ascend screen so prestige and heavenly chips are actually granted. It does **not** reincarnate. Rebirth and From scratch are awarded on Reincarnate, not on the ascend click.

Status lines look like:

```text
[t+0:01:02.000] baked=1.234e4 bank=500.0 cps=12.5 mouse=4.0 gc=1 clicks=2400 buys=6 buffs=Frenzy
```

The run ends with:

```text
RESULT: time=5:18:16.000 target=5:18:16 met=yes
```

`met=yes` means the clock is ≤ 5:18:16 **and** the ascension is worth at least one heavenly chip. `Ctrl+C` or `SPEEDRUN_MAX_MS` prints `met=no`.

### How this clock maps to speedrun.com

SRC starts the timer on the **Wipe Save** click (the category requires a wipe even on a new save, because it resets the golden-cookie timer) and ends when you ascend. This bot's wipe is `Game.HardReset(2)`, the same call the second confirmation makes, with no dialog delay. The clock then waits until clicks register (about a tenth of a second). That is a bit later than a literal Wipe Save click and a bit earlier than a human sitting through both prompts. The end is the ascend action plus a visible ascending UI, which is the same moment a runner clicks Ascend, not the end of the choir animation.

### This is not a leaderboard submission

speedrun.com's Cookie Clicker rules disallow auto-clickers and add-ons. A fully automated run is for **beating the time**, not for submitting to the board. Treat a `met=yes` line as a local result.

The live site may not be exactly 2.052. The log prints `Game.version` and calls out a mismatch. The bot still plays; it does not pin an old build.

Golden-cookie uptime and buying during Frenzy / Click frenzy / building specials are the parts most likely to decide a 5 hour attempt. The farmer never ignores a shimmer, and the buyer uses the buffed CpS and click values from the live game. It is not a hand-authored world-record route.

## How the default loop works

- **Boot** (`src/browser.ts`): open the official page, or attach with `CDP_URL` and reuse an existing Cookie Clicker tab. Preset English (`CookieClickerLang`) and the consent cookie (cookie writes on an existing CDP context are best-effort), then wait until `Game.ready` with the loader and the off-game message gone. `CHROME_CHANNEL` selects installed Chrome when this process launches the browser. On CDP, `close()` disconnects and does not quit Chrome; the tab stays unless `KEEP_TAB=false`.
- **Overlays**: if the language prompt is still up, click `#langSelect-EN`. Notes (`.note .close`) are closed. The consent banner is removed in the page — its “Got it!” control is `<a target="_blank">`, so a normal click leaves the game. `#prefsButton` is not clicked; that opens Options.
- **Observation**: cookies, CPS, click power, the cheapest unlocked building (`nextBuildingPrice`), affordable buildings ranked by `cpsGain / price`, and affordable upgrades. The top five buildings are the buy candidates in efficient mode.
- **Efficient decisions** (`EFFICIENT` defaults to on):
  - Nothing affordable → `farm_to_next` (or `farm_clicks_200` if every unlocked building is already affordable). No Jev call.
  - Exactly one `buy_*` key → buy it. No Jev call.
  - Any affordable upgrade → buy the cheapest upgrade. No Jev call.
  - Otherwise Jev sees purchases plus `farm_*` / `stop` (click and wait keys are omitted).
- **`EFFICIENT=false` candidates**: `click_cookie`, `buy_building_N`, `buy_upgrade_N`, `wait_1s`, `wait_5s`, `stop`. Every step asks Jev.
- **Decision** (`src/jev.ts`): AI SDK `experimental_evaluate` with model `typesafe-ai/jev` and a `choice` question. The option map field is `criteria` (key → description). The instruction prefers upgrades, then the best payback, then `farm_to_next` / `farm_clicks_*` over waiting. Authenticated only through AI Gateway (`AI_GATEWAY_API_KEY`). Never calls TypeSafe’s direct API. A Jev error falls back to the cheapest listed upgrade, else the best-efficiency building, else `farm_clicks_200`.
- **Execution**:
  - `click_cookie` calls `Game.ClickCookie()` (a DOM click is only the fallback; overlays often cover `#bigCookie`).
  - `farm_clicks_N` and `farm_to_next` call `Game.ClickCookie()` with an **80ms** gap (~12 clicks/s). Cookie Clicker drops clicks closer than 20ms, and gaps under ~67ms can award Uncanny clicker; 80ms stays clear of both. `farm_to_next` stops when the cheapest unlocked building is affordable, or after `FARM_MS` (default 8000).
  - `buy_building_N` calls `Game.ObjectsById[N].buy(1)` and checks that the owned count increased. It refuses when the building is locked, too expensive, or the store is in Sell mode.
  - `buy_upgrade_N` calls `Game.UpgradesById[N].buy()` and checks the bought flag.
  - `wait_1s` / `wait_5s` just wait (only offered when `EFFICIENT=false`).

Each step logs `state:`, then `local:` or `jev: <action>`, and `result: ok|fail`.

## Troubleshooting

If the tab stays on Cloudflare’s “Just a moment…” page, run with a visible browser:

```bash
HEADLESS=false npm start
```

Headless Chromium is more likely to be challenged. The default is still headless (`HEADLESS` unset or anything other than `false`).

## Typecheck and unit tests

```bash
npm run typecheck
npm test
```

The tests cover the clock, the click-interval floor, and the purchase picker (early route, golden-cookie upgrades, Frenzy bank, Click frenzy ranking, Jev ties). They do not play a five-hour game.

## License

MIT
