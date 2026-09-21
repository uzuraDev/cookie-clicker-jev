import dotenv from 'dotenv';
import { CookieClickerBrowser, resolveHeadless } from './browser.js';
import { chooseAction } from './jev.js';

dotenv.config({ quiet: true });

function readMaxSteps(): number {
  const raw = process.env.MAX_STEPS ?? '50';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`MAX_STEPS must be a positive number (got ${raw}).`);
  }
  return Math.floor(n);
}

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(
      'Error: AI_GATEWAY_API_KEY is missing.\n' +
        'Copy .env.example to .env and set your Vercel AI Gateway API key.\n' +
        'Docs: https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe',
    );
    process.exit(1);
  }

  const maxSteps = readMaxSteps();
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

  console.log('Opening https://orteil.dashnet.org/cookieclicker/');
  console.log(
    `MAX_STEPS=${maxSteps} HEADLESS=${resolveHeadless()} (set HEADLESS=true|false to override)`,
  );

  try {
    await browser.launch();
    console.log('Game ready. Jev chooses the next action; this process executes it.\n');

    for (let step = 1; step <= maxSteps && !stopping; step++) {
      const state = await browser.observe();
      console.log(`── step ${step}/${maxSteps} ──`);
      console.log(`state: ${state.summary}`);
      console.log('candidates:');
      for (const candidate of state.candidates) {
        console.log(`  [${candidate.key}] ${candidate.id} — ${candidate.description}`);
      }

      let action: string;
      try {
        const choice = await chooseAction(state);
        action = choice.action;
        const top = choice.probabilities
          ? Object.entries(choice.probabilities)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([key, probability]) => `${key}=${probability.toFixed(2)}`)
              .join(', ')
          : '';
        const tokens =
          choice.usage?.inputTokens != null
            ? ` tokens=${choice.usage.inputTokens}/${choice.usage.outputTokens ?? '?'}`
            : '';
        console.log(
          `jev: [${choice.key}] ${choice.action}${top ? ` (top: ${top})` : ''}${tokens}`,
        );
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
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    console.log('Done.');
  } finally {
    if (!stopping) await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
