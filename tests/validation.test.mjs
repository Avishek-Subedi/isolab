/**
 * Laboratory validation as a regression test.
 *
 * These assertions are the contract: any change to the physics that pushes a
 * published construction outside its tolerance, or that degrades the aggregate
 * RMSE, is a regression regardless of how sensible the change looked.
 */

import { suite, test, assert } from './harness.mjs';
import { runValidation, LAB_CASES, runCase, REFERENCE_CURVES } from '../src/core/validation.mjs';

const v = runValidation();

suite('Laboratory validation — single-number ratings', () => {
  for (const c of LAB_CASES) {
    test(`${c.id}: predicted STC within ±${c.tolerance} of ${c.published}`, () => {
      const r = runCase(c);
      assert.ok(!r.failure, r.failure);
      assert.close(r.predictedStc, c.published, c.tolerance,
        `${r.label}: predicted ${r.predictedStc}, published ${c.published}`);
    });
  }

  test('all cases pass', () => {
    assert.equal(v.summary.failed, 0,
      `${v.summary.failed} case(s) outside tolerance: ` +
      v.results.filter((r) => !r.pass).map((r) => `${r.id} (${r.error >= 0 ? '+' : ''}${r.error})`).join(', '));
  });

  test('aggregate RMSE is at or below 3.0 STC', () => {
    assert.less(v.summary.rmseStc, 3.0, `RMSE ${v.summary.rmseStc.toFixed(2)} STC`);
  });

  test('mean bias is within ±1.5 STC (no systematic optimism or pessimism)', () => {
    assert.less(Math.abs(v.summary.meanBiasStc), 1.5,
      `mean bias ${v.summary.meanBiasStc.toFixed(2)} STC`);
  });

  test('no single case is off by more than 6 STC', () => {
    assert.less(v.summary.maxAbsErrorStc, 6.01, `worst case ${v.summary.maxAbsErrorStc} STC`);
  });
});

suite('Laboratory validation — curve shape', () => {
  for (const c of v.curves) {
    test(`${c.id}: third-octave RMSE within ${c.tolerance} dB`, () => {
      assert.less(c.rmse, c.tolerance, `RMSE ${c.rmse.toFixed(2)} dB, worst ${c.maxAbsError} dB`);
    });
  }

  test('the single-leaf mass-law reference case is accurate to 2 dB RMSE', () => {
    const g = v.curves.find((c) => c.id === 'gypsum-125');
    assert.ok(g, 'gypsum-125 reference curve missing');
    assert.less(g.rmse, 2.0, `RMSE ${g.rmse.toFixed(2)} dB — the core mass-law model has drifted`);
  });
});

suite('Ordering of published constructions', () => {
  test('predicted ratings preserve the published ranking', () => {
    const walls = LAB_CASES.filter((c) => c.kind === 'wall').map(runCase);
    const byPublished = [...walls].sort((a, b) => a.published - b.published);
    const byPredicted = [...walls].sort((a, b) => a.predictedStc - b.predictedStc);
    // Allow local swaps where the published values are within 3 STC of each other
    let inversions = 0;
    for (let i = 0; i < byPublished.length; i++) {
      const j = byPredicted.findIndex((x) => x.id === byPublished[i].id);
      if (Math.abs(i - j) > 2) inversions++;
    }
    assert.less(inversions, 3, `${inversions} significant ranking inversions`);
  });
});
