# reference/diagrams/vendor 的来源与许可说明

这个目录里的两个 JS 文件不是 p2h2p 写的，是从 npm 取下来的第三方库 UMD 构建产物，直接内联进单文件 HTML deck 用。用之前先看清楚：许可证、版本、为什么选它们。

**跟 `reference/charts/` 最大的区别：这两个库都允许商用和再分发**，所以它们随本仓库一起发布，不像 charts 那边要靠 SETUP.md 现拉。Step 3.7 的商用闸门（PolyForm Noncommercial）**不适用于本目录**。

## 一、清单

| 文件 | 库 | 版本 | 许可证 | 大小 | 来源 URL |
|---|---|---|---|---|---|
| `d3-hierarchy.min.js` | d3-hierarchy | 3.1.2 | ISC | 14,828 B | `https://cdn.jsdelivr.net/npm/d3-hierarchy@3.1.2/dist/d3-hierarchy.min.js` |
| `non-layered-tidy-tree-layout.js` | non-layered-tidy-tree-layout | 2.0.2 | MIT | 5,599 B | `https://cdn.jsdelivr.net/npm/non-layered-tidy-tree-layout@2.0.2/dist/non-layered-tidy-tree-layout.js` |

下载日期：**2026-07-28**。

**改动说明**：`d3-hierarchy.min.js` 为原样字节，未做任何修改。`non-layered-tidy-tree-layout.js` 仅在文件顶部**新增一行版权声明注释**（上游压缩产物没带），代码本体一字未动——加注释是为了履行 MIT 的保留声明义务，不是改功能。

ISC 和 MIT 都是宽松许可：允许商用、修改、再分发，唯一义务是保留版权声明。

- **d3-hierarchy**：`Copyright 2010-2021 Mike Bostock`（ISC）。压缩产物第一行自带版权注释，原样分发该文件即满足义务。
- **non-layered-tidy-tree-layout**：`Copyright (c) 2019 Michael Wong`（MIT）。上游 npm 包的压缩 UMD **不含任何内嵌版权注释**（全文 grep 不到 `Copyright`）。为免"单独分发这个 .js 就不带声明"，我们在文件顶部补了一行声明注释——这是本目录对上游文件唯一的改动，见下方"改动说明"。

> 别把"文件在这个仓库里"当成合规的全部理由：MIT 的义务跟着**文件本身**走，谁把它单拎出去分发，谁就要保证那一份带着声明。

## 二、各自干什么、为什么选它

### non-layered-tidy-tree-layout —— 主力，树布局的算法本体

结构图的核心难题是**节点尺寸不一**：中文节点从两个字到二十个字都有，宽度能差四倍。

经典的 Reingold-Tilford（1981）和 Buchheim / Jünger / Leipert（2002）的线性时间改进版，都建立在「所有节点等宽」这个假设上——布局时把节点当成一个点，兄弟间距是常数。**d3-hierarchy 的 `d3.tree()` 继承了这个假设，这就是它排变尺寸节点会重叠的根本原因**，不是调参能绕开的。

变尺寸的论文正解是 A.J. van der Ploeg 的《Drawing Non-layered Tidy Trees in Linear Time》（CWI）。名字里的 "non-layered" 就是指它不假设同层节点等高等宽——变尺寸是这个算法的原生能力，不是补丁。本库是该论文 Java 参考实现（`cwi-swat/non-layered-tidy-trees`）的 JavaScript 移植，零依赖。

同类里还有 `d3-flextree`，同一篇论文的另一个 JS 移植，但它依赖 d3-hierarchy，多背一个包。这里选零依赖的这个。

**API**（`window.nonLayeredTidyTreeLayout`）：

```js
const { BoundingBox, Layout } = nonLayeredTidyTreeLayout;
// BoundingBox(gap, bottomPadding)
//   gap           = 副轴上兄弟之间的间隙
//   bottomPadding = 主轴上层与层之间的间隙
const bb = new BoundingBox(20, 60);
// 输入：每个节点挂 width / height，children 数组
const { result, boundingBox } = new Layout(bb).layout(treeData);
// 输出：原树上每个节点写入 x / y（盒子左上角），坐标系固定 TB
```

坐标系固定是自顶向下（x = 兄弟展开方向，y = 深度方向）。`layout-core.js` 的 `layoutTidyTree()` 负责做轴变换，支持 LR / RL / TB / BT 四个方向。

已知限制（都在 `layout-core.js` 里注释说明了）：**同父兄弟和不同父的相邻子树共用同一个 `gap`**，库没有分开的参数。我们的 `GEOM.subtreeGap` 比 `siblingGap` 大，适配层取两者较大值喂进去——整体略松一点，但绝不会让两棵子树贴在一起。

### d3-hierarchy —— 备用，非树形版式和数据整形

只有以下场景才需要加载它，普通思维导图/组织架构图不用引：

- 径向/环形布局（`d3.cluster` + 极坐标换算）
- 面积型结构图：`d3.pack`（圆形填充）、`d3.partition`（旭日图/冰柱图）、`d3.treemap`
- 扁平数据转层级：`d3.stratify()`（从 `{id, parentId}` 表格建树）
- 通用层级操作：`d3.hierarchy()` 的 `sum` / `sort` / `descendants` / `ancestors`

**注意：`d3.tree()` 不要用在有变尺寸节点的场景**，理由见上。用它只在节点确实等宽时（比如纯图标节点）。

导出全局名是 `window.d3`（UMD 会挂到 `d3` 命名空间上并合并，与其他 d3 模块共存无冲突）。

## 三、加载顺序

```html
<script src="../charts/deck-tokens.js"></script>
<script src="diagram-tokens.js"></script>
<script src="vendor/non-layered-tidy-tree-layout.js"></script>
<script src="vendor/d3-hierarchy.min.js"></script>   <!-- 可选，只有径向/面积版式要 -->
<script src="layout-core.js"></script>
```

单文件 HTML deck 的最终产物要自包含（会被 puppeteer 截图导进 PPT），所以这几个文件建议直接内联进 `<script>`，不留外部引用。

**`non-layered-tidy-tree-layout.js` 的 UMD 包装器里直接写了 `window`**，只能在浏览器环境跑，Node 里 require 会报 `window is not defined`。我们的产物就是浏览器页面，不影响；但如果哪天要在 Node 里跑布局做回归测试，得先垫一个 `global.window = global`。

## 四、更新与校验

重新下载后核对文件大小是否与上表一致，并确认头部是 JS 而不是 404 页面：

```bash
cd ~/.claude/skills/p2h2p/reference/diagrams/vendor
ls -la *.js
head -c 200 d3-hierarchy.min.js                 # 应看到 "// https://d3js.org/d3-hierarchy/ v3.1.2"
head -c 120 non-layered-tidy-tree-layout.js     # 应看到 UMD 包装器 !function(t,n){...
```

升级版本前先跑 `reference/diagrams/_selftest.html` 的零重叠检测，确认新版没改坐标语义。
