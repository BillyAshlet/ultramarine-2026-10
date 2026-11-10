# Flame spread over and within burning items: mechanisms and numbers

Research notes for the Duplex whole-house fire engine (20 cm grid, objects that ignite, burn along measured HRR curves, and burn out).

**Reading-status legend.** Each source has one tag:
- **[READ]**: I read the original text (PDF → pdftotext, plus page images where the table was garbled).
- **[ABSTRACT]**: I saw only an abstract or catalogue page.
- **[SECONDARY]**: the number comes through another author's summary of the original, or through a web-search snippet I could not check against the original.

**Numbers I worked out myself.** Some numbers come from my own arithmetic on cited inputs. These are marked **(derived)**, and the inputs are named next to them.

---

## 1. Opposed-flow vs concurrent (wind-aided) flame spread

### 1.1 What drives each mode

**Opposed flow (lateral or downward on a wall; outward over a floor or seat).**
- In this mode, the air the flame pulls in flows against the direction of spread.
- Only the small region at the flame's leading edge heats the unburnt fuel ahead of it. That heating is mostly conduction through the gas, so it reaches about 1 mm ahead.
- Quintiere & Harkleroad (1984) analyse this mode with de Ris's thermally thick solution, modified for a preheated surface (NBSIR 84-2943, eq. 7, p. 11–12) **[READ]**:

  V = V_a (kρc)_g (T_f − T_ig)² / [ kρc (T_ig − T_s)² ]

- They then fold everything that is not a property of the solid into one parameter Φ (eq. 8) **[READ]**:

  **V = Φ / [ kρc (T_ig − T_s)² ]**

- What this means:
  - V depends on (T_ig − T_s)⁻². Spread is very slow on a cold surface and very fast on a preheated one.
  - Below a minimum surface temperature **T_s,min**, the flame stops at a finite speed. It does not slow smoothly to zero (NBSIR 84-2943 p. 20 **[READ]**: "the flame spread velocity does not approach zero continuously").
  - The buoyant opposed-flow velocity under natural convection is about **11 cm/s** (p. 12). Opposed-flow speeds of this size or smaller "tend to have an insignificant effect on the spread rate" (p. 12) **[READ]**.
  - For PMMA, the reference Φ is about **10 kW²/m³** (p. 13, 19). Table 2 gives Φ from **about 1 to 15 kW²/m³** (p. 19) **[READ]**.
- The same report shows that one T_ig describes both piloted ignition and opposed-flow spread (p. 21, conclusions p. 22) **[READ]**. This is the basis of the LIFT test, ASTM E1321.

**Concurrent / wind-aided (upward on a wall, along a ceiling, or with wind).**
- The flame lies over the unburnt fuel ahead of the pyrolysis front. It heats a whole flame length of surface, not about 1 mm.
- Sibulkin & Kim's expression, as quoted in NBSIR 84-2943 (eq. 15, p. 21) **[READ]; the original I did not read**:

  V ≈ (q̇″_f)² δ_f / [ kρc (T_ig − T_s)² ]

  Here q̇″_f is the flame heat flux to the surface downstream of the pyrolysis zone, and δ_f is the flame length over that heated region.
- The engineering form used in zone models (Saito, Quintiere & Williams 1985 / Karlsson). I took it from North et al. (2001), Lund LUTVDG/TVBB-7014, eqs 2.3–2.5, pp. 4–5 **[READ]**:

  t_ig = (π/4) kρc (T_ig − T_0)² / q̇″²   and   **V = (x_f − x_p) / t_ig**

  Here x_f is the flame-tip height and x_p is the pyrolysis-front height.
- **Why upward spread accelerates:**
  - Flame height grows with heat release rate: x_f = K·Q̇ⁿ (North et al. 2001 eq. 2.7). For wall flames, n = 2/3 on Q̇ per unit width (Quintiere, Harkleroad & Hasemi 1986, Combust. Sci. Tech. 48:191; **[ABSTRACT]**: "flame height proportional to energy release rate, to the 2/3 power", holding for flame heights 0.3–1.4 m).
  - As the pyrolysis front climbs, the burning area grows, so Q̇ grows, so x_f grows faster than x_p. The heated zone ahead (x_f − x_p) lengthens and V increases. This positive feedback is what makes upward spread accelerate.
  - North et al. (2001, §2.2, Table 2.1, p. 10–11) **[READ]** solve the resulting Volterra equation. The HRR per unit area is modelled as Q̇″(t) = Q̇″_max·e^(−λt). Depending on a = K·Q̇″ and λ·t_ig, spread either accelerates for all time, oscillates, or decelerates.
  - Practical reading: spread accelerates when the material's HRR per unit area is high enough that its flame reaches further ahead than the pyrolysis front, and the HRR decays slowly (λ small).
  - North et al. state that wind-aided spread "can be acceleratory and generally dominates over opposed flow flame spread" (p. 3–4) **[READ]**.
- B-RISK's implementation (Wade et al. 2016, BRANZ SR364, §11.2 and §11.8, pp. 110 and 117–118) **[READ]**:
  - dy_p/dt = (y_f − y_p)/t_ig.
  - **Assumed flame flux ahead of the front = 30 kW/m²; flame flux in the pyrolysing region = 35 kW/m².** Quintiere's original model assumed 60 kW/m² from the burner flame.
  - Flame tip, once separated from the burner: y_f = y_b + K·(Q̇″_p·(y_p − y_b))ⁿ, with **K = 0.0065, n = 1** (Kokkala et al. 1997, cited there).
  - Upward burnout front: dy_b/dt = (y_p − y_b)/t_b, where t_b = (area under the cone HRR curve)/(current HRR per unit area).
  - Lateral and downward spread uses dx_p/dt = Φ/[kρc(T_ig − T_s)²], **applied only when T_s > T_s,min** (eq. 210).

### 1.2 LIFT / ASTM E1321 parameters for common materials

Source: Quintiere & Harkleroad (1984), NBSIR 84-2943, **Table 2 "Flame Spread Properties", report pp. 28–29 (PDF pp. 42–43)** **[READ: page images]**.
- All tests: vertical specimens, natural convection, opposed (lateral) spread.
- A dash means the value was not taken.
- The table carries the note "Values are only significant to two places".

| Material | T_ig (°C) | kρc ((kW/m²K)²s) | Φ (kW²/m³) | T_s,min (°C) | Φ/kρc (m·K²/s) |
|---|---|---|---|---|---|
| Plywood, plain (1.27 cm) | 390 | 0.54 | 12.91 | 120 | 24 |
| Plywood, plain (0.635 cm) | 390 | 0.46 | 7.49 | 170 | 16 |
| Douglas fir particle board (1.27 cm) | 382 | 0.94 | 12.75 | 210 | 14 |
| Particle board (1.27 cm stock) | 412 | 0.93 | 4.27 | 275 | 5 |
| Chipboard (S118M) | 390 | — | — | 180 | 11 |
| Hardboard (6.35 mm) | 298 | 1.87 | 4.51 | 170 | 2 |
| Hardboard (3.175 mm) | 365 | 0.88 | 10.97 | 40 | 12 |
| Fiber insulation board | 355 | 0.46 | 2.25 | 210 | 5 |
| Wood panel (S178M) | 385 | — | — | 155 | 43 |
| Fiberboard, low density (S119M) | 330 | — | — | 90 | 42 |
| **Foam, flexible (2.54 cm)** | 390 | 0.32 | 11.70 | 120 | 37 |
| Polyurethane (S353M) | 280 | — | — | 105 | 82 |
| Foam, rigid (2.54 cm) | 435 | 0.03 | 4.09 | 215 | 141 |
| Carpet (acrylic) | 300 | 0.42 | 9.92 | 165 | 24 |
| Carpet (nylon/wool blend) | 412 | 0.68 | 11.12 | 265 | 16 |
| PMMA Type G (1.27 cm) | 378 | 1.02 | 14.43 | 90 | 14 |
| Plywood, FR (1.27 cm) | 620 | 0.76 | * (not measurable) | 620 | * |
| Gypsum board (common, 1.27 mm) | 565 | 0.45 | 14.44 | 425 | 32 |

Caveats the authors give:
- The kρc values are "effective" values and are higher than handbook ambient values. They absorb pyrolysis, melting and backing effects (p. 18).
- "values of T_s,min < 80 °C could apply to much lower temperatures": the apparatus could not test lower (p. 21).
- To correct Φ for vitiated (oxygen-depleted) air, multiply by about (Y_O2/0.233) (p. 21).

**Opposed-flow speeds implied by Table 2 (derived).** I computed V = Φ/[kρc(T_ig − T_s)²]. V is set to 0 when T_s < T_s,min, per the authors' criterion.

| Material | T_s = 20 °C | 200 °C | 300 °C | 350 °C |
|---|---|---|---|---|
| Plywood 1.27 cm | **0** (0.18 mm/s if the T_s,min cut-off is ignored) | 0.66 mm/s | 3.0 mm/s | 15 mm/s |
| Douglas fir particle board 1.27 cm | **0** (0.10) | 0 | 2.0 mm/s | 13 mm/s |
| Particle board 1.27 cm stock | **0** (0.03) | 0 | 0.37 mm/s | 1.2 mm/s |
| Flexible foam 2.54 cm | **0** (0.27) | 1.0 mm/s | 4.5 mm/s | 23 mm/s |
| Carpet (acrylic) | **0** (0.30) | 2.4 mm/s | (T_s ≥ T_ig: ignites) | — |

**Key qualitative result.** For every wood product in Table 2, T_s,min (120–275 °C) is far above room temperature. On an unheated vertical wood surface, lateral and downward flame spread therefore does not continue on its own in this apparatus. It needs the surface preheated:
- by external radiation (a neighbouring flame, a hot layer), or
- by the item's own flame, which is the upward/concurrent case.

This agrees with Tran & Janssens (1991, J. Fire Sci. 9:106–124, p. 121) **[READ]**. In corner tests on wood-product linings with a hot upper layer, "downward (i.e., wind-opposed) flame spread was the main mechanism, resulting in increased burning area prior to flashover". In other words, opposed spread becomes important once the hot layer has preheated the walls.

### 1.3 Typical spread speeds (measured where found)

| Situation | Speed | Source |
|---|---|---|
| Fabric over 25 mm PU foam, horizontal, no external radiation, end-ignited | **0.7–1.1 mm/s** (cellulosic fabrics over cotton batting: about ½ of that) | Lee & Wiltshire, summarised in Babrauskas & Krasny 1985, NBS Monograph 173, pp. 20–21 **[SECONDARY]**, read in the Monograph |
| Bare PU foam mattress slab, centre ignition, horizontal, radial | r = 2.3×10⁻³·t m for 0–30 s, i.e. **2.3 mm/s**. Then r = 3.5×10⁻²·e^(0.026t) (0.5 m slab, 30–70 s) or 4.0×10⁻²·e^(0.021t) (0.9 m slab, 30–130 s). Mass loss rate ṁ = 46.1·r^2.23 g/s. 14 % of the mass was gone at full surface involvement | Mizuno, in Monograph 173, p. 20 eq. 7 **[SECONDARY]**, read from the page image |
| Flexible PU foam slabs/mattresses, large-scale, 11 tests, horizontal | Average **3–7 mm/s**; extremes about 2 and 11 mm/s; within one slab 1–8 mm/s depending on ignition location | Wilkens Flecknoe-Brown & van Hees 2021, Fire Mater. 45:81–96 **[ABSTRACT / SECONDARY]**: search-snippet text only, not verified |
| Same as above, exponential phase (derived) | dr/dt = 0.026·r → about 5 mm/s at r = 0.2 m, about 10 mm/s at r = 0.4 m | My arithmetic on Mizuno's fit |
| Lateral spread on vertical wood products at room temperature | Effectively 0 (T_s,min > ambient); 0.03–0.18 mm/s if the cut-off is ignored | Derived from NBSIR 84-2943 Table 2 |
| Upward spread on plywood (derived, order of magnitude) | t_ig at 30 kW/m² flame flux = (π/4)(0.54)(370/30)² ≈ **65 s**. A flame overhang (x_f − x_p) of 0.2–1 m gives **≈3–15 mm/s**, growing as the flame lengthens | Inputs: NBSIR 84-2943 Table 2 and B-RISK's 30 kW/m² |
| Upward spread on flexible foam (derived) | t_ig ≈ **38 s** at 30 kW/m², so about 5–25 mm/s for the same overhang | Same inputs |
| Thin fabric, 45° upward, "rapid and intense burning" threshold | Class 3 (plain fabric) if the flame covers **127 mm in < 3.5 s**, i.e. **> 36 mm/s** (derived). Raised-surface fabric: < 4.0 s | 16 CFR 1610.4 and 1610.5 **[READ]** (Cornell LII). These are regulatory thresholds, not measured speeds |

**Not found:**
- A measured upward spread speed for real wood furniture.
- The "Drysdale / Friedman table" of typical spread rates (I could not reach the book).
- An SFPE-Handbook LIFT table (not accessible). NBSIR 84-2943 is the original source for most handbook LIFT values.
- I did not check NUREG-1805 for flame-spread content.

Thin vs thick fuels: Babrauskas & Krasny (1985, p. 20) **[READ]** note that real PU foam behaves as neither the thermally thin nor the thermally thick limit. For fabric/foam composites, the reality is "usually somewhat closer to the thermally thick case".

---

## 2. Why upholstered (PU foam) items burn the way TN 2303 shows

Source: NIST TN 2303, Hamins et al., March 2025, "The Character of Burning Residential and Office Items" **[READ]**, full text.
- I used the existing extraction at `.../scratchpad/dl/tn.txt` and did not re-download a fresh copy.
- Page numbers below are the report's printed page numbers.

### 2.1 What TN 2303 says (quotes ≤ 15 words each, otherwise paraphrased)

**The jump is a pool fire under the item, not smouldering.**
- All TN 2303 soft-furnishing tests were *flaming* ignitions: a propane igniter of about 1.5 cm flame, 128 W, for about 30 s (p. 16, Table 5).
- A different power for the mattress igniter appears on p. 22 ("2 cm (87 W)"). This is an internal inconsistency in the report.
- The slow first phase is flame spread over pillows and the cover and top layers. It is not smouldering.
- From the background review (p. 5–6): the rapid HRR rise in furniture fires "occurs after the ignition of flammable liquid products beneath the burning object". There, PU foam liquefaction and dripping form a pool fire (citing Ohlemiller 1995; Sundström 1995, 2021; Zammarano 2020).

**Sofas (p. 23–24).**
- Pool fires appeared under all three sofas at about the same time: **4.30 min (Sofa A), 4.67 min (Sofa C), 4.70 min (Sofa B)**.
- "The observation of the pool fire typically was associated with the occurrence of a rapid rise and inflection point in the HRR curve."

**Cushion thickness (p. 24, conclusions p. 31).**
- Seat cushions with 1 PU layer showed melt breakthrough at **2.98 min**. With 2 or 3 layers it took **over 4 min**.
- "more time and heat is required to liquify the PUF before dripping can be generated".
- More foam gives a larger pool and a higher peak HRR.
- The conclusions put the delay at "about one min longer" per added thickness step.

**Ignition location (p. 24).**
- Identical sofas reached a **5 MW peak at 5.9 min** (pillow on the seat, Test 36), **4 MW at 10.7 min** (pillow behind the back, Test 41), and **about 3 MW at 9.2 min** (armrest, Test 30).
- The total heat release was the same within 1 %.
- Engine implication: the same item has a different curve shape depending on where it is ignited.

**Mattresses (p. 21).**
- Flames spread over the pillows. The pillows shrank (thermoplastic liquefaction), then flames spread over the mattress top towards the edges.
- The top charred away and exposed the PU core. "Concurrently, flaming drips of molten material fell from the mattress onto the floor, yielding pool fires". These grew as they heated the mattress from below.
- "The peak HRRs occurred only after the pool fires under the mattresses were present".

**Fire barriers (p. 6, citing Thompson 2021).**
- A barrier fabric delays PU liquefaction by reducing heat transfer to the padding.
- The liquid pyrolyzates must also percolate through the barrier to reach the underside before igniting.
- "These mass and heat transfer processes are the primary mechanisms by which a fire barrier functions".

**Barrier effect in numbers (p. 22–23, Table 6).**

| Mattress C test | Peak HRR | Time to peak | Time to 1.2 MW |
|---|---|---|---|
| Bedclothes, with FR sock (Test 38) | **4.6 MW** | 12.8 min | **11.8 min** |
| Same, with the sock removed (Test 44) | **7.1 MW** | < 8 min | **6.6 min** |
| No bedclothes, two pillows (Test 32) | 2.8 MW | 16.6 min | 13.4 min |

Mattress A (innerspring with a non-woven barrier) stayed at **0.16–0.19 MW**.

**Fabric (p. 5).**
- Polyester/cotton blends show a "scaffolding effect": the cotton chars into a skeleton and the polyester melts over it and feeds the fire.
- Blends "ignite more easily, burn more intensely" than either component alone (citing Xie 2024).

**Predictability (p. 3).**
- "prediction of the spread and growth of furniture fires is currently not practical" except in special cases (citing Brown 2018).
- This is why TN 2303 supplies measured curves.

### 2.2 Wood and particleboard items in TN 2303 (relevant to item 3)

**Side table (compressed particleboard, Test 18).**
- The igniter was about 1 cm under the table, 128 W for **156 s** (20 kJ).
- "The table did not ignite even after many minutes of an imposed flame" (p. 45, Fig. A18).
- Mass loss 0.042 kg; peak 2.2 kW, which is the igniter itself (Table 6, footnote A: "Mass loss and HRR occurred only when the igniter flame impinged on the specimen").

**Bookshelf with one polyester pillow (Test 33).**
- Peak 79.2 kW at 2.4 min; THR 6.9 MJ; **94 % residual mass**; effective HOC 5.9 kJ/g (Table 6, p. 25).
- My reading (derived): the pillow alone gives about 50–73 kW (Pillow A tests 1/7/13). So the bookshelf contributed little and the pillow dominated.

**Laptop A and side table (p. 26).** "sustained burning did not occur when the igniter flame was removed".

**Sofa labels in Table 6.** The text extraction of Table 6 shows sofa letters that do not match the test numbers given in the text. Per the text (p. 23–24): Sofa A = Tests 29, 35, 40; Sofa B (chaise) = 30, 36, 41; Sofa C = 34. Check the PDF before relying on the table's letter column.

### 2.3 The PU foam mechanism underneath (other sources)

**Two-stage decomposition.** Prasad et al. (2009, Fire and Materials conf., NIST pub 901154) **[READ]**:
- In thermogravimetry of a flexible polyether PU foam, 34.5 % of the mass was lost at **250–310 °C** (peak 280 °C) and 65.5 % at **340–380 °C** (peak 362 °C).
- Interpretation:
  - Urethane/urea bonds break above about 200 °C.
  - TDI (boils at about 250 °C) leaves first. The foam "collapses" at that first peak.
  - The polyol stays behind as a liquid melt pool and decomposes at 320–350 °C.
  - Typical foam is about 33 % TDI and 66 % polyol by mass.
- Densities: foam 23.5 kg/m³ vs polyol 1012 kg/m³.

**Large-scale 10 cm slab, 1.2 m square, edge-ignited (same paper).**
- HRR rises slowly to about 200 kW in about 70 s, then more rapidly to about 650 kW at 150 s (FDS prediction; the experiments are described as "similar").
- Heat flux at a gauge 0.91 m from the ignited edge was about zero until the flame arrived. It then **jumped to 50–60 kW/m², peaking at 95 kW/m²**, and the slab was consumed in **400 s**.
- The flame front became parabolic, fastest at the centre.
- The final stage is the polyol pool burning "accompanied by very intense heat release rates and tall flames".
- FDS over-predicted the spread rate by at least ×2.

**Spread mechanism on a real chair.** Krasny & Babrauskas mock-ups, as summarised in Monograph 173, p. 21 **[READ]**:
- Thermoplastic fabrics melted and peeled back. The melt bead burned ahead of the PU front and ignited more PU, which gave a somewhat periodic progression on the seat.
- Cellulosic fabrics charred ahead of the flame.
- The chair back was "bathed with flame" from the seat plume.
- The arms ignited in **steps, as unpiloted ignition**, rather than by continuous spread.
- FR PU foam showed two fronts: fabric first, foam later.
- The Monograph also notes (p. 19) that spread over a chair is "materially aided by radiation from a burning nearby surface of the same chair".

**Ignition of a second item by radiation.** Babrauskas 1981, NBSIR 81-2271 **[READ]**: most fabric/PU furniture constructions ignited **within 45 s at 20 kW/m²** (p. 24–25).

---

## 3. Why wood and wood products stop flaming without external heat

### 3.1 Mechanism: energy balance at a charring surface

**Self-extinction is the expected behaviour.** Emberley et al. (2017), Fire Safety J. 91:327–335 (accepted manuscript) **[READ]**:
- "When this heat flux is completely removed, self-extinction of flaming combustion of timber occurs" (citing Babrauskas 2002 and Drysdale 2011).
- The reason given: the flames of burning timber alone cannot sustain the mass-loss rate needed for flaming.

**Their mass-loss equation (eq. 1).**
- ṁ″ = (1/ΔH_p)·[q̇″_ext + q̇″_ox − q̇″_loss − k(∂T/∂x) − (energy stored in the char)]
- As the char thickens, it insulates the pyrolysis front. The heat reaching that front falls towards a steady minimum.
- Extinction of the diffusion flame happens when the mass-loss rate falls below a critical value.
- The worst case for self-extinction is steady state. During the transient after ignition there is an initial MLR peak while the char forms. A just-ignited surface burns more strongly than a "soaked" one.
- If char or lamellae fall off ("debonding"), fresh wood is exposed and the MLR jumps. This can re-ignite the surface.

**Heat of gasification is large for wood.** Quintiere (1992), NISTIR 4840, Table 1 "Heat of gasification values at peak burning conditions" **[READ]**:

| Material | L_g (kJ/g) |
|---|---|
| Oak (in N₂, Jackson) | 4.0 |
| Particle board (from Walton & Twilley, Kulkarni, Östman data; text range 4.4–4.7) | **5.4** |
| Spruce panel | **6.3** |
| Medium-density fibreboard | 4.8 |
| Insulating fibre board | 4.2 |
| Melamine-faced particle board | 4.8 |
| PMMA (for comparison) | 1.63–1.89 |
| Rigid PU foam | 3.1 |

The same report gives a critical flame temperature for extinction of **about 1600 K** (Williams: 1500 ± 50 K) (p. 17–18) **[READ]**.

**Illustrative balance (derived, not from a source).**
- Peak burning rate ṁ″ ≈ (q̇″_flame + q̇″_ext − q̇″_rerad)/L_g.
- With L_g ≈ 5 kJ/g, staying above about 3.5 g/m²s needs a net absorbed flux of about **17.5 kW/m²**.
- A glowing char surface at about 600 °C re-radiates σT⁴ ≈ 33 kW/m² (blackbody, my arithmetic).
- So the item's own flame flux alone (typically a few tens of kW/m²) leaves too little net heat once the char is established. External or cavity radiation has to make up the difference.

### 3.2 Numbers for sustained flaming and extinction

| Quantity | Value | Source |
|---|---|---|
| Critical MLR for flame extinction, Radiata pine CLT | **3.7 ± 0.2 g/m²s** | Emberley et al. 2017, FSJ 91, p. 9 of manuscript **[READ]** |
| Critical external heat flux for self-extinction (same, steady state after ≈10 min) | **45 ± 1 kW/m²** | Same **[READ]**. In the large compartment test, extinction began at the wall base with gauges reading about **55 kW/m²** |
| Critical MLR at extinction, bench scale | **3.5 g/m²s** (or a charline temperature gradient of 28 K/mm) | Bartlett, Hadden, Bisby et al., Interflam 2016 / FSJ 91:407–413 (2017) **[SECONDARY]**, search snippet only |
| Critical incident flux, large scale | **31 kW/m²** at 3.5 g/m²s | Bartlett et al. 2017 **[SECONDARY]** |
| Range across 6 timber species | MLR **2.7–8.3 g/m²s**, critical flux **24–57 kW/m²** | Emberley group bench study **[SECONDARY]**, search snippet; exact paper not identified |
| Review range | Critical MLR **2.5–5 g/m²s**; critical flux 30–45 kW/m² | Bartlett, Hadden & Bisby 2019, Fire Technol. 55:1–49 **[SECONDARY]**: the full text was blocked (403); snippet only |
| Oxygen effect | 3.5 ± 0.3 g/m²s at 21 % O₂ → 4.1 g/m²s at 16 % O₂ | FPA study **[SECONDARY]**, snippet only |
| Firepoint mass flux "about 2.5 g/m²s for wood" (often quoted, Deepak & Drysdale 1983) | **Not verified.** I found only the citation (FSJ 5:167–169), not the number | — |

**Wood ignition flux (for context).** Babrauskas 2005 CCAI presentation "Ignition of Wood" **[READ]**, slides 28–36, summarising his 2002 JFPE 12:163–189 review (**[ABSTRACT]** for the review itself):
- The lowest flux at which wood ignites at all is **4.3 kW/m²**. This is always glowing ignition, and the NBS 1-day test took 4–5 h.
- Two-stage (glowing → flaming) ignition up to about **22 kW/m² (piloted)** or **33 kW/m² (unpiloted)**.
- Handbooks list **12.5 kW/m²** for piloted ignition; Spearpoint measured **7–8 kW/m²**.
- Piloted flaming ignition happens at a surface temperature of **300–310 °C (softwoods)** and **349–364 °C (hardwoods)**. At the minimum flux it is about 250 °C.

### 3.3 What this means for the bookcase vs wardrobe contrast

The caller's source, NBSIR 83-2787 (Lawson, Walton & Twilley 1983) **[READ]**, contains both outcomes for the same material family:

| Item (NBSIR 83-2787) | Peak HRR | What happened |
|---|---|---|
| 12.7 mm plywood bookcase (Test 62; open shelves) | 28 kW, during the burner exposure | Open flaming lasted only 60 s after the 200 s burner exposure (p. 88–89) |
| 12.7 mm plywood wardrobe (Tests 39/40/43; closed box with fabric/paper load) | **3300 kW** average (SD 208 kW) (p. 86) | Burned fully; doors burned off |
| 3.2 mm unpainted plywood wardrobe (Test 41) | **> 6000 kW at 130 s**, peak MLR 301 g/s (p. 86) | "burned rapidly"; the highest HRR in the study |

Interpretation (derived; consistent with Emberley's energy balance and Monograph 173's "radiation from a burning nearby surface of the same chair"):
- **Geometry.** Inside a box, wood surfaces face each other and the burning contents. Each surface receives radiation from the others, so the net flux stays above the roughly 30–45 kW/m² extinction range.
- **Open surfaces.** The surfaces of an open bookcase see mostly cold surroundings, so the flame dies once the burner is removed.
- **Thickness.** Thin (3.2 mm) panels are closer to thermally thin. They ignite through their whole thickness quickly, and spread is fast.

---

## 4. Simple models for spread over or between items (no resolved flame)

| Model | How spread is represented | Source |
|---|---|---|
| **FDS: radially spreading fire** | The burning region starts at XYZ and grows radially at a fixed `SPREAD_RATE` (m/s). Each cell follows `RAMP_Q` from the moment the front arrives; the guide's example is 0.03 m/s with each cell burning 30 s. The guide says not to use it "to mimic a t-squared fire growth rate". It is intended for cluttered spaces where material properties are unknown | FDS User's Guide 6.11.1, §9.2.1, p. 90–91 **[READ]** |
| **FDS: ignition-temperature surfaces** | A surface cell "ignites" when its computed surface temperature reaches `IGNITION_TEMPERATURE`. It then follows a prescribed HRRPUA × `RAMP_Q` (time from *that cell's* ignition). Optional `EXTINCTION_TEMPERATURE` (≤ T_ig) stops burning, and `HEAT_OF_VAPORIZATION` takes away surface heat. Spread emerges as neighbouring cells heat to T_ig. The model "assumes that the solid acts like a typical thermoplastic", i.e. little char | Same, §9.2.3, p. 91–92 **[READ]** |
| **FDS: SPyro (scaling pyrolysis)** | Rescales a cone HRR curve measured at `REFERENCE_HEAT_FLUX` to the local flux computed in the simulation. Example: at half the reference flux the curve is stretched ×2 in time and halved in rate; at 1.5× it is compressed by 50 % and the rate rises 50 %. Needs `IGNITION_TEMPERATURE`; can interpolate between several cone tests and thicknesses | Same, §9.2.4, p. 92–93 **[READ]** |
| **CFAST** | No spread inside an item. Each "fire" is a prescribed HRR(t) curve. A fire can be ignited at a set time, or when an associated **target** (typically placed at the base of the second fuel) reaches a set **surface temperature or incident heat flux**. Plumes do not interact | CFAST 7 User's Guide, NIST TN 1889v2, §7, p. 25–27 **[READ]** |
| **B-RISK / BRANZFIRE design fire generator: item-to-item** | Burning items act as point sources: q̇″ = Q̇·χ_r/(4πr²), with r = plan distance to the *nearest* point of the target, found by sampling each side at 10 points. A second path is hot-layer radiation εσT⁴F to the target's top. Ignition uses the **Flux-Time Product**: FTP = Σ (q̇″_i − q̇″_cr)ⁿ Δt, with item-specific FTP, q̇″_cr and n (1 ≤ n ≤ 2) for vertical and horizontal faces. The room HRR is the **sum of free-burning item curves** (the "FREEBURN" approach); HRR enhancement is optional (§6.8). Developed by Baker, Fleury, Spearpoint et al. 2011 | Wade et al. 2016, BRANZ SR364, §4.3.2, p. 34–37 **[READ]** |
| **B-RISK / BRANZFIRE linings** | Quintiere's room-corner model, modified (see §1.1): upward dy_p/dt = (y_f − y_p)/t_ig with 30 kW/m² ahead of the front; lateral/downward uses the LIFT equation for T_s > T_s,min; burnout front; flame tip with K = 0.0065, n = 1 | Same, §11, p. 110–119 **[READ]** |
| **Karlsson / North analytic upward model** | Closed-form V(t) for upward spread with Q̇″ = Q̇″_max·e^(−λt). Acceleration vs deceleration is set by a = K·Q̇″ and λ·t_ig. The calibrated area-based **K = 0.018 m²/kW**. The appendix tables give cone (50 kW/m²) Q̇″_max and λ for wall materials, e.g. particle board 204 kW/m², λ = 0.0030 s⁻¹; ordinary plywood 275, 0.0060; spruce panel 168, 0.0075; ordinary particle board (SBI) 236, 0.0050; birch plywood 187–229, 0.0020; gypsum paper-faced about 0.04–0.09 | North, Karlsson, Rosberg & Van Hees 2001, Lund LUTVDG/TVBB-7014, Ch. 2, Tables A.4–A.6 **[READ]** |
| **Babrauskas "Will the second item ignite?"** | Ignition thresholds: **10 kW/m²** (especially easily ignitable), **20 kW/m²** (typical furnishings; most fabric/PU items ignite in < 45 s), **40 kW/m²** (difficult). Measured at 0.05 m, irradiance reached up to about 80 kW/m². **40 kW/m² was never seen beyond 0.44 m** and **20 kW/m² never beyond 0.88 m**, so items about **1 m apart** are unlikely to be ignited before flashover. Peak irradiances of 40 / 57 kW/m² at 0.05 m gave 20 kW/m² out to 0.20 / 0.50 m. Fig. 13 relates peak mass-loss rate to ignition distance (not digitised here) | Babrauskas 1981, NBSIR 81-2271, pp. 9, 24–28 **[READ]** |
| **Babrauskas–Krasny furniture peak-HRR rule** | q̇_peak (kW) = 210 × fabric × padding × mass(kg) × frame × style. Fabric: 1.0 thermoplastic / 0.4 cellulosic / 0.25 PVC-PU. Padding: 1.0 PU or latex / 0.4 cotton batting / 1.0 mixed / 0.4 neoprene. Frame: 1.66 noncombustible / 0.58 melting plastic / 0.30 wood / 0.18 charring plastic. Style: 1.0 plain / 1.5 ornate. Valid only for conventional chairs that burn mainly in the flaming phase | NBS Monograph 173 (1985), §5.2, eq. 9, p. 35 **[READ]**, page image |

---

## 5. What this means for an engine with 20 cm cells

These are derived recommendations. Every number used is sourced above.

1. **A 20 cm cell is far larger than the scale of the flame front.**
   - Opposed spread at 0.3–5 mm/s takes **≈40 s to 11 min** to cross one cell.
   - Upward spread at 3–25 mm/s (derived) takes **≈8–70 s**.
   - Do not move a continuous front. Instead, **ignite a neighbouring cell when it reaches an ignition criterion**: surface temperature ≥ T_ig, or an FTP-style accumulated flux-time (B-RISK).
   - The ignition time is t_ig = (π/4)·kρc·(T_ig − T_s)²/q̇″² for thick fuels; the team already has T_ig, kρc and the critical flux from NUREG-1805.
2. **Make spread strongly directional.**
   - **Cells above** a burning cell, within the flame height, get about **30 kW/m²** (B-RISK's "ahead of the front" value). Flame height grows with item HRR: L ∝ Q̇^(2/5) for a free plume (Heskestad, eq. 183 in SR364); wall flames ∝ (Q̇/width)^(2/3).
   - **Side and below cells** get only a small flux. Allow them to ignite only if their surface has been preheated to **T_s ≥ T_s,min**: 120 °C for plywood, 210 °C for Douglas fir particle board, 275 °C for stock particle board, 120 °C for flexible foam (NBSIR 84-2943 Table 2).
   - This one rule reproduces: wood lit at the bottom spreads up; a bookcase side lit at mid-height does not spread sideways; once the hot layer preheats the walls, downward spread switches on (Tran & Janssens).
3. **Wood-product cells need an extinction check.**
   - Each step, sum the radiation a flaming wood cell receives from other burning cells (point source Q̇χ_r/4πr², with χ_r ≈ 0.43 from TN 2303 p. 31) plus the hot layer.
   - If this stays below roughly **30–45 kW/m²** (Emberley 2017: 45; Bartlett: 31) after the first few minutes, extinguish the cell. Equivalently, extinguish when the implied MLR < **≈3.5 g/m²s**.
   - Open shelves then go out (NBSIR 83-2787 bookcase; TN 2303 side table and bookshelf). Boxes, cavities and items next to a big fire keep burning (the wardrobes).
   - Be careful with the first few minutes after ignition, when the MLR peaks before the char forms. Use a short grace period.
4. **For PU-foam items, use a two-stage model rather than surface spread alone.**
   - Stage 1: flame spread over the cushions and fabric at about **1–7 mm/s** (horizontal; Lee & Wiltshire, Mizuno, Wilkens Flecknoe-Brown).
   - Stage 2: a **pool-fire cell spawned on the floor under the item** at the TN 2303 breakthrough time: **≈3 min** for a 1-layer cushion, **≈4.3–4.7 min** for typical sofas, later and larger for thicker foam or with a barrier.
   - The pool cell is what produces the HRR jump. It also heats the item from below, and it can ignite floor-level neighbours (carpet, adjacent items).
   - Simplest form: keep the measured TN 2303 HRR curve for the item. Mark the inflection time as "pool appears", and from then on add a floor heat source with the item's footprint.
5. **Scale curves with the local flux when they are reused away from test conditions.**
   - Use FDS SPyro's time-stretch / rate-scale idea, with the test reference flux. For free-burn furniture curves the reference is roughly the flux the item imposes on itself.
   - Use ignition location as a parameter. TN 2303 shows that the same sofa gives a 3–5 MW peak at 6–11 min depending on the ignition point, with the same total energy.
6. **Inter-item spread.**
   - Use the Babrauskas thresholds (10 / 20 / 40 kW/m²) with the point-source flux. Use FTP accumulation, not an instantaneous threshold.
   - Expect almost no item-to-item ignition beyond about 1 m before a hot layer forms (NBSIR 81-2271).
   - After that, hot-layer radiation to the tops of items (B-RISK path 2) takes over.

---

## Sources (with URLs and what I actually read)

1. Hamins A., Di Cristina G., Bundy M., Chakalis T., Fernandez M., Kim I., Ramesh S., Zammarano M. (2025). *The Character of Burning Residential and Office Items*. NIST TN 2303. https://doi.org/10.6028/NIST.TN.2303 (PDF: https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.2303.pdf). **[READ]**, via the pre-existing extraction in `scratchpad/dl/tn.txt`; not re-downloaded.
2. Quintiere J.G., Harkleroad M. (1984). *New Concepts for Measuring Flame Spread Properties*. NBSIR 84-2943. https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nbsir84-2943.pdf. **[READ]**: text pp. 1–22; Table 2 from page images (PDF pp. 42–43). Local copy at `scratchpad/agentA/qh84/`.
3. Lawson J.R., Walton W.D., Twilley W.H. (1983). *Fire Performance of Furnishings as Measured in the NBS Furniture Calorimeter, Part I*. NBSIR 83-2787. **[READ]**, from `scratchpad/dl/nbs.txt`, §7.2.
4. Babrauskas V., Krasny J. (1985). *Fire Behavior of Upholstered Furniture*. NBS Monograph 173. https://nvlpubs.nist.gov/nistpubs/Legacy/MONO/nbsmonograph173.pdf. **[READ]**: pp. 19–21, 35. Lee & Wiltshire, Mizuno and the Krasny mock-up data are **[SECONDARY]** through this Monograph.
5. Babrauskas V. (1981). *Will the Second Item Ignite?* NBSIR 81-2271. https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nbsir81-2271.pdf. **[READ]**.
6. Emberley R. et al. (2017). Description of small and large-scale cross laminated timber fire tests. *Fire Safety Journal* 91:327–335. Accepted manuscript: https://www.pure.ed.ac.uk/ws/files/34513318/Submitted_pdf_.pdf. **[READ]**.
7. Bartlett A.I., Hadden R.M., Hidalgo J.P. et al. (2017). Auto-extinction of engineered timber: application to compartment fires with exposed timber surfaces. *Fire Safety Journal* 91:407–413. https://www.research.ed.ac.uk/en/publications/auto-extinction-of-engineered-timber-application-to-compartment-f/. **[ABSTRACT]**; the 3.5 g/m²s and 31 kW/m² values are **[SECONDARY]** (search snippets).
8. Bartlett A.I., Hadden R.M., Bisby L.A. (2019). A review of factors affecting the burning behaviour of wood for application to tall timber construction. *Fire Technology* 55:1–49. https://link.springer.com/10.1007/s10694-018-0787-y. **[SECONDARY]**: full text blocked (403); 2.5–5 g/m²s from a snippet.
9. Babrauskas V. (2005). *Ignition of Wood and Truck Insurance v. MagneTek* (CCAI presentation). https://www.cfitrainer.net/programs/35a84de0-e505-4899-be34-f31de9d9d570/document/2005_CCAI_Wood_ignition.pdf. **[READ]**. Underlying review: Babrauskas V. (2002), Ignition of wood: a review of the state of the art, *J. Fire Prot. Eng.* 12:163–189. **[ABSTRACT]**.
10. Quintiere J.G. (1992). *A Semi-Quantitative Model for the Burning Rate of Solid Materials*. NISTIR 4840. https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir4840.pdf. **[READ]**: abstract, §3–4, Table 1.
11. North G., Karlsson B., Rosberg D., Van Hees P. (2001). *Simple Analytical and Numerical Techniques for Modelling Flame Spread on Solids*. Lund LUTVDG/TVBB-7014. https://lup.lub.lu.se/search/files/5664009/1266399. **[READ]**: Ch. 2, Appendix A.
12. Wade C. et al. (2016). *B-RISK 2016 User Guide and Technical Manual*. BRANZ SR364. https://d39d3mj7qio96p.cloudfront.net/media/documents/SR364_B-RISK_2016_user_guide_and_technical_manual.pdf. **[READ]**: §4.3.2, §11.2–11.10. (The BRANZFIRE technical reference, SR92: https://www.branz.co.nz/documents/583/SR92_BRANZFIRE_technical_reference_guide_revised_2004.pdf, not read.)
13. McGrattan K. et al. *FDS User's Guide*, 6th ed., FDS 6.11.1. https://github.com/firemodels/fds/releases/download/FDS-6.11.1/FDS_User_Guide.pdf. **[READ]**: §9.2.1–9.2.4.
14. Peacock R.D., Reneke P.A., Forney G.P. *CFAST 7 User's Guide*, NIST TN 1889v2. https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.1889v2.pdf. **[READ]**: §7.
15. Prasad K. et al. (2009). Numerical simulation of fire spread on polyurethane foam slabs. Fire and Materials 2009 conf. https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=901154. **[READ]**.
16. Wilkens Flecknoe-Brown K., van Hees P. (2021). Experimental investigation into the influence of ignition location on flame spread and heat release rates of polyurethane foam slabs. *Fire and Materials* 45:81–96. https://doi.org/10.1002/fam.2921, https://lup.lub.lu.se/search/publication/fb624dc5-dbc6-4064-8c0b-cdf6f809f044. **[ABSTRACT / SECONDARY]**: numbers from search snippets only.
17. Tran H.C., Janssens M.L. (1991). Wall and corner fire tests on selected wood products. *J. Fire Sciences* 9:106–124. https://research.fs.usda.gov/download/treesearch/5955.pdf. **[READ]**.
18. Quintiere J.G., Harkleroad M., Hasemi Y. (1986). Wall flames and implications for upward flame spread. *Combust. Sci. Technol.* 48:191–222. https://nist.gov/publications/wall-flames-and-implications-upward-flame-spread. **[ABSTRACT]**.
19. 16 CFR §1610.4 and §1610.5 (Flammability of Clothing Textiles). https://www.law.cornell.edu/cfr/text/16/1610.4, https://www.law.cornell.edu/cfr/text/16/1610.5. **[READ]**.

**Not obtained:**
- SFPE Handbook surface flame-spread chapter.
- Drysdale, *An Introduction to Fire Dynamics*.
- Deepak & Drysdale (1983).
- Spearpoint & Quintiere (2000, Combust. Flame 123:308–325): abstract only. I have no numbers from it.
- de Ris (1969) and Sibulkin & Kim: only as quoted in NBSIR 84-2943.
