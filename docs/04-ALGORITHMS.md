# 04 — Algorithms

Pseudocode for the four non-trivial algorithms. The physics equations they call
are in `docs/01-PHYSICS.md`.

---

## 1. The simulation pipeline

```
simulate(design):

  # ---- 1. Geometry and internal field ----
  g   ← geometry(design)                         # areas, volume, envelope
  abs ← internalAbsorption(design)               # Miki → α[24], A[24], RT60[24]
  L_in[24] ← internalSPL(design)                 # source spectrum, scaled
      if mode = 'source-at-1m':
          L_w ← L_1m + 10log10(4π)
          L_in ← L_w + 10log10(Q/4πr² + 4/R)     # reverberant build-up

  # ---- 2. Assemble every transmitting element ----
  elements ← []
  openings ← area of doors and windows, grouped by host surface

  for surface in {front, back, left, right, ceiling, floor}:
      net ← gross_area(surface) − openings[surface]
      TL  ← partitionTL(assembly)                # §5 of docs/01
      push {group:'wall', area:net, eff: net · 10^(−TL/10)}

  for door in doors:
      # five parallel sub-paths, each kept separate for the breakdown
      for path in {leaf, vision, perimeter, threshold, frame}:
          push {group: path ∈ {leaf,vision} ? 'door' : 'door-leak',
                eff: S_path · τ_path}
      if door has secondDoor:                    # air lock: paths in SERIES
          TL_series ← TL_door1 + TL_door2 + lobby_gain,  capped at 62 dB
          replace the five paths with one series path

  for window in windows: push glazing path + frame gap path
  for vent   in vents:   push bore path + bounded breakout path
  for gap    in gaps:    push gapTau(gap) · area
  push flanking path from the mounting preset

  # ---- 3. Power balance ----
  for band b:
      I_inc ← p_ref² · 10^(L_in[b]/10) / (4ρ₀c)
      W[b]  ← I_inc · Σ_elements eff[b]

  # ---- 4. Receiver transfer ----
  L_w ← 10log10(W / 10⁻¹²)
  L_out ← room     : L_w + 10log10(Q/4πr² + 4/R₂)
        | freefield: L_w − 10log10(S_ISO3744_envelope)
  if separating element:
      L_out ← L_out − R_sep + 10log10(S_sep/A₂)

  # ---- 5. Physical floors and corrections ----
  if receiver is inside the building:
      L_out[b] ← max(L_out[b], L_in[b] − 75)     # structural flanking ceiling
  L_out ← L_out + calibration offsets
  L_out ← L_out ⊕ fan noise                       # ⊕ = energy sum
  L_perceived ← L_out ⊕ background

  # ---- 6. Interpretation ----
  ratings     ← STC, Rw, C, Ctr, NIC, NR
  breakdown   ← buildBreakdown(elements, L_in)
  diagnostics ← buildDiagnostics(...)
  cost        ← estimateCost(design)
```

**Complexity** `O(N_elements × N_bands)` ≈ 30 × 24 = 720 band-element evaluations.
Measured 1–4 ms including all interpretation. This is what makes real-time
interaction and exhaustive optimisation possible.

### Why `S·τ` and not TL

Working in effective transmitting area makes step 3 a plain sum. If the engine
worked in TL it would have to convert back and forth at every combination, and the
breakdown percentages would have to be reconstructed rather than read off. In
`S·τ` the share of each path is exactly `eff_i / Σ eff`.

---

## 2. The leakage breakdown

The percentages must be *genuine power fractions*, or the advice built on them is
worthless.

```
buildBreakdown(elements, L_in):

  # A-weight, because audibility follows A-weighting, and weight by the actual
  # internal spectrum, because a path that leaks at 4 kHz matters less if the
  # source has no 4 kHz content.
  for band b:
      w[b] ← 10^((L_in[b] + A_weight[b]) / 10)

  for e in elements:
      power[e] ← Σ_b  eff[e][b] · w[b]

  total ← Σ power
  percent[e] ← 100 · power[e] / total            # exact, sums to 100

  # Group aggregation (door-leak folds into door for the headline)
  byGroup ← Σ percent grouped by {wall, door, vent, leak, window, flanking}

  # Per-band dominance — answers "what leaks at 125 Hz?"
  for band b:
      dominant[b] ← argmax_e eff[e][b]

  # Ceiling on fixing one path perfectly
  for e in elements:
      maxImprovement[e] ← −10 log10(1 − percent[e]/100)

  return {byElement, byGroup, dominantByBand, potential}
```

That last quantity is the most useful thing in the whole output and follows
directly from the energy sum: **if a path carries 50 % of the power, eliminating it
entirely gains 3 dB.** If it carries 90 %, eliminating it gains 10 dB. If it
carries 10 %, perfecting it gains 0.46 dB and is a waste of money.

This is why the tool leads with the breakdown rather than the total: the total tells
you where you are, the breakdown tells you what to do.

---

## 3. The optimiser

Exhaustive, not greedy — because the engine is fast enough that approximation is
unnecessary, and because greedy search gets the wrong answer when two upgrades
interact (upgrading the wall is worthless until the door is fixed, so a greedy
search rejects it and never revisits).

```
optimise(baseSpec, target_dBA, budget, groups):

  lists ← [options(g) for g in groups]           # mutually exclusive per group

  candidates ← []
  for combo in cartesian_product(lists):         # e.g. 7×6×5×4×2 = 1680
      spec   ← baseSpec with every combo patch applied
      result ← simulate(buildDesign(spec))
      push {combo, cost: result.cost.total,
            level: result.totals.outsideWithFanA,
            stc, weakest_path}

  sort candidates by cost ascending

  # ---- Pareto front: cheapest design achieving each level ----
  front ← []; best ← +∞
  for c in candidates:
      if c.level ≥ best − 0.05:  continue        # dominated
      if front nonempty and c.cost == front.last.cost:
          front.pop()                            # equal cost, better level
      push c; best ← c.level

  # ---- Marginal value of each step up the front ----
  for i in 1..len(front)-1:
      Δcost ← front[i].cost   − front[i−1].cost
      Δdb   ← front[i−1].level − front[i].level
      dbPer100 ← 100 · Δdb / Δcost
      changes  ← diff(front[i−1].combo, front[i].combo)

  # ---- Verdict, which must be able to say "no" ----
  meets     ← {c : c.level ≤ target}
  affordable← {c : c.cost  ≤ budget}
  if meets ∩ affordable ≠ ∅ : status ← 'achievable'
  elif meets ≠ ∅            : status ← 'over-budget'   # report the extra needed
  else                      : status ← 'infeasible'    # report the best possible
                                                        # AND the limiting path
```

Two design decisions matter more than the search itself:

**The equal-cost pop.** Candidates are cost-sorted, so an equal-cost entry always
dominates the one already stored. Without the pop, the front can contain two points
at the same cost, which breaks the marginal-value table (division by zero) and
misleads the reader.

**It must be able to fail.** When the target is unreachable the optimiser says so,
reports the best achievable level, and names the limiting path — as in
`docs/07` Example 9, where a *sealed* socket back-box turns out to be 91 % of the
transmitted power once everything else is excellent, and the real answer is a
design change not in the option set. A tool that returned its best guess as "the
answer" would have concealed that.

### Single-change sensitivity

Separately from the combinatorial search, each upgrade is applied **on its own** to
the current design:

```
singleChangeOptions(baseSpec):
  base ← simulate(baseSpec)
  for group, option in UPGRADE_GROUPS:
      r ← simulate(baseSpec with only this option patched)
      push {improvementDb: base.level − r.level,
            deltaCost:     r.cost − base.cost,
            valuePer100:   100 · improvementDb / deltaCost,
            weakestAfter:  r.breakdown.weakest}
  sort by improvementDb descending
```

This isolates each change, which is what a user actually wants to know ("what
should I do next?"), whereas the Pareto front answers "what should I have built?"

---

## 4. Calibration and residual diagnosis

The valuable half is not the offset — it is reading the *shape* of the
disagreement, because the shape identifies what was actually built.

```
assess(design, measurement):

  # Re-run with the measurement's own source level so the comparison isolates
  # the ENCLOSURE error rather than a source mismatch
  d ← design with source level/spectrum ← measurement's
  r ← simulate(d)

  # Band-width conversion. An octave band holds three 1/3-octaves, so its level
  # is 4.77 dB higher. Interpolating octave levels straight onto the 1/3-octave
  # grid inflates every value by 4.8 dB and silently poisons the calibration.
  measured[24] ← resample(freqs, levels − (octave ? 10log10(3) : 0))

  error[b] ← predicted[b] − measured[b]
      # error < 0 → reality is LOUDER than predicted → something unmodelled
      # error > 0 → reality is QUIETER than predicted → better than modelled

  lf ← mean(error[50…250 Hz])
  hf ← mean(error[2k…10k Hz])
  tilt ← hf − lf
      # tilt > 0 → low frequencies relatively worse → STRUCTURAL
      # tilt < 0 → high frequencies relatively worse → AIR LEAK

  # Validity gate BEFORE any fitting (ISO 16283)
  if measured_outside − background < 3 dB:
      reject: "this measurement is meaningless"
  elif < 10 dB:
      apply energetic background correction, flag as upper bound

  diagnose:
      |bias| < 2 and RMSE < 3  → "agrees within normal uncertainty;
                                  no calibration warranted — it would fit noise"
      tilt > +4 and lf < −3    → structural flanking / rigid connection / low f₀
      tilt < −4 and hf < −3    → an air leak the model does not know about
      tilt < −4 and lf > +3    → build stiffer than modelled, or a modal null
      tilt > +4 and hf > +3    → sealing better than specified
      |tilt| < 3, |bias| > 2   → uniform: the one case where a global offset is legitimate
      RMSE > 6                 → "as-built differs materially; audit before calibrating"
```

Then the fit itself:

```
fitCalibration(design, measurements, mode='auto'):

  if mode = 'auto':
      mode ← max|tilt| > 4 ? 'per-band' : 'global'

  if per-band:
      offsets[b] ← −mean(error[b] over measurements)
      offsets    ← smooth3(offsets)               # [1,2,1]/4 kernel
  else:
      globalOffset ← −mean(bias)

  clamp every offset to ±12 dB                    # refuse to hide a broken model

  verify: re-run with the calibration applied, report RMSE before → after
```

Three guards, each deliberate:

- **Clamping to ±12 dB.** A calibration that absorbs a 40 dB error is not a
  calibration, it is a lie. The clamp forces the diagnosis to stand.
- **Smoothing the per-band vector.** Measurement noise in a single 1/3-octave band
  is several dB. An unsmoothed offset vector bakes that noise in permanently.
- **Refusing to calibrate a good prediction.** When bias < 2 dB and RMSE < 3 dB,
  the module says so and fits nothing. Field measurement reproducibility is itself
  2–3 dB; "improving" on that is fitting noise.

The reported caveat is part of the output: per-band offsets are specific to *this*
build, *this* receiver position and *this* environment. They correct a residual;
they do not make the model more general.

---

## 5. Diagnostics

Rule-based, evaluated against the computed result, severity-ranked, each carrying
concrete fixes. Roughly a dozen rules; the ones that earn their place:

| Trigger | Severity | Says |
|---|---|---|
| Flanking ceiling binding | high | the building limits you, not the design; only decoupling helps |
| One path > 60 % of power | critical | names it and the maximum gain from fixing it |
| Leak share > 30 % | critical / high | sealing is free compared with mass; do a torch test |
| Leak share < 5 % and no gaps specified | info | this is a best case construction will not reach; add the gaps you expect |
| MAM resonance > 80 Hz | high | resonance is inside the useful range; deepen the cavity |
| Coincidence dip in 800 Hz–4 kHz | medium | inside the vocal range; use two thinner sheets or damping |
| Bridging limits > 6 of 24 bands | high | more mass will not help until the leaves are decoupled |
| Mount resonance > 30 Hz | high | only works above ~40 Hz; below that it is transparent or amplifying |
| Mount amplifies where the source has energy | high | this isolation system is making that frequency *worse* |
| Airflow below requirement | critical | **safety before acoustics** — CO₂ in a sealed 2 m³ booth |
| Duct velocity > 3 m/s | medium | the attenuator is becoming a source |
| No bends in the duct | medium | a straight duct is an acoustic pipe |
| RT60 > 0.4 s | medium | boxy, and builds up internal level |
| Volume < 8 m³ | medium | no diffuse field below ~3× the first mode; sub-100 Hz is indicative only |
| HF−LF performance spread > 25 dB | medium | what escapes is a thump, not a voice; the single-number rating flatters this |

The ordering is `critical → high → medium → info`, and the first item is almost
always the thing to fix next. That is not a coincidence: the weakest-path rule and
the energy sum guarantee it.
