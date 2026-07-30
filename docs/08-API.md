# 08 — Library API

Pure, synchronous, no dependencies, no I/O. Imports cleanly into Node, a browser,
a worker, or another tool.

```js
import { simulate } from './src/core/index.mjs';
import { buildDesign, buildScenario } from './src/data/index.mjs';

const result = simulate(buildDesign({ wall: 'booth-pro', door: 'acoustic-45', level: 110 }));
console.log(result.totals.outsideWithFanA);        // dB(A) at the receiver
console.log(result.breakdown.weakest.label);       // what to fix first
```

---

## Top level

### `simulate(design, options?) → Result`
`src/core/solver.mjs`. The whole engine. See `docs/03` for the full result shape.

| Option | Default | Meaning |
|---|---|---|
| `air` | 20 °C set | override air properties (`airAt(tempC)`) |
| `flankingCeilingDb` | 75 | maximum in-building level difference |

### `buildDesign(spec) → Design`
`src/data/designs.mjs`. Builds a complete design from a compact spec; everything
has a default, so override only what matters.

```js
buildDesign({
  L: 1.4, W: 1.4, H: 2.1,               // internal dimensions, m
  wall: 'booth-mid',                     // WALL_PRESETS key
  ceiling: null,                         // defaults to the wall assembly
  door: 'mdf-heavy',                     // DOOR_PRESETS key
  ventPreset: 'labyrinth',               // DUCT_PRESETS key
  ventAirflowLps: 12, ventCount: 2, fanSwl: 55,
  floorSystem: 'floating-wool',          // FLOOR_PRESETS key
  mounting: 'mat-on-timber',             // MOUNTING_PRESETS key
  treatment: { materialId: 'rockwool-rwa45', thicknessMm: 75, coverage: 80 },
  gaps: [ /* Gap[] */ ],
  windows: [ /* window specs */ ],
  occupants: 1,
  sourceId: 'scream', level: 100, weighting: 'Z',
  sourceMode: 'internal-spl',            // or 'source-at-1m'
  customSpectrum: null,                  // 24-band override
  envId: 'bedroom-rented', distanceM: 1.0,
  separatingElementId: 'none',
  calibration: {},
})
```

### `buildScenario(id) → Design`
One of `bedroom-diy`, `bedroom-good`, `apartment-neighbour`, `studio-live-room`,
`office-pod`, `garden-studio`.

---

## Physics

### Panels — `src/core/panel.mjs`
| Function | Returns |
|---|---|
| `singleLeafTL(leaf, opts?)` | `{ tl[24], fc, f11, surfaceMass, etaAt(f) }` |
| `massLawTL(ms, f, air?)` | field-incidence mass law, dB |
| `criticalFrequency(material, mm, air?)` | `f_c`, Hz |
| `longitudinalSpeed(material)` | `c_L`, m/s |
| `totalLossFactor(etaInt, ms, f)` | EN 12354 `η_tot` |
| `panelResonance(leaf, air?)` | `f₁₁`, Hz |
| `surfaceMass(leaf)` / `leafThickness(leaf)` / `leafCost(leaf)` | kg/m², mm, currency/m² |
| `leafProperties(leaf, air?)` | `{ surfaceMass, thickness, fc, etaInternal }` |
| `PANEL_CONSTANTS` | the five fitted panel constants, mutable for sensitivity studies |

### Partitions — `src/core/partition.mjs`
| Function | Returns |
|---|---|
| `partitionTL(partition, opts?)` | `{ tl[24], airborneTL, bridgeTL, f0, fl, fc[], f11[], cavityAlpha, cavityResonances, limitedBy[24], surfaceMass, totalThicknessMm }` |
| `massAirMass(m1, m2, depthMm, fillFraction)` | `f₀`, Hz |
| `cavityResonances(depthMm, air?, n?)` | standing-wave frequencies |
| `cavityFlowDamping(cavity, air?)` | normalised `σt/ρ₀c` |
| `cavityAbsorption(cavity)` | `α[24]` |
| `bridgingAttenuation(conn, f, leafEta?, K?)` | dB |
| `diagnosePartition(result)` | notes with fixes |
| `partitionCost(partition)` | currency/m² |
| `CONNECTIONS`, `BRIDGE_CONSTANTS` | connection library, fitted constants |

### Leaks — `src/core/leaks.mjs`
| Function | Returns |
|---|---|
| `gapTau(gap, opts?)` | `τ[24]` relative to the gap's own area |
| `gapArea(gap)` | m² |
| `gapEffectiveArea(gap, opts?)` | `S·τ` per band, m² |
| `gapLimitedTL(gap, partitionAreaM2, opts?)` | the ceiling this leak alone imposes |
| `gapResonances(gap, air?, n?)` | half-wave resonance frequencies |
| `naiveApertureCeiling(openFraction)` | the textbook area-ratio result, for comparison |
| `LEAK_PRESETS` | 12 realistic leaks |

`opts.leakCoherenceFactor` (default 0.5) sets the coherent radiating length as a
fraction of a wavelength. Raising it makes leaks predict worse.

### Doors — `src/core/door.mjs`
`doorEffectiveArea(door, opts?)` → `{ total[24], paths[], leafTL, fc, surfaceMass }`
`doorCompositeTL(door, opts?)` → `tl[24]` referenced to the door opening
`doorPathBreakdown(door, opts?)` → sub-paths ranked by share
`PERIMETER_SEALS`, `THRESHOLD_SEALS`, `AIRLOCK_MAX_TL_DB`

### Ducts — `src/core/duct.mjs`
`ductInsertionLoss(duct, opts?)` → `{ il[24], breakdown[], velocity, warnings[], endReflection }`
`ductEffectiveArea(duct, opts?)` → `{ total[24], paths[], il }`
`ductBreakoutTL(duct)`, `endReflectionLoss(duct, flush?)`, `linedDuctAttenPerM`,
`bendIL`, `plenumIL`, `regeneratedNoise`, `ductVelocity`, `ductGeometry`
`requiredAirflowLps({ volumeM3, occupants, targetAch?, litresPerPerson? })`
`recommendDuct(targetIL[24], { airflowLps, maxVelocity? })` — searches standard
configurations, cheapest first
`DUCT_PRESETS`

### Structure — `src/core/structure.mjs`
`transmissibility(f, fn, zeta)`, `isolatorAttenuation(isolator)` → `dB[24]`
`fnFromDeflection(mm)`, `deflectionForFn(hz)`
`flankingEffectiveArea(path, opts?)`, `floorImpactImprovement(floor)`
`structureBorneSPL({ source, isolator, receiverRoomConstant, junctionLossDb? })`
`diagnoseIsolation(isolator, sourceSpectrum?)`
`ISOLATORS`, `MOUNTING_PRESETS`, `VIBRATION_SOURCES`

### Ratings — `src/core/ratings.mjs`
`computeSTC(tl24)` → `{ stc, deficiencies, totalDeficiency, worstBand }`
`computeRw(tl24)` → `{ rw, c, ctr, rwC, rwCtr }`
`computeNIC(levelDiff24)`, `computeNR(oct8)`, `describeLevel(dBA)`, `CRITERIA`

### Bands and acoustics
`src/core/bands.mjs` — `THIRD_OCTAVE`, `THIRD_OCTAVE_EXACT`, `OCTAVE`, `N_BANDS`,
`A_WEIGHT`, `C_WEIGHT`, `aWeight(f)`, `cWeight(f)`, `toOctaves`, `attenToOctaves`,
`resample(freqs, values)`, `fromOctaves`, `flat(v)`

`src/core/acoustics.mjs` — `dbSum`, `dbSumSpectra`, `dbSub`, `overall`, `overallA`,
`overallC`, `aWeighted`, `tauToTL`, `tlToTau`, `splToP2`, `p2ToSpl`, `wToSwl`,
`swlToW`, `sabineRT`, `eyringRT`, `airAbsorption`, `roomConstant`, `roomSPL`,
`boxEnvelopeSPL`, `receivingRoomSPL`, `incidentIntensity`, `mikiProperties`,
`porousSurfaceImpedance`, `alphaNormal`, `alphaRandom`, `porousAlpha(σ, mm, gapMm?)`

`src/core/complex.mjs` — complex arithmetic plus `besselJ0`, `besselJ1`,
`struveH1`, `pistonRadiation(ka)`

---

## Application layer

### Optimiser — `src/core/optimizer.mjs`

```js
const res = optimise({
  baseSpec,                 // as passed to buildDesign
  targetDbA: 35,
  budget: 2000,
  groups: ['wall', 'door', 'vent', 'floor', 'sealing'],
  locked: [],
});
// → { candidateCount, pareto[], marginal[], recommended, recommendedFull,
//     cheapestMeetingTarget, bestAffordable, feasible, affordableAndFeasible,
//     verdict: { status: 'achievable'|'over-budget'|'infeasible', headline, note } }
```

`singleChangeOptions(baseSpec)` → each upgrade applied on its own, ranked by dB
gained, with `deltaCost` and `valuePer100`.
`compareDesigns(specA, specB, labels?)` → both results plus signed deltas and
`costPerDb`.
`UPGRADE_GROUPS` — the searchable option set; extend it to add components.

### Calibration — `src/core/calibration.mjs`

```js
const a = assess(design, {
  insideOverall: 100, outsideOverall: 38, backgroundOverall: 26,
  weighting: 'A',
  outsideBands: [54, 55, 54, 52, 49, 47, 43, 32],
  bandFrequencies: OCTAVE,
  bandType: 'octave',            // 'octave' | 'third' | 'auto'
  distanceM: 1.0,
});
// → { predictedOverall, measuredOverall, overallErrorDb, perBand[], rmseDb,
//     meanBiasDb, maxAbsErrorDb, errorProfile{lowFreq,midFreq,highFreq},
//     diagnosis[], accuracy{grade,description}, backgroundValid, backgroundWarning }

const fit = fitCalibration(design, [measurement], { mode: 'auto', maxOffsetDb: 12 });
// → { mode, calibration, before, after, calibratedDesign, diagnosis, caveat }
```

**`bandType` matters.** An octave band holds three ⅓-octaves, so its level is
4.77 dB higher. Auto-detection uses the frequency spacing; state it explicitly if
your data is unusual.

`toThirdOctaveLevels(freqs, levels, bandType?)` exposes the conversion.
`MEASUREMENT_PROTOCOL` — the measurement guidance, for display in a UI.

### Material advisor — `src/core/assess.mjs`
`assessMaterial(material, thicknessMm)` → `{ surfaceMass, criticalFrequency,
longitudinalSpeed, tl[24], tl500, absorption, nrc, scores{blocking,absorbing,damping},
coincidenceDipDb, headline, explanation[], warnings[] }`
`costPerKgPerM2(material)`, `rankByValue(materials)`

### Validation — `src/core/validation.mjs`
`runValidation()` → `{ results[], summary{n,passed,failed,meanBiasStc,rmseStc,maxAbsErrorStc,passRate}, curves[] }`
`runCase(labCase)`, `formatValidation(v)`, `LAB_CASES`, `REFERENCE_CURVES`

---

## Data

```js
import {
  MATERIALS, materialsByCategory, createCustomMaterial,
  WALL_PRESETS, DOOR_PRESETS, FLOOR_PRESETS, CEILING_PRESETS,
  SOURCES, sourceSpectrum, sourcesByCategory,
  ENVIRONMENTS, SEPARATING_ELEMENTS, tlFromRw,
  SCENARIOS, buildDesign, buildScenario,
} from './src/data/index.mjs';
```

---

## Recipes

**Sweep a parameter**

```js
for (const depth of [25, 50, 100, 200]) {
  const p = { leaves: [leafA, leafB],
              cavities: [{ depthMm: depth, fill: MATERIALS['rockwool-rwa45'],
                           fillThicknessMm: depth * 0.7 }],
              connection: CONNECTIONS['separate-frame'], areaM2: 10 };
  const r = partitionTL(p);
  console.log(depth, r.f0.toFixed(0), computeSTC(r.tl).stc);
}
```

**Ask "what limits my design?"**

```js
const r = simulate(design);
console.log(r.breakdown.weakest);                     // the dominant path
console.log(r.breakdown.potential.slice(0, 3));       // max gain from fixing each
console.log(r.breakdown.dominantByBand);              // per-band culprit
console.log(r.detail.front.limitedBy);                // mechanism per band
```

**Sensitivity to a fitted constant**

```js
import { PANEL_CONSTANTS } from './src/core/panel.mjs';
const base = PANEL_CONSTANTS.coincidenceOffsetDb;
for (const v of [3.5, 5.5, 7.5]) {
  PANEL_CONSTANTS.coincidenceOffsetDb = v;
  console.log(v, runValidation().summary.rmseStc.toFixed(2));
}
PANEL_CONSTANTS.coincidenceOffsetDb = base;
```

**Size ventilation for a target**

```js
const need = requiredAirflowLps({ volumeM3: 4.1, occupants: 1 });
const rec  = recommendDuct(targetIL24, { airflowLps: need.required / 2, maxVelocity: 2.5 });
console.log(rec.minDiameterMm, rec.best, rec.infeasible);
```

## Invariants the engine guarantees

- Outside level is below inside level in every band.
- Composite transmission loss is positive in every band.
- Breakdown percentages sum to 100.
- Single-leaf TL never exceeds mass law above the fundamental panel mode.
- Gap `τ` stays within `[0, 4]`, and exceeds 1 only near a slit resonance.
- A full simulation completes in under 5 ms.

All six are asserted in `tests/`.
