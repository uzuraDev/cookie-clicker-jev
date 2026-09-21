import { chromium, type Browser, type Page } from 'playwright';
import {
  armSpeedrun,
  performAscend,
  readAscendProgress,
  readSpeedrunSnapshot,
  stopSpeedrunFarmer,
} from './speedrun/ingame.js';
import type { ActResult, AscendAttempt, AscendProgress, GameState, SpeedrunSnapshot } from './types.js';

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
  /** When true, close() disconnects without quitting the user's Chrome. */
  private connectedViaCdp = false;

  async launch(): Promise<void> {
    const cdpUrl = process.env.CDP_URL?.trim();

    if (cdpUrl) {
      this.browser = await chromium.connectOverCDP(cdpUrl);
      this.connectedViaCdp = true;
      const context = this.browser.contexts()[0] ?? (await this.browser.newContext());
      await context.addInitScript(
        `try { localStorage.setItem('CookieClickerLang', 'EN'); } catch (e) {}`,
      );
      try {
        await context.addCookies([
          {
            name: 'cookieconsent_dismissed',
            value: 'yes',
            domain: 'orteil.dashnet.org',
            path: '/',
          },
        ]);
      } catch {
        /* existing context may reject cookie writes; overlays still handle consent */
      }
      const existing = context
        .pages()
        .find((pg) => pg.url().includes('orteil.dashnet.org/cookieclicker'));
      this.page = existing ?? (await context.newPage());
      if (!existing) {
        await this.page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
      }
    } else {
      const headless = process.env.HEADLESS !== 'false';
      const channel = process.env.CHROME_CHANNEL;
      this.browser = await chromium.launch({
        headless,
        ...(channel ? { channel } : {}),
        args: [
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ],
      });
      const context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
      });
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
    }

    const page = this.requirePage();
    if (
      !this.connectedViaCdp ||
      !page.url().includes('orteil.dashnet.org/cookieclicker')
    ) {
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    }
    await this.dismissOverlays();
    await page.waitForSelector('#bigCookie', { timeout: 60_000 });
    await this.waitUntilPlayable();
    // tsx/esbuild names nested functions with a `__name` helper that does not
    // exist in the page. Playwright sends the function source as-is.
    await this.installEvaluateHelpers();
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
   * Observe the game and build action candidates.
   * Prefer ids/classes over visible text (EN/JA vary).
   * Efficient mode (default) ranks buildings by cpsGain/price and offers paced farms.
   */
  async observe(): Promise<GameState> {
    const page = this.requirePage();
    await this.installEvaluateHelpers();

    const snapshot = await page.evaluate(() => {
      type G = {
        cookies: number;
        cookiesPs: number;
        computedMouseCps?: number;
        mouseCps?: () => number;
        ObjectsById?: Array<{
          id: number;
          name: string;
          amount: number;
          price: number;
          locked: boolean;
          bulkPrice?: number;
          storedCps?: number;
          cps?: (forAchievement?: boolean) => number;
          buy?: (n?: number) => void;
        } | null>;
        UpgradesById?:
          | Array<{
              id: number;
              name: string;
              unlocked: boolean;
              bought: boolean;
              canBuy: () => boolean;
              getPrice: () => number;
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
              }
            >;
      };
      const g = (window as unknown as { Game?: G }).Game;
      const cookies = g?.cookies ?? 0;
      const cps = g?.cookiesPs ?? 0;
      let clickPower = 1;
      try {
        clickPower =
          g?.computedMouseCps ??
          (typeof g?.mouseCps === 'function' ? g.mouseCps() : 1) ??
          1;
      } catch {
        clickPower = 1;
      }

      type BuildingInfo = {
        id: number;
        name: string;
        amount: number;
        price: number;
        cpsGain: number;
        efficiency: number;
        affordable: boolean;
      };
      type UpgradeInfo = { id: number; name: string; price: number };

      const allUnlocked: BuildingInfo[] = [];
      if (g?.ObjectsById) {
        for (const obj of g.ObjectsById) {
          if (!obj || obj.locked) continue;
          const price = obj.bulkPrice ?? obj.price;
          let cpsGain = 0;
          try {
            if (typeof obj.cps === 'function') cpsGain = Number(obj.cps(true)) || 0;
            else if (obj.amount > 0 && obj.storedCps) cpsGain = obj.storedCps / obj.amount;
            else cpsGain = Number(obj.storedCps) || 0;
          } catch {
            cpsGain = 0;
          }
          const efficiency = price > 0 ? cpsGain / price : 0;
          allUnlocked.push({
            id: obj.id,
            name: obj.name,
            amount: obj.amount,
            price,
            cpsGain,
            efficiency,
            affordable: cookies >= price,
          });
        }
      }

      const buildings = allUnlocked
        .filter((b) => b.affordable)
        .sort((a, b) => b.efficiency - a.efficiency);

      const nextBuildingPrice =
        allUnlocked.length === 0 ? null : Math.min(...allUnlocked.map((b) => b.price));

      const upgrades: UpgradeInfo[] = [];
      const upgradeEls = document.querySelectorAll('#upgrades .crate.upgrade.enabled');
      upgradeEls.forEach((el) => {
        const dataId = el.getAttribute('data-id');
        let id = dataId !== null ? Number(dataId) : NaN;
        if (Number.isNaN(id) && el.id) id = Number(el.id.replace(/^upgrade/, ''));
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
        upgrades.push({ id, name: up?.name ?? `upgrade_${id}`, price });
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
              });
            }
          } catch {
            /* ignore */
          }
        }
      }

      return {
        cookies,
        cps,
        clickPower,
        nextBuildingPrice,
        buildings,
        upgrades,
      };
    });

    const efficient = process.env.EFFICIENT !== 'false';
    const candidates: Record<string, string> = {};

    if (!efficient) {
      candidates.click_cookie = 'Click the big cookie once (#bigCookie)';
      candidates.wait_1s = 'Wait 1 second (let cookies accumulate)';
      candidates.wait_5s = 'Wait 5 seconds (let cookies accumulate)';
    }

    for (const u of snapshot.upgrades) {
      candidates[`buy_upgrade_${u.id}`] =
        `BUY UPGRADE first if useful: "${u.name}" price=${Math.round(u.price)} (usually high priority)`;
    }

    const topBuildings = snapshot.buildings.slice(0, 5);
    for (const b of topBuildings) {
      const payback = b.cpsGain > 0 ? b.price / b.cpsGain : Number.POSITIVE_INFINITY;
      candidates[`buy_building_${b.id}`] =
        `Buy "${b.name}" id=${b.id} owned=${b.amount} price=${Math.round(b.price)} cps+${b.cpsGain.toFixed(3)} efficiency=${b.efficiency.toExponential(3)} payback≈${Number.isFinite(payback) ? payback.toFixed(1) + 's' : 'n/a'}`;
    }

    if (efficient) {
      candidates.farm_clicks_50 =
        'Rapid-click the big cookie 50 times (farm toward next purchase)';
      candidates.farm_clicks_200 = 'Rapid-click the big cookie 200 times (bulk farm)';
      if (snapshot.nextBuildingPrice != null && snapshot.cookies < snapshot.nextBuildingPrice) {
        const need = snapshot.nextBuildingPrice - snapshot.cookies;
        const clicks = Math.max(1, Math.ceil(need / Math.max(snapshot.clickPower, 0.01)));
        candidates.farm_to_next = `Farm clicks until next building (~${Math.round(snapshot.nextBuildingPrice)} cookies; need ~${Math.round(need)}, ~${clicks} clicks at ${snapshot.clickPower.toFixed(2)}/click)`;
      }
    } else {
      for (const b of snapshot.buildings) {
        if (candidates[`buy_building_${b.id}`]) continue;
        candidates[`buy_building_${b.id}`] =
          `Buy building id=${b.id} "${b.name}" (owned ${b.amount}, price ~${Math.round(b.price)})`;
      }
    }

    candidates.stop = 'Stop the bot loop (done)';

    const buildingList =
      snapshot.buildings.length === 0
        ? 'none'
        : snapshot.buildings
            .slice(0, 5)
            .map(
              (b) =>
                `#${b.id} ${b.name}@${Math.round(b.price)} eff=${b.efficiency.toExponential(2)}`,
            )
            .join(', ');
    const upgradeList =
      snapshot.upgrades.length === 0
        ? 'none'
        : snapshot.upgrades.map((u) => `#${u.id} ${u.name}@${Math.round(u.price)}`).join(', ');

    const summary = `cookies=${snapshot.cookies.toFixed(1)} cps=${snapshot.cps.toFixed(2)} click=${snapshot.clickPower.toFixed(2)} next=${snapshot.nextBuildingPrice ?? '—'} | buys: ${buildingList} | upgrades: ${upgradeList}`;

    return {
      cookies: snapshot.cookies,
      cps: snapshot.cps,
      clickPower: snapshot.clickPower,
      nextBuildingPrice: snapshot.nextBuildingPrice,
      buildings: snapshot.buildings,
      upgrades: snapshot.upgrades,
      summary,
      candidates,
    };
  }

  async act(action: string): Promise<ActResult> {
    const page = this.requirePage();
    await this.installEvaluateHelpers();

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
          await page.locator('#bigCookie').click({ timeout: 5000, force: true });
        }
        return { ok: true, message: viaApi ? 'Game.ClickCookie()' : 'Clicked #bigCookie' };
      }

      const farmMatch = /^farm_clicks_(\d+)$/.exec(action);
      if (farmMatch) {
        // Cookie Clicker ignores inhuman click rates; pace ~12 clicks/sec.
        const n = Math.min(Number(farmMatch[1]), 240);
        let clicks = 0;
        for (let i = 0; i < n; i++) {
          const ok = await page.evaluate(() => {
            const g = (window as unknown as { Game?: CookieGame }).Game;
            if (!g?.ClickCookie) return false;
            g.ClickCookie();
            return true;
          });
          if (!ok) break;
          clicks++;
          await page.waitForTimeout(80);
        }
        const cookies = await page.evaluate(() => {
          return (window as unknown as { Game?: CookieGame }).Game?.cookies ?? 0;
        });
        return {
          ok: clicks > 0,
          message: `Farm-clicked ${clicks} paced → ${cookies.toFixed(1)} cookies`,
        };
      }

      if (action === 'farm_to_next') {
        // Mix paced clicks + idle CPS until the next cheapest building is affordable.
        const farmMs = Number(process.env.FARM_MS ?? '8000');
        const started = Date.now();
        let clicks = 0;
        const target = await page.evaluate(() => {
          const g = (
            window as unknown as {
              Game?: CookieGame & {
                ObjectsById?: Array<{
                  locked: boolean;
                  price: number;
                  bulkPrice?: number;
                } | null>;
              };
            }
          ).Game;
          let t = Number.POSITIVE_INFINITY;
          if (g?.ObjectsById) {
            for (const obj of g.ObjectsById) {
              if (!obj || obj.locked) continue;
              const price = obj.bulkPrice ?? obj.price;
              if (price < t) t = price;
            }
          }
          return Number.isFinite(t) ? t : 0;
        });

        while (Date.now() - started < farmMs) {
          const status = await page.evaluate((tgt) => {
            const g = (window as unknown as { Game?: CookieGame }).Game;
            if (!g) return { cookies: 0, done: true };
            if (g.cookies >= tgt) return { cookies: g.cookies, done: true };
            if (g.ClickCookie) g.ClickCookie();
            return { cookies: g.cookies, done: false };
          }, target);
          if (status.done) {
            return {
              ok: true,
              message: `Farm-to-next done: ${clicks} clicks → ${status.cookies.toFixed(1)} (target ${target})`,
            };
          }
          clicks++;
          // ~12 clicks/sec stays above the ~67ms Uncanny threshold and the 20ms discard floor.
          await page.waitForTimeout(80);
        }

        const cookies = await page.evaluate(() => {
          return (window as unknown as { Game?: CookieGame }).Game?.cookies ?? 0;
        });
        return {
          ok: true,
          message: `Farm-to-next partial: ${clicks} clicks → ${cookies.toFixed(1)} / ${target} in ${farmMs}ms`,
        };
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

  /**
   * Same outcome as confirming both Wipe Save prompts: `Game.HardReset(2)`.
   * This deletes the save in the current page (ephemeral for a launched
   * browser; the attached profile when `CDP_URL` is set).
   */
  async wipeSave(): Promise<void> {
    await this.installEvaluateHelpers();
    const page = this.requirePage();
    const wiped = await page.evaluate(() => {
      const g = (window as unknown as { Game?: { HardReset?: (bypass?: number) => void } }).Game;
      if (!g?.HardReset) return false;
      g.HardReset(2);
      return true;
    });
    if (!wiped) throw new Error('Game.HardReset is not available');
  }

  /** Fresh run can accept clicks (`Game.T >= 3`, nothing baked, not ascending). */
  async waitUntilFreshRun(): Promise<void> {
    const page = this.requirePage();
    await page.waitForFunction(
      () => {
        const g = (
          window as unknown as {
            Game?: {
              ready?: boolean;
              OnAscend?: number;
              AscendTimer?: number;
              cookiesEarned?: number;
              prestige?: number;
              T?: number;
            };
          }
        ).Game;
        if (!g || g.ready === false) return false;
        if (g.OnAscend) return false;
        if ((g.AscendTimer ?? 0) > 0) return false;
        if ((g.cookiesEarned ?? 1) >= 1) return false;
        if ((g.prestige ?? 1) !== 0) return false;
        return (g.T ?? 0) >= 3;
      },
      undefined,
      { timeout: 30_000 },
    );
  }

  /** Start the in-page clock, click loop, and golden-cookie popper. */
  async armSpeedrun(clickIntervalMs: number): Promise<{ t0: number; version: string }> {
    await this.installEvaluateHelpers();
    const page = this.requirePage();
    return page.evaluate(armSpeedrun, clickIntervalMs);
  }

  async stopSpeedrunFarmer(): Promise<void> {
    await this.installEvaluateHelpers();
    const page = this.requirePage();
    await page.evaluate(stopSpeedrunFarmer);
  }

  async readSpeedrunSnapshot(): Promise<SpeedrunSnapshot> {
    await this.installEvaluateHelpers();
    const page = this.requirePage();
    return page.evaluate(readSpeedrunSnapshot);
  }

  async performAscend(): Promise<AscendAttempt> {
    await this.installEvaluateHelpers();
    const page = this.requirePage();
    return page.evaluate(performAscend);
  }

  async readAscendProgress(): Promise<AscendProgress> {
    await this.installEvaluateHelpers();
    const page = this.requirePage();
    return page.evaluate(readAscendProgress);
  }

  async close(): Promise<void> {
    if (this.connectedViaCdp) {
      // Leave the user's real Chrome running. KEEP_TAB=true keeps Cookie Clicker open.
      const keepTab = process.env.KEEP_TAB !== 'false';
      if (!keepTab) {
        try {
          if (this.page && !this.page.isClosed()) {
            await this.page.close();
          }
        } catch {
          /* ignore */
        }
      }
      try {
        await this.browser?.close(); // disconnects CDP; does not quit Chrome
      } catch {
        /* ignore */
      }
      this.browser = null;
      this.page = null;
      this.connectedViaCdp = false;
      return;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * `__name(fn, "name")` is injected by the TypeScript loader. It must return
   * `fn`, because the page script uses the return value.
   */
  private async installEvaluateHelpers(): Promise<void> {
    await this.requirePage().evaluate('globalThis.__name = (fn) => fn');
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error('Browser not launched. Call launch() first.');
    }
    return this.page;
  }
}
