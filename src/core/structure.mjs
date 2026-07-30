/**
 * Structure-borne noise and flanking transmission.
 *
 * Two distinct problems live here:
 *
 * A) FLANKING (airborne source -> structure -> receiver)
 *    Sound inside the booth drives the booth floor and frame, vibration runs
 *    into the building structure, and the building radiates it somewhere else.
 *    This is what makes a technically excellent booth still audible two rooms
 *    away. Modelled EN 12354-1 style: each flanking path gets its own
 *    transmission coefficient which adds in parallel with the direct paths.
 *
 * B) IMPACT / MACHINE VIBRATION (structural source -> receiver)
 *    Footsteps, a mic stand knock, a subwoofer cabinet, a fan. Modelled with
 *    classic single-degree-of-freedom isolator theory:
 *
 *        T = sqrt( (1 + (2 zeta r)^2) / ((1 - r^2)^2 + (2 zeta r)^2) ),  r = f/f_n
 *
 *    with the isolator's static deflection setting f_n:  f_n = 15.76/sqrt(d_mm)
 *
 * The critical, non-obvious result this reproduces: an isolator only works
 * above its own resonance, and *amplifies* below it. Rubber feet with a 25 Hz
 * resonance make a 40 Hz kick drum problem worse, not better.
 */

import { AIR } from './constants.mjs';
import { THIRD_OCTAVE_EXACT, N_BANDS } from './bands.mjs';
import { tlToTau, tauToTL, splToP2 } from './acoustics.mjs';
import { massLawTL, surfaceMass } from './panel.mjs';

/**
 * @typedef {Object} Isolator
 * @property {string} id
 * @property {string} label
 * @property {number} naturalFreqHz  f_n of the loaded mount
 * @property {number} damping        zeta (critical damping ratio)
 * @property {number} costPerM2
 * @property {number} [maxLoadKgPerUnit]
 */

export const ISOLATORS = {
  rigid: { id: 'rigid', label: 'Rigid — bolted / screwed straight down', naturalFreqHz: 250, damping: 0.02, costPerM2: 0 },
  'direct-floor': { id: 'direct-floor', label: 'Sitting directly on the floor', naturalFreqHz: 150, damping: 0.05, costPerM2: 0 },
  'rubber-mat': { id: 'rubber-mat', label: 'Continuous rubber mat, 10 mm', naturalFreqHz: 40, damping: 0.08, costPerM2: 18 },
  'rubber-feet': { id: 'rubber-feet', label: 'Rubber feet / pucks', naturalFreqHz: 28, damping: 0.07, costPerM2: 12 },
  'neoprene-pads': { id: 'neoprene-pads', label: 'Ribbed neoprene pads, 25 mm', naturalFreqHz: 18, damping: 0.09, costPerM2: 26 },
  'closed-cell-foam': { id: 'closed-cell-foam', label: 'Closed-cell PU foam slab, 25 mm', naturalFreqHz: 15, damping: 0.12, costPerM2: 32 },
  'mineral-wool-raft': { id: 'mineral-wool-raft', label: 'High-density mineral wool raft, 50 mm', naturalFreqHz: 12, damping: 0.14, costPerM2: 22 },
  'jack-up-mounts': { id: 'jack-up-mounts', label: 'Jack-up rubber mounts', naturalFreqHz: 9, damping: 0.06, costPerM2: 68 },
  'spring-mounts': { id: 'spring-mounts', label: 'Steel spring mounts (25 mm deflection)', naturalFreqHz: 5, damping: 0.02, costPerM2: 95 },
  'air-springs': { id: 'air-springs', label: 'Air springs / pneumatic isolators', naturalFreqHz: 2.5, damping: 0.04, costPerM2: 240 },
};

/** Natural frequency from static deflection (mm). f_n = 15.76 / sqrt(delta_mm) */
export const fnFromDeflection = (deflectionMm) => 15.76 / Math.sqrt(Math.max(deflectionMm, 0.01));

/** Static deflection needed for a target f_n. */
export const deflectionForFn = (fn) => Math.pow(15.76 / fn, 2);

/**
 * SDOF transmissibility of an isolator.
 * @param {number} f
 * @param {number} fn
 * @param {number} zeta
 * @returns {number} T (linear, force or motion ratio)
 */
export function transmissibility(f, fn, zeta) {
  const r = f / Math.max(fn, 0.1);
  const num = 1 + Math.pow(2 * zeta * r, 2);
  const den = Math.pow(1 - r * r, 2) + Math.pow(2 * zeta * r, 2);
  return Math.sqrt(num / Math.max(den, 1e-12));
}

/**
 * Isolation efficiency in dB (positive = attenuation, negative = amplification).
 * @param {Isolator} iso
 * @returns {number[]} 24-band
 */
export function isolatorAttenuation(iso) {
  return THIRD_OCTAVE_EXACT.map((f) => {
    const T = transmissibility(f, iso.naturalFreqHz, iso.damping);
    // Real mounts stop improving once wave effects appear in the elastomer
    // (typically 8-12 x f_n); cap the benefit.
    const raw = -20 * Math.log10(T);
    return Math.min(raw, 34);
  });
}

/**
 * @typedef {Object} FlankingPath
 * @property {string} id
 * @property {string} label
 * @property {number} junctionAreaM2  contact area with the building structure
 * @property {Isolator} isolator
 * @property {number} vibrationReductionIndexDb  K_ij for the junction (EN 12354)
 * @property {import('./panel.mjs').Leaf} [receivingElement] radiating building element
 */

/**
 * Effective transmitting area (S*tau) of a flanking path.
 *
 * The chain is:
 *   airborne field in booth -> booth floor/frame vibrates (radiation efficiency)
 *   -> isolator attenuation -> junction attenuation K_ij
 *   -> building element re-radiates into the receiver
 *
 * Rather than tracking velocity levels explicitly, we express the whole chain
 * as an equivalent transmission loss so it can be summed with the airborne
 * paths on a power basis. The reference level (55 dB for a rigid contact) is
 * calibrated so that a booth bolted rigidly to a timber joist floor shows the
 * ~50-55 dB flanking ceiling that field measurements report.
 */
export function flankingEffectiveArea(path, opts = {}) {
  const iso = path.isolator || ISOLATORS.rigid;
  const isoAtt = isolatorAttenuation(iso);
  const kij = path.vibrationReductionIndexDb ?? 5;
  const S = Math.max(path.junctionAreaM2, 0.01);

  const eff = THIRD_OCTAVE_EXACT.map((f, i) => {
    // Baseline coupling: structure-borne flanking is worst at low frequency
    // because both the excitation and the building's radiation efficiency
    // favour it, and it rolls off above ~500 Hz.
    let base = 48 + 12 * Math.log10(Math.max(f, 40) / 100);
    base += isoAtt[i] + kij;
    if (path.receivingElement) {
      const ms = surfaceMass(path.receivingElement);
      // A heavy receiving element radiates less for the same velocity.
      base += Math.max(0, 10 * Math.log10(ms / 20));
    }
    return S * tlToTau(base);
  });

  return { eff, isoAtt, label: path.label, area: S };
}

/**
 * @typedef {Object} FloorSystem
 * @property {'direct'|'feet'|'floating'|'floating-heavy'} type
 * @property {Isolator} isolator
 * @property {import('./panel.mjs').Leaf} [slab]   the floating deck
 * @property {number} [cavityMm]
 * @property {import('../data/materials.mjs').Material} [cavityFill]
 */

/**
 * @typedef {Object} CeilingSystem
 * @property {'direct'|'resilient'|'suspended'|'independent'} type
 * @property {Isolator} isolator
 * @property {import('./panel.mjs').Leaf} leaf
 * @property {number} [voidMm]
 */

/**
 * Impact insulation of a floor build-up — the reduction in impact sound
 * (footsteps on the booth deck heard below). Returns an approximate
 * delta-Lw improvement and the resulting Ln,w-style band levels.
 *
 * Uses the EN 12354-2 form for a floating floor:
 *   delta L = 40 log10(f / f0)   for f > f0,   0 below
 * with f0 the resonance of the deck mass on the resilient layer.
 */
export function floorImpactImprovement(floor) {
  const iso = floor.isolator || ISOLATORS['direct-floor'];
  let f0 = iso.naturalFreqHz;
  if (floor.slab) {
    // Recompute f0 from the actual deck mass on the resilient layer stiffness.
    // s' (dynamic stiffness, MN/m^3) implied by the isolator's rated f_n at a
    // nominal 100 kg/m^2 load; rescale to the real deck mass.
    const msRef = 100;
    const ms = Math.max(surfaceMass(floor.slab), 5);
    f0 = iso.naturalFreqHz * Math.sqrt(msRef / ms);
  }
  const delta = THIRD_OCTAVE_EXACT.map((f) =>
    f > f0 ? Math.min(40 * Math.log10(f / f0), 40) : -Math.max(0, 6 * (1 - Math.abs(Math.log2(f / f0))))
  );
  return { deltaL: delta, f0 };
}

/**
 * Structure-borne source levels: typical force/velocity spectra for common
 * excitations, expressed as the equivalent radiated SWL into the structure.
 * These drive the "will they hear my footsteps / my speaker cabinet" answer.
 */
export const VIBRATION_SOURCES = {
  footsteps: {
    id: 'footsteps', label: 'Footsteps (soft shoes)',
    swl: [62, 64, 66, 67, 66, 64, 61, 58, 55, 52, 49, 46, 43, 40, 37, 34, 31, 28, 25, 22, 19, 16, 13, 10],
  },
  'footsteps-hard': {
    id: 'footsteps-hard', label: 'Footsteps (hard heels)',
    swl: [58, 61, 64, 67, 69, 70, 70, 69, 68, 66, 64, 62, 60, 58, 55, 52, 49, 46, 43, 40, 37, 34, 31, 28],
  },
  'chair-scrape': {
    id: 'chair-scrape', label: 'Chair / mic stand moved',
    swl: [50, 53, 56, 60, 63, 65, 67, 68, 68, 67, 66, 64, 62, 60, 57, 54, 51, 48, 45, 42, 39, 36, 33, 30],
  },
  'speaker-cabinet': {
    id: 'speaker-cabinet', label: 'Monitor speaker on a stand, loud',
    swl: [78, 80, 82, 83, 82, 80, 77, 74, 70, 66, 62, 58, 54, 50, 46, 42, 38, 34, 30, 26, 22, 18, 14, 10],
  },
  subwoofer: {
    id: 'subwoofer', label: 'Subwoofer on the floor',
    swl: [92, 94, 93, 90, 86, 81, 76, 71, 66, 61, 56, 51, 46, 41, 36, 31, 26, 21, 16, 11, 6, 1, -4, -9],
  },
  'inline-fan': {
    id: 'inline-fan', label: 'Inline extract fan, hard mounted',
    swl: [56, 58, 61, 64, 62, 59, 56, 53, 50, 47, 44, 41, 38, 35, 32, 29, 26, 23, 20, 17, 14, 11, 8, 5],
  },
  'human-movement': {
    id: 'human-movement', label: 'Performer moving / jumping',
    swl: [72, 74, 75, 74, 71, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0, -4],
  },
};

/**
 * Structure-borne transmission from a vibration source, through the isolation
 * system, into the receiving space.
 * @param {{source:object, isolator:Isolator, receiverRoomConstant:number, junctionLossDb?:number}} p
 * @returns {number[]} receiver SPL per band
 */
export function structureBorneSPL(p) {
  const iso = p.isolator || ISOLATORS['direct-floor'];
  const att = isolatorAttenuation(iso);
  const kij = p.junctionLossDb ?? 8;
  return p.source.swl.map((swl, i) => {
    const radiated = swl - att[i] - kij;
    return radiated + 10 * Math.log10(4 / Math.max(p.receiverRoomConstant, 0.5));
  });
}

/**
 * Diagnostics for the isolation system: catches the classic mistake of
 * choosing a mount whose resonance sits in the source's energy.
 */
export function diagnoseIsolation(iso, sourceSpectrum) {
  const notes = [];
  const fn = iso.naturalFreqHz;
  if (fn > 30) {
    notes.push({
      severity: 'high',
      title: `Isolator resonance is too high (${fn.toFixed(0)} Hz)`,
      detail: `This mount only starts attenuating above about ${(fn * 1.41).toFixed(0)} Hz. Below that it is either transparent or amplifying. For music and speech you want a mount resonance below 12 Hz; for a booth with a subwoofer, below 8 Hz.`,
      fixes: ['Move to thicker, softer resilient layers', 'Add mass to the floating deck (f_n falls as 1/sqrt(mass))', 'Use spring mounts'],
    });
  }
  if (sourceSpectrum) {
    // Find bands where the mount amplifies AND the source has energy.
    for (let i = 0; i < N_BANDS; i++) {
      const f = THIRD_OCTAVE_EXACT[i];
      const T = transmissibility(f, fn, iso.damping);
      if (T > 1.15 && sourceSpectrum[i] > Math.max(...sourceSpectrum) - 12) {
        notes.push({
          severity: 'high',
          title: `Resonant amplification at ${Math.round(f)} Hz`,
          detail: `The mount amplifies by ${(20 * Math.log10(T)).toFixed(1)} dB at ${Math.round(f)} Hz, and your source is strong there. The isolation system is making this frequency worse than a rigid connection would.`,
          fixes: [`Lower the mount resonance well below ${Math.round(f)} Hz`, 'Increase damping in the resilient layer'],
        });
        break;
      }
    }
  }
  return notes;
}

/** Preset flanking configurations by how the booth meets the building. */
export const MOUNTING_PRESETS = {
  'bolted-to-joists': {
    id: 'bolted-to-joists', label: 'Bolted through to timber joists',
    isolator: ISOLATORS.rigid, vibrationReductionIndexDb: 2,
  },
  'direct-on-slab': {
    id: 'direct-on-slab', label: 'Standing directly on a concrete slab',
    isolator: ISOLATORS['direct-floor'], vibrationReductionIndexDb: 12,
  },
  'direct-on-timber': {
    id: 'direct-on-timber', label: 'Standing directly on a timber floor',
    isolator: ISOLATORS['direct-floor'], vibrationReductionIndexDb: 3,
  },
  'feet-on-timber': {
    id: 'feet-on-timber', label: 'Rubber feet on a timber floor',
    isolator: ISOLATORS['rubber-feet'], vibrationReductionIndexDb: 4,
  },
  'mat-on-timber': {
    id: 'mat-on-timber', label: 'Rubber mat under the whole footprint, timber floor',
    isolator: ISOLATORS['rubber-mat'], vibrationReductionIndexDb: 5,
  },
  'floating-raft-timber': {
    id: 'floating-raft-timber', label: 'Floating raft on mineral wool, timber floor',
    isolator: ISOLATORS['mineral-wool-raft'], vibrationReductionIndexDb: 7,
  },
  'floating-raft-slab': {
    id: 'floating-raft-slab', label: 'Floating raft on mineral wool, concrete slab',
    isolator: ISOLATORS['mineral-wool-raft'], vibrationReductionIndexDb: 14,
  },
  'springs-on-slab': {
    id: 'springs-on-slab', label: 'Spring-mounted raft on a concrete slab',
    isolator: ISOLATORS['spring-mounts'], vibrationReductionIndexDb: 16,
  },
};
