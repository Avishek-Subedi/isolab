# 06 — Validation, Accuracy and Limitations

This is the most important document in the set. A prediction tool that will not
state its own error bars is a toy.

Run it yourself:

```bash
npm run validate
```

---

## 1. Laboratory validation

18 published constructions, compared against the engine's bare-assembly
prediction under laboratory conditions (no leaks, no vent, sealed perimeter).

```
  Construction                                              Pred  Pub   Err  Tol
  ---------------------------------------------------------------------------------
  12.5 mm plasterboard, single skin                           28    28    +0   ±3
  18 mm plywood, single skin                                  26    26    +0   ±4
  18 mm MDF + 18 mm plywood, bonded                           35    33    +2   ±4
  200 mm dense concrete                                       54    56    -2   ±4
  2x4 timber studs, one board each side, empty cavity         36    34    +2   ±4
  2x4 timber studs, one board each side, insulated            36    38    -2   ±4
  2x4 timber studs, two boards each side, insulated           43    43    +0   ±4
  2x4 studs, two boards each side + damping compound          51    51    +0   ±5
  2x4 studs, resilient bar one side, two boards               50    50    +0   ±5
  Staggered studs on a common plate, insulated                49    49    +0   ±5
  92 mm steel C-studs, two 15 mm boards each side             52    52    +0   ±5
  Isolation clips + hat channel, two boards each side         60    58    +2   ±5
  Double timber stud, fully separate frames, insulated        59    59    +0   ±5
  Hollow-core internal door                                   17    19    -2   ±4
  44 mm solid-core door, foam tape + brush strip               26    24    +2   ±4
  44 mm solid-core door, compression gasket + drop seal        34    30    +4   ±4
  Shop-built 2x18 mm damped MDF door, good seals               37    35    +2   ±4
  Proprietary acoustic door set, Rw 40                        44    40    +4   ±5
  ---------------------------------------------------------------------------------
  18/18 within tolerance    mean bias +0.67 STC    RMSE 1.89 STC    worst 4 STC
```

### Curve shape, not just the single number

Single-number ratings can agree while the curves disagree badly, so two
thoroughly documented cases are checked band by band.

**12.5 mm plasterboard, single leaf** — RMSE **1.46 dB**, worst 3 dB:

| Hz | 125 | 250 | 500 | 1k | 2k | 4k |
|---|---|---|---|---|---|---|
| predicted | 14 | 20 | 26 | 32 | 31 | 29 |
| published | 15 | 21 | 26 | 31 | 33 | 32 |

This is the strongest single test in the suite: it validates the mass law, the
field-incidence correction, the coincidence frequency and the plateau model
simultaneously, on the most thoroughly measured construction in the world.

**2×4 studs, one board each side, insulated** — RMSE **4.4 dB**, worst 7 dB. The
mid-range residual is about −4 dB and is discussed in §5.

### How the fitted constants were obtained

The engine is **semi-empirical**, like every practical prediction tool. Five
constants were fitted, none chosen to taste:

| Constant | Value | Fitted against |
|---|---|---|
| `coincidenceOffsetDb` | +5.5 dB | the four single-leaf cases and both curve-shape cases |
| plateau width | `0.3 + 12·η(f_c)` octaves | concrete vs plasterboard simultaneously |
| `maxCoincidenceDipDb` | 16 dB | safety floor; rarely binds |
| connection `Δ_max` × 7 | 2 … 17.5 dB | constrained coordinate descent over the double-leaf cases |
| `AIRLOCK_MAX_TL_DB` | 62 dB | published twin-door air-lock measurements |

The connection fit was **constrained** so a better connector can never receive a
lower ceiling than a worse one. An unconstrained fit is underdetermined — one
published case per connector — and produced the physically absurd result of
isolation clips scoring below resilient channel. Constraining it *improved*
aggregate RMSE (1.24 → 1.07 on the double-leaf subset), which is a good sign that
the constraint encodes real physics rather than fighting the data.

### Where the door targets come from

Door validation needs care, and the targets are stated for the seal specification
actually modelled. Published door ratings are for a complete *door set* — leaf,
frame and its own gasket system — tested in a sealed opening. Comparing a preset
that specifies builder's foam tape against a figure measured with compression
gaskets is an apples-to-oranges test. So the suite tests the same 44 mm leaf
twice, once with mediocre seals (target 24) and once with a compression gasket and
drop seal (target 30), which exercises both ends of the leak model.

---

## 2. What laboratory agreement does and does not prove

**Laboratory ratings are a ceiling, not an expectation.** A construction tested at
STC 55 in a transmission suite routinely measures 45–50 as built. The gap is not
measurement error; it is real, and it has identifiable causes:

| Cause | Typical cost |
|---|---|
| Perimeter and junction leakage | 3–10 dB |
| Flanking through the surrounding structure | 3–8 dB |
| Service penetrations (sockets, cables, ducts) | 2–8 dB |
| Workmanship (partial cavity fill, bridged resilient bars, missed sealant) | 2–6 dB |
| Specimen size (lab specimens are small and well supported) | 1–3 dB |

**This is exactly why the simulator models leaks, ducts, doors and flanking
explicitly rather than quoting a lab number.** A tool that reported "STC 55, done"
would be wrong in the field by 5–10 dB and would give no clue why. This one names
the path.

That is also why the default scenarios include unsealed junctions and an
unsealed socket back-box. Remove them and the prediction becomes a best case that
construction quality will not reach.

---

## 3. Realistic accuracy expectations

Accuracy depends on what you are asking and how well you have described what you
built.

| Question | Expected accuracy | Confidence |
|---|---|---|
| Relative: is design B better than design A, and by roughly how much? | ±2 dB | **High** — the model's strongest use |
| Which path dominates? | reliable ranking | **High** |
| Absolute octave-band level, 250 Hz – 4 kHz, well-described build | ±4 dB | Good |
| Absolute A-weighted level, well-described build | ±3–5 dB | Good |
| Absolute octave-band level at 63–125 Hz | ±6–10 dB | Moderate |
| Absolute level below 63 Hz | ±10 dB or worse | **Low** |
| Absolute level of an as-yet-unbuilt design by an untested builder | ±8 dB | **Low** — workmanship dominates |
| Structure-borne / impact transmission | ±8 dB | Low |

**Use it to choose between designs, not to promise a number to a neighbour or a
planning officer.** For a compliance claim you need a measurement.

### Why low frequency is hard

Four independent reasons, all fundamental rather than fixable:

1. **No diffuse field.** A 1.4 × 1.4 × 2.1 m booth has its lowest axial mode at
   82 Hz and no statistically diffuse field below roughly 250 Hz. Diffuse-field
   theory — the foundation of the entire power balance — simply does not apply
   there. The engine flags this in the diagnostics.
2. **Modal measurement scatter.** Below ~100 Hz the measured level varies by
   10 dB or more with microphone position. There is no single correct answer to
   compare a prediction against.
3. **Structure dominates.** Below 100 Hz flanking through the building usually
   exceeds the airborne path, and it depends on construction details no model can
   know without a survey.
4. **Ratings hide it.** STC and Rw both discard everything below 100 Hz. A booth
   can post Rw 50 and be useless against a kick drum.

---

## 4. Known limitations, stated plainly

**Diffuse-field assumption.** Everything rests on `I = ⟨p²⟩/4ρ₀c`. Valid above
roughly three times the first room mode; increasingly wrong below it. Small booths
spend a lot of their important spectrum in that region.

**Statistical, not modal.** No finite-element or boundary-element modelling. Room
modes, panel mode shapes and cavity modes are handled by correction terms, not
solved. Predictions are band-averaged expectations, not point responses.

**Sharp's double-leaf model is semi-empirical.** It reproduces measured behaviour
well but is not derived from first principles, and its region boundaries are
approximations.

**Bridging is a lumped model.** Real stud transmission depends on stud stiffness,
screw pitch, screw torque and board edge support. The engine has one
frequency-dependent term and a fitted ceiling per connection type. Installation
quality can swing a resilient-bar wall by 10 dB — a single screw hitting a stud
through the bar short-circuits the whole wall — and no model can see that.

**Leak geometry is idealised.** Real gaps are irregular in width, partially
blocked and locally sealed. The model assumes uniform width over a stated length.
The `leakCoherenceFactor` is a genuine modelling assumption, not a measured
quantity.

**Duct breakout is bounded, not resolved.** It is referenced to bore power with an
empirical shell TL. Adequate for ranking vent designs; not a duct-radiation
calculation.

**Flanking is heavily simplified.** EN 12354 proper requires junction details,
element areas and vibration reduction indices for every path. The engine collapses
this to one path with a mounting preset and a junction loss. The 75 dB ceiling is
a blunt but honest instrument.

**Costs are indicative.** UK retail, late 2025/2026, ex-VAT, materials only. No
labour, tools, fixings, waste or delivery. Use them to compare designs, not to
budget a project.

**Not modelled at all:**

- non-linear effects at very high SPL (>130 dB)
- temperature and humidity variation beyond a static air-property set
- ageing: sealant shrinkage, gasket compression set, insulation settlement
- reverberant coupling *back* from the receiving room into the booth
- transient and impulsive sources (only steady-state `L_eq`)
- flow noise from air moving through leaks
- absorber facings, membranes, perforated panels, resonant absorbers
- fire, structural, thermal or condensation performance — **all of which can
  override an acoustic decision.** A booth with no ventilation is dangerous
  before it is quiet.

---

## 5. Open residuals

Honest accounting of what the validation set still shows:

**Insulated single-board stud wall, −4 dB in the mid range.** The empty and
insulated versions of the same wall (published STC 34 and 38) both predict 36.
The airborne path does not differentiate them enough at a thin 89 mm cavity
because the bridged path dominates in both. Cavity absorption is probably
under-weighted in the cavity-coupled region for shallow cavities.

**Doors run +2 to +4 dB optimistic.** Consistent across all four door cases,
suggesting the leak model is slightly generous for short gap runs, or that the
`0.5·λ` coherence length is a little short for door perimeters. Real installed
doors will be worse than predicted; treat door predictions as a best case.

**Concrete −2 dB.** Acceptable, and within the spread of published values for
200 mm normal-weight concrete (55–62 depending on density and finish).

**Isolation clips +2 dB.** A consequence of the ordering constraint. Preferred to
the alternative of clips scoring below resilient channel.

---

## 6. Closing the gap: measure and calibrate

The calibration module exists because the honest answer to "how close can this get
to reality" is: *closer once you have measured it.*

Uncalibrated, on a well-described build: **±3–5 dB(A)**.
After a single good octave-band measurement: **±2 dB(A)** for that build.

The valuable half of calibration is not the offset — it is the **diagnosis of the
residual shape**, because the shape of the disagreement tells you what you
actually built:

| Residual shape | Physical meaning | Remedy |
|---|---|---|
| Low frequencies louder than predicted, high frequencies agree | structural flanking, a rigid connection that should be resilient, or `f₀` lower than designed | find and break the structural bridge |
| High frequencies louder than predicted, low frequencies agree | an air leak the model does not know about | torch test; check threshold and frame junction |
| Uniformly louder or quieter | source level, mic position, or receiving-room absorption differs from the preset | the one case where a global offset is legitimate |
| Large scatter (RMSE > 6 dB) | the as-built construction differs materially from the modelled one | audit the build before calibrating |

The module deliberately refuses to hide a bad model: offsets are clamped to
±12 dB, per-band offsets are smoothed to avoid baking in measurement noise, and
when the residual is within normal uncertainty it says **no calibration is
warranted — applying one would be fitting noise.**

It also validates the measurement itself. Per ISO 16283, if the outside level is
within 3 dB of the background the measurement is meaningless, and the module says
so rather than fitting to it.

### Measurement protocol

Non-negotiable if the numbers are to mean anything:

1. Calibrated meter, Class 2 or better. A phone app is not adequate below ~200 Hz
   or above ~100 dB — exactly the regions that decide the answer.
2. Measure the background first, source off, same position. Need ≥ 10 dB margin.
3. Broadband source, not your voice. Pink noise through a speaker is repeatable;
   a scream is not. Aim for 95–105 dB inside.
4. Inside: average ≥ 3 positions, ≥ 0.7 m apart, ≥ 0.5 m from any surface.
5. Outside: state the distance. Record whether the position is near a corner —
   that alone is worth 3–6 dB.
6. **Octave bands, 63 Hz – 8 kHz.** A single A-weighted number cannot distinguish a
   leak from flanking, and those need opposite remedies.
7. `L_eq` over ≥ 30 s with a steady source, not peak hold.

---

## 7. Verdict

**What this simulator is good for**

- Choosing between designs and knowing roughly by how much
- Identifying which path limits a design, and what the ceiling is once fixed
- Showing where money stops buying decibels
- Sizing ventilation that does not destroy the isolation
- Catching the classic mistakes before they are built: an absorber specified as a
  blocker, a mount whose resonance sits in the source, a mass–air–mass resonance
  in the middle of the vocal range, a sealed booth with no fresh air
- Teaching *why*, through named mechanisms rather than a single number

**What it is not good for**

- Guaranteeing a number to a neighbour, landlord or planning authority
- Sub-63 Hz prediction
- Substituting for a measurement or a qualified acoustic consultant on a
  contractual project
- Predicting what a specific builder will actually achieve

**The one-line answer to "how close can it get?"** On a well-described,
well-executed build, within about 3–5 dB(A) at the receiver and within 4 dB per
octave band above 250 Hz — and reliably right about *which path to fix first*,
which is usually worth more than the absolute number.
