/**
 * Physics unit tests — analytic checks against closed-form results and
 * known textbook values, not against the engine's own output.
 */

import { suite, test, assert } from './harness.mjs';
import { AIR, P_REF } from '../src/core/constants.mjs';
import {
  THIRD_OCTAVE, THIRD_OCTAVE_EXACT, OCTAVE, aWeight, cWeight, toOctaves,
  attenToOctaves, resample, N_BANDS,
} from '../src/core/bands.mjs';
import {
  dbSum, tauToTL, tlToTau, splToP2, p2ToSpl, sabineRT, roomConstant,
  porousAlpha, boxEnvelopeSPL, wToSwl,
} from '../src/core/acoustics.mjs';
import { computeSTC, computeRw, computeNR } from '../src/core/ratings.mjs';
import {
  massLawTL, criticalFrequency, singleLeafTL, surfaceMass, longitudinalSpeed,
  totalLossFactor, panelResonance,
} from '../src/core/panel.mjs';
import { massAirMass, partitionTL, CONNECTIONS, cavityResonances, bridgingAttenuation } from '../src/core/partition.mjs';
import { transmissibility, isolatorAttenuation, ISOLATORS, fnFromDeflection } from '../src/core/structure.mjs';
import { endReflectionLoss, ductGeometry, requiredAirflowLps, linedDuctAttenPerM } from '../src/core/duct.mjs';
import { besselJ0, besselJ1, struveH1, pistonRadiation } from '../src/core/complex.mjs';
import { MATERIALS } from '../src/data/materials.mjs';
import { assessMaterial } from '../src/core/assess.mjs';

suite('Bands and weightings', () => {
  test('24 third-octave bands map 3:1 onto 8 octave bands', () => {
    assert.equal(THIRD_OCTAVE.length, 24);
    assert.equal(OCTAVE.length, 8);
    for (let k = 0; k < 8; k++) assert.equal(THIRD_OCTAVE[3 * k + 1], OCTAVE[k]);
  });

  test('A-weighting matches IEC 61672 tabulated values', () => {
    // Standard reference values, tolerance 0.15 dB
    assert.close(aWeight(63), -26.2, 0.15);
    assert.close(aWeight(125), -16.1, 0.15);
    assert.close(aWeight(250), -8.6, 0.15);
    assert.close(aWeight(500), -3.2, 0.15);
    assert.close(aWeight(1000), 0.0, 0.05);
    assert.close(aWeight(2000), 1.2, 0.15);
    assert.close(aWeight(4000), 1.0, 0.15);
    assert.close(aWeight(8000), -1.1, 0.2);
  });

  test('C-weighting matches IEC 61672 tabulated values', () => {
    assert.close(cWeight(63), -0.8, 0.15);
    assert.close(cWeight(1000), 0.0, 0.05);
    assert.close(cWeight(8000), -3.0, 0.2);
  });

  test('octave folding of a flat spectrum adds 4.77 dB', () => {
    const flat = new Array(24).fill(70);
    const oct = toOctaves(flat);
    for (const v of oct) assert.close(v, 70 + 10 * Math.log10(3), 0.01);
  });

  test('attenuation folding of a flat TL preserves the value', () => {
    const flat = new Array(24).fill(45);
    for (const v of attenToOctaves(flat)) assert.close(v, 45, 0.01);
  });

  test('resample interpolates in log frequency and clamps at the ends', () => {
    const r = resample([100, 1000], [20, 40]);
    assert.close(r[THIRD_OCTAVE.indexOf(100)], 20, 0.3);
    assert.close(r[THIRD_OCTAVE.indexOf(1000)], 40, 0.3);
    // 316 Hz is halfway in log space between 100 and 1000
    assert.close(r[THIRD_OCTAVE.indexOf(315)], 30, 0.6);
    assert.close(r[0], 20, 0.01);            // flat extrapolation below
    assert.close(r[N_BANDS - 1], 40, 0.01);  // and above
  });
});

suite('Decibel algebra', () => {
  test('two equal levels sum to +3.01 dB', () => {
    assert.close(dbSum([70, 70]), 73.0103, 0.001);
  });
  test('ten equal levels sum to +10 dB', () => {
    assert.close(dbSum(new Array(10).fill(60)), 70, 0.001);
  });
  test('a level 10 dB lower adds 0.41 dB', () => {
    assert.close(dbSum([80, 70]), 80.4139, 0.001);
  });
  test('SPL <-> pressure round trip', () => {
    assert.close(p2ToSpl(splToP2(94)), 94, 1e-9);
    // 1 Pa RMS is 94 dB SPL
    assert.close(p2ToSpl(1.0), 93.98, 0.01);
  });
  test('tau <-> TL round trip, and tau=1 is 0 dB', () => {
    assert.close(tauToTL(1), 0, 1e-9);
    assert.close(tauToTL(tlToTau(37)), 37, 1e-9);
    assert.close(tauToTL(0.01), 20, 1e-9);
  });
});

suite('Special functions', () => {
  test('Bessel J0 matches known values', () => {
    assert.close(besselJ0(0), 1, 1e-7);
    assert.close(besselJ0(1), 0.7651977, 1e-6);
    assert.close(besselJ0(2.404826), 0, 1e-5);   // first zero
    assert.close(besselJ0(5), -0.1775968, 1e-6);
    assert.close(besselJ0(10), -0.2459358, 1e-6);
  });
  test('Bessel J1 matches known values', () => {
    assert.close(besselJ1(0), 0, 1e-9);
    assert.close(besselJ1(1), 0.4400506, 1e-6);
    assert.close(besselJ1(3.831706), 0, 1e-5);   // first zero
    assert.close(besselJ1(5), -0.3275791, 1e-6);
    assert.close(besselJ1(10), 0.0434727, 1e-6);
  });
  test('Struve H1 matches known values and small-x asymptote', () => {
    assert.close(struveH1(0), 0, 1e-9);
    // small x: H1 -> 2x^2/(3 pi)
    // Leading-order asymptote only; the next series term is ~1.4e-6 at x=0.1
    assert.close(struveH1(0.1), (2 * 0.01) / (3 * Math.PI), 5e-6);
    assert.close(struveH1(1), 0.198457, 1e-4);
    assert.close(struveH1(5), 0.80713, 3e-3);
  });
  test('piston radiation impedance has correct asymptotes', () => {
    // Low ka: R -> (2ka)^2/8, X -> 4(2ka)/(3 pi)
    const lo = pistonRadiation(0.01);
    assert.close(lo.R, Math.pow(0.02, 2) / 8, 1e-6);
    assert.close(lo.X, (4 * 0.02) / (3 * Math.PI), 1e-4);
    // High ka: R -> 1, X -> 0
    const hi = pistonRadiation(50);
    assert.close(hi.R, 1, 0.03);
    assert.close(hi.X, 0, 0.05);
  });
});

suite('Mass law', () => {
  test('normal-incidence form: TL = 20log10(pi f m / rho c) - 4.8', () => {
    const ms = 10, f = 500;
    const expect = 20 * Math.log10((Math.PI * f * ms) / AIR.z0) - 4.8;
    assert.close(massLawTL(ms, f), expect, 1e-9);
  });
  test('doubling mass adds 6 dB', () => {
    assert.close(massLawTL(20, 500) - massLawTL(10, 500), 6.02, 0.01);
  });
  test('doubling frequency adds 6 dB', () => {
    assert.close(massLawTL(10, 1000) - massLawTL(10, 500), 6.02, 0.01);
  });
  test('12.5 mm plasterboard gives about 26 dB at 500 Hz', () => {
    const ms = MATERIALS.gypsum.density * 0.0125;
    assert.close(ms, 8.75, 0.01);
    // 20 log10(8.75 x 500) - 47.2 = 25.6 dB; published lab curves give 26 dB
    assert.close(massLawTL(ms, 500), 25.6, 0.5);
  });
});

suite('Coincidence frequency', () => {
  test('longitudinal wave speed formula', () => {
    const m = { youngsModulus: 200e9, density: 7850, poisson: 0.3 };
    assert.close(longitudinalSpeed(m), Math.sqrt(200e9 / (7850 * 0.91)), 1);
  });
  test('6 mm float glass has f_c near 2000 Hz', () => {
    assert.close(criticalFrequency(MATERIALS.glass, 6), 2000, 250);
  });
  test('1 mm steel sheet has f_c near 12 kHz', () => {
    assert.close(criticalFrequency(MATERIALS.steel, 1.0), 12300, 1200);
  });
  test('12.5 mm plasterboard has f_c near 2600 Hz', () => {
    assert.close(criticalFrequency(MATERIALS.gypsum, 12.5), 2600, 300);
  });
  test('150 mm concrete has f_c near 120 Hz', () => {
    assert.close(criticalFrequency(MATERIALS.concrete, 150), 120, 20);
  });
  test('f_c scales inversely with thickness', () => {
    const a = criticalFrequency(MATERIALS.gypsum, 12.5);
    const b = criticalFrequency(MATERIALS.gypsum, 25);
    assert.close(a / b, 2, 0.02);
  });
  test('MLV is limp: f_c is pushed above the audible range', () => {
    assert.greater(criticalFrequency(MATERIALS.mlv, 2.6), 20000);
  });
});

suite('Single-leaf transmission loss', () => {
  test('all bands finite and non-negative', () => {
    const r = singleLeafTL({ layers: [{ material: MATERIALS.gypsum, thicknessMm: 12.5 }] });
    assert.finiteArray(r.tl);
    for (const v of r.tl) assert.ok(v >= 0);
  });
  test('follows mass law well below f_c', () => {
    const leaf = { layers: [{ material: MATERIALS.gypsum, thicknessMm: 12.5 }], widthM: 3, heightM: 3 };
    const r = singleLeafTL(leaf);
    const i = THIRD_OCTAVE.indexOf(250); // f_c is ~2600, so 250 is < 0.5 f_c
    assert.close(r.tl[i], massLawTL(r.surfaceMass, THIRD_OCTAVE_EXACT[i]), 0.5);
  });
  test('shows a dip at the coincidence frequency', () => {
    const leaf = { layers: [{ material: MATERIALS.glass, thicknessMm: 6 }], widthM: 1.2, heightM: 1.2 };
    const r = singleLeafTL(leaf);
    const ifc = THIRD_OCTAVE.indexOf(2000);
    const deficit = massLawTL(r.surfaceMass, 2000) - r.tl[ifc];
    assert.greater(deficit, 3, 'glass should dip at least 3 dB below mass law at f_c');
  });
  test('never exceeds mass law above the fundamental panel mode', () => {
    // Below f_11 the panel is stiffness-controlled and legitimately beats mass
    // law; above it, mass law is the ceiling and exceeding it would be a bug.
    for (const [id, m] of Object.entries(MATERIALS)) {
      if (m.role === 'porous' || m.role === 'damping') continue;
      const t = m.availableThicknessesMm?.[1] ?? 12;
      const r = singleLeafTL({ layers: [{ material: m, thicknessMm: t }], widthM: 2, heightM: 2 });
      for (let i = 0; i < N_BANDS; i++) {
        if (THIRD_OCTAVE_EXACT[i] < r.f11) continue;
        const ml = massLawTL(r.surfaceMass, THIRD_OCTAVE_EXACT[i]);
        assert.ok(r.tl[i] <= ml + 0.01,
          `${id}: TL ${r.tl[i].toFixed(1)} exceeds mass law ${ml.toFixed(1)} at ${THIRD_OCTAVE[i]} Hz`);
      }
    }
  });
  test('damping compound between layers raises high-frequency TL', () => {
    const layers = [{ material: MATERIALS.gypsum, thicknessMm: 12.5 }, { material: MATERIALS.gypsum, thicknessMm: 12.5 }];
    const plain = singleLeafTL({ layers, bonding: 'screwed', widthM: 2, heightM: 2 });
    const damped = singleLeafTL({ layers, bonding: 'damped', widthM: 2, heightM: 2 });
    const i = THIRD_OCTAVE.indexOf(2500);
    assert.greater(damped.tl[i], plain.tl[i] + 2);
  });
  test('EN 12354 total loss factor adds radiation damping', () => {
    assert.greater(totalLossFactor(0.01, 460, 100), 0.01);
    assert.close(totalLossFactor(0.01, 0, 100), 0.01, 1e-9);
  });
  test('panel resonance falls as the panel gets larger', () => {
    const small = panelResonance({ layers: [{ material: MATERIALS.gypsum, thicknessMm: 12.5 }], widthM: 0.6, heightM: 0.6 });
    const big = panelResonance({ layers: [{ material: MATERIALS.gypsum, thicknessMm: 12.5 }], widthM: 3, heightM: 3 });
    assert.greater(small, big);
  });
});

suite('Mass-air-mass resonance', () => {
  test('matches the analytic f0 = 60 sqrt((1/m1+1/m2)/d) for an empty cavity', () => {
    const f = massAirMass(10, 10, 100, 0);
    assert.close(f, 60 * Math.sqrt((1 / 10 + 1 / 10) / 0.1), 0.01);
  });
  test('f0 falls as 1/sqrt(cavity depth)', () => {
    const a = massAirMass(10, 10, 50, 0);
    const b = massAirMass(10, 10, 200, 0);
    assert.close(a / b, 2, 0.02);
  });
  test('f0 falls as 1/sqrt(mass)', () => {
    const a = massAirMass(10, 10, 100, 0);
    const b = massAirMass(40, 40, 100, 0);
    assert.close(a / b, 2, 0.02);
  });
  test('filling the cavity lowers f0 (adiabatic -> isothermal)', () => {
    assert.less(massAirMass(10, 10, 100, 1), massAirMass(10, 10, 100, 0));
  });
  test('typical booth wall resonates in the 50-100 Hz range', () => {
    assert.between(massAirMass(17.5, 22, 100, 0.75), 40, 90);
  });
  test('cavity depth resonances are at n*c/2d', () => {
    const r = cavityResonances(100);
    assert.close(r[0], 343 / 0.2, 1);
    assert.close(r[1], 2 * 343 / 0.2, 1);
  });
});

suite('Double-leaf partitions', () => {
  const mk = (depth, fill, conn) => ({
    leaves: [
      { layers: [{ material: MATERIALS.gypsum, thicknessMm: 12.5 }], widthM: 0.4, heightM: 2.4 },
      { layers: [{ material: MATERIALS.gypsum, thicknessMm: 12.5 }], widthM: 0.4, heightM: 2.4 },
    ],
    cavities: [{ depthMm: depth, fill: fill ? MATERIALS['rockwool-rwa45'] : null, fillThicknessMm: fill ? depth * 0.75 : 0 }],
    connection: conn, areaM2: 10,
  });

  test('all bands finite', () => {
    assert.finiteArray(partitionTL(mk(100, true, CONNECTIONS['rigid-stud'])).tl);
  });

  test('a double leaf beats a single leaf of the same total mass', () => {
    const dbl = partitionTL(mk(100, true, CONNECTIONS['separate-frame']));
    const sgl = singleLeafTL({
      layers: [{ material: MATERIALS.gypsum, thicknessMm: 12.5 }, { material: MATERIALS.gypsum, thicknessMm: 12.5 }],
      bonding: 'screwed', widthM: 0.4, heightM: 2.4,
    });
    const i = THIRD_OCTAVE.indexOf(1000);
    assert.greater(dbl.tl[i], sgl.tl[i] + 5);
  });

  test('deeper cavity improves mid-frequency TL', () => {
    const shallow = partitionTL(mk(25, true, CONNECTIONS['separate-frame']));
    const deep = partitionTL(mk(200, true, CONNECTIONS['separate-frame']));
    const i = THIRD_OCTAVE.indexOf(500);
    assert.greater(deep.tl[i], shallow.tl[i]);
  });

  test('deeper cavity lowers the mass-air-mass resonance', () => {
    assert.less(partitionTL(mk(200, true, CONNECTIONS['separate-frame'])).f0,
      partitionTL(mk(25, true, CONNECTIONS['separate-frame'])).f0);
  });

  test('cavity insulation improves TL', () => {
    const empty = partitionTL(mk(100, false, CONNECTIONS['rigid-stud']));
    const full = partitionTL(mk(100, true, CONNECTIONS['rigid-stud']));
    assert.greater(computeSTC(full.tl).stc, computeSTC(empty.tl).stc);
  });

  test('decoupling improves TL monotonically across connection types', () => {
    const order = ['rigid-stud', 'staggered-stud', 'resilient-channel', 'separate-frame'];
    const stcs = order.map((c) => computeSTC(partitionTL(mk(100, true, CONNECTIONS[c])).tl).stc);
    assert.monotonic(stcs, 'up', 0, `expected improvement across ${order.join(' < ')}, got ${stcs.join(', ')}`);
  });

  test('bridging attenuation rises with frequency and saturates at the ceiling', () => {
    const c = CONNECTIONS['resilient-channel'];
    const lo = bridgingAttenuation(c, 63);
    const hi = bridgingAttenuation(c, 4000);
    assert.greater(hi, lo);
    assert.ok(hi <= c.maxIsolationDb + 11.01);
  });

  test('leaf damping improves the bridged path', () => {
    assert.greater(bridgingAttenuation(CONNECTIONS['rigid-stud'], 500, 0.13),
      bridgingAttenuation(CONNECTIONS['rigid-stud'], 500, 0.015));
  });

  test('an empty cavity shows a deeper mass-air-mass dip than a filled one', () => {
    const empty = partitionTL(mk(100, false, CONNECTIONS['separate-frame']));
    const full = partitionTL(mk(100, true, CONNECTIONS['separate-frame']));
    // Find the band nearest f0 and compare deficits below combined mass law
    const f0 = empty.f0;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < N_BANDS; i++) {
      const d = Math.abs(Math.log(THIRD_OCTAVE_EXACT[i] / f0));
      if (d < bd) { bd = d; bi = i; }
    }
    const ml = massLawTL(17.5, THIRD_OCTAVE_EXACT[bi]);
    assert.greater(ml - empty.tl[bi], ml - full.tl[bi]);
  });
});

suite('Porous absorption (Miki model)', () => {
  test('absorption coefficients stay in [0,1]', () => {
    for (const t of [25, 50, 100, 200]) {
      for (const a of porousAlpha(12000, t)) assert.between(a, 0, 1);
    }
  });
  test('thicker absorber works lower in frequency', () => {
    const thin = porousAlpha(12000, 25);
    const thick = porousAlpha(12000, 200);
    assert.greater(thick[THIRD_OCTAVE.indexOf(125)], thin[THIRD_OCTAVE.indexOf(125)]);
  });
  test('quarter-wave rule: 50 mm is effective from about 1.7 kHz', () => {
    const a = porousAlpha(12000, 50);
    assert.greater(a[THIRD_OCTAVE.indexOf(2000)], 0.6);
    assert.less(a[THIRD_OCTAVE.indexOf(100)], 0.3);
  });
  test('an air gap behind the absorber extends low-frequency performance', () => {
    const direct = porousAlpha(12000, 50, 0);
    const gapped = porousAlpha(12000, 50, 100);
    assert.greater(gapped[THIRD_OCTAVE.indexOf(250)], direct[THIRD_OCTAVE.indexOf(250)]);
  });
});

suite('Ratings', () => {
  test('STC of a flat 40 dB TL is 40', () => {
    assert.equal(computeSTC(new Array(24).fill(40)).stc, 40);
  });
  test('STC obeys the 8 dB single-band deficiency rule', () => {
    const tl = new Array(24).fill(50);
    tl[THIRD_OCTAVE.indexOf(500)] = 20;  // huge dip at the contour reference band
    assert.less(computeSTC(tl).stc, 40);
  });
  test('STC rises with uniformly better TL', () => {
    assert.greater(computeSTC(new Array(24).fill(55)).stc, computeSTC(new Array(24).fill(45)).stc);
  });
  test('Rw of a flat spectrum is close to that value', () => {
    // An ideal flat curve fits the ISO contour at Rw = 44 (the contour rises
    // +6 dB above 1 kHz, so a flat curve accrues deviations there).
    const r = computeRw(new Array(24).fill(45));
    assert.close(r.rw, 45, 2);
  });
  test('Ctr is negative for a realistic rising TL curve', () => {
    // Real partitions rise ~6 dB/octave, which is what makes Ctr negative:
    // the traffic spectrum is low-frequency weighted and the wall is weakest there.
    const rising = THIRD_OCTAVE_EXACT.map((f) => 20 + 20 * Math.log10(f / 100));
    const r = computeRw(rising);
    assert.less(r.ctr, 0, `expected negative Ctr, got ${r.ctr}`);
    assert.ok(r.ctr <= r.c, 'Ctr must not exceed C');
  });
  test('NR curve identifies the governing band', () => {
    const oct = [70, 60, 50, 45, 40, 35, 30, 25];
    const r = computeNR(oct);
    assert.ok(r.nr > 0);
    assert.ok(OCTAVE.includes(r.governingBand));
  });
});

suite('Room acoustics', () => {
  test('Sabine RT formula', () => {
    assert.close(sabineRT(100, 20), (0.161 * 100) / 20, 1e-9);
  });
  test('room constant increases with absorption', () => {
    assert.greater(roomConstant(100, 0.5), roomConstant(100, 0.1));
  });
  test('box-envelope SPL falls with distance', () => {
    const box = { l: 1.5, w: 1.5, h: 2.1 };
    assert.greater(boxEnvelopeSPL(80, box, 0.5), boxEnvelopeSPL(80, box, 4));
  });
  test('doubling distance in the far field approaches -6 dB', () => {
    const box = { l: 0.1, w: 0.1, h: 0.1 }; // effectively a point source
    const d = boxEnvelopeSPL(80, box, 8) - boxEnvelopeSPL(80, box, 16);
    assert.close(d, 6, 1.0);
  });
});

suite('Vibration isolation', () => {
  test('transmissibility is 1 at very low frequency', () => {
    assert.close(transmissibility(0.1, 10, 0.05), 1, 0.01);
  });
  test('transmissibility peaks at resonance', () => {
    const at = transmissibility(10, 10, 0.05);
    assert.greater(at, 5);
    assert.greater(at, transmissibility(30, 10, 0.05));
  });
  test('an isolator amplifies just above its resonance and attenuates far above', () => {
    assert.greater(transmissibility(12, 10, 0.05), 1);
    assert.less(transmissibility(100, 10, 0.05), 0.1);
  });
  test('a stiff mount amplifies inside the analysis band range', () => {
    // A 40 Hz rubber mat still amplifies at 50 Hz — the classic trap of
    // "adding isolation" that makes low frequencies worse.
    const att = isolatorAttenuation(ISOLATORS['rubber-mat']);
    assert.ok(att.some((v) => v < 0),
      `expected amplification in some band, got ${att.slice(0, 4).map((v) => v.toFixed(1)).join(', ')}`);
  });
  test('softer mounts isolate better at low frequency', () => {
    const stiff = isolatorAttenuation(ISOLATORS['rubber-mat']);
    const soft = isolatorAttenuation(ISOLATORS['spring-mounts']);
    const i = THIRD_OCTAVE.indexOf(63);
    assert.greater(soft[i], stiff[i]);
  });
  test('static deflection to natural frequency', () => {
    assert.close(fnFromDeflection(25), 15.76 / 5, 0.01);
  });
});

suite('Ducts', () => {
  test('end reflection loss is large for small ducts at low frequency', () => {
    const er = endReflectionLoss({ shape: 'round', diameterMm: 100, segments: [] });
    assert.greater(er[THIRD_OCTAVE.indexOf(63)], 10);
    assert.less(er[THIRD_OCTAVE.indexOf(4000)], 1);
  });
  test('geometry: round duct area and perimeter', () => {
    const g = ductGeometry({ shape: 'round', diameterMm: 100 }, 0);
    assert.close(g.A, Math.PI * 0.05 * 0.05, 1e-9);
    assert.close(g.P, Math.PI * 0.1, 1e-9);
  });
  test('lining reduces the free area', () => {
    const bare = ductGeometry({ shape: 'round', diameterMm: 200 }, 0);
    const lined = ductGeometry({ shape: 'round', diameterMm: 200 }, 25);
    assert.less(lined.A, bare.A);
  });
  test('lined duct attenuates far more than unlined', () => {
    const duct = { shape: 'round', diameterMm: 150, segments: [] };
    const lined = linedDuctAttenPerM(duct, { kind: 'straight', lined: true, liningMm: 25 });
    const bare = linedDuctAttenPerM(duct, { kind: 'straight', lined: false });
    const i = THIRD_OCTAVE.indexOf(1000);
    assert.greater(lined[i], bare[i] * 5);
  });
  test('required airflow scales with occupancy and volume', () => {
    const a = requiredAirflowLps({ volumeM3: 3, occupants: 1 });
    const b = requiredAirflowLps({ volumeM3: 3, occupants: 3 });
    assert.greater(b.required, a.required);
    assert.ok(a.required > 0);
  });
});

suite('Material advisor', () => {
  test('acoustic foam scores high for absorption and low for blocking', () => {
    const a = assessMaterial(MATERIALS['acoustic-foam'], 50);
    assert.greater(a.scores.absorbing, 2);
    assert.less(a.scores.blocking, 2);
    const text = a.headline + ' ' + a.explanation.join(' ') + ' ' + a.warnings.join(' ');
    assert.ok(/NOT stop sound|Absorber only|not count this material/i.test(text), text.slice(0, 160));
  });
  test('plasterboard scores for blocking, not absorption', () => {
    const a = assessMaterial(MATERIALS.gypsum, 12.5);
    assert.greater(a.scores.blocking, 2);
    assert.equal(a.scores.absorbing, 0);
  });
  test('concrete is the strongest blocker in the database', () => {
    assert.equal(assessMaterial(MATERIALS.concrete, 200).scores.blocking, 5);
  });
  test('undamped steel is flagged for ringing', () => {
    const a = assessMaterial(MATERIALS.steel, 1.0);
    assert.ok(a.warnings.some((w) => /ring|loss factor/i.test(w)));
  });
  test('MLV is identified as genuinely limp', () => {
    const a = assessMaterial(MATERIALS.mlv, 2.6);
    assert.ok(a.explanation.join(' ').includes('limp'));
  });
  test('every material produces a finite assessment', () => {
    for (const [id, m] of Object.entries(MATERIALS)) {
      const t = m.availableThicknessesMm?.[0] ?? 12;
      const a = assessMaterial(m, t);
      assert.ok(isFinite(a.surfaceMass), `${id} surface mass`);
      assert.finiteArray(a.tl, `${id} TL curve`);
      assert.ok(a.headline.length > 0, `${id} headline`);
    }
  });
});
