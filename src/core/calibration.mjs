/**
 * Reality calibration.
 *
 * The user builds the booth, measures it, and tells the simulator what actually
 * happened. The simulator then reports its own error honestly and, if asked,
 * fits correction factors so that subsequent predictions for *this* build are
 * anchored to measurement.
 *
 * Two calibration modes, deliberately separated because they mean different
 * things:
 *
 *  1. GLOBAL OFFSET — a single dB shift. Appropriate when the measured and
 *     predicted spectra are the same shape but offset. Almost always means a
 *     systematic construction difference (workmanship, an unmodelled leak of
 *     roughly constant transmission, or a level-meter position issue).
 *
 *  2. PER-BAND OFFSETS — a 24-band correction vector. Appropriate when the
 *     shapes disagree, which localises the physical cause: a low-frequency-only
 *     error points at flanking or the mass-air-mass resonance; a
 *     high-frequency-only error points at a leak.
 *
 * The module also *diagnoses* the residual rather than just absorbing it,
 * because a calibration that silently hides a 12 dB low-frequency error is
 * worse than no calibration at all.
 */

import { THIRD_OCTAVE, N_BANDS, A_WEIGHT, toOctaves, resample, OCTAVE } from './bands.mjs';
import { overallA, overall, dbSum } from './acoustics.mjs';
import { simulate } from './solver.mjs';

/**
 * Convert a measured band spectrum onto the engine's 1/3-octave grid.
 *
 * Measurements are normally reported in octave bands, and an octave band holds
 * the energy of three 1/3-octaves — about 4.77 dB more. Interpolating octave
 * levels straight onto a 1/3-octave grid therefore inflates every value by
 * 4.8 dB, which silently poisons the whole calibration. Band type is detected
 * from the frequency spacing unless stated explicitly.
 *
 * @param {number[]} freqs
 * @param {number[]} levels
 * @param {'octave'|'third'|'auto'} [bandType]
 */
export function toThirdOctaveLevels(freqs, levels, bandType = 'auto') {
  let type = bandType;
  if (type === 'auto') {
    if (freqs.length < 2) type = 'third';
    else {
      const ratio = freqs[1] / freqs[0];
      type = ratio > 1.7 ? 'octave' : 'third';
    }
  }
  const corr = type === 'octave' ? 10 * Math.log10(3) : 0;
  return resample(freqs, levels.map((v) => v - corr));
}
/**
 * @typedef {Object} Measurement
 * @property {string} [id]
 * @property {string} [date]
 * @property {string} [notes]
 * @property {number} [insideOverall]     measured inside level, dB
 * @property {number} [outsideOverall]    measured outside level, dB
 * @property {'Z'|'A'} [weighting]
 * @property {number[]} [insideBands]      measured inside spectrum
 * @property {number[]} [outsideBands]     measured outside spectrum
 * @property {number[]} [bandFrequencies]  frequencies for the above (octave or 1/3-octave)
 * @property {'octave'|'third'|'auto'} [bandType]  defaults to auto-detect from spacing
 * @property {number} [distanceM]
 * @property {number} [backgroundOverall]  measured background with the source off
 */

/**
 * Compare a measurement with a prediction.
 * @param {object} design
 * @param {Measurement} m
 */
export function assess(design, m) {
  // Re-run the prediction with the measurement's own source level so that the
  // comparison isolates the *enclosure* error rather than a source mismatch.
  const d = { ...design };
  if (m.insideOverall != null) {
    d.source = { ...design.source, level: m.insideOverall, weighting: m.weighting || 'Z', mode: 'internal-spl' };
  }
  if (m.insideBands && m.bandFrequencies) {
    d.source = {
      ...design.source,
      customSpectrum: toThirdOctaveLevels(m.bandFrequencies, m.insideBands, m.bandType),
      mode: 'internal-spl',
    };
  }
  if (m.distanceM != null) d.receiver = { ...design.receiver, distanceM: m.distanceM };

  const r = simulate(d);

  const weighting = m.weighting || 'A';
  const predictedOverall = weighting === 'A' ? r.totals.outsideA : r.totals.outsideZ;

  /** @type {any} */
  const out = {
    prediction: r,
    weighting,
    predictedOverall,
    measuredOverall: m.outsideOverall ?? null,
    overallErrorDb: m.outsideOverall != null ? predictedOverall - m.outsideOverall : null,
  };

  // --- background contamination check ---
  if (m.backgroundOverall != null && m.outsideOverall != null) {
    const margin = m.outsideOverall - m.backgroundOverall;
    out.backgroundMargin = margin;
    out.backgroundValid = margin >= 10;
    if (margin < 3) {
      out.backgroundWarning = `The measured outside level is only ${margin.toFixed(1)} dB above the background. Per ISO 16283 this measurement is invalid — the booth may be far quieter than ${m.outsideOverall} dB and you are simply measuring the room. Repeat with a louder source or a quieter time of day.`;
    } else if (margin < 6) {
      out.backgroundWarning = `Only ${margin.toFixed(1)} dB above background. Apply the standard correction (subtract the background energetically) and treat the result as an upper bound.`;
      out.backgroundCorrectedOverall = 10 * Math.log10(
        Math.max(1e-9, Math.pow(10, m.outsideOverall / 10) - Math.pow(10, m.backgroundOverall / 10)));
    } else if (margin < 10) {
      out.backgroundWarning = `${margin.toFixed(1)} dB above background — usable, but apply the energetic background correction.`;
      out.backgroundCorrectedOverall = 10 * Math.log10(
        Math.max(1e-9, Math.pow(10, m.outsideOverall / 10) - Math.pow(10, m.backgroundOverall / 10)));
    }
  }

  // --- per-band comparison ---
  if (m.outsideBands && m.bandFrequencies) {
    const measured24 = toThirdOctaveLevels(m.bandFrequencies, m.outsideBands, m.bandType);
    const predicted24 = r.outside.spectrum;
    const err24 = predicted24.map((v, i) => v - measured24[i]);
    out.perBand = THIRD_OCTAVE.map((f, i) => ({
      band: f, predicted: predicted24[i], measured: measured24[i], error: err24[i],
    }));
    out.measured24 = measured24;
    out.errors24 = err24;
    out.rmseDb = Math.sqrt(err24.reduce((a, b) => a + b * b, 0) / N_BANDS);
    out.meanBiasDb = err24.reduce((a, b) => a + b, 0) / N_BANDS;
    out.maxAbsErrorDb = Math.max(...err24.map(Math.abs));
    // Where is the error concentrated?
    const lf = err24.slice(0, 8).reduce((a, b) => a + b, 0) / 8;   // 50-250 Hz
    const mf = err24.slice(8, 16).reduce((a, b) => a + b, 0) / 8;  // 315-1600 Hz
    const hf = err24.slice(16).reduce((a, b) => a + b, 0) / 8;     // 2k-10k
    out.errorProfile = { lowFreq: lf, midFreq: mf, highFreq: hf };
    out.diagnosis = diagnoseResidual({ lf, mf, hf, bias: out.meanBiasDb, rmse: out.rmseDb });
  } else if (out.overallErrorDb != null) {
    out.diagnosis = diagnoseResidual({
      lf: out.overallErrorDb, mf: out.overallErrorDb, hf: out.overallErrorDb,
      bias: out.overallErrorDb, rmse: Math.abs(out.overallErrorDb), overallOnly: true,
    });
  }

  out.accuracy = gradeAccuracy(out);
  return out;
}

/**
 * Interpret the residual physically. This is the valuable half of calibration:
 * the *shape* of the disagreement tells you what you actually built.
 */
function diagnoseResidual({ lf, mf, hf, bias, rmse, overallOnly }) {
  const notes = [];
  const sign = (v) => (v > 0 ? 'over-predicts' : 'under-predicts');

  if (Math.abs(bias) < 2 && rmse < 3) {
    notes.push({
      severity: 'info',
      title: 'Prediction agrees with measurement within normal uncertainty',
      detail: `Mean bias ${bias.toFixed(1)} dB, RMSE ${rmse.toFixed(1)} dB. This is as good as field acoustic prediction gets — the reproducibility of the field measurement itself is around 2-3 dB. No calibration is warranted; applying one would be fitting noise.`,
    });
    return notes;
  }

  if (overallOnly) {
    notes.push({
      severity: 'medium',
      title: `Overall level ${sign(bias)} by ${Math.abs(bias).toFixed(1)} dB`,
      detail: `Without a measured spectrum the cause cannot be localised. A single-number offset can be applied, but it will be wrong for other source spectra. Measure in octave bands and re-run to find out whether the error is at low frequency (flanking, mass-air-mass) or high frequency (a leak).`,
      fixes: ['Re-measure in octave bands, 63 Hz to 8 kHz', 'Measure with the source off to establish the background'],
    });
    return notes;
  }

  // Sign convention: error = predicted - measured.
  //   error < 0  the real build is LOUDER than predicted -> something unmodelled
  //   error > 0  the real build is QUIETER than predicted -> better than modelled
  //
  // The discriminator is the *tilt* of the residual, not the absolute value in
  // any one region. Absolute thresholds are fragile: a user supplying
  // octave-band data (as they normally will) introduces a few dB of unavoidable
  // artifact when it is mapped onto the 1/3-octave grid, which is enough to
  // suppress an absolute test while leaving the tilt intact.
  //
  // tilt > 0  low frequencies are relatively worse -> structural path
  // tilt < 0  high frequencies are relatively worse -> air leak
  const tilt = hf - lf;
  const differ = Math.abs(tilt) > 4;

  if (differ && tilt > 4 && lf < -3) {
    notes.push({
      severity: 'high',
      title: `Low frequencies are ${Math.abs(lf).toFixed(1)} dB louder than predicted, while high frequencies agree`,
      detail: 'A low-frequency-only error is the signature of a structural path the model has under-weighted: flanking through the floor or the building frame, a rigid connection that should have been resilient, or a mass-air-mass resonance that landed lower than designed. It is not a leak — leaks show up at high frequency.',
      fixes: [
        'Check for any rigid contact between the booth and the building: one screw into a joist is enough',
        'Verify the floating floor actually floats — that nothing bridges it at the edges',
        'Select a more pessimistic mounting preset, or raise the modelled flanking path, and re-run',
      ],
    });
  }

  if (differ && tilt < -4 && hf < -3) {
    notes.push({
      severity: 'high',
      title: `High frequencies are ${Math.abs(hf).toFixed(1)} dB louder than predicted, while low frequencies agree`,
      detail: 'A high-frequency-only error is the classic signature of an air leak the model does not know about. Gap transmission is broadband, but its effect is most visible where the walls are otherwise strongest, which is the top of the spectrum.',
      fixes: [
        'Do a torch test: light inside, dark outside, look for light getting through the envelope',
        'Check the door threshold and the frame-to-wall junction first — they are the usual culprits',
        'Add the leak you find to the model as a gap and confirm the prediction now matches',
      ],
    });
  }

  if (differ && tilt < -4 && lf > 3) {
    notes.push({
      severity: 'medium',
      title: `Low frequencies are ${Math.abs(lf).toFixed(1)} dB quieter than predicted — better than modelled`,
      detail: 'Usually means the real construction is stiffer or heavier than specified, or the receiving room is more absorptive at low frequency than the environment preset assumes. Small rooms also have strong modal behaviour below about 100 Hz, so a single microphone position can easily read 10 dB low if it happens to sit in a null.',
      fixes: ['Repeat the low-frequency measurement at three or more positions and average energetically'],
    });
  }

  if (differ && tilt > 4 && hf > 3) {
    notes.push({
      severity: 'medium',
      title: `High frequencies are ${Math.abs(hf).toFixed(1)} dB quieter than predicted — sealing is better than specified`,
      detail: 'The envelope is tighter than the model assumes. Either the seals are performing better than their preset, or the modelled gaps are not actually present in the build. Reduce the modelled gap widths so future predictions for this build start from the right place.',
      fixes: ['Reduce or remove the modelled gaps to match what was actually built'],
    });
  }

  if (Math.abs(bias) > 2 && Math.abs(tilt) < 3) {
    notes.push({
      severity: 'medium',
      title: `Uniform ${sign(bias)} of ${Math.abs(bias).toFixed(1)} dB across the spectrum`,
      detail: 'A spectrally flat error is the one case where a global offset is a legitimate calibration. Likely causes are a source level that differs from the assumed one, a microphone distance or position difference, or a receiving-room absorption that differs from the preset.',
      fixes: ['Apply a global offset calibration', 'Check the assumed receiver distance and the receiving room preset'],
    });
  }

  if (rmse > 6) {
    notes.push({
      severity: 'high',
      title: `Large scatter (RMSE ${rmse.toFixed(1)} dB) — the model and the build disagree structurally`,
      detail: 'This is beyond what an offset should be used to hide. Something in the design as built differs materially from the design as modelled. Re-check the actual construction against the specification before calibrating: calibration should correct a small residual, not paper over a wrong model.',
      fixes: ['Audit the as-built construction against the modelled one', 'Look for an unmodelled ventilation path or penetration'],
    });
  }

  return notes;
}

function gradeAccuracy(out) {
  const e = out.rmseDb != null ? out.rmseDb : Math.abs(out.overallErrorDb ?? 99);
  let grade, description;
  if (e <= 2) { grade = 'excellent'; description = 'Within the reproducibility of the measurement itself.'; }
  else if (e <= 4) { grade = 'good'; description = 'Typical of a well-executed field prediction.'; }
  else if (e <= 7) { grade = 'fair'; description = 'Usable for design decisions but not for compliance claims.'; }
  else if (e <= 12) { grade = 'poor'; description = 'A significant path is mismodelled or unmodelled.'; }
  else { grade = 'invalid'; description = 'Model and reality disagree fundamentally — investigate before trusting either.'; }
  return { grade, description, errorDb: e };
}

/**
 * Fit calibration factors from one or more measurements.
 *
 * @param {object} design
 * @param {Measurement[]} measurements
 * @param {{mode?:'global'|'per-band'|'auto', maxOffsetDb?:number, smooth?:boolean}} [opts]
 */
export function fitCalibration(design, measurements, opts = {}) {
  const maxOffset = opts.maxOffsetDb ?? 12;
  const assessments = measurements.map((m) => assess(design, m));

  const withBands = assessments.filter((a) => a.errors24);
  let mode = opts.mode || 'auto';
  if (mode === 'auto') {
    if (!withBands.length) mode = 'global';
    else {
      const spread = withBands.map((a) =>
        Math.abs(a.errorProfile.lowFreq - a.errorProfile.highFreq));
      mode = Math.max(...spread) > 4 ? 'per-band' : 'global';
    }
  }

  /** @type {{globalOffsetDb?:number, offsets?:number[]}} */
  const calibration = {};
  const clamp = (v) => Math.max(-maxOffset, Math.min(maxOffset, v));

  if (mode === 'per-band' && withBands.length) {
    const offsets = new Array(N_BANDS).fill(0);
    for (let i = 0; i < N_BANDS; i++) {
      let s = 0;
      for (const a of withBands) s += a.errors24[i];
      offsets[i] = clamp(-s / withBands.length);
    }
    // Optional 3-band smoothing: measurement noise in a single 1/3-octave is
    // large, and an unsmoothed offset vector bakes that noise in permanently.
    if (opts.smooth !== false) {
      const sm = offsets.slice();
      for (let i = 0; i < N_BANDS; i++) {
        const a = offsets[Math.max(0, i - 1)], b = offsets[i], c = offsets[Math.min(N_BANDS - 1, i + 1)];
        sm[i] = (a + 2 * b + c) / 4;
      }
      calibration.offsets = sm;
    } else {
      calibration.offsets = offsets;
    }
  } else {
    const errs = assessments
      .map((a) => (a.rmseDb != null ? a.meanBiasDb : a.overallErrorDb))
      .filter((v) => v != null);
    calibration.globalOffsetDb = errs.length ? clamp(-errs.reduce((x, y) => x + y, 0) / errs.length) : 0;
  }

  // Verify: re-run with the calibration applied.
  const calibrated = { ...design, calibration: { ...(design.calibration || {}), ...calibration } };
  const after = measurements.map((m) => assess(calibrated, m));

  return {
    mode,
    calibration,
    before: {
      rmseDb: mean(assessments.map((a) => a.rmseDb ?? Math.abs(a.overallErrorDb))),
      meanBiasDb: mean(assessments.map((a) => a.meanBiasDb ?? a.overallErrorDb)),
      accuracy: assessments[0]?.accuracy,
    },
    after: {
      rmseDb: mean(after.map((a) => a.rmseDb ?? Math.abs(a.overallErrorDb))),
      meanBiasDb: mean(after.map((a) => a.meanBiasDb ?? a.overallErrorDb)),
      accuracy: after[0]?.accuracy,
    },
    assessments,
    calibratedDesign: calibrated,
    diagnosis: assessments.flatMap((a) => a.diagnosis || []),
    caveat: mode === 'per-band'
      ? 'Per-band offsets are specific to this build, this receiver position and this environment. They correct a residual; they do not make the model more general. Re-verify if any of those change.'
      : 'A global offset assumes the error is spectrally flat. If you later measure a spectrum and find it is not, refit in per-band mode.',
  };
}

const mean = (a) => {
  const v = a.filter((x) => x != null && isFinite(x));
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
};

/**
 * Guidance for taking a measurement that is actually worth calibrating against.
 */
export const MEASUREMENT_PROTOCOL = {
  title: 'How to measure your booth so the numbers mean something',
  steps: [
    'Use a calibrated sound level meter, Class 2 or better. A phone app is not adequate below about 200 Hz or above about 100 dB, which are exactly the regions that decide the answer.',
    'Measure the background first, with the source off, at the same outside position. If your later measurement is not at least 10 dB above this, the result is not valid.',
    'Use a broadband source, not your voice. Pink noise through a speaker is repeatable; a scream is not. Aim for 95-105 dB inside.',
    'Inside: average at least three positions at least 0.7 m apart and 0.5 m from any surface. Small booths have strong modal variation and a single position can be 10 dB out at low frequency.',
    'Outside: measure at a stated distance (1 m is conventional) and record it. Also record whether the position is near a corner, since that alone is worth 3-6 dB.',
    'Record octave-band levels from 63 Hz to 8 kHz, not just dB(A). A single A-weighted number cannot distinguish a leak from flanking, and those need opposite remedies.',
    'Use Leq over at least 30 seconds with a steady source, not a peak hold.',
    'Note the time of day, whether windows were open, and any HVAC that was running.',
  ],
  invalidatingConditions: [
    'Outside level within 3 dB of the background — the measurement is meaningless.',
    'Source level not recorded — the level difference cannot be computed.',
    'Single microphone position at low frequency — modal variation dominates.',
    'A-weighted only — no diagnostic value.',
  ],
};
