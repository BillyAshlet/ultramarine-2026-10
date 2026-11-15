# Compare two coupling runs (tools/coupling-run.mjs json), e.g. 20 cm against 40 cm:
#   python3 进度/耦合/compare-40.py <a.json> <b.json> [labelA labelB [figure.png]]
# Prints the ignitions side by side with how each item was lit, the crossings,
# maxima, leak events, pressures, water and ms per step; draws 40cm-compare.png.
# "How it was lit" is read from the row one second before ignition, as 耦合.md
# did: B's flux qIn is the largest of C's radiation (flame + smoke layer), flame
# contact (fixed 30 kW/m²) and hot gas touching the item.
import json
import os
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__))
pa, pb = sys.argv[1], sys.argv[2]
la, lb = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else ('20 cm', '40 cm')
FIG = sys.argv[5] if len(sys.argv) > 5 else '40cm-compare.png'
A = json.load(open(os.path.join(HERE, pa), encoding='utf-8'))
B = json.load(open(os.path.join(HERE, pb), encoding='utf-8'))


def row_at(run, t):
    i = max(0, min(len(run['rows']) - 1, int(round(t)) - 1))
    return run['rows'][i]


def how(run, ig):
    """Which flux lit it, from the row one second before."""
    if ig['flux'] == 30 and ig['t'] < 60:
        return 'flame contact'
    r = row_at(run, ig['t'] - 1)
    it = next((x for x in r['items'] if x['id'] == ig['id']), None)
    if it is None:
        return '?'
    rad = it['flux']
    if abs(it['qIn'] - 30) < 0.05 and rad < 30:
        return f'flame contact (C rad {rad})'
    if it['qIn'] > rad + 0.5:
        return f'hot gas {it["qIn"]} (C rad {rad})'
    return f'radiation {rad} (flame {it["flame"]} + layer {it["smoke"]})'


def ign_table(run):
    return [(ig['t'], ig['id'], ig['mat'], how(run, ig)) for ig in run['ignitions']]


print(f'## runs\n{la}: {pa}  cell {A.get("cell", 0.2)}  air {A.get("airCells")}  igniter {A.get("igniterCells")} cells  wall {A["wallS"]} s  steps {A["steps"]}')
print(f'{lb}: {pb}  cell {B.get("cell")}  air {B.get("airCells")}  igniter {B.get("igniterCells")} cells  wall {B["wallS"]} s  steps {B["steps"]}')
print('\n## ms per step')
for k in sorted(set(A['msPerStep']) | set(B['msPerStep'])):
    print(f'{k:12s} {A["msPerStep"].get(k, "-"):>9} {B["msPerStep"].get(k, "-"):>9}')

for lab, run in ((la, A), (lb, B)):
    print(f'\n## ignitions {lab}')
    for t, i, m, h in ign_table(run):
        r = row_at(run, t)
        room = next((x['room'] for x in r['items'] if x['id'] == i), '')
        print(f'{t:7.1f}  {i:5s} {m:13s} {room:18s} {h}')
    ev = [e for e in run['events'] if e['type'] == '熄灭']
    print('out:', [(e['t'], e['objectId'], e['data'].get('why')) for e in ev])

for lab, run in ((la, A), (lb, B)):
    print(f'\n## {lab}: crossed', {k: v for k, v in run['crossed'].items() if v})
    print('max', json.dumps(run['max'], ensure_ascii=False))
    print('flashover events', run['flashover'])
    for e in run['events']:
        if e['type'] not in ('点燃', '熄灭'):
            d = e.get('data') or {}
            print(f'  {e["type"]} {e["t"]:7.1f} {e.get("objectId") or ""} {d.get("route") or d.get("zone") or ""} {d.get("pa") or d.get("jointTempC") or ""}')
    zs = {}
    for r in run['rows']:
        for z in r['zones']:
            if abs(z['pa']) > abs(zs.get(z['rooms'], (0, 0))[0]):
                zs[z['rooms']] = (z['pa'], r['t'])
    print('zone peaks', zs)
    if 'soot' in run['rows'][0] or any('soot' in r for r in run['rows'][-3:]):
        last = run['rows'][-1]['soot']
        first = {}
        for r in run['rows']:
            for code, v in r.get('soot', {}).items():
                if v[1] > 0.01 and code not in first:
                    first[code] = r['t']
        print('soot head-height >0.01 g/m3 first at', first)
        print('soot at end [mean, head]', last)


# --- figure ------------------------------------------------------------------------
for path in ['/System/Library/Fonts/STHeiti Light.ttc', '/System/Library/Fonts/STHeiti Medium.ttc']:
    if os.path.exists(path):
        font_manager.fontManager.addfont(path)
plt.rcParams['font.family'] = ['Heiti TC', 'STHeiti', 'sans-serif']
plt.rcParams['axes.unicode_minus'] = False
CA, CB, MUTED = '#2a78d6', '#eb6834', '#6b6b6b'


def series(run, f):
    ts, vs = [], []
    for r in run['rows']:
        v = f(r)
        if v is not None:
            ts.append(r['t']); vs.append(v)
    return ts, vs


def room(r, code, key):
    x = next((x for x in r['rooms'] if x['room'].startswith(code)), None)
    return x[key] if x else None


panels = [
    ('总热释放 kW', lambda r: r['totalKW'], None),
    ('A102 客厅 地面热流 kW/m²', lambda r: room(r, 'A102', 'floorFlux'), 20),
    ('A102 客厅 上层 °C', lambda r: room(r, 'A102', 'layerC'), 600),
    ('A103 厨房 上层 °C', lambda r: room(r, 'A103', 'layerC'), 600),
    ('最高分区压力 Pa', lambda r: max((abs(z['pa']) for z in r['zones']), default=0), None),
    ('热水弯头最高 °C', lambda r: r['joints'][0]['c'] if r['joints'] else None, None),
]
fig, axes = plt.subplots(len(panels), 1, figsize=(9, 2.1 * len(panels)), sharex=True)
for ax, (title, f, ref) in zip(axes, panels):
    for run, lab, c in ((A, la, CA), (B, lb, CB)):
        ax.plot(*series(run, f), color=c, lw=1.6, label=lab)
    if ref:
        ax.axhline(ref, color=MUTED, lw=0.8, ls='--')
    ax.set_title(title, loc='left', fontsize=10)
    for s in ['top', 'right']:
        ax.spines[s].set_visible(False)
    ax.grid(color='#e6e6e6', lw=0.6)
for run, c in ((A, CA), (B, CB)):
    for ig in run['ignitions']:
        axes[0].axvline(ig['t'], color=c, lw=0.5, alpha=0.4)
axes[0].legend(frameon=False, loc='upper left')
axes[-1].set_xlabel('模拟时间 s（第一格竖线 = 点燃时刻）')
fig.tight_layout()
fig.savefig(os.path.join(HERE, FIG), dpi=130)
print(f'\nwrote {FIG}')
