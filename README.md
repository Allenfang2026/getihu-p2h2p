# P2H2P — PPT → HTML → PPT

[English](#p2h2p--ppt--html--ppt) · [中文](#中文说明)

A [Claude Code](https://docs.claude.com/en/docs/claude-code) / Claude **skill** that turns rough input into a polished, editable slide deck — delivering **both** an editable HTML deck and an editable `.pptx`.

P2H2P = **PPT → HTML → PPT**: any input → HTML as the ground-truth middle layer → PPT output.

## What it does

Give it any of these and it builds you a finished deck:

- An existing ugly `.pptx` you want rebuilt prettier (`重做这份 PPT`)
- A rough idea or topic (`做一份 X 主题的 PPT`)
- A photo of a whiteboard, a handwritten outline, or a reference screenshot
- A request to tweak a deck it built earlier (`改 P05 字号`)

It runs a 7-phase pipeline — content extraction → template pick → parallel HTML build with per-builder visual review → HTML→PPT conversion → final QA — and stops at only **3 checkpoints** (outline / template / HTML preview), running everything else autonomously. Each checkpoint times out and proceeds with sensible defaults, so it can run unattended (`--auto` skips checkpoints entirely).

## Heads-up: this is an orchestrator, not a standalone skill

**P2H2P does not do the heavy lifting itself. It orchestrates two other skills and handles the seams between them** (content extraction, checkpoints, iteration mode). You need both of these installed for P2H2P to work:

| Phase | Delegated to | What it does |
|-------|-------------|--------------|
| 2–4 | [`beautiful-html-templates`](#credits--lineage) | template selection + HTML deck generation |
| 5–6 | `pptx` | HTML → `.pptx` conversion + visual QA |

Both remain independent and callable directly when you only need one half.

## Install

Drop this folder into your skills directory:

```bash
git clone https://github.com/Allenfang2026/p2h2p.git ~/.claude/skills/p2h2p
```

Then make sure its two dependency skills are also installed:

- `~/.claude/skills/beautiful-html-templates`
- `~/.claude/skills/pptx`

`SKILL.md` is the whole skill — the agent reads it and follows the pipeline.

### Runtime dependencies

The skill auto-installs these in Phase 0 if missing:

- `node` + `pptxgenjs` (HTML→PPT generation)
- `python-pptx`, `markitdown[pptx]` (content extraction)
- `libreoffice` (`soffice`) + `poppler` (`pdftoppm`) (render slides to images for QA)

## Credits & lineage

This skill is an **orchestration layer built on top of two existing skills** — it composes them rather than reimplementing their logic:

- **`beautiful-html-templates`** — handles template selection and HTML deck generation (Phases 2–4). That skill is itself a wrapper around the open-source template library [**zarazhangrui/beautiful-html-templates**](https://github.com/zarazhangrui/beautiful-html-templates).
- **`pptx`** — handles HTML → `.pptx` conversion and visual QA (Phases 5–6).

P2H2P's own contribution is the pipeline glue: structured semantic content extraction, the 3-checkpoint async-review flow with scheduled-wakeup timeouts, recursive shard-and-retry on builder failure, the per-builder mini-reviewer loop, and iteration mode for tweaking shipped decks.

## License

[MIT](./LICENSE) © 2026 Allen Fang

---

## 中文说明

P2H2P 是一个给 [Claude Code](https://docs.claude.com/en/docs/claude-code) 用的 **skill**，把粗糙的输入变成一份能直接用的幻灯片——同时给你**可编辑的 HTML 版**和**可编辑的 `.pptx`**。

名字 P2H2P 就是 **PPT → HTML → PPT**：不管你喂进去什么，都先转成 HTML 作为"中间真相层"，再从 HTML 生成 PPT。

### 能干什么

下面这些它都接得住：

- 手里有份丑 PPT，想重做漂亮点（"重做这份 PPT"）
- 只有个模糊想法或主题（"做一份 X 主题的 PPT"）
- 一张白板照片、手写大纲、或者参考截图
- 想改它之前生成过的那份（"改 P05 字号"）

它跑一条 7 阶段流水线——抽内容 → 选模板 → 多个 builder 并行搭 HTML 并逐个视觉自检 → HTML 转 PPT → 终审 QA——中途只在 **3 个检查点**停下等你（大纲 / 模板 / HTML 预览），其余全自动。每个检查点都会超时，超时就按默认值继续，所以挂着没人管也能跑完（加 `--auto` 直接连检查点都跳过）。

### 注意：它是个编排器，不是单独能用的 skill

**重活不是 P2H2P 自己干的，它是把另外两个 skill 串起来、负责中间的衔接**（抽内容、检查点、迭代模式）。所以这两个 skill 你得一并装上，P2H2P 才跑得起来：

| 阶段 | 交给谁 | 干什么 |
|------|--------|--------|
| 2–4 | `beautiful-html-templates` | 选模板 + 生成 HTML 幻灯片 |
| 5–6 | `pptx` | HTML 转 `.pptx` + 视觉 QA |

这两个 skill 也能各自单独用，你只要其中一半功能时直接调它们就行。

### 安装

把这个文件夹放进你的 skills 目录：

```bash
git clone https://github.com/Allenfang2026/p2h2p.git ~/.claude/skills/p2h2p
```

再确认这两个依赖 skill 也装了：

- `~/.claude/skills/beautiful-html-templates`
- `~/.claude/skills/pptx`

`SKILL.md` 就是 skill 本体——agent 读它、照着流水线走。

运行时依赖（`node` + `pptxgenjs`、`python-pptx`、`markitdown`、`libreoffice`、`poppler`）会在第 0 阶段缺啥装啥，不用你提前准备。

### 出处

这个 skill 是**架在两个现成 skill 上的编排层**，本身不重写它们的逻辑：

- **`beautiful-html-templates`**——负责选模板和生成 HTML（2–4 阶段）。它自己又是开源模板库 [zarazhangrui/beautiful-html-templates](https://github.com/zarazhangrui/beautiful-html-templates) 的封装。
- **`pptx`**——负责 HTML 转 `.pptx` 和视觉 QA（5–6 阶段）。

P2H2P 自己写的部分是把这些粘起来的那层逻辑：结构化的语义抽取、带定时唤醒超时的 3 检查点异步评审流程、builder 失败时的递归切半重试、每个 builder 配一个 mini-reviewer 的自检循环，以及改已交付 deck 的迭代模式。
