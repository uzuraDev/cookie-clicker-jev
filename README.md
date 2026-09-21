# cookie-clicker-jev

Minimal loop that plays [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) in a browser. **Jev** (via [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)) only picks the next action. It does not see the screen and it does not write code.

```
DOM  →  numbered candidates  →  Jev Choice  →  click / wait  →  verify  →  repeat
```

| Step | Who | What |
| --- | --- | --- |
| Observe | `src/browser.ts` | Read cookies, CPS, unlocked buildings (`#products .product.unlocked`), the next locked building, and upgrades (`#upgrades .crate.upgrade`, including the cheapest one you cannot afford yet) |
| Candidates | `src/candidates.ts` | Numbered choices: click `#bigCookie`, buy `#productN` / `#upgradeN`, wait, or stop |
| Decide | `src/jev.ts` | `experimental_evaluate` on `typesafe-ai/jev` with a `choice` question |
| Act | `src/browser.ts` | Playwright clicks or waits, then checks that cookies, owned count, or the upgrade list actually changed |

The pattern follows [jev-ultrafast](https://github.com/browser-use/jev-ultrafast): the page becomes an indexed action list, the model returns one index, and application code performs that action. This project is a small original TypeScript loop for Cookie Clicker only (browser, not Steam).

## Requirements

- Node.js 22+
- A Vercel AI Gateway API key (`AI_GATEWAY_API_KEY`)
- Chromium for Playwright
- A display for the reliable path. Cookie Clicker's Cloudflare check blocks **headless** Chromium. With `DISPLAY` set, the default is a visible window.

## Setup

```bash
git clone https://github.com/uzuraDev/cookie-clicker-jev.git
cd cookie-clicker-jev
cp .env.example .env
# Edit .env and set AI_GATEWAY_API_KEY

npm install
npx playwright install chromium
```

### Environment

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `AI_GATEWAY_API_KEY` | yes | — | Vercel AI Gateway API key. The process exits with a clear error if it is missing. Requests go to AI Gateway (`typesafe-ai/jev`), not to TypeSafe's own API. |
| `HEADLESS` | no | visible if `DISPLAY` is set, else headless | `true` or `false`. Headless usually stops on the Cloudflare interstitial. |
| `MAX_STEPS` | no | `50` | Stop after this many Jev decisions. |

## Run

```bash
npm start
```

Force a visible window, or a short run:

```bash
HEADLESS=false npm start
MAX_STEPS=10 npm start
```

Stop anytime with `Ctrl+C` (or `SIGTERM`). Each step logs the compact state, the numbered candidates, Jev's choice (and the top probabilities), and whether the action changed the game.

## Jev call

AI SDK 7 routes the model string through AI Gateway. The choice map field is `criteria` (option key → description):

```ts
import { experimental_evaluate as evaluate } from 'ai'

const result = await evaluate({
  model: 'typesafe-ai/jev',
  state: { cookies, cps, summary },
  questions: {
    action: {
      type: 'choice',
      instructions: '次に取るべき一手',
      criteria: {
        '1': 'Click the big cookie once (#bigCookie)',
        '2': 'Buy building #product0 "Cursor" (owned 0, price 15)',
      },
    },
  },
})
// result.answers.action.choice === '1' | '2' | …
```

Authentication is `AI_GATEWAY_API_KEY` (or a Vercel OIDC token, if the AI SDK finds one). No key is hardcoded.

## Typecheck

```bash
npm run typecheck
```

## License

MIT
