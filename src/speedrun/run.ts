import type { CookieClickerBrowser } from '../browser.js';
import { choosePurchase } from '../jev.js';
import type { SpeedrunSnapshot } from '../types.js';
import { loadSpeedrunConfig, type SpeedrunConfig } from './config.js';
import { formatClock, formatCookies, formatResult, TARGET_LABEL } from './format.js';
import { chooseBuy, MIN_CLICK_INTERVAL_MS, ONE_HEAVENLY_CHIP_COOKIES } from './strategy.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buffLabel(snapshot: SpeedrunSnapshot): string {
  if (snapshot.buffs.length === 0) return '-';
  return snapshot.buffs.map((buff) => buff.name).join('+');
}

function logStatus(snapshot: SpeedrunSnapshot, purchases: number): void {
  console.log(
    `[t+${formatClock(snapshot.elapsedMs)}] baked=${formatCookies(snapshot.baked)} bank=${formatCookies(snapshot.cookies)} cps=${snapshot.cps.toFixed(1)} mouse=${snapshot.mouseCps.toFixed(1)} gc=${snapshot.gcClicks} clicks=${snapshot.cookieClicks} buys=${purchases} buffs=${buffLabel(snapshot)}`,
  );
}

function clickHz(snapshot: SpeedrunSnapshot, intervalMs: number): number {
  const clickBuff = snapshot.buffs.some(
    (buff) => buff.name === 'Cursed finger' || (buff.multClick ?? 0) > 1,
  );
  const ms = clickBuff ? Math.min(intervalMs, MIN_CLICK_INTERVAL_MS) : intervalMs;
  return 1000 / ms;
}

/**
 * Play until the first ascension worth at least one heavenly chip.
 * The page clock starts once the wiped run accepts clicks and stops when
 * `Game.Ascend(1)` shows the ascending UI.
 */
export async function runSpeedrun(
  browser: CookieClickerBrowser,
  isStopping: () => boolean,
): Promise<void> {
  const config = loadSpeedrunConfig();
  logBanner(config);

  console.log('Launching Cookie Clicker…');
  await browser.launch();
  if (isStopping()) return;

  console.log('Wiping save with Game.HardReset(2)…');
  await browser.wipeSave();
  await browser.waitUntilFreshRun();
  const armed = await browser.armSpeedrun(config.clickIntervalMs);
  console.log(
    `Timer started. Cookie Clicker v${armed.version || 'unknown'}. ` +
      `Clock is the page's Date.now() from this moment (clicks unlocked) until ascend UI is visible.`,
  );
  if (armed.version && !armed.version.startsWith('2.052')) {
    console.log(
      `Note: category reference is Cookie Clicker ~2.052. This page is v${armed.version}.`,
    );
  }
  if (config.clickIntervalNote) console.log(config.clickIntervalNote);

  let purchases = 0;
  let lastLog = 0;
  let lastJev = 0;
  let finished = false;

  while (!isStopping()) {
    let snapshot: SpeedrunSnapshot;
    try {
      snapshot = await browser.readSpeedrunSnapshot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`observe error: ${msg}`);
      await sleep(1000);
      continue;
    }

    if (lastLog === 0 || snapshot.elapsedMs - lastLog >= config.logIntervalMs) {
      logStatus(snapshot, purchases);
      lastLog = snapshot.elapsedMs;
    }

    if (
      snapshot.baked >= ONE_HEAVENLY_CHIP_COOKIES &&
      snapshot.pendingPrestige >= 1
    ) {
      const done = await finishAscension(browser, config);
      if (done) {
        finished = true;
        break;
      }
      await browser.armSpeedrun(config.clickIntervalMs).catch(() => undefined);
      await sleep(config.buyIntervalMs);
      continue;
    }

    if (config.maxMs !== null && snapshot.elapsedMs >= config.maxMs) {
      console.log(`SPEEDRUN_MAX_MS=${config.maxMs} reached before ascension.`);
      console.log(formatResult(snapshot.elapsedMs, false));
      console.log('ended: time limit before ascension');
      finished = true;
      break;
    }

    const decision = chooseBuy({
      cookies: snapshot.cookies,
      cookiesEarned: snapshot.cookiesEarned,
      unbuffedCps: snapshot.unbuffedCps,
      buffs: snapshot.buffs,
      options: snapshot.options,
      buildingAmounts: snapshot.buildingAmounts,
      ownedUpgrades: snapshot.ownedUpgrades,
      clickHz: clickHz(snapshot, config.clickIntervalMs),
      mouseCps: snapshot.mouseCps,
      catalog: snapshot.catalog,
      config: config.strategy,
      jevEnabled: config.jevOnTie,
    });

    if (decision.type === 'farm') {
      await sleep(config.buyIntervalMs);
      continue;
    }

    let action: string;
    let reason: string;
    let payback: number | null;
    if (decision.type === 'ask-jev') {
      const now = Date.now();
      const fallback = decision.options.find((option) => option.key === decision.fallbackKey);
      if (now - lastJev < config.jevMinIntervalMs) {
        action = decision.fallbackKey;
        reason = 'roi-tie-local';
        payback = fallback?.paybackSec ?? null;
      } else {
        lastJev = now;
        const criteria: Record<string, string> = {};
        for (const option of decision.options) criteria[option.key] = option.criterion;
        try {
          const choice = await choosePurchase({
            summary: `baked=${formatCookies(snapshot.baked)} bank=${formatCookies(snapshot.cookies)} cps=${snapshot.cps.toFixed(1)} buffs=${buffLabel(snapshot)}`,
            cookies: snapshot.cookies,
            cps: snapshot.cps,
            baked: snapshot.baked,
            elapsed: formatClock(snapshot.elapsedMs),
            candidates: criteria,
          });
          action = choice.action;
          reason = 'jev';
          payback = decision.options.find((option) => option.key === action)?.paybackSec ?? null;
          const top =
            choice.probabilities &&
            Object.entries(choice.probabilities)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([key, value]) => `${key}=${value.toFixed(2)}`)
              .join(', ');
          console.log(`jev: ${action}${top ? ` (top: ${top})` : ''}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`jev error: ${msg} — using local ROI`);
          action = decision.fallbackKey;
          reason = 'jev-fallback';
          payback = fallback?.paybackSec ?? null;
        }
      }
    } else {
      action = decision.choice.key;
      reason = decision.choice.reason;
      payback = decision.choice.paybackSec;
    }

    if (isStopping()) break;

    const result = await browser.act(action);
    if (result.ok) purchases++;
    const pb =
      payback === null || !Number.isFinite(payback) ? 'n/a' : `${payback.toFixed(1)}s`;
    console.log(
      `buy: ${result.ok ? 'ok' : 'fail'} ${action} reason=${reason} payback=${pb} — ${result.message}`,
    );
    await sleep(config.buyIntervalMs);
  }

  if (!finished) {
    let elapsed = 0;
    try {
      elapsed = (await browser.readSpeedrunSnapshot()).elapsedMs;
    } catch {
      elapsed = 0;
    }
    await browser.stopSpeedrunFarmer().catch(() => undefined);
    console.log(formatResult(elapsed, false));
    console.log('ended: interrupted before ascension');
  }
}

function logBanner(config: SpeedrunConfig): void {
  const cdp = process.env.CDP_URL?.trim();
  console.log('1 Heavenly Chip speedrun (Golden Cookies + Fast Click).');
  console.log(
    `Target ${TARGET_LABEL} (Dumpe, Cookie Clicker ~2.052). ` +
      'This attempts the time. speedrun.com does not accept fully automated runs.',
  );
  console.log(
    'Timing: SRC starts on the Wipe Save click and ends when you ascend. ' +
      'This clock starts once Game.HardReset(2) has left a playable run (Game.T>=3, 0 cookies baked) ' +
      'and stops when Game.Ascend(1) runs with >=1e12 cookies baked all time and the ascending UI is visible. ' +
      'The ~5s ascend animation is not added. Rebirth / From scratch are awarded on Reincarnate; this run does not reincarnate.',
  );
  console.log(
    `click=${config.clickIntervalMs}ms buy=${config.buyIntervalMs}ms jevOnTie=${config.jevOnTie} ` +
      `tieRatio=${config.strategy.tieRatio} luckyReserve=${config.strategy.luckyReserve} ` +
      `maxPayback=${config.strategy.maxPaybackSec}s ` +
      (cdp ? `cdp=${cdp}` : `headless=${process.env.HEADLESS !== 'false'}`),
  );
}

async function finishAscension(
  browser: CookieClickerBrowser,
  config: SpeedrunConfig,
): Promise<boolean> {
  const attempt = await browser.performAscend();
  if (!attempt.ok) {
    console.error(`Ascend did not show UI (${attempt.reason}). Continuing.`);
    return false;
  }
  console.log(
    `Ascend performed at ${formatClock(attempt.elapsedMs)} ` +
      `(baked=${formatCookies(attempt.baked)} pendingPrestige=${attempt.pendingPrestige} ui=${attempt.reason}).`,
  );
  try {
    await browser.readAscendProgress();
    const page = await waitForChip(browser);
    console.log(
      `Ascend screen: onAscend=${page.onAscend} ascending=${page.ascending} ` +
        `prestige=${page.prestige} heavenlyChips=${page.heavenlyChips} ` +
        `rebirth=${page.rebirth} fromScratch=${page.fromScratch}`,
    );
    const category =
      page.prestige >= 1 || page.heavenlyChips >= 1 || attempt.pendingPrestige >= 1;
    const timeOk = attempt.elapsedMs <= config.targetSeconds * 1000;
    console.log(formatResult(attempt.elapsedMs, category && timeOk));
    if (!category) {
      console.log('ended: ascend UI without a heavenly chip');
    } else if (!timeOk) {
      console.log('ended: ascended with >=1 heavenly chip, slower than the target');
    } else {
      console.log('ended: ascended with >=1 heavenly chip inside the target');
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Ascend screen check: ${msg}`);
    const timeOk = attempt.elapsedMs <= config.targetSeconds * 1000;
    const category = attempt.pendingPrestige >= 1 && attempt.baked >= ONE_HEAVENLY_CHIP_COOKIES;
    console.log(formatResult(attempt.elapsedMs, category && timeOk));
    console.log('ended: ascend UI visible; heavenly-chip credit follows the intro animation');
    return true;
  }
}

async function waitForChip(
  browser: CookieClickerBrowser,
): Promise<Awaited<ReturnType<CookieClickerBrowser['readAscendProgress']>>> {
  const deadline = Date.now() + 8_000;
  let latest = await browser.readAscendProgress();
  while (Date.now() < deadline) {
    if (latest.onAscend || latest.ascending || latest.prestige >= 1 || latest.heavenlyChips >= 1) {
      return latest;
    }
    await sleep(200);
    latest = await browser.readAscendProgress();
  }
  return latest;
}
