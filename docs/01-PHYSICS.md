# 01 — Physics Engine

Every equation the engine actually solves, in the order it solves them, with the
source of each and the file it lives in. Nothing here is decorative: if an
equation is listed, it is executed.

Symbols used throughout:

| Symbol | Meaning | Units |
|---|---|---|
| `p`, `p_ref` | sound pressure, reference (2×10⁻⁵) | Pa |
| `W`, `W_ref` | sound power, reference (10⁻¹²) | W |
| `ρ₀`, `c` | air density, speed of sound (1.204, 343) | kg/m³, m/s |
| `z₀ = ρ₀c` | characteristic impedance of air (413) | Pa·s/m |
| `m_s` | surface density (mass per unit area) | kg/m² |
| `τ` | transmission coefficient (0…1) | – |
| `R`, `TL` | sound reduction index / transmission loss | dB |
| `η` | loss factor (damping) | – |
| `f_c` | coincidence (critical) frequency | Hz |
| `f₀` | mass–air–mass resonance | Hz |
| `σ` | flow resistivity | Pa·s/m² |
| `S` | area | m² |

---

## 1. Frequency resolution

**The engine computes in 24 one-third-octave bands from 50 Hz to 10 kHz**, and
folds down to the eight octave bands (63 Hz – 8 kHz) only for display.

This is not gold-plating. Every mechanism that decides whether a booth works is
narrow-band:

- mass–air–mass resonance is a dip 1/2–1 octave wide
- the coincidence dip is 1/3–1 octave wide
- cavity standing waves are narrow spikes at `n·c/2d`
- slit resonances are narrow spikes at `n·c/2t`

Computing in octave bands smears all four into a meaningless average. A wall
that is transparent at 63 Hz and excellent at 125 Hz reads as "fine" in a single
octave band.

Exact band centres follow the base-10 convention, `f_c,i = 1000 · 10^((i−13)/10)`.

Folding rules differ by quantity type, which is a common source of error:

```
levels (SPL):        L_oct = 10 log10( Σ 10^(L_i/10) )          energy sum
attenuations (TL):   R_oct = −10 log10( (1/3) Σ 10^(−R_i/10) )   τ-average
```

Energy-summing a transmission loss would add a spurious 4.77 dB.
→ `src/core/bands.mjs` (`toOctaves`, `attenToOctaves`)

### Frequency weighting

IEC 61672-1 analytic forms, not tables:

```
A(f) = 20 log10[ 12194² f⁴ / ((f²+20.6²) √((f²+107.7²)(f²+737.9²)) (f²+12194²)) ] + 2.00
C(f) = 20 log10[ 12194² f²  / ((f²+20.6²)(f²+12194²)) ] + 0.062
```

Verified against the standard's tabulated values to within 0.15 dB.

---

## 2. Sound pressure, power and decibel algebra

```
L_p  = 20 log10(p / p_ref)  =  10 log10(p² / p_ref²)
L_w  = 10 log10(W / W_ref)
```

Levels combine on an energy basis, never arithmetically:

```
L_total = 10 log10( Σ 10^(L_i/10) )
```

Two equal sources give +3.01 dB; ten give +10 dB; a source 10 dB below another
adds 0.41 dB. This last figure is why the *loudest* leak sets the answer and
improving anything else first is wasted money.

→ `src/core/acoustics.mjs`

---

## 3. Transmission loss and the transmission coefficient

```
τ  = W_transmitted / W_incident
TL = 10 log10(1/τ)
```

The engine works internally in **effective transmitting area**, `A_eff = S·τ`,
rather than in TL. This is the single most important design decision in the
codebase, because it makes composite transmission exact and additive:

```
A_eff,total = Σ_i S_i τ_i
TL_composite = 10 log10( Σ S_i / Σ S_i τ_i )
```

A 0.01 m² door gap with `τ = 0.3` contributes `A_eff = 0.003 m²`. Thirty square
metres of wall at `TL = 55 dB` contributes `30 × 3.2×10⁻⁶ = 9.5×10⁻⁵ m²`. The gap
is **32 times** the whole wall. Expressed in TL, that relationship is invisible;
expressed in `S·τ`, it is arithmetic.

---

## 4. Single-leaf panels

→ `src/core/panel.mjs`

### 4.1 Mass law

Normal incidence, from the plane-wave impedance of a limp mass:

```
τ₀(f) = 1 / (1 + (ω m_s / 2 ρ₀ c)²)
TL₀   = 10 log10(1 + (π f m_s / ρ₀c)²)  ≈  20 log10(π f m_s / ρ₀c)
```

Field incidence (integration over 0–78°) is 4.8 dB lower:

```
TL_field = 20 log10(π f m_s / ρ₀c) − 4.8
         ≈ 20 log10(m_s f) − 47.2
```

Both forms are implemented; the second is the familiar engineering shorthand.
Consequences: **+6 dB per doubling of mass, +6 dB per octave.** The second half
of that is why every booth is worst in the bass and why a kick drum is a
fundamentally harder problem than a scream at the same overall level.

### 4.2 Bending stiffness and the coincidence frequency

Panels are not limp. Bending waves travel at

```
c_B(f) = √(ω) · (B/m_s)^(1/4),   B = E h³ / (12(1−ν²))
```

and at the frequency where `c_B = c`, the panel radiates with unit efficiency
and transmission loss collapses. Using the longitudinal plate-wave speed
`c_L = √(E/(ρ(1−ν²)))`:

```
f_c = c² / (1.8 c_L h)
```

Verified against published values: 6 mm float glass → 2.0 kHz; 12.5 mm
plasterboard → 2.6 kHz; 1 mm steel → 12.3 kHz; 150 mm concrete → 120 Hz.
Mass loaded vinyl, being genuinely limp, lands above 20 kHz — which is exactly
why it follows mass law cleanly.

### 4.3 Total loss factor

EN 12354-1 Annex B: radiation into the surrounding air is itself a loss, and it
scales with mass:

```
η_tot(f) = η_int + m_s / (485 √f)
```

For 12.5 mm plasterboard the added term is ~0.0003 (negligible). For 200 mm
concrete at 100 Hz it is 0.085 — five times the internal loss factor. This is
why heavy walls have shallow, broad coincidence behaviour and light ones have
sharp dips, and it falls out of the model rather than being asserted.

### 4.4 Regions of the single-leaf curve

```
                     TL
                      │        ┌── +9 dB/oct (damping controlled)
                      │       /
                      │  ────┘  ← plateau
                      │ /
                      │/  ← dip at f_c
              +6dB/oct │
                    ／ │
   stiffness ／        │
  controlled          │
  ────────────────────┴───────────────────────► log f
              f₁₁        f_c   f_plateau
```

| Region | Model |
|---|---|
| `f < f₁₁` | stiffness controlled: `TL = TL_mass + 0.55 · 20log10(min(f₁₁/f, 6))` |
| `f < 0.5 f_c` | mass law |
| `0.5 f_c ≤ f < f_c` | log-linear descent into the plateau |
| `f_c ≤ f ≤ f_plateau` | coincidence plateau, `TL = TL_C` |
| `f > f_plateau` | `TL = TL_C + (TL_mass(f) − TL_mass(f_plateau)) + 10log10(f/f_plateau)` |

with

```
TL_C          = TL_mass(f_c) + 10 log10 η_tot(f_c) + 5.5      (dB)
f_plateau     = f_c · 2^(0.3 + 12 η_tot(f_c)),  clamped to 0.3…1.4 octaves
f₁₁           = (π/2) √(B/m_s) (1/a² + 1/b²)                  simply-supported panel
```

Two departures from the textbook are deliberate and are the engine's only fitted
panel constants:

**(a) The `+5.5 dB` offset.** Sharp's classical result gives
`TL = TL_mass + 10 log10(2η f/(π f_c))`, an offset of `10 log10 η − 1.96` at
`f = f_c`. That is derived for an *infinite* panel in which only resonant
(bending-wave) transmission occurs. Real building boards are finite and also
transmit non-resonantly, and the classical form over-deepens the dip by 6–8 dB.
Replacing `−1.96` with `+5.5` reproduces published curves for plasterboard,
plywood, MDF and glass to within about 3 dB.

**(b) The plateau.** A low-`f_c` wall does not recover immediately above `f_c`;
resonant transmission dominates for up to an octave and a half and TL stays
roughly flat. Tying the plateau width to `η_tot(f_c)` reproduces both behaviours
from one expression: concrete (`η_tot ≈ 0.11`) gets a wide plateau, plasterboard
(`η_tot ≈ 0.018`) gets a narrow dip.

**Forced-path bound.** In the resonant region the result is summed in parallel
with the mass law:

```
τ = τ_resonant + τ_forced,   τ_forced = τ_mass-law
```

Without this, the `10 log10(f/f_c)` term grows without limit and the model
over-predicts heavy single-leaf masonry by 5–10 dB. Below `f_c` the bound is
**not** applied — mass law is already the forced path there, and double-counting
it subtracts a spurious 3 dB from every leaf (and 6 dB from every double-leaf
pair). That was a real bug caught by the curve-shape validation.

### 4.5 Multi-layer leaves

Three bonding modes, because how sheets are joined changes the physics:

| Bonding | Surface mass | `f_c` | `η` |
|---|---|---|---|
| `screwed` | sum | mass-weighted harmonic blend of individual sheets | mass-weighted mean |
| `laminated` | sum | composite `B` via parallel-axis theorem — **lowers** `f_c` | mass-weighted mean |
| `damped` | sum | as `screwed` | `max(η, 0.13)` constrained-layer damping |

Two 12.5 mm sheets screwed together carry the mass of 25 mm but keep the
coincidence frequency of 12.5 mm — which is why two thin sheets beat one thick
one. Rigidly gluing them destroys that advantage.

---

## 5. Double-leaf partitions

→ `src/core/partition.mjs`

### 5.1 Mass–air–mass resonance

The cavity is a spring between two masses:

```
f₀ = (1/2π) √( ρ₀ c_eff² (1/m₁ + 1/m₂) / d )
   = k √( (1/m₁ + 1/m₂) / d ),    d in metres
```

`k = 60` for an empty cavity (adiabatic, `ρ₀c²`) falling to `k ≈ 50.6` for a
fully filled one (isothermal, `P₀`), because the fibres thermally load the air.
The engine interpolates on fill fraction: `k = 60 − 9.4·fill`.

At `f₀` the two leaves move in antiphase against the cavity spring and the wall
is close to transparent. **This is the single most important number in a booth
design.** For a typical build — 17.5 and 22 kg/m² leaves on a 100 mm cavity —
`f₀ ≈ 54 Hz`, which is exactly where a kick drum lives.

`f₀ ∝ 1/√d` and `∝ 1/√m`, so doubling the cavity depth or quadrupling the mass
each drop it an octave. Depth is far cheaper.

### 5.2 Sharp's three-region model

```
f < f₀/√2        TL = TL_mass(m₁+m₂)              leaves move together
f₀/√2 … f₀√2     TL = TL_mass(m₁+m₂) − D_dip      resonance dip
f₀√2 … f_l       TL = TL₁ + TL₂ + 20 log10(f d) − 29
f > f_l          TL = TL₁ + TL₂ + 6 + ΔA
```

with `f_l = c/(2πd)` the frequency at which the cavity stops behaving as a
lumped spring, and `ΔA` a cavity-absorption term clamped to ±6 dB.

**Below `f₀` a deeper cavity does nothing at all.** The leaves move as one mass;
only mass helps. This is the most commonly misunderstood result in the whole
subject and the engine reproduces it directly.

### 5.3 Dip depth is set by flow resistance, not absorption

```
D_dip = (1 − damp)·14 + 3,     damp = 0.2 + 0.8 · min(1, fill · σ t / ρ₀c)
```

The damping that controls the resonance is the **flow resistance the fill
presents to air moving between the leaves**, normalised against `ρ₀c`. Keying it
to the absorption coefficient instead — which is near zero at 50–60 Hz even for
a well-filled cavity — wrongly predicts that mineral wool does nothing at the
resonance. 50 mm of 45 kg/m³ rock wool gives `σt/ρ₀c ≈ 1.5`, essentially
critical damping, and reduces the dip from ~14 dB to ~3 dB.

### 5.4 Cavity standing waves

An empty cavity resonates at `f_n = n·c/2d`. The engine subtracts up to
`(1 − α_cav)·8 dB` within a quarter-octave of each. A 100 mm empty cavity has
dips at 1715 Hz, 3430 Hz…; filling it to 60 %+ removes them. This is why
"a deeper *empty* cavity" is not automatically better.

### 5.5 Structural bridging — the parallel path

This decides whether a wall is 40 dB or 60 dB, and it is where most simple
calculators fail completely.

```
τ_total = τ_airborne + τ_bridge          (EN 12354 parallel summation)
TL_bridge(f) = TL_combined-leaf(f) + Δ_conn(f)
```

The baseline is the **single-leaf TL of a hypothetical leaf carrying both
leaves' mass**, not the bare mass law, because the bridged path radiates from
the same physical leaf and therefore suffers the same coincidence dip. A mass-law
baseline climbs at 6 dB/octave for ever and wrongly predicts a rigid-stud wall
still improving above 2 kHz, where measurements show it flattening.

```
Δ_conn(f) = min( 4 + 8 log10(f/250) + 10 log10(spacing/spacing_ref) + pointBonus ,
                 Δ_max )
            + min(11, 10 log10(η_leaf / 0.015))
```

- The `4 + 8 log10(f/250)` term exists because **even a rigid stud is not a
  perfect short circuit**: it is a 38–45 mm line contact on a 400 mm pitch, so
  ~10 % of the leaf area is bridged, and bridged transmission improves with
  frequency as the bending wavelength shrinks relative to the pitch.
- Resilient connectors add `30 log10(f/f_m)` above their mount resonance.
- The **damping bonus** matters: a damped leaf dissipates the bending-wave energy
  the stud injects before it can radiate. This is why a viscoelastic compound is
  worth 8–11 dB *even on rigid timber studs* — an effect a purely geometric
  bridging model misses entirely.
- `Δ_max` is the connection's **flanking floor**: the best the bridged path can
  do however good the connector, because the leaves stay joined through plates,
  floor and surrounding structure.

Fitted `Δ_max` values (constrained coordinate descent against the published set,
with the ordering constraint that a better connector can never score lower):

| Connection | `Δ_max` | Interpretation |
|---|---|---|
| Rigid timber studs | 2 dB | effectively a short circuit |
| Steel C-stud | 7 dB | thin web flexes |
| Staggered studs | 8 dB | no stud touches both leaves, but plates do |
| Resilient channel | 9 dB | matches the 7–12 dB the literature reports |
| Isolation clips + hat channel | 10.5 dB | plus up to 11 dB damping bonus |
| Spring hangers | 14 dB | |
| Separate frames (double stud) | 17.5 dB | matches STC 43 → 59 for identical boards |

These reproduce the published *differences* between constructions, not merely
their absolute ratings, which is the stronger test.

---

## 6. Air leakage — the Zwikker–Kosten transmission line

→ `src/core/leaks.mjs`

Leaks are what actually decide whether a real booth works, so they get a real
model rather than an area ratio.

A gap is treated as a short acoustic waveguide through the wall thickness,
terminated at both ends by radiation impedance and driven by the blocked
pressure of the incident field (`p_b = 2 p_inc` at a rigid baffle):

```
            Z_rad        ┌───────┐        Z_rad
   p_b ○───/\/\/\───○────│ A B   │───○───/\/\/\───○  radiated
                         │ C D   │
                         └───────┘
```

### 6.1 Viscothermal propagation inside the gap

Zwikker–Kosten low-reduced-frequency solution for a slit of half-width `h`:

```
λ   = h √(−jωρ₀/μ)                    (shear wave number, complex)
λ_t = λ √Pr                           (thermal)
ρ_eff = ρ₀ / (1 − tanh λ / λ)
K_eff = γP₀ / (1 + (γ−1) tanh λ_t / λ_t)
Γ  = jω √(ρ_eff / K_eff)              (propagation constant)
Z_c = √(ρ_eff K_eff) / S              (characteristic impedance)
```

Limits check out: `λ → ∞` recovers `ρ_eff → ρ₀`, `Γ → jk`, `Z_c → ρ₀c/S`;
`λ → 0` gives `ρ_eff → j3μ/(ωh²)`, the Poiseuille viscous-resistance limit.

**This is what makes sub-millimetre gaps behave correctly.** At 500 Hz a 2 mm
gap has `λ ≈ 14` (nearly lossless) while a 0.1 mm gap has `λ ≈ 0.7` — deep in
the viscous regime, where the boundary layer fills the gap and chokes it. The
engine predicts ~20 dB more transmission loss per unit area for the 0.1 mm gap
than the 2 mm one, which is why felt, foam tape and compression gaskets work at
all. A pure area-ratio model cannot express this.

### 6.2 Two-port solution

```
A = D = cosh(Γt),  B = Z_c sinh(Γt) + R_seal,  C = sinh(Γt)/Z_c
U₂ = p_b / [ (A Z_L + B) + Z_s (C Z_L + D) ]
τ  = 4 |U₂|² Re(Z_L) ρ₀c / (|p_b|² S)
```

`R_seal = σ t f_fill / S` adds the flow resistance of any porous seal packed
into the gap.

### 6.3 Radiation loading and the coherence length

`Z_rad = (ρ₀c/S)(R₁(2ka) + j X₁(2ka))` for an equal-area piston, with
`R₁(x) = 1 − 2J₁(x)/x` and `X₁(x) = 2H₁(x)/x` computed from real Bessel and
Struve functions (Abramowitz & Stegun polynomial fits; Struve by power series
below x = 12 and Aarts–Janssen asymptotic above).

A long slit does **not** radiate as one coherent piston. The engine limits the
coherent segment length to `coherence × λ`, default 0.5 — the spatial
correlation length of a diffuse field. Ignoring this over-predicts leakage from
a door perimeter by 10–15 dB. It is exposed as `leakCoherenceFactor` and is the
primary knob calibration tunes when measurement says leaks dominate.

### 6.4 Slit resonance — why a gap can be worse than an open hole

At `f_n = n·c/(2 t_eff)`, `t_eff = t + 1.7a`, the gap is a half-wave resonator
and `τ` can **exceed 1**: the aperture draws in more power than its geometric
cross-section. The engine reproduces this (a 44 mm-deep door gap resonates near
3.7 kHz and goes acoustically open there) and the test suite asserts that `τ > 1`
occurs *only* near a resonance.

### 6.5 What this predicts

| Leak | Composite TL ceiling in a 30 m² envelope, 500 Hz |
|---|---|
| 3 mm unsealed door perimeter | ~40 dB |
| 1 mm door perimeter | ~50 dB |
| 0.25 mm compression gasket | ~62 dB |
| Open 50 mm cable hole | ~40 dB |
| Same hole packed with mineral wool | ~57 dB |

The naive area-ratio result for reference: `TL_max = 10 log10(S_wall/S_gap)`.
The engine is deliberately *less* pessimistic than that away from resonances
(gaps have real transmission loss) and *more* pessimistic at them.

---

## 7. Doors

→ `src/core/door.mjs`

A door is a small partition with a very bad perimeter. Five parallel sub-paths:

```
A_eff,door = S_leaf τ_leaf + S_vision τ_vision
           + S_perim τ_perim + S_thresh τ_thresh + S_frame τ_frame
```

Each gap uses the full leak model of §6 with the door thickness as gap depth.
Seals are specified by their **residual compressed gap** and the flow
resistivity of the seal material, not by a claimed dB figure:

| Perimeter seal | Residual gap |
|---|---|
| none (bare rebate) | 3.0 mm |
| self-adhesive foam tape | 0.8 mm |
| rubber bulb / P-strip | 0.5 mm |
| compression gasket in rebate | 0.25 mm |
| twin magnetic compression | 0.10 mm |

For a two-door air lock the doors are in **series**, so their composite TLs add
plus a lobby gain term, capped at 62 dB because the lobby's own walls and
frames flank around them:

```
TL_series = TL₁ + TL₂ + gain(f, lobby depth),   capped
gain = 2 dB below c/2L, rising to at most 9 dB above it
```

Result: two ordinary good doors in series beat one expensive door and usually
cost less. That is a genuine engineering conclusion, not a heuristic.

---

## 8. Ventilation ducts

→ `src/core/duct.mjs`

Element-by-element, ASHRAE method:

```
IL_total = IL_lined + IL_bends + IL_silencer + IL_plenum + IL_end-reflection
```

**Lined straight duct** (Sabine):

```
ΔL/m = 1.05 α^1.4 (P/A)      dB per metre
```

with a high-frequency roll-off above `f = c/2w` where the sound beams down the
duct centre and the lining stops working. Unlined sheet metal gives 0.06–0.1 dB/m
— essentially nothing, which is why a straight duct is an acoustic pipe.

**Bends**: frequency-dependent table on `f·w`, lined bends worth up to 8 dB each,
unlined mitred bends up to 3 dB.

**End reflection loss** at the discharge:

```
ER = 10 log10[ 1 + (0.8c/(π f D))^1.88 ]
```

A 100 mm duct gives ~14 dB at 63 Hz and ~0 dB at 4 kHz, which is why small vents
leak mostly mid and high frequency.

**Regenerated noise**: `SWL ∝ 50 log10(velocity)`. Above ~5 m/s the attenuator
becomes a source. The engine warns above 3 m/s.

**Breakout** — sound leaving through the duct wall — is referenced to the **bore
power**, not to the duct's surface area:

```
A_eff,breakout = A_bore · τ_inlet · Σ_segments [ 10^(−IL_upstream/10) · 10^(−TL_out/10) · share ]
```

This bound is essential. An earlier formulation computed breakout from the duct
wall area and predicted a duct radiating more power than entered it — a
conservation violation that made a well-silenced labyrinth look *worse* than an
open hole. Only segments downstream of the envelope are counted, and each is
driven by the in-duct level *after* upstream insertion loss.

**Sizing**: required airflow is the greater of per-occupant fresh air
(10 L/s/person), an air-change target, and the CO₂ balance
`Q = G/(C_in − C_out)`. A sealed 2 m³ booth reaches uncomfortable CO₂ in about
15 minutes — the engine raises this as a safety issue before an acoustic one.

---

## 9. Panel resonance and wall weakness

→ `src/core/panel.mjs`, `src/core/partition.mjs`

Three distinct resonances are tracked and reported per assembly:

| Resonance | Formula | Effect |
|---|---|---|
| Fundamental panel mode `f₁₁` | `(π/2)√(B/m_s)(1/a² + 1/b²)` | whole leaf flexes; below it TL rises again |
| Mass–air–mass `f₀` | `k√((1/m₁+1/m₂)/d)` | wall near-transparent; the critical one |
| Coincidence `f_c` | `c²/(1.8 c_L h)` | efficient radiation; 5–15 dB loss |
| Cavity standing waves | `n c/2d` | narrow dips if cavity is not filled |

The engine reports which mechanism limits **each band** (`limitedBy`), so the
answer to "why is my wall poor at 160 Hz" is a named mechanism rather than a
guess, with the corresponding fix (more mass / more damping / deeper cavity /
decouple).

---

## 10. Structure-borne sound and vibration isolation

→ `src/core/structure.mjs`

Single-degree-of-freedom isolator theory:

```
T(f) = √[ (1 + (2ζr)²) / ((1−r²)² + (2ζr)²) ],   r = f/f_n
f_n  = 15.76 / √(δ_static [mm])
attenuation = −20 log10 T,  capped at 34 dB (elastomer wave effects)
```

The critical, counter-intuitive result the engine reproduces: **an isolator only
works above its own resonance and amplifies below it.** Rubber feet with a 28 Hz
resonance make a 40 Hz problem worse, not better. `diagnoseIsolation()` looks for
bands where the mount amplifies *and* the source has energy, and says so.

Mount resonances in the library span 250 Hz (rigid) to 2.5 Hz (air springs).
For music you want `f_n < 12 Hz`; with a subwoofer, `< 8 Hz`.

**Flanking** (airborne source → structure → distant receiver) is modelled
EN 12354-style as a parallel transmission path with its own effective area,
chained through the isolator attenuation and a junction vibration-reduction
index `K_ij`.

**Floating floors** use the EN 12354-2 form `ΔL = 40 log10(f/f₀)` above the deck
resonance, with `f₀` rescaled from the isolator's rated value by the actual deck
mass.

---

## 11. Rooms, receivers and the power balance

→ `src/core/solver.mjs`, `src/core/acoustics.mjs`

### 11.1 The balance

Inside the booth is a diffuse field. Diffuse-field theory gives the power
incident on unit boundary area as `⟨p²⟩/(4ρ₀c)`, so:

```
W_out(f) = [ p_ref² 10^(L_in(f)/10) / (4 ρ₀ c) ] · Σ_elements S_i τ_i
L_w,out  = 10 log10(W_out / 10⁻¹²)
```

Elements are the six surfaces (net of openings), every door sub-path, windows and
their frame gaps, duct bore and breakout, each user-specified gap, and the
structural flanking path. Because they all radiate into the same space, their
powers add — no path is privileged.

### 11.2 Internal level

Either taken as given (`internal-spl`) or computed from a free-field source level
with reverberant build-up:

```
L_w = L_p(1 m) + 10 log10(4π)
L_in = L_w + 10 log10( Q/(4πr²) + 4/R ),   R = Sᾱ/(1−ᾱ)
```

A small hard booth builds up 6–12 dB, which is why a 100 dB scream measures ~108
dB inside a 1 m³ box. `RT60 = 0.161V/A` (Sabine) with absorption from the Miki
model.

### 11.3 Receiver

Three modes:

```
diffuse room :  L_p = L_w + 10 log10( Q/(4πr²) + 4/R₂ )
free field   :  L_p = L_w − 10 log10 S_env,   ISO 3744 box envelope
                S_env = 4(ab + bc + ca),  a = l/2+d, b = w/2+d, c = h+d
via party wall: L₂ = L₁ − R_sep + 10 log10(S_sep/A₂)
```

The ISO 3744 box envelope matters: at 0.5–2 m from a 1.5 m booth, `20 log10(r)`
is simply wrong because the receiver is not in the far field of a point source.

### 11.4 Structural flanking ceiling

```
L_out(f) ≥ L_in(f) − 75 dB      (receivers inside the same building)
```

Chaining a good booth in series with a heavy party wall otherwise predicts level
differences above 90 dB and receiver levels below the threshold of hearing. That
never happens: long before the airborne paths get that good, vibration through
the slab and frame sets a floor. Field measurements of even room-in-room
constructions top out at 70–80 dB. When this cap binds, the engine says so
explicitly — the answer is then set by the building, not by the design, and no
amount of extra mass will move it.

### 11.5 Audibility

```
L_perceived = 10 log10( 10^(L_out/10) + 10^(L_background/10) )
excess = L_out,A − L_background,A
```

The **excess over background** is the honest metric. 30 dB(A) of leakage into a
16 dB(A) bedroom at night is clearly audible; the same 30 dB(A) into a 40 dB(A)
office is inaudible. A raw dB figure without its background answers nothing.

---

## 12. Porous absorbers — the Miki model

→ `src/core/acoustics.mjs`

Absorption is computed from flow resistivity rather than looked up, so any
thickness and air gap can be simulated. Miki (1990):

```
Z_c = ρ₀c [ 1 + 5.50(10³f/σ)^−0.632 − j 8.43(10³f/σ)^−0.632 ]
k   = (ω/c)[ 1 + 7.81(10³f/σ)^−0.618 − j 11.41(10³f/σ)^−0.618 ]
```

Layer surface impedance by transfer matrix (rigid backing or air gap), then

```
α(θ) = 1 − |(Z_s cosθ − ρ₀c)/(Z_s cosθ + ρ₀c)|²
α_random = ∫ α(θ) sinθ cosθ dθ / ∫ sinθ cosθ dθ      (Paris)
```

This reproduces the quarter-wavelength rule automatically: 50 mm is effective
above ~1.7 kHz and does almost nothing at 100 Hz; adding an air gap behind
extends performance downward. Feeds three places at once — cavity damping,
duct lining, and internal room treatment.

---

## 13. Single-number ratings

→ `src/core/ratings.mjs`

| Rating | Standard | Bands | Notes |
|---|---|---|---|
| **STC** | ASTM E413 | 125 Hz–4 kHz, 16 × ⅓-oct | max single-band deficiency ≤ 8 dB, sum ≤ 32 dB |
| **Rw** | ISO 717-1 | 100 Hz–3.15 kHz | sum of unfavourable deviations ≤ 32.0 dB |
| **C, Ctr** | ISO 717-1 | as Rw | spectrum adaptation; `Ctr` uses the traffic spectrum |
| **NIC** | ASTM E413 contour | on measured level difference | what a field measurement yields |
| **NR** | Noise Rating | octave | `NR = max_i (L_i − A_i)/B_i` |

**Read C and Ctr, not just Rw.** Both discard everything below 100 Hz, so a
lightweight booth with a 55 Hz mass–air–mass resonance can post a respectable Rw
and still be useless against a kick drum. `Ctr` is typically −4 to −9 for
lightweight construction and is the honest number for low-frequency sources.

---

## References

- Sharp, B. H. (1973) *A Study of Techniques to Increase the Sound Insulation of Building Elements*. Wyle Laboratories. — double-leaf three-region model
- Cremer, L., Heckl, M., Petersson, B. (2005) *Structure-Borne Sound*, 3rd ed. Springer. — bending waves, coincidence, radiation efficiency
- Bies, D. A. & Hansen, C. H. *Engineering Noise Control*, 4th ed. — mass law, material property tables
- EN 12354-1/-2 — total loss factor, parallel path summation, flanking, floating floors
- Zwikker, C. & Kosten, C. W. (1949) *Sound Absorbing Materials*. Elsevier. — viscothermal propagation in narrow channels
- Gomperts, M. C. & Kihlman, T. (1967) "The sound transmission loss of circular and slit-shaped apertures in walls", *Acustica* 18. — slit transmission and resonance
- Miki, Y. (1990) "Acoustical properties of porous materials — modifications of Delany–Bazley models", *J. Acoust. Soc. Jpn.* 11(1)
- Abramowitz, M. & Stegun, I. — Bessel polynomial approximations (9.4.x)
- Aarts, R. M. & Janssen, A. J. E. M. (2003) "Approximation of the Struve function", *JASA* 113(5)
- ASHRAE Handbook — *HVAC Applications*, Sound and Vibration Control. — duct elements, end reflection, breakout, regenerated noise
- ASTM E413, ISO 717-1, ISO 3744, ISO 16283, IEC 61672-1
- Cox, T. J. & D'Antonio, P. *Acoustic Absorbers and Diffusers*, 3rd ed. — flow resistivities
