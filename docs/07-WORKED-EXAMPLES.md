# 07 — Worked Examples

Every number below is real engine output, reproducible with the command shown.
Nothing is illustrative.

---

## Example 1 — The DIY booth that does not work

> *"I built a 1.2 m plywood box in my rented bedroom, put an old door on it and
> drilled a hole for a fan. I scream at 100 dB inside. What do the neighbours
> hear?"*

```bash
node cli/simulate.mjs --scenario bedroom-diy
```

**Design:** 1.2 × 1.2 × 2.1 m · 18 mm MDF + 50 mm rock wool + 12.5 mm board ·
hollow-core door, no seals · straight unlined 100 mm duct · sitting directly on a
timber floor · 2 mm unsealed wall/floor junction · unsealed socket back-box ·
50 mm acoustic foam inside.

**Result**

```
INSIDE            100.0 dB SPL     99.3 dB(A)
BOOTH ISOLATION   − 23.0 dB        STC 24 / Rw 25 (C+0, Ctr+0)
OUTSIDE            77.0 dB SPL     75.4 dB(A)
Background 25.8 dB(A) → perceived 75.5 dB(A)   excess +49.7 dB
Verdict: Obtrusive. Expect complaints.
Cost: £605
```

| Hz | 63 | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| inside | 71 | 83 | 90 | 94 | 95 | 94 | 86 | 75 |
| outside | 63 | 69 | 70 | 69 | 69 | 71 | 67 | 55 |
| composite TL | 9 | 15 | 22 | 27 | 29 | 25 | 22 | 21 |

**Where it goes**

| Share | Path |
|---|---|
| 22.6 % | Door: frame-to-wall junction, unsealed (2 mm) |
| 15.1 % | Door: threshold, 10 mm undercut |
| 15.0 % | Door: leaf itself |
| 12.6 % | Door: perimeter gap, 3 mm bare rebate |
| 12.5 % | Wall/floor junction, unsealed |
| 11.3 % | Duct, down the bore |

By group: **door 65 %, leaks 20 %, vent 11 %, wall 4 %.**

**Diagnosis:** *70 % of the escaping sound is going through gaps, not through
materials.*

**What this teaches.** The walls are transmitting 4 % of the total. Adding another
layer of board to them would change the answer by about 0.2 dB. The £605 was spent
on the wrong thing entirely: this booth is an air-leakage problem wearing a wall
costume. Sealant and a door are the fix, and they cost tens of pounds.

---

## Example 2 — The same room, built properly

```bash
node cli/simulate.mjs --scenario bedroom-good
```

**Design:** 1.4 × 1.4 × 2.1 m · resilient bar, 2 × 12.5 mm board with damping
compound + 100 mm rock wool + 18 mm MDF · shop-built 2 × 18 mm damped MDF door
with rubber bulb and blade seals · lined labyrinth vent, four bends · rubber mat
under the footprint · all junctions sealed.

**Result**

```
INSIDE            100.0 dB SPL     99.3 dB(A)
BOOTH ISOLATION   − 39.6 dB        STC 47 / Rw 46 (C+0, Ctr−4)
OUTSIDE            60.4 dB SPL     54.7 dB(A)
Background 25.8 dB(A) → perceived 54.8 dB(A)   excess +29.0 dB
Verdict: Obtrusive. Expect complaints.
Cost: £1,308
```

| Hz | 63 | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| outside | 54 | 55 | 54 | 52 | 49 | 47 | 43 | 32 |
| composite TL | 18 | 30 | 38 | 44 | 49 | 49 | 46 | 44 |

By group: **door 89 %, wall 11 %, vent 0.2 %, leaks 0.0 %.**

**Two uncomfortable truths.**

First, **doubling the budget bought 21 dB** — a genuinely large improvement, and
the leaks and vent are now negligible. That is what correct sequencing looks like.

Second, **it still fails every criterion.** 54.7 dB(A) at 1 m from a 100 dB scream
is not a quiet booth. The door leaf alone now carries 63 % of the escaping power,
because on a 1.4 m booth the door is 1.66 m² of a 15.7 m² envelope — over 10 % of
the surface, at 10 dB worse TL than the walls. **On a small booth, the door is the
design.**

The honest conclusion the simulator forces: if you need a screaming vocalist to be
inaudible to a neighbour, a 1.4 m booth with any single door will not do it. You
need a bigger booth (proportionally smaller door), a much heavier door set, or an
air lock.

---

## Example 3 — Will the neighbour hear it?

```bash
node cli/simulate.mjs --scenario apartment-neighbour
```

**Design:** 1.5 m booth, isolation clips + damped double board + 140 mm wool ·
proprietary acoustic door set Rw 40 · twin attenuators + plenum · floating raft on
mineral wool. Receiver: neighbour's bedroom at night through a 215 mm brick party
wall, background 23.6 dB(A). Source: belting vocal at **105 dB**.

**Result**

```
INSIDE            105.0 dB SPL    102.6 dB(A)
OUTSIDE            33.2 dB SPL     27.7 dB(A)   28.8 dB(A) with fan
Booth STC 53 / Rw 53 (C−1, Ctr−6)   ·   overall NIC 75
Background 23.6 dB(A) → perceived 29.9 dB(A)   excess +5.2 dB
Verdict: Marginally audible. Detectable in a quiet moment.
Cost: £2,174
```

| Hz | 63 | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| in neighbour's room | 29 | 26 | 24 | 25 | 24 | 20 | 11 | −1 |

**Diagnosis:** *Prediction is limited by structural flanking, not by your design.*

This is the most instructive result in the set. The airborne chain — booth plus
party wall — is now so good that the answer is set by vibration through the
building, and the engine has capped the level difference at 75 dB. **Spending more
on mass or sealing will not move this number.** Only breaking the structural
connection will.

Note also `Ctr = −6`: against a low-frequency-weighted source the booth is 6 dB
worse than its Rw suggests, and the residual is bass. What the neighbour hears is
a faint thump, not words — which the octave-band table shows directly (29 dB at
63 Hz, −1 dB at 8 kHz).

---

## Example 4 — The drum booth, and why the window is now the problem

```bash
node cli/simulate.mjs --scenario studio-live-room
```

**Design:** 3.0 × 2.6 × 2.4 m room-in-room, triple board on a separate frame,
250 mm cavity · twin doors with a 600 mm air lock · spring-mounted concrete raft ·
1.2 × 0.9 m vision panel of 12.8 mm + 8.8 mm acoustic laminated glass with a
150 mm gap. Source: **drum kit at 115 dB**.

**Result**

```
INSIDE            115.0 dB SPL    111.4 dB(A)
OUTSIDE            77.6 dB SPL     49.9 dB(A)
STC 74 / Rw 72 (C−2, Ctr−9)
Cost: £5,180
```

| Hz | 63 | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| inside | 110 | 107 | 106 | 105 | 105 | 105 | 105 | 97 |
| outside | 77 | 59 | 41 | 30 | 29 | 30 | 29 | 21 |
| composite TL | 32 | 49 | 66 | 75 | 76 | 76 | 76 | 76 |

By group: **window 50 %, wall 43 %, door 6 %, vent 0.4 %.**

Three lessons:

1. **The window is now half the problem** despite being excellent glazing, because
   it is the weakest element of an otherwise extraordinary envelope. Weakest-path
   logic never stops applying; it just moves.
2. **The bass escapes and nothing else does.** 77 dB at 63 Hz against 21 dB at
   8 kHz. Composite TL is 32 dB at 63 Hz versus 76 dB at 500 Hz — a 44 dB spread.
   `Ctr = −9` quantifies it. What the control room hears is kick drum.
3. **STC 74 sounds spectacular and is nearly irrelevant** for this source, because
   STC starts at 125 Hz and the problem is below it.

---

## Example 5 — The office pod, where the background saves you

```bash
node cli/simulate.mjs --scenario office-pod
```

Budget wall build-up, solid-core door, glazed front. Source: raised voice at
72 dB. Receiver: open-plan office, background **39.7 dB(A)**.

```
INSIDE             72.0 dB SPL     67.5 dB(A)
OUTSIDE            41.3 dB SPL     29.2 dB(A)   39.4 dB(A) with fan
STC 35 / Rw 35     Cost: £1,069
Background 39.7 dB(A) → perceived 42.6 dB(A)   excess −0.3 dB
Verdict: At or just below the background. Effectively inaudible.
```

The same STC 35 construction that fails badly in Example 1's bedroom **passes
comfortably here**, because the criterion is audibility against a 40 dB(A)
background rather than against a 16 dB(A) one.

This is why a raw dB figure with no background is meaningless, and why the tool
always reports the excess. It also shows the fan mattering: 29.2 dB(A) of speech
leakage but 39.4 dB(A) once the fan is included — **the ventilation is now louder
than the thing you were trying to contain.**

---

## Example 6 — Live material change (Part 16 walkthrough)

Every row is one control change, recomputed in ~2 ms.

```bash
node cli/simulate.mjs --wall booth-budget --door solid-core --vent flex-2bend --level 100
```

| Change | Outside dB(A) | Δ | STC | Cost | Δ cost |
|---|---|---|---|---|---|
| baseline: 18 mm MDF + 50 mm wool + board, solid-core door | 65.4 | — | 35 | £875 | — |
| wall → resilient bar, damped double board, 100 mm wool | 62.4 | −3.0 | 36 | £964 | +£89 |
| door → acoustic door set Rw 40 | 51.1 | **−11.3** | 52 | £1,162 | +£198 |
| vent → twin attenuators + plenum | 49.5 | −1.6 | 52 | £1,630 | +£468 |
| floor → floating raft on mineral wool | 49.4 | −0.1 | 52 | £1,673 | +£43 |

Read the sequence carefully, because it contains the central lesson of the whole
tool:

- The **door upgrade bought 11.3 dB for £198** — by far the best value change
  available, because the door was the dominant path.
- The **vent upgrade bought 1.6 dB for £468.** Nearly three times the money for a
  seventh of the benefit, because by then the door leaf had become the limit again.
- The **floor upgrade bought 0.1 dB.** Structure-borne flanking was never the
  problem in this design, so isolating the floor did nothing.
- Note the wall upgrade raised STC by only 1 point while the *door* upgrade raised
  it by 16. The single-number rating of the envelope is dominated by its weakest
  large element, not by the wall specification.

Spending in the wrong order wastes most of the budget. Spending in weakest-path
order does not. This is the entire argument for modelling paths separately rather
than quoting a single wall rating.

---

## Example 7 — The air-gap study

```bash
node cli/simulate.mjs --list   # then use the UI "Air-gap study" tab
```

12.5 mm plasterboard and 18 mm MDF on separate frames, cavity 70 % filled with
45 kg/m³ rock wool:

| Cavity | f₀ | 125 Hz | 250 Hz | 500 Hz | 1 kHz | STC |
|---|---|---|---|---|---|---|
| 10 mm | 232 Hz | 22 | **18** | 40 | 53 | 33 |
| 25 mm | 147 Hz | **16** | 30 | 47 | 57 | 36 |
| 50 mm | 104 Hz | 19 | 36 | 51 | 58 | 43 |
| 100 mm | 73 Hz | 24 | 41 | 52 | 58 | 48 |
| 200 mm | 52 Hz | 30 | 45 | 53 | 58 | 53 |
| 300 mm | 42 Hz | 33 | 46 | 53 | 58 | 54 |

The two bold cells are the most instructive numbers in the table. **They show the
mass–air–mass resonance walking through the spectrum as the cavity changes.** At
10 mm, `f₀ = 232 Hz` and the 250 Hz band collapses to 18 dB — *worse than the
125 Hz band above it*, and worse than a single leaf of the same total mass. At
25 mm, `f₀` has moved to 147 Hz and now it is the 125 Hz band that suffers. The
weak spot does not disappear as you change the cavity; it *moves*, and the design
question is where you can afford to put it.

**When a bigger gap helps.** Almost entirely at low frequency, and mostly by
dragging `f₀` downward (`f₀ ∝ 1/√d`). From 25 mm to 300 mm the 125 Hz band gains
17 dB and STC gains 18 points.

**When it stops helping.**

1. **Above about 500 Hz it saturates.** 500 Hz gains 12 dB going from 25 mm to
   100 mm, then only 1 dB from 100 mm to 300 mm, and 1 kHz is flat at 58 dB from
   50 mm onward. The airborne path has become so good that the **structural
   bridging path through the frames now sets the ceiling**, and no amount of extra
   depth touches it. Only better decoupling will.
2. **Below `f₀` a deeper cavity does nothing at all.** The leaves move together as
   one mass; only mass helps there.
3. **An empty deep cavity develops standing waves** at `n·c/2d` — a 200 mm empty
   cavity dips at 858 Hz, 1716 Hz… Fill at least 60 %.
4. **Deep cavities need bracing**, and bracing re-couples the leaves and
   reintroduces the very bridging path that is already the limit above 500 Hz.
5. **Diminishing returns in floor area:** 200 → 300 mm buys 1 STC point for
   100 mm of floor space you cannot get back.

---

## Example 8 — Why acoustic foam is not soundproofing

```bash
node cli/simulate.mjs --material acoustic-foam --thickness 50
```

```
Open-cell acoustic foam (wedge/pyramid) — 50 mm
  Absorber only. This will NOT stop sound escaping.

  Surface mass       1.4 kg/m²
  Coincidence f_c    above audible range
  NRC (absorption)   0.65

  Blocking (isolation)  ▰▱▱▱▱  1/5
  Absorbing             ▰▰▰▱▱  3/5
  Self-damping          ▰▰▰▰▰  5/5

  At 50 mm this gives 1.4 kg/m² of surface mass, which by itself is worth
  about 10 dB of transmission loss at 500 Hz.

  ! Do not count this material toward your isolation target. Sound blocking
    needs mass and airtightness; absorption is a different job.
```

Compare with the same thickness of a real mass layer:

| Material at 50 mm | kg/m² | TL at 500 Hz | Cost/m² |
|---|---|---|---|
| Acoustic foam | 1.4 | 10 dB | £14.00 |
| Plasterboard (4 × 12.5 mm) | 35.0 | 31 dB | £11.20 |
| MDF | 37.5 | 31 dB | £27.00 |
| Concrete | 115.0 | 34 dB | £9.00 |

**21 dB of difference for less money.**

(The mass materials look modest here because 50 mm of any *single* stiff material
has a low coincidence frequency — 50 mm concrete has `f_c ≈ 355 Hz` — so the
plateau costs it 14 dB against its mass law. Four separate 12.5 mm sheets keep the
`f_c` of 12.5 mm board, which is why layering beats bulk.) The foam does have a real job — it dries
the booth up, cuts the reverberant build-up by a few dB, and as cavity or duct
lining it is genuinely valuable. But covering the *inside* of a wall in foam
changes what you hear inside and leaves what the neighbours hear essentially
unaltered. The engine says so in as many words, because this single
misunderstanding wastes more money than any other in amateur studio building.

---

## Example 9 — Optimiser: cost against decibels

```bash
node cli/simulate.mjs --scenario bedroom-diy --optimise --target 35 --budget 2500
```

420 complete designs simulated exhaustively in ~500 ms. Pareto front, abridged:

```
    Cost   dB(A)  STC   Limiting path
  ---------------------------------------------------------------------
   £  589   74.6   24   Door: frame-to-wall junction, unsealed
   £  637   68.9   32   Vent: open hole, down the bore
   £  717   62.5   35   Door leaf (solid-core)
   £  770   55.7   45   Door leaf (shop-built damped MDF)
   £  914   52.1   49   Door leaf (acoustic door set Rw 40)
   £ 1244   47.9   54   Socket back-box, sealed and backed
   £ 1566   44.6   56   Socket back-box, sealed and backed
   £ 1907   41.8   57   Socket back-box, sealed and backed
  ---------------------------------------------------------------------
  VERDICT: Target of 35 dB(A) cannot be reached with any combination
  in the option set; the best possible is 41.8 dB(A) at £1,907.
  The limiting path in the best design is "Socket back-box, sealed
  and backed" at 91 % of the transmitted power.
```

Three things worth noting.

**The first £128 buys 12 dB.** Sealing the door frame, fitting a threshold seal and
putting a real duct on the vent is the best-value intervention available by an
enormous margin. The last £341 buys 2.8 dB.

**The limiting path moves four times** as you walk up the front: frame junction →
vent bore → door leaf → socket box. Each fix promotes a different component to
"worst", which is why a single-number wall rating cannot guide a budget.

**The optimiser refuses to claim success.** The target is unreachable within the
option set, and it says so and names why: a *sealed* socket back-box is still 91 %
of the transmitted power once everything else is excellent. The correct engineering
answer is to move the socket out of the isolated envelope entirely — a design change
the option set does not contain. A tool that quietly returned its best guess as
"the answer" would have hidden that.

---

## Reproducing everything

```bash
npm test                 # 171 tests
npm run validate         # laboratory validation table
npm start                # UI at http://localhost:8080

node cli/simulate.mjs --list
node cli/simulate.mjs --scenario bedroom-good
node cli/simulate.mjs --compare booth-budget double-stud
node cli/simulate.mjs --material mlv --thickness 2.6
node cli/simulate.mjs --value          # cost per kg/m² of every mass material
node cli/simulate.mjs --json --scenario bedroom-good > result.json
```
