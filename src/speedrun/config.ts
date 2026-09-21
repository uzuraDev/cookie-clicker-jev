import {
  DEFAULT_STRATEGY,
  MIN_CLICK_INTERVAL_MS,
  type StrategyConfig,
} from './strategy.js';
import { TARGET_SECONDS } from './format.js';

export type SpeedrunConfig = {
  clickIntervalMs: number;
  clickIntervalNote?: string;
  jevOnTie: boolean;
  jevMinIntervalMs: number;
  buyIntervalMs: number;
  logIntervalMs: number;
  /** Stop without ascending when the page clock passes this. Unset = run until 1HC. */
  maxMs: number | null;
  strategy: StrategyConfig;
  targetSeconds: number;
};

export function isSpeedrunMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.SPEEDRUN_1HC;
  if (flag === 'true' || flag === '1') return true;
  const mode = (env.MODE ?? '').trim().toLowerCase();
  return mode === '1hc' || mode === 'speedrun_1hc';
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Clamp to the gap Cookie Clicker actually counts for a bare `Game.ClickCookie()` call. */
export function resolveClickIntervalMs(raw: string | undefined): { ms: number; note?: string } {
  if (raw === undefined || raw.trim() === '') return { ms: 25 };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ms: 25, note: `CLICK_INTERVAL_MS=${raw} is invalid; using 25` };
  }
  if (parsed < MIN_CLICK_INTERVAL_MS) {
    return {
      ms: MIN_CLICK_INTERVAL_MS,
      note: `CLICK_INTERVAL_MS=${parsed} is under the 20ms Game.ClickCookie() discard floor; using ${MIN_CLICK_INTERVAL_MS}`,
    };
  }
  return { ms: parsed };
}

export function loadSpeedrunConfig(env: NodeJS.ProcessEnv = process.env): SpeedrunConfig {
  const click = resolveClickIntervalMs(env.CLICK_INTERVAL_MS);
  const maxRaw = env.SPEEDRUN_MAX_MS;
  const maxParsed = maxRaw === undefined || maxRaw === '' ? NaN : Number(maxRaw);
  const tieRatio = num(env, 'JEV_TIE_RATIO', DEFAULT_STRATEGY.tieRatio);
  return {
    clickIntervalMs: click.ms,
    clickIntervalNote: click.note,
    jevOnTie: flag(env, 'JEV_ON_TIE', true),
    jevMinIntervalMs: Math.max(0, num(env, 'JEV_MIN_INTERVAL_MS', 12_000)),
    buyIntervalMs: Math.max(0, num(env, 'BUY_INTERVAL_MS', 250)),
    logIntervalMs: Math.max(250, num(env, 'LOG_INTERVAL_MS', 5_000)),
    maxMs: Number.isFinite(maxParsed) && maxParsed > 0 ? maxParsed : null,
    strategy: {
      ...DEFAULT_STRATEGY,
      tieRatio: tieRatio < 1 ? 1 : tieRatio,
      maxPaybackSec: num(env, 'MAX_PAYBACK_SEC', DEFAULT_STRATEGY.maxPaybackSec),
      luckyReserve: flag(env, 'LUCKY_RESERVE', DEFAULT_STRATEGY.luckyReserve),
    },
    targetSeconds: TARGET_SECONDS,
  };
}
