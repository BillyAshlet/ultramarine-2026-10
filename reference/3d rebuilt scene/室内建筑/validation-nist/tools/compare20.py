"""Test 20: a mattress burning in bedroom 3 with its door shut.

Usage: python3 tools/compare20.py   (after tools/sweep20.sh and tools/compare.py)
Writes results/fig-door-*.png and results/metrics20.json.

The house started near 29 C in this test, so temperatures are compared as the
rise above the start. Smoke is drawn with the soot yield fitted on the chair
fire (test 25) and with the textbook 0.1, since a mattress is a different fuel.
"""
import csv, json, math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent.parent
RES = HERE / 'results'
plt.rcParams['font.sans-serif'] = ['Heiti SC', 'STHeiti', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['font.size'] = 9.5
END = 900
UNTENABLE_OD = 0.25
ALARM_OD = -math.log10(1 - 0.0328)
fitted = json.load(open(RES / 'metrics.json'))['sootFit']['scale']   # relative to yield 0.1

rows = list(csv.reader(open(HERE / 'nist-data' / 'sdc20.csv')))
h = [c.strip().strip("'").strip() for c in rows[0]]
data = [[float(x) for x in r] for r in rows[1:] if len(r) == len(h)]
data = [d for d in data if 0 <= d[0] <= END]
meas = {n: [d[i] for d in data] for i, n in enumerate(h)}
T = meas['TIME']
runs = {k: json.load(open(RES / f'sdc20-{k}.json')) for k in ['leaky', 'closed', 'open']}
st = runs['leaky']['series']['t']


def rise(series):
    return [x - series[0] for x in series]


def fed_heat(t, temps):
    """ISO TS 13571 convected heat, as TN 1455-1 eq. 5: sum of dt / (5e7 T^-3.4), T in C, dt in min."""
    total = 0.0
    for i in range(1, len(t)):
        total += (t[i] - t[i - 1]) / 60 * temps[i] ** 3.4 / 5e7
        if total >= 0.3:
            return t[i]
    return None


def first(t, y, level):
    return next((a for a, b in zip(t, y) if b >= level), None)


metrics = {}
# Burn room: the report's heat criterion, at 1.5 m above the floor (900 mm below the ceiling).
metrics['burnRoomHeatUntenable'] = {
    'measured': fed_heat(T, meas['TCB34']),
    'report': 210,
    # The model starts at 20 C; shift it to the room's measured start.
    **{k: fed_heat(st, [x + meas['TCB34'][0] - 20 for x in r['series']['bedroom3']['temp'][3]]) for k, r in runs.items()},
}
metrics['burnRoomPeakRise'] = {'measured': round(max(rise(meas['TCB31'])), 1),
                               **{k: round(max(r['series']['bedroom3']['temp'][0]) - 20, 1) for k, r in runs.items()}}
# Outside the room: smoke and heat that got past the door.
out = {}
for station, prefix, label in [('hallway', 'SMH', '二层走廊'), ('bedroom1', 'SMB1', '主卧')]:
    m25 = meas[f'{prefix}1S'] if prefix == 'SMH' else meas['SMB11S']
    m300 = meas[f'{prefix}2S'] if prefix == 'SMH' else meas['SMB12S']
    row = {'measuredPeak25': round(max(m25), 2), 'measuredPeak300': round(max(m300), 2),
           'measuredAlarm': first(T, m25, ALARM_OD), 'measuredUntenable': first(T, m300, UNTENABLE_OD)}
    for k, r in runs.items():
        o25 = [fitted * x for x in r['series'][station]['od'][0]]
        o300 = [fitted * x for x in r['series'][station]['od'][1]]
        row[k] = {'peak25': round(max(o25), 2), 'peak300': round(max(o300), 2),
                  'alarm': first(st, o25, ALARM_OD), 'untenable': first(st, o300, UNTENABLE_OD)}
    out[station] = row
metrics['outside'] = out
metrics['hallwayPeakRise'] = {'measured': round(max(rise(meas['TCH1'])), 1),
                              **{k: round(max(r['series']['hallway']['temp'][0]) - 20, 1) for k, r in runs.items()}}
json.dump(metrics, open(RES / 'metrics20.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(metrics, ensure_ascii=False))

# ---------- figure: inside and outside the shut door ----------
C = {'leaky': '#ea580c', 'closed': '#7c3aed', 'open': '#2563eb'}
L = {'leaky': '模拟：门关着（留门缝）', 'closed': '模拟：门完全封死', 'open': '模拟：门开着（没做过的实验）'}
fig, axes = plt.subplots(1, 4, figsize=(13.5, 3.5))
ax = axes[0]
ax.plot(T, rise(meas['TCB31']), color='#111827', lw=1.4, label='实测')
for k, r in runs.items():
    ax.plot(st, [x - 20 for x in r['series']['bedroom3']['temp'][0]], color=C[k], lw=1.3, ls='--', label=L[k])
ax.set_title('起火的卧室 3：天花板温升', fontsize=10, loc='left'); ax.set_ylabel('温升（°C）')
ax = axes[1]
ax.plot(T, rise(meas['TCH1']), color='#111827', lw=1.4)
for k, r in runs.items():
    ax.plot(st, [x - 20 for x in r['series']['hallway']['temp'][0]], color=C[k], lw=1.3, ls='--')
ax.set_title('门外走廊：天花板温升', fontsize=10, loc='left')
for ax, (station, mcol, title) in zip(axes[2:], [('hallway', 'SMH1S', '门外走廊：天花板下 25 mm 的烟'), ('bedroom1', 'SMB11S', '主卧：天花板下 25 mm 的烟')]):
    ax.plot(T, meas[mcol], color='#111827', lw=1.4)
    for k, r in runs.items():
        ax.plot(st, [fitted * x for x in r['series'][station]['od'][0]], color=C[k], lw=1.3, ls='--')
    ax.axhline(UNTENABLE_OD, color='#b91c1c', lw=0.8, ls=':')
    ax.set_title(title, fontsize=10, loc='left'); ax.set_ylim(0, 2.0)
axes[2].set_ylabel('光学密度（1/m）')
for ax in axes:
    ax.set_xlim(0, END); ax.set_xlabel('点火后时间（秒）'); ax.spines[['top', 'right']].set_visible(False)
fig.legend(*axes[0].get_legend_handles_labels(), loc='lower center', ncol=4, frameon=False, fontsize=9)
fig.subplots_adjust(bottom=0.28, wspace=0.28)
fig.savefig(RES / 'fig-door.png', dpi=170)
plt.close(fig)
