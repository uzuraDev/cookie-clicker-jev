# cookie-clicker-jev

Minimal loop that plays [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) in a browser, while **Jev** (via [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)) only decides the next action.

Architecture (DOM observe → candidates → Jev Choice → execute):

1. **Playwright** opens Cookie Clicker
2. App code observes the DOM and builds numbered action candidates
3. **Jev** (`typesafe-ai/jev`) picks one action via `experimental_evaluate` Choice
4. App code executes click / wait / buy and loops

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
| `AI_GATEWAY_API_KEY` | yes | — | Vercel AI Gateway API key |
| `HEADLESS` | no | `true` | Set `HEADLESS=false` to watch the browser |
| `MAX_STEPS` | no | `50` | Max Jev decisions before exit |

## Run

```bash
npm start
```

Watch the game:

```bash
HEADLESS=false npm start
```

Short run:

```bash
MAX_STEPS=10 npm start
```

Stop anytime with `Ctrl+C`.

## How it works

- **Boot** (`src/browser.ts`): open the official page, preset English (`CookieClickerLang`) and the consent cookie, then wait until `Game.ready` with the loader and the off-game message gone.
- **Overlays**: if the language prompt is still up, click `#langSelect-EN`. Notes (`.note .close`) are closed. The consent banner is removed in the page — its “Got it!” control is `<a target="_blank">`, so a normal click leaves the game. `#prefsButton` is not clicked; that opens Options.
- **Observation**: cookies, CPS, affordable buildings (`#products .product.unlocked.enabled`), affordable upgrades (`#upgrades .crate.upgrade.enabled`).
- **Candidates** (these strings are the Choice keys): `click_cookie`, `buy_building_N`, `buy_upgrade_N`, `wait_1s`, `wait_5s`, `stop`.
- **Decision** (`src/jev.ts`): AI SDK `experimental_evaluate` with model `typesafe-ai/jev` and a `choice` question. The option map field is `criteria` (key → description). Authenticated only through AI Gateway (`AI_GATEWAY_API_KEY`). Never calls TypeSafe’s direct API.
- **Execution**:
  - `click_cookie` calls `Game.ClickCookie()` (a DOM click is only the fallback; overlays often cover `#bigCookie`).
  - `buy_building_N` calls `Game.ObjectsById[N].buy(1)` and checks that the owned count increased. It refuses when the building is locked, too expensive, or the store is in Sell mode.
  - `buy_upgrade_N` calls `Game.UpgradesById[N].buy()` and checks the bought flag.
  - `wait_1s` / `wait_5s` just wait.

Each step logs `state:`, the candidate keys, `jev: <action>`, and `result: ok|fail`.

## Troubleshooting

If the tab stays on Cloudflare’s “Just a moment…” page, run with a visible browser:

```bash
HEADLESS=false npm start
```

Headless Chromium is more likely to be challenged. The default is still headless (`HEADLESS` unset or anything other than `false`).

## Typecheck

```bash
npm run typecheck
```

## License

MIT
