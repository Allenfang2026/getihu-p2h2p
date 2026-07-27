# reference/charts 的来源与分叉说明

这个目录里的图型库不是 p2h2p 原创，是从另一个 skill 搬过来再改的。用它之前先看清楚下面三件事：许可证限制、改了什么、以及为什么不跟上游同步。

## 一、来源

| 项 | 值 |
|---|---|
| 上游 skill | `lieflat-charts`（单色数据可视化） |
| 本机源路径 | `~/.claude/skills/lieflat-charts/` |
| 采集时的上游 commit | `e5b369d` |
| 采集日期 | 2026-07-27 |
| 许可证 | **PolyForm Noncommercial License 1.0.0** |

许可证原文在上游仓库的 `LICENSE`，第三方声明在 `THIRD_PARTY_NOTICES.md`。

### 许可证是硬约束：禁商用

PolyForm Noncommercial 1.0.0 只允许**非商业用途**。这条限制跟着这些文件走，复制到 p2h2p 之后依然有效。

具体到 p2h2p 的使用场景：

- 可以用 —— 个人学习、研究、非营利组织的内部材料、开源项目文档。
- **不能直接用** —— 拿这些图型做客户交付的商业 deck、投标述标 PPT、对外售卖或用于营利业务的演示材料。

如果某一单 deck 是商业性质的，两条路：① 找上游作者取得商业授权；② 那一单别用这套图型库，改用 p2h2p 自己的图表实现或其他许可宽松的方案（Chart.js / ECharts 本身是 MIT/Apache，自己写的图表代码不受这个限制，受限制的是本目录这些模板文件和从中直接复制的实现）。

判据一句话：**这份 deck 是否用于营利活动？是 → 不用本目录。**

## 二、有意做的改动

搬过来时不是原样照抄，下面这些是**故意跟上游不一样**的，不是遗漏、不是待修的 bug。

### 1. 颜色：写死的单色 → 跟随 deck 配色

上游 `mono-tokens.js` 把一整套单色系统写死在文件里：纸灰 `#F0EFEB` 打底、炭黑 `#1C1C1A` 作墨，中间七级灰阶固定不变，外加一套暗卡专用色。上游明确规定"没有彩色"，这是它的风格纪律。

p2h2p 不能这么干 —— 每份 deck 有自己的主色和背景色，图表必须跟着走，否则一页里图表和标题各说各话。

改法：`mono-tokens.js` → `deck-tokens.js`，把写死的 ladder 换成函数：

- `buildLadder(baseColor, bgColor, steps = 9)` —— 把 hex 转 HSL，锁住基色的色相，在 lightness（配合轻微的饱和度渐变）维度均匀取 `steps` 个点，再转回 hex。输出九级明度阶。
- `fromCssVars(scope, opts)` —— 从页面 CSS 自定义属性（`--color-primary` / `--color-bg` / `--color-ink` 等，每类按候选列表往下找）读出 deck 的配色，自动调 `buildLadder`，返回整套 token（`ladder` / `L` / `LAD` / `muted` / `faint` / `grid` / `tip`）。图表因此自动跟随 deck 主题，不需要每页手填颜色。

**保留的语义**："明度即数据"这条不变 —— `ladder[0]` 最浅（最贴近背景、最弱），最后一项最深（最重、最重要）。多系列按重要性从深到浅分配，主系列拿最深的那一级。

**新增的行为**：背景是深色时（`bgColor` 明度 < 0.5）ladder 自动反向 —— "最浅"变成"略亮于背景"，"最深"变成高明度的亮色。这样在暗色 deck 上每一级都能从背景里跳出来，对比度不会塌掉。上游是用一套单独写死的 `DARK` 对象处理这件事的，本副本改成了自动推导。

**兜底**：传进去的颜色解析不了（不是合法 hex）时，退回中性灰阶（等价于上游的纸灰→炭黑），不抛异常。

### 2. 新增投屏可读性下限

上游服务的是近距离阅读的网页长文，所以敢用 0.5px 发丝线、6.5px 的 SVG 字号 —— 在显示器上看很精致。

p2h2p 的产物要投到投影仪、要被会议室后排的人看见。那套尺寸投出来直接消失。

所以新增了硬下限常量：

```js
PROJECTION = { minStroke: 1.5, minFontPt: 14, minSvgFont: 11 }
```

- `minStroke: 1.5` —— 任何线（轴线、网格线、关系图连线、描边）的最小 px 宽度。
- `minFontPt: 14` —— HTML 正文的最小磅值。
- `minSvgFont: 11` —— SVG `<text>` 的最小 px 字号。低于这个数就别硬画，改成 hover 出或挪到图例里。

`FONT` 里的字号也整体上调了（标题 16.5 → 22，副标题 11.5 → 15，来源行 9.5 → 12，轴标签 9.5 → 13），`FONT.minHalf` / `FONT.minWide` 统一指向 `PROJECTION.minSvgFont`。`CARD_CSS` 里加了一条 `stroke-width: max(1.5px, …)` 的兜底，防止直接抄模板时漏掉线宽。

### 3. 删掉了 Lupi 优先的选型纪律

上游 `SKILL.md` 规定了一条选型顺序：优先 Lupi Editorial 和 Lupi Basics，没有合适模板时才退到 Glance。那是上游自己的风格取向（手绘感、编辑设计味）。

p2h2p 不继承这条。选哪个图型由 deck 本身的调性和这一页要说的话决定 —— 一份严肃的财务汇报该用 Glance 的克制图表，用 Lupi 的手绘气泡反而不合适。所以本目录只保留 `catalog.md` 作为图型清单和 gallery 作为参考实现，不带上游的优先级排序。

同理，上游 `SKILL.md`、`README.md`、`agents/`、`scripts/`、`docs/`、`examples/` 都没有搬过来 —— 那些是上游的工作流，p2h2p 有自己的流水线。

### 4. 其他小改动

- `window.MONO` → `window.DECK`（避免和上游文件同页共存时打架）。
- 字族从写死的 `Inter` 改成 `inherit`，跟着 deck 的字体走；上游的 Google Fonts 引入行删掉了。
- 卡片 CSS 的类名从 `.card` 改成 `.chart-card`，颜色全部改用 `inherit` / `opacity`，不再写死 `--bg` / `--ink` 这些全局变量，避免污染 deck 已有的样式。
- `obsReveal()` 加了一句 `if (!n) return;` 的空节点保护（上游没有，元素不存在时会抛异常）。

**没动的部分**（跟上游逐字一致，别改）：`rnd()` 确定性伪随机、`obsReveal()` 的 IntersectionObserver + 点击重播 + timer 登记机制、`pol` / `sect` / `blob` 几何函数、`el` / `txt` / `tip` 的 SVG 快捷函数、`MOTION` 的 quarticOut 曲线与 stagger 时长、`prefers-reduced-motion` 降级 CSS、`SHAPE` 的圆角数值。

## 三、本副本与上游有意分叉，不做同步

这不是一个 vendor 目录，没有同步脚本，也不打算加。

理由：核心的颜色系统已经跟上游的设计前提相反了（上游立"单色"为纪律，本副本立"跟随 deck 配色"为纪律），任何自动同步都会把这条改回去。

**上游更新时怎么办**：人工比对，挑着吸收。具体做法 ——

1. 去 `~/.claude/skills/lieflat-charts/` 看上游 commit 从 `e5b369d` 往后改了什么（`git log e5b369d..HEAD`）。
2. 只考虑吸收这两类：① `catalog.md` 里新增的图型条目；② gallery HTML 里新增或修好的图型实现。
3. **不要**吸收 `mono-tokens.js` 的颜色改动 —— 那部分本副本已经整体重写，照搬会退回单色。
4. 吸收 gallery 里的新图型时，记得按 `PROJECTION` 的下限调一遍线宽和字号，上游的尺寸对投屏不达标。
5. 吸收完在本文件底下追一行：日期 + 从哪个 commit 吸收了什么。

### 吸收记录

| 日期 | 上游 commit | 吸收了什么 |
|---|---|---|
| 2026-07-27 | `e5b369d` | 首次采集：catalog.md、6 个 gallery HTML、mono-tokens.js（改写为 deck-tokens.js） |

## 四、目录清单

```
reference/charts/
├── PROVENANCE.md              本文件
├── catalog.md                 48 个图型的清单（原样复制自上游，未改）
├── deck-tokens.js             改写自上游 mono-tokens.js（颜色跟随 deck）
└── templates/                 图型的参考实现（原样复制自上游，未改）
    ├── lupi-gallery.html      Lupi Editorial 系
    ├── basics-gallery.html    Lupi Basics 系
    ├── glance-gallery.html    Glance 系
    ├── big-circular.html      整页大图：环形
    ├── big-force.html         整页大图：力导向关系图
    └── big-threads.html       整页大图：线束
```

gallery 和 `catalog.md` 是**参考实现**，照抄结构、换自己的数据和颜色，别当成运行时依赖去 import。它们内部仍带着上游的单色写法 —— 抄进 deck 时颜色要换成 `DECK.fromCssVars()` 或 `DECK.buildLadder()` 的输出，线宽字号要过 `PROJECTION` 的下限。
