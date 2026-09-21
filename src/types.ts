/** Snapshot read from the Cookie Clicker DOM and `Game` object. */
export type BuildingSnap = {
  id: number;
  name: string;
  amount: number;
  price: number;
  /** `#productN` has class `enabled` (player can afford it right now). */
  affordable: boolean;
};

export type UpgradeSnap = {
  id: number;
  name: string;
  price: number;
};

export type PricedThing = {
  id: number;
  name: string;
  price: number;
};

export type Observation = {
  cookies: number;
  cps: number;
  /** Unlocked buildings, affordable or not. */
  buildings: BuildingSnap[];
  /** Affordable, unbought upgrades only. These become buy actions. */
  upgrades: UpgradeSnap[];
  /** Cheapest building that is still locked, if any. Not a buy action. */
  nextLockedBuilding: PricedThing | null;
  /** Cheapest visible upgrade that is not affordable yet. Not a buy action. */
  nextUpgrade: PricedThing | null;
};

/** One action the application can execute. Jev only sees `key` + `description`. */
export type ActionCandidate = {
  /** 1-based choice key sent to Jev (`"1"`, `"2"`, …). */
  key: string;
  /** Stable id the executor understands (`click_cookie`, `buy_building_0`, …). */
  id: string;
  description: string;
};

/** Compact observation plus the current numbered action list. */
export type GameState = {
  cookies: number;
  cps: number;
  summary: string;
  candidates: ActionCandidate[];
};

export type ActResult = {
  ok: boolean;
  message: string;
};
