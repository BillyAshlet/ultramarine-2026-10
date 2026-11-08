# Duplex overlay

Can one public building be overlaid with its own electrical, gas and water drawings? This checks it on the NIBS Duplex Apartment, a two-unit house first used at the 2009 COBie Challenge.

## Run it

```
python3 -m http.server 5194
```

then open http://localhost:5194. The `ifc/` and `data/` folders are not in git (see Licence below), so on a fresh copy first download the IFCs and rebuild the layers:

```
mkdir -p ifc && cd ifc
for f in Ifc2x3_Duplex_Architecture Ifc2s3_Duplex_Electrical Ifc2x3_Duplex_Mechanical Ifc2x3_Duplex_Plumbing Ifc2x3_Duplex_MEP; do
  curl -sSLO "https://raw.githubusercontent.com/youshengCode/IfcSampleFiles/main/$f.ifc"
done
cd .. && node tools/convert.cjs ../../../fliud3d/node_modules/web-ifc
```

## Which files

| File | Exported | Used |
|---|---|---|
| Architecture | 2011-09-07 | yes |
| MEP (all services in one file) | 2011-09-07 | yes |
| Electrical | 2012-12-18 | no: all 103 items are in MEP at the identical position |
| Mechanical (heating) | 2011-10-24 | no: a later revision, 125 of 344 shared items moved (up to 3.6 m) and 143 are new |
| Plumbing | 2012-12-18 | no: a later revision, 44 of 397 shared items moved (up to 0.27 m) and 101 are new |

Architecture and MEP are one snapshot. Mixing in the later revisions would draw two versions of the same pipe run.

## What lines up

- **Storeys** are the same in every file: Level 2 at 3.1 m and roof at 6.0 m. The raw numbers differ only by unit (metres, feet, millimetres).
- **Rooms**: the MEP file's rooms are within 0.21 m of the architect's rooms.
- **Fixtures sit in the right rooms**: ranges, sinks and fridges in kitchens, toilets, basins, tubs and showers in bathrooms, boilers in the upstairs utility rooms, smoke detectors in bedrooms and foyers, rooftop fans on the roof.
- **Every circuit stays in its own unit**: all items on a Unit A circuit are on the Unit A side, and the same for B.

Not checked: whether pipes clash with walls or each other, apart from the gas pipes below.

## What each layer actually contains

**Gas (real routes, about 11 m for Unit A and 8 m for Unit B).** The pipe comes in from outside below the ground floor, about 0.65 m down in the crawl space, and runs about 4 m under the floor. It then rises 4 m through the wall between the two units to the boiler in the upstairs utility room. The boiler is the only gas appliance. The kitchen ranges are on neither the gas system nor any electrical circuit, so their fuel is unknown.

**Electrical (devices and circuits, no wires).** It has 47 outlets, 14 switches, 14 lights, 6 smoke detectors on a fire alarm panel, and one panelboard per unit. Each item records its panel, circuit number and design load: for example, Unit A circuit 3 has 6 outlets at 180 VA each, 1080 VA in total. There are **no wire routes**, only 18 pieces of conduit. Each panel has a 100 A main, but the ratings of the individual circuit breakers are not given.

**Water (real routes).** Cold, hot, sanitary and storm pipes.

**Heating (real routes).** Hydronic supply from the boilers, and one exhaust fan per unit on the roof.

## Oddities to look at in the viewer

- **The two units interlock.** Downstairs the units are split along the long side, upstairs across it. So each unit's utility room stands over the other unit's kitchen, and each unit's gas riser runs in the wall beside the other unit's kitchen. This comes from the room labels and boxes; it has not been checked against the drawings.
- Wall-mounted items have no room of their own. The viewer says which room they are beside, but the other side of the wall is just as close.

## For linking systems

What this model can and cannot carry:

| Link | Data here | What would still be assumed |
|---|---|---|
| Smoke reaches a detector, alarm sounds | detector positions, alarm panel | detector threshold |
| Exhaust fans move air and smoke | fan positions | flow rate (the later heating file notes that its gas and exhaust flows are approximate) |
| Heat on a wall cuts a circuit | which outlets share a circuit | wire routes, breaker ratings, failure temperature |
| Fire near the gas pipe or boiler | real gas route | whether and how fast it leaks |
| Gas leak meets a spark | gas route and outlet and switch positions | leak rate, ignition chance |

## Licence

The model comes from NIBS / WBDG (Common BIM Files). It was downloaded from the GitHub mirror `youshengCode/IfcSampleFiles`, which states no licence. The original terms have not been checked. Until they are, `ifc/` and `data/` (geometry derived from it) stay out of git, and no images of it should be published.
