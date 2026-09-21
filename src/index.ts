import 'dotenv/config';
import { CookieClickerBrowser } from './browser.js';
import { chooseAction } from './jev.js';
import { isSpeedrunMode, loadSpeedrunConfig } from './speedrun/config.js';
import { runSpeedrun } from './speedrun/run.js';
import type { GameState } from './types.js';

const MAX_STEPS = Number(process.env.MAX_STEPS ?? '50');
const EFFICIENT = process.env.EFFICIENT !== 'false';
const STEP_DELAY_MS = Number(process.env.STEP_DELAY_MS ?? '0');

function hasPurchase(state: GameState): boolean {
  return Object.keys(state.candidates).some(
    (k) => k.startsWith('buy_building_') || k.startsWith('buy_upgrade_'),
  );
}

function purchaseOnlyCandidates(state: GameState): GameState {
  const candidates: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.candidates)) {
    if (k.startsWith('buy_') || k.startsWith('farm_') || k === 'stop') {
      candidates[k] = v;
    }
  }
  if (!Object.keys(candidates).some((k) => k.startsWith('farm_'))) {
    candidates.farm_clicks_50 = 'Farm 50 clicks';
  }
  return { ...state, candidates };
}

async function main(): Promise<void> {
  const speedrun = isSpeedrunMode();
  if (speedrun) {
    const config = loadSpeedrunConfig();
    if (config.jevOnTie && !process.env.AI_GATEWAY_API_KEY) {
      console.error(
        'Error: AI_GATEWAY_API_KEY is missing.\n' +
          '1HC mode asks Jev (via Vercel AI Gateway) when purchase ROI is close.\n' +
          'Set AI_GATEWAY_API_KEY, or set JEV_ON_TIE=false to use local ROI only.\n' +
          'Docs: https://vercel.com/docs/ai-gateway',
      );
      process.exit(1);
    }
  } else if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(
      'Error: AI_GATEWAY_API_KEY is missing.\n' +
        'Copy .env.example to .env and set your Vercel AI Gateway API key.\n' +
        'Docs: https://vercel.com/docs/ai-gateway',
    );
    process.exit(1);
  }

  const browser = new CookieClickerBrowser();
  const life = { stopping: false, signals: 0 };

  const shutdown = (signal: string) => {
    life.signals += 1;
    if (life.signals === 1) {
      life.stopping = true;
      console.log(`\n[${signal}] stopping after this tick…`);
      return;
    }
    void browser.close().finally(() => process.exit(1));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  if (speedrun) {
    await runSpeedrun(browser, () => life.stopping);
    await browser.close();
    return;
  }

  console.log('Launching Cookie Clicker…');
  console.log(
    `MAX_STEPS=${MAX_STEPS} EFFICIENT=${EFFICIENT} CDP=${Boolean(process.env.CDP_URL)} STEP_DELAY_MS=${STEP_DELAY_MS}`,
  );

  await browser.launch();
  console.log(
    EFFICIENT
      ? 'Game ready. Efficient loop: local farm when broke, Jev on purchases.\n'
      : 'Game ready. Starting Jev decision loop.\n',
  );

  for (let step = 1; step <= MAX_STEPS && !life.stopping; step++) {
    console.log(`── step ${step}/${MAX_STEPS} ──`);
    let state: GameState;
    try {
      state = await browser.observe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`observe error: ${msg}`);
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    console.log(`state: ${state.summary}`);

    let action: string;

    if (EFFICIENT && !hasPurchase(state)) {
      action =
        state.nextBuildingPrice != null && state.cookies < state.nextBuildingPrice
          ? 'farm_to_next'
          : 'farm_clicks_200';
      console.log(`local: ${action} (no affordable purchases)`);
    } else {
      const decideState = EFFICIENT ? purchaseOnlyCandidates(state) : state;
      const buyKeys = Object.keys(decideState.candidates).filter((k) => k.startsWith('buy_'));
      if (EFFICIENT && buyKeys.length === 1) {
        action = buyKeys[0];
        console.log(`local: ${action} (single purchase, skip Jev)`);
      } else if (
        EFFICIENT &&
        state.upgrades.length > 0 &&
        buyKeys.every((k) => k.startsWith('buy_upgrade_') || k.startsWith('buy_building_'))
      ) {
        const up = [...state.upgrades].sort((a, b) => a.price - b.price)[0];
        action = `buy_upgrade_${up.id}`;
        console.log(`local: ${action} (upgrade priority)`);
      } else {
        console.log(
          `candidates (${Object.keys(decideState.candidates).length}): ${Object.keys(decideState.candidates).join(', ')}`,
        );
        try {
          const choice = await chooseAction(decideState);
          action = choice.action;
          const top =
            choice.probabilities &&
            Object.entries(choice.probabilities)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([k, v]) => `${k}=${v.toFixed(2)}`)
              .join(', ');
          console.log(`jev: ${action}${top ? ` (top: ${top})` : ''}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`jev error: ${msg}`);
          const best = state.buildings[0];
          if (state.upgrades[0]) action = `buy_upgrade_${state.upgrades[0].id}`;
          else if (best) action = `buy_building_${best.id}`;
          else action = EFFICIENT ? 'farm_clicks_200' : 'click_cookie';
          console.log(`fallback: ${action}`);
        }
      }
    }

    if (action === 'stop') {
      console.log('result: stop — exiting loop');
      break;
    }

    const result = await browser.act(action);
    console.log(`result: ${result.ok ? 'ok' : 'fail'} — ${result.message}\n`);

    if (STEP_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
    }
    if (!result.ok) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log('Done.');
  await browser.close();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
