/**
 * Ventilation duct acoustics.
 *
 * A booth must breathe, and the vent is very often the single worst path.
 * This module computes the insertion loss of a duct run and the noise it
 * lets out, using the standard ASHRAE / Sabine element-by-element method:
 *
 *   IL_total = IL_lined_duct + IL_bends + IL_silencer + IL_end_reflection
 *              + IL_plenum  -  regenerated_noise_penalty
 *
 * Key equations
 *   Lined straight duct (Sabine):  dL/m = 1.05 * alpha^1.4 * P / A
 *   High-frequency roll-off above f where the duct width approaches lambda/2
 *   Lined 90 deg bend: frequency-dependent table on f*w (ASHRAE)
 *   End reflection loss: ER = 10 log10[1 + (0.8 c /(pi f D))^1.88]
 *   Breakout: sound radiating through the duct wall, treated as its own leak
 *
 * It also sizes the duct: required airflow for the occupancy, the maximum
 * velocity for a given self-noise target, and the minimum attenuator needed
 * to reach a target isolation.
 */

import { AIR } from './constants.mjs';
import { THIRD_OCTAVE_EXACT, N_BANDS, THIRD_OCTAVE } from './bands.mjs';
import { porousAlpha } from './acoustics.mjs';
import { tlToTau, tauToTL, dbSum } from './acoustics.mjs';
import { gapTau, gapArea } from './leaks.mjs';

/**
 * @typedef {Object} DuctSegment
 * @property {'straight'|'bend'|'silencer'|'plenum'|'flex'} kind
 * @property {number} [lengthM]
 * @property {number} [angleDeg]      for bends, 45 or 90
 * @property {boolean} [lined]
 * @property {number} [liningMm]
 * @property {number} [liningResistivity]
 * @property {number} [volumeM3]      for plenums
 * @property {number} [plenumAlpha]
 */

/**
 * @typedef {Object} DuctSpec
 * @property {string} id
 * @property {string} [label]
 * @property {'round'|'rect'} shape
 * @property {number} diameterMm          round
 * @property {number} [widthMm]           rect
 * @property {number} [heightMm]          rect
 * @property {DuctSegment[]} segments
 * @property {number} [count]             number of identical ducts (supply + extract)
 * @property {number} [wallThicknessMm]
 * @property {import('../data/materials.mjs').Material} [wallMaterial]
 * @property {number} [airflowLps]        design airflow, litres/second
 * @property {number} [fanSwl]            fan sound power, dB (flat) — or use fanSpectrum
 * @property {number[]} [fanSpectrum]     24-band fan SWL
 * @property {boolean} [terminatesOutside] duct discharges to the receiver space
 */

/** Free cross-sectional area (m^2) and lined perimeter (m). */
export function ductGeometry(duct, liningMm = 0) {
  if (duct.shape === 'round') {
    const d = (duct.diameterMm - 2 * liningMm) / 1000;
    return { A: (Math.PI * d * d) / 4, P: Math.PI * d, width: d, hydraulic: d };
  }
  const w = (duct.widthMm - 2 * liningMm) / 1000;
  const h = (duct.heightMm - 2 * liningMm) / 1000;
  return { A: w * h, P: 2 * (w + h), width: Math.min(w, h), hydraulic: (2 * w * h) / (w + h) };
}

/**
 * Sabine lined-duct attenuation, dB per metre, 24-band.
 * Includes the standard high-frequency limitation: once the duct's clear
 * width exceeds about lambda/2 the sound beams down the middle and the lining
 * stops working, so attenuation falls back toward the unlined value.
 */
export function linedDuctAttenPerM(duct, seg) {
  const liningMm = seg.liningMm ?? 25;
  const sigma = seg.liningResistivity ?? 16000;
  const { A, P, width } = ductGeometry(duct, seg.lined ? liningMm : 0);
  const alpha = seg.lined ? porousAlpha(sigma, liningMm, 0) : new Array(N_BANDS).fill(0.02);

  return THIRD_OCTAVE_EXACT.map((f, i) => {
    const base = 1.05 * Math.pow(Math.min(alpha[i], 0.98), 1.4) * (P / Math.max(A, 1e-4));
    // Beaming roll-off above f_limit = c / (2 * clear width)
    const fLimit = AIR.c / (2 * Math.max(width, 0.02));
    let v = base;
    if (f > fLimit) v = base * Math.pow(fLimit / f, 0.85);
    // Unlined sheet-metal duct: small but nonzero (ASHRAE ~0.03-0.1 dB/m)
    if (!seg.lined) v = f < 250 ? 0.1 : 0.06;
    return Math.min(v, 60); // physical cap on dB/m
  });
}

/**
 * Insertion loss of a 90-degree bend, 24-band.
 * Unlined mitred bends give little below the cut-on frequency; lined bends
 * give substantial attenuation once f*w is large. Table follows ASHRAE.
 * @param {DuctSpec} duct
 * @param {DuctSegment} seg
 */
export function bendIL(duct, seg) {
  const { width } = ductGeometry(duct, seg.lined ? (seg.liningMm ?? 25) : 0);
  const lined = !!seg.lined;
  const angle = seg.angleDeg ?? 90;
  const scale = angle >= 90 ? 1 : angle / 90;

  // Values keyed on f*w (Hz*m): [unlined, lined]
  const table = [
    [0.0, 0, 0],
    [1.9, 0, 0],
    [3.8, 1, 1],
    [7.5, 2, 5],
    [15, 3, 8],
    [30, 3, 4],
    [60, 3, 3],
  ];
  return THIRD_OCTAVE_EXACT.map((f) => {
    const fw = (f * width) / 100; // normalised to the ASHRAE fw/100 abscissa
    let v = 0;
    for (let i = 1; i < table.length; i++) {
      if (fw <= table[i][0]) {
        const [x0, u0, l0] = table[i - 1];
        const [x1, u1, l1] = table[i];
        const w = (fw - x0) / (x1 - x0 || 1);
        v = lined ? l0 + w * (l1 - l0) : u0 + w * (u1 - u0);
        break;
      }
      v = lined ? table[table.length - 1][2] : table[table.length - 1][1];
    }
    return v * scale;
  });
}

/**
 * Plenum / expansion chamber insertion loss (ASHRAE simplified):
 * IL = -10 log10[ S_out ( cos(theta)/(2 pi r^2) + (1-alpha)/(alpha S_total) ) ]
 * Approximated here with a lumped form good to a few dB.
 */
export function plenumIL(duct, seg) {
  const V = seg.volumeM3 ?? 0.05;
  const alpha = seg.plenumAlpha ?? 0.7;
  const { A } = ductGeometry(duct, 0);
  const S = 6 * Math.pow(V, 2 / 3);
  return THIRD_OCTAVE_EXACT.map((f) => {
    const lam = AIR.c / f;
    // Below the plenum's first mode it acts as a simple expansion; above it
    // becomes an absorptive chamber.
    const geo = 10 * Math.log10(1 + (alpha * S) / Math.max(A, 1e-4) / 8);
    const modal = Math.pow(V, 1 / 3) > lam / 2 ? 3 : 0;
    return Math.max(0, geo + modal);
  });
}

/**
 * Duct end reflection loss at a termination (ASHRAE).
 * ER = 10 log10[1 + (0.8 c / (pi f D))^1.88]
 * Significant at low frequency for small ducts — a 100 mm duct gives ~14 dB
 * at 63 Hz, which is why small vents leak mostly mid/high frequency.
 */
export function endReflectionLoss(duct, flush = true) {
  const { hydraulic } = ductGeometry(duct, 0);
  const k = flush ? 0.8 : 1.0;
  return THIRD_OCTAVE_EXACT.map((f) =>
    10 * Math.log10(1 + Math.pow((k * AIR.c) / (Math.PI * f * Math.max(hydraulic, 0.02)), 1.88))
  );
}

/**
 * Regenerated (self) noise from air moving through the duct and any attenuator.
 * Simplified from ASHRAE: SWL rises as ~50 log10(velocity).
 * @param {number} velocityMs
 * @param {number} areaM2
 */
export function regeneratedNoise(velocityMs, areaM2, hasSilencer = false) {
  if (velocityMs <= 0.05) return new Array(N_BANDS).fill(-20);
  const base = 10 + 50 * Math.log10(velocityMs) + 10 * Math.log10(Math.max(areaM2, 1e-3));
  const shape = [4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -11, -13, -15, -17, -20, -23, -26, -30, -34, -38];
  const bump = hasSilencer ? 4 : 0;
  return shape.map((s) => base + s + 40 + bump);
}

/** Air velocity in the duct, m/s. */
export function ductVelocity(duct) {
  const { A } = ductGeometry(duct, 0);
  const q = (duct.airflowLps ?? 0) / 1000;
  return A > 0 ? q / A : 0;
}

/**
 * Total insertion loss of a duct run, plus a full element-by-element breakdown.
 * @param {DuctSpec} duct
 * @returns {{il:number[], breakdown:{label:string, il:number[]}[], velocity:number, warnings:string[]}}
 */
export function ductInsertionLoss(duct, opts = {}) {
  const il = new Array(N_BANDS).fill(0);
  const breakdown = [];
  const warnings = [];

  for (const seg of duct.segments) {
    let contrib = new Array(N_BANDS).fill(0);
    let label = '';
    switch (seg.kind) {
      case 'straight':
      case 'flex': {
        const perM = linedDuctAttenPerM(duct, seg);
        const len = seg.lengthM ?? 1;
        // Flexible ducting is far better than rigid: corrugations + lining.
        const flexBonus = seg.kind === 'flex' ? 2.2 : 1.0;
        contrib = perM.map((v) => v * len * flexBonus);
        label = `${seg.kind === 'flex' ? 'Flexible' : 'Straight'} duct, ${len} m${seg.lined ? `, ${seg.liningMm ?? 25} mm lining` : ', unlined'}`;
        break;
      }
      case 'bend':
        contrib = bendIL(duct, seg);
        label = `${seg.angleDeg ?? 90}° bend${seg.lined ? ', lined' : ', unlined'}`;
        break;
      case 'silencer': {
        // A packaged attenuator: model as a heavily lined duct of its length.
        const perM = linedDuctAttenPerM(duct, { ...seg, lined: true, liningMm: seg.liningMm ?? 50, liningResistivity: seg.liningResistivity ?? 20000 });
        const len = seg.lengthM ?? 0.6;
        contrib = perM.map((v) => Math.min(v * len * 1.5, 45));
        label = `Packaged attenuator, ${(len * 1000).toFixed(0)} mm, ${seg.liningMm ?? 50} mm lining`;
        break;
      }
      case 'plenum':
        contrib = plenumIL(duct, seg);
        label = `Plenum / expansion box, ${(seg.volumeM3 ?? 0.05).toFixed(3)} m³`;
        break;
    }
    for (let i = 0; i < N_BANDS; i++) il[i] += contrib[i];
    breakdown.push({ label, il: contrib });
  }

  // End reflection at the discharge
  const er = endReflectionLoss(duct, true);
  for (let i = 0; i < N_BANDS; i++) il[i] += er[i];
  breakdown.push({ label: 'End reflection loss at discharge', il: er });

  const velocity = ductVelocity(duct);
  if (velocity > 5) warnings.push(`Duct velocity ${velocity.toFixed(1)} m/s is high. Above ~5 m/s the duct generates its own noise and the attenuator becomes a source. Increase the duct size.`);
  else if (velocity > 3) warnings.push(`Duct velocity ${velocity.toFixed(1)} m/s. Aim below 3 m/s for a quiet booth.`);

  const { width } = ductGeometry(duct, 0);
  const straightLined = duct.segments.filter((s) => s.kind === 'straight' && s.lined).reduce((a, s) => a + (s.lengthM ?? 0), 0);
  if (straightLined > 0 && width > 0.3) warnings.push('Duct is wide relative to its lining; high-frequency attenuation will be limited by beaming down the centre.');

  const bends = duct.segments.filter((s) => s.kind === 'bend').length;
  if (bends === 0) warnings.push('The duct has no bends. A straight duct is an acoustic pipe — add at least two lined 90° bends to form a labyrinth.');

  return { il, breakdown, velocity, warnings, endReflection: er };
}

/**
 * Duct breakout transmission loss: the loss between the sound power travelling
 * along the bore and the power radiated out through the duct's own walls.
 *
 * Defined *relative to the bore power*, which is what keeps the model
 * physically bounded — a duct can never radiate more than it carries.
 * Follows the ASHRAE treatment: a mass-law shell with an empirical floor,
 * plus a large bonus for round ducts because a circular shell is far stiffer
 * in its breathing modes than a flat rectangular panel of the same gauge.
 */
export function ductBreakoutTL(duct) {
  const ms = (duct.wallMaterial?.density || 7850) * ((duct.wallThicknessMm || 0.5) / 1000);
  const { width } = ductGeometry(duct, 0);
  const roundBonus = duct.shape === 'round' ? 14 : 0;
  // A lined duct also damps its own shell.
  const lined = duct.segments.some((s) => s.lined || s.kind === 'silencer');
  return THIRD_OCTAVE_EXACT.map((f) => {
    let tl = 20 * Math.log10(Math.max(ms, 0.1) * f) - 45 + roundBonus + (lined ? 5 : 0);
    // Rectangular ducts above their cross-mode cut-on break out more readily.
    const fCutOn = AIR.c / (2 * Math.max(width, 0.05));
    if (f > fCutOn && duct.shape !== 'round') tl -= 4;
    return Math.max(6, Math.min(tl, 60));
  });
}

/**
 * The duct's effective transmitting area (S * tau) for the enclosure balance.
 *
 * Two mechanisms, both referenced to the *bore* so that total transmitted
 * power can never exceed the power the duct inlet accepted:
 *   (a) sound travelling down the bore and out of the discharge
 *   (b) breakout: sound leaving through the duct wall part-way along the run
 *
 * For (b) the driving level at each segment is the in-duct level *after* the
 * upstream insertion loss, so a labyrinth breaks out mostly from its first
 * metre — which is normally still inside the booth wall and therefore does
 * not reach the receiver at all. Only segments downstream of the envelope
 * (everything after `segmentsInsideEnvelope`) are counted.
 */
export function ductEffectiveArea(duct, opts = {}) {
  const n = duct.count || 1;
  const { il } = ductInsertionLoss(duct, opts);
  const { A, hydraulic } = ductGeometry(duct, 0);

  // (a) Bore path. The inlet accepts diffuse-field power over its open area,
  // modulated by its own aperture transmission, then the insertion loss applies.
  const inlet = { shape: 'hole', widthMm: hydraulic * 1000, depthMm: 20 };
  const inletTau = gapTau(inlet, opts);
  const bore = il.map((v, i) => n * A * Math.min(inletTau[i], 1) * tlToTau(v));

  // (b) Breakout, walked segment by segment with the cumulative upstream IL.
  const breakout = new Array(N_BANDS).fill(0);
  if (duct.wallMaterial && duct.wallThicknessMm) {
    const breakTL = ductBreakoutTL(duct);
    const skip = duct.segmentsInsideEnvelope ?? 1;
    const cum = new Array(N_BANDS).fill(0);
    const totalLen = duct.segments.reduce((a, s) => a + (s.lengthM ?? 0.3), 0) || 1;

    duct.segments.forEach((seg, si) => {
      const segLen = seg.lengthM ?? 0.3;
      // IL accumulated by this segment
      let segIL = new Array(N_BANDS).fill(0);
      if (seg.kind === 'straight' || seg.kind === 'flex') {
        const perM = linedDuctAttenPerM(duct, seg);
        const fx = seg.kind === 'flex' ? 2.2 : 1.0;
        segIL = perM.map((v) => v * segLen * fx);
      } else if (seg.kind === 'bend') segIL = bendIL(duct, seg);
      else if (seg.kind === 'plenum') segIL = plenumIL(duct, seg);
      else if (seg.kind === 'silencer') {
        const perM = linedDuctAttenPerM(duct, { ...seg, lined: true, liningMm: seg.liningMm ?? 50 });
        segIL = perM.map((v) => Math.min(v * segLen * 1.5, 45));
      }

      if (si >= skip) {
        // Fraction of the *bore* power radiated out of this segment's walls,
        // weighted by its share of the run length and attenuated by upstream IL.
        const share = segLen / totalLen;
        for (let i = 0; i < N_BANDS; i++) {
          breakout[i] += n * A * Math.min(inletTau[i], 1)
            * tlToTau(cum[i]) * tlToTau(breakTL[i]) * share;
        }
      }
      for (let i = 0; i < N_BANDS; i++) cum[i] += segIL[i];
    });
  }

  const total = bore.map((v, i) => v + breakout[i]);
  return {
    total,
    paths: [
      { id: 'duct-bore', label: `${duct.label || 'Duct'} — down the bore`, eff: bore, area: A * n },
      { id: 'duct-breakout', label: `${duct.label || 'Duct'} — breakout through duct wall`, eff: breakout, area: 0 },
    ].filter((p) => p.eff.some((v) => v > 0)),
    il,
  };
}

/**
 * Fan noise radiated into the receiver space (not the booth source, the fan
 * itself). Applies the duct IL from the fan's position outward.
 * @returns {number[]} SWL into the receiving space
 */
export function fanNoiseSWL(duct, opts = {}) {
  if (!duct.fanSwl && !duct.fanSpectrum) return null;
  const { il } = ductInsertionLoss(duct, opts);
  const spectrum = duct.fanSpectrum ||
    // Typical small inline fan: broadband with a blade-pass hump at 250-500 Hz
    THIRD_OCTAVE_EXACT.map((f) => duct.fanSwl - 3 + 6 * Math.exp(-Math.pow(Math.log10(f / 350), 2) / 0.08) - 8 * Math.max(0, Math.log10(f / 1000)));
  // Only the downstream half of the run attenuates fan noise reaching the receiver.
  return spectrum.map((v, i) => v - il[i] * 0.5);
}

/* ------------------------------------------------------------------ *
 *  Duct sizing / design recommendation
 * ------------------------------------------------------------------ */

/**
 * Required airflow for a booth.
 * Uses the higher of: (a) per-person outdoor air, (b) air changes per hour,
 * (c) the CO2-limited rate for a given occupancy and CO2 ceiling.
 * @param {{volumeM3:number, occupants:number, targetAch?:number, litresPerPerson?:number}} p
 */
export function requiredAirflowLps(p) {
  const perPerson = (p.litresPerPerson ?? 10) * (p.occupants ?? 1);
  const ach = ((p.targetAch ?? 6) * p.volumeM3 * 1000) / 3600;
  // CO2 balance: Q = G / (C_in - C_out); G ~ 0.005 L/s CO2 per person at rest
  const co2 = (0.005 * (p.occupants ?? 1) * 1000) / (900 - 420) * 1000;
  return {
    perPerson, ach, co2,
    required: Math.max(perPerson, ach, co2),
    governing: perPerson >= ach && perPerson >= co2 ? 'occupant fresh air'
      : ach >= co2 ? 'air change rate' : 'CO2 limit',
  };
}

/**
 * Recommend the minimum duct design that meets a target insertion loss.
 * Searches a small library of standard configurations, cheapest first.
 * @param {number[]} targetIL required IL per band
 * @param {{airflowLps:number, maxVelocity?:number}} constraints
 */
export function recommendDuct(targetIL, constraints) {
  const q = constraints.airflowLps;
  const vmax = constraints.maxVelocity ?? 2.5;
  const minArea = q / 1000 / vmax;
  const minDia = Math.ceil((Math.sqrt((4 * minArea) / Math.PI) * 1000) / 25) * 25;

  const catalogue = [];
  for (const dia of [Math.max(100, minDia), Math.max(125, minDia), Math.max(150, minDia), Math.max(200, minDia), Math.max(250, minDia)]) {
    for (const bends of [2, 3, 4]) {
      for (const lining of [25, 50]) {
        for (const len of [1, 2, 3, 4]) {
          for (const sil of [0, 1, 2]) {
            const segs = [];
            for (let b = 0; b < bends; b++) {
              segs.push({ kind: 'straight', lengthM: len / bends, lined: true, liningMm: lining });
              segs.push({ kind: 'bend', angleDeg: 90, lined: true, liningMm: lining });
            }
            for (let s = 0; s < sil; s++) segs.push({ kind: 'silencer', lengthM: 0.6, liningMm: 50 });
            const duct = { id: 'cand', shape: 'round', diameterMm: dia, segments: segs, airflowLps: q };
            const { il, velocity } = ductInsertionLoss(duct);
            const meets = targetIL.every((t, i) => il[i] >= t - 0.01);
            const cost = 18 * (dia / 100) * len + bends * 14 * (dia / 100) + sil * 70 * (dia / 100) + lining * 0.35 * len;
            catalogue.push({ duct, il, cost, meets, velocity, dia, bends, lining, len, silencers: sil });
          }
        }
      }
    }
  }
  const ok = catalogue.filter((c) => c.meets && c.velocity <= vmax).sort((a, b) => a.cost - b.cost);
  return {
    minDiameterMm: minDia,
    minAreaM2: minArea,
    best: ok[0] || null,
    alternatives: ok.slice(1, 4),
    infeasible: ok.length === 0,
  };
}

/** Preset duct designs, worst to best, for the UI dropdown. */
export const DUCT_PRESETS = {
  'open-hole': {
    id: 'open-hole', label: 'Open hole in the wall (no duct)', shape: 'round', diameterMm: 100,
    segments: [{ kind: 'straight', lengthM: 0.15, lined: false }],
  },
  'straight-unlined': {
    id: 'straight-unlined', label: 'Straight unlined 100 mm duct, 1 m', shape: 'round', diameterMm: 100,
    segments: [{ kind: 'straight', lengthM: 1, lined: false }],
  },
  'flex-2bend': {
    id: 'flex-2bend', label: 'Flexible duct, 2 m, two 90° bends', shape: 'round', diameterMm: 125,
    segments: [
      { kind: 'flex', lengthM: 1, lined: true, liningMm: 25 },
      { kind: 'bend', angleDeg: 90, lined: true },
      { kind: 'flex', lengthM: 1, lined: true, liningMm: 25 },
      { kind: 'bend', angleDeg: 90, lined: true },
    ],
  },
  labyrinth: {
    id: 'labyrinth', label: 'Lined labyrinth, 3 m, four 90° bends', shape: 'rect', widthMm: 200, heightMm: 150, diameterMm: 170,
    segments: [
      { kind: 'straight', lengthM: 0.75, lined: true, liningMm: 50 },
      { kind: 'bend', angleDeg: 90, lined: true, liningMm: 50 },
      { kind: 'straight', lengthM: 0.75, lined: true, liningMm: 50 },
      { kind: 'bend', angleDeg: 90, lined: true, liningMm: 50 },
      { kind: 'straight', lengthM: 0.75, lined: true, liningMm: 50 },
      { kind: 'bend', angleDeg: 90, lined: true, liningMm: 50 },
      { kind: 'straight', lengthM: 0.75, lined: true, liningMm: 50 },
      { kind: 'bend', angleDeg: 90, lined: true, liningMm: 50 },
    ],
  },
  'silenced-pro': {
    id: 'silenced-pro', label: 'Twin attenuators + plenum + labyrinth', shape: 'round', diameterMm: 150,
    segments: [
      { kind: 'silencer', lengthM: 0.9, liningMm: 50 },
      { kind: 'bend', angleDeg: 90, lined: true, liningMm: 50 },
      { kind: 'plenum', volumeM3: 0.12, plenumAlpha: 0.85 },
      { kind: 'bend', angleDeg: 90, lined: true, liningMm: 50 },
      { kind: 'silencer', lengthM: 0.9, liningMm: 50 },
      { kind: 'straight', lengthM: 0.5, lined: true, liningMm: 50 },
    ],
  },
};
