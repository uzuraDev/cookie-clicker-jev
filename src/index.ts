import 'dotenv/config';
import { CookieClickerBrowser } from './browser.js';
import { chooseAction } from './jev.js';

const MAX_STEPS = Number(process.env.MAX_STEPS ?? '50');

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(
      'Error: AI_GATEWAY_API_KEY is missing.\n' +
        'Copy .env.example to .env and set your Vercel AI Gateway API key.\n' +
        'Docs: https://vercel.com/docs/ai-gateway',
    );
    process.exit(1);
  }

  const browser = new CookieClickerBrowser();
  let stopping = false;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[${signal}] shutting down…`);
    await browser.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('Launching Cookie Clicker…');
  console.log(
    `MAX_STEPS=${MAX_STEPS} HEADLESS=${process.env.HEADLESS !== 'false'}`,
  );

  await browser.launch();
  console.log('Game ready. Starting Jev decision loop.\n');

  for (let step = 1; step <= MAX_STEPS && !stopping; step++) {
    const state = await browser.observe();
    console.log(`── step ${step}/${MAX_STEPS} ──`);
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
      // Soft-fail: continue so Jev can recover on next tick
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
