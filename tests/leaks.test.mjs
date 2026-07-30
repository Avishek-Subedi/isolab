/**
 * Leak model tests.
 *
 * These matter more than any other tests in the suite, because leaks are what
 * actually decides whether a real booth works, and because the Zwikker-Kosten
 * transmission-line model has enough moving parts to go subtly wrong.
 */

import { suite, test, assert } from './harness.mjs';
import { THIRD_OCTAVE, N_BANDS } from '../src/core/bands.mjs';
import { tauToTL } from '../src/core/acoustics.mjs';
import {
  gapTau, gapArea, gapLimitedTL, gapResonances, naiveApertureCeiling, LEAK_PRESETS,
} from '../src/core/leaks.mjs';

const at = (arr, f) => arr[THIRD_OCTAVE.indexOf(f)];

suite('Gap geometry', () => {
  test('slit area = width x length x count', () => {
    assert.close(gapArea({ shape: 'slit', widthMm: 2, lengthMm: 1000, count: 1 }), 0.002, 1e-9);
    assert.close(gapArea({ shape: 'slit', widthMm: 2, lengthMm: 1000, count: 3 }), 0.006, 1e-9);
  });
  test('hole area = pi r^2', () => {
    assert.close(gapArea({ shape: 'hole', widthMm: 100 }), Math.PI * 0.05 * 0.05, 1e-9);
  });
  test('naive aperture ceiling: 1% open area caps TL at 20 dB', () => {
    assert.close(naiveApertureCeiling(0.01), 20, 0.01);
    assert.close(naiveApertureCeiling(0.001), 30, 0.01);
  });
});

suite('Slit resonance', () => {
  test('half-wave resonance is near c/2t for a deep slit', () => {
    const r = gapResonances({ shape: 'slit', widthMm: 1, depthMm: 100 });
    assert.close(r[0], 343 / (2 * 0.1), 200);
  });
  test('resonances are harmonically spaced', () => {
    const r = gapResonances({ shape: 'slit', widthMm: 2, depthMm: 50 });
    assert.close(r[1] / r[0], 2, 0.05);
  });
  test('a gap is near-transparent at its resonance', () => {
    // 44 mm deep slit resonates near 3.7 kHz
    const tau = gapTau({ shape: 'slit', widthMm: 3, lengthMm: 5000, depthMm: 44 });
    const tlAtRes = tauToTL(at(tau, 4000));
    const tlBelow = tauToTL(at(tau, 500));
    assert.less(tlAtRes, tlBelow, 'TL should collapse toward the slit resonance');
    assert.less(tlAtRes, 6, 'a resonant gap should be almost open');
  });
});

suite('Viscous choking of narrow gaps', () => {
  test('a 0.1 mm gap transmits far less per unit area than a 2 mm gap', () => {
    const wide = gapTau({ shape: 'slit', widthMm: 2, lengthMm: 5000, depthMm: 44 });
    const narrow = gapTau({ shape: 'slit', widthMm: 0.1, lengthMm: 5000, depthMm: 44 });
    // Per unit area — this is the viscous boundary-layer effect, not just area
    assert.greater(tauToTL(at(narrow, 500)) - tauToTL(at(wide, 500)), 10);
  });
  test('gap transmission per unit area falls monotonically as the gap narrows', () => {
    const widths = [4, 2, 1, 0.5, 0.2, 0.1];
    const tls = widths.map((w) =>
      tauToTL(at(gapTau({ shape: 'slit', widthMm: w, lengthMm: 5000, depthMm: 44 }), 500)));
    assert.monotonic(tls, 'up', 0.01, `expected rising TL for narrowing gaps, got ${tls.map((v) => v.toFixed(1)).join(', ')}`);
  });
  test('a porous seal in the gap adds substantial loss', () => {
    const bare = gapTau({ shape: 'slit', widthMm: 1, lengthMm: 5000, depthMm: 44 });
    const sealed = gapTau({ shape: 'slit', widthMm: 1, lengthMm: 5000, depthMm: 44, sealResistivity: 30000, sealFillFraction: 0.7 });
    assert.greater(tauToTL(at(sealed, 500)), tauToTL(at(bare, 500)) + 3);
  });
});

suite('Physical bounds', () => {
  test('tau is finite and bounded for every preset', () => {
    for (const p of LEAK_PRESETS) {
      const tau = gapTau(p);
      assert.finiteArray(tau, `${p.id} produced non-finite tau`);
      for (let i = 0; i < N_BANDS; i++) {
        assert.between(tau[i], 0, 4, `${p.id} tau out of bounds at ${THIRD_OCTAVE[i]} Hz: ${tau[i]}`);
      }
    }
  });
  test('tau exceeds 1 only near a resonance (aperture draws in extra power)', () => {
    const tau = gapTau({ shape: 'slit', widthMm: 10, lengthMm: 900, depthMm: 44 });
    const over = tau.map((t, i) => (t > 1 ? THIRD_OCTAVE[i] : null)).filter(Boolean);
    const res = gapResonances({ shape: 'slit', widthMm: 10, depthMm: 44 });
    for (const f of over) {
      const near = res.some((r) => Math.abs(Math.log2(f / r)) < 0.75);
      assert.ok(near, `tau > 1 at ${f} Hz which is not near a resonance (${res.map((r) => r.toFixed(0)).join(', ')})`);
    }
  });
  test('an open vent hole is essentially transparent at mid/high frequency', () => {
    const tau = gapTau({ shape: 'hole', widthMm: 100, depthMm: 150 });
    assert.less(tauToTL(at(tau, 1000)), 3);
    assert.less(tauToTL(at(tau, 2000)), 3);
  });
  test('an open hole still has low-frequency inertance loss', () => {
    const tau = gapTau({ shape: 'hole', widthMm: 100, depthMm: 150 });
    assert.greater(tauToTL(at(tau, 63)), tauToTL(at(tau, 1000)));
  });
});

suite('The devastating-small-hole result', () => {
  test('a 3 mm door perimeter gap caps a 30 m2 envelope around 35-45 dB', () => {
    const tl = gapLimitedTL({ shape: 'slit', widthMm: 3, lengthMm: 5600, depthMm: 44 }, 30);
    assert.between(at(tl, 500), 33, 47);
  });
  test('sealing 3 mm down to 0.25 mm recovers more than 12 dB', () => {
    const bad = gapLimitedTL({ shape: 'slit', widthMm: 3, lengthMm: 5600, depthMm: 44 }, 30);
    const good = gapLimitedTL({
      shape: 'slit', widthMm: 0.25, lengthMm: 5600, depthMm: 44,
      sealResistivity: 25000, sealFillFraction: 0.6,
    }, 30);
    assert.greater(at(good, 500) - at(bad, 500), 12);
  });
  test('a single unsealed 50 mm cable hole caps a good wall', () => {
    // 50 mm hole in a 30 m^2 envelope: open fraction 0.0065%
    const tl = gapLimitedTL({ shape: 'hole', widthMm: 50, depthMm: 150 }, 30);
    // Even this tiny hole limits the envelope to well under 50 dB at 1 kHz
    assert.less(at(tl, 1000), 50);
    assert.greater(at(tl, 1000), 30);
  });
  test('packing a cable hole with mineral wool restores most of the loss', () => {
    const open = gapLimitedTL({ shape: 'hole', widthMm: 50, depthMm: 150 }, 30);
    const packed = gapLimitedTL({
      shape: 'hole', widthMm: 50, depthMm: 150, sealResistivity: 25000, sealFillFraction: 1.0,
    }, 30);
    assert.greater(at(packed, 1000) - at(open, 1000), 15);
  });
});

suite('Scaling behaviour', () => {
  test('doubling gap length halves the TL benefit (3 dB)', () => {
    const a = gapLimitedTL({ shape: 'slit', widthMm: 1, lengthMm: 2800, depthMm: 44 }, 30);
    const b = gapLimitedTL({ shape: 'slit', widthMm: 1, lengthMm: 5600, depthMm: 44 }, 30);
    assert.close(at(a, 500) - at(b, 500), 3, 1.0);
  });
  test('a deeper gap (thicker wall) leaks less below resonance', () => {
    const thin = gapTau({ shape: 'slit', widthMm: 2, lengthMm: 5000, depthMm: 20 });
    const thick = gapTau({ shape: 'slit', widthMm: 2, lengthMm: 5000, depthMm: 200 });
    assert.greater(tauToTL(at(thick, 250)), tauToTL(at(thin, 250)));
  });
  test('coherence factor changes the answer in the expected direction', () => {
    const g = { shape: 'slit', widthMm: 2, lengthMm: 5600, depthMm: 44 };
    const low = gapTau(g, { leakCoherenceFactor: 0.25 });
    const high = gapTau(g, { leakCoherenceFactor: 1.0 });
    // More coherent length -> more efficient radiation -> more leakage
    assert.greater(at(high, 500), at(low, 500));
  });
});
