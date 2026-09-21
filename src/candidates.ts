import type { ActionCandidate, Observation } from './types.js';

/** Choice questions accept at most 255 options. Leave room for click / wait / stop. */
const MAX_BUY_OPTIONS = 240;

/** Short price/count for logs and for the text Jev reads. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '?';
  const abs = Math.abs(n);
  if (abs < 1000) {
    return Number.isInteger(n) || abs >= 10 ? String(Math.round(n)) : n.toFixed(1);
  }
  const units = ['k', 'M', 'B', 'T', 'Qa'];
  let value = n;
  let unit = -1;
  while (Math.abs(value) >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)}${units[unit]}`;
}

/**
 * Turn an observation into numbered choices.
 * Keys are observation-local ("1"…"n"). The executor maps them back to `id`.
 */
export function buildCandidates(obs: Observation): ActionCandidate[] {
  const items: Array<{ id: string; description: string }> = [
    {
      id: 'click_cookie',
      description: 'Click the big cookie once (#bigCookie)',
    },
  ];

  const affordableBuildings = obs.buildings
    .filter((b) => b.affordable)
    .sort((a, b) => a.id - b.id);
  for (const b of affordableBuildings) {
    items.push({
      id: `buy_building_${b.id}`,
      description: `Buy building #product${b.id} "${b.name}" (owned ${b.amount}, price ${formatCount(b.price)})`,
    });
  }

  const upgrades = [...obs.upgrades].sort((a, b) => a.price - b.price || a.id - b.id);
  const room = Math.max(0, MAX_BUY_OPTIONS - items.length);
  for (const u of upgrades.slice(0, room)) {
    items.push({
      id: `buy_upgrade_${u.id}`,
      description: `Buy upgrade #upgrade${u.id} "${u.name}" (price ${formatCount(u.price)})`,
    });
  }

  items.push(
    {
      id: 'wait_1s',
      description: 'Wait 1 second and let cookies accumulate',
    },
    {
      id: 'wait_5s',
      description: 'Wait 5 seconds and let cookies accumulate',
    },
    {
      id: 'stop',
      description: 'Stop the loop',
    },
  );

  return items.map((item, index) => ({
    key: String(index + 1),
    id: item.id,
    description: item.description,
  }));
}

export function summarize(obs: Observation): string {
  const owned =
    obs.buildings.filter((b) => b.amount > 0).length === 0
      ? 'none'
      : obs.buildings
          .filter((b) => b.amount > 0)
          .map((b) => `${b.name} x${b.amount}`)
          .join(', ');
  const buildings =
    obs.buildings.length === 0
      ? 'none'
      : obs.buildings
          .map(
            (b) =>
              `${b.name} x${b.amount} @${formatCount(b.price)}${b.affordable ? '' : ' (too expensive)'}`,
          )
          .join(', ');
  const upgrades =
    obs.upgrades.length === 0
      ? 'none'
      : obs.upgrades
          .slice(0, 8)
          .map((u) => `${u.name} @${formatCount(u.price)}`)
          .join(', ') + (obs.upgrades.length > 8 ? ` +${obs.upgrades.length - 8} more` : '');
  const nextBuilding = obs.nextLockedBuilding
    ? `${obs.nextLockedBuilding.name} @${formatCount(obs.nextLockedBuilding.price)} (locked)`
    : 'none';
  const nextUpgrade = obs.nextUpgrade
    ? `${obs.nextUpgrade.name} @${formatCount(obs.nextUpgrade.price)}`
    : 'none';
  return `cookies=${formatCount(obs.cookies)} cps=${obs.cps.toFixed(2)} | owned: ${owned} | buildings: ${buildings} | next locked building: ${nextBuilding} | affordable upgrades: ${upgrades} | next upgrade: ${nextUpgrade}`;
}
