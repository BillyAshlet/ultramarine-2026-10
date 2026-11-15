# Figure for 进度/耦合 from tools/coupling-run.mjs's json:
#   python3 tools/coupling-plot.py [norule]
# coupling-loops.png: one fire, every loop on one time axis, one panel per
# measure (no shared y-scales), with the numbers each loop is checked against.
import json
import os
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '../../进度/耦合')
mode = sys.argv[1] if len(sys.argv) > 1 else 'norule'
run = json.load(open(os.path.join(OUT, f'coupling-{mode}.json'), encoding='utf-8'))

for path in ['/System/Library/Fonts/STHeiti Light.ttc', '/System/Library/Fonts/STHeiti Medium.ttc']:
    if os.path.exists(path):
        font_manager.fontManager.addfont(path)
plt.rcParams['font.family'] = ['Heiti TC', 'STHeiti', 'sans-serif']
plt.rcParams['axes.unicode_minus'] = False

BLUE, ORANGE, AQUA, YELLOW = '#2a78d6', '#eb6834', '#1baf7a', '#eda100'
INK, MUTED, GRID = '#222222', '#6b6b6b', '#e6e6e6'


def style(ax):
    for s in ['top', 'right']:
        ax.spines[s].set_visible(False)
    for s in ['left', 'bottom']:
        ax.spines[s].set_color(MUTED)
    ax.tick_params(colors=MUTED, labelsize=8)
    ax.grid(axis='y', color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def ref(ax, y, text):
    ax.axhline(y, color=MUTED, linewidth=0.8, linestyle=(0, (4, 3)))
    ax.text(run['rows'][-1]['t'], y, f' {text}', color=MUTED, fontsize=7.5, va='center', ha='left')


rows = run['rows']
t = [r['t'] for r in rows]
room_of = lambda i: i['room'].split(' ')[0]
by_room = {k: [sum(i['kW'] for i in r['items'] if room_of(i) == k) / 1e3 for r in rows] for k in ['A102', 'A103', 'B202']}
layer = {k: [next((x['layerC'] for x in r['rooms'] if x['room'].startswith(k)), 20) for r in rows] for k in ['A102', 'A103']}
floor = [next((x['floorFlux'] for x in r['rooms'] if x['room'].startswith('A102')), 0) for r in rows]
pa = [max((abs(z['pa']) for z in r['zones']), default=0) for r in rows]
joint = [r['joints'][0]['c'] if r['joints'] else 20 for r in rows]
valve = [max((v['c'] for v in r['valves']), default=20) for r in rows]

fig, axes = plt.subplots(5, 1, figsize=(7.2, 10.2), sharex=True, gridspec_kw={'hspace': 0.42})
fig.subplots_adjust(left=0.1, right=0.83, top=0.95, bottom=0.05)

ax = axes[0]
for k, c, lab in [('A102', ORANGE, 'A102 客厅'), ('A103', BLUE, 'A103 厨房'), ('B202', YELLOW, 'B202 楼上卧室（穿楼板的 bug 修好后应为 0）')]:
    ax.plot(t, by_room[k], color=c, linewidth=2, label=lab)
for ig in run['ignitions']:
    ax.plot([ig['t']], [0], marker='|', markersize=9, color=INK)
ax.set_title('① 各房间家具的热释放（MW）；底部竖线 = 每次点燃', fontsize=9.5, color=INK, loc='left')
ax.legend(fontsize=7.5, frameon=False, loc='upper right')

ax = axes[1]
ax.plot(t, layer['A102'], color=ORANGE, linewidth=2, label='A102 客厅')
ax.plot(t, layer['A103'], color=BLUE, linewidth=2, label='A103 厨房')
ref(ax, 600, '600 °C 轰燃判据')
ref(ax, 360, '≈360 °C 单层玻璃破\n（转引，未核）')
ax.set_title('① 上层（房间上 1/3）平均温度（°C）', fontsize=9.5, color=INK, loc='left')
ax.legend(fontsize=7.5, frameon=False, loc='upper left')

ax = axes[2]
ax.plot(t, floor, color=ORANGE, linewidth=2)
ref(ax, 20, '20 kW/m² 轰燃判据')
ax.set_title('① A102 客厅地面热流（kW/m²）', fontsize=9.5, color=INK, loc='left')

ax = axes[3]
ax.plot(t, pa, color=AQUA, linewidth=2)
ref(ax, 3000, '3000 Pa 窗破\n（Kiwa 2021，D 用）')
ref(ax, 300, '≈300 Pa IFV 2020')
ax.set_title('② 各分区里最高的压力（Pa）', fontsize=9.5, color=INK, loc='left')

ax = axes[4]
ax.plot(t, joint, color=BLUE, linewidth=2, label='最热的水管接头')
ax.plot(t, valve, color=YELLOW, linewidth=2, label='最热的燃气阀')
ref(ax, 233, '233 °C 接头开')
ref(ax, 440, '440 °C 燃气阀漏')
ax.set_title('③④ 燃气阀和水管接头的温度（°C）', fontsize=9.5, color=INK, loc='left')
ax.legend(fontsize=7.5, frameon=False, loc='upper left')
ax.set_xlabel('模拟时间（秒）', fontsize=8.5, color=MUTED)

for ax in axes:
    style(ax)
    ax.set_xlim(0, t[-1])
    ax.margins(x=0)
fig.savefig(os.path.join(OUT, 'coupling-loops.png'), dpi=160)
print('wrote coupling-loops.png')
