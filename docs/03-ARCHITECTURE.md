# 03 — Software Architecture

## Design principles

1. **The engine is a pure function.** `simulate(design) → result`. No I/O, no
   globals, no async, no mutation of inputs. The same code runs in Node (CLI,
   tests) and in the browser (UI) with no adaptation layer.
2. **Physics from properties, never from lookup tables.** Materials carry
   density, Young's modulus, Poisson's ratio, loss factor and flow resistivity.
   Transmission loss and absorption are *computed*, so any thickness, any layer
   stack and any custom material work without a data entry.
3. **One canonical currency: `S·τ`.** Every transmission path — wall, door leaf,
   threshold gap, duct bore, flanking — reduces to an effective transmitting
   area per band. Paths then add linearly on a power basis, which makes the
   leakage breakdown an exact power fraction rather than a heuristic.
4. **Fast enough that real time is trivial.** A complete 24-band simulation of a
   full booth takes ~1–4 ms. There is no server, no worker, no debouncing and no
   interpolation between cached answers. The optimiser exploits the same speed to
   search exhaustively instead of greedily.
5. **Calibration constants are collected and labelled.** Every fitted number
   lives in an exported `*_CONSTANTS` object with a comment saying what it is,
   why it departs from the textbook, and which validation case pinned it.

## Layer diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRESENTATION                                                        │
│  src/ui/index.html   layout, controls, tabs                          │
│  src/ui/app.mjs      state, event wiring, rendering                  │
│  src/ui/charts.mjs   canvas line/bar/donut/Pareto, heat ramp         │
│  src/ui/viz3d.mjs    3D booth, heat map, picking (no WebGL)          │
│  cli/simulate.mjs    terminal reports, ASCII plots                   │
│  cli/serve.mjs       zero-dependency static server                   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  imports only
┌───────────────────────────────▼──────────────────────────────────────┐
│  APPLICATION                                                         │
│  core/solver.mjs        assemble elements, power balance, receiver    │
│  core/optimizer.mjs     exhaustive search, Pareto front, marginals    │
│  core/calibration.mjs   measurement vs prediction, residual diagnosis │
│  core/validation.mjs    laboratory regression suite                   │
│  core/assess.mjs        material advisor                              │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  PHYSICS                                                             │
│  core/panel.mjs      single leaf: mass law, coincidence, plateau      │
│  core/partition.mjs  double leaf: MAM, cavity, bridging               │
│  core/leaks.mjs      Zwikker–Kosten viscothermal gap transmission     │
│  core/door.mjs       leaf + 4 gap sub-paths + air lock                │
│  core/duct.mjs       ASHRAE elements, breakout, sizing                │
│  core/structure.mjs  SDOF isolation, flanking, floating floors        │
│  core/ratings.mjs    STC, Rw, C, Ctr, NIC, NR                         │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  FOUNDATION                                                          │
│  core/bands.mjs      ⅓-octave grid, weightings, band folding          │
│  core/acoustics.mjs  dB algebra, Sabine, Miki absorber, distance laws │
│  core/complex.mjs    complex arithmetic, Bessel J₀/J₁, Struve H₁      │
│  core/constants.mjs  air properties, reference quantities             │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  DATA                                                                │
│  data/materials.mjs    45 materials with full physical properties     │
│  data/assemblies.mjs   wall / door / floor / ceiling presets          │
│  data/sources.mjs      20 source spectra                              │
│  data/environments.mjs receiving rooms, backgrounds, party walls      │
│  data/designs.mjs      design builder + 6 complete scenarios          │
└──────────────────────────────────────────────────────────────────────┘
```

Dependency direction is strictly downward. No physics module imports the solver;
no data module imports physics except for enum constants. There are no circular
imports.

## Why no framework, no build step, no dependencies

`package.json` has an empty `dependencies` and `devDependencies`. Everything is
plain ES modules.

- **Auditability.** An acoustic prediction tool whose numbers cannot be traced is
  worthless. A reader can follow any number from the UI to the equation without
  passing through a bundler or a transpiler.
- **Longevity.** No dependency can rot, break or introduce a supply-chain risk.
- **Portability.** The engine imports cleanly into Node, a browser, a worker or
  another tool. `npm start` needs nothing but Node.

Type safety comes from JSDoc annotations checked with `tsc --checkJs`
(`jsconfig.json`), giving most of TypeScript's benefit with none of the build.

## The data model

A **design** is a plain serialisable object — safe to `JSON.stringify`, store,
diff or send:

```js
{
  name: 'My booth',
  geometry:  { internalL: 1.4, internalW: 1.4, internalH: 2.1 },
  surfaces:  { front: Partition, back: …, left: …, right: …, ceiling: …, floor: … },
  doors:     [ Door ],
  windows:   [ { widthM, heightM, host, partition } ],
  vents:     [ DuctSpec ],
  gaps:      [ Gap ],
  mounting:  { mountingId, deck },
  internalTreatment: { materialId, thicknessMm, coverage },
  source:    { sourceId, level, weighting, mode, customSpectrum? },
  receiver:  { envId, distanceM, separatingElementId },
  calibration: { globalOffsetDb?, offsets?, leakCoherenceFactor? }
}
```

Nested types:

```js
Partition { leaves: Leaf[], cavities: Cavity[], connection: Connection, areaM2 }
Leaf      { layers: [{ material, thicknessMm }], bonding, widthM, heightM }
Cavity    { depthMm, fill: Material|null, fillThicknessMm }
Gap       { shape:'slit'|'hole', widthMm, lengthMm?, depthMm, count?,
            sealResistivity?, sealFillFraction?, host }
```

`buildDesign(spec)` constructs one from a compact spec where everything has a
sensible default, so callers override only what they care about. That keeps the
UI, CLI, optimiser and tests all speaking one language.

## The result object

```js
{
  geometry, absorption,
  inside:    { spectrum[24], octaves[8], buildUp[24], swl },
  outside:   { spectrum, octaves, withFan, withBackground, background, fan },
  intermediate,                       // room level before a party wall
  compositeTL[24], compositeTLOctaves[8],
  levelDifference[24],
  ratings:   { stc, rw, c, ctr, rwC, rwCtr, nic, nr, nrGoverning },
  totals:    { insideZ/A/C, outsideZ/A/C, outsideWithFanA, perceivedA,
               backgroundA, isolationZ/A, audibleExcessA },
  verdict:   { outsideA, description, audibility, excessOverBackgroundDb, criteria[] },
  breakdown: { byElement[], byGroup[], dominantByBand[], potential[], weakest },
  elements[], detail{},
  diagnostics[],                      // severity-ranked, each with fixes
  cost:      { total, items[], currency },
  flankingCeilingApplied
}
```

## Execution pipeline

```
buildDesign(spec)
      │
      ├─ geometry()             areas, volume, envelope
      ├─ internalAbsorption()   Miki → α, A, RT60
      ├─ internalSPL()          source spectrum → L_in (+ reverberant build-up)
      │
      ├─ assembleElements()
      │     ├─ partitionTL()  × 6 surfaces  ── singleLeafTL(), bridging
      │     ├─ doorEffectiveArea() × doors  ── gapTau() × 4 sub-paths
      │     ├─ partitionTL() × windows      + frame gap
      │     ├─ ductEffectiveArea() × vents  ── IL chain + bounded breakout
      │     ├─ gapTau() × user gaps
      │     └─ flankingEffectiveArea()      ── isolator + K_ij
      │
      ├─ POWER BALANCE          W = I_inc · Σ S_i τ_i
      ├─ receiver transfer      room / free field / party wall
      ├─ flanking ceiling       L_out ≥ L_in − 75 dB
      ├─ calibration offsets
      ├─ + fan noise, + background
      │
      ├─ ratings()              STC, Rw, C, Ctr, NIC, NR
      ├─ buildBreakdown()       A-weighted power shares, per-band dominance
      ├─ buildDiagnostics()     severity-ranked findings + fixes
      └─ estimateCost()
```

Total: ~1–4 ms.

## Backend / persistence (deployment note)

The engine needs no backend — it runs entirely client-side. A deployment that
wants persistence, sharing or a component catalogue only needs thin services
around the same pure engine:

| Concern | Approach |
|---|---|
| Designs | Store the design JSON verbatim. It is the complete input; results are always reproducible from it. |
| Material catalogue | The `Material` record is already the schema. Serve as JSON; merge over the built-in set. |
| Measurements | Append-only log of `Measurement` records keyed by design id, so calibration history is auditable. |
| Costs | Regionalise `costPerM2PerMm` / `costPerDoor` only. No physics changes. |
| Batch / API | `POST /simulate` with a design → the result object. Stateless, cacheable on a hash of the design. |
| Engine versioning | Stamp results with the engine version and the `*_CONSTANTS` values used, so an old prediction can be explained after a recalibration. |

A relational schema, if wanted:

```sql
material(id PK, name, category, role, density, youngs_modulus, poisson,
         loss_factor, flow_resistivity, cost_per_m2_per_mm, notes)
material_thickness(material_id FK, thickness_mm)
assembly(id PK, name, category, spec_json, lab_stc, lab_rw, notes)
design(id PK, owner, name, created_at, design_json, engine_version)
measurement(id PK, design_id FK, measured_at, inside_db, outside_db,
            background_db, weighting, band_type, bands_json, distance_m, notes)
calibration(id PK, design_id FK, mode, payload_json, rmse_before, rmse_after)
```

The `*_json` columns are deliberate: the design object is the source of truth and
normalising it into tables would create two representations that could disagree.

## Testing strategy

171 tests, no dependencies (`node tests/run.mjs`).

| Suite | What it guards |
|---|---|
| `physics.test.mjs` | closed-form and textbook checks: A-weighting vs IEC tables, Bessel/Struve against known values, mass law slopes, `f_c` for six materials against published figures, MAM scaling laws, monotonicity across connection types |
| `leaks.test.mjs` | slit resonance frequencies, viscous choking monotonic in gap width, `τ > 1` only near resonance, `τ` bounded for every preset, the composite-ceiling results |
| `system.test.mjs` | solver invariants (outside < inside in every band, breakdown sums to 100 %), physical monotonicity end-to-end, source scaling, optimiser Pareto validity, calibration sign conventions, ≤ 5 ms performance |
| `validation.test.mjs` | the laboratory regression: 18 published constructions within tolerance, aggregate RMSE ≤ 3.0 STC, mean bias within ±1.5 STC, curve-shape RMSE, published ranking preserved |

The validation suite is the contract. Any physics change that pushes a published
construction outside tolerance, or degrades aggregate RMSE, is a regression
regardless of how sensible the change looked in isolation — this caught three
real bugs during development, including a double-counted forced-transmission path
that was silently removing 3 dB from every leaf.
