/** Wall-clock format `H:MM:SS.mmm` (hours are not zero-padded). */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(clamped / 1000);
  const milli = clamped % 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number, width: number) => n.toString().padStart(width, '0');
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`;
}

export function formatCookies(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs < 1000) return abs < 10 ? n.toFixed(1) : String(Math.round(n));
  return n.toExponential(3);
}

/**
 * Final line. `met` is true only when the caller has already decided the
 * category goal and the target time were both satisfied.
 */
export function formatResult(
  elapsedMs: number,
  met: boolean,
  targetLabel = '5:18:16',
): string {
  return `RESULT: time=${formatClock(elapsedMs)} target=${targetLabel} met=${met ? 'yes' : 'no'}`;
}

export const TARGET_LABEL = '5:18:16';
export const TARGET_SECONDS = 5 * 3600 + 18 * 60 + 16;
