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
