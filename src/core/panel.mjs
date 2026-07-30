/**
 * Single-leaf (monolithic panel) transmission loss.
 *
 * Model: field-incidence mass law below coincidence, Cremer/Sharp coincidence
 * region, damping-controlled region above f_c. Total loss factor follows
 * EN 12354-1 Annex: eta_tot = eta_int + m_s / (485 * sqrt(f)), which adds the
 * radiation loss and correctly softens the coincidence dip for heavy panels.
 *
 * Below the panel's first structural resonance the mass law over-predicts;
 * a stiffness-controlled correction is applied there (matters for small,
 * stiff booth panels at 50-100 Hz, which is exactly where booths fail).
 */

import { AIR } from './constants.mjs';
import { THIRD_OCTAVE_EXACT, N_BANDS } from './bands.mjs';

/**
 * Empirically calibrated engine constants.
 *
 * These are the only fitted numbers in the panel model. They are collected
 * here rather than buried in the code so they can be audited, and they were
 * fitted against the published laboratory set in core/validation.mjs — not
 * chosen to taste. See docs/06-VALIDATION.md for the fit and its residuals.
 */
export const PANEL_CONSTANTS = {
  /**
   * Offset in the damping-controlled region above the coincidence frequency.
   *
   * Sharp's classical result is TL = TL_mass + 10 log10(2 eta f / (pi f_c)),
   * i.e. an offset of 10 log10(eta) - 1.96 dB at f = f_c. That is derived for
   * an infinite panel in which *only* resonant (bending-wave) transmission
   * occurs, and it over-deepens the dip by 6-8 dB for real building boards,
   * which are finite and also transmit non-resonantly. Replacing the -1.96
   * with +5.5 reproduces the published curves for plasterboard, plywood, MDF
   * and glass to within about 3 dB.
   */
  coincidenceOffsetDb: 5.5,
  /** Hard floor on how far below mass law the coincidence dip may fall. */
  maxCoincidenceDipDb: 16,
  /**
   * Width of the coincidence plateau, in octaves above f_c, is
   * 0.3 + 12*eta(f_c), clamped to this range. Heavy damped walls get a broad
   * plateau; light lightly-damped boards get a narrow dip.
   */
  plateauMinOctaves: 0.3,
  plateauMaxOctaves: 1.4,
  /**
   * Offset applied to the mass law when it is summed in parallel as the
   * non-resonant ("forced") transmission path. 0 dB means TL asymptotes to
   * mass law far above f_c, which matches measured heavy-wall behaviour.
   */
  forcedPathOffsetDb: 0,
  /** Field-incidence correction applied to normal-incidence mass law. */
  fieldIncidenceCorrectionDb: 4.8,
  /** Scaling on the stiffness-controlled rise below the fundamental panel mode. */
  subResonanceScale: 0.55,
};

/**
 * @typedef {Object} Layer
 * @property {import('../data/materials.mjs').Material} material
 * @property {number} thicknessMm
 */

/**
 * @typedef {Object} Leaf
 * @property {Layer[]} layers
 * @property {'screwed'|'laminated'|'damped'} [bonding]  How layers are joined.
 * @property {number} [widthM]   panel free span, for modal correction
 * @property {number} [heightM]
 */

/** Surface density of a leaf, kg/m^2. */
export function surfaceMass(leaf) {
  return leaf.layers.reduce((s, l) => s + l.material.density * (l.thicknessMm / 1000), 0);
}

/** Total physical thickness, mm. */
export function leafThickness(leaf) {
  return leaf.layers.reduce((s, l) => s + l.thicknessMm, 0);
}

/** Cost of a leaf, currency per m^2. */
export function leafCost(leaf) {
  return leaf.layers.reduce((s, l) => s + (l.material.costPerM2PerMm || 0) * l.thicknessMm + (l.material.costPerM2Fixed || 0), 0);
}

/**
 * Longitudinal (quasi-plate) wave speed of a material, m/s.
 * c_L = sqrt(E / (rho (1 - nu^2)))
 */
export function longitudinalSpeed(m) {
  return Math.sqrt(m.youngsModulus / (m.density * (1 - m.poisson * m.poisson)));
}

/**
 * Critical (coincidence) frequency of a plate: f_c = c^2 / (1.8 c_L h).
 * @param {import('../data/materials.mjs').Material} m
 * @param {number} thicknessMm
 */
export function criticalFrequency(m, thicknessMm, air = AIR) {
  const h = thicknessMm / 1000;
  const cL = longitudinalSpeed(m);
  if (!isFinite(cL) || cL <= 0 || h <= 0) return 1e6;
  return (air.c * air.c) / (1.8 * cL * h);
}

/**
 * Effective critical frequency and internal loss factor for a multi-layer leaf.
 *
 *  - 'screwed'   : layers slip at the interface. Each behaves as its own plate,
 *                  so the leaf shows the f_c of its individual sheets while
 *                  carrying the combined mass. This is the normal case for
 *                  two layers of plasterboard screwed together.
 *  - 'laminated' : rigidly glued -> composite bending stiffness (parallel axis),
 *                  which *lowers* f_c and usually hurts.
 *  - 'damped'    : viscoelastic compound between layers -> constrained-layer
 *                  damping; f_c as 'screwed' but a large loss-factor boost.
 */
export function leafProperties(leaf, air = AIR) {
  const layers = leaf.layers;
  const bonding = leaf.bonding || 'screwed';
  const ms = surfaceMass(leaf);
  const h = leafThickness(leaf) / 1000;

  let fc, eta;
  const massWeighted = (fn) => {
    let num = 0, den = 0;
    for (const l of layers) {
      const m = l.material.density * (l.thicknessMm / 1000);
      num += fn(l) * m;
      den += m;
    }
    return den > 0 ? num / den : 0;
  };

  if (bonding === 'laminated' && layers.length > 1) {
    // Composite bending stiffness about the neutral axis.
    let z = 0, tot = 0;
    let acc = 0;
    for (const l of layers) { const t = l.thicknessMm / 1000; z += (acc + t / 2) * t; tot += t; acc += t; }
    const zBar = z / tot;
    let B = 0;
    acc = 0;
    for (const l of layers) {
      const t = l.thicknessMm / 1000;
      const m = l.material;
      const Ei = m.youngsModulus / (1 - m.poisson * m.poisson);
      const zc = acc + t / 2;
      B += Ei * ((t * t * t) / 12 + t * Math.pow(zc - zBar, 2));
      acc += t;
    }
    fc = (air.c * air.c) / (2 * Math.PI) * Math.sqrt(ms / B);
    eta = massWeighted((l) => l.material.lossFactor);
  } else {
    // Slip-bonded: dominated by the stiffest/thickest individual sheet.
    const fcs = layers.map((l) => criticalFrequency(l.material, l.thicknessMm, air));
    // Energy-weighted geometric blend, biased to the lowest f_c (weakest link).
    const inv = layers.map((l, i) => (l.material.density * l.thicknessMm) / fcs[i]);
    const totMass = layers.reduce((s, l) => s + l.material.density * l.thicknessMm, 0);
    fc = totMass / inv.reduce((a, b) => a + b, 0);
    eta = massWeighted((l) => l.material.lossFactor);
    if (bonding === 'damped') {
      // Constrained-layer damping (e.g. viscoelastic compound between sheets).
      // 0.13 is a realistic assembly loss factor for a proprietary damping
      // compound between two boards; the often-quoted 0.2+ applies only over a
      // limited frequency and temperature range.
      eta = Math.max(eta, 0.13);
    }
  }
  return { surfaceMass: ms, thickness: h, fc, etaInternal: eta };
}

/** EN 12354-1 total loss factor including radiation losses. */
export function totalLossFactor(etaInt, ms, f) {
  return etaInt + ms / (485 * Math.sqrt(f));
}

/**
 * Field-incidence mass law TL.
 * TL = 20 log10(m_s f) - 47.2   (m_s in kg/m^2, f in Hz)
 */
export function massLawTL(ms, f, air = AIR) {
  if (ms <= 0) return 0;
  const tl0 = 20 * Math.log10((Math.PI * f * ms) / air.z0);
  // Field incidence = normal incidence - ~4.8 dB (integration over 0-78 deg)
  return Math.max(0, tl0 - PANEL_CONSTANTS.fieldIncidenceCorrectionDb);
}

/**
 * First panel (plate) resonance for a simply-supported rectangular panel.
 * f_11 = (pi/2) sqrt(B/m) (1/a^2 + 1/b^2)
 * Below this the panel is stiffness-controlled and mass law fails.
 */
export function panelResonance(leaf, air = AIR) {
  const p = leafProperties(leaf, air);
  const a = leaf.widthM || 1.2;
  const b = leaf.heightM || 2.4;
  // B from f_c relation: f_c = c^2/(2pi) sqrt(m/B) -> B = m (c^2/(2 pi f_c))^2
  const B = p.surfaceMass * Math.pow((air.c * air.c) / (2 * Math.PI * p.fc), 2);
  return (Math.PI / 2) * Math.sqrt(B / p.surfaceMass) * (1 / (a * a) + 1 / (b * b));
}

/**
 * Full 24-band transmission loss of a single leaf.
 * @param {Leaf} leaf
 * @param {{air?:object, extraDamping?:number}} [opts]
 * @returns {{tl:number[], fc:number, surfaceMass:number, f11:number, etaAt:(f:number)=>number}}
 */
export function singleLeafTL(leaf, opts = {}) {
  const air = opts.air || AIR;
  const K = opts.constants || PANEL_CONSTANTS;
  const p = leafProperties(leaf, air);
  const etaInt = p.etaInternal + (opts.extraDamping || 0);
  const ms = p.surfaceMass;
  const fc = p.fc;
  const f11 = panelResonance(leaf, air);

  const tl = new Array(N_BANDS);
  for (let i = 0; i < N_BANDS; i++) {
    const f = THIRD_OCTAVE_EXACT[i];
    const eta = totalLossFactor(etaInt, ms, f);
    const tlm = massLawTL(ms, f, air);

    // Value at the bottom of the coincidence region, and the width of the
    // plateau that follows it. The plateau is the part most models omit: for a
    // heavy, well-damped wall (concrete, f_c ~ 90 Hz) resonant transmission
    // dominates for more than an octave above f_c and TL stays roughly flat
    // before resuming its climb. For a light, lightly damped board
    // (plasterboard, f_c ~ 2.6 kHz) the dip is narrow and recovery is quick.
    // Tying the plateau width to the loss factor at f_c reproduces both.
    const etaC = totalLossFactor(etaInt, ms, fc);
    const tlC = massLawTL(ms, fc, air) + 10 * Math.log10(etaC) + K.coincidenceOffsetDb;
    const plateauOct = Math.min(K.plateauMaxOctaves, Math.max(K.plateauMinOctaves, 0.3 + 12 * etaC));
    const fPlateauEnd = fc * Math.pow(2, plateauOct);

    let v;
    if (f < 0.5 * fc) {
      // Mass-controlled: the mass law *is* the answer here.
      v = tlm;
    } else if (f < fc) {
      // Descent into the coincidence region: interpolate in log f from mass
      // law at 0.5 f_c down to the plateau value at f_c.
      const tlLow = massLawTL(ms, 0.5 * fc, air);
      const w = (Math.log10(f) - Math.log10(0.5 * fc)) / Math.log10(2);
      v = tlLow + w * (tlC - tlLow);
    } else {
      // Resonant (bending-wave) controlled region.
      if (f <= fPlateauEnd) {
        // Coincidence plateau.
        v = tlC;
      } else {
        // Above the plateau: mass law's 6 dB/octave resumes, plus the
        // 3 dB/octave from the damping term — the classic 9 dB/octave recovery.
        const tlmEnd = massLawTL(ms, fPlateauEnd, air);
        v = tlC + (tlm - tlmEnd) + 10 * Math.log10(f / fPlateauEnd);
      }
      // Only in the resonant region does the non-resonant ("forced") path need
      // to be added in parallel. It follows mass law, and it is what stops the
      // damping term pushing TL above mass law without limit far above f_c —
      // the error that makes an uncorrected Sharp model over-predict heavy
      // single-leaf masonry by 5-10 dB. Below f_c, mass law is already the
      // forced path, so adding it again would double-count it.
      v = -10 * Math.log10(Math.pow(10, -v / 10) + Math.pow(10, -(tlm + K.forcedPathOffsetDb) / 10));
    }

    // Safety floor: measurements essentially never show a dip deeper than this.
    v = Math.max(v, tlm - K.maxCoincidenceDipDb);

    // Stiffness-controlled region below the fundamental panel mode: TL rises
    // again as frequency falls (mass law would wrongly go to 0 dB).
    if (f < f11 && f11 > THIRD_OCTAVE_EXACT[0]) {
      // Capped at a factor of 6 in frequency and scaled by 0.55 because real
      // partitions are never ideally simply-supported and edge leakage limits
      // the stiffness benefit.
      const boost = 20 * Math.log10(Math.min(f11 / f, 6)) * K.subResonanceScale;
      v = Math.max(v, tlm + boost);
    }

    tl[i] = Math.max(0, v);
  }

  return {
    tl,
    fc,
    f11,
    surfaceMass: ms,
    etaAt: (f) => totalLossFactor(etaInt, ms, f),
  };
}

/**
 * Diagnostic: which bands is this leaf weak in, and why.
 * @returns {{band:number, reason:string, severity:number}[]}
 */
export function leafWeaknesses(leaf, opts = {}) {
  const r = singleLeafTL(leaf, opts);
  const out = [];
  for (let i = 0; i < N_BANDS; i++) {
    const f = THIRD_OCTAVE_EXACT[i];
    const tlm = massLawTL(r.surfaceMass, f);
    const deficit = tlm - r.tl[i];
    if (deficit > 3 && f > 0.4 * r.fc && f < 3 * r.fc) {
      out.push({
        band: Math.round(f),
        reason: `Coincidence dip (f_c = ${Math.round(r.fc)} Hz). Bending waves in the panel match the airborne wavelength, so the panel radiates efficiently.`,
        severity: deficit,
      });
    }
  }
  if (r.f11 > 60) {
    out.push({
      band: Math.round(r.f11),
      reason: `Fundamental panel mode at ${Math.round(r.f11)} Hz. The leaf flexes as a whole; add mass, reduce the unsupported span, or add damping.`,
      severity: 4,
    });
  }
  return out;
}
