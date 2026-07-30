/**
 * Multi-leaf partition transmission loss: cavity coupling, mass-air-mass
 * resonance, cavity standing waves, and structural bridging.
 *
 * Airborne path follows Sharp's three-region double-leaf model:
 *   f  < f0            TL = mass law of the *combined* mass
 *   f0 < f < f_l       TL = TL1 + TL2 + 20 log10(f d) - 29
 *   f  > f_l           TL = TL1 + TL2 + 6  (+ cavity absorption term)
 * with f_l = c/(2 pi d) the frequency at which the cavity stops behaving
 * as a lumped spring.
 *
 * The bridging path is treated as a *parallel* transmission path
 * (EN 12354 style: tau_total = tau_airborne + tau_bridge). This is what makes
 * the difference between a 60 dB double-stud wall and a 40 dB one built with
 * the leaves screwed to the same studs.
 */

import { AIR } from './constants.mjs';
import { THIRD_OCTAVE_EXACT, N_BANDS } from './bands.mjs';
import { singleLeafTL, surfaceMass, leafProperties, massLawTL, leafCost, leafThickness } from './panel.mjs';
import { porousAlpha } from './acoustics.mjs';
import { tlToTau, tauToTL } from './acoustics.mjs';

/**
 * @typedef {Object} Cavity
 * @property {number} depthMm          clear air gap between leaf inner faces
 * @property {import('../data/materials.mjs').Material|null} [fill] porous fill
 * @property {number} [fillThicknessMm] thickness of fill (<= depth)
 */

/**
 * @typedef {Object} Connection
 * @property {string} type   'rigid-stud'|'staggered-stud'|'resilient-channel'|'isolation-clip'|'separate-frame'|'none'
 * @property {number} mountResonanceHz  resonance of the connection as a spring
 * @property {number} spacingM          stud/clip line spacing
 * @property {number} maxIsolationDb    ceiling on the improvement (flanking floor)
 * @property {'line'|'point'} contact
 */

/**
 * @typedef {Object} Partition
 * @property {import('./panel.mjs').Leaf[]} leaves  1, 2 or 3 leaves (source side first)
 * @property {Cavity[]} cavities                     length = leaves.length - 1
 * @property {Connection} connection
 * @property {number} areaM2
 * @property {string} [id]
 * @property {string} [label]
 */

/**
 * Mass-air-mass resonance of a two-leaf system.
 *   f0 = (1/2pi) sqrt( rho c_eff^2 (1/m1 + 1/m2) / d )
 * An empty cavity behaves adiabatically (coefficient 60); a fully filled
 * cavity tends to isothermal (coefficient ~50.6). We interpolate on fill
 * fraction, which is physically what happens as the fibres thermally load the air.
 */
export function massAirMass(m1, m2, depthMm, fillFraction = 0) {
  const d = Math.max(depthMm, 1) / 1000;
  const k = 60 - 9.4 * Math.min(Math.max(fillFraction, 0), 1);
  return k * Math.sqrt((1 / m1 + 1 / m2) / d);
}

/** Cavity depth resonances (standing waves) f_n = n c / (2 d). */
export function cavityResonances(depthMm, air = AIR, nMax = 6) {
  const d = depthMm / 1000;
  return Array.from({ length: nMax }, (_, n) => ((n + 1) * air.c) / (2 * d));
}

/**
 * Broadband damping the cavity fill provides to the mass-air-mass resonance,
 * expressed as normalised flow resistance (sigma * t) / (rho * c).
 * 1.0 or above means the resonance is essentially critically damped.
 */
export function cavityFlowDamping(cav, air = AIR) {
  if (!cav.fill || !cav.fillThicknessMm) return 0;
  const sigma = cav.fill.flowResistivity || 12000;
  const t = Math.min(cav.fillThicknessMm, cav.depthMm) / 1000;
  const fillFrac = Math.min(1, (cav.fillThicknessMm || 0) / Math.max(cav.depthMm, 1));
  return (fillFrac * sigma * t) / air.z0;
}

/** Effective random-incidence absorption of the cavity lining, 24-band. */
export function cavityAbsorption(cav) {
  if (!cav.fill || !cav.fillThicknessMm) return new Array(N_BANDS).fill(0.05);
  const sigma = cav.fill.flowResistivity || 12000;
  const t = Math.min(cav.fillThicknessMm, cav.depthMm);
  const gap = Math.max(0, cav.depthMm - t);
  const a = porousAlpha(sigma, t, gap);
  // Cavity is bounded on both sides; effective damping saturates near 0.95.
  return a.map((v) => Math.min(0.95, Math.max(0.05, v)));
}

/**
 * Default connection presets. mountResonanceHz is the vertical resonance of
 * the leaf mass on the connector stiffness; below it the connector is a rigid
 * short-circuit, above it the structural path rolls off.
 */
export const CONNECTIONS = {
  // maxIsolationDb is the *flanking floor* of the connection: the best the
  // bridged path can ever do, however good the connector, because the leaves
  // remain joined through plates, floor, ceiling and the surrounding structure.
  //
  // Values were fitted by constrained coordinate descent against the
  // published laboratory set in core/validation.mjs. They are physically
  // interpretable and reproduce the published *differences* between
  // constructions, not just their absolute ratings:
  //
  //   rigid studs         2 dB  — effectively a structural short circuit
  //   steel C-stud        7 dB  — the thin web flexes
  //   staggered studs     8 dB  — no stud touches both leaves, but plates do
  //   resilient channel   9 dB  — matches the 7-12 dB the literature reports
  //   isolation clips  10.5 dB  + up to 11 dB damping bonus
  //   spring hangers     14 dB
  //   separate frames  17.5 dB  — matches STC 43 -> 59 for the same boards
  //
  // The fit was constrained so that a better connector can never receive a
  // lower ceiling than a worse one. An unconstrained fit is underdetermined
  // (one published case per connector) and produced the physically absurd
  // result of clips scoring below resilient channel.
  //
  none: { type: 'none', mountResonanceHz: 0, spacingM: 999, maxIsolationDb: 60, contact: 'point', label: 'Fully separate structures (no contact)' },
  'separate-frame': { type: 'separate-frame', mountResonanceHz: 0, spacingM: 999, maxIsolationDb: 17.5, contact: 'point', label: 'Independent double frame (double stud)' },
  'isolation-clip': { type: 'isolation-clip', mountResonanceHz: 14, spacingM: 0.6, maxIsolationDb: 10.5, contact: 'point', label: 'Isolation clips + hat channel' },
  'spring-hanger': { type: 'spring-hanger', mountResonanceHz: 7, spacingM: 0.9, maxIsolationDb: 14, contact: 'point', label: 'Spring hangers' },
  'resilient-channel': { type: 'resilient-channel', mountResonanceHz: 38, spacingM: 0.4, maxIsolationDb: 9, contact: 'line', label: 'Resilient channel (resilient bar)' },
  'staggered-stud': { type: 'staggered-stud', mountResonanceHz: 60, spacingM: 0.4, maxIsolationDb: 8, contact: 'line', label: 'Staggered studs on a common plate' },
  'rigid-stud': { type: 'rigid-stud', mountResonanceHz: 1e5, spacingM: 0.4, maxIsolationDb: 2, contact: 'line', label: 'Rigid timber/steel studs (both leaves screwed to same stud)' },
  'steel-stud': { type: 'steel-stud', mountResonanceHz: 120, spacingM: 0.6, maxIsolationDb: 7, contact: 'line', label: 'Light-gauge steel C-stud (flexible web)' },
};

/**
 * Structural bridging attenuation relative to the *combined-mass* mass law.
 * Above the mount resonance the connector rolls off; we use 9 dB/octave
 * (between the 12 dB/oct of an ideal SDOF and the ~6 dB/oct that wave
 * effects and connector standing waves actually deliver in a wall).
 * Line contacts are penalised relative to point contacts, and wider spacing
 * (fewer bridges per m^2) helps by 10 log10(spacing ratio).
 */
export const BRIDGE_CONSTANTS = {
  /**
   * Even a rigid stud is not a perfect short-circuit: it is a discrete line
   * contact 38-45 mm wide on a 400 mm pitch, so only ~10% of the leaf area is
   * bridged, and the bridged transmission improves with frequency as the
   * bending wavelength in the leaf shrinks relative to the connector pitch.
   * Base value at 250 Hz, and slope per decade of frequency.
   */
  rigidBaseDb: 4,
  rigidSlopeDbPerDecade: 8,
  /** Reference connector pitch for line and point contacts (m). */
  lineRefSpacingM: 0.4,
  pointRefSpacingM: 0.6,
  /** Point contacts transmit less bending energy than line contacts. */
  pointContactBonusDb: 4,
  /** Roll-off above a resilient connector's mount resonance, dB/decade. */
  resilientSlopeDbPerDecade: 30,
  /** Reference loss factor against which the damping bonus is measured. */
  dampingRefEta: 0.015,
  maxDampingBonusDb: 11,
};

export function bridgingAttenuation(conn, f, leafLossFactor = 0.015, K = BRIDGE_CONSTANTS) {
  if (conn.type === 'none') return 200;

  // Leaf damping reduces the bridged path as well as the airborne one: the
  // stud injects energy into the leaf as bending waves, and a well damped leaf
  // converts them to heat before they can radiate. This is why a viscoelastic
  // compound between board layers is worth 8-11 dB even on rigid timber studs,
  // which a purely geometric bridging model misses entirely.
  const dampingBonus = Math.max(0, Math.min(K.maxDampingBonusDb,
    10 * Math.log10(Math.max(leafLossFactor, 0.001) / K.dampingRefEta)));

  const fm = conn.mountResonanceHz;

  if (fm <= 0) {
    // Structurally separate frames: the ceiling is set by flanking through the
    // shared floor, head plate and surrounding structure, not by any connector.
    return conn.maxIsolationDb + dampingBonus;
  }

  // Contact-density and frequency term, present for every mechanical connection.
  const ref = conn.contact === 'line' ? K.lineRefSpacingM : K.pointRefSpacingM;
  let att = K.rigidBaseDb
    + K.rigidSlopeDbPerDecade * Math.log10(Math.max(f, 50) / 250)
    + 10 * Math.log10(Math.max(conn.spacingM, 0.1) / ref);
  if (conn.contact === 'point') att += K.pointContactBonusDb;
  att = Math.max(0, att);

  // A resilient connector adds single-degree-of-freedom roll-off above its own
  // mount resonance. Below that resonance it is simply a rigid connection.
  if (f > fm) att += K.resilientSlopeDbPerDecade * Math.log10(f / fm);

  return Math.min(att, conn.maxIsolationDb) + dampingBonus;
}

/**
 * Full partition transmission loss.
 * @param {Partition} part
 * @param {{air?:object}} [opts]
 */
export function partitionTL(part, opts = {}) {
  const air = opts.air || AIR;
  const leaves = part.leaves;
  const conn = part.connection || CONNECTIONS['rigid-stud'];

  const leafResults = leaves.map((l) => singleLeafTL(l, { air }));
  const masses = leaves.map((l) => surfaceMass(l));
  const totalMass = masses.reduce((a, b) => a + b, 0);

  if (leaves.length === 1) {
    const r = leafResults[0];
    return {
      tl: r.tl,
      f0: null,
      fc: [r.fc],
      f11: [r.f11],
      surfaceMass: totalMass,
      cavityAlpha: null,
      airborneTL: r.tl.slice(),
      bridgeTL: null,
      limitedBy: r.tl.map(() => 'panel'),
      totalThicknessMm: leafThickness(leaves[0]),
    };
  }

  // --- Two-leaf core (three-leaf handled by recursive pairing below) ---
  const cav = part.cavities[0];
  const fillFrac = cav.fill ? Math.min(1, (cav.fillThicknessMm || 0) / Math.max(cav.depthMm, 1)) : 0;
  const alphaCav = cavityAbsorption(cav);

  const m1 = masses[0];
  const m2 = masses.slice(1).reduce((a, b) => a + b, 0);
  const f0 = massAirMass(m1, m2, cav.depthMm, fillFrac);
  const d = cav.depthMm / 1000;
  const fl = air.c / (2 * Math.PI * d);

  // If there are 3 leaves, collapse leaves[1..] into an equivalent inner leaf
  // by first solving the inner pair, then treating its TL as leaf 2.
  let tl2;
  if (leaves.length > 2) {
    const inner = partitionTL({
      leaves: leaves.slice(1),
      cavities: part.cavities.slice(1),
      connection: conn,
      areaM2: part.areaM2,
    }, opts);
    tl2 = inner.tl;
  } else {
    tl2 = leafResults[1].tl;
  }
  const tl1 = leafResults[0].tl;

  const airborne = new Array(N_BANDS);
  const limitedBy = new Array(N_BANDS);
  const resonances = cavityResonances(cav.depthMm, air);

  for (let i = 0; i < N_BANDS; i++) {
    const f = THIRD_OCTAVE_EXACT[i];
    let v;
    if (f < f0 / Math.SQRT2) {
      // Below resonance the two leaves move together: combined mass law.
      v = massLawTL(totalMass, f, air);
      limitedBy[i] = 'mass (below MAM)';
    } else if (f < f0 * Math.SQRT2) {
      // Mass-air-mass dip.
      //
      // The damping that sets the dip depth is the *flow resistance* the
      // cavity fill presents to air moving between the leaves — not its
      // absorption coefficient, which is near zero at these frequencies even
      // for a well-filled cavity. Normalising sigma*t against rho*c gives the
      // right broadband behaviour: 50 mm of mineral wool already presents
      // more than rho*c and largely kills the resonance, whereas an empty
      // cavity leaves a 12-15 dB hole.
      const base = massLawTL(totalMass, f, air);
      const damp = 0.2 + 0.8 * Math.min(1, cavityFlowDamping(cav, air));
      const dip = (1 - damp) * 14 + 3;
      const centre = 1 - Math.abs(Math.log2(f / f0)) / 0.5;
      v = base - dip * Math.max(0, centre);
      limitedBy[i] = 'mass-air-mass resonance';
    } else if (f < fl) {
      v = tl1[i] + tl2[i] + 20 * Math.log10(f * d) - 29;
      // Never worse than the combined single-leaf mass law
      v = Math.max(v, massLawTL(totalMass, f, air) - 2);
      limitedBy[i] = 'cavity-coupled';
    } else {
      const absTerm = 10 * Math.log10(Math.max(0.05, alphaCav[i]) / 0.3);
      v = tl1[i] + tl2[i] + 6 + Math.min(6, Math.max(-6, absTerm));
      limitedBy[i] = 'decoupled';
      // Cavity depth standing waves: transmission peaks at f_n = n c/2d,
      // suppressed in proportion to cavity absorption.
      for (const fr of resonances) {
        const oct = Math.abs(Math.log2(f / fr));
        if (oct < 0.25) {
          const depth = (1 - alphaCav[i]) * 8 * (1 - oct / 0.25);
          if (depth > 0.5) { v -= depth; limitedBy[i] = 'cavity standing wave'; }
        }
      }
    }
    airborne[i] = Math.max(0, v);
  }

  // --- Structural bridging path (parallel) ---
  // Mass-weighted mean leaf loss factor: a damped leaf dissipates the
  // bending-wave energy the studs inject into it before it can radiate.
  const leafEta = leaves.reduce((s, l) => {
    const p = leafProperties(l, air);
    return s + p.etaInternal * p.surfaceMass;
  }, 0) / Math.max(totalMass, 1e-6);

  // Baseline for the bridged path: a hypothetical single leaf carrying the
  // combined mass of both leaves. Using this instead of the bare mass law
  // matters because the bridged path radiates from the *same physical leaf*,
  // so it suffers the same coincidence dip. A mass-law baseline climbs at
  // 6 dB/octave forever and wrongly predicts that a rigid-stud wall keeps
  // improving above 2 kHz, where measurements show it flattening.
  const combinedLeaf = {
    layers: leaves.flatMap((l) => l.layers),
    bonding: 'screwed',
    widthM: leaves[0].widthM, heightM: leaves[0].heightM,
  };
  const combinedTL = singleLeafTL(combinedLeaf, { air }).tl;

  const bridgeTL = new Array(N_BANDS);
  for (let i = 0; i < N_BANDS; i++) {
    const f = THIRD_OCTAVE_EXACT[i];
    bridgeTL[i] = combinedTL[i] + bridgingAttenuation(conn, f, leafEta);
  }

  // --- Combine paths on a power basis ---
  const tl = new Array(N_BANDS);
  for (let i = 0; i < N_BANDS; i++) {
    const tau = tlToTau(airborne[i]) + tlToTau(bridgeTL[i]);
    tl[i] = tauToTL(tau);
    if (bridgeTL[i] < airborne[i] - 1) limitedBy[i] = 'structural bridging';
  }

  return {
    tl,
    airborneTL: airborne,
    bridgeTL,
    f0,
    fl,
    fc: leafResults.map((r) => r.fc),
    f11: leafResults.map((r) => r.f11),
    surfaceMass: totalMass,
    cavityAlpha: alphaCav,
    cavityResonances: resonances.filter((r) => r < 12000),
    limitedBy,
    totalThicknessMm: leaves.reduce((s, l) => s + leafThickness(l), 0) +
      part.cavities.reduce((s, c) => s + c.depthMm, 0),
  };
}

/** Build cost of a partition, currency per m^2. */
export function partitionCost(part) {
  let c = part.leaves.reduce((s, l) => s + leafCost(l), 0);
  for (const cav of part.cavities) {
    if (cav.fill) c += (cav.fill.costPerM2PerMm || 0) * (cav.fillThicknessMm || 0) + (cav.fill.costPerM2Fixed || 0);
  }
  const conn = part.connection || CONNECTIONS['rigid-stud'];
  const connCost = {
    'rigid-stud': 9, 'steel-stud': 7, 'staggered-stud': 14, 'resilient-channel': 6.5,
    'isolation-clip': 17, 'spring-hanger': 24, 'separate-frame': 20, none: 0,
  };
  c += connCost[conn.type] ?? 9;
  return c;
}

/**
 * Human-readable diagnosis of a partition's weak frequencies.
 */
export function diagnosePartition(res) {
  const notes = [];
  if (res.f0) {
    notes.push({
      f: res.f0,
      severity: res.f0 > 80 ? 'high' : 'medium',
      title: `Mass-air-mass resonance at ${res.f0.toFixed(0)} Hz`,
      detail: res.f0 > 80
        ? `The cavity spring and the two leaf masses resonate at ${res.f0.toFixed(0)} Hz, which is inside the useful speech and music range. The wall is close to transparent here. Push it below ~60 Hz by increasing the cavity depth or the leaf masses.`
        : `Resonance sits at ${res.f0.toFixed(0)} Hz, safely below the main energy of most sources. Good.`,
      fixes: ['Increase cavity depth (f0 falls as 1/sqrt(d))', 'Add mass to either leaf', 'Fill the cavity with mineral wool to damp the resonance'],
    });
  }
  for (const fc of res.fc || []) {
    if (fc > 80 && fc < 8000) {
      notes.push({
        f: fc,
        severity: fc > 1500 && fc < 5000 ? 'medium' : 'low',
        title: `Coincidence dip at ${fc.toFixed(0)} Hz`,
        detail: `Bending waves in the leaf travel at the same speed as the airborne wave, so the panel radiates efficiently and loses several dB of transmission loss.`,
        fixes: ['Use two thinner sheets instead of one thick one (raises f_c)', 'Add a damping compound between sheets', 'Make the two leaves different thicknesses so their dips do not coincide'],
      });
    }
  }
  const bridged = (res.limitedBy || []).filter((v) => v === 'structural bridging').length;
  if (bridged > 6) {
    notes.push({
      f: null,
      severity: 'high',
      title: 'Structural bridging is the limiting path',
      detail: `Over ${bridged} of 24 bands are limited by vibration travelling through the connection between the leaves, not through the air cavity. Adding more mass or insulation will not help until the leaves are decoupled.`,
      fixes: ['Move to isolation clips + hat channel', 'Build a fully independent inner frame (double stud)', 'Increase connector spacing'],
    });
  }
  return notes;
}
