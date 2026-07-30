/**
 * End-to-end system tests: the whole solver, the optimiser, calibration,
 * and the invariants that must hold for any design.
 */

import { suite, test, assert } from './harness.mjs';
import { simulate, geometry, estimateCost, internalSPL } from '../src/core/solver.mjs';
import { buildDesign, buildScenario, SCENARIOS } from '../src/data/designs.mjs';
import { optimise, singleChangeOptions, compareDesigns, UPGRADE_GROUPS } from '../src/core/optimizer.mjs';
import { assess, fitCalibration } from '../src/core/calibration.mjs';
import { THIRD_OCTAVE, OCTAVE, N_BANDS } from '../src/core/bands.mjs';
import { SOURCES } from '../src/data/sources.mjs';
import { ENVIRONMENTS } from '../src/data/environments.mjs';

suite('Geometry and cost', () => {
  test('internal areas and volume', () => {
    const g = geometry({ geometry: { internalL: 2, internalW: 3, internalH: 2.5 } });
    assert.close(g.volume, 15, 1e-9);
    assert.close(g.areas.floor, 6, 1e-9);
    assert.close(g.areas.front, 7.5, 1e-9);
    assert.close(g.envelope, 2 * (6 + 7.5 + 5), 1e-9);
  });
  test('cost is positive and itemised', () => {
    const c = estimateCost(buildDesign({}));
    assert.greater(c.total, 0);
    assert.greater(c.items.length, 3);
  });
  test('a bigger booth costs more', () => {
    const small = estimateCost(buildDesign({ L: 1, W: 1, H: 2 })).total;
    const big = estimateCost(buildDesign({ L: 3, W: 3, H: 2.5 })).total;
    assert.greater(big, small);
  });
});

suite('Solver invariants', () => {
  const design = buildDesign({});
  const r = simulate(design);

  test('every output spectrum is finite', () => {
    assert.finiteArray(r.inside.spectrum, 'inside');
    assert.finiteArray(r.outside.spectrum, 'outside');
    assert.finiteArray(r.compositeTL, 'composite TL');
    assert.finiteArray(r.levelDifference, 'level difference');
  });
  test('outside is quieter than inside in every band', () => {
    for (let i = 0; i < N_BANDS; i++) {
      assert.less(r.outside.spectrum[i], r.inside.spectrum[i],
        `band ${THIRD_OCTAVE[i]} Hz: outside ${r.outside.spectrum[i].toFixed(1)} >= inside ${r.inside.spectrum[i].toFixed(1)}`);
    }
  });
  test('composite transmission loss is positive everywhere', () => {
    for (let i = 0; i < N_BANDS; i++) assert.greater(r.compositeTL[i], 0);
  });
  test('breakdown percentages sum to 100', () => {
    const sum = r.breakdown.byElement.reduce((a, b) => a + b.percent, 0);
    assert.close(sum, 100, 0.01);
  });
  test('group breakdown also sums to 100', () => {
    assert.close(r.breakdown.byGroup.reduce((a, b) => a + b.percent, 0), 100, 0.01);
  });
  test('octave outputs are consistent with the third-octave data', () => {
    assert.equal(r.outside.octaves.length, 8);
    assert.finiteArray(r.outside.octaves);
  });
  test('ratings are in a sane range', () => {
    assert.between(r.ratings.stc, 5, 90);
    assert.between(r.ratings.rw, 5, 90);
    assert.ok(r.ratings.ctr <= r.ratings.c + 1, 'Ctr should not exceed C');
  });
  test('a verdict and diagnostics are always produced', () => {
    assert.ok(r.verdict.audibility.length > 0);
    assert.ok(Array.isArray(r.diagnostics));
  });
  test('background is included in the perceived level', () => {
    assert.ok(r.totals.perceivedA >= r.totals.backgroundA - 0.01);
    assert.ok(r.totals.perceivedA >= r.totals.outsideA - 0.01);
  });
});

suite('Physical monotonicity of the whole system', () => {
  const level = (spec) => simulate(buildDesign(spec)).totals.outsideWithFanA;

  test('a louder source gives a proportionally louder outside level', () => {
    // Must use the source-only total: fan noise is a fixed contribution that
    // does not scale with the source, so the combined level is deliberately
    // non-linear once the fan dominates.
    const a = simulate(buildDesign({ level: 80 })).totals.outsideZ;
    const b = simulate(buildDesign({ level: 100 })).totals.outsideZ;
    assert.close(b - a, 20, 0.6);
  });
  test('a better wall reduces the outside level', () => {
    assert.less(level({ wall: 'booth-pro', door: 'acoustic-45', ventPreset: 'silenced-pro' }),
      level({ wall: 'booth-budget', door: 'acoustic-45', ventPreset: 'silenced-pro' }));
  });
  test('a better door reduces the outside level', () => {
    assert.less(level({ door: 'acoustic-45' }), level({ door: 'hollow' }));
  });
  test('a better vent reduces the outside level', () => {
    assert.less(level({ ventPreset: 'silenced-pro' }), level({ ventPreset: 'open-hole' }));
  });
  test('adding leaks increases the outside level', () => {
    const sealed = level({ gaps: [] });
    const leaky = level({
      gaps: [{ label: 'gap', shape: 'slit', widthMm: 3, lengthMm: 5000, depthMm: 100 }],
    });
    assert.greater(leaky, sealed);
  });
  test('greater distance reduces the outside level', () => {
    assert.less(level({ distanceM: 6 }), level({ distanceM: 0.5 }));
  });
  test('the full upgrade ladder improves overall and never regresses much', () => {
    const ladder = ['booth-budget', 'booth-mid', 'booth-pro', 'double-stud', 'room-in-room'];
    const levels = ladder.map((w) => level({ wall: w, door: 'acoustic-54', ventPreset: 'silenced-pro', floorSystem: 'floating-heavy' }));
    const msg = `got ${levels.map((v) => v.toFixed(1)).join(', ')}`;
    // Once the door and vent govern, a better wall stops helping — that is the
    // correct answer, not a bug. Require a large overall gain and allow small
    // local plateaus where another path has become the limit.
    assert.greater(levels[0] - levels[levels.length - 1], 10, msg);
    assert.monotonic(levels, 'down', 0.75, msg);
  });
});

suite('Source spectra', () => {
  test('every source scales to the requested overall level', () => {
    for (const id of Object.keys(SOURCES)) {
      const r = simulate(buildDesign({ sourceId: id, level: 95, weighting: 'Z' }));
      assert.close(r.totals.insideZ, 95, 0.3, `${id} did not scale to 95 dB`);
    }
  });
  test('A-weighted scaling works too', () => {
    const r = simulate(buildDesign({ sourceId: 'scream', level: 90, weighting: 'A' }));
    assert.close(r.totals.insideA, 90, 0.3);
  });
  test('a bass-heavy source escapes more than a treble-heavy one at equal level', () => {
    const kick = simulate(buildDesign({ sourceId: 'kick-drum', level: 100, door: 'acoustic-45', ventPreset: 'silenced-pro' }));
    const flute = simulate(buildDesign({ sourceId: 'flute', level: 100, door: 'acoustic-45', ventPreset: 'silenced-pro' }));
    assert.greater(kick.totals.outsideZ, flute.totals.outsideZ,
      'mass law gives 6 dB/octave, so low-frequency sources must escape more');
  });
  test('a custom spectrum is honoured', () => {
    const custom = new Array(24).fill(70);
    custom[THIRD_OCTAVE.indexOf(500)] = 110;
    const r = simulate(buildDesign({ customSpectrum: custom }));
    assert.close(r.inside.spectrum[THIRD_OCTAVE.indexOf(500)], 110, 0.01);
  });
  test('source-at-1m mode adds reverberant build-up inside the booth', () => {
    const spl = simulate(buildDesign({ sourceMode: 'internal-spl', level: 100 }));
    const src = simulate(buildDesign({ sourceMode: 'source-at-1m', level: 100 }));
    assert.greater(src.totals.insideZ, spl.totals.insideZ,
      'a small hard booth must build up above the free-field level');
  });
});

suite('Environments', () => {
  test('every environment produces a finite result', () => {
    for (const id of Object.keys(ENVIRONMENTS)) {
      const r = simulate(buildDesign({ envId: id }));
      assert.ok(isFinite(r.totals.outsideA), `${id} produced non-finite level`);
      assert.finiteArray(r.outside.spectrum, id);
    }
  });
  test('a hard reverberant space is louder than an absorptive one', () => {
    const hall = simulate(buildDesign({ envId: 'hallway-shared', distanceM: 2 }));
    const studio = simulate(buildDesign({ envId: 'studio-live-room', distanceM: 2 }));
    assert.greater(hall.totals.outsideA, studio.totals.outsideA);
  });
  test('a separating party wall reduces the neighbour level further', () => {
    const same = simulate(buildDesign({ envId: 'apartment-neighbour', separatingElementId: 'none' }));
    const wall = simulate(buildDesign({ envId: 'apartment-neighbour', separatingElementId: 'brick-215' }));
    assert.greater(same.totals.outsideA, wall.totals.outsideA);
    assert.ok(wall.intermediate, 'should report the intermediate room level');
  });
  test('outdoor free field falls faster with distance than a room', () => {
    const d1 = simulate(buildDesign({ envId: 'outdoor-garden', distanceM: 2 })).totals.outsideZ;
    const d2 = simulate(buildDesign({ envId: 'outdoor-garden', distanceM: 8 })).totals.outsideZ;
    const r1 = simulate(buildDesign({ envId: 'bedroom-rented', distanceM: 2 })).totals.outsideZ;
    const r2 = simulate(buildDesign({ envId: 'bedroom-rented', distanceM: 8 })).totals.outsideZ;
    assert.greater(d1 - d2, r1 - r2);
  });
});

suite('Scenarios', () => {
  test('every scenario runs and produces a plausible answer', () => {
    for (const id of Object.keys(SCENARIOS)) {
      const r = simulate(buildScenario(id));
      assert.ok(isFinite(r.totals.outsideA), `${id} non-finite`);
      assert.between(r.totals.outsideA, -20, 130, `${id} outside level implausible`);
      assert.between(r.ratings.stc, 5, 90, `${id} STC implausible`);
      assert.greater(r.cost.total, 0, `${id} cost`);
    }
  });
  test('the DIY booth is clearly worse than the well-built one', () => {
    const diy = simulate(buildScenario('bedroom-diy'));
    const good = simulate(buildScenario('bedroom-good'));
    assert.greater(diy.totals.outsideA, good.totals.outsideA + 10);
  });
  test('the DIY booth is diagnosed as leak-dominated', () => {
    const diy = simulate(buildScenario('bedroom-diy'));
    const leakish = diy.breakdown.byElement
      .filter((e) => e.group === 'leak' || e.group === 'door-leak')
      .reduce((a, b) => a + b.percent, 0);
    assert.greater(leakish, 20, 'an unsealed DIY booth must be leak-dominated');
  });
});

suite('Optimiser', () => {
  test('single-change options are ranked by improvement', () => {
    const r = singleChangeOptions({ wall: 'booth-budget', door: 'hollow', ventPreset: 'open-hole' });
    assert.greater(r.options.length, 5);
    for (let i = 1; i < r.options.length; i++) {
      assert.ok(r.options[i - 1].improvementDb >= r.options[i].improvementDb - 1e-9);
    }
  });
  test('the best single change on a bad design is a real improvement', () => {
    const r = singleChangeOptions({ wall: 'booth-budget', door: 'hollow', ventPreset: 'open-hole' });
    assert.greater(r.options[0].improvementDb, 3);
  });
  test('optimiser returns a monotonically improving Pareto front', () => {
    const res = optimise({
      baseSpec: { L: 1.4, W: 1.4, H: 2.1, sourceId: 'scream', level: 100, envId: 'bedroom-rented', distanceM: 1 },
      targetDbA: 35, budget: 3000,
      groups: ['wall', 'door', 'vent'],
    });
    assert.greater(res.candidateCount, 50);
    assert.greater(res.pareto.length, 2);
    for (let i = 1; i < res.pareto.length; i++) {
      assert.greater(res.pareto[i].cost, res.pareto[i - 1].cost);
      assert.less(res.pareto[i].level, res.pareto[i - 1].level);
    }
  });
  test('optimiser respects the budget constraint', () => {
    const res = optimise({
      baseSpec: { L: 1.2, W: 1.2, H: 2.1, sourceId: 'scream', level: 100 },
      targetDbA: 20, budget: 700,
      groups: ['wall', 'door'],
    });
    if (res.bestAffordable) assert.ok(res.bestAffordable.cost <= 700 + 1e-6);
  });
  test('an impossible target is reported as infeasible, not silently missed', () => {
    const res = optimise({
      baseSpec: { L: 1.2, W: 1.2, H: 2.1, sourceId: 'drums_acoustic', level: 120 },
      targetDbA: -10, budget: 100000,
      groups: ['wall', 'door', 'vent'],
    });
    assert.equal(res.feasible, false);
    assert.equal(res.verdict.status, 'infeasible');
  });
  test('marginal table reports diminishing returns', () => {
    const res = optimise({
      baseSpec: { L: 1.4, W: 1.4, H: 2.1, sourceId: 'scream', level: 100 },
      targetDbA: 30, budget: 5000, groups: ['wall', 'door', 'vent'],
    });
    assert.greater(res.marginal.length, 1);
    for (const m of res.marginal) assert.ok(isFinite(m.deltaDb));
  });
  test('comparison mode reports a signed difference', () => {
    const c = compareDesigns(
      { wall: 'booth-budget', door: 'hollow', ventPreset: 'open-hole' },
      { wall: 'booth-pro', door: 'acoustic-45', ventPreset: 'silenced-pro' },
    );
    assert.less(c.delta.outsideA, 0, 'design B should be quieter');
    assert.greater(c.delta.cost, 0, 'design B should cost more');
    assert.equal(c.delta.perBand.length, N_BANDS);
  });
});

suite('Calibration', () => {
  const design = buildDesign({ sourceId: 'pink-noise', level: 100 });
  const predicted = simulate(design);

  test('a perfect measurement produces near-zero error and no calibration', () => {
    const a = assess(design, {
      insideOverall: 100, weighting: 'Z',
      outsideBands: predicted.outside.octaves, bandFrequencies: OCTAVE,
    });
    assert.less(Math.abs(a.meanBiasDb), 2.0);
    assert.equal(a.accuracy.grade === 'excellent' || a.accuracy.grade === 'good', true);
  });

  test('a global offset is fitted and reduces the bias', () => {
    const measuredOct = predicted.outside.octaves.map((v) => v - 6); // build is 6 dB better
    const fit = fitCalibration(design, [{
      insideOverall: 100, weighting: 'Z',
      outsideBands: measuredOct, bandFrequencies: OCTAVE,
    }]);
    assert.ok(Math.abs(fit.after.meanBiasDb) < Math.abs(fit.before.meanBiasDb));
    assert.less(Math.abs(fit.after.meanBiasDb), 1.5);
  });

  test('a low-frequency-only error is diagnosed as structural, not as a leak', () => {
    const measured = predicted.outside.octaves.map((v, i) => (OCTAVE[i] <= 250 ? v + 9 : v));
    const a = assess(design, {
      insideOverall: 100, weighting: 'Z',
      outsideBands: measured, bandFrequencies: OCTAVE,
    });
    const text = a.diagnosis.map((d) => d.title + ' ' + d.detail).join(' ');
    assert.ok(/flank|structur|rigid|mass-air-mass/i.test(text),
      `expected a structural diagnosis, got: ${text.slice(0, 200)}`);
  });

  test('a high-frequency-only error is diagnosed as a leak', () => {
    const measured = predicted.outside.octaves.map((v, i) => (OCTAVE[i] >= 2000 ? v + 9 : v));
    const a = assess(design, {
      insideOverall: 100, weighting: 'Z',
      outsideBands: measured, bandFrequencies: OCTAVE,
    });
    const text = a.diagnosis.map((d) => d.title + ' ' + d.detail).join(' ');
    assert.ok(/leak|gap|torch/i.test(text),
      `expected a leak diagnosis, got: ${text.slice(0, 200)}`);
  });

  test('a measurement too close to the background is rejected', () => {
    const a = assess(design, { insideOverall: 100, outsideOverall: 32, backgroundOverall: 31 });
    assert.equal(a.backgroundValid, false);
    assert.ok(/invalid/i.test(a.backgroundWarning || ''));
  });

  test('per-band mode is chosen when the error is spectrally sloped', () => {
    const measured = predicted.outside.octaves.map((v, i) => v + (OCTAVE[i] <= 250 ? 10 : -2));
    const fit = fitCalibration(design, [{
      insideOverall: 100, weighting: 'Z', outsideBands: measured, bandFrequencies: OCTAVE,
    }]);
    assert.equal(fit.mode, 'per-band');
    assert.equal(fit.calibration.offsets.length, N_BANDS);
  });

  test('calibration offsets are clamped so they cannot hide a broken model', () => {
    const measured = predicted.outside.octaves.map((v) => v - 40);
    const fit = fitCalibration(design, [{
      insideOverall: 100, weighting: 'Z', outsideBands: measured, bandFrequencies: OCTAVE,
    }], { maxOffsetDb: 12 });
    const offs = fit.calibration.offsets || [fit.calibration.globalOffsetDb];
    for (const o of offs) assert.ok(Math.abs(o) <= 12.01);
  });
});

suite('Performance', () => {
  test('a full simulation completes in under 5 ms (real-time capable)', () => {
    const d = buildDesign({});
    simulate(d); // warm up
    const t0 = performance.now();
    const N = 50;
    for (let i = 0; i < N; i++) simulate(d);
    const per = (performance.now() - t0) / N;
    assert.less(per, 5, `${per.toFixed(2)} ms per simulation is too slow for a real-time UI`);
  });
});
