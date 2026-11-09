"""Burning rate of the burning item, from its weighing.

Usage: python3 tools/mass_loss.py   -> results/mass-loss.json

The mass lost only grows, so take its running maximum, then the slope of a
least-squares line over a 30 s window. The report warns the weighing is not
good enough to rebuild the heat release; this is the best the data allow.
"""
import csv, json
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
# Test -> (load cell column, last second of usable data). Tests 25 and 26 were
# suppressed just after these times; in test 20 the fire had died down by then.
TESTS = {'sdc25': ('LoadL', 244), 'sdc26': ('LoadL', 264), 'sdc20': ('LoadB', 900)}

out = {}
for test, (column, end) in TESTS.items():
    rows = list(csv.reader(open(HERE / 'nist-data' / f'{test}.csv')))
    h = [c.strip().strip("'").strip() for c in rows[0]]
    data = [[float(x) for x in r] for r in rows[1:] if len(r) == len(h)]
    t = [d[0] for d in data]
    m = [d[h.index(column)] for d in data]
    before = [m[i] for i in range(len(t)) if -60 <= t[i] <= 0]
    base = sum(before) / len(before)
    run, mono = 0.0, []
    for tt, mm in zip(t, m):
        if -30 <= tt <= end:
            run = max(run, mm - base)
            mono.append((tt, run))
    table = []
    for tc in range(0, end + 1, 2):
        w = [(a, b) for a, b in mono if abs(a - tc) <= 15]
        n = len(w); sx = sum(a for a, _ in w); sy = sum(b for _, b in w)
        sxx = sum(a * a for a, _ in w); sxy = sum(a * b for a, b in w)
        table.append([tc, max(0.0, (n * sxy - sx * sy) / (n * sxx - sx * sx))])
    out[test] = {'end': end, 'mdot': table, 'massLost': mono[-1][1]}
    peak = max(table, key=lambda r: r[1])
    print(test, 'mass lost', round(mono[-1][1], 2), 'kg; peak', round(1000 * peak[1], 1), 'g/s at', peak[0], 's')
json.dump(out, open(HERE / 'results' / 'mass-loss.json', 'w'))
