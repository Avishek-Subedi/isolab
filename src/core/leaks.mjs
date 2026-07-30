/**
 * Air-leakage transmission through gaps, slits and penetrations.
 *
 * A gap is modelled as a short acoustic waveguide (a "duct" the thickness of
 * the wall) terminated at both ends by radiation impedance, driven by the
 * blocked pressure of the incident field:
 *
 *      p_blocked = 2 p_incident   (rigid baffle)
 *
 *              Z_rad         [ A B ]        Z_rad
 *   p_b o----/\/\/\----o-----[ C D ]-----o--/\/\/\----o  radiated
 *
 * Propagation inside the slit uses the Zwikker-Kosten low-reduced-frequency
 * solution, which captures the viscous and thermal boundary layers. This is
 * essential: a 0.2 mm gap and a 2 mm gap differ by far more than their area
 * ratio, because the viscous boundary layer chokes the narrow one. It also
 * reproduces the half-wave slit resonances at f = n c / 2 t_eff, where a gap
 * becomes almost perfectly transparent.
 *
 * Radiation loading uses a piston of equal area, but the *coherent length* of
 * a long slit is limited to half a wavelength: beyond that the slit radiates
 * as a series of independent segments rather than one piston. Ignoring this
 * over-predicts leakage from long door perimeters by 10-15 dB.
 *
 * Reference behaviour this reproduces:
 *   - 1 mm continuous gap around a door -> composite TL ceiling near 25-30 dB
 *   - sealing that gap to 0.1 mm -> ~15 dB recovery
 *   - an unsealed 100 mm cable hole -> hard ceiling near 30 dB regardless of wall
 */

import { AIR } from './constants.mjs';
import { THIRD_OCTAVE_EXACT, N_BANDS } from './bands.mjs';
import * as X from './complex.mjs';
import { tauToTL } from './acoustics.mjs';

/**
 * @typedef {Object} Gap
 * @property {string} id
 * @property {string} label
 * @property {'slit'|'hole'} shape
 * @property {number} widthMm      slit width, or hole diameter
 * @property {number} [lengthMm]   slit length (perimeter run). Ignored for holes.
 * @property {number} depthMm      wall / door thickness the gap passes through
 * @property {number} [count]      number of identical gaps
 * @property {number} [sealResistivity] Pa*s/m^2 of any porous seal filling the gap
 * @property {number} [sealFillFraction] 0..1 of the depth that is filled
 * @property {string} [location]
 */

/**
 * Zwikker-Kosten effective density and bulk modulus for a slit of half-width h.
 * @param {number} omega rad/s
 * @param {number} h half gap width (m)
 */
function slitProperties(omega, h, air = AIR) {
  // lambda = h sqrt(-j omega rho / mu)
  const s2 = (omega * air.rho) / air.mu;
  const s = h * Math.sqrt(s2);
  // sqrt(-j) = (1 - j)/sqrt(2)
  const lam = X.C((s * Math.SQRT1_2), -(s * Math.SQRT1_2));
  const lamT = X.scale(lam, Math.sqrt(air.Pr));

  const th = X.ctanh(lam);
  const thT = X.ctanh(lamT);

  // rho_eff = rho / (1 - tanh(lam)/lam)
  const one = X.C(1, 0);
  const rhoEff = X.div(X.C(air.rho, 0), X.sub(one, X.div(th, lam)));
  // K_eff = gamma p0 / (1 + (gamma-1) tanh(lamT)/lamT)
  const kEff = X.div(
    X.C(air.gamma * air.p0, 0),
    X.add(one, X.scale(X.div(thT, lamT), air.gamma - 1))
  );
  return { rhoEff, kEff };
}

/**
 * Circular-capillary version (for round holes / cable penetrations).
 * Uses the Bessel-function solution approximated by the same tanh form with
 * an equivalent half-width h = r/2, which is accurate to ~1 dB for our purposes.
 */
function holeProperties(omega, radius, air = AIR) {
  return slitProperties(omega, radius / 2, air);
}

/**
 * Transmission coefficient of a single gap, relative to the *gap's own area*.
 * Values can exceed 1 near slit resonance — that is real, the aperture draws
 * in more power than its geometric cross-section.
 *
 * @param {Gap} gap
 * @returns {number[]} tau per 1/3-octave band (relative to gap area)
 */
export function gapTau(gap, opts = {}) {
  const air = opts.air || AIR;
  const w = Math.max(gap.widthMm, 0.005) / 1000;
  const t = Math.max(gap.depthMm, 0.5) / 1000;
  const isSlit = gap.shape !== 'hole';
  const L = isSlit ? Math.max(gap.lengthMm || 1000, 1) / 1000 : 0;

  const out = new Array(N_BANDS);

  for (let i = 0; i < N_BANDS; i++) {
    const f = THIRD_OCTAVE_EXACT[i];
    const omega = 2 * Math.PI * f;
    const k = omega / air.c;
    const lambda = air.c / f;

    // --- coherent segment ---
    // coherenceFactor multiplies the wavelength fraction over which the slit
    // radiates as one coherent piston. 0.5 (half a wavelength) is the spatial
    // correlation length of a diffuse field and is the default; raising it
    // makes leaks predict worse, and it is the primary knob the calibration
    // module tunes when measured data says leaks dominate.
    const coh = opts.leakCoherenceFactor ?? 0.5;
    let S, aEq, props;
    if (isSlit) {
      const segLen = Math.min(L, lambda * coh);
      S = segLen * w;
      aEq = Math.sqrt(S / Math.PI);
      props = slitProperties(omega, w / 2, air);
    } else {
      const r = w / 2;
      S = Math.PI * r * r;
      aEq = r;
      props = holeProperties(omega, r, air);
    }

    // --- propagation constant and characteristic impedance ---
    const { rhoEff, kEff } = props;
    // Gamma = j omega sqrt(rho_eff / K_eff)
    const ratio = X.csqrt(X.div(rhoEff, kEff));
    const gamma = X.mul(X.C(0, omega), ratio);
    // Zc = sqrt(rho_eff K_eff) / S
    const Zc = X.scale(X.csqrt(X.mul(rhoEff, kEff)), 1 / S);

    // --- optional porous seal inside the gap: series flow resistance ---
    let Rseal = 0;
    if (gap.sealResistivity && gap.sealFillFraction) {
      Rseal = (gap.sealResistivity * t * Math.min(1, gap.sealFillFraction)) / S;
    }

    // --- two-port ---
    const gt = X.scale(gamma, t);
    const A = X.ccosh(gt);
    const B = X.add(X.mul(Zc, X.csinh(gt)), X.C(Rseal, 0));
    const Cc = X.div(X.csinh(gt), Zc);
    const D = X.ccosh(gt);

    // --- radiation load, both ends ---
    const { R, Xr } = (() => {
      const p = X.pistonRadiation(k * aEq);
      return { R: p.R, Xr: p.X };
    })();
    const Zrad = X.scale(X.C(R, Xr), air.z0 / S);

    // U2 = p_b / [ (A Z_L + B) + Z_s (C Z_L + D) ]
    const t1 = X.add(X.mul(A, Zrad), B);
    const t2 = X.mul(Zrad, X.add(X.mul(Cc, Zrad), D));
    const den = X.add(t1, t2);
    const den2 = X.abs2(den);

    // tau = 4 |U2|^2 Re(Z_L) rho c / (|p_b|^2 S)
    const reZL = (air.z0 / S) * R;
    const tau = (4 * reZL * air.z0) / (den2 * S);

    out[i] = Math.max(1e-9, Math.min(tau, 4));
  }
  return out;
}

/** Physical open area of a gap, m^2 (including count). */
export function gapArea(gap) {
  const n = gap.count || 1;
  if (gap.shape === 'hole') {
    const r = gap.widthMm / 2000;
    return n * Math.PI * r * r;
  }
  return n * (gap.widthMm / 1000) * ((gap.lengthMm || 1000) / 1000);
}

/**
 * Effective transmitted-power area of a gap: S * tau. This is the quantity
 * that adds directly into the enclosure power balance.
 * @returns {number[]} m^2 per band
 */
export function gapEffectiveArea(gap, opts = {}) {
  const tau = gapTau(gap, opts);
  const S = gapArea(gap);
  return tau.map((t) => t * S);
}

/**
 * Standalone TL of a gap when it is the only opening in a partition of area A.
 * Useful for the teaching panel: "a 1 mm gap in a 10 m^2 wall caps you at X dB".
 */
export function gapLimitedTL(gap, partitionAreaM2, opts = {}) {
  const eff = gapEffectiveArea(gap, opts);
  return eff.map((e) => tauToTL(e / partitionAreaM2));
}

/**
 * The classic teaching result: composite TL of a wall with a fractional
 * open area, ignoring the physics of the aperture itself.
 * Included so the UI can show the naive answer next to the real one.
 */
export function naiveApertureCeiling(openFraction) {
  return tauToTL(openFraction);
}

/**
 * Slit half-wave resonance frequencies, where a gap becomes acoustically open.
 * t_eff includes an end correction of 0.85 * (equivalent radius) per end.
 */
export function gapResonances(gap, air = AIR, nMax = 4) {
  const w = gap.widthMm / 1000;
  const t = gap.depthMm / 1000;
  const aEq = gap.shape === 'hole' ? w / 2 : w / 2;
  const tEff = t + 2 * 0.85 * aEq;
  return Array.from({ length: nMax }, (_, n) => ((n + 1) * air.c) / (2 * tEff)).filter((f) => f < 12000);
}

/**
 * Common leak presets, so a user can describe reality quickly.
 * depthMm is overridden by the host element (door/wall thickness) when used.
 */
export const LEAK_PRESETS = [
  { id: 'door-unsealed', label: 'Unsealed door perimeter (3 mm)', shape: 'slit', widthMm: 3, lengthMm: 5600, depthMm: 44 },
  { id: 'door-basic-seal', label: 'Door with basic foam tape (1 mm effective)', shape: 'slit', widthMm: 1, lengthMm: 5600, depthMm: 44, sealResistivity: 5000, sealFillFraction: 0.3 },
  { id: 'door-compression', label: 'Door with compression gasket (0.3 mm)', shape: 'slit', widthMm: 0.3, lengthMm: 5600, depthMm: 44, sealResistivity: 20000, sealFillFraction: 0.5 },
  { id: 'door-undercut', label: 'Door undercut, no bottom seal (10 mm x 900 mm)', shape: 'slit', widthMm: 10, lengthMm: 900, depthMm: 44 },
  { id: 'door-drop-seal', label: 'Automatic drop seal fitted', shape: 'slit', widthMm: 0.2, lengthMm: 900, depthMm: 44, sealResistivity: 30000, sealFillFraction: 0.6 },
  { id: 'cable-hole-open', label: 'Open 50 mm cable pass-through', shape: 'hole', widthMm: 50, depthMm: 150 },
  { id: 'cable-hole-sealed', label: 'Cable pass-through packed with mineral wool', shape: 'hole', widthMm: 50, depthMm: 150, sealResistivity: 25000, sealFillFraction: 1.0 },
  { id: 'socket-back-box', label: 'Recessed socket back-box, unsealed', shape: 'hole', widthMm: 60, depthMm: 35 },
  { id: 'wall-joint', label: 'Unsealed wall/floor junction (2 mm)', shape: 'slit', widthMm: 2, lengthMm: 8000, depthMm: 120 },
  { id: 'wall-joint-sealed', label: 'Wall/floor junction with acoustic sealant', shape: 'slit', widthMm: 0.05, lengthMm: 8000, depthMm: 120, sealResistivity: 200000, sealFillFraction: 1.0 },
  { id: 'window-frame', label: 'Window frame perimeter (0.5 mm)', shape: 'slit', widthMm: 0.5, lengthMm: 3200, depthMm: 100 },
  { id: 'vent-open', label: 'Open 100 mm vent, no attenuator', shape: 'hole', widthMm: 100, depthMm: 150 },
];
