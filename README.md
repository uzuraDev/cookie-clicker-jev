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

- **Observation** (`src/browser.ts`): cookies, CPS, affordable buildings (`#products .product.unlocked.enabled`), upgrades (`#upgrades .crate.upgrade.enabled`)
- **Candidates**: `click_cookie`, `buy_building_N`, `buy_upgrade_N`, `wait_1s`, `wait_5s`, `stop`
- **Decision** (`src/jev.ts`): AI SDK `experimental_evaluate` with model `typesafe-ai/jev` and a `choice` question (`criteria` map). Authenticated only through AI Gateway (`AI_GATEWAY_API_KEY`). Never calls TypeSafe’s direct API.
- **Execution**: Playwright clicks `#bigCookie`, `#productN`, upgrade crates, or waits

## Typecheck

```bash
npm run typecheck
```

## License

MIT
