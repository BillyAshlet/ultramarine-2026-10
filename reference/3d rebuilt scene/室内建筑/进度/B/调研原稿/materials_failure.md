# Material failure in a house fire: evidence for object states

Research for the NIBS Duplex whole-house fire engine. Compiled 2026-11-10.

**How to read the "Read?" column**
- **Original**: I downloaded the full text (PDF) and read the cited passage or table myself.
- **Abstract**: only the abstract or an index record was available.
- **Secondary**: the number comes from a review or other document that quotes the original. The secondary document is named.
- **Search summary**: the number came only from a search-engine summary of a page I could not open. Treat it as weak and verify before relying on it.

Unless a row says otherwise, "standard fire" means furnace exposure to ISO 834, ASTM E119 or ULC-S101. That heating is harsher than a growing room fire and roughly comparable to a fully developed post-flashover compartment.

---

## 1. Wood and wood products (doors, cabinets, coffee tables, studs and joists)

| What happens | Threshold / number | Source | Read? |
|---|---|---|---|
| Pyrolysis begins: wood starts producing combustible gas and losing mass | "starting from about 250 °C" | Frangi, A. (2012), *Fire resistance assessment of timber structures*, JRC Eurocodes workshop, Brussels, slide 9 | Original (slides) |
| Char front (char line) used for design | **300 °C isotherm**. Above this temperature wood is assumed to carry no stress. | Cachim, P.B. & Franssen, J.-M. (2009), *Fire & Materials* 33:129–143, §1–2, describing EN 1995-1-2 | Original (author postprint) |
| Charring rate, softwood (solid or glulam, ρk ≥ 290 kg/m³) | β0 = **0.65 mm/min** (one-dimensional); βn = 0.7 mm/min (glulam) or 0.8 mm/min (solid), notional | EN 1995-1-2 Table 3.1, as reproduced in Cachim & Franssen 2009 Table I | Secondary (I did not read the standard itself) |
| Charring rate, hardwood ρk ≥ 450 kg/m³ | β0 = **0.50 mm/min**, βn = 0.55 mm/min | Same | Secondary |
| Measured example | spruce: β ≈ 0.7 mm/min; 50 mm charred in 63 min, which gives 0.8 mm/min | Frangi 2012, slides 9–10 | Original (slides) |
| Charring rate, panels (≥ 20 mm thick, ρk = 450 kg/m³) | wood panelling **0.9 mm/min**; plywood **1.0 mm/min** | EN 1995-1-2 Table 3.1, as reproduced in Yasir et al. (2023), WCTE 2023, Table 1 | Secondary |
| Charring rate, other wood-based panels (particleboard EN 309/312, OSB, fibreboard) | β0 = 0.9 · kρ · kh, where kρ = √(450/ρk) and kh = √(20/hp) for hp < 20 mm (kh = 1 at ≥ 20 mm). Example at ρ = 600 kg/m³: 12 mm gives 1.01 mm/min, 15 mm 0.90, 18 mm 0.82, ≥ 20 mm 0.78 mm/min | EGGER Technical leaflet TLBP451 rev. 03, citing EN 1995-1-2 §3.4.2(9) | Original (manufacturer leaflet that quotes the standard) |
| Time until a wood-based panel used as cladding "fails" (burns through) | t_f = hp/β0 − 4 min (t_ch = t_f) | EGGER leaflet TLBP451, citing EN 1995-1-2 | Original (leaflet) |
| What is left: density of the wood/char relative to dry wood, by temperature | 300 °C: **0.76**; 350 °C: 0.52; 400 °C: **0.38**; 500 °C: 0.33; 600 °C: **0.28**; 800 °C: **0.26**; 1200 °C: **0.00** (fully consumed) | EN 1995-1-2 Annex B, as reproduced in Cachim & Franssen 2009 Table II | Secondary |
| Solid-core wood flush doors (5 constructions, NWMA IS-69) | **30 min** fire resistance in ASTM E152-66. The weak points were the lock set, the upper edge and the unsupported corners. A particleboard drop-in core door **burned through near the lock set** in its first test. | Eickner, H.W. (1973), "Fire resistance of solid-core wood flush doors", *Forest Products Journal* 23(4):38–43 | Abstract |
| Solid wood flush doors (FPL) | "Most of the present solid-core doors … can pass the standard fire exposure test for … 20 minutes" | An FPL-era abstract on 20-minute door ratings. Which paper it is was not confirmed. A related FPL test series is Miniutti, V.P. (1958), *Forest Products Journal* 8(4):141–144 (index record only, no numbers). | Search summary |
| Historic panel doors (British Fire Prevention Committee, 1899; 900–1100 °C) | **Standard pine panelled doors: 19–20 min to burn-through or collapse.** A 5 cm solid teak door lasted 60 min. | Babrauskas, V. (1976), *Fire Endurance in Buildings*, PhD thesis, UC Berkeley, report UCB FRG 76-16, §3.1.4 | Original thesis (secondary to the BFPC tests) |
| Hollow-core (honeycomb) interior doors | **No measured burn-through time found.** Hollow-core doors cannot meet NFPA 252 for any rating (the minimum rating is 20 min) and "will burn through" before then. | Fire Engineering, "Construction Concerns: Fire Resistance of Doors" (trade article) | Search summary |
| Hollow-core door: **our own estimate, not a test result** | Skin about 3 mm hardboard at ~850 kg/m³ gives β0 ≈ 0.9·√(450/850)·√(20/3) ≈ 1.7 mm/min, so one skin chars through in about **2 min** of standard-fire exposure. The EN formula gives t_f < 0, meaning the door provides essentially no protection time. Both skins plus edge stiles therefore suggest a burn-through time of a few minutes, not tens. | Calculated with the EGGER/EN 1995-1-2 formula above. The skin thickness and density are assumptions. | Derived |

## 2. Polyurethane foam and fabrics (sofas, beds)

| What happens | Threshold / number | Source | Read? |
|---|---|---|---|
| Flexible PU foam pyrolysis onset (5 % mass loss, N₂) | T5% = **234–256 °C** (unretarded foam 256 °C) | Günther, Levchik & Schartel (2020), "Bubbles and collapses: fire phenomena of flame-retarded flexible polyurethane foams", *Polym. Adv. Technol.*, DOI 10.1002/pat.4939, Table 3 | Original |
| Two-step decomposition | Step 1 (urethane bonds break, TDI volatilises, ~30–35 wt %) peaks at **274–289 °C**. Step 2 (polyol) peaks at **≈ 377 °C**. | Same, §3.2 and Table 3 | Original |
| "Melting" and collapse | The foam does not truly melt (it is cross-linked). It **collapses into a viscous liquid of pyrolysis products**, which then burns as a **pool fire**. Inside a burning sample the pyrolysis zone is roughly **270–330 °C**. | Same, §3.3–3.4 and Fig. 5 | Original |
| Mass lost during the collapse stage (cone calorimeter) | TML1 = **35 wt %** for unretarded foam (39 % with flame retardant). The rest burns in the pool-fire stage. | Same, §3.4 | Original |
| Residue after burning | **0.0 wt %** in the cone at 20 and 50 kW/m² (max 0.9 % with flame retardant). TG residue under N₂ was 1.8–4.3 wt %. | Same, Tables 3, 6 and 7 | Original |
| Ignition / heat release (foam alone, 30–32 kg/m³) | Ignition at 20 kW/m² after 8–10 s, PHRR 375 kW/m². At 50 kW/m²: ignition 2–3 s, PHRR ≈ 900 kW/m², THR ≈ 41 MJ/m², EHC ≈ 26 kJ/g | Same, Tables 6–7 | Original |
| Cover fabrics | NIST full-scale couches: thermoplastic polyester-covered and cotton-blend couches reached flashover at about 6–7 min. A woven-glass barrier delayed flashover to ~21 min. Flowing liquid pyrolysate under the couch drove the growth. | NIST barrier-fabric publications (TN 1495 / NISTIR 5653 lineage) | Search summary only. Fabric melt and char temperatures **not found** in a primary source. |

## 3. Glass (windows)

| What happens | Threshold / number | Source | Read? |
|---|---|---|---|
| Mechanism | The shaded edge stays cool while the centre heats. **Tensile stress at the edge starts a crack** that runs across the pane. | Pagni, P.J. & Joshi, A.A. (1991), "Glass Breaking in Fires", *Fire Safety Science* 3:791–802, §1 | Original |
| Breakage criterion | ΔT = (σb/Eβ)·g, with g ≈ 1. Calculated ΔT across the property sets in their Table 1: **30–75 K, 55–110 K, 70 K, 90–220 K**. "The lower portion of the range is appropriate for typical window installations." Suggested lower-limit σb = 40 MPa. With their Table 1 E and β that works out to ≈ 60 K (my arithmetic). | Pagni & Joshi 1991, Eq. 1, Table 1, p. 802 | Original. The often-quoted **"58 °C"** figure does **not** appear in the text I extracted. It comes from Babrauskas's review. |
| Conventional rule of thumb quoted by Pagni & Joshi | Windows break when the hot layer reaches **530–650 K (≈ 260–375 °C)** | Pagni & Joshi 1991, p. 792 (citing their ref. 8) | Original |
| Keski-Rahkonen edge theory | about **80 °C** difference between the heated glass and the edge to start cracking | Keski-Rahkonen, O. (1988), *Fire & Materials* 12:61–69 | Secondary (Babrauskas review) |
| First crack ≠ fallout | Ordinary float glass first cracks at **≈ 150–200 °C** glass temperature. The crack alone does not change ventilation; a piece has to fall out. | Babrauskas, V., *Glass breakage in fires* (Fire Science & Technology Inc., © 1996–2010; copy filed with U.S. 7th Circuit, read via Wayback archive), p. 1 | Original review |
| Single 6 mm float, room fire: first crack | bulk glass ≈ **110 °C**, about **3 kW/m²** | Shields, Silcock & Flood (2001), *Fire & Materials* 25:123–152 | Secondary (Babrauskas) |
| Single 4–6 mm, half-scale room with a vertical gradient | Upper-layer gas **323–467 °C** at first crack. Glass ΔT at crack initiation was **125–146 °C**. Fallout in only **1 of 6** tests by ~450 °C gas. | Hassani, Shields & Silcock (1994/5), *J. Applied Fire Sci.* 4:303–323 | Secondary (Babrauskas) |
| Single 6 mm: fallout | Exposed-surface glass **415–486 °C** on average (individual values 278–615 °C). Needed about **35 kW/m²**. Lowest glass temperature at fallout in a follow-on series: 447 °C. | Shields et al. 2001; 2002 (*Fire & Materials* 26:61–75) | Secondary (Babrauskas) |
| Single 3 mm, uniform hot gas (BRI Japan) | Fallout probability is Gaussian with mean **gas 360 °C (SD 50)** and mean **glass 240 °C (SD 50)** | BRI Japan (1997) | Secondary (Babrauskas) |
| Single 3 mm, radiant panel | No significant fallout below **8 kW/m²**. At **9 kW/m²**, 8–24 % of the area fell out in some tests. Mean critical flux for first crack **7.09 kW/m²**, mean ΔT 52 °C. | Harada et al. (2000), *Fire Safety Science* 6:1063–1074 | Secondary (Babrauskas, and Mishra et al. 2024 literature table) |
| Radiant (exterior) exposure, single-strength | Cracking at **4–5 kW/m²**. 16 kW/m² cracked panes but they did not fall out. **Vinyl frames failed at 8–16 kW/m²** before the glass fell out. | Mowrer (1998), NIST-GCR-98-751 | Secondary (Babrauskas) |
| Double glazing, 6 mm panes, room fire | No fallout up to a **750 °C** peak. In 1 of 3 tests, the inner pane fell out at 21 min during decay (500 °C). The outer pane never fell out. | Shields, Silcock & Hassani (1997/98), *J. Applied Fire Sci.* 7:267–286 | Secondary (Babrauskas) |
| Double glazing: through-opening | Both panes fell out at **70–110 kW/m²** (0.85 × 1.9 m window) | Shields, Silcock & Flood (2005), *Fire Technology* 41:37–65 | Secondary (Babrauskas) |
| Double glazing, façade rig (LPC UK) | Needed ≥ **600 °C** sustained for 8–10 min (wood cribs), or failure the instant 600 °C was reached with a furnished room. **Conclusion: double glazing with 6 mm panes fails at ca. 600 °C.** | Loss Prevention Council LPR 11 (1999) | Secondary (Babrauskas) |
| Tempered glass | Shatters completely on first crack, but only at an exposed surface of **290–380 °C** (normally after flashover). Survived 43 kW/m² in one study. | Richardson & Oleszkiewicz (1987); Kim & Lougheed (1990) | Secondary (Babrauskas) |
| Babrauskas's summary guidance | Gas temperature for fallout: **≥ 300 °C** lower bound. **3 mm single: ~360 °C. 4–6 mm single: ~450 °C. Double 6 mm: ~600 °C.** Under exterior radiation: fallout possible from 9 kW/m², probable at ~35 kW/m²; double glazing withstands ~25 kW/m². | Babrauskas review, Conclusions | Original review |
| Recent measurements | ΔT at breakage 30–60 °C; first-crack glass temperature mostly 200–300 °C; breakage flux 10–23 kW/m² (unframed 4–12 mm panes, small scale) | Mishra, Sharma & Kumar (2024), *Front. Therm. Eng.*, DOI 10.3389/fther.2024.1488206 | Search summary of the full text (WebFetch). The abstract and results give inconsistent ranges. |

## 4. Gypsum board (walls and ceilings)

| What happens | Threshold / number | Source | Read? |
|---|---|---|---|
| Composition | Core of CaSO₄·2H₂O (≥ 75 % gypsum) holding **~21 % by weight chemically bound water** | Elewini, Sultan & Hadjisophocleous (2007), Fire & Materials conf., NRC accepted manuscript | Original |
| Calcination (dehydration) | Starts **above 80 °C** (CaSO₄·2H₂O → CaSO₄·½H₂O + 1½H₂O) and is usually **complete at 125 °C**. With further heating, the hemihydrate becomes anhydrous CaSO₄. | Sultan & Roy-Poirier (2007), Interflam, NRC manuscript, §2; Elewini et al. 2007 | Original |
| Why boards fall | Loss of water produces shrinkage and cracking, so the board loses strength. Ceilings fall earlier because gravity pulls the whole board off; wall boards are partly supported on their lower edge. | Sultan (2010), "Comparison of gypsum board fall-off in wall and floor assemblies exposed to furnace heat", Interflam 2010, NRC manuscript | Original |
| **Ceiling (floor assembly) fall-off temperature**, Type X, measured on the back face of the exposed board | single layer, no insulation: **460 ± 20 °C**; single layer with cavity insulation: **680 ± 50 °C**; face layer of 2 layers: 510–680 °C; base layer: 330–620 °C | Sultan 2010, Table 2 (from Sultan & Roy-Poirier 2007; 80 full-scale floor tests) | Original |
| **Wall fall-off temperature**, Type X, back face of the exposed board | single layer: **755–785 °C** (± 20–35); face layer of 2 layers: 780–830 °C; base layer: 625–640 °C. Walls run ~100–150 °C higher than ceilings. | Sultan 2010, Table 1 (41 wall tests) | Original |
| Fall-off times, Type X ceilings, ASTM E119 | Single layer on solid-wood joists: first piece **42 min**, last piece **47 min**. Wood I-joists, single layer: 36 and 43 min (another assembly 33 and 42 min). A second layer adds ~23–35 min. | Elewini et al. 2007, §"Effect of number of layers" | Original |
| **Regular (Type A) board, generic design value** | Start of charring behind the board = failure time: t_ch = t_f = **2.8·hp − 14 min**. **12.5 mm gives 21 min**; 18 mm gives 36 min. Type F (≈ Type X) has no generic failure time and must be tested. | EN 1995-1-2 §3.4.3, as presented in Frangi 2012, slides 33–35 and worked example | Original (slides quoting the standard) |
| Board-alone burner demonstration (vendor) | A loaded Type X panel collapsed at **57 min** under an ~860 °C burner | CGC/USG white paper EWB2605 | Search summary |
| Contribution to the plastic-pipe tests | The exposed gypsum board "**disintegration and collapse**" was step 3 of wall failure. Paper on the unexposed face burned off by 4 min in one test. | Parker (1973) NBSIR 74-449, §4.2 and Appendix log | Original |

## 5. Plastic pipes (PVC/ABS drains, CPVC/PEX supply)

| What happens | Threshold / number | Source | Read? |
|---|---|---|---|
| Heat deflection temperature (ASTM D648, 1.82 MPa) | **PVC 74 °C, ABS 92 °C, CPVC 102 °C**, PP 66 °C, UHMW-PE 77 °C | Blaga, A. (1981), *CBD-220 Thermoplastic Pipe*, NRC Canadian Building Digest, Table II (the digest misprints "182 MPa (264 psi)") | Original |
| Max service temperatures | PVC Type I ~**65 °C** under stress; CPVC up to **100 °C**; PE generally < 50 °C | CBD-220 text | Original |
| Vicat softening point | **Not verified from a primary source.** Values circulating online are ~80–92 °C for PVC. | — | — |
| PVC/ABS DWV inside walls in an E119 fire (NBS full-scale) | **ABS stack completely consumed**; PVC left < **10 %** fragments (2×4 wall test stopped at 55 min). Softening stacks **sag and pull the laterals inward**, breaking the seals and releasing smoke. Some stacks "**melted down into a mass**", charred but not flaming. | Parker, W.J. (1973), NBSIR 74-449, *Fire endurance tests on walls and plumbing chases containing metallic or nonmetallic DWV systems*, §3.6 and §4 | Original |
| Flame-through via the pipe | 2×4 wall: flame-through at the ABS lateral at **42 min**; 181 °C rise on the unexposed face at **48 min (ABS)** and **53 min (PVC)**. Double 2×4 wall with 4-inch stacks: flames out of the ABS lateral at **27 min**, PVC lateral at **58 min**. A 2×6 wall kept its 1 h rating. A PVC chase did not spread fire for 50 min. | NBSIR 74-449, §3.3, §4.2, Conclusions 1, 3, 5 | Original |
| Plastic pipe can self-seal | Laterals passing through the unexposed wall were "**completely sealed off … due to char formation**" inside the pipe | NBSIR 74-449, §3.6.4 | Original |
| Metal pipes conduct heat through walls | A 181 °C rise on the copper lateral outside the wall at **30 min**, galvanised iron at **52 min**. A copper lateral reached **500 °C** without igniting the cotton pad. | NBSIR 74-449, §3.3, §4.2 | Original |
| PEX and CPVC behaviour in real fires | **Not found** in a primary source this pass | — | — |

## 6. Metals, solder joints, gas meter and regulator

| Item | Threshold / number | Source | Read? |
|---|---|---|---|
| 50/50 tin-lead solder (ASTM B32 Sn50) | solidus **183 °C (361 °F)**, liquidus **216 °C (421 °F)** ±1 °F between datasheets | Harris Products / ME Campbell datasheet table | Search summary (PDF did not download) |
| 95/5 tin-antimony (ASTM B32 Sb5), lead-free | solidus **233 °C (452 °F)**, liquidus **240 °C (464 °F)** | Harris Products Group, *Technical Information Sheet 95-5 Tin & Antimony Lead-Free Solder* | Original |
| Soldered-joint strength falls well before melting | Rated working pressure of a ½–1″ soldered joint, from 100 °F to 250 °F (38–121 °C): Sn50 **200 → 85 psi**, Sb5 **1090 → 270 psi**. Copper Development Association guidance: solder joints are for service up to 250 °F (121 °C); brazed joints up to 350 °F (177 °C). | CDA *Copper Tube Handbook* A4015-14/19, Table 14.4a; CDA soldering/brazing web page | Original (table); search summary (web page) |
| Brazed copper joints (BCuP filler) | solidus **1190–1310 °F (643–710 °C)**, liquidus 1230–1495 °F (666–813 °C) | CDA *Copper Tube Handbook*, Table 14.12 | Original |
| Copper tube strength vs temperature | Allowable stress for annealed tube: 6000 psi at 100 °F, **3000 psi at 400 °F (204 °C)** | CDA Handbook, Table 14.3 headers | Original |
| Copper, brass, aluminium, zinc, lead melting points | Cu **1985 °F (1085 °C)**; brass **1700–1850 °F (927–1010 °C)**; Al **1220 °F (660 °C)**; Zn **786 °F (419 °C)**; Pb 622 °F (328 °C); Sn 450 °F (232 °C); steel 2600–2750 °F; cast iron 2150–2300 °F | Univ. of Washington vehicle-fire pattern page, citing Shackelford, *ASM Handbook* Vol. 2, *CRC Materials Science & Engineering Handbook* | Secondary. **NFPA 921's own table was not accessed** (paywalled). |
| Zinc die-cast alloy (Zamak 3 / ZnAl4) | solidification range **381–387 °C** (Zamak 2: 379–390; Zamak 5: 380–386) | Nyrstar, *Technical data sheet ZAMAK* (Overpelt, 2021) | Original |
| Typical residential gas regulator (Itron/Actaris B42), materials | Valve body: **cast iron** (ASTM A126). Diaphragm case: **die-cast aluminium, ASTM B85 SC84A (≈ A380)**. **Valve stem: die-cast zinc.** Diaphragm: **Buna-N (nitrile) on Dacron**. Lower diaphragm plate: Isoplast (a plastic). Vent valve: neoprene. Seal cap: fibreglass-reinforced polyethylene. | Actaris *B42 Performance* bulletin J1G 6-01, "Material Construction" | Original |
| A380 die-cast aluminium | solidus ~538 °C, liquidus ~593 °C (other sources give 540–595 °C) | Belmont Metals / MakeItFrom | Search summary |
| Nitrile (NBR) elastomer | continuous service **−35 to +120 °C** | ERIKS O-ring technical handbook | Search summary |
| Real incidents: fire damages the meter set, and the gas release is *secondary* | Exeter CA, 17 Jan 2020: a structure fire "**melted two meter manifolds** and caused a leaking service valve". Steel service, 20 psi. | CPUC SED Incident Report G 20200117-2986 | Original |
| | Mira Loma CA, 24 Jan 2020: fire "engulfed the entire house. The intense heat damaged SoCalGas' **Meter Set Assembly** and resulted in the release of natural gas". A small leak was later found at the **stopcock valve**. 45 psi. | CPUC SED Incident Report G 20200124-2995 | Original |
| | BC (fireplace/barbecue line): gas regulators "had both **melted away**, and gas was fueling the fire" until the fire department shut the meter | Technical Safety BC incident investigation | Search summary |
| Thermally activated shut-offs (mitigation, Europe) | Trip at **≈ 95 °C ± 5 K** (DIN 3586 devices). Rated to stay sealed **60 min** at 650 °C (EU product sheets) or **925 °C** (FireBag, US). | DIN 3586 product sheets; Assured Automation FireBag datasheet | Search summary |
| **Measured failure temperature or time of a meter/regulator** | **Not found.** A Warren Forensics white paper did oven tests of a regulator, but its numbers are not public on the landing page. | — | — |

## 7. Water on burning furniture (sprinkler suppression)

| What | Number | Source | Read? |
|---|---|---|---|
| Model form | Q(t) = Q(t_act)·exp[−(t − t_act)/τ], often after an **abrupt drop** at activation when exposed burning surfaces are put out | Evans, D.D. (1993), *Sprinkler Fire Suppression Algorithm for HAZARD*, NISTIR 5254, §3 | Original |
| Time constant vs spray density w″ (mm/s) | τ = 2.0×10⁵ (w″/H_c)^−1.85 from wood-crib data (±50 %). For 0.61 m cribs: **τ = 3.0 (w″)^−1.85 s**. At 0.07 mm/s, **τ = 410 s**. | NISTIR 5254, abstract and Eqs. 2–3 | Original |
| Recommended conservative bound for unshielded furnishings | **Q(t) = Q_act·exp[−(t − t_act)/(3.0 w″^−1.85)]** (Eq. 4). Madrzykowski & Vettori's furnishing bound at 0.07 mm/s: **τ = 435 s**. | NISTIR 5254, Eq. 1 and Eq. 4 | Original |
| Same model in CFAST | τ = 3 u_w^−1.8 (printed exponent 1.8), u_w in mm/s. It assumes enough water is applied; it cannot handle a fire that overwhelms the sprinkler; a second sprinkler does not speed suppression. | Peacock et al., CFAST v7 Technical Reference Guide, NIST TN 1889v1, §6.4, Eq. 6.11 | Original |
| Measured τ, furnishings at 0.07 mm/s | **Sofa (vinyl over PU foam), Q_act 280 kW: τ = 9.1 s.** Workstation II 21.3 s; paper cart 21.7 s; executive office 30.4 s; Office II 41.3 s; Office I 230 s; Workstation I (shielded, deep-seated) **713 s** | NISTIR 5254, Table 1 | Original |
| Measured τ, wood cribs | 305 mm crib: 543 s at 0.026 mm/s down to 44 s at 0.081 and 0.133 mm/s. 610 mm crib: 478 s at 0.066 down to 108 s at 0.126 mm/s. | NISTIR 5254, Table 2 | Original |
| τ from Eq. 3 (my arithmetic) | w″ = 0.026 gives 2567 s; 0.05 gives 766 s; 0.07 gives 411 s; 0.10 gives 212 s; 0.133 gives 125 s; 0.20 gives 59 s. Evans notes the power law **over-predicts** at low spray densities. | Computed from NISTIR 5254 Eq. 3 | Derived |
| Practical reading | Surfaces exposed directly to the spray go out fast (small τ). **Shielded or deep-seated fuel, such as under tables, inside cabinets or under the couch, burns on** (large τ). | NISTIR 5254, §3 | Original |

---

## What this means for object states in our engine

Rules of thumb that follow from the evidence above. Each line names the evidence it rests on. Where we had to choose a number, the line says so.

**Wood objects (doors, cabinets, tables, studs)**
- `intact → heated`: surface above ~100 °C (moisture driving off; no source pinned).
- `heated → pyrolysing`: surface **≥ 250 °C** (Frangi).
- Charring: advance a char depth at **β ≈ 0.65 mm/min** for solid softwood and **0.9–1.0 mm/min** for plywood/particleboard ≥ 20 mm. Thin panels char faster, by the factor √(20/hp). This rate applies under standard-fire (post-flashover-like) exposure. Scale it down for cooler exposure: this is our modelling choice, and EN 1995-1-2 does not give a rate for low heat flux.
- `burnt out / failed` when char depth ≥ member thickness. For a separating element (a door), use t_f = hp/β0 − 4 min.
- Remaining mass when charred: ~**26–28 %** of dry mass at 600–800 °C, falling to 0 as char oxidises (EC5 density ratio).
- Doors: **solid-core ≈ 20–30 min** under standard fire (Eickner 1973; BFPC 1899). **Hollow-core: a few minutes.** This is our estimate from the panel formula, not a test. Failure starts at the edges, lock set and top corners, so smoke and flame leak there first.

**Upholstered sofa or bed**
- `pyrolysing` at **≈ 250–290 °C** in the foam. Then `collapsing`: the foam turns into a liquid pool, losing ~**35 %** of its mass during collapse. The pool fire then burns the rest **to ~0 % residue**. Model the collapse as a geometry change (height to a pool on the floor) that spreads fire downward, under and around the object.
- Under a sprinkler: τ ≈ **9 s** for an exposed sofa, against a conservative bound of ~400 s. Pick the value by how shielded the burning surface is.

**Windows**
- `cracked` (no ventilation change) at glass ≈ 150–200 °C, or ΔT edge-to-centre ≈ 60–80 K.
- `failed/open` (vent created). Single pane: hot-gas temperature **~360 °C (3 mm) to ~450 °C (4–6 mm)**, treated as probabilistic (BRI: mean 360, SD 50 °C). Double glazing: **~600 °C** for the inner pane first, and the outer pane may survive. Under radiation: possible from 9 kW/m², likely at ~35 kW/m² (single); double glazing withstands ~25 kW/m². **Vinyl frames can fail first at 8–16 kW/m².**

**Gypsum walls and ceilings**
- `heated/calcining` from **80 °C**, complete by about 125 °C. While calcining, the board soaks up heat and protects the studs and joists behind it.
- `failed / fallen off` when the back face of the board reaches about **460 °C (single-layer ceiling)** or about **760–785 °C (walls)**. These are Type X data. Generic design value for regular 12.5 mm board under standard fire: **21 min**. Once the board falls, the joists and studs behind it start charring at the wood rates above (EC5 doubles the rate right after the board falls; Frangi slides).

**Plastic drains (PVC/ABS)**
- `softening` at **~74 °C (PVC) and ~92 °C (ABS)** heat-deflection temperature. Stacks sag and pull out of their joints, so smoke passes through wall penetrations.
- `burning / consumed`: ABS burns readily. PVC is largely consumed in sustained fire (< 10 % left), and its char can plug the pipe at the wall.

**Copper water pipe**
- Solder joints lose most of their strength by ~120 °C and come apart at **183 °C (old 50/50) or ~233 °C (95/5 lead-free)**. Treat that as `failed` and start a leak. Brazed joints hold until ~640 °C. The copper tube itself melts only at ~1085 °C. A water-filled pipe stays near water temperature while water flows. That is physics reasoning; no source is cited for it.

**Gas meter and regulator**
- Nitrile diaphragm: service limit ~120 °C. Treat ~120–250 °C as the `degraded` band (our choice): seals and diaphragm can leak or the regulator can vent.
- Zinc die-cast parts melt at **~381–387 °C**. The aluminium diaphragm case melts at **~540–595 °C**. The cast-iron body and steel pipe survive. Real reports describe **melted manifolds, leaking service valves and stopcocks, and melted regulators feeding the fire**.
- **No measured failure temperature was found.** Use the melting points as upper bounds and the nitrile limit as a lower bound, and label the thresholds in the engine as assumptions.

**Things we could not pin down**
- A hollow-core door burn-through test.
- The NFPA 921 melting table itself.
- PEX/CPVC fire behaviour.
- Fabric melt and char temperatures.
- Measured meter/regulator failure temperatures.
- Gypsum shrinkage onset temperature (separate from the fall-off temperature).
- Hose-stream (as opposed to sprinkler) suppression.

---

## Sources (URLs)

Read as full text unless marked otherwise.
1. Cachim & Franssen (2009), Fire & Materials 33:129–143. https://orbi.uliege.be/bitstream/2268/4998/1/Comparison%20between%20the%20charring%20rate%20model%20and%20the%20conductive%20model%20of%20Eurocode%205%20-%20Fire%20and%20Materials%20-%202009%20%28OCR%20JMF%29.pdf
2. Frangi, A. (2012), JRC Eurocodes workshop slides. https://eurocodes.jrc.ec.europa.eu/sites/default/files/2022-06/08-FRANGI-EC-FireDesign-WS.pdf
3. Yasir et al. (2023), WCTE 2023 (EN 1995-1-2 Table 3.1 reproduced). https://ucg.ie/media/timberengineeringresearchgroup/WCTE-2023---yasir-Fire.pdf
4. EGGER Technical leaflet TLBP451 (charring rate of OSB/DHF, citing EN 1995-1-2). https://www.egger.com/get_download/f189bad8-0cd1-4e8f-8049-6974c9c725b2/Technical_leaflet_Charring_rate_OSB.pdf?country=AR
5. Eickner (1973), FPJ 23(4). Abstract only. https://forestprod.org/?p=82697 and https://firedoc.nist.gov/article/oncyXYQBWEcjUZEYT28o
6. Miniutti (1958), FPJ 8(4). Index record only. https://firedoc.nist.gov/article/0HcyXYQBWEcjUZEYyMVW
7. Babrauskas (1976), *Fire Endurance in Buildings*, UCB FRG 76-16. https://doctorfire.com/wp-content/uploads/2019/01/Babrauskas-Fire-Endurance-thesis.pdf
8. Fire Engineering, "Construction Concerns: Fire Resistance of Doors". Search summary only. https://www.fireengineering.com/fire-prevention-protection/construction-concerns-for-firefighters-fire-resistance-of-doors/
9. Günther, Levchik & Schartel (2020), Polym. Adv. Technol. https://opus4.kobv.de/opus4-bam/files/51214/20polymadvtechnol.pdf
10. NIST upholstery/barrier work. Search summary only. https://nvlpubs.nist.gov/nistpubs/Legacy/TN/nbstechnicalnote1495.pdf ; https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir5653.pdf
11. Pagni & Joshi (1991), Fire Safety Science 3:791–802. https://publications.iafss.org/publications/fss/3/791
12. Babrauskas, *Glass breakage in fires*. Archived copy: https://web.archive.org/web/20240221054800/https://www.lb7.uscourts.gov/documents/15-3706URL1GlassBreak.pdf
13. Mishra, Sharma & Kumar (2024), Front. Therm. Eng. https://www.frontiersin.org/journals/thermal-engineering/articles/10.3389/fther.2024.1488206/full
14. Sultan (2010), Interflam, wall vs floor fall-off (NRC). https://nrc-publications.canada.ca/eng/view/accepted/?id=b002f1f8-4c8f-4faf-8eb8-a2d6eaec85ec
15. Sultan & Roy-Poirier (2007), Interflam (NRC). https://nrc-publications.canada.ca/eng/view/accepted/?id=f5537c4c-2095-49ab-8065-efa2c117ba21
16. Elewini, Sultan & Hadjisophocleous (2007), Fire & Materials conf. (NRC). https://nrc-publications.canada.ca/eng/view/accepted/?id=57b1204e-283b-4c94-97a2-7d3d4818e37a
17. CGC/USG Type X vs Type C white paper. Search summary only. https://www.usg.com/content/dam/USG_Marketing_Communications/canada/product_promotional_materials/finished_assets/cgc-TypeX-TypeC-white-paper-en-can-EWB2605.pdf
18. Parker (1973), NBSIR 74-449. https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nbsir74-449.pdf
19. Blaga (1981), CBD-220 Thermoplastic Pipe (NRC). https://web.mit.edu/parmstr/Public/NRCan/CanBldgDigests/cbd220_e.html
20. CDA *Copper Tube Handbook* A4015-14/19. https://www.inspectapedia.com/plumbing/Copper-Tube-Handbook-CDA.pdf (publisher page: https://copper.org/applications/plumbing/cth)
21. Harris 95-5 solder technical sheet. https://cdn.shopify.com/s/files/1/2778/4524/files/95-5Spec.pdf
22. Harris/ME Campbell solder table (50/50). Search summary only. https://www.mecampbell.com/media/pdf/JWHARIE00001_18-21.pdf
23. UW vehicle-fire melting temperatures. https://depts.washington.edu/vehfire/fire-pattern/meltingtemps.html
24. Nyrstar ZAMAK technical data sheet (2021). https://www.nyrstar.com/cdn/e335bc04-297c-463d-a3e3-1eed850c4871/technical-data-sheet-zamak-overpelt-2021.pdf
25. Actaris B42 regulator bulletin J1G 6-01. https://lit.stromquist.com/docs/ACTARIS/B-42_PERFORMANCE_J1G_6-01.PDF
26. CPUC incident report G 20200117-2986. https://www.cpuc.ca.gov/-/media/cpuc-website/divisions/safety-and-enforcement-division/dot-incidents/2020/girincidentreport_2986.pdf
27. CPUC incident report G 20200124-2995. https://www.cpuc.ca.gov/-/media/cpuc-website/divisions/safety-and-enforcement-division/dot-incidents/2020/girincidentreport_2995.pdf
28. Technical Safety BC, "Missing seal cap and adjuster plunger released gas to fuel fire". Search summary only. https://www.technicalsafetybc.ca/regulatory-resources/incident-investigations/missing-seal-cap-and-adjuster-plunger-released-gas-to-fuel-fire
29. Warren Forensics regulator heat-exposure white paper. Landing page only; no numbers. https://www.warrenforensics.com/?p=1357
30. DIN 3586 / FireBag thermal shut-off data. Search summary only. https://www.din.de/en/wdc-beuth:din21:65054789 ; https://24hr.supply/content/scheda-tecnica-FIREBAG_06-2021_MCTW008-USA_20210723.pdf
31. A380 aluminium (Belmont Metals / MakeItFrom). Search summary only. https://www.makeitfrom.com/material-properties/A380.0-A380.0-F-SC84C-A13800-Cast-Aluminum
32. ERIKS O-ring handbook (NBR temperature range). Search summary only. https://o-ring.info/en/o-ring/technical%20handbook/06%20-%20eriks%20nv%20-%20o-ring%20technical%20handbook%20-%20basic%20elastomers.pdf
33. Evans (1993), NISTIR 5254. https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir5254.pdf
34. Peacock et al., CFAST v7 Technical Reference Guide, NIST TN 1889v1. https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.1889v1.pdf

Downloaded PDFs and text extracts are in `/private/tmp/claude-501/-Users-billyashlet-Desktop-BillyAshlet/4e54b5f8-5019-4b90-a15d-7b95c35f1f5d/scratchpad/agentC/`.
