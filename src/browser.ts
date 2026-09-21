import { chromium, type Browser, type Page } from 'playwright';
import type { ActResult, GameState } from './types.js';

const GAME_URL = 'https://orteil.dashnet.org/cookieclicker/';

type CookieGame = {
  cookies: number;
  cookiesPs: number;
  ready?: boolean;
  /** 1 = buy, -1 = sell. `Object.buy` sells when this is -1. */
  buyMode?: number;
  ObjectsById?: Array<{
    id: number;
    name: string;
    amount: number;
    price: number;
    locked: boolean;
    bulkPrice?: number;
    buy?: (amount?: number) => number | void;
  } | null>;
  UpgradesById?:
    | Array<{
        id: number;
        name: string;
        unlocked: boolean;
        bought: boolean;
        canBuy: () => boolean;
        getPrice: () => number;
        buy?: (bypass?: boolean) => number;
      } | null>
    | Record<
        string,
        {
          id: number;
          name: string;
          unlocked: boolean;
          bought: boolean;
          canBuy: () => boolean;
          getPrice: () => number;
          buy?: (bypass?: boolean) => number;
        }
      >;
  ClickCookie?: () => void;
};

export class CookieClickerBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async launch(): Promise<void> {
    const headless = process.env.HEADLESS !== 'false';
    this.browser = await chromium.launch({ headless });
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
    });
    // Preset English and the consent cookie so the game does not reload
    // (a reload is often stopped by Cloudflare) and so we never click the
    // consent link, which is `<a target="_blank">`.
    await context.addInitScript(
      `try { localStorage.setItem('CookieClickerLang', 'EN'); } catch (e) {}`,
    );
    await context.addCookies([
      {
        name: 'cookieconsent_dismissed',
        value: 'yes',
        domain: 'orteil.dashnet.org',
        path: '/',
      },
    ]);
    this.page = await context.newPage();
    await this.page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await this.dismissOverlays();
    await this.page.waitForSelector('#bigCookie', { timeout: 60_000 });
    await this.waitUntilPlayable();
  }

  /** Dismiss language picker, cookie consent, update notes if present. */
  private async dismissOverlays(): Promise<void> {
    const page = this.requirePage();

    // Remove the consent banner in-page. Its "Got it!" control is an anchor
    // with target=_blank, so a Playwright click leaves Cookie Clicker.
    // Close every stacked note. Do not click #prefsButton — that opens Options.
    await page.evaluate(() => {
      document
        .querySelectorAll('.cc_banner-wrapper, .cc_container')
        .forEach((el) => el.remove());
      document.querySelectorAll('#notes .note .close').forEach((el) => {
        (el as HTMLElement).click();
      });
    });

    const langEn = page.locator('#langSelect-EN');
    try {
      if (await langEn.isVisible({ timeout: 1000 })) {
        await langEn.click();
        await page.waitForTimeout(2000);
      }
    } catch {
      /* ignore */
    }

    const dismissSelectors = [
      '#noteClose',
      '.note .close',
      '#promptClose',
      '#cookieConsentClose',
      '.cc-dismiss',
      '#onesignal-slidedown-cancel-button',
      '#offGameMessage a',
      '#offGameMessageClose',
    ];
    for (const sel of dismissSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 400 })) {
          await el.click({ timeout: 1000 });
          await page.waitForTimeout(300);
        }
      } catch {
        /* ignore */
      }
    }
  }

  /** Wait until loader/darken are gone and Game is ready. */
  private async waitUntilPlayable(): Promise<void> {
    const page = this.requirePage();
    // Playwright signature: waitForFunction(fn, arg?, options?)
    await page.waitForFunction(
      () => {
        const g = (window as unknown as { Game?: { ready?: boolean; cookies?: number } }).Game;
        if (!g) return false;
        // Cookie Clicker sets Game.ready when fully loaded
        if (g.ready === false) return false;
        const loader = document.getElementById('loader');
        if (loader) {
          const s = getComputedStyle(loader);
          if (s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05) {
            return false;
          }
        }
        const wrap = document.getElementById('offGameMessageWrap');
        if (wrap) {
          const s = getComputedStyle(wrap);
          if (s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05) {
            // Still showing boot message — not playable yet
            return false;
          }
        }
        return typeof g.cookies === 'number';
      },
      undefined,
      { timeout: 120_000 },
    );
    // Hide leftover darken via CSS if stuck (non-interactive)
    await page.evaluate(() => {
      const darken = document.getElementById('darken');
      if (darken) {
        darken.style.display = 'none';
        darken.style.pointerEvents = 'none';
      }
      const wrap = document.getElementById('offGameMessageWrap');
      if (wrap) {
        wrap.style.display = 'none';
        wrap.style.pointerEvents = 'none';
      }
    });
    await page.waitForTimeout(500);
    await this.dismissOverlays();
  }

  /**
   * Observe DOM and build numbered action candidates.
   * Prefer ids/classes over visible text (EN/JA vary).
   */
  async observe(): Promise<GameState> {
    const page = this.requirePage();

    const snapshot = await page.evaluate(() => {
      const g = (window as unknown as { Game?: CookieGame }).Game;

      const cookies = g?.cookies ?? 0;
      const cps = g?.cookiesPs ?? 0;

      type BuildingInfo = {
        id: number;
        name: string;
        amount: number;
        price: number;
        affordable: boolean;
      };
      type UpgradeInfo = {
        id: number;
        name: string;
        price: number;
        affordable: boolean;
      };

      const buildings: BuildingInfo[] = [];
      const productEls = document.querySelectorAll(
        '#products .product.unlocked.enabled',
      );
      productEls.forEach((el) => {
        const idAttr = el.id?.replace(/^product/, '');
        const id = idAttr !== undefined && idAttr !== '' ? Number(idAttr) : NaN;
        if (Number.isNaN(id)) return;
        const obj = g?.ObjectsById?.[id];
        const price =
          obj?.bulkPrice ??
          obj?.price ??
          Number(
            el.querySelector('.price')?.textContent?.replace(/[^0-9.]/g, '') ??
              0,
          );
        buildings.push({
          id,
          name: obj?.name ?? `building_${id}`,
          amount: obj?.amount ?? 0,
          price,
          affordable: true,
        });
      });

      if (buildings.length === 0 && g?.ObjectsById) {
        for (const obj of g.ObjectsById) {
          if (!obj || obj.locked) continue;
          const price = obj.bulkPrice ?? obj.price;
          if (cookies >= price) {
            buildings.push({
              id: obj.id,
              name: obj.name,
              amount: obj.amount,
              price,
              affordable: true,
            });
          }
        }
      }

      const upgrades: UpgradeInfo[] = [];
      const upgradeEls = document.querySelectorAll(
        '#upgrades .crate.upgrade.enabled',
      );
      upgradeEls.forEach((el) => {
        const dataId = el.getAttribute('data-id');
        let id = dataId !== null ? Number(dataId) : NaN;
        if (Number.isNaN(id) && el.id) {
          id = Number(el.id.replace(/^upgrade/, ''));
        }
        if (Number.isNaN(id)) return;
        const up = Array.isArray(g?.UpgradesById)
          ? g?.UpgradesById?.[id]
          : g?.UpgradesById?.[String(id)];
        let price = 0;
        try {
          price = up?.getPrice?.() ?? 0;
        } catch {
          price = 0;
        }
        upgrades.push({
          id,
          name: up?.name ?? `upgrade_${id}`,
          price,
          affordable: true,
        });
      });

      if (upgrades.length === 0 && g?.UpgradesById) {
        const list = Array.isArray(g.UpgradesById)
          ? g.UpgradesById
          : Object.values(g.UpgradesById);
        for (const up of list) {
          if (!up || !up.unlocked || up.bought) continue;
          try {
            if (up.canBuy()) {
              upgrades.push({
                id: up.id,
                name: up.name,
                price: up.getPrice(),
                affordable: true,
              });
            }
          } catch {
            /* ignore */
          }
        }
      }

      return { cookies, cps, buildings, upgrades };
    });

    const candidates: Record<string, string> = {
      click_cookie: 'Click the big cookie once (#bigCookie)',
      wait_1s: 'Wait 1 second (let cookies accumulate)',
      wait_5s: 'Wait 5 seconds (let cookies accumulate)',
    };

    for (const b of snapshot.buildings) {
      candidates[`buy_building_${b.id}`] =
        `Buy building id=${b.id} "${b.name}" (owned ${b.amount}, price ~${Math.round(b.price)})`;
    }
    for (const u of snapshot.upgrades) {
      candidates[`buy_upgrade_${u.id}`] =
        `Buy upgrade id=${u.id} "${u.name}" (price ~${Math.round(u.price)})`;
    }
    candidates.stop = 'Stop the bot loop (done)';

    const buildingList =
      snapshot.buildings.length === 0
        ? 'none'
        : snapshot.buildings
            .map((b) => `#${b.id} ${b.name}@${Math.round(b.price)}`)
            .join(', ');
    const upgradeList =
      snapshot.upgrades.length === 0
        ? 'none'
        : snapshot.upgrades
            .map((u) => `#${u.id} ${u.name}@${Math.round(u.price)}`)
            .join(', ');

    const summary = `cookies=${snapshot.cookies.toFixed(1)} cps=${snapshot.cps.toFixed(2)} | buildings: ${buildingList} | upgrades: ${upgradeList}`;

    return {
      cookies: snapshot.cookies,
      cps: snapshot.cps,
      summary,
      candidates,
    };
  }

  async act(action: string): Promise<ActResult> {
    const page = this.requirePage();

    try {
      if (action === 'click_cookie') {
        // Prefer Game API — overlays often intercept locator clicks during boot
        const viaApi = await page.evaluate(() => {
          const g = (window as unknown as { Game?: CookieGame }).Game;
          if (g?.ClickCookie) {
            g.ClickCookie();
            return true;
          }
          return false;
        });
        if (!viaApi) {
          await page
            .locator('#bigCookie')
            .click({ timeout: 5000, force: true });
        }
        return { ok: true, message: viaApi ? 'Game.ClickCookie()' : 'Clicked #bigCookie' };
      }

      if (action === 'wait_1s') {
        await page.waitForTimeout(1000);
        return { ok: true, message: 'Waited 1s' };
      }

      if (action === 'wait_5s') {
        await page.waitForTimeout(5000);
        return { ok: true, message: 'Waited 5s' };
      }

      if (action === 'stop') {
        return { ok: true, message: 'Stop requested' };
      }

      const buildingMatch = /^buy_building_(\d+)$/.exec(action);
      if (buildingMatch) {
        const id = Number(buildingMatch[1]);
        if (!Number.isInteger(id)) {
          return { ok: false, message: `Bad building id: ${action}` };
        }
        return this.buyBuilding(id);
      }

      const upgradeMatch = /^buy_upgrade_(\d+)$/.exec(action);
      if (upgradeMatch) {
        const id = Number(upgradeMatch[1]);
        if (!Number.isInteger(id)) {
          return { ok: false, message: `Bad upgrade id: ${action}` };
        }
        return this.buyUpgrade(id);
      }

      return { ok: false, message: `Unknown action: ${action}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Act failed (${action}): ${msg}` };
    }
  }

  /**
   * Buy one building with ObjectsById[id].buy(1), the same idea as
   * Game.ClickCookie: the store row is often covered, and a forced DOM click
   * does not tell us whether the purchase happened. `buy()` returns void, so
   * success is an increased owned count.
   */
  private async buyBuilding(id: number): Promise<ActResult> {
    const page = this.requirePage();
    const sel = `#product${id}`;
    const attempt = await page.evaluate((buildingId) => {
      const g = (window as unknown as { Game?: CookieGame }).Game;
      const obj = g?.ObjectsById?.[buildingId];
      if (!g || !obj) return { status: 'missing' as const, amount: 0, name: '' };
      if (g.buyMode === -1) return { status: 'sell' as const, amount: obj.amount, name: obj.name };
      if (obj.locked) return { status: 'locked' as const, amount: obj.amount, name: obj.name };
      const price = obj.bulkPrice ?? obj.price;
      if (g.cookies < price) {
        return { status: 'poor' as const, amount: obj.amount, name: obj.name };
      }
      const before = obj.amount;
      if (typeof obj.buy !== 'function') {
        return { status: 'noapi' as const, amount: before, name: obj.name };
      }
      obj.buy(1);
      return {
        status: 'done' as const,
        amount: obj.amount,
        before,
        name: obj.name,
      };
    }, id);

    if (attempt.status === 'missing') return { ok: false, message: `No building ${sel}` };
    if (attempt.status === 'sell') {
      return { ok: false, message: 'Store is in Sell mode; not buying' };
    }
    if (attempt.status === 'locked') return { ok: false, message: `${sel} is still locked` };
    if (attempt.status === 'poor') return { ok: false, message: `${sel} is not affordable` };
    if (attempt.status === 'done') {
      const before = attempt.before;
      const ok = attempt.amount > before;
      return {
        ok,
        message: ok
          ? `Bought ${sel} "${attempt.name}" (owned ${before} → ${attempt.amount})`
          : `${sel} buy() left owned at ${attempt.amount}`,
      };
    }

    await page.locator(sel).click({ timeout: 5000, force: true });
    const amount = await page.evaluate((buildingId) => {
      return (
        (window as unknown as { Game?: CookieGame }).Game?.ObjectsById?.[buildingId]
          ?.amount ?? 0
      );
    }, id);
    const ok = amount > attempt.amount;
    return {
      ok,
      message: ok
        ? `Clicked ${sel} (owned ${attempt.amount} → ${amount})`
        : `Clicked ${sel} but owned stayed ${amount}`,
    };
  }

  /**
   * Buy one upgrade with UpgradesById[id].buy(). The crate can stay
   * visually `enabled` until the next draw, so success is the bought flag
   * (buy() also returns 1).
   */
  private async buyUpgrade(id: number): Promise<ActResult> {
    const page = this.requirePage();
    const sel = `#upgrade${id}`;
    const attempt = await page.evaluate((upgradeId) => {
      const g = (window as unknown as { Game?: CookieGame }).Game;
      const list = g?.UpgradesById;
      const up = !list
        ? undefined
        : Array.isArray(list)
          ? list[upgradeId]
          : list[String(upgradeId)];
      if (!g || !up) return { status: 'missing' as const, name: '' };
      if (up.bought) return { status: 'have' as const, name: up.name };
      let affordable = false;
      try {
        affordable = up.canBuy();
      } catch {
        affordable = false;
      }
      if (!affordable) return { status: 'poor' as const, name: up.name };
      if (typeof up.buy !== 'function') return { status: 'noapi' as const, name: up.name };
      const result = up.buy();
      return {
        status: 'done' as const,
        name: up.name,
        ok: result === 1 || Boolean(up.bought),
      };
    }, id);

    if (attempt.status === 'missing') return { ok: false, message: `No upgrade ${sel}` };
    if (attempt.status === 'have') return { ok: false, message: `${sel} is already bought` };
    if (attempt.status === 'poor') {
      return { ok: false, message: `${sel} "${attempt.name}" is not affordable` };
    }
    if (attempt.status === 'done') {
      return {
        ok: attempt.ok === true,
        message:
          attempt.ok === true
            ? `Bought ${sel} "${attempt.name}"`
            : `${sel} buy() did not purchase "${attempt.name}"`,
      };
    }

    const byId = page.locator(sel);
    if (await byId.count()) {
      await byId.click({ timeout: 5000, force: true });
    } else {
      await page
        .locator(`#upgrades .crate.upgrade[data-id="${id}"]`)
        .first()
        .click({ timeout: 5000, force: true });
    }
    const bought = await page.evaluate((upgradeId) => {
      const list = (window as unknown as { Game?: CookieGame }).Game?.UpgradesById;
      const up = !list
        ? undefined
        : Array.isArray(list)
          ? list[upgradeId]
          : list[String(upgradeId)];
      return Boolean(up?.bought);
    }, id);
    return {
      ok: bought,
      message: bought ? `Clicked ${sel}` : `Clicked ${sel} but it is still unbought`,
    };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error('Browser not launched. Call launch() first.');
    }
    return this.page;
  }
}
