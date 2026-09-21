import 'dotenv/config';
import { CookieClickerBrowser } from './browser.js';
import { chooseAction } from './jev.js';
import { isSpeedrunMode, loadSpeedrunConfig } from './speedrun/config.js';
import { runSpeedrun } from './speedrun/run.js';

const MAX_STEPS = Number(process.env.MAX_STEPS ?? '50');

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
    `MAX_STEPS=${MAX_STEPS} HEADLESS=${process.env.HEADLESS !== 'false'}`,
  );

  await browser.launch();
  console.log('Game ready. Starting Jev decision loop.\n');

  for (let step = 1; step <= MAX_STEPS && !life.stopping; step++) {
    console.log(`── step ${step}/${MAX_STEPS} ──`);
    let state;
    try {
      state = await browser.observe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`observe error: ${msg}`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    console.log(`state: ${state.summary}`);
    console.log(
      `candidates (${Object.keys(state.candidates).length}): ${Object.keys(state.candidates).join(', ')}`,
    );

    let action: string;
    try {
      const choice = await chooseAction(state);
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
      break;
    }

    if (action === 'stop') {
      console.log('result: stop — exiting loop');
      break;
    }

    const result = await browser.act(action);
    console.log(`result: ${result.ok ? 'ok' : 'fail'} — ${result.message}\n`);

    if (!result.ok) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log('Done.');
  await browser.close();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
