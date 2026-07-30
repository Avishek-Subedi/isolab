/**
 * General acoustics utilities: decibel algebra, diffuse-field relations,
 * room absorption, distance laws, and the Miki porous-absorber model.
 */

import { AIR, P_REF, W_REF } from './constants.mjs';
import { THIRD_OCTAVE_EXACT, N_BANDS, A_WEIGHT, C_WEIGHT } from './bands.mjs';
import * as X from './complex.mjs';

/* ---------------- decibel algebra ---------------- */

/** Energy (power) sum of a list of dB values. */
export function dbSum(list) {
  let s = 0;
  for (const v of list) {
    if (v === null || v === undefined || !isFinite(v)) continue;
    s += Math.pow(10, v / 10);
  }
  return s > 0 ? 10 * Math.log10(s) : -Infinity;
}

/** Element-wise energy sum of several 24-band spectra. */
export function dbSumSpectra(spectra) {
  const out = new Array(N_BANDS).fill(0);
  for (const sp of spectra) for (let i = 0; i < N_BANDS; i++) out[i] += Math.pow(10, sp[i] / 10);
  return out.map((v) => (v > 0 ? 10 * Math.log10(v) : -200));
}

/** Energy subtraction a - b in dB (returns -200 if b >= a). */
export function dbSub(a, b) {
  const d = Math.pow(10, a / 10) - Math.pow(10, b / 10);
  return d > 0 ? 10 * Math.log10(d) : -200;
}

/** Overall (unweighted, "Z") level of a 24-band spectrum. */
export const overall = (sp) => dbSum(sp);
/** A-weighted overall level. */
export const overallA = (sp) => dbSum(sp.map((v, i) => v + A_WEIGHT[i]));
/** C-weighted overall level. */
export const overallC = (sp) => dbSum(sp.map((v, i) => v + C_WEIGHT[i]));
/** A-weighted spectrum. */
export const aWeighted = (sp) => sp.map((v, i) => v + A_WEIGHT[i]);

/** Transmission coefficient -> transmission loss (dB). */
export const tauToTL = (tau) => -10 * Math.log10(Math.max(tau, 1e-12));
/** Transmission loss (dB) -> transmission coefficient. */
export const tlToTau = (tl) => Math.pow(10, -tl / 10);

/** SPL (dB) -> mean-square pressure (Pa^2). */
export const splToP2 = (spl) => P_REF * P_REF * Math.pow(10, spl / 10);
/** Mean-square pressure -> SPL. */
export const p2ToSpl = (p2) => 10 * Math.log10(Math.max(p2, 1e-30) / (P_REF * P_REF));
/** Sound power (W) -> SWL (dB). */
export const wToSwl = (w) => 10 * Math.log10(Math.max(w, 1e-30) / W_REF);
/** SWL -> W. */
export const swlToW = (swl) => W_REF * Math.pow(10, swl / 10);

/* ---------------- room acoustics ---------------- */

/**
 * Sabine reverberation time.
 * @param {number} V volume m^3
 * @param {number} A total absorption m^2 (sabins), including air absorption
 */
export const sabineRT = (V, A) => (A > 0 ? (0.161 * V) / A : Infinity);

/** Eyring RT — more accurate for small, dead rooms like vocal booths. */
export function eyringRT(V, S, alphaBar, mAir = 0) {
  const a = Math.min(alphaBar, 0.99);
  const den = -S * Math.log(1 - a) + 4 * mAir * V;
  return den > 0 ? (0.161 * V) / den : Infinity;
}

/**
 * Air absorption coefficient m (1/m) — ISO 9613-1 simplified fit,
 * 20 degC / 50% RH. Only matters above ~2 kHz and over long paths.
 */
export function airAbsorption(f) {
  const t = [50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000,
    1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000];
  const m = [0.00002, 0.00003, 0.00004, 0.00006, 0.00008, 0.0001, 0.00013, 0.00016,
    0.0002, 0.00025, 0.0003, 0.0004, 0.0005, 0.0007, 0.001, 0.0013, 0.0019, 0.0026,
    0.0037, 0.0053, 0.0077, 0.0112, 0.0165, 0.0248];
  let i = t.findIndex((x) => x >= f);
  if (i <= 0) return m[0];
  if (i >= t.length) return m[m.length - 1];
  const w = (Math.log10(f) - Math.log10(t[i - 1])) / (Math.log10(t[i]) - Math.log10(t[i - 1]));
  return m[i - 1] + w * (m[i] - m[i - 1]);
}

/**
 * Room constant R = S*alphaBar/(1-alphaBar).
 */
export function roomConstant(S, alphaBar) {
  const a = Math.min(Math.max(alphaBar, 0.005), 0.99);
  return (S * a) / (1 - a);
}

/**
 * SPL in a room from a source of power W, at distance r, directivity Q.
 * Lp = Lw + 10 log10( Q/(4 pi r^2) + 4/R )
 */
export function roomSPL(swl, r, Q, R) {
  const direct = Q / (4 * Math.PI * r * r);
  const rev = R > 0 ? 4 / R : 0;
  return swl + 10 * Math.log10(direct + rev);
}

/**
 * Free-field SPL over a measurement box enveloping a source (ISO 3744
 * parallelepiped), source standing on a reflecting plane.
 * This is far more accurate than 20log10(r) at the short distances
 * (0.5-2 m) that matter for a booth in a room.
 * @param {number} swl
 * @param {{l:number,w:number,h:number}} box source dimensions (m)
 * @param {number} d measurement distance from the box surface (m)
 */
export function boxEnvelopeSPL(swl, box, d) {
  const a = box.l / 2 + d;
  const b = box.w / 2 + d;
  const c = box.h + d;
  const S = 4 * (a * b + b * c + c * a);
  return swl - 10 * Math.log10(S);
}

/**
 * Diffuse-field receiving-room level (ISO 16283 / ISO 140 form).
 * L2 = Lw + 10log10(4/R2)
 */
export function receivingRoomSPL(swl, R2) {
  return swl + 10 * Math.log10(4 / Math.max(R2, 0.1));
}

/** Diffuse-field power incident on unit area from a field of SPL L: p^2/(4 rho c). */
export function incidentIntensity(spl, air = AIR) {
  return splToP2(spl) / (4 * air.rho * air.c);
}

/* ---------------- porous absorber: Miki model ---------------- */

/**
 * Miki (1990) empirical model for a rigid-frame fibrous absorber.
 * Returns characteristic impedance Zc (rayl) and complex wavenumber k (1/m).
 * Valid for 0.01 < f/sigma < 1.0.
 * @param {number} f Hz
 * @param {number} sigma flow resistivity, Pa*s/m^2
 */
export function mikiProperties(f, sigma, air = AIR) {
  const e = Math.max(f / sigma, 1e-7);
  const p632 = Math.pow(1000 * e, -0.632);
  const p618 = Math.pow(1000 * e, -0.618);
  const Zc = X.C(air.z0 * (1 + 5.5 * p632), -air.z0 * 8.43 * p632);
  const w = (2 * Math.PI * f) / air.c;
  const k = X.C(w * (1 + 7.81 * p618), -w * 11.41 * p618);
  return { Zc, k };
}

/**
 * Surface impedance of a porous layer of thickness d, rigidly backed,
 * optionally with an air gap g behind it.
 */
export function porousSurfaceImpedance(f, sigma, d, gap = 0, air = AIR) {
  const { Zc, k } = mikiProperties(f, sigma, air);
  const kd = X.scale(k, d);
  let Zback;
  if (gap > 0) {
    const kg = (2 * Math.PI * f) / air.c;
    // -j Z0 cot(k g)
    const cot = X.ccot(X.C(kg * gap, 0));
    Zback = X.mul(X.C(0, -air.z0), cot);
  } else {
    Zback = X.C(1e12, 0); // rigid
  }
  // Zs = Zc * (Zback cosh(kd) + Zc sinh(kd)) / (Zc cosh(kd) + Zback sinh(kd))
  const jkd = X.C(-kd.im, kd.re); // j*k*d
  const ch = X.ccosh(jkd);
  const sh = X.csinh(jkd);
  const num = X.add(X.mul(Zback, ch), X.mul(Zc, sh));
  const den = X.add(X.mul(Zc, ch), X.mul(Zback, sh));
  return X.mul(Zc, X.div(num, den));
}

/** Normal-incidence absorption coefficient from surface impedance. */
export function alphaNormal(Zs, air = AIR) {
  const r = X.div(X.sub(Zs, X.C(air.z0, 0)), X.add(Zs, X.C(air.z0, 0)));
  return Math.max(0, Math.min(1, 1 - X.abs2(r)));
}

/**
 * Random-incidence (statistical) absorption coefficient by Paris integration
 * over incidence angle, assuming a locally-reacting surface.
 */
export function alphaRandom(Zs, air = AIR) {
  let sum = 0, wsum = 0;
  const N = 36;
  for (let i = 0; i < N; i++) {
    const th = ((i + 0.5) / N) * (Math.PI / 2);
    const cos = Math.cos(th);
    const zc = X.scale(Zs, cos);
    const r = X.div(X.sub(zc, X.C(air.z0, 0)), X.add(zc, X.C(air.z0, 0)));
    const a = 1 - X.abs2(r);
    sum += a * Math.sin(th) * cos;
    wsum += Math.sin(th) * cos;
  }
  return Math.max(0, Math.min(1, sum / wsum));
}

/**
 * Full 24-band random-incidence absorption spectrum for a porous layer.
 * @param {number} sigma flow resistivity Pa*s/m^2
 * @param {number} thicknessMm
 * @param {number} airGapMm
 */
export function porousAlpha(sigma, thicknessMm, airGapMm = 0) {
  const d = thicknessMm / 1000;
  const g = airGapMm / 1000;
  return THIRD_OCTAVE_EXACT.map((f) => alphaRandom(porousSurfaceImpedance(f, sigma, d, g)));
}
