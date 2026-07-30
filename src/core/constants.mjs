/**
 * Physical constants and reference quantities.
 * Air properties at 20 degC, 101.325 kPa, 50% RH unless overridden.
 */

export const AIR = {
  /** Speed of sound (m/s) */
  c: 343.0,
  /** Density (kg/m^3) */
  rho: 1.204,
  /** Characteristic impedance rho*c (Pa*s/m = rayl) */
  z0: 343.0 * 1.204, // 413.0
  /** Ratio of specific heats */
  gamma: 1.402,
  /** Static pressure (Pa) */
  p0: 101325,
  /** Dynamic viscosity (Pa*s) */
  mu: 1.825e-5,
  /** Prandtl number */
  Pr: 0.71,
};

/** Reference sound pressure (Pa) — 0 dB SPL */
export const P_REF = 2e-5;
/** Reference sound power (W) — 0 dB SWL */
export const W_REF = 1e-12;
/** Reference vibration velocity (m/s) — 0 dB Lv (ISO 1683) */
export const V_REF = 1e-9;

/**
 * Recompute air properties for a given temperature.
 * @param {number} tempC
 */
export function airAt(tempC = 20) {
  const T = tempC + 273.15;
  const c = 20.05 * Math.sqrt(T);
  const rho = 1.2929 * (273.15 / T);
  // Sutherland's law for viscosity
  const mu = 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4);
  return { ...AIR, c, rho, z0: c * rho, mu };
}

/** Convert imperial surface density lb/ft^2 -> kg/m^2 */
export const PSF_TO_KGM2 = 4.88243;
/** Inches -> mm */
export const IN_TO_MM = 25.4;
/** Feet -> metres */
export const FT_TO_M = 0.3048;
