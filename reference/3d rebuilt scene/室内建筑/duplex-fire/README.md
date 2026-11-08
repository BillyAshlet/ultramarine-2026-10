# Duplex fire, step 1

The whole NIBS Duplex in the smoke solver, with a fire you can move. This is the first step of the chain we want to follow:

> fire → smoke and heat → a circuit fails → the exhaust fan stops → smoke builds up → when each detector goes off

This step covers only the first link: fire, smoke and heat.

## Run it

It reads the converted geometry in `../duplex-overlay/data`, which is not in git: build it first (see `../duplex-overlay/README.md`). Then serve the parent folder, so both are reachable:

```
cd ..   # 室内建筑
python3 -m http.server 5196
```

and open http://localhost:5196/duplex-fire/.

- Drag the flame, or double-click a floor, to move the fire. It restarts from nothing.
- Both shows the whole house see-through; Level 1 / Level 2 cut it just under that storey's ceiling. With both showing, the fire moves only on its own storey: pick a storey to move it to the other.
- Walls sets how see-through walls, floors and doors are (ceilings thin out faster, or two of them stacked into a haze over everything). The sun's shadows fade with it, so a faint wall throws a faint shadow. At 1 the walls are solid and hide the smoke behind them.
- Gas, Electrical, Water and Heating show the MEP file's services in the overlay's colours, only to see where they run; they are not in the simulation. Pipes has its own opacity, apart from the walls'.
- Growth picks the design fire's growth rate.

The look (floorboards, tiles, skirting, low afternoon sun through the windows, soft shadows) is `src/dressing.js`, adapted from fliud3d's. It changes only the drawing. See-through surfaces do not write depth, so smoke behind a wall is drawn over the wall rather than tinted by it.

`node tools/bench.mjs [cell] [seconds] [room] [growth]` runs it headless and prints speed and where the smoke has got to. It needs a `node_modules` with `three` next to it; a symlink to `../../../fliud3d/node_modules` works.

## What is in it

| | From | Notes |
|---|---|---|
| Walls, floors, beams | Duplex Architecture IFC | voxelized at 20 cm with `voxelize.js` from fliud3d |
| Ceilings | Duplex Architecture IFC | a few cm thick, so they are marked by ray pairs, keeping the holes over the stairs |
| Windows | Duplex Architecture IFC | all closed |
| Doors | Duplex Architecture IFC | inside doors open, the four outside doors shut |
| Stairs, railings, furniture | not solid | thinner than a cell, they would plug the stairwell |
| Fire | **assumed** | a t² design fire (slow 2.93, medium 11.72, fast 46.9, ultra-fast 187.6 W/s², the standard values) up to 1 MW, on 0.6 × 0.6 m of floor |
| Burning, real units, turbulence | `windy.js` from wind-plume, unchanged | sealed instead of open: no wind, no open sides |
| Smoke | **assumed** | soot in g/m³, made in proportion to what burns: heat of combustion 25 MJ/kg, soot yield 0.05. Both are placeholders, not looked up; soot yield varies about tenfold between wood and foam |

`fluid3d.js`, `voxelize.js` and `windy.js` are unchanged copies. `smoke-pass.js` is a copy with two changes, listed at its top.

## Checked

- **Grid**: 44 × 32 × 89 cells at 20 cm, 82,355 of them air.
- **The two units are sealed from each other**: flood-filling the air gives one region per unit, each holding all ten of its rooms and nothing of the other's.
- **Speed**: about 36 ms a step under node, 35–52 ms in the browser while drawing (the upper end with see-through walls and shadows). At 0.05 s a step that is 1.0–1.4 times real time.
- **Soot is kept**: after 60 s of a fast fire the house holds 6.74 g, against 6.75 g made.
- **Smoke goes where hot gas goes**: a fast fire in A102 Living Room after 90 s (380 kW), soot in g/m³ by height above each floor:

| Room | 0.3 m | 1.0 m | 1.5 m | 2.0 m | 2.4 m |
|---|---|---|---|---|---|
| A102 Living Room (fire) | 0.047 | 0.044 | 0.068 | 0.318 | 1.036 |
| A103 Kitchen | 0.001 | 0.003 | 0.018 | 0.239 | 0.741 |
| A101 Foyer | 0.005 | 0.012 | 0.014 | 0.070 | 0.301 |
| A105 Stair | 0.008 | 0.025 | 0.028 | 0.065 | 0.197 |
| A201 Hallway (upstairs) | 0.013 | 0.013 | 0.033 | 0.072 | 0.107 |
| A203 Bedroom 2 (upstairs) | 0.001 | 0.002 | 0.011 | 0.030 | 0.072 |

A layer under the ceiling of the fire room, spreading through the open plan and up the stairs. These numbers have not been compared with any experiment.

## Known problems

- **Walls do not absorb heat.** Far from the fire the air stays too hot: the upstairs hallway reaches about 100 K above ambient at 2.4 m after 90 s. Smoke movement is the point of this step; temperatures are not to be read off yet.
- **No oxygen.** The fire keeps growing to 1 MW in a sealed house, where a real one would run short of air.
- **The engine has not been compared with a room fire.** In wind-plume, against a textbook plume, it was within about 10% near the flame tip and 50–70% too hot higher up, on a 0.5 m grid.
- Soot is kept by scaling all of it back to the amount made each step. This keeps the total right but not where it is lost from.

## Next

Step 2: the six smoke detectors (positions from the MEP file) as probes, and the time each one goes off. Their alarm threshold is being looked up separately.
