# Validation against the NIST two-storey house

Does our smoke solver get heat and smoke arrival right in a real house fire? This runs it on the flaming-chair tests 25 and 26 of NIST's home smoke alarm study (TN 1455-1, Report of Test FR 4017) and compares it with what was measured.

## Run it

```
node tools/run.mjs '{"name":"sdc25-base","test":"sdc25"}'   # about 2 minutes
./tools/sweep.sh                                              # both tests and six sensitivity runs
python3 tools/compare.py                                      # figures and results/metrics.json
```

The NIST files in `nist-data/` came from https://www.nist.gov/el/nist-report-test-fr-4017 (`sdc20csv`, `sdc25csv`, `sdc26csv`, `hookup2storycsv`). In those files the two "above fire" columns are swapped: `TCB3F` is over the living-room chair (930 °C in test 25), and `TCLF` is over the bedroom mattress (706 °C in test 20).

## What goes in

- **The house** (`src/house.js`), read off the report's plan figures 88, 89, 92 and 93 with a ruler, on a 0.2 m grid. The ceiling height (2.4 m) is not in the report and is assumed. Closed doors follow the plans.
- **The fire**, taken from the chair's weighing: a burning rate from the running maximum of the mass lost, as the slope of a 30 s window (`results/mass-loss.json`). Multiplied by an assumed effective heat of combustion of 20 MJ/kg. The report warns that its weighing is not good enough to rebuild the heat release, so this is the largest single uncertainty.
- **The solver** (`src/house-fire.js`): `src/fluid3d.js` unchanged, plus real units and burning as in wind-plume, heat loss to surfaces (h = 15 W/m²K, assumed), and soot. Smagorinsky 0.4 and burnTime 3 s are wind-plume's values, fixed before this comparison.
- **Alarm and untenable criteria**: alarm when obscuration 25 mm under the ceiling passes 3.28 %/m; untenable when optical density 300 mm under the ceiling passes 0.25 1/m, the report's own criterion.

## Results

| | Test 25 | Test 26 |
|---|---|---|
| Heat arrival (10 K rise), sim minus measured, outside the burn room | −22 to +46 s | −4 to +72 s |
| Peak temperature rise, sim over measured (30 thermocouples) | 0.51, σ(ln) 0.90 | 0.50, σ(ln) 0.94 |
| Untenable time, RMS error, soot yield 0.1 assumed | 94 s | 127 s |
| Untenable time, RMS error, soot yield fitted on test 25 (0.012) | 16 s (fitted) | **14 s (predicted)** |

The experiment itself repeats to about 15%: test 26's peak temperature rises are 0.85 of test 25's, σ(ln) 0.15.

- **Timing is roughly right; magnitude is not.** Heat reaches each room within about a minute of when it did in the test. Downstairs it peaks about right, but upstairs it peaks at a third to half of what was measured, and the last 30 s of fast growth is missed.
- **Smoke needs one fitted number.** With a typical soot yield of 0.1, smoke is several times too thick, and becomes untenable one to two minutes early. Fitting a single effective yield on test 25 and then predicting test 26 unchanged gets the untenable times within about 15 s. That number absorbs every smoke error in the model, so it is not a physical yield, and it is only shown to carry over between two runs of the same fire in the same house.
- **Alarm times**, with the fitted yield, fall inside or within 40 s of the measured range between the ionisation and photoelectric alarms at every station.

Sensitivity runs: heat of combustion 15 and 25 MJ/kg, h 5 and 30 W/m²K, grid 0.24 and 0.15 m. They are drawn as the shaded band in `results/fig-temperature.png`. None of them closes the upstairs gap.

## Test 20: the door shut

A twin mattress burned in bedroom 3 with its door shut (`tools/sweep20.sh`, `tools/compare20.py`). Where the mattress lay is not in the report, so it is put along the back wall. The door is run three ways: shut with one cell open at the floor and one at the head as its gaps (`leaky`), shut tight, and open, which was never tested.

| | Measured | Leaky | Shut tight | Open |
|---|---|---|---|---|
| Burn room ceiling rise | 328 °C | 93 °C | 86 °C | 74 °C |
| Burn room untenable (ISO heat FED 0.3) | 210 s | never | never | never |
| Hallway ceiling rise | 11 °C | 30 °C | 0 | 47 °C |
| Hallway untenable (OD 0.25) | never | 212 s | never | 196 s |

- **The burn room is far too cold, whatever the door does.** As a diagnosis only, surface loss h = 5 together with twice the heat release makes the room untenable at 214 s. So the gap lies in the fire size from the weighing, which the report warns about, and in the wall-loss assumption. These settings are not a validation.
- **A door's gaps cannot be drawn on this grid.** Two open cells make 0.08 m², several times a real door's gaps. Shut with those gaps, the door holds smoke back only 16 s longer than an open door. In the test, it kept the hallway tenable for the full hour. Shut tight, nothing leaks at all. The model therefore badly understates what closing a door does. The fix is a gap-flow formula driven by the pressure across the door, as zone models such as CFAST use, not holes in the grid.

## Not done

- A gap-flow model for shut doors.
- No leakage through the shell, no expansion of hot gas, and no warming of the walls.
