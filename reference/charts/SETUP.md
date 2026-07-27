# 图型库首次安装

## 为什么这里少两样东西

`catalog.md`（48 图型索引）和 `templates/`（6 个 gallery 参考实现）是第三方素材，来自 skill [`lieflat-charts`](https://github.com/larashero3-dotcom/lieflat-charts)，许可证是 **PolyForm Noncommercial 1.0.0** —— 允许非商业使用，但不允许再分发。所以本仓库不携带这两项，需要使用者自己从上游拉一份。

同目录的 `deck-tokens.js` 和 `PROVENANCE.md` 是 p2h2p 自己写的，随仓库分发，不用管。

## 怎么补齐

克隆上游到临时目录 → 只复制需要的两项 → 删掉临时目录。整段可以直接粘进终端：

```bash
SKILL_DIR=~/.claude/skills/p2h2p

git clone --depth 1 https://github.com/larashero3-dotcom/lieflat-charts.git /tmp/lieflat-charts-src
cp /tmp/lieflat-charts-src/catalog.md "$SKILL_DIR/reference/charts/"
cp -R /tmp/lieflat-charts-src/templates "$SKILL_DIR/reference/charts/"
rm -rf /tmp/lieflat-charts-src
```

如果 skill 不在默认路径，改掉第一行的 `SKILL_DIR` 即可。

验证：

```bash
SKILL_DIR=~/.claude/skills/p2h2p
test -f "$SKILL_DIR/reference/charts/catalog.md" && echo "catalog.md OK"
ls "$SKILL_DIR/reference/charts/templates/"*.html | wc -l   # 应为 6
```

`catalog.md OK` + 数字 `6` 就算装好了。6 个 gallery 分别是 `lupi-gallery.html` / `basics-gallery.html` / `glance-gallery.html` / `big-circular.html` / `big-force.html` / `big-threads.html`。

## 许可证约束

上游是 **PolyForm Noncommercial License 1.0.0**：允许非商业使用，禁止商业使用，禁止再分发。这条限制跟着文件走，复制到本目录之后依然有效。

SKILL.md 的 Step 3.7 第一道 Hard gate #0 就是干这个的 —— 使用图型库前先问「这份 deck 是否用于营利活动」（客户交付、述标投标、销售或融资演示）。是 → 不走这个库，改用 Chart.js / ECharts 自绘（MIT / Apache-2.0，无限制），投屏闸门和配色规则照旧适用。

确实需要商业使用的，自行联系上游作者取得授权：larashero3@gmail.com。

## 不装会怎样

只影响 Step 3.7 的图型库选型 —— 没有 `catalog.md` 就没法按数据形状检索图型，没有 gallery 就没有可照抄的参考实现。

p2h2p 其余部分完全不受影响：模板选型、HTML 构建、导 pptx 照常跑。图表退回用 Chart.js / ECharts 直接绘制，Step 3.7 的投屏可读性闸门（线宽 ≥ 1.5px、SVG 字号 ≥ 11px、正文 ≥ 14pt）和配色规则仍然适用 —— `deck-tokens.js` 在仓库里，`buildLadder()` / `fromCssVars()` 照用。

## 版本对齐

本整合基于上游 commit `e5b369d`（2026-07-27）。

上游后续更新未必与本副本兼容 —— 我们有意废除了它的单色纪律和 Lupi 优先选型，颜色系统整体重写过。所以别直接拉最新版覆盖，要吸收上游更新请人工比对，规则见 `PROVENANCE.md` 第三节。
