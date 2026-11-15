# Figures for 进度/B/真实火焰与画法.md:
#   python3 tools/flame-figures.py
# flame-zones.png: the A102 sofa's flame at its peak, side view, with
#   McCaffrey's three zones, the Heskestad mean height and the ceiling.
# flame-height.png: how tall the sofa's flame is through its burn, against the
#   2.6 m ceiling, with the whole seat burning vs the burning patch growing.
import json
import math
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '../../进度/B')
M = json.load(open(os.path.join(HERE, '../src/materials.json'), encoding='utf-8'))
for path in ['/System/Library/Fonts/STHeiti Light.ttc', '/System/Library/Fonts/STHeiti Medium.ttc']:
    if os.path.exists(path):
        font_manager.fontManager.addfont(path)
plt.rcParams['font.family'] = ['Heiti TC', 'STHeiti', 'sans-serif']
plt.rcParams['axes.unicode_minus'] = False
BLUE, ORANGE, AQUA = '#2a78d6', '#eb6834', '#1baf7a'
INK, MUTED, GRID = '#222222', '#6b6b6b', '#e6e6e6'

# The A102 sofa e159 and the room over it (tools: measured from the grid).
W, DEPTH, H, CEIL = 1.83, 0.66, 0.81, 2.60
D_PLAN = math.sqrt(4 * W * DEPTH / math.pi)
curve = M['sofa']['curve']['value']
PEAK = max(kw for _, kw in curve)


def heskestad(q_kw, d):
    return max(0.0, 0.235 * q_kw ** 0.4 - 1.02 * d)


def style(ax):
    for s in ['top', 'right']:
        ax.spines[s].set_visible(False)
    for s in ['left', 'bottom']:
        ax.spines[s].set_color(MUTED)
    ax.tick_params(colors=MUTED, labelsize=9)


# --- 1. zones at the peak ---------------------------------------------------------
q = PEAK
zc, zi = 0.08 * q ** 0.4, 0.20 * q ** 0.4      # McCaffrey 1979 table 1
L = heskestad(q, D_PLAN)
r_hh, r_yf = L - CEIL, 0.5 * (L - CEIL)         # Heskestad & Hamada; You & Faeth
fig, ax = plt.subplots(figsize=(8, 4.6), dpi=150)
style(ax)
ax.set_aspect('equal')
ax.add_patch(plt.Rectangle((-W / 2, 0), W, H, facecolor='#d9d4cc', edgecolor=MUTED, linewidth=0.8))
ax.text(0, H / 2, '沙发 1.83 m 宽', ha='center', va='center', fontsize=9, color=INK)
ax.add_patch(plt.Rectangle((-W / 2, H), W, zc - H, facecolor=ORANGE, alpha=0.55, edgecolor='none'))
ax.add_patch(plt.Rectangle((-W / 2 * 0.8, zc), W * 0.8, CEIL - zc, facecolor=ORANGE, alpha=0.22, edgecolor='none'))
ax.add_patch(plt.Rectangle((-W / 2 - r_hh, CEIL - 0.18), W + 2 * r_hh, 0.18, facecolor=ORANGE, alpha=0.22, edgecolor='none'))
ax.add_patch(plt.Rectangle((-W / 2 - r_yf, CEIL - 0.12), W + 2 * r_yf, 0.12, facecolor=ORANGE, alpha=0.35, edgecolor='none'))
ax.axhline(CEIL, color=INK, linewidth=1.5)
ax.text(3.15, CEIL + 0.05, '天花板 2.6 m', fontsize=9, color=INK, ha='right', va='bottom')
for y, txt in [(zc, f'连续火焰顶 {zc:.1f} m（0.08·Q^0.4）'), (L, f'Heskestad 平均火焰高 {L:.1f} m（没有天花板时）'),
               (zi, f'间歇火焰顶 {zi:.1f} m（0.20·Q^0.4）')]:
    ax.plot([-1.3, 3.2], [y, y], color=MUTED, linewidth=0.8, linestyle=':')
    ax.text(-1.32, y, txt, fontsize=8.5, color=INK, ha='right', va='center')
ax.text(0, (H + zc) / 2, '连续火焰\n约 850 K 温升', ha='center', va='center', fontsize=8.5, color=INK)
ax.text(0, (zc + CEIL) / 2 - 0.1, '间歇火焰\n一团团往上脱', ha='center', va='center', fontsize=8.5, color=INK)
ax.annotate(f'顶棚下横向火焰 {r_hh:.1f} m\n（Heskestad & Hamada；\nYou & Faeth 约 {r_yf:.1f} m）', xy=(W / 2 + r_hh, CEIL - 0.09), xytext=(2.3, 1.55),
            fontsize=8.5, color=INK, arrowprops=dict(arrowstyle='-', color=MUTED, linewidth=0.8))
ax.set_xlim(-5.2, 3.3)
ax.set_ylim(0, 4.5)
ax.set_xticks([])
ax.set_ylabel('离地高度（m）', color=INK)
ax.set_title(f'沙发烧到峰值 {q / 1000:.2f} MW 时的火焰（侧视，按公式算，不是照片）', fontsize=10, color=INK, loc='left')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'flame-zones.png'))
print('flame-zones.png', dict(zc=round(zc, 2), zi=round(zi, 2), L=round(L, 2), r_hh=round(r_hh, 2), r_yf=round(r_yf, 2), D=round(D_PLAN, 2)))

# --- 2. flame height through the burn ----------------------------------------------
ts, whole, patch = [], [], []
for i in range(len(curve) - 1):
    (t0, q0), (t1, q1) = curve[i], curve[i + 1]
    for s in range(30):
        t = t0 + (t1 - t0) * s / 30
        qq = q0 + (q1 - q0) * s / 30
        ts.append(t / 60)
        whole.append(heskestad(qq, D_PLAN) + 0.0)
        patch.append(heskestad(qq, D_PLAN * math.sqrt(min(1, qq / PEAK))))
fig, ax = plt.subplots(figsize=(8, 3.6), dpi=150)
style(ax)
ax.grid(True, color=GRID, linewidth=0.8)
ax.set_axisbelow(True)
ax.plot(ts, patch, color=ORANGE, linewidth=2, label='着火面积随热释放长大（打算画的）')
ax.plot(ts, whole, color=BLUE, linewidth=2, linestyle='--', label='整张沙发一开始就全在烧（现在算接触用的）')
ax.axhline(CEIL, color=INK, linewidth=1.2)
ax.text(29.5, CEIL + 0.06, '天花板 2.6 m', fontsize=9, color=INK, ha='right')
ax.set_xlabel('点燃后（分钟）', color=INK)
ax.set_ylabel('火焰高（m，从地面起）', color=INK)
ax.set_xlim(0, 30)
ax.set_ylim(0, 4.2)
ax.legend(frameon=False, fontsize=9, loc='upper right')
ax.set_title('沙发火焰有多高：点燃后约 5.3–10.8 分钟碰到天花板', fontsize=10, color=INK, loc='left')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'flame-height.png'))
over = [t for t, h in zip(ts, patch) if h > CEIL]
print('flame-height.png', 'patch over ceiling', (round(min(over), 2), round(max(over), 2)) if over else None)
over = [t for t, h in zip(ts, whole) if h > CEIL]
print('whole over ceiling', (round(min(over), 2), round(max(over), 2)) if over else None)
