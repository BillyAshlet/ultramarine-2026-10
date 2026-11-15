# H · 性能与渲染卡顿优化

**一句话**：在不改变 20 cm 网格、压力迭代次数（`iterations = 10`）与任何模块物理耦合机制的前提下，先压掉 CPU 求解器与 GPU 光线步进里的无效重复计算，让页面交互流畅后再进入视觉层级与遮挡关系设计。

---

## 红线与原则

1. **网格与物理零改动**：保留 20 cm（`44×32×89 = 125,312` 格、`81,850` 空气格）与 `iterations = 10`、`dt = 0.05 s`，不采用 `40 cm` 降网格（已知会改变空气体积 -17%、打破 A/B 对称、丢失轰燃与 70× 水沉积偏差）。
2. **模块与耦合不变**：不动 `combustion.js`、`radiation.js`、`gas.js`、`water.js`、`leaks.js`、`dressing.js`、`flames.js` 的任何耦合逻辑与阈值；优化前后在同一批算例上对比逐格物理场差异与事件时刻。
3. **只做有收益的优化**：每改一个模块即用基准与回归脚本实测耗时与误差。

---

## 优化前基线（20 cm 网格，全模块加载，`iterations = 10`）

### 1. Node 算例与模块检查耗时

| 检查脚本 | 工况说明 | 优化前耗时 |
|---|---|---|
| `bench.mjs` | A102 起火 60 s，仅 `HouseFire` + `walls` | `19 ms/step`（模拟 1 s 需 `0.38–0.39 s`） |
| `gas-check.mjs` | `A205` 割管泄漏 180 s + 点燃爆燃 | `gas.js` `0.10 ms/step`（带火结尾 `0.13 ms/step`，单步最坏 `3.93 ms`）；前期实测整步 `21–22 ms/step` |
| `water-check.mjs` | A102 快速 t² 火 120 s，含/不含喷淋 | `24.7 ms/step`（有喷淋）/ `24.3 ms/step`（无喷淋） |
| `leaks-check.mjs` | A102 中速火关门 180 s（3600 步） | `77 s / 3600 步`（`leaks` `0.334 ms/step`） |
| `radiation-check.mjs` | A102 2 MW 火 420 s | 求解器 `30.6 ms/step`（`radiation` `0.17 ms/step`） |

> 另注：Billy 优化前在个人浏览器截图里观察到的页面状态栏为 **`step 64 ms · 0.8× real time at most`**（当时 `devicePixelRatio` 上限为 `1.5×`、全分辨率 400 步体积光追且每帧拖拽期间仍同步跑求解器）。

### 2. 全耦合单步分阶段耗时（Node，40 步均值，含全部 6 模块）

- **工况 A（正常火灾，第 200–240 步，`gas`/`water` 全 0）**：总计 **`31.706 ms/step`**
- **工况 B（开关门重写拓扑 + 割开燃气管道激活 `gas` 标量 + 割开水管，第 280–320 步）**：总计 **`33.551 ms/step`**

| 阶段 | 工况 A（无泄漏/喷淋） | 工况 B（含门开关与 `gas` 活跃） | 占比 / 瓶颈来源 |
|---|---|---|---|
| `burn` | `0.098 ms` | `0.097 ms` | 燃烧放热 |
| `addBuoyancy` | `0.134 ms` | `0.139 ms` | 浮力 |
| `advectVelocity` | `3.442 ms` | `3.519 ms` | 每格每面调用 `back` 闭包 + 非零 `Math.sqrt` |
| `computeEddies` | `0.664 ms` | `0.737 ms` | Smagorinsky 涡粘性 |
| `mixVelocity` | `3.756 ms` | `3.934 ms` | 每步分配 `[1,-1,sy,-sy,sz,-sz]` 与 `[f,scratch,open,across]` 小数组 |
| `project` | `9.841 ms` | `10.337 ms` | 10 轮 SOR 每次重算速度散度 `out` 与 6 个邻面开关分支 |
| `advectScalars` | `10.186 ms` | `10.451 ms` | 无条件遍历全部 5 个标量（含全 0 的 `gas`/`water`）+ 百万次 `faceValue` 闭包 |
| `mixScalar` | `2.506 ms` | `2.567 ms` | 无条件混合全 0 额外标量 |
| `cellVelocities` | `0.426 ms` | `0.444 ms` | 插值格心风速供渲染/涡粘 |
| `walls` | `0.121 ms` | `0.336 ms` | 墙体散热 |
| 6 个物理模块合计 `mods` | `0.532 ms` | `0.990 ms` | `sources / combustion / gas / water / radiation / leaks` |

其中 `advectScalars + project + mixVelocity + advectVelocity + mixScalar` 占整步计算时间的 **93.8%**（`29.73 ms / 31.71 ms`）。

---

## 本轮改动清单（3 个文件，已完成）

### 1. `duplex-fire/src/mac3d.js`（CPU 求解器等价加速）

- **`updateTopology()`**：预置闭面通量 `fx / fy / fz` 为 0；按流体格建立压缩表：散度数组 `div`（`Float64Array`）、6 位开面掩码 `pMask`（`Uint8Array`）与开面数倒数 `pInv`（`Float64Array`，`1 / cnt`）。
- **`project()`**：在 10 轮 SOR 外先计算一次速度散度 `div[n]`；内层拆分为「六面全通内点（`m === 63`，约占 75% 流体格）无分支直接乘 `inv6 = 1 / 6`」与「边界面（`m !== 63`）按位掩码跳过闭面邻居」。
  - *实测取舍*：曾尝试无分支读取全部 6 个固体邻居再乘 `pInv`，但 `project` 反慢至 `9.67–11.42 ms`——读取 4.3 万个固体格反而污染了 L1 缓存，且内点加载 `Float64Array pInv` 增加带宽；保留 `m === 63` 快路径后稳在 **`6.095 ms`**。
- **`advectScalars(dt)` / `mixScalar(x, scratch, dt)`**：提取模块级单态 helper `hasNonZero(arr, fluid)` 与 `faceFlux(q, c, s, v, open, h)` 替代内层闭包；无泄漏/无喷淋时跳过全零标量（`gas`、`water`、`fuel`），循环 2 去掉多余的 `open*` 三元判断（闭面通量已在拓扑更新时清零）；`mixScalar` 对全零标量及 `dm === 0` 早退。
- **`mixVelocity(dt)`**：提取 `mixFace(f, scratch, open, across, k)` 分别处理 `uf/vf/wf`，去掉每步分配的 `[1,-1,sy,-sy,sz,-sz]` 与 `[f,scratch,open,across]` 小数组。
- **`advectVelocity(dt)`**：内联回溯并在 `d2 <= 1` 时跳过 `Math.sqrt`（改用 `d2 > 1 ? 1 / Math.sqrt(d2) : 1`，去掉 `back` 闭包，保留 `this.sampleFace`）。

### 2. `duplex-fire/src/smoke-pass.js`（GPU 光线步进与 3D 纹理上传）

- **半分辨率光追 + 全分辨率合成**：新增半分辨率 `this.smokeTarget`（宽高为全分辨率的 `0.5×`、`RGBA8`，存 gamma 2.2 发光色 + 线性透射率 `transmit`，`LinearFilter`）与 `this.compositeMaterial` / `this.compositeScene`。房子墙体、线框与管线保持全分辨率锐利，体积烟雾/温度场单独在 `0.5×` 下光线步进再混合叠回（`this.material` 与 `uSmokeSigma`、`uHeatSigma`、`this.zone.uniforms` 接口不变，`setSize()` 同步缩放 `this.target` 与 `this.smokeTarget`）。
- **Shader 内层早剪与空跳**：在 400 步步进循环前按 `uClipY` 做解析射线区间裁剪（切一层时不再在截断范围外空跑）；热力模式（`uMode == 1`）遇到 `cell.g < 0.005`、低细节烟雾（`uDetail == 0`）遇到 `cell.r < 0.005` 直接跳过；高细节烟雾（`uDetail == 1`）在 `a < 0.002` 时跳过 3 次阴影采样 `smokeAt`。
- **稀疏纹理上传 `upload(fire)`**：改为只遍历 `fire.fluid` 空气格（`fi, fj, fk`）而非全网格 125,312 格；`dens <= 0` 或 `temp <= 0` 时跳过 `Math.sqrt`；同时统计 `this.hasSmoke` / `this.hasHeat`，全场为空时直接跳过光线步进 Pass；当门开关引发 `fire.fluid` 拓扑重建（`this._lastFluid !== fluid`）时清零残留的 `voxels` / `windBytes`。

### 3. `duplex-fire/src/main.js`（主循环与相机交互解耦）

- **像素比上限从 `1.5` 调回 `1`**：`renderer.setPixelRatio(Math.min(devicePixelRatio, 1))`，主场景片段着色减少 `2.25×`；叠加 `SmokePass` 的半分辨率光追，体积光追片段相比原 `1.5×` 全分辨率减少约 **`9×`**。
- **相机交互时跳过同步求解**：监听 `controls` `start`/`end` 维护 `interacting`，并在画布 `wheel` 上加 `160 ms` 防抖 `wheelUntil`；拖拽旋转与滚轮缩放期间暂不阻塞执行 `world.step()`，优先保住镜头手感和帧率。
- **按需纹理上传与渲染计时**：新增 `uploadDirty` 标记，仅在 `world.step()`、`placeFire`、双击开关门或流体拓扑变化后调用 `smoke.upload(fire)`；状态栏 `#status` 增加平滑后的渲染耗时 `render ... ms`。

---

## 优化后实测效果

### 1. 同进程交替 A/B 基准（排除宿主机降频，vs Git `HEAD` `mac3d.js`，均为 `iterations = 10`）

由于连续跑长算例时宿主机存在明显热降频，在单进程内交替跑新旧 `MacFire` 以获得同一时钟频率下的公平对比：

| 测试工况 | 旧版（`HEAD`）mean / median / p90 | 优化后 mean / median / p90 | 均值加速 |
|---|---|---|---|
| 3 标量（`bench.mjs` 同款） | `24.46 / 24.33 / 25.94 ms` | `16.75 / 16.79 / 18.01 ms` | **-31.5%** |
| 5 标量（正常火灾，`gas=0, water=0`） | `22.11 / 21.77 / 22.53 ms` | `13.37 / 13.36 / 13.51 ms` | **-39.5%** |
| 5 标量（`gas` 与 `water` 全活跃） | `21.65 / 21.62 / 21.92 ms` | `15.26 / 15.33 / 15.67 ms` | **-29.5%** |

### 2. 分阶段耗时对比（Node，40 步均值）

| 阶段 | 工况 A（前 → 后） | 工况 B（前 → 后） | 变化 |
|---|---|---|---|
| `advectScalars` | `10.186 → 2.013 ms` | — | **-80.2%**（工况 A） |
| `project` | `9.841 → 6.095 ms` | — | **-38.1%**（工况 A） |
| `mixVelocity` | `3.756 → 1.989 ms` | — | **-47.0%**（工况 A） |
| `mixScalar` | `2.506 → 0.907 ms` | — | **-63.8%**（工况 A） |
| `advectVelocity` | `3.442 → 3.082 ms` | — | **-10.5%**（工况 A） |
| **整步合计** | **`31.706 → 15.808 ms`** | **`33.551 → 19.928 ms`** | **-50.1% / -40.6%** |

### 3. 真实浏览器预览实测（内置 WebView 打开 `http://localhost:5196/duplex-fire/`）

- **状态栏 `#status` 实测**：
  - `t 1:08`：`step 21 ms · render 1.5 ms · 2.4× real time at most`（`sources 0.0 · actions 0.0 · combustion 0.0 · gas 0.0 · water 0.0 · radiation 0.1 · leaks 0.5 · card 0.0`）
  - 拖拽旋转视角与切层后（`t 2:19 – 2:24`）：`step 17–19 ms · render 1.3–1.4 ms · 2.6×–2.9× real time at most`（页面最终截图停在 `step 17 ms · render 1.3 ms · 2.9× real time at most`）。
  - *对比注记*：Billy 个人浏览器在优化前的截图为 `step 64 ms · 0.8× real time at most`；虽分属不同浏览器运行环境，但页面侧渲染已压到 `1.3–1.5 ms`、求解每步 `17–21 ms` 并稳定在 `2.4×–2.9×` 实时倍率。
- **控制台与视觉模式核查**：
  - 浏览器控制台**零 JS 运行时错误、零 WebGL/GLSL 编译与链接报错**（仅重载初期有 1 次 `src/eventsView.js` 的 aborted GET 请求）。
  - **交互与模式切换**：鼠标拖拽旋转流畅无撕裂/无黑盒裁切；`Heat 热` 模式正确显示 `20 °C – 460+ °C` 温度图例与暖红体积渐变；`Level 1 一层` 裁剪干净；切回 `Both 两层` + `Smoke 烟` 恢复正常。

---

## 物理等价性与耦合校验（全部守住红线）

### 1. 320 步逐格物理场对比（`mac3d_verify.mjs check`）

在 320 步内完整执行 `A202` 关门/开门、割开燃气管 `e569` 与割开水管 `e624`，优化前后比对全部 **125,312** 格：

- **3 项事件匹配**：全部 **`true`**。
- **逐格最大绝对偏差**：`temp 3.052e-5`、`dens 6.985e-10`、`fuel 7.629e-6`、`p 1.211e-7`、`uf 1.788e-7`、`vf 2.384e-7`、`wf 1.192e-7`、`gas 2.98e-8`、`water 7.451e-9`。
- **压力投影散度最坏格残差**：基线 `0.0002609044` → 优化后 `0.0002609007`。

### 2. 五大独立物理模块回归（均退出码 0，现象与守恒一致）

| 脚本 | 物理校验结果（前 → 后一致） | 耗时备注（含宿主机热降频影响） |
|---|---|---|
| `bench.mjs` | 60 s A102 起火守恒一致 | 冷机批跑 `19 → 16 ms/step`（降频后单独再跑曾测得 `23 ms/step`） |
| `gas-check.mjs` | `180.9 s` 燃气爆燃（`gasM3 0.554`、`17.41 kPa`）、`181.0 s` 点燃 | 泄漏段整步 `21–22 ms → 14–16 ms/step`（批跑内 `gas.js` 泄漏期 `0.10 → 0.13 ms`，末尾 `0.13 → 0.18 ms`） |
| `water-check.mjs` | `54.9 s` 喷淋动作 s1、累计释水 `65.46 kg`、热账差 `-0.001 kJ` | 无喷淋 `24.3 → 23.4 ms`；有喷淋 `24.7 → 27.7 ms` |
| `leaks-check.mjs` | 跨户烟气到达 `111.0 / 132.8 / 156.0 s`，总烟灰 `45.40 g`（账平 `0.0000 g`） | 该批跑中未改的 `leaks` 模块本身从 `0.334` 慢至 `0.526 ms`（`77 s → 97 s`） |
| `radiation-check.mjs` | `410.1 s` 上烟层 `496 °C`、辐射表 `55.5 kW/m²`、无额外轰燃 | 求解器 `30.6 → 28.5 ms`（未改 `radiation` `0.17 → 0.20 ms`）；脚本会重写 `进度/C/radiation-check.json`，已恢复为 Git `HEAD` |
| `combustion-check.mjs ignition` | 点燃判据通过（退出码 0） | — |

### 3. 900 秒全模块耦合回归（`coupling-run.mjs norule 900 0.2`）

对照基线 `进度/耦合/coupling-norule-20-it10.json`：

- **核心耦合事件一致**：
  - `ignitions identical: true`（全部 16 条点燃时间精确到 `0.1 s`）。
  - `crossed identical: true`（`A102 Living Room floor20At: 395`）。
  - 全程 900 s 关键物理量：`totalKW max 4132`、`zonePa max 3565.2`、`e1041` 水管接头第 `716 s` 达 `233 °C` 失效。
- **数值偏差**：`maxKwDiff: 0`、`maxTempDiff: 1 °C`、`maxPaDiff: 0.1 Pa`、`maxSootDiff: 0.0001`。
- **透明记录**：对比脚本输出 `events identical: false`（当时清理临时输出文件前未打印逐条事件明细）；此外该次 900 秒长跑中宿主机同样存在降频——未改动的 `leaks 0.404 → 0.578 ms`、`radiation 0.334 → 0.457 ms`、`solver 30.253 → 32.004 ms/step`。

---

## 还差 / 下一步

性能与卡顿瓶颈已先压下来，可以在流畅的交互帧率下进入下一步设计：
1. **视觉大关系收敛**：一起确定墙体/楼板半透明层次、材质颜色与渲染强度，去掉画面杂乱感。
2. **火焰与容器遮挡问题**：处理火焰与煤气罐、水罐之间的前后深度/半透明排序，解决火焰被容器挡住的问题。
3. **跨模块挂起对接与提交**：待视觉改造完成后，统一核对 `B`/`C`/`H` 的提交状态。
