/**
 * These functions run inside the Cookie Clicker page via Playwright `evaluate`.
 * They must be self-contained: Playwright serializes the function body only.
 */

export type ArmedRun = {
  t0: number;
  version: string;
  clickIntervalMs: number;
};

/** Start the realtime clock, mute click audio, and farm clicks + shimmers. */
export function armSpeedrun(clickIntervalMs: number): ArmedRun {
  const w = window as Window & {
    Game?: Record<string, unknown>;
    __cc1hc?: {
      t0: number;
      gcClicks: number;
      stopped: boolean;
      timer: number;
      clickIntervalMs: number;
      pop: () => number;
    };
  };
  const g = w.Game;
  if (!g || typeof g.ClickCookie !== 'function') {
    throw new Error('Cookie Clicker is not ready to arm');
  }

  const previous = w.__cc1hc;
  if (previous?.timer) window.clearInterval(previous.timer);

  const prefs = g.prefs as Record<string, number> | undefined;
  g.volume = 0;
  g.volumeMusic = 0;
  g.buyBulk = 1;
  g.buyMode = 1;
  if (prefs) {
    prefs.particles = 0;
    prefs.numbers = 0;
    prefs.notifs = 1;
  }

  const state = {
    t0: previous?.t0 ?? Date.now(),
    gcClicks: previous?.gcClicks ?? 0,
    stopped: false,
    timer: 0,
    clickIntervalMs,
    pop: (): number => 0,
  };

  const pop = (): number => {
    const game = w.Game;
    if (!game) return 0;
    let popped = 0;
    const shimmers = game.shimmers as Array<{ type?: string; popped?: boolean; pop?: () => void }> | undefined;
    if (shimmers && shimmers.length) {
      for (let i = shimmers.length - 1; i >= 0; i--) {
        const shimmer = shimmers[i];
        if (!shimmer || shimmer.popped) continue;
        if (shimmer.type !== 'golden' && shimmer.type !== 'reindeer') continue;
        if (typeof shimmer.pop === 'function') {
          shimmer.pop();
          popped++;
        }
      }
    } else {
      const el = document.querySelector('.shimmer');
      if (el instanceof HTMLElement) {
        el.click();
        popped++;
      }
    }
    if (popped > 0) state.gcClicks += popped;
    return popped;
  };
  state.pop = pop;

  const minGap = 21;
  state.timer = window.setInterval(() => {
    const game = w.Game;
    if (!game || state.stopped) return;
    if (game.OnAscend || (typeof game.AscendTimer === 'number' && game.AscendTimer > 0)) return;
    pop();
    const buffs = game.buffs as Record<string, { multClick?: number; name?: string }> | undefined;
    let clickBuff = false;
    if (buffs) {
      for (const key of Object.keys(buffs)) {
        const buff = buffs[key];
        if (!buff) continue;
        if (buff.name === 'Cursed finger' || (typeof buff.multClick === 'number' && buff.multClick > 1)) {
          clickBuff = true;
          break;
        }
      }
    }
    const gap = clickBuff ? minGap : Math.max(minGap, state.clickIntervalMs);
    const lastClick = typeof game.lastClick === 'number' ? game.lastClick : 0;
    if (Date.now() - lastClick >= gap && typeof game.ClickCookie === 'function') {
      (game.ClickCookie as () => void)();
    }
  }, 5);

  w.__cc1hc = state;
  return {
    t0: state.t0,
    version: String(g.version ?? ''),
    clickIntervalMs,
  };
}

export function stopSpeedrunFarmer(): void {
  const w = window as Window & {
    __cc1hc?: { stopped: boolean; timer?: number };
  };
  const state = w.__cc1hc;
  if (!state) return;
  state.stopped = true;
  if (state.timer) window.clearInterval(state.timer);
}

type PageSnapshot = {
  elapsedMs: number;
  version: string;
  cookies: number;
  cookiesEarned: number;
  cookiesReset: number;
  baked: number;
  cps: number;
  unbuffedCps: number;
  mouseCps: number;
  pendingPrestige: number;
  cookieClicks: number;
  gcClicks: number;
  buffs: Array<{ name: string; multCpS: number | null; multClick: number | null }>;
  buildingAmounts: Record<string, number>;
  ownedUpgrades: string[];
  options: Array<{
    key: string;
    kind: 'building' | 'upgrade';
    id: number;
    name: string;
    price: number;
    cpsDelta: number;
    mouseDelta: number;
  }>;
  catalog: Array<{ kind: 'building' | 'upgrade'; name: string; price: number }>;
  ascendIntro: boolean;
  ascending: boolean;
};

/** Observe the live game and estimate one-step CpS / click gains. Does not buy. */
export function readSpeedrunSnapshot(): PageSnapshot {
  const w = window as Window & {
    Game?: Record<string, any>;
    __cc1hc?: { t0?: number; gcClicks?: number; pop?: () => number };
  };
  const g = w.Game;
  if (!g) throw new Error('Game is not loaded');
  try {
    w.__cc1hc?.pop?.();
  } catch {
    /* a shimmer pop must not blank the snapshot */
  }

  const blocked = new Set([
    'One mind',
    'Communal brainsweep',
    'Elder Pact',
    'Elder Pledge',
    'Elder Covenant',
    'Revoke Elder Covenant',
    'Revoke Elder Pledge',
  ]);

  const buildingAmounts: Record<string, number> = {};
  const objects = (g.ObjectsById ?? []) as Array<Record<string, any> | null>;
  for (const obj of objects) {
    if (!obj) continue;
    buildingAmounts[String(obj.name)] = Number(obj.amount) || 0;
  }

  const ownedUpgrades: string[] = [];
  const upgrades = (g.Upgrades ?? {}) as Record<string, Record<string, any>>;
  for (const name of Object.keys(upgrades)) {
    if (upgrades[name]?.bought) ownedUpgrades.push(name);
  }

  const buffs: PageSnapshot['buffs'] = [];
  const rawBuffs = (g.buffs ?? {}) as Record<string, Record<string, any>>;
  for (const key of Object.keys(rawBuffs)) {
    const buff = rawBuffs[key];
    if (!buff) continue;
    buffs.push({
      name: String(buff.name ?? key),
      multCpS: typeof buff.multCpS === 'number' ? buff.multCpS : null,
      multClick: typeof buff.multClick === 'number' ? buff.multClick : null,
    });
  }

  const saved = {
    win: g.Win,
    unlock: g.Unlock,
    notify: g.Notify,
    highest: g.cookiesPsRawHighest,
  };
  const stub = () => undefined;
  g.Win = stub;
  g.Unlock = stub;
  g.Notify = stub;

  const simulate = (
    mutate: () => void,
    revert: () => void,
  ): { cpsDelta: number; mouseDelta: number } | null => {
    const beforeCps = Number(g.cookiesPs) || 0;
    const beforeMouse = Number(g.computedMouseCps) || 0;
    try {
      mutate();
      g.CalculateGains();
      return {
        cpsDelta: (Number(g.cookiesPs) || 0) - beforeCps,
        mouseDelta: (Number(g.computedMouseCps) || 0) - beforeMouse,
      };
    } catch {
      return null;
    } finally {
      try {
        revert();
      } catch {
        /* restore is best-effort */
      }
      g.cookiesPsRawHighest = saved.highest;
      try {
        g.CalculateGains();
      } catch {
        g.recalculateGains = 1;
      }
    }
  };

  const catalog: PageSnapshot['catalog'] = [];
  for (const obj of objects) {
    if (!obj || obj.locked) continue;
    let price = 0;
    try {
      price = Number(obj.getPrice());
    } catch {
      continue;
    }
    if (Number.isFinite(price)) {
      catalog.push({ kind: 'building', name: String(obj.name), price });
    }
  }
  for (const name of Object.keys(upgrades)) {
    const up = upgrades[name];
    if (!up || up.bought || !up.unlocked) continue;
    if (blocked.has(name)) continue;
    const pool = String(up.pool ?? '');
    if (pool !== '' && pool !== 'cookie' && pool !== 'tech') continue;
    let price = 0;
    try {
      price = Number(up.getPrice());
    } catch {
      continue;
    }
    if (Number.isFinite(price)) catalog.push({ kind: 'upgrade', name, price });
  }

  type RawOption = PageSnapshot['options'][number] & { sortPrice: number };
  const raw: RawOption[] = [];

  for (const obj of objects) {
    if (!obj || obj.locked) continue;
    let price = 0;
    try {
      price = Number(obj.getPrice());
    } catch {
      continue;
    }
    if (!(g.cookies >= price)) continue;
    const amount = obj.amount;
    const bought = obj.bought;
    const owned = g.BuildingsOwned;
    const delta = simulate(
      () => {
        obj.amount += 1;
        obj.bought += 1;
        g.BuildingsOwned += 1;
      },
      () => {
        obj.amount = amount;
        obj.bought = bought;
        g.BuildingsOwned = owned;
      },
    );
    if (!delta) continue;
    raw.push({
      key: `buy_building_${obj.id}`,
      kind: 'building',
      id: Number(obj.id),
      name: String(obj.name),
      price,
      cpsDelta: delta.cpsDelta,
      mouseDelta: delta.mouseDelta,
      sortPrice: price,
    });
  }

  for (const name of Object.keys(upgrades)) {
    const up = upgrades[name];
    if (!up || up.bought || !up.unlocked) continue;
    if (blocked.has(name)) continue;
    const pool = String(up.pool ?? '');
    if (pool !== '' && pool !== 'cookie' && pool !== 'tech') continue;
    let price = 0;
    let can = false;
    try {
      price = Number(up.getPrice());
      can = Boolean(up.canBuy());
    } catch {
      continue;
    }
    if (!can || !(g.cookies >= price)) continue;
    const bought = up.bought;
    const owned = g.UpgradesOwned;
    const delta = simulate(
      () => {
        up.bought = 1;
        if (typeof g.CountsAsUpgradeOwned === 'function' && g.CountsAsUpgradeOwned(up.pool)) {
          g.UpgradesOwned++;
        }
      },
      () => {
        up.bought = bought;
        g.UpgradesOwned = owned;
      },
    );
    if (!delta) continue;
    raw.push({
      key: `buy_upgrade_${up.id}`,
      kind: 'upgrade',
      id: Number(up.id),
      name,
      price,
      cpsDelta: delta.cpsDelta,
      mouseDelta: delta.mouseDelta,
      sortPrice: price,
    });
  }

  g.Win = saved.win;
  g.Unlock = saved.unlock;
  g.Notify = saved.notify;
  g.cookiesPsRawHighest = saved.highest;
  try {
    g.CalculateGains();
  } catch {
    g.recalculateGains = 1;
  }

  raw.sort((a, b) => a.sortPrice - b.sortPrice);
  const options = raw.slice(0, 30).map(({ sortPrice: _sortPrice, ...option }) => option);

  const baked = (Number(g.cookiesEarned) || 0) + (Number(g.cookiesReset) || 0);
  const pendingPrestige =
    typeof g.HowMuchPrestige === 'function' ? Math.floor(g.HowMuchPrestige(baked)) : 0;
  const gameEl = document.getElementById('game');
  const t0 = w.__cc1hc?.t0;

  return {
    elapsedMs: typeof t0 === 'number' ? Date.now() - t0 : 0,
    version: String(g.version ?? ''),
    cookies: Number(g.cookies) || 0,
    cookiesEarned: Number(g.cookiesEarned) || 0,
    cookiesReset: Number(g.cookiesReset) || 0,
    baked,
    cps: Number(g.cookiesPs) || 0,
    unbuffedCps: Number(g.unbuffedCps) || 0,
    mouseCps: Number(g.computedMouseCps) || 0,
    pendingPrestige,
    cookieClicks: Number(g.cookieClicks) || 0,
    gcClicks: Number(w.__cc1hc?.gcClicks) || 0,
    buffs,
    buildingAmounts,
    ownedUpgrades,
    options,
    catalog,
    ascendIntro: Boolean(gameEl?.classList.contains('ascendIntro')),
    ascending: Boolean(gameEl?.classList.contains('ascending')),
  };
}

export type PageAscendResult = {
  ok: boolean;
  reason: string;
  elapsedMs: number;
  baked: number;
  pendingPrestige: number;
  ascendTimer: number;
  prestige: number;
  heavenlyChips: number;
  ascendIntro: boolean;
  ascending: boolean;
};

/** Ascend only when baked cookies are worth at least one heavenly chip. */
export function performAscend(): PageAscendResult {
  const w = window as Window & {
    Game?: Record<string, any>;
    __cc1hc?: { t0?: number; stopped?: boolean; timer?: number };
  };
  const g = w.Game;
  if (!g || typeof g.Ascend !== 'function' || typeof g.HowMuchPrestige !== 'function') {
    throw new Error('Game.Ascend is not available');
  }
  const baked = (Number(g.cookiesEarned) || 0) + (Number(g.cookiesReset) || 0);
  const pendingPrestige = Math.floor(g.HowMuchPrestige(baked));
  const t0 = w.__cc1hc?.t0;
  const elapsed = () => (typeof t0 === 'number' ? Date.now() - t0 : 0);
  const gameElNow = document.getElementById('game');
  const already =
    (Number(g.AscendTimer) || 0) > 0 ||
    g.OnAscend === 1 ||
    Boolean(gameElNow?.classList.contains('ascendIntro')) ||
    Boolean(gameElNow?.classList.contains('ascending'));
  if (already && baked >= 1e12 && pendingPrestige >= 1) {
    return {
      ok: true,
      reason: 'already-ascending',
      elapsedMs: elapsed(),
      baked,
      pendingPrestige,
      ascendTimer: Number(g.AscendTimer) || 0,
      prestige: Number(g.prestige) || 0,
      heavenlyChips: Number(g.heavenlyChips) || 0,
      ascendIntro: Boolean(gameElNow?.classList.contains('ascendIntro')),
      ascending: Boolean(gameElNow?.classList.contains('ascending')),
    };
  }
  if (!(baked >= 1e12) || pendingPrestige < 1) {
    return {
      ok: false,
      reason: 'below-1hc',
      elapsedMs: elapsed(),
      baked,
      pendingPrestige,
      ascendTimer: Number(g.AscendTimer) || 0,
      prestige: Number(g.prestige) || 0,
      heavenlyChips: Number(g.heavenlyChips) || 0,
      ascendIntro: false,
      ascending: false,
    };
  }

  if (w.__cc1hc) {
    w.__cc1hc.stopped = true;
    if (w.__cc1hc.timer) window.clearInterval(w.__cc1hc.timer);
  }
  g.Ascend(1);
  const gameEl = document.getElementById('game');
  const ascendIntro = Boolean(gameEl?.classList.contains('ascendIntro'));
  const ascending = Boolean(gameEl?.classList.contains('ascending'));
  const timer = Number(g.AscendTimer) || 0;
  const note = Array.from(document.querySelectorAll('#notes .note')).some((el) =>
    /Ascend/i.test(el.textContent ?? ''),
  );
  const visible = ascendIntro || ascending || timer > 0 || note;
  return {
    ok: visible,
    reason: visible ? 'ascend-ui' : 'ascend-called-but-ui-hidden',
    elapsedMs: elapsed(),
    baked,
    pendingPrestige,
    ascendTimer: timer,
    prestige: Number(g.prestige) || 0,
    heavenlyChips: Number(g.heavenlyChips) || 0,
    ascendIntro,
    ascending,
  };
}

export type AscendProgress = {
  onAscend: boolean;
  ascending: boolean;
  ascendIntro: boolean;
  prestige: number;
  heavenlyChips: number;
  rebirth: boolean;
  fromScratch: boolean;
  baked: number;
};

export function readAscendProgress(): AscendProgress {
  const w = window as Window & { Game?: Record<string, any> };
  const g = w.Game;
  if (!g) throw new Error('Game is not loaded');
  const gameEl = document.getElementById('game');
  const achievements = (g.Achievements ?? {}) as Record<string, { won?: number }>;
  return {
    onAscend: g.OnAscend === 1,
    ascending: Boolean(gameEl?.classList.contains('ascending')),
    ascendIntro: Boolean(gameEl?.classList.contains('ascendIntro')),
    prestige: Number(g.prestige) || 0,
    heavenlyChips: Number(g.heavenlyChips) || 0,
    rebirth: Boolean(achievements.Rebirth?.won),
    fromScratch: Boolean(achievements['From scratch']?.won),
    baked: (Number(g.cookiesEarned) || 0) + (Number(g.cookiesReset) || 0),
  };
}
