/**
 * Minimal complex arithmetic plus the special functions needed for
 * piston radiation impedance (Bessel J1, Struve H1).
 *
 * Representation: { re, im }.
 */

export const C = (re, im = 0) => ({ re, im });
export const add = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const scale = (a, k) => ({ re: a.re * k, im: a.im * k });
export const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const abs2 = (a) => a.re * a.re + a.im * a.im;
export const abs = (a) => Math.hypot(a.re, a.im);
export const neg = (a) => ({ re: -a.re, im: -a.im });
export const conj = (a) => ({ re: a.re, im: -a.im });

/** Principal square root. */
export function csqrt(a) {
  const r = abs(a);
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2));
  let im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  if (a.im < 0) im = -im;
  return { re, im };
}

export function cexp(a) {
  const e = Math.exp(a.re);
  return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) };
}

export function ccosh(a) {
  return { re: Math.cosh(a.re) * Math.cos(a.im), im: Math.sinh(a.re) * Math.sin(a.im) };
}

export function csinh(a) {
  return { re: Math.sinh(a.re) * Math.cos(a.im), im: Math.cosh(a.re) * Math.sin(a.im) };
}

export function ctanh(a) {
  // Numerically stable for large |re|
  if (Math.abs(a.re) > 20) return { re: Math.sign(a.re), im: 0 };
  return div(csinh(a), ccosh(a));
}

export function ccot(a) {
  const s = { re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) };
  const c = { re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) };
  return div(c, s);
}

/* ---------------------------------------------------------------- *
 * Bessel J0 / J1 — Abramowitz & Stegun 9.4.1-9.4.6 polynomial fits.
 * Absolute error < 1e-7 (small x) / < 1e-7 relative (large x).
 * ---------------------------------------------------------------- */

export function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax < 3) {
    const t = x / 3, y = t * t;
    return 1 - 2.2499997 * y + 1.2656208 * y * y - 0.3163866 * y ** 3
      + 0.0444479 * y ** 4 - 0.0039444 * y ** 5 + 0.00021 * y ** 6;
  }
  const z = 3 / ax;
  const f = 0.79788456 - 0.00000077 * z - 0.0055274 * z ** 2 - 0.00009512 * z ** 3
    + 0.00137237 * z ** 4 - 0.00072805 * z ** 5 + 0.00014476 * z ** 6;
  const th = ax - 0.78539816 - 0.04166397 * z - 0.00003954 * z ** 2 + 0.00262573 * z ** 3
    - 0.00054125 * z ** 4 - 0.00029333 * z ** 5 + 0.00013558 * z ** 6;
  return f * Math.cos(th) / Math.sqrt(ax);
}

export function besselJ1(x) {
  const ax = Math.abs(x);
  let r;
  if (ax < 3) {
    const t = x / 3, y = t * t;
    r = x * (0.5 - 0.56249985 * y + 0.21093573 * y * y - 0.03954289 * y ** 3
      + 0.00443319 * y ** 4 - 0.00031761 * y ** 5 + 0.00001109 * y ** 6);
    return r;
  }
  const z = 3 / ax;
  const f = 0.79788456 + 0.00000156 * z + 0.01659667 * z ** 2 + 0.00017105 * z ** 3
    - 0.00249511 * z ** 4 + 0.00113653 * z ** 5 - 0.00020033 * z ** 6;
  const th = ax - 2.35619449 + 0.12499612 * z + 0.0000565 * z ** 2 - 0.00637879 * z ** 3
    + 0.00074348 * z ** 4 + 0.00079824 * z ** 5 - 0.00029166 * z ** 6;
  r = f * Math.cos(th) / Math.sqrt(ax);
  return x < 0 ? -r : r;
}

/**
 * Struve function H1(x), x >= 0.
 * Power series below x = 12, Aarts & Janssen (2003) asymptotic above.
 */
export function struveH1(x) {
  if (x < 0) return struveH1(-x);
  if (x < 12) {
    // H1(x) = sum_{k>=0} (-1)^k (x/2)^{2k+2} / [Gamma(k+3/2) Gamma(k+5/2)]
    const h = x / 2;
    let term = (h * h) / (0.8862269254527580 * 1.3293403881791370); // 1/(G(1.5)G(2.5))
    let sum = term;
    for (let k = 1; k < 60; k++) {
      // ratio: -(h^2) / ((k+0.5)(k+1.5))
      term *= -(h * h) / ((k + 0.5) * (k + 1.5));
      sum += term;
      if (Math.abs(term) < 1e-16 * Math.abs(sum)) break;
    }
    return sum;
  }
  return (2 / Math.PI) - besselJ0(x)
    + ((16 / Math.PI - 5) / x) * Math.sin(x)
    + ((12 - 36 / Math.PI) / (x * x)) * (1 - Math.cos(x));
}

/**
 * Normalised radiation impedance of a rigid circular piston in an infinite baffle.
 * Z = rho*c/S * (R1(2ka) + j X1(2ka)).
 * @param {number} ka  wavenumber * piston radius
 * @returns {{R:number, X:number}}
 */
export function pistonRadiation(ka) {
  const x = 2 * ka;
  if (x < 1e-6) return { R: x * x / 8, X: (4 * x) / (3 * Math.PI) };
  const R = 1 - (2 * besselJ1(x)) / x;
  const X = (2 * struveH1(x)) / x;
  return { R: Math.max(R, 1e-12), X };
}
