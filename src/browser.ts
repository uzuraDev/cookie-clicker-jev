import { chromium, type Browser, type Page } from 'playwright';
import { buildCandidates, summarize } from './candidates.js';
import type { ActResult, GameState, Observation } from './types.js';

const GAME_URL = 'https://orteil.dashnet.org/cookieclicker/';

/**
 * Cookie Clicker's Cloudflare check blocks headless Chromium.
 * Default: visible window when DISPLAY is set, otherwise headless.
 * HEADLESS=true / HEADLESS=false overrides that.
 */
export function resolveHeadless(): boolean {
  if (process.env.HEADLESS === 'true') return true;
  if (process.env.HEADLESS === 'false') return false;
  return !process.env.DISPLAY;
}

type Meters = {
  cookies: number;
  buildingAmounts: Record<string, number>;
  enabledUpgrades: number[];
};

export class CookieClickerBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async launch(): Promise<void> {
    const headless = resolveHeadless();
    try {
      await this.open(headless);
    } catch (err) {
      const blocked = err instanceof CloudflareBlockedError;
      if (blocked && headless && process.env.DISPLAY && process.env.HEADLESS !== 'true') {
        console.warn(
          'Headless Chromium was blocked by Cloudflare. Opening a visible window instead…',
        );
        await this.close();
        await this.open(false);
        return;
      }
      throw err;
    }
  }

  private async open(headless: boolean): Promise<void> {
    this.browser = await chromium.launch({ headless });
    const context = await this.browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'en-US',
    });
    // tsx/esbuild injects a `__name` helper into functions sent to the page.
    // Language is stored before the game script runs so it does not reload
    // (a reload is often challenged by Cloudflare).
    await context.addInitScript(`
      globalThis.__name = (target) => target;
      try { localStorage.setItem('CookieClickerLang', 'EN'); } catch (e) {}
    `);
    await context.addCookies([
      {
        name: 'cookieconsent_dismissed',
        value: 'yes',
        domain: 'orteil.dashnet.org',
        path: '/',
      },
    ]);

    this.page = await context.newPage();
    await this.page.goto(GAME_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await this.waitForGame();
    await this.dismissOverlays();
    await this.page.waitForSelector('#bigCookie', { timeout: 30_000 });
    await this.waitForGame();
  }

  /** Dismiss language, the EU cookie banner, and stacked notes. */
  private async dismissOverlays(): Promise<void> {
    const page = this.requirePage();

    // The "Got it!" control is `<a target="_blank">`. A normal Playwright click
    // follows it and leaves the game. Remove the banner in the page instead.
    await page.evaluate(() => {
      document
        .querySelectorAll('.cc_banner-wrapper, .cc_container')
        .forEach((el) => el.remove());
      document.querySelectorAll('#notes .note .close').forEach((el) => {
        (el as HTMLElement).click();
      });
    });

    const lang = page.locator('#langSelect-EN');
    if (await lang.isVisible().catch(() => false)) {
      console.log('Language prompt is open — choosing English.');
      await lang.click();
      await this.waitForGame();
      await page.evaluate(() => {
        document.querySelectorAll('#notes .note .close').forEach((el) => {
          (el as HTMLElement).click();
        });
      });
    }
  }

  private async waitForGame(): Promise<void> {
    const page = this.requirePage();
    const started = Date.now();
    const timeoutMs = 45_000;
    while (Date.now() - started < timeoutMs) {
      const status = await page.evaluate(() => {
        const game = (window as unknown as { Game?: { ready?: number; T?: number } }).Game;
        const text = document.body?.innerText ?? '';
        return {
          ready: Boolean(game?.ready) && (game?.T ?? 0) >= 3,
          cloudflare:
            document.title.includes('Just a moment') ||
            text.includes('security verification'),
        };
      });
      if (status.ready) return;
      if (status.cloudflare && Date.now() - started > 8_000) {
        throw new CloudflareBlockedError();
      }
      await page.waitForTimeout(250);
    }
    if (await this.cloudflareBlocked()) throw new CloudflareBlockedError();
    throw new Error(
      'Cookie Clicker did not become ready (no Game.ready / #bigCookie). The page may still be loading.',
    );
  }

  private async cloudflareBlocked(): Promise<boolean> {
    const page = this.requirePage();
    return page.evaluate(() => {
      const text = document.body?.innerText ?? '';
      return (
        document.title.includes('Just a moment') ||
        text.includes('security verification')
      );
    });
  }

  async observe(): Promise<GameState> {
    await this.dismissOverlays();
    const obs = await this.readObservation();
    return {
      cookies: obs.cookies,
      cps: obs.cps,
      summary: summarize(obs),
      candidates: buildCandidates(obs),
    };
  }

  private async readObservation(): Promise<Observation> {
    const page = this.requirePage();
    return page.evaluate(() => {
      const game = (
        window as unknown as {
          Game?: {
            cookies?: number;
            cookiesPs?: number;
            ObjectsById?: Array<
              | {
                  id: number;
                  name: string;
                  amount: number;
                  price: number;
                  bulkPrice?: number;
                  locked?: number | boolean;
                }
              | undefined
            >;
            UpgradesById?: Array<
              | {
                  id: number;
                  name: string;
                  unlocked?: boolean;
                  bought?: boolean;
                  canBuy?: () => boolean;
                  getPrice?: () => number;
                }
              | undefined
            >;
          };
        }
      ).Game;

      const cookies = game?.cookies ?? 0;
      const cps = game?.cookiesPs ?? 0;
      const buildings: ObservationBuildings = [];
      let nextLockedBuilding: ObservationPriced | null = null;

      document.querySelectorAll('#products .product').forEach((el) => {
        const id = Number(el.id.replace(/^product/, ''));
        if (!Number.isInteger(id)) return;
        const className = String(el.className);
        const obj = game?.ObjectsById?.[id];
        const name = obj?.name ?? `building_${id}`;
        const price = obj?.bulkPrice ?? obj?.price ?? 0;
        if (className.includes('locked')) {
          if (!nextLockedBuilding || id < nextLockedBuilding.id) {
            nextLockedBuilding = { id, name, price: obj?.price ?? price };
          }
          return;
        }
        if (!className.includes('unlocked')) return;
        buildings.push({
          id,
          name,
          amount: obj?.amount ?? 0,
          price,
          affordable: className.includes('enabled'),
        });
      });

      const upgrades: ObservationUpgrades = [];
      let nextUpgrade: ObservationPriced | null = null;
      document.querySelectorAll('#upgrades .crate.upgrade').forEach((el) => {
        const className = String(el.className);
        if (className.includes('bought')) return;
        const dataId = el.getAttribute('data-id');
        let id = dataId != null ? Number(dataId) : NaN;
        if (!Number.isInteger(id)) {
          id = Number(el.id.replace(/^upgrade/, ''));
        }
        if (!Number.isInteger(id)) return;
        const up = game?.UpgradesById?.[id];
        let price = 0;
        try {
          price = up?.getPrice?.() ?? 0;
        } catch {
          price = 0;
        }
        const snap = { id, name: up?.name ?? `upgrade_${id}`, price };
        if (className.includes('enabled')) upgrades.push(snap);
        else if (price > 0 && (!nextUpgrade || price < nextUpgrade.price)) nextUpgrade = snap;
      });

      return { cookies, cps, buildings, upgrades, nextLockedBuilding, nextUpgrade };
    });
  }

  async act(action: string): Promise<ActResult> {
    const page = this.requirePage();
    await this.dismissOverlays();
    const before = await this.readMeters();

    try {
      if (action === 'click_cookie') {
        await page.locator('#bigCookie').click({ timeout: 5_000 });
        const after = await this.readMeters();
        const gained = after.cookies - before.cookies;
        const ok = gained > 0.01;
        return {
          ok,
          message: ok
            ? `Clicked #bigCookie (cookies ${fmt(before.cookies)} → ${fmt(after.cookies)})`
            : `Clicked #bigCookie but cookies did not increase (${fmt(before.cookies)} → ${fmt(after.cookies)})`,
        };
      }

      if (action === 'wait_1s' || action === 'wait_5s') {
        const ms = action === 'wait_1s' ? 1000 : 5000;
        await page.waitForTimeout(ms);
        const after = await this.readMeters();
        return {
          ok: true,
          message: `Waited ${ms / 1000}s (cookies ${fmt(before.cookies)} → ${fmt(after.cookies)})`,
        };
      }

      if (action === 'stop') {
        return { ok: true, message: 'Stop requested' };
      }

      const buildingMatch = /^buy_building_(\d+)$/.exec(action);
      if (buildingMatch) {
        const id = buildingMatch[1] ?? '';
        const sel = `#product${id}`;
        const product = page.locator(sel);
        const className = (await product.getAttribute('class')) ?? '';
        if (!className.includes('enabled')) {
          return { ok: false, message: `${sel} is not affordable (class "${className}")` };
        }
        await product.click({ timeout: 5_000 });
        await page.waitForTimeout(200);
        const after = await this.readMeters();
        const beforeAmount = before.buildingAmounts[id] ?? 0;
        const afterAmount = after.buildingAmounts[id] ?? 0;
        const ok = afterAmount > beforeAmount;
        return {
          ok,
          message: ok
            ? `Bought ${sel} (owned ${beforeAmount} → ${afterAmount}, cookies ${fmt(before.cookies)} → ${fmt(after.cookies)})`
            : `Clicked ${sel} but owned count stayed ${beforeAmount}`,
        };
      }

      const upgradeMatch = /^buy_upgrade_(\d+)$/.exec(action);
      if (upgradeMatch) {
        const id = Number(upgradeMatch[1]);
        const sel = `#upgrade${id}`;
        const upgrade = page.locator(sel);
        const className = (await upgrade.getAttribute('class')) ?? '';
        if (!className.includes('enabled')) {
          return { ok: false, message: `${sel} is not affordable (class "${className}")` };
        }
        await upgrade.click({ timeout: 5_000 });
        await page.waitForTimeout(200);
        const after = await this.readMeters();
        const ok = !after.enabledUpgrades.includes(id);
        return {
          ok,
          message: ok
            ? `Bought ${sel} (cookies ${fmt(before.cookies)} → ${fmt(after.cookies)})`
            : `Clicked ${sel} but it is still enabled`,
        };
      }

      return { ok: false, message: `Unknown action: ${action}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Act failed (${action}): ${msg}` };
    }
  }

  private async readMeters(): Promise<Meters> {
    const page = this.requirePage();
    return page.evaluate(() => {
      const game = (
        window as unknown as {
          Game?: {
            cookies?: number;
            ObjectsById?: Array<{ id: number; amount: number } | undefined>;
          };
        }
      ).Game;
      const buildingAmounts: Record<string, number> = {};
      for (const obj of game?.ObjectsById ?? []) {
        if (!obj) continue;
        buildingAmounts[String(obj.id)] = obj.amount;
      }
      const enabledUpgrades: number[] = [];
      document.querySelectorAll('#upgrades .crate.upgrade.enabled').forEach((el) => {
        const dataId = el.getAttribute('data-id');
        const id = dataId != null ? Number(dataId) : Number(el.id.replace(/^upgrade/, ''));
        if (Number.isInteger(id)) enabledUpgrades.push(id);
      });
      return {
        cookies: game?.cookies ?? 0,
        buildingAmounts,
        enabledUpgrades,
      };
    });
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    await browser.close();
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error('Browser not launched. Call launch() first.');
    }
    return this.page;
  }
}

class CloudflareBlockedError extends Error {
  constructor() {
    super(
      'Cookie Clicker is showing a Cloudflare check, which blocks headless Chromium. ' +
        'Run on a machine with a display and leave HEADLESS unset, or set HEADLESS=false.',
    );
    this.name = 'CloudflareBlockedError';
  }
}

/** Aliases so the in-page script stays valid TS without importing types into the browser. */
type ObservationBuildings = Observation['buildings'];
type ObservationUpgrades = Observation['upgrades'];
type ObservationPriced = Observation['nextLockedBuilding'];

function fmt(n: number): string {
  return n.toFixed(1);
}
