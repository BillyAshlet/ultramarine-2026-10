# Figures for 进度/B from tools/combustion-check.mjs's json:
#   python3 tools/combustion-plot.py
# sofa-vs-nist.png: the A102 sofa in the engine against NIST TN 2303 sofa A.
# wood-out.png: the coffee table (and cabinet, if run) lit by the igniter and
# going out after it stops, against the NBSIR 83-2787 bookcase.
import json
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '../../进度/B')
MATERIALS = json.load(open(os.path.join(HERE, '../src/materials.json'), encoding='utf-8'))

for path in ['/System/Library/Fonts/STHeiti Light.ttc', '/System/Library/Fonts/STHeiti Medium.ttc']:
    if os.path.exists(path):
        font_manager.fontManager.addfont(path)
plt.rcParams['font.family'] = ['Heiti TC', 'STHeiti', 'sans-serif']
plt.rcParams['axes.unicode_minus'] = False

BLUE, ORANGE, AQUA = '#2a78d6', '#eb6834', '#1baf7a'
INK, MUTED, GRID = '#222222', '#6b6b6b', '#e6e6e6'


def style(ax):
    for s in ['top', 'right']:
        ax.spines[s].set_visible(False)
    for s in ['left', 'bottom']:
        ax.spines[s].set_color(MUTED)
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def load(name):
    p = os.path.join(OUT, f'combustion-{name}.json')
    return json.load(open(p)) if os.path.exists(p) else None


sofa = load('sofa')
if sofa:
    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=150)
    style(ax)
    t0 = sofa['ignitedAt']
    s = sofa['series']
    ax.plot([(x['t'] - t0) / 60 for x in s], [x['kW'] / 1000 for x in s], color=BLUE, linewidth=2, label='引擎：A102 沙发 e159（被引火源点着）')
    curve = MATERIALS['sofa']['curve']['value']
    ax.plot([t / 60 for t, _ in curve], [kw / 1000 for _, kw in curve], color=ORANGE, linewidth=2, linestyle='--', marker='o', markersize=4,
            label='NIST TN 2303 第 40 次（沙发 A）实测曲线')
    # The three sofa A tests: peak 1.8–2.2 MW at 6.3–6.6 min.
    ax.add_patch(plt.Rectangle((6.3, 1.8), 0.3, 0.4, facecolor=ORANGE, alpha=0.18, edgecolor='none'))
    ax.annotate('沙发 A 三次实验的峰值范围\n1.8–2.2 MW，6.3–6.6 分钟', xy=(6.6, 2.0), xytext=(9, 2.05), fontsize=9, color=INK,
                arrowprops=dict(arrowstyle='-', color=MUTED, linewidth=0.8))
    ax.set_xlabel('点燃后（分钟）', color=INK)
    ax.set_ylabel('热释放（MW）', color=INK)
    ax.set_xlim(0, 32)
    ax.set_ylim(0, 2.5)
    ax.legend(frameon=False, fontsize=9, loc='upper right', bbox_to_anchor=(1, 0.78))
    ax.set_title(f"引擎里烧掉 {sofa['burnedMJ']:.0f} MJ（实验 811–891 MJ），峰值 {sofa['peakKW'] / 1000:.2f} MW 在点燃后 {sofa['peakAfterIgnitionS'] / 60:.1f} 分钟",
                 fontsize=10, color=INK, loc='left')
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'sofa-vs-nist.png'))
    print('sofa-vs-nist.png')

table, cabinet = load('table'), load('cabinet')
if table:
    runs = [(table, BLUE, '茶几 e162')] + ([(cabinet, AQUA, '厨房地柜 e151')] if cabinet else [])
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(8, 5.4), dpi=150, sharex=True)
    for ax in (a1, a2):
        style(ax)
        ax.axvspan(0, 200, color=ORANGE, alpha=0.10, linewidth=0)
    marked = set()
    for run, colour, name in runs:
        s = run['series']
        a1.plot([x['t'] for x in s], [x['kW'] for x in s], color=colour, linewidth=2, label=name)
        a2.plot([x['t'] for x in s], [x['fluxIn'] for x in s], color=colour, linewidth=2, label=name)
        for e in run['events']:
            key = (e['type'], round(e['t']))
            if e['type'] in ('点燃', '熄灭') and key not in marked:
                marked.add(key)
                y = max([x['kW'] for x in s if abs(x['t'] - e['t']) < 1.5] or [0])
                a1.annotate(e['type'], xy=(e['t'], y), xytext=(e['t'] + 8, y + 6), fontsize=9, color=INK,
                            arrowprops=dict(arrowstyle='-', color=MUTED, linewidth=0.8))
    a1.text(5, a1.get_ylim()[1] * 0.92 if a1.get_ylim()[1] > 0 else 1, '引火源 50 kW 烧 200 秒', fontsize=9, color=INK)
    a1.set_ylabel('热释放（kW）', color=INK)
    a1.legend(frameon=False, fontsize=9, loc='upper right')
    a2.axhline(30, color=MUTED, linewidth=1, linestyle=':')
    a2.text(a2.get_xlim()[1] * 0.62, 31.5, '熄灭线 30 kW/m²：低于它 60 秒就灭', fontsize=9, color=INK)
    a2.text(5, 26.5, '两件都在引火源的火焰里：按火焰接触算 30 kW/m²（两条线重合）', fontsize=9, color=INK)
    a2.set_ylabel('从外面受到的热流（kW/m²）', color=INK)
    a2.set_xlabel('模拟时间（秒）', color=INK)
    a1.set_title('木件：引火源一撤，60 秒后熄灭（NBSIR 83-2787 书架：燃烧器停后 60 秒熄灭）', fontsize=10, color=INK, loc='left')
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'wood-out.png'))
    print('wood-out.png')
