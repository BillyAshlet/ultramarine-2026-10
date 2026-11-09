"""Compare runs with the NIST measurements.

Usage: python3 tools/compare.py
Reads nist-data/sdc25.csv, sdc26.csv and results/*.json; writes figures and
results/metrics.json.
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

# Station -> column prefix in the NIST files, and smoke meter prefix.
TC = {'livingRoom': 'TCL', 'kitchen': 'TCK', 'den': 'TCD', 'foyer': 'TCF', 'hallway': 'TCH', 'bedroom1': 'TCB1', 'bedroom3': 'TCB3'}
SM = {'den': 'SMD', 'foyer': 'SMF', 'hallway': 'SMH', 'bedroom1': 'SMB1'}
CN = {'livingRoom': '客厅（起火）', 'kitchen': '厨房', 'den': '书房', 'foyer': '门厅', 'hallway': '二层走廊', 'bedroom1': '二层主卧', 'bedroom3': '二层卧室 3'}
END = {'sdc25': 244, 'sdc26': 264}

# Read from TN 1455-1 Appendix A: alarm activation, middle of three sensitivity
# settings (s), and time to untenable smoke, optical density 0.25 1/m (s).
ALARM = {
    'sdc25': {'bedroom1': {'ion': 134, 'photo': 162}, 'den': {'ion': 122, 'photo': 152}, 'hallway': {'ion': 106, 'photo': 112}, 'foyer': {'ion': 68, 'photo': 122}},
    'sdc26': {'bedroom1': {'ion': 146, 'photo': 200}, 'den': {'ion': 132, 'photo': 216}, 'hallway': {'ion': 112, 'photo': 136}, 'foyer': {'ion': 64, 'photo': 102}},
}
UNTENABLE = {'sdc25': {'foyer': 202, 'hallway': 220, 'bedroom1': 250, 'den': 250}, 'sdc26': {'foyer': 236, 'hallway': 250, 'bedroom1': 270, 'den': 268}}
ALARM_OD = -math.log10(1 - 0.0328)   # 3.28 %/m obscuration, as optical density
UNTENABLE_OD = 0.25


def load_nist(test):
    rows = list(csv.reader(open(HERE / 'nist-data' / f'{test}.csv')))
    h = [c.strip().strip("'").strip() for c in rows[0]]
    data = [[float(x) for x in r] for r in rows[1:] if len(r) == len(h)]
    keep = [d for d in data if -10 <= d[0] <= END[test]]
    return {name: [d[i] for d in keep] for i, name in enumerate(h)}


def first_cross(t, y, level):
    for a, b in zip(t, y):
        if b >= level:
            return a
    return None


def run(name):
    p = RES / f'{name}.json'
    return json.load(open(p)) if p.exists() else None


nist = {t: load_nist(t) for t in END}
runs = {n: run(n) for n in ['sdc25-base', 'sdc26-base', 'sdc25-dh15', 'sdc25-dh25', 'sdc25-h5', 'sdc25-h30', 'sdc25-cell24', 'sdc25-cell15']}
sens = [n for n in ['sdc25-dh15', 'sdc25-dh25', 'sdc25-h5', 'sdc25-h30', 'sdc25-cell24', 'sdc25-cell15'] if runs[n]]


def band(station, kind, idx):
    """Lowest and highest of the sensitivity runs, aligned on time."""
    series = [runs[n]['series'][station][kind][idx] for n in sens]
    t = runs[sens[0]]['series']['t'] if sens else []
    n = min(len(s) for s in series) if series else 0
    return t[:n], [min(s[i] for s in series) for i in range(n)], [max(s[i] for s in series) for i in range(n)]


# ---------- temperature near the ceiling ----------
order = ['livingRoom', 'kitchen', 'den', 'foyer', 'hallway', 'bedroom1', 'bedroom3']
fig, axes = plt.subplots(2, 4, figsize=(13, 6), sharex=True)
for ax, st in zip(axes.flat, order):
    for test, col in [('sdc25', '#111827'), ('sdc26', '#9ca3af')]:
        ax.plot(nist[test]['TIME'], nist[test][f'{TC[st]}1'], color=col, lw=1.3, label=f'实测 {test[-2:]}')
    if sens:
        t, lo, hi = band(st, 'temp', 0)
        ax.fill_between(t, lo, hi, color='#fdba74', alpha=0.45, lw=0, label='模拟：敏感性范围')
    for name, col in [('sdc25-base', '#ea580c'), ('sdc26-base', '#2563eb')]:
        if runs[name]:
            ax.plot(runs[name]['series']['t'], runs[name]['series'][st]['temp'][0], color=col, lw=1.4, ls='--', label=f'模拟 {name[3:5]}')
    ax.set_title(CN[st], fontsize=10, loc='left')
    ax.set_xlim(0, 270)
    ax.spines[['top', 'right']].set_visible(False)
axes.flat[-1].axis('off')
h, l = axes.flat[0].get_legend_handles_labels()
axes.flat[-1].legend(h, l, loc='center', frameon=False, fontsize=9.5)
for ax in axes[:, 0]: ax.set_ylabel('天花板下 25 mm 温度（°C）')
for ax in axes[1]: ax.set_xlabel('点火后时间（秒）')
fig.tight_layout()
fig.savefig(RES / 'fig-temperature.png', dpi=170)
plt.close(fig)

# ---------- smoke ----------
fig, axes = plt.subplots(1, 4, figsize=(13, 3.4), sharey=True)
for ax, st in zip(axes, ['foyer', 'den', 'hallway', 'bedroom1']):
    for test, col in [('sdc25', '#111827'), ('sdc26', '#9ca3af')]:
        ax.plot(nist[test]['TIME'], nist[test][f'{SM[st]}2S'], color=col, lw=1.3, label=f'实测 {test[-2:]}')
    if sens:
        t, lo, hi = band(st, 'od', 1)
        ax.fill_between(t, lo, hi, color='#fdba74', alpha=0.45, lw=0, label='模拟：敏感性范围')
    for name, col in [('sdc25-base', '#ea580c'), ('sdc26-base', '#2563eb')]:
        if runs[name]:
            ax.plot(runs[name]['series']['t'], runs[name]['series'][st]['od'][1], color=col, lw=1.4, ls='--', label=f'模拟 {name[3:5]}')
    ax.axhline(UNTENABLE_OD, color='#b91c1c', lw=0.8, ls=':')
    ax.set_title(CN[st], fontsize=10, loc='left')
    ax.set_xlim(0, 270); ax.set_ylim(0, 1.6)
    ax.set_xlabel('点火后时间（秒）')
    ax.spines[['top', 'right']].set_visible(False)
axes[0].set_ylabel('天花板下 300 mm 光学密度（1/m）')
axes[0].text(5, UNTENABLE_OD + 0.04, '不可承受 0.25', color='#b91c1c', fontsize=8.5)
axes[-1].legend(fontsize=8.5, frameon=False, loc='upper left')
fig.tight_layout()
fig.savefig(RES / 'fig-smoke.png', dpi=170)
plt.close(fig)

# ---------- times and ratios ----------
metrics = {'alarm': {}, 'untenable': {}, 'peakRise': {}}
for test in END:
    r = runs[f'{test}-base']
    if not r:
        continue
    t = r['series']['t']
    for st in ['foyer', 'den', 'hallway', 'bedroom1']:
        sim_alarm = first_cross(t, r['series'][st]['od'][0], ALARM_OD)
        sim_unt = first_cross(t, r['series'][st]['od'][1], UNTENABLE_OD)
        meas_unt = first_cross(nist[test]['TIME'], nist[test][f'{SM[st]}2S'], UNTENABLE_OD)
        metrics['alarm'].setdefault(test, {})[st] = {'sim': sim_alarm, **ALARM[test][st]}
        metrics['untenable'].setdefault(test, {})[st] = {'sim': sim_unt, 'report': UNTENABLE[test][st], 'fromData': meas_unt}
    # Peak temperature rise, simulation over measurement, at every thermocouple
    # outside the burn room (as the FDS validation guide reports it).
    ratios = {}
    for st in order[1:]:
        for d in range(5):
            m = nist[test][f'{TC[st]}{d + 1}']
            meas = max(m) - m[0]
            sim = max(r['series'][st]['temp'][d]) - 20
            if meas > 5:
                ratios[f'{st}-{d + 1}'] = round(sim / meas, 2)
    metrics['peakRise'][test] = ratios

for test, ratios in list(metrics['peakRise'].items()):
    vals = list(ratios.values())
    if vals:
        mean_log = sum(math.log(v) for v in vals) / len(vals)
        sd_log = (sum((math.log(v) - mean_log) ** 2 for v in vals) / max(1, len(vals) - 1)) ** 0.5
        metrics['peakRise'][test + '-summary'] = {'n': len(vals), 'bias': round(math.exp(mean_log), 2), 'sigmaLog': round(sd_log, 2)}

# Repeatability of the experiment itself: test 26 against test 25.
rep = {}
for st in order[1:]:
    for d in range(5):
        a = nist['sdc25'][f'{TC[st]}{d + 1}']; b = nist['sdc26'][f'{TC[st]}{d + 1}']
        ra, rb = max(a) - a[0], max(b) - b[0]
        if ra > 5: rep[f'{st}-{d + 1}'] = round(rb / ra, 2)
vals = list(rep.values())
ml = sum(math.log(v) for v in vals) / len(vals)
metrics['repeatability'] = {'n': len(vals), 'ratio26over25': round(math.exp(ml), 2), 'sigmaLog': round((sum((math.log(v) - ml) ** 2 for v in vals) / (len(vals) - 1)) ** 0.5, 2)}

# Smoke sensitivity: the same base run with other soot yields only scales.
json.dump(metrics, open(RES / 'metrics.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(metrics, ensure_ascii=False, indent=1))

# ---------- arrival of heat: when each thermocouple first rises 10 K ----------
arrival = {}
for test in END:
    r = runs[f'{test}-base']
    t = r['series']['t']
    for st in order[1:]:
        m = nist[test][f'{TC[st]}1']
        meas = first_cross(nist[test]['TIME'], [x - m[0] for x in m], 10)
        sim = first_cross(t, [x - 20 for x in r['series'][st]['temp'][0]], 10)
        arrival.setdefault(test, {})[st] = {'sim': sim, 'meas': meas}
metrics['heatArrival'] = arrival

# ---------- soot yield: fit on test 25 only, then predict test 26 ----------
# Smoke does not change the flow, so another yield just scales optical density.
def crossings(test, scale):
    r = runs[f'{test}-base']; t = r['series']['t']
    out = {}
    for st in ['foyer', 'den', 'hallway', 'bedroom1']:
        out[st] = {'alarm': first_cross(t, [scale * x for x in r['series'][st]['od'][0]], ALARM_OD),
                   'untenable': first_cross(t, [scale * x for x in r['series'][st]['od'][1]], UNTENABLE_OD)}
    return out

def error(test, scale):
    c = crossings(test, scale); errs = []
    for st, v in c.items():
        want = UNTENABLE[test][st]
        got = v['untenable'] if v['untenable'] is not None else END[test] + 30
        errs.append((got - want) ** 2)
    return (sum(errs) / len(errs)) ** 0.5

scales = [round(0.05 + 0.01 * i, 2) for i in range(96)]
best = min(scales, key=lambda s: error('sdc25', s))
metrics['sootFit'] = {
    'fittedOn': 'sdc25', 'scale': best, 'sootYield': round(0.1 * best, 4),
    'rmsSeconds': {'sdc25-fit': round(error('sdc25', best), 1), 'sdc26-predicted': round(error('sdc26', best), 1),
                   'sdc25-assumed0.1': round(error('sdc25', 1.0), 1), 'sdc26-assumed0.1': round(error('sdc26', 1.0), 1)},
    'sdc25': crossings('sdc25', best), 'sdc26': crossings('sdc26', best),
}

# ---------- figure: the times that matter ----------
fig, axes = plt.subplots(1, 2, figsize=(12.5, 3.6), sharey=True)
stations = ['foyer', 'hallway', 'den', 'bedroom1']
for ax, test in zip(axes, END):
    for n, st in enumerate(stations):
        y = len(stations) - 1 - n
        al = ALARM[test][st]
        ax.plot([al['ion'], al['photo']], [y + 0.15] * 2, color='#9ca3af', lw=5, solid_capstyle='round')
        ax.scatter([UNTENABLE[test][st]], [y + 0.15], marker='s', s=55, color='#111827', zorder=3)
        fitted = metrics['sootFit'][test][st]
        raw = crossings(test, 1.0)[st]
        ax.scatter([raw['untenable']], [y - 0.15], marker='s', s=45, facecolors='none', edgecolors='#ea580c', zorder=3)
        ax.scatter([fitted['alarm']], [y - 0.15], marker='o', s=45, color='#2563eb', zorder=3)
        if fitted['untenable'] is not None:
            ax.scatter([fitted['untenable']], [y - 0.15], marker='s', s=55, color='#2563eb', zorder=3)
    ax.set_yticks(range(len(stations))); ax.set_yticklabels([CN[s] for s in reversed(stations)])
    ax.set_xlim(0, 300); ax.set_xlabel('点火后时间（秒）')
    ax.set_title('第 25 场：用来标定烟灰产率' if test == 'sdc25' else '第 26 场：事先预测，没有再调', fontsize=10, loc='left')
    ax.spines[['top', 'right']].set_visible(False); ax.grid(axis='x', color='#eee')
handles = [plt.Line2D([], [], color='#9ca3af', lw=5, label='实测报警（离子式到光电式）'),
           plt.Line2D([], [], marker='s', ls='', color='#111827', ms=8, label='实测不可承受（能见度）'),
           plt.Line2D([], [], marker='o', ls='', color='#2563eb', ms=7, label='模拟报警（3.28 %/m）'),
           plt.Line2D([], [], marker='s', ls='', color='#2563eb', ms=8, label='模拟不可承受（标定后）'),
           plt.Line2D([], [], marker='s', ls='', mfc='none', mec='#ea580c', ms=8, label='模拟不可承受（假设产率 0.1）')]
fig.legend(handles=handles, loc='lower center', ncol=5, frameon=False, fontsize=8.8)
fig.subplots_adjust(bottom=0.27, wspace=0.08)
fig.savefig(RES / 'fig-times.png', dpi=170)
plt.close(fig)
json.dump(metrics, open(RES / 'metrics.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: metrics[k] for k in ['heatArrival', 'sootFit']}, ensure_ascii=False))

# ---------- smoke again, with the yield fitted on test 25 ----------
k = metrics['sootFit']['scale']
fig, axes = plt.subplots(1, 4, figsize=(13, 3.4), sharey=True)
for ax, st in zip(axes, ['foyer', 'den', 'hallway', 'bedroom1']):
    for test, col in [('sdc25', '#111827'), ('sdc26', '#9ca3af')]:
        ax.plot(nist[test]['TIME'], nist[test][f'{SM[st]}2S'], color=col, lw=1.3, label=f'实测 {test[-2:]}')
    for name, col, lab in [('sdc25-base', '#ea580c', '模拟 25（标定用）'), ('sdc26-base', '#2563eb', '模拟 26（预测）')]:
        ax.plot(runs[name]['series']['t'], [k * x for x in runs[name]['series'][st]['od'][1]], color=col, lw=1.4, ls='--', label=lab)
    ax.axhline(UNTENABLE_OD, color='#b91c1c', lw=0.8, ls=':')
    ax.set_title(CN[st], fontsize=10, loc='left')
    ax.set_xlim(0, 270); ax.set_ylim(0, 1.3)
    ax.set_xlabel('点火后时间（秒）')
    ax.spines[['top', 'right']].set_visible(False)
axes[0].set_ylabel('天花板下 300 mm 光学密度（1/m）')
axes[0].text(5, UNTENABLE_OD + 0.04, '不可承受 0.25', color='#b91c1c', fontsize=8.5)
axes[-1].legend(fontsize=8.5, frameon=False, loc='upper left')
fig.tight_layout()
fig.savefig(RES / 'fig-smoke-fitted.png', dpi=170)
plt.close(fig)
