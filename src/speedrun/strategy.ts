import type { BuffView, PurchaseOption } from '../types.js';

/**
 * Cookie Clicker ignores `Game.ClickCookie()` (no mouse event) when the gap
 * since `Game.lastClick` is under `1000/50` ms (20ms). 21ms is the fastest
 * gap that still counts. Faster than ~15 clicks/s (`1000/15` ms) still counts,
 * and can award Uncanny clicker; that is expected for the Fast Click category.
 */
export const MIN_CLICK_INTERVAL_MS = 21;

/**
 * Full Lucky payout is `min(15% of bank, 15 minutes of CpS)`.
 * That needs `bank >= cookiesPs * 900 / 0.15` = 6000 seconds of CpS.
 */
export const LUCKY_BANK_SECONDS = 6000;

/** 1 prestige / 1 heavenly chip. */
export const ONE_HEAVENLY_CHIP_COOKIES = 1e12;

export const GC_UPGRADE_NAMES = ['Lucky day', 'Serendipity', 'Get lucky'] as const;

/**
 * Upgrades that start the Grandmapocalypse (wrath cookies). A 1HC golden-cookie
 * route stays on normal golden cookies.
 */
export const BLOCKED_UPGRADES = new Set([
  'One mind',
  'Communal brainsweep',
  'Elder Pact',
  'Elder Pledge',
  'Elder Covenant',
  'Revoke Elder Covenant',
  'Revoke Elder Pledge',
]);

/**
 * Click and golden-cookie upgrades are under-valued by a pure building-CpS
 * ratio early on. The weight divides payback (higher = buy sooner).
 */
export const PRIORITY_GAIN_MULT: Record<string, number> = {
  'Reinforced index finger': 4,
  'Carpal tunnel prevention cream': 4,
  Ambidextrous: 4,
  'Thousand fingers': 3,
  'Million fingers': 3,
  'Billion fingers': 3,
  'Trillion fingers': 3,
  'Quadrillion fingers': 3,
  'Plastic mouse': 2.5,
  'Iron mouse': 2.5,
  'Titanium mouse': 2.5,
  'Adamantium mouse': 2.5,
  'Lucky day': 6,
  Serendipity: 6,
  'Get lucky': 6,
  'Kitten helpers': 2,
  'Kitten workers': 2,
};

export type EarlyGoal = {
  kind: 'building' | 'upgrade';
  name: string;
  /** For buildings, buy until owned reaches this. Ignored for upgrades. */
  count: number;
};

/**
 * Opening sequence for a fresh 1HC run: cursors and click upgrades first,
 * then the first grandma/farm/mine tiers. After `earlyUntilBaked`, ROI takes over.
 */
export const EARLY_ROUTE: EarlyGoal[] = [
  { kind: 'building', name: 'Cursor', count: 1 },
  { kind: 'upgrade', name: 'Reinforced index finger', count: 1 },
  { kind: 'building', name: 'Grandma', count: 1 },
  { kind: 'upgrade', name: 'Carpal tunnel prevention cream', count: 1 },
  { kind: 'building', name: 'Cursor', count: 10 },
  { kind: 'building', name: 'Grandma', count: 5 },
  { kind: 'building', name: 'Farm', count: 1 },
  { kind: 'upgrade', name: 'Forwards from grandma', count: 1 },
  { kind: 'upgrade', name: 'Ambidextrous', count: 1 },
  { kind: 'building', name: 'Cursor', count: 15 },
  { kind: 'building', name: 'Farm', count: 5 },
  { kind: 'building', name: 'Grandma', count: 15 },
  { kind: 'upgrade', name: 'Cheap hoes', count: 1 },
  { kind: 'building', name: 'Mine', count: 1 },
  { kind: 'upgrade', name: 'Sugar gas', count: 1 },
  { kind: 'building', name: 'Cursor', count: 25 },
  { kind: 'upgrade', name: 'Thousand fingers', count: 1 },
  { kind: 'upgrade', name: 'Plastic mouse', count: 1 },
  { kind: 'building', name: 'Factory', count: 1 },
  { kind: 'upgrade', name: 'Sturdier conveyor belts', count: 1 },
  { kind: 'building', name: 'Mine', count: 10 },
  { kind: 'upgrade', name: 'Steel-plated rolling pins', count: 1 },
  { kind: 'building', name: 'Cursor', count: 50 },
  { kind: 'upgrade', name: 'Million fingers', count: 1 },
];

export type StrategyConfig = {
  earlyUntilBaked: number;
  /** Buy a scripted building when its payback is within this multiple of the best other option. */
  earlySlack: number;
  /** Farm instead of skipping ahead when the next scripted buy is this close, in seconds. */
  earlyWaitSec: number;
  maxPaybackSec: number;
  /** Still buy a building above maxPayback when it is the only way forward, up to this. */
  stallPaybackSec: number;
  cpsBuffPaybackMultiplier: number;
  reserveAfterBaked: number;
  luckyReserve: boolean;
  /** A purchase this fast ignores the Lucky bank. */
  reserveOverridePaybackSec: number;
  tieRatio: number;
  /** When product of CpS buffs is at least this, spend the bank (Frenzy / building special). */
  cpsBuffReserveSkip: number;
};

export const DEFAULT_STRATEGY: StrategyConfig = {
  earlyUntilBaked: 1e6,
  earlySlack: 2.5,
  earlyWaitSec: 20,
  maxPaybackSec: 180,
  stallPaybackSec: 900,
  cpsBuffPaybackMultiplier: 3,
  reserveAfterBaked: 1e6,
  luckyReserve: true,
  reserveOverridePaybackSec: 30,
  tieRatio: 1.25,
  cpsBuffReserveSkip: 2,
};

export type BuyChoice = {
  key: string;
  name: string;
  reason: string;
  paybackSec: number | null;
  criterion: string;
};

export type BuyDecision =
  | { type: 'farm'; reason: string }
  | { type: 'buy'; choice: BuyChoice }
  | {
      type: 'ask-jev';
      options: BuyChoice[];
      fallbackKey: string;
      reason: string;
    };

export type ChooseBuyInput = {
  cookies: number;
  cookiesEarned: number;
  unbuffedCps: number;
  buffs: BuffView[];
  options: PurchaseOption[];
  buildingAmounts: Record<string, number>;
  ownedUpgrades: readonly string[];
  clickHz: number;
  /** Current cookies per click, so a short save-up can see click income. */
  mouseCps?: number;
  /** Unlocked buildings and upgrades, including ones we cannot afford yet. */
  catalog?: ReadonlyArray<{ kind: 'building' | 'upgrade'; name: string; price: number }>;
  config?: StrategyConfig;
  jevEnabled?: boolean;
};

export function buffMultipliers(buffs: readonly BuffView[]): {
  cps: number;
  click: number;
  clickBuff: boolean;
} {
  let cps = 1;
  let click = 1;
  let cursed = false;
  for (const buff of buffs) {
    if (typeof buff.multCpS === 'number' && Number.isFinite(buff.multCpS)) cps *= buff.multCpS;
    if (typeof buff.multClick === 'number' && Number.isFinite(buff.multClick)) {
      click *= buff.multClick;
    }
    if (buff.name === 'Cursed finger') cursed = true;
  }
  return { cps, click, clickBuff: click > 1 || cursed };
}

export function spendableCookies(input: {
  cookies: number;
  cookiesEarned: number;
  unbuffedCps: number;
  cpsMult: number;
  clickBuff: boolean;
  config: StrategyConfig;
}): number {
  const { cookies, config } = input;
  if (!config.luckyReserve) return cookies;
  if (input.clickBuff || input.cpsMult >= config.cpsBuffReserveSkip) return cookies;
  if (input.cookiesEarned < config.reserveAfterBaked) return cookies;
  if (!(input.unbuffedCps > 0)) return cookies;
  const reserve = input.unbuffedCps * LUCKY_BANK_SECONDS;
  return Math.max(0, cookies - reserve);
}

export function scorePayback(
  option: PurchaseOption,
  clickHz: number,
): { paybackSec: number; weightedPaybackSec: number; weight: number } {
  const weight = PRIORITY_GAIN_MULT[option.name] ?? 1;
  const gain = option.cpsDelta + option.mouseDelta * clickHz;
  const paybackSec = gain > 0 ? option.price / gain : Number.POSITIVE_INFINITY;
  const weightedGain = gain * weight;
  const weightedPaybackSec =
    weightedGain > 0 ? option.price / weightedGain : Number.POSITIVE_INFINITY;
  return { paybackSec, weightedPaybackSec, weight };
}

export function describePurchase(
  option: PurchaseOption,
  paybackSec: number,
  weightedPaybackSec: number,
): string {
  const pb = Number.isFinite(paybackSec) ? `${paybackSec.toFixed(1)}s payback` : 'no CpS/click gain';
  const weighted = Number.isFinite(weightedPaybackSec)
    ? `${weightedPaybackSec.toFixed(1)}s weighted`
    : 'unweighted';
  return `${option.kind} "${option.name}" price=${option.price} ${pb} (${weighted}) cpsΔ=${option.cpsDelta} clickΔ=${option.mouseDelta}`;
}

function goalMet(
  goal: EarlyGoal,
  amounts: Record<string, number>,
  owned: ReadonlySet<string>,
): boolean {
  if (goal.kind === 'upgrade') return owned.has(goal.name);
  return (amounts[goal.name] ?? 0) >= goal.count;
}

function matchesGoal(
  option: PurchaseOption,
  goal: EarlyGoal,
  amounts: Record<string, number>,
): boolean {
  if (option.kind !== goal.kind || option.name !== goal.name) return false;
  if (goal.kind === 'building') return (amounts[goal.name] ?? 0) < goal.count;
  return true;
}

function choiceFor(
  option: PurchaseOption,
  clickHz: number,
  reason: string,
): BuyChoice {
  const scored = scorePayback(option, clickHz);
  return {
    key: option.key,
    name: option.name,
    reason,
    paybackSec: Number.isFinite(scored.paybackSec) ? scored.paybackSec : null,
    criterion: describePurchase(option, scored.paybackSec, scored.weightedPaybackSec),
  };
}

type Scored = {
  option: PurchaseOption;
  paybackSec: number;
  weightedPaybackSec: number;
};

/**
 * Pick the next purchase, or farm.
 * Jev is only involved when two or more affordable buys are within `tieRatio`.
 * Clicking and golden cookies are not candidates here; the in-page farmer owns those.
 */
export function chooseBuy(input: ChooseBuyInput): BuyDecision {
  const config = input.config ?? DEFAULT_STRATEGY;
  const jevEnabled = input.jevEnabled ?? true;
  const owned = new Set(input.ownedUpgrades);
  const options = input.options.filter((option) => !BLOCKED_UPGRADES.has(option.name));
  const { cps: cpsMult, clickBuff } = buffMultipliers(input.buffs);

  if (options.length === 0) return { type: 'farm', reason: 'nothing-affordable' };

  for (const name of GC_UPGRADE_NAMES) {
    const found = options.find((option) => option.kind === 'upgrade' && option.name === name);
    if (found) {
      return { type: 'buy', choice: choiceFor(found, input.clickHz, 'golden-cookie-upgrade') };
    }
  }

  if (!clickBuff && input.cookiesEarned < config.earlyUntilBaked) {
    const incomePerSec =
      Math.max(0, input.unbuffedCps) + Math.max(0, input.mouseCps ?? 0) * input.clickHz;
    for (const goal of EARLY_ROUTE) {
      if (goalMet(goal, input.buildingAmounts, owned)) continue;
      const option = options.find((item) => matchesGoal(item, goal, input.buildingAmounts));
      if (!option) {
        const entry = input.catalog?.find(
          (item) => item.kind === goal.kind && item.name === goal.name,
        );
        if (!entry || entry.price <= input.cookies) continue;
        const seconds = (entry.price - input.cookies) / Math.max(incomePerSec, 0.01);
        if (seconds <= config.earlyWaitSec) {
          return { type: 'farm', reason: 'early-route-wait' };
        }
        continue;
      }
      const goalScore = scorePayback(option, input.clickHz);
      const bestOther = options.reduce((min, item) => {
        if (item === option) return min;
        return Math.min(min, scorePayback(item, input.clickHz).paybackSec);
      }, Number.POSITIVE_INFINITY);
      const withinSlack =
        goal.kind === 'upgrade' || goalScore.paybackSec <= bestOther * config.earlySlack;
      if (withinSlack) {
        return { type: 'buy', choice: choiceFor(option, input.clickHz, 'early-route') };
      }
      break;
    }
  }

  const budget = spendableCookies({
    cookies: input.cookies,
    cookiesEarned: input.cookiesEarned,
    unbuffedCps: input.unbuffedCps,
    cpsMult,
    clickBuff,
    config,
  });

  const affordable = options.filter((option) => {
    const payback = scorePayback(option, input.clickHz).paybackSec;
    if (option.price <= budget + 1e-9) return true;
    return payback <= config.reserveOverridePaybackSec;
  });
  if (affordable.length === 0) return { type: 'farm', reason: 'reserve' };

  let cap = config.maxPaybackSec;
  if (cpsMult >= config.cpsBuffReserveSkip) cap *= config.cpsBuffPaybackMultiplier;
  if (cpsMult > 0 && cpsMult < 0.9) cap *= 0.5;

  const scored: Scored[] = affordable.map((option) => {
    const score = scorePayback(option, input.clickHz);
    return { option, ...score };
  });

  let ranked = scored.filter((item) => item.weightedPaybackSec <= cap);
  let reason = 'roi';
  if (ranked.length === 0) {
    ranked = scored.filter(
      (item) =>
        item.option.kind === 'building' && item.weightedPaybackSec <= config.stallPaybackSec,
    );
    reason = 'stall-buy';
  }
  if (ranked.length === 0) return { type: 'farm', reason: 'over-payback' };

  ranked.sort((a, b) => {
    const delta = a.weightedPaybackSec - b.weightedPaybackSec;
    if (delta !== 0 && Number.isFinite(delta)) return delta;
    if (a.option.kind !== b.option.kind) return a.option.kind === 'upgrade' ? -1 : 1;
    return a.option.price - b.option.price;
  });

  const best = ranked[0];
  if (!best) return { type: 'farm', reason: 'over-payback' };

  const ratio = Math.max(1, config.tieRatio);
  const close = ranked.filter(
    (item) => item.weightedPaybackSec <= best.weightedPaybackSec * ratio + 1e-6,
  );
  if (jevEnabled && close.length >= 2) {
    const pool = close.slice(0, 6);
    const optionsOut = pool.map((item) =>
      choiceFor(item.option, input.clickHz, 'jev-candidate'),
    );
    const fallback = optionsOut[0];
    if (!fallback) return { type: 'farm', reason: 'over-payback' };
    return {
      type: 'ask-jev',
      options: optionsOut,
      fallbackKey: fallback.key,
      reason: 'roi-tie',
    };
  }

  return { type: 'buy', choice: choiceFor(best.option, input.clickHz, reason) };
}
