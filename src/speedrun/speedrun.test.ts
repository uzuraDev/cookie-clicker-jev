import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSpeedrunMode, loadSpeedrunConfig, resolveClickIntervalMs } from './config.js';
import { formatClock, formatResult, TARGET_SECONDS } from './format.js';
import { chooseBuy, scorePayback, type ChooseBuyInput } from './strategy.js';
import type { PurchaseOption } from '../types.js';

function option(partial: Partial<PurchaseOption> & Pick<PurchaseOption, 'key' | 'name' | 'kind'>): PurchaseOption {
  return {
    id: 0,
    price: 100,
    cpsDelta: 1,
    mouseDelta: 0,
    ...partial,
  };
}

function input(partial: Partial<ChooseBuyInput> & Pick<ChooseBuyInput, 'options'>): ChooseBuyInput {
  return {
    cookies: 1e9,
    cookiesEarned: 1e7,
    unbuffedCps: 0,
    buffs: [],
    buildingAmounts: {},
    ownedUpgrades: [],
    clickHz: 40,
    jevEnabled: true,
    ...partial,
  };
}

describe('format', () => {
  it('formats the world-record target', () => {
    assert.equal(TARGET_SECONDS, 5 * 3600 + 18 * 60 + 16);
    assert.equal(formatClock(TARGET_SECONDS * 1000), '5:18:16.000');
    assert.equal(formatClock(3661000), '1:01:01.000');
  });

  it('prints the result line', () => {
    assert.equal(
      formatResult(TARGET_SECONDS * 1000, true),
      'RESULT: time=5:18:16.000 target=5:18:16 met=yes',
    );
    assert.equal(
      formatResult(TARGET_SECONDS * 1000 + 1, false),
      'RESULT: time=5:18:16.001 target=5:18:16 met=no',
    );
  });
});

describe('click interval', () => {
  it('defaults to 25ms and refuses the 20ms discard floor', () => {
    assert.equal(resolveClickIntervalMs(undefined).ms, 25);
    const clamped = resolveClickIntervalMs('5');
    assert.equal(clamped.ms, 21);
    assert.match(clamped.note ?? '', /20ms/);
    assert.equal(resolveClickIntervalMs('40').ms, 40);
  });
});

describe('mode flag', () => {
  it('accepts SPEEDRUN_1HC and MODE=1hc', () => {
    assert.equal(isSpeedrunMode({} as NodeJS.ProcessEnv), false);
    assert.equal(isSpeedrunMode({ SPEEDRUN_1HC: 'true' } as NodeJS.ProcessEnv), true);
    assert.equal(isSpeedrunMode({ MODE: '1hc' } as NodeJS.ProcessEnv), true);
    assert.equal(isSpeedrunMode({ MODE: '1HC' } as NodeJS.ProcessEnv), true);
    const config = loadSpeedrunConfig({ JEV_ON_TIE: 'false', CLICK_INTERVAL_MS: '30' } as NodeJS.ProcessEnv);
    assert.equal(config.jevOnTie, false);
    assert.equal(config.clickIntervalMs, 30);
  });
});

describe('chooseBuy', () => {
  it('farms when nothing is affordable', () => {
    const decision = chooseBuy(input({ options: [] }));
    assert.equal(decision.type, 'farm');
    if (decision.type === 'farm') assert.equal(decision.reason, 'nothing-affordable');
  });

  it('opens on a cursor before ROI would stall', () => {
    const cursor = option({
      key: 'buy_building_0',
      kind: 'building',
      name: 'Cursor',
      price: 15,
      cpsDelta: 0.1,
    });
    const decision = chooseBuy(
      input({
        cookies: 15,
        cookiesEarned: 15,
        options: [cursor],
        buildingAmounts: { Cursor: 0 },
      }),
    );
    assert.equal(decision.type, 'buy');
    if (decision.type === 'buy') {
      assert.equal(decision.choice.key, 'buy_building_0');
      assert.equal(decision.choice.reason, 'early-route');
    }
  });

  it('waits for the next scripted upgrade instead of buying extra cursors', () => {
    const cursor = option({
      key: 'buy_building_0',
      kind: 'building',
      name: 'Cursor',
      price: 15,
      cpsDelta: 0.1,
    });
    const decision = chooseBuy(
      input({
        cookies: 20,
        cookiesEarned: 40,
        options: [cursor],
        buildingAmounts: { Cursor: 1 },
        mouseCps: 1,
        catalog: [{ kind: 'upgrade', name: 'Reinforced index finger', price: 100 }],
      }),
    );
    assert.equal(decision.type, 'farm');
    if (decision.type === 'farm') assert.equal(decision.reason, 'early-route-wait');
  });

  it('forces the scripted click upgrade over a faster building', () => {
    const finger = option({
      key: 'buy_upgrade_0',
      kind: 'upgrade',
      name: 'Reinforced index finger',
      price: 100,
      cpsDelta: 0,
      mouseDelta: 0.01,
    });
    const grandma = option({
      key: 'buy_building_1',
      kind: 'building',
      name: 'Grandma',
      price: 100,
      cpsDelta: 50,
    });
    const decision = chooseBuy(
      input({
        cookiesEarned: 200,
        options: [finger, grandma],
        buildingAmounts: { Cursor: 1, Grandma: 0 },
      }),
    );
    assert.equal(decision.type, 'buy');
    if (decision.type === 'buy') {
      assert.equal(decision.choice.name, 'Reinforced index finger');
      assert.equal(decision.choice.reason, 'early-route');
    }
  });

  it('leaves the early route when the scripted building is a bad buy', () => {
    const cursor = option({
      key: 'buy_building_0',
      kind: 'building',
      name: 'Cursor',
      price: 500,
      cpsDelta: 1,
    });
    const grandma = option({
      key: 'buy_building_1',
      kind: 'building',
      name: 'Grandma',
      price: 100,
      cpsDelta: 10,
    });
    const decision = chooseBuy(
      input({
        cookiesEarned: 1e5,
        options: [cursor, grandma],
        buildingAmounts: { Cursor: 2, Grandma: 1 },
        ownedUpgrades: ['Reinforced index finger', 'Carpal tunnel prevention cream'],
        jevEnabled: false,
      }),
    );
    assert.equal(decision.type, 'buy');
    if (decision.type === 'buy') assert.equal(decision.choice.name, 'Grandma');
  });

  it('buys Lucky day even with no CpS delta', () => {
    const lucky = option({
      key: 'buy_upgrade_84',
      kind: 'upgrade',
      name: 'Lucky day',
      price: 777777777,
      cpsDelta: 0,
      mouseDelta: 0,
    });
    const mine = option({
      key: 'buy_building_3',
      kind: 'building',
      name: 'Mine',
      price: 10000,
      cpsDelta: 100,
    });
    const decision = chooseBuy(
      input({
        options: [mine, lucky],
        cookiesEarned: 1e9,
      }),
    );
    assert.equal(decision.type, 'buy');
    if (decision.type === 'buy') {
      assert.equal(decision.choice.name, 'Lucky day');
      assert.equal(decision.choice.reason, 'golden-cookie-upgrade');
    }
  });

  it('asks Jev when two paybacks are close', () => {
    const a = option({
      key: 'buy_building_2',
      kind: 'building',
      name: 'Farm',
      price: 1000,
      cpsDelta: 10,
    });
    const b = option({
      key: 'buy_building_3',
      kind: 'building',
      name: 'Mine',
      price: 1100,
      cpsDelta: 10,
    });
    const decision = chooseBuy(input({ options: [a, b], cookiesEarned: 1e7 }));
    assert.equal(decision.type, 'ask-jev');
    if (decision.type === 'ask-jev') {
      assert.equal(decision.options.length, 2);
      assert.equal(decision.fallbackKey, 'buy_building_2');
    }
  });

  it('prefers click power while Click frenzy multiplies the mouse', () => {
    const building = option({
      key: 'buy_building_1',
      kind: 'building',
      name: 'Grandma',
      price: 1000,
      cpsDelta: 100,
      mouseDelta: 0,
    });
    const mouseQuiet = option({
      key: 'buy_upgrade_75',
      kind: 'upgrade',
      name: 'Iron mouse',
      price: 1000,
      cpsDelta: 0,
      mouseDelta: 0.05,
    });
    const mouseFrenzy = option({
      ...mouseQuiet,
      mouseDelta: 0.05 * 777,
    });
    const quiet = chooseBuy(
      input({ options: [building, mouseQuiet], cookiesEarned: 1e7, jevEnabled: false }),
    );
    const frenzy = chooseBuy(
      input({
        options: [building, mouseFrenzy],
        cookiesEarned: 1e7,
        jevEnabled: false,
        buffs: [{ name: 'Click frenzy', multCpS: null, multClick: 777 }],
      }),
    );
    assert.equal(quiet.type, 'buy');
    assert.equal(frenzy.type, 'buy');
    if (quiet.type === 'buy') assert.equal(quiet.choice.name, 'Grandma');
    if (frenzy.type === 'buy') assert.equal(frenzy.choice.name, 'Iron mouse');
  });

  it('holds the Lucky bank unless the buy pays back quickly or a CpS buff is up', () => {
    const slow = option({
      key: 'buy_building_4',
      kind: 'building',
      name: 'Factory',
      price: 800,
      cpsDelta: 8,
    });
    const held = chooseBuy(
      input({
        cookies: 1000,
        cookiesEarned: 2e6,
        unbuffedCps: 10,
        options: [slow],
        jevEnabled: false,
      }),
    );
    assert.equal(held.type, 'farm');
    if (held.type === 'farm') assert.equal(held.reason, 'reserve');

    const frenzy = chooseBuy(
      input({
        cookies: 1000,
        cookiesEarned: 2e6,
        unbuffedCps: 10,
        options: [slow],
        jevEnabled: false,
        buffs: [{ name: 'Frenzy', multCpS: 7, multClick: null }],
      }),
    );
    assert.equal(frenzy.type, 'buy');
    if (frenzy.type === 'buy') assert.equal(frenzy.choice.name, 'Factory');
  });

  it('never buys a wrath upgrade', () => {
    const mind = option({
      key: 'buy_upgrade_89',
      kind: 'upgrade',
      name: 'One mind',
      price: 100,
      cpsDelta: 1e6,
    });
    const decision = chooseBuy(input({ options: [mind], cookiesEarned: 1e7 }));
    assert.equal(decision.type, 'farm');
  });

  it('scores click gain into payback', () => {
    const scored = scorePayback(
      option({ key: 'buy_upgrade_1', kind: 'upgrade', name: 'Plain cookies', price: 100, cpsDelta: 1, mouseDelta: 2 }),
      10,
    );
    assert.equal(scored.paybackSec, 100 / 21);
  });
});
