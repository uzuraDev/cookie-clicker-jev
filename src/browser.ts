import { chromium, type Browser, type Page } from 'playwright';
import type { ActResult, GameState } from './types.js';

const GAME_URL = 'https://orteil.dashnet.org/cookieclicker/';

type CookieGame = {
  cookies: number;
  cookiesPs: number;
  ObjectsById?: Array<{
    id: number;
    name: string;
    amount: number;
    price: number;
    locked: boolean;
    bulkPrice?: number;
  }>;
  UpgradesById?: Array<{
    id: number;
    name: string;
    unlocked: boolean;
    bought: boolean;
    canBuy: () => boolean;
    getPrice: () => number;
  }>;
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
    this.page = await context.newPage();
    await this.page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await this.dismissOverlays();
    await this.page.waitForSelector('#bigCookie', { timeout: 60_000 });
    await this.page.waitForTimeout(1500);
  }

  /** Dismiss language picker, cookie consent, update notes if present. */
  private async dismissOverlays(): Promise<void> {
    const page = this.requirePage();

    const langEn = page.locator('#langSelect-EN');
    try {
      if (await langEn.isVisible({ timeout: 5000 })) {
        await langEn.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      /* ignore */
    }

    const dismissSelectors = [
      '#noteClose',
      '.note .close',
      '#promptClose',
      '#cookieConsentClose',
      'a.cc_btn_accept_all',
      '.cc-dismiss',
      '#onesignal-slidedown-cancel-button',
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
        const up = g?.UpgradesById?.[id];
        const price = up?.getPrice?.() ?? 0;
        upgrades.push({
          id,
          name: up?.name ?? `upgrade_${id}`,
          price,
          affordable: true,
        });
      });

      if (upgrades.length === 0 && g?.UpgradesById) {
        for (const up of g.UpgradesById) {
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
        await page.locator('#bigCookie').click({ timeout: 5000 });
        return { ok: true, message: 'Clicked #bigCookie' };
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
        const id = buildingMatch[1];
        const sel = `#product${id}`;
        await page.locator(sel).click({ timeout: 5000 });
        return { ok: true, message: `Clicked ${sel}` };
      }

      const upgradeMatch = /^buy_upgrade_(\d+)$/.exec(action);
      if (upgradeMatch) {
        const id = upgradeMatch[1];
        const byId = page.locator(`#upgrade${id}`);
        if (await byId.count()) {
          await byId.click({ timeout: 5000 });
          return { ok: true, message: `Clicked #upgrade${id}` };
        }
        const byData = page.locator(
          `#upgrades .crate.upgrade[data-id="${id}"]`,
        );
        await byData.first().click({ timeout: 5000 });
        return { ok: true, message: `Clicked upgrade data-id=${id}` };
      }

      return { ok: false, message: `Unknown action: ${action}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Act failed (${action}): ${msg}` };
    }
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
