# P2H2P — PPT → HTML → PPT

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
