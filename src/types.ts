/** Compact game observation passed to Jev (and used by the executor). */
export type GameState = {
  cookies: number;
  cps: number;
  /** Human-readable summary for logs */
  summary: string;
  /** Affordable / always-available action candidates: key -> description */
  candidates: Record<string, string>;
};

export type ActionKey = string;

export type ActResult = {
  ok: boolean;
  message: string;
};

export type BuffView = {
  name: string;
  multCpS: number | null;
  multClick: number | null;
};

export type PurchaseOption = {
  key: string;
  kind: 'building' | 'upgrade';
  id: number;
  name: string;
  price: number;
  cpsDelta: number;
  mouseDelta: number;
};

/** Unlocked purchase, affordable or not. Used to wait for the next scripted buy. */
export type PurchaseCatalogEntry = {
  kind: 'building' | 'upgrade';
  name: string;
  price: number;
};

/** Live 1HC observation. Purchase options are already affordable. */
export type SpeedrunSnapshot = {
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
  buffs: BuffView[];
  buildingAmounts: Record<string, number>;
  ownedUpgrades: string[];
  options: PurchaseOption[];
  catalog: PurchaseCatalogEntry[];
  ascendIntro: boolean;
  ascending: boolean;
};

export type AscendAttempt = {
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
