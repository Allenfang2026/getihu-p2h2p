---
name: p2h2p
description: "End-to-end pipeline for building or rebuilding a slide deck — start from a rough .pptx / text prompt / image (whiteboard photo, handwritten outline, reference screenshot), produce both an editable HTML deck and an editable .pptx. Trigger when the user wants to: (a) rebuild an existing ugly PPT into a beautiful one ('重做这份 PPT', 'rebuild this deck'), (b) make a deck from a rough idea or scribble ('做一份 X 主题的 PPT', 'turn this whiteboard photo into slides'), (c) iterate on a previously generated deck ('改 P05 字号'). This skill orchestrates the [beautiful-html-templates] skill (Phase 2-4) and the [pptx] skill (Phase 5-6); both remain independent and callable directly when only one half is needed. Stops at 3 checkpoints (outline / template / HTML preview) and runs everything else autonomously. P2H2P = PPT → HTML → PPT (any input → HTML middle layer → PPT output)."
---

# P2H2P — PPT ↔ HTML ↔ PPT pipeline

> Orchestration layer built on top of the `beautiful-html-templates` and `pptx` skills — it composes them rather than reimplementing their logic. `beautiful-html-templates` itself wraps the open-source library [zarazhangrui/beautiful-html-templates](https://github.com/zarazhangrui/beautiful-html-templates). MIT licensed. See README for full credits.

## What this skill is

A 7-phase orchestrator that turns rough input (existing PPT / text / images) into a polished editable .pptx, with HTML as the ground-truth intermediate layer. Wraps two sibling skills:

- **beautiful-html-templates** (Phase 2-4): template selection, HTML deck generation
- **pptx** (Phase 5-6): HTML → .pptx conversion, QA

This skill does NOT duplicate their logic. It dispatches them and handles the seams (content extraction, checkpoints, iteration mode).

## Studio mode (optional private companion)

This skill ships the *generic* pipeline. A power user may keep a **private companion library** so the skill compounds across decks instead of starting cold. The skill stays shareable; the companion stays private and is never committed to this repo.

**Detection rule (run this first, every time):** check whether `~/.claude/p2h2p-studio/` exists.

- **It does NOT exist** → run the plain pipeline below, standalone. Studio mode is purely additive; its absence is never an error.
- **It DOES exist** → before Phase 0, read its `PROTOCOL.md` (binding for this run) + `memory/` (user-profile taste/tone/red-lines, and lessons) + `INDEX.md` (a same-genre past deck to borrow from). Then:
  - **On finish** (after Phase 6): archive the deck into `~/.claude/p2h2p-studio/works/<slug>/`, write `works/<slug>/RETRO.md`, register one line in `INDEX.md`. When you were corrected / reworked / praised mid-run, also drop a `memory/lessons/<slug>.md` — only non-obvious, recurring, costly stuff.
  - **Skill evolution**: never auto-edit this `SKILL.md`. When a lesson is cross-deck and worth standardizing, write a `proposals/<date>-<title>.md`, then **ask the user to approve** before editing + pushing the skill.

---

## When to use

✅ Trigger:
- User has a `.pptx` they want rebuilt prettier
- User has rough material (text/images/notes) and wants a deck
- User says "改 P05 字号" on a previously P2H2P-generated deck
- User wants both HTML preview AND .pptx delivered

❌ Don't use:
- User only wants to *read* a PPT → use markitdown directly
- User only wants HTML, no PPT → use beautiful-html-templates directly
- User has a finished PPT and just wants 1-2 text edits → just edit pptx XML directly via pptx skill

## Pipeline at a glance

```
INPUT (.pptx / text / image / mix)
  ↓
Phase 0  Setup            (auto)    — git init, project folder, dependency check
  ↓
Phase 0.5 Domain research (cond.)   — ONLY for content-driven decks from a rough idea (教案/提案/行业分析/方案).
  ↓                                    2-3 focused agents → docs/调研要点.md. Skip for rebuilds of an existing PPT.
  ⏸️  (optional) MULTI-PLAN PICK: on a big direction fork, render an HTML plan-comparison page; user picks before Phase 1.
  ↓
Phase 1  Content extract  (auto)    — markitdown / vision / read; produce outline.md
  ⏸️  CHECKPOINT 1: user reviews outline; reorder/add/drop pages
  ↓
Phase 2  Template picks   (auto)    — beautiful-html-templates: 3 candidate covers
  ⏸️  CHECKPOINT 2: user picks one
  ↓
Phase 3  HTML build       (auto)    — parallel builder subagents + immediate mini-reviewer per builder
  ↓
Phase 4  HTML preview     (auto)    — open in browser
  ⏸️  CHECKPOINT 3: user OK → continue; not OK → collect feedback, loop Phase 3
  ↓
Phase 5  HTML → PPT       (auto)    — pptx skill via pptxgenjs; native textboxes + PNG backgrounds for decoration-heavy pages
  ↓
Phase 6  Final QA         (auto)    — reviewer agent diffs HTML vs PPT; auto-fix recurring patterns
  ↓
OUTPUT  HTML + .pptx + report
```

## Hard contracts

1. **Content fidelity = "smart repair"**: original numbers/names/quotations are NEVER altered, paraphrased, summarized, or compressed. English template residue / typos / duplicate punctuation MAY be cleaned. Confirm before greyscaling any photo of living people (inauspicious in Chinese context).
2. **HTML is the ground truth**: edits go to HTML, then re-generate PPT. `.pptx` is regenerable; never hand-edit it as the source of changes.
3. **3 checkpoints, no more — and they're async by default**: outline / template / HTML preview. Each times out after 5 minutes and AI proceeds with sensible defaults (see Checkpoint Timeout Policy below). Users can override later via Iteration mode.
4. **Failure: recursive shard-and-retry, then fallback**: when a subagent crashes (OOM / build error), retry once at same scope. If second attempt also fails, split the scope in half and dispatch two new agents recursively (8 pages → 4+4 → 2+2 → 1+1). Only fall back to degraded text-dump rendering on a single page that fails alone. This minimizes the blast radius of any one failure.
5. **`git init` is Phase 0.0**: every deck is a git project from second one. Commit per phase. Never `cp foo.html foo.html.bak` as a safety net.
6. **A build doesn't ship until a reviewer-pass agent sees it**: `node build.js` exiting 0 only proves the code ran — it does NOT prove text fits its container, that 380pt glyphs don't overflow their bbox, that captions don't collide with peak badges, or that adjacent columns aren't 0.3" apart and read as one number. After every build (including iterations), render to JPGs and dispatch a reviewer agent against the actual rendered output before declaring done. Don't ask the user "does this look ok?" as the first visual check — that's the agent outsourcing its own QA. See Phase 6 for the required reviewer-pass contract.
7. **Every visible element must answer "so what?"**: the test for any text/shape/stat on a slide is "what does the reader gain from this, that isn't already visible elsewhere on the same slide or in the page chrome?" If the answer is "nothing" or "the same info" (e.g. a stat panel restating the page count, a footer repeating the slide title), the element is filler — delete it and let the layout breathe, OR replace with content drawn from the actual report data. Self-referential deck metadata is the easiest filler to invent and the most common offender; reject it on sight.
8. **Agent-authored Chinese prose MUST go through `humanizer-zh` before shipping**: any 讲稿 / 说课稿 / narration script, invented slide copy, 大纲 description, or 金句 the agent *wrote itself* (vs. copied from the user's source) is run through the `humanizer-zh` skill and de-AI'd BEFORE it's shown at a checkpoint or baked into slides. Raw first-draft AI Chinese is never the final deliverable — the user flags AI-flavored 中文 on sight. Does NOT apply to text copied verbatim from the user's source (that's contract #1's territory). See Step 1.5b and `[[feedback_dezh_ai_via_humanizer_zh]]`.

---

## Checkpoint timeout policy + `--auto` flag

The 3 checkpoints (outline / template / HTML preview) are designed for **async user review** — not synchronous blocking. Timeouts MUST be enforced via real scheduled wakeups, not promised in prose.

### ⚠️ Hard rule — every checkpoint MUST schedule its own wakeup

The runtime does NOT auto-fire after N minutes. If you post a "等你 / waiting for you" message without calling `ScheduleWakeup`, you will block FOREVER waiting for a user response that may never come. This was a real bug — fixed by mandating the pattern below.

**Mandatory pattern** — every time you stop at a checkpoint, do these two things ATOMICALLY in the same response:

1. Post the checkpoint message to the user (what to review, how to confirm).
2. Call `ScheduleWakeup` with `delaySeconds: 300` and a prompt that triggers auto-default behavior on fire.

```
ScheduleWakeup(
  delaySeconds: 300,
  reason: "Checkpoint N timeout — proceeding with default decisions",
  prompt: "Checkpoint N (e.g. outline review) timeout fired. Check if user responded
          since the checkpoint was posted. If yes → continue per their input.
          If no → log auto-decision to docs/AUTO_DECISIONS.md and proceed to next phase
          with the documented defaults: [list defaults here]."
)
```

If user responds before 300s, just proceed normally — the scheduled wakeup will harmlessly fire later and find the user has already moved on (check git log / latest commit before acting).

### Default actions per checkpoint (used when wakeup fires)

| Trigger | Auto-default action |
|---|---|
| Checkpoint 1 (outline / assets / tables) | Accept current OUTLINE as-is, accept agent's ASSET_PLAN decisions, accept TABLES OCR data |
| Checkpoint 2 (template pick) | Pick candidate #1 (highest-ranked match for outline tone) |
| Checkpoint 3 (HTML preview OK?) | Assume OK, proceed to PPT generation |

### Logging — `docs/AUTO_DECISIONS.md`

When AI auto-decides past a checkpoint (whether via wakeup OR via user telling it to skip), it MUST log the decision:

```markdown
# Auto-decisions (user did not respond at checkpoint)

- 2026-05-25 02:14: Checkpoint 1 timeout (5m elapsed). Auto-accepted:
  - OUTLINE.md as generated (38 pages, no edits)
  - ASSET_PLAN.md (KEEP×4, DUOTONE×3, DROP×2)
  - TABLES.md (3 charts, all marked confidence:medium)
  - FONTS.md (all 4 fonts → KEEP-with-fallback per default rules)
- 2026-05-25 02:24: Checkpoint 2 timeout. Auto-picked: `sakura-chroma` (candidate #1)
- 2026-05-25 03:55: Checkpoint 3 timeout. Assumed OK, proceeded to Phase 5.
```

This file is the FIRST thing the morning report points the user at, so they can spot-fix bad auto-decisions via Iteration mode.

### `--auto` flag — skip checkpoints entirely

Invoke as `/p2h2p <input> --auto` to bypass all 3 checkpoints — completely unattended run. Don't post checkpoint messages at all; just write defaults to `docs/AUTO_DECISIONS.md` and continue. Useful for:
- Overnight bulk runs
- Batch processing multiple decks
- "Just give me something to start from" workflows

In `--auto` mode, the morning report becomes the user's ONLY interface to the result.

### Why this pattern matters (lesson from a real bug)

A previous run of this skill posted "等你 (5 分钟超时)" messages at Checkpoint 1 and Checkpoint 3 WITHOUT scheduling wakeups. The skill author (me) thought the runtime would auto-fire the timeout based on the SKILL.md prose — but the runtime is event-driven (user message OR background-agent completion), and prose isn't an event. Both checkpoints blocked indefinitely until the user manually pinged. The fix was to make the timeout a concrete `ScheduleWakeup` call paired with every checkpoint message. **Never just promise a timeout in text — schedule it.**

---

## Phase 0 — Setup

```bash
mkdir -p <project>/{src,assets/{bg,img},build,docs}
cd <project> && git init -q
```

**Dependency auto-install (allowed per skill contract)**:
```bash
command -v node >/dev/null || echo "needs node"
npm ls -g pptxgenjs 2>/dev/null | grep -q pptxgenjs || npm install -g pptxgenjs
# python-pptx is the primary parser (Phase 1.2 needs style + bbox info,
# not just plain text — markitdown loses style)
python3 -c "import pptx" 2>/dev/null || pip3 install --user --break-system-packages python-pptx
python3 -c "import markitdown" 2>/dev/null || pip3 install --user --break-system-packages "markitdown[pptx]"
command -v soffice >/dev/null || brew install --cask libreoffice
command -v pdftoppm >/dev/null || brew install poppler
```

Output: project skeleton ready. Commit: `baseline`.

---

## Phase 0.5 — Domain research (conditional — content-driven decks only)

For decks where **content quality decides the outcome, not the template** — 教案 / 说课 / 提案 / 行业分析 / 方案 / 竞标 / 培训课 — built from a rough idea (not a rebuild of an existing PPT), do a research pass BEFORE the outline. A beautiful template on hollow content loses; this phase is what made a real 班主任大赛说课 deck land (it surfaced the psychology theory, real award-winning lesson cases, and the competition's scoring rubric that the whole design then hung on).

**When to run**: input is a topic/idea AND the deck is one of the content-driven types above.
**When to SKIP**: rebuilding an existing `.pptx` (the content already exists — go straight to Phase 1), or a deck whose value is mostly visual (poster, brand cover, simple announcement).

### How — 2-3 focused agents, NOT a 5-angle fan-out

⚠️ **Do not default to the `deep-research` skill's 5-angle parallel fan-out for a focused brief — it over-spawns and burns budget.** A real run did this and the user stopped it. **2-3 focused agents is the right size** for almost any single deck's research. Only escalate to deep-research's full machinery if the user explicitly asks for exhaustive/cited research.

Typical 3-agent split (adapt per topic):
1. **Evidence / theory agent** — the domain's authoritative frameworks, models, named theorists, research backing (so every design choice can cite a "why").
2. **Real-cases agent** — real, existing best-practice / award-winning examples to borrow concrete structure from (not generic advice).
3. **Audience / scoring agent** — for a competition or pitch: the rubric, judging dimensions, common winning patterns, time/format constraints, how to frame the topic for that audience.

Dispatch all in ONE message (parallel Agent calls). Cap each agent's output (~800-1000 words, structured points, source links) so results are usable, not bloated.

### Output → `docs/调研要点.md`

Consolidate all agents' findings into one structured `docs/调研要点.md` — bullet points the outline and 讲稿 can directly draw on, with sources. Commit: `research: 调研要点`.

### After research, if there's a big direction fork → MULTI-PLAN PICK

If the research opens up genuinely different ways to design the deck (different angles, structures, emphases — not just cosmetic), don't silently pick one. **Render an HTML plan-comparison page** and let the user choose before committing the pipeline to one direction. See the next section.

---

## Multi-plan decision mode (HTML comparison page)

Use when there's a **big fork in "what to build"** — competing approaches, the user is unsure of direction, or research surfaced 3-4 viable designs. Don't argue it in prose paragraphs (the user can't compare); **build a single self-contained HTML page that lays the plans out side by side**, then let them pick. This was decisively better than a text description in a real run.

Each plan card should contain, at minimum:
- A one-line "what this is"
- The concrete flow (for a deck/lesson: a step-by-step / timeline of how it actually goes)
- A visual mockup of any key artifact (mock chart/wordcloud/card — seeing it beats describing it)
- Pros / watch-outs / theory backing / "who it fits"
- End with a clear recommendation (mark the recommended one ★) and note that combinations are allowed.

Style it in the deck's intended palette (it doubles as a design preview). Open it in the browser AND offer a PDF (the user often forwards it to a stakeholder — e.g. the actual teacher/client).

### ⚠️ HTML long-page → PDF: inject print CSS first

A continuous long HTML page (not paginated) printed to PDF will **slice cards across page breaks**. Before `--print-to-pdf`, add a `@media print` block:

```css
@media print{
  body{padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .plan,.core,.verdict,.sec,.barbox{break-inside:avoid;page-break-inside:avoid}
}
```

`-webkit-print-color-adjust:exact` keeps background colors (Chrome strips them by default in print). Then:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="out.pdf" "file:///abs/path/page.html"
```
Verify by rendering the PDF to JPGs and eyeballing that no card is cut — same reviewer discipline as Phase 6.

---

## Phase 1 — Content extract (detailed)

The biggest mistake here is rushing: grab text and skip the image/chart/structure work. That guarantees data loss or misaligned visuals downstream. Always do all 6 steps.

**Parallelism**: Step 1.1 must complete first (it produces the raw materials all later steps consume). After 1.1, steps **1.2, 1.3, 1.4 run in parallel** (each as its own subagent — they touch independent output files). Step 1.5 + 1.6 run after they all finish. Wall-clock savings ≈ 40-50% vs running 1.2-1.6 serially.

### Step 1.1 — Initial scan (3 tools in parallel)

```bash
mkdir -p <project>/extract
cd <project>

# Text extraction
python3 -m markitdown input.pptx > extract/extracted.md

# Images + raw XML (unpacks into extract/unpacked/)
python3 ~/.claude/skills/pptx/scripts/office/unpack.py input.pptx extract/unpacked/
# → extract/unpacked/ppt/media/image1.png ... imageN.png
# → extract/unpacked/ppt/slides/slide1.xml ... slideN.xml

# Visual overview
python3 ~/.claude/skills/pptx/scripts/thumbnail.py input.pptx
mv thumbnails.jpg extract/
```

Read `extract/thumbnails.jpg` + `extract/extracted.md` end-to-end to form a mental model of the deck before going further.

For non-pptx inputs:
| Input | Replace Step 1.1 with |
|---|---|
| Image (whiteboard / handwritten / screenshot) | Read with Vision; OCR via prompt; record transcription as `extract/extracted.md` |
| Text / `.md` / `.docx` | Direct read (Word: `pandoc -f docx -t markdown -o extract/extracted.md input.docx`) |
| Multiple mixed | Process each, concatenate to single `extract/extracted.md` |

### Step 1.2 — Structured semantic extraction (CRITICAL)

This is the make-or-break step for the whole pipeline. If Phase 3 builders are working from a flat blob of text, they bake in misinterpretations (treating an emphasis run as body, missing parent-child relationships, etc.). The result is the layout chaos seen in prior runs (multi-column collapse, undersized titles, lost red highlights).

**Tool**: NOT `markitdown` (loses style). Use **`python-pptx`** to parse each slide and extract per-textbox `(text, fontSize, bold, italic, color, x, y, w, h)`. Pair this with the agent's reasoning to assign each text run a **semantic role** + **hierarchy level**.

#### Fixed role enum (12 values — agent must pick from this list, never invent)

| Role | Signal | Builder behavior |
|---|---|---|
| `hero` | Largest text on slide, dominates space | Render at deck's largest size |
| `title` | Top-positioned, 2nd-largest, often bold | Page-title typography |
| `subtitle` | Below title, smaller, same horizontal anchor | Page-subtitle typography |
| `paragraph` | Body-sized text, > 30 chars, no list markers | Body run with line-height |
| `list` | Items prefixed `1.` / `·` / `①` / similar | Bulleted/numbered render |
| `stat` | Number-dominated (digits + optional unit), oversized | Big-number callout |
| `quote` | Wrapped in quotes / italic / centered-emphasis | Quote frame with attribution |
| `callout_label` | Short red/bold text, often above list/paragraph | Section label, drives `parent_to` |
| `card_title` | Heading inside a visually grouped block | Card header |
| `signature` | Small text at slide bottom (author/date/page) | Footer-style |
| `image_frame` | An image with caption underneath | Image + caption pair |
| `chart` | A chart-image whose data was extracted in Step 1.4 | Re-render natively OR embed PNG |

If the agent can't confidently classify a section, **default to `paragraph` + mark `confidence: low`** in the JSON. Don't block on uncertainty; the QA pass and Checkpoint 1 will catch misclassifications.

#### Output schema — `slides/p{NN}.json`

```json
{
  "page": 8,
  "layout_intent": "data-with-callout",
  "sections": [
    {
      "id": "s1",
      "role": "title",
      "level": 1,
      "text": "明确分值",
      "style": { "size_pt": 36, "color": "ink", "bold": true },
      "bbox": [0.4, 0.3, 9.5, 1.0],
      "confidence": "high"
    },
    {
      "id": "s2",
      "role": "stat",
      "level": 2,
      "text": "630",
      "unit": "分",
      "style": { "size_pt": 180, "color": "red", "bold": true },
      "bbox": [0.5, 1.8, 4.0, 2.5],
      "confidence": "high"
    },
    {
      "id": "s3",
      "role": "subtitle",
      "parent": "s2",
      "text": "2026 中考目标分",
      "style": { "size_pt": 18, "color": "ink", "bold": true },
      "confidence": "high"
    },
    {
      "id": "s4",
      "role": "paragraph",
      "text": "2026 物理、化学实验各加 10 分,合计中考新增 20 分 — 这是必须抓牢的\"附加分\"。",
      "confidence": "high"
    },
    {
      "id": "s5",
      "role": "callout_label",
      "text": "重点关注",
      "style": { "color": "red", "bold": true },
      "parent_to": "s6",
      "confidence": "high"
    },
    {
      "id": "s6",
      "role": "list",
      "items": [
        "物理化学实验操作 — 2026 中考各加 10 分,提前规范操作流程。",
        "建立\"第一遍认真做\"的习惯 — 避免重复返工,提升单位时间效率。",
        "家校协同盯紧目标 — 中考满分 660,目标 630 分,梯队稳推。"
      ],
      "confidence": "high"
    }
  ],
  "images": ["image3.png"],
  "emphasis": [
    { "text": "运动会", "color": "red" },
    { "text": "通力合作", "color": "blue" }
  ]
}
```

Notes on the schema:
- `id` — slide-local handle, used by `parent` / `parent_to` for relationships
- `level` — 1 = hero/title, 2 = subtitle/stat, 3 = body/paragraph (only on dominant sections; optional)
- `parent` / `parent_to` — express hierarchy (callout label belongs WITH the list it labels)
- `style` — preserve original size/color/bold from python-pptx (used by Phase 3 as anchor, not strict mandate)
- `bbox` — `[x, y, w, h]` in inches; optional but useful when original layout had meaningful positioning
- `emphasis` — slide-level list of inline-highlighted phrases; Phase 3 builder uses this to inject rich-text color runs on matching substrings
- `confidence` — `high` / `medium` / `low` per section; QA agents prioritize re-checking `low`

#### Extraction algorithm (agent runs this per slide)

```python
# Pseudocode — agent writes actual code at runtime
from pptx import Presentation
prs = Presentation("input.pptx")
for n, slide in enumerate(prs.slides, 1):
    raw = []
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                # collect runs with style + position
                raw.append({
                    "text": para.text,
                    "font_size": para.runs[0].font.size.pt if para.runs[0].font.size else None,
                    "bold": para.runs[0].font.bold,
                    "color": rgb_hex(para.runs[0].font.color),
                    "bbox": [shape.left, shape.top, shape.width, shape.height],
                })
        elif shape.shape_type == 13:  # Picture
            # collect image reference
            ...
    # Now hand `raw` to the LLM agent: "Given these textboxes with style + position,
    # assign each one a role from the fixed enum, infer hierarchy, output JSON."
```

The LLM reasoning step is doing the work `markitdown` can't: turning raw style data into semantic structure.

#### What Phase 3 builders gain

- `role: hero_stat` → automatic big-number-with-unit layout, no guessing
- `parent_to: list_1` → callout_label MUST touch the list top — no orphaning
- `emphasis: [{运动会, red}]` → render every "运动会" occurrence as red run — no manual rich-text per layout
- `level: 1/2/3` → font-size hierarchy maps directly to design tokens
- `confidence: low` → reviewer agents focus there first

Result: layouts deterministic from data; visual consistency dramatically higher than "agent infers from prose."

### Step 1.3 — Asset categorization → `docs/ASSET_PLAN.md`

For every image in `extract/unpacked/ppt/media/`, agent default-fills a decision:

```markdown
# Asset Plan

| Image     | Content (agent's guess) | Decision | Notes |
|-----------|-------------------------|----------|-------|
| image6.png| 奖状 卓越班级            | DUOTONE  | 文档类 |
| image7.png| 奖状 特等奖              | DUOTONE  | 文档类 |
| image18.png| 手写电子产品公约         | DUOTONE  | 手写类 |
| image20.png| 家委合影 (8 人)          | KEEP     | 人像 — 中国文化禁忌灰度 |
| image5.png | 截图（模糊）             | DROP     | 质量差 |
| image11.png| 与 image10 重复          | DROP     | 重复 |
```

**Default rules** the agent applies (in order):
1. Photo with identifiable people → `KEEP` (color)
2. Award certificate / handwritten note / document scan → `DUOTONE`
3. Logo / icon → `KEEP`
4. Chart / data screenshot → `CHART` (handle in Step 1.4) — **MANDATORY, see below**
5. Blurry / low-res (<400px short edge) → `DROP`
6. Visual duplicate (perceptual hash match) → `DROP` for all but first
7. Decorative texture / background → `DROP`

### ⚠️ Hard rule — never KEEP a chart screenshot

Any image that visually contains a **chart, graph, plot, trend line, bar chart, pie chart, data table screenshot, or analytics-UI screenshot** (Google Trends, Etsy stats, GA dashboards, etc.) — agent MUST classify as `CHART`, not `KEEP`. No exceptions.

Tempting bad reasoning to reject:
- ❌ "The shape/trajectory IS the content, OCR can't capture it" — false. Peak times + rough magnitudes + overall direction (rising/flat/declining) are extractable and sufficient to re-render natively.
- ❌ "OCR isn't accurate enough" — accuracy 80% is fine; agent flags `confidence: medium` and user confirms at Checkpoint 1.
- ❌ "Re-rendering takes too long" — Phase 1.4 OCR is ~30s per chart, Phase 3 native render is ~1 min. Total 5-10 min for typical deck. Skipping it leaves UI screenshots that visually clash with the rest of the deck (real bug from prior P2H2P run — competitor pages had Google Trends screenshots pasted into otherwise editorial-clean slides; jarring).

Decision matrix:
| Image shows... | Decision |
|---|---|
| Line / bar / pie chart with discrete data points | `CHART` |
| Analytics dashboard screenshot (multiple widgets) | `CHART` (each widget = one chart entry in TABLES.md) |
| Trend graph (Google Trends, etc.) | `CHART` |
| Spreadsheet screenshot | `CHART` |
| Infographic with mostly text + minor chart | `KEEP` (treat as image — too complex to re-render) |
| Hand-drawn diagram | `KEEP` (no clean data to extract) |
| Photo, logo, decoration | per rules 1-3 / 5-7 above |

If in doubt → `CHART`. Phase 1.4 OCR + Phase 1 Checkpoint user review will catch any mis-classification. KEEP is only safe when you're SURE the screenshot has no extractable structured data.

### Step 1.4 — Chart screenshot data extraction → `docs/TABLES.md`

For any image classified `CHART` in Step 1.3, agent must read the image and OCR the data points:

```markdown
# Tables / Chart Data

## image12.png — 各科均分柱图 (P12)

agent_extracted:
| 科目 | 均分 | 满分 | 排名 |
|------|------|------|------|
| 语文 | 80.0 | 120  | 1    |
| 数学 | 74.7 | 120  | 1    |
| ...

**confidence**: medium — value 74.7 might be 74.1 (image blur)
**need user confirm**: ✅
```

Bundle ALL chart data extractions into one `TABLES.md` for the user to confirm at Checkpoint 1. Don't lose them in separate files.

### Step 1.4b — Font inventory → `docs/FONTS.md`

Original PPT carries font choices that reflect the designer's intent — substituting them silently with generic system fonts (Noto Sans SC etc.) strips visual personality. But keeping originals risks broken rendering on machines that lack them. The skill must NOT decide this alone; the user picks per font.

**Auto-extract during Phase 1.2** (free side-effect of python-pptx parsing — every text run already has `font_name`):

```python
from collections import Counter
font_usage = Counter()
for slide in raw_shapes:
    for shape in slide['shapes']:
        for para in shape.get('paragraphs', []) or []:
            for run in para.get('runs', []) or []:
                name = run.get('font_name')
                if name:
                    font_usage[name] += 1
# → write to docs/FONTS.md with decision column for user
```

**`docs/FONTS.md` schema** (agent default-fills the "Recommend" column; user edits):

```markdown
# Font Inventory

| Font | Used | Type | License risk | Cross-machine | Recommend | Your decision |
|------|------|------|--------------|---------------|-----------|---------------|
| 魏碑-简 | 8 runs | CJK display, calligraphic | commercial / unknown | rare | KEEP-with-fallback | _ |
| 得意黑 | 47 runs | CJK display, trendy | 蒙纳 commercial | rare | KEEP-with-fallback | _ |
| Arial | 12 runs | Latin sans | free | universal | KEEP | _ |
| Calibri | 3 runs | Latin sans (MS) | free | universal | KEEP | _ |
```

**Recommend rules** (agent default-fills):
- Free open-source CJK (Noto/Source Han/思源/微软雅黑/PingFang) → `KEEP`
- Commercial CJK display (得意黑/方正/汉仪/造字工房/etc.) → `KEEP-with-fallback` (default Noto Sans SC if missing)
- Latin web-safe (Arial/Helvetica/Times/Calibri) → `KEEP`
- Rare/unknown → `KEEP-with-fallback`
- User MAY change to `REPLACE-WITH:<font>` to swap intentionally

**Three decision values** the user can write in the "Your decision" column:
- `KEEP` → use exactly as in original (will break on machines lacking the font)
- `KEEP-with-fallback` → put original FIRST in font-family chain, then Noto Sans SC as fallback → original-machine sees original, other machines see Noto
- `REPLACE-WITH:<font>` → strip original entirely, use the named font

These decisions feed into Phase 3's `tokens.css` generation:

```css
/* If 得意黑 → KEEP-with-fallback: */
--font-cjk-display: "得意黑", "Noto Sans SC", "PingFang SC", sans-serif;
/* If 得意黑 → REPLACE-WITH: Noto Sans SC: */
--font-cjk-display: "Noto Sans SC", "PingFang SC", sans-serif;
```

### ⚠️ Hard rule — agent NEVER silently replaces fonts

Past P2H2P run silently substituted `魏碑-简` + `得意黑` (original PPT's design choice) with `Noto Sans SC` because tokens.css fallback chain put Noto first. Result: deck lost the punk/calligraphic character the user had originally designed. The fix is FONTS.md + Checkpoint 1 review — agent must SHOW the original fonts and ASK before changing the chain order.

### Step 1.5 — Smart repair pass (text only, conservative)

Apply ONLY these transforms to text fields in each `slides/p{NN}.json` (and the legacy `extract/extracted.md` if downstream tools want it):
- Strip leftover English template captions (`A NOTE TO PARENTS`, `FIRST PASS`, `THANKS`, etc.)
- Collapse duplicate punctuation (`,,` → `,`, `。。` → `。`)
- Fix obvious OCR artifacts (`l` → `1` in number contexts, etc.)

**NEVER**:
- Alter numbers, names, scores, dates, percentages
- Paraphrase or "improve" sentences
- Reorder content within a slide
- Compress lists

### Step 1.5b — De-AI pass on ANY agent-authored Chinese prose (MANDATORY)

⚠️ Distinct from Step 1.5. Step 1.5 cleans *original PPT text* conservatively (never rewrites). THIS step targets Chinese prose the **agent itself generated** — and that text MUST be run through the `humanizer-zh` skill before it reaches the user or gets baked into slides.

**Trigger — whenever the agent writes new Chinese long-form text**, including:
- A 说课稿 / 讲稿 / 逐字稿 / narration script (the most common case for input=prompt decks)
- Slide body copy, card paragraphs, section intros the agent composed from scratch (not copied from source)
- Any 大纲 description, 金句, or 文案 the agent invented

**Do NOT trigger** for: text copied verbatim from the user's source PPT/doc (that's Step 1.5's conservative territory — don't "improve" the user's own words), pure data/numbers/labels, or English copy.

**How**: invoke the `humanizer-zh` skill on the drafted Chinese, apply its checklist (translation-ese, empty big words, formulaic contrast frames, sloganized endings, list inflation, rule-of-three, robotic rhythm), then save the de-AI'd version as the canonical text. For a 讲稿, run it on the whole script in one pass; for slide copy, run it per page batch.

**Order**: draft → `humanizer-zh` → THEN show user at Checkpoint 1 / bake into `slides/p{NN}.json`. Never present raw first-draft AI Chinese as final — the user (fangailun) flags AI-flavored 中文 on sight; this is a hard preference, not optional polish. See `[[feedback_dezh_ai_via_humanizer_zh]]`.

Log in `docs/AUTO_DECISIONS.md` that the de-AI pass ran (one line) so it's auditable.

#### Also deliver the script as an editable `.docx`

Whenever a 讲稿 / 说课稿 / 逐字稿 / narration script is produced, after the de-AI pass, ALSO export it to `docs/讲稿.docx` (or `说课稿.docx` — match the script's actual name) so the user can edit it directly in Word without touching markdown. The `.md` stays the working copy; the `.docx` is the user-facing editable deliverable.

Convert with pandoc if available, else fall back to a small python-docx script (pandoc is often NOT installed on the user's mac — don't assume it):

```bash
command -v pandoc >/dev/null && pandoc "docs/说课稿.md" -o "docs/说课稿.docx" \
  || python3 src/md2docx.py "docs/说课稿.md" "docs/说课稿.docx"   # python-docx fallback
```

A reusable `md2docx.py` (PingFang SC body, bold 【环节·时长】 markers in warm accent, 1.5 line spacing, drops `**`/`---`) lives at `~/.claude/skills/p2h2p/assets/md2docx.py` — copy it into the project's `src/` on first use.

If the user later edits the `.docx`, re-ingest it (`pandoc -f docx -t markdown`) before regenerating slides — the `.docx` is the user's edit surface, the `.md` is the pipeline's. Mention the `.docx` path when posting the script for review at Checkpoint 1.

### Step 1.6 — Outline → `docs/OUTLINE.md`

The deck-level plan. Agent generates default by reading every `slides/p{NN}.json`; user reviews at Checkpoint 1. **OUTLINE shows the high-level view; the per-section structure lives in the JSON files and doesn't need direct review.**

```markdown
# 38-slide Outline

| Page | Layout type    | Title (from JSON s1)            | Source         | Notes (low-confidence sections) |
|------|----------------|----------------------------------|----------------|----------------------------------|
| 01   | cover          | 做孩子成长的合伙人               | p01.json       | —                                |
| 02   | chapter-divider| 一、半学期班级工作               | new            | —                                |
| 03   | catalogue-4    | 1. 半学期班级工作 — 明确规则…    | p02.json (P02) | s5 confidence:low (role guess)   |
| ...
```

Outline can re-number, insert chapter dividers, drop pages — but each row points to source content in `slides/p{NN}.json`. **Never lose the source link.** The `Notes` column surfaces any sections where role-inference confidence is `low`, so user can spot-check those JSON files specifically.

### Final folder structure after Phase 1

```
<project>/
├── extract/                    ← auto, immutable
│   ├── extracted.md            ← markitdown output
│   ├── thumbnails.jpg          ← page overview grid
│   └── unpacked/               ← unpack.py output (XML + raw media)
│       └── ppt/media/imageN.png
├── slides/                     ← per-slide structured semantic data (Step 1.2)
│   ├── p01.json ... p38.json
├── assets/
│   ├── raw/                    ← copies of unpacked images (untouched)
│   └── processed/              ← populated in Phase 3 from ASSET_PLAN
└── docs/
    ├── OUTLINE.md              ← deck-level plan (Step 1.6)
    ├── ASSET_PLAN.md           ← per-image decisions (Step 1.3)
    ├── TABLES.md               ← chart data extracted (Step 1.4)
    └── FONTS.md                ← per-font keep/fallback/replace decisions (Step 1.4b)
```

Commit after Phase 1 completes: `phase 1: extracted + cataloged`.

### ⏸️ CHECKPOINT 1 (consolidated)

Post the message AND schedule the wakeup in the same response (atomic). No exceptions.

Message to user:
> "Phase 1 完成 — 请一并审：
>
> 1. **大纲** `docs/OUTLINE.md` — N 页，可改顺序/增删/重命名；`Notes` 列标了 confidence-low 的页码
> 2. **图片决策** `docs/ASSET_PLAN.md` — 每张图已默认填 KEEP/DUOTONE/DROP/CHART
> 3. **图表数据** `docs/TABLES.md` — 从截图 OCR 出的数据点，请核对 medium-confidence 的
> 4. **字体决策** `docs/FONTS.md` — 原 PPT 用了哪些字体 + 默认建议；可改 KEEP / KEEP-with-fallback / REPLACE-WITH
>
> 仅当 OUTLINE `Notes` 列提示某页 confidence:low 时，再打开对应 `slides/p{NN}.json` 检查 role 推断对不对。其它页 JSON 不需要看。
>
> 改完任意文件，说 'continue' 进 Phase 2 模板选择。5 分钟没回应我默认全部通过。"

Then immediately:
```
ScheduleWakeup(
  delaySeconds: 300,
  reason: "Checkpoint 1 timeout — auto-accept outline/assets/tables, proceed to Phase 2",
  prompt: "Checkpoint 1 timeout fired. Check git log for any user-driven commits to
          docs/OUTLINE.md / docs/ASSET_PLAN.md / docs/TABLES.md since checkpoint posted.
          If yes → proceed with user's edits. If no → append timeout entry to
          docs/AUTO_DECISIONS.md and start Phase 2 (template selection)."
)
```

If user responds before fire, just continue normally. The wakeup will harmlessly fire later and find the project already advanced.

---

## Phase 2 — Template selection

**Delegate to beautiful-html-templates skill.** Per its Step 2-4:
- Read `~/.claude/skills/beautiful-html-templates/source/index.json` (46 templates as of 2026-05-24; 34 original + 12 ported from frontend-slides)
- Pick 3 candidates matched to outline tone (formal/playful/professional/vintage)

### ⚠️ Respect `ppt_compat` when filtering for P2H2P

Some templates ship with `ppt_compat: "lossy"` or `"html-only"` (the frontend-slides ports — Neon Cyber, Terminal Green, Creative Voltage, Dark Botanical, etc.). Because P2H2P always delivers a `.pptx`, the picker MUST:

- **Default**: only surface candidates where `ppt_compat == "clean"` OR field is absent (the 34 original templates predate the flag and are all PPT-friendly).
- **`lossy` may still be picked** if the outline tone is a strong match (e.g. user explicitly wants Terminal Green for a devtools deck). When offered, prefix the candidate description with "⚠️ lossy — decoration baked as PNG in .pptx".
- **`html-only` is excluded from P2H2P** entirely (Neon Cyber's neon glow can't be reproduced). If the user explicitly asks for it, surface and warn that .pptx will be a static PNG dump per slide.

The flag lives in each template's `template.json` and in the `index.json` entry for ported templates. Read it before showing candidates.

### Tone → preset picker rule (seed map)

Use as a starting point when scoring candidates against outline tone. Not exclusive — always allow the agent to find a better match from the full 46-template pool.

| Outline tone / occasion | Preferred preset shortlist (ppt_compat) |
|---|---|
| Founder pitch / product launch / marketing keynote | `bold-signal` (clean), `electric-studio` (clean), `cobalt-grid` (clean) |
| Consulting / strategy / sales deck | `electric-studio` (clean), `signal` (clean), `blue-professional` (clean) |
| Investor / board / legal / institutional | `signal` (clean), `swiss-modern` (clean), `vintage-editorial` (clean) |
| Research synthesis / annual letter / longform | `notebook-tabs` (clean), `paper-and-ink` (clean), `editorial-forest` (clean) |
| Brand manifesto / founder essay / agency creative | `vintage-editorial` (clean), `creative-voltage` (lossy), `bold-poster` (clean) |
| Consumer / lifestyle / wellness / kids product | `pastel-geometry` (clean), `split-pastel` (clean), `daisy-days` (clean) |
| Luxury / beauty / hospitality / fine arts | `dark-botanical` (lossy), `vellum` (clean), `editorial-tri-tone` (clean) |
| Architecture / design portfolio / academic | `swiss-modern` (clean), `paper-and-ink` (clean), `monochrome` (clean) |
| Devtools / hackathon / web3 / AI infra | `terminal-green` (lossy), `neon-cyber` (html-only — warn), `8-bit-orbit` (clean) |
| Campaign / events / culture / festival | `split-pastel` (clean), `creative-voltage` (lossy), `biennale-yellow` (clean) |

### Use pre-rendered template thumbnails

Templates' cover thumbnails should be **pre-rendered once at skill-install time** and cached at `~/.claude/skills/beautiful-html-templates/source/_thumbs/<slug>.jpg` (1280×720 each). Phase 2 just symlinks/copies the 3 chosen thumbs to `previews/` and points the user at those — no per-invocation rendering. Savings: ~3-5 minutes per deck.

Current cache state (2026-05-24): 15 thumbs pre-rendered (3 original + 12 frontend-slides ports). The other 31 original templates render on demand the first time they're picked — populate the cache with the same Chrome-headless command the factory used (see `~/.claude/skills/beautiful-html-templates/source/_thumbs/` for examples).

If the cache is missing (first install, post-update), render on demand AND populate the cache for next time:

```bash
mkdir -p ~/.claude/skills/beautiful-html-templates/source/_thumbs
for tmpl in ~/.claude/skills/beautiful-html-templates/source/templates/*/; do
  slug=$(basename "$tmpl")
  thumb=~/.claude/skills/beautiful-html-templates/source/_thumbs/$slug.jpg
  [ -f "$thumb" ] && continue  # already cached
  # Render <tmpl>/template.html cover slide → $thumb via Chrome headless
done
```

### ⏸️ CHECKPOINT 2

Post the message AND schedule the wakeup atomically:

> "3 个模板候选已打开:
> 1. <slug A> — <tone>
> 2. <slug B> — <tone>
> 3. <slug C> — <tone>
> 选哪个？5 分钟后我默认用 #1。"

Then immediately:
```
ScheduleWakeup(
  delaySeconds: 300,
  reason: "Checkpoint 2 timeout — auto-pick candidate #1, proceed to Phase 3",
  prompt: "Checkpoint 2 timeout fired. Check if user picked a template. If yes → use it.
          If no → append timeout entry to docs/AUTO_DECISIONS.md, copy candidate #1's
          template files into the project, and start Phase 3 (HTML build)."
)
```

---

## Phase 3 — HTML build (the heavy lifting)

**Delegate to beautiful-html-templates skill's Step 5.** Add P2H2P-specific orchestration:

### Step 3.1 — Pin design tokens FIRST

Write `src/tokens.css` with all design variables (colors / font sizes / spacing / role→style map) BEFORE fanning out builders. Every subagent must reference these tokens and is **forbidden from inventing px or hex values**. The token file is the single source of visual consistency.

### Step 3.2 — Fan out builders, max ~7 pages each

Slice the outline into chunks of up to 7 pages each. Spawn 5-8 builder subagents in parallel via background `Agent` calls. Each gets:
- Their slide range (and the corresponding `slides/p{NN}.json` files)
- `src/tokens.css`
- HTML screenshot of the chosen template's reference pages for visual anchoring
- Strict instruction: "use slide JSON's `role` + `level` + `parent` + `emphasis` fields to drive your layout — don't infer structure from prose"

### Step 3.3 — Mini-reviewer + auto-fix loop (per builder, mandatory)

This loop is what makes Phase 6 (final QA) almost a no-op. Don't skip it.

For each builder result (the moment its task completes):

```
1. Render its slides to JPGs (soffice + pdftoppm at 100dpi)
2. Spawn mini-reviewer (≤ 8 image reads):
   - Inputs: chosen template's reference cover + this builder's output JPGs
   - Task: "Diff result against template intent. List critical/high/medium issues."
3. If critical or high issues found:
   a. SendMessage to SAME builder with the punch list + "fix and report back"
   b. Wait for builder fix
   c. Go to step 1 (re-render, re-review)
4. Repeat the loop max 3 times.
5. If still has critical issues after 3 loops → mark these pages "needs-fallback"
   and continue with whatever the builder produced. Phase 6 will catch what's left.
6. If only medium/low issues remain → accept and move on.
```

The AI runs this loop autonomously — no user involvement. Token cost is real (each cycle = 1 builder + 1 reviewer call) but pays off in not needing per-page fixes in Phase 6.

### Step 3.4 — Recursive shard-and-retry on builder failure

When a builder crashes (OOM, code error, no output file), apply hard contract #4:

```
1. Retry same builder with same scope ONCE.
2. If second attempt fails → split scope in half, dispatch 2 new builders.
3. Each new builder hits same retry policy (step 1-2 above).
4. Recurse until a single page fails alone — only then fall back
   to the degraded text-dump renderer for that one page.
5. Log the recursion path + any fallback pages to docs/AUTO_DECISIONS.md.
```

Example: 8-page builder fails twice → split to 4+4. Left 4 succeeds. Right 4 fails twice → split to 2+2. Both 2-page chunks succeed. Result: 8 pages rendered, 0 fallbacks. Compared to old behavior (whole 8 pages fall back to text dump), this is a huge win.

### Step 3.5 — Image processing (smart judgment per image)

Apply the decisions from `docs/ASSET_PLAN.md`:
- `KEEP` → copy original to `assets/processed/<name>__color.png`
- `DUOTONE` → ImageMagick: `magick input -resize 1600x1600\> -colorspace Gray -level 5%,95% +level-colors "#3A2516,#F1E6CB" output__duotone.png`
- `DROP` → skip (don't copy)
- `CHART` → use `assets/raw/<name>.png` as full-slide background OR re-render natively (decided per slide in Phase 5)

### Step 3.6 — Commit per builder

Each builder's successful result gets its own `phase 3: built p{N}-p{M}` commit. If a builder cycles through Step 3.3 fixes, commit after the final accepted version. This makes Phase 6 fixes easier to bisect.

### Universal rules (inherited from beautiful-html-templates SKILL.md)
- CJK font stack: `Noto Sans SC` → `微软雅黑` → `PingFang SC`
- Cancel English-only typography on CJK (`.cjk-body` override)
- No regex on HTML structure — use DOM parser if needed
- Subagent ≤ 8 image reads per task

**Output**: `index.html` fully populated. Plus `docs/AUTO_DECISIONS.md` updated with any fallback pages.

---

## Phase 4 — HTML preview

```bash
open <project>/index.html
```

### ⏸️ CHECKPOINT 3

Open index.html in browser, post message AND schedule wakeup atomically:

> "HTML deck 跑完了:
> /abs/path/to/index.html
>
> 自己用方向键/空格翻页过一遍。OK 我转 PPT；不 OK 列页码 + 问题，我修。5 分钟没回应我默认 OK 继续。"

Then immediately:
```
ScheduleWakeup(
  delaySeconds: 300,
  reason: "Checkpoint 3 timeout — auto-OK, proceed to Phase 5 (PPT generation)",
  prompt: "Checkpoint 3 timeout fired. Check if user responded with 'OK' or a fix list.
          If fix list → loop back into Phase 3, address, re-open, re-schedule.
          If no response → append timeout entry to docs/AUTO_DECISIONS.md and start
          Phase 5 (HTML → PPT via pptxgenjs)."
)
```

**If user gives a fix list**: loop into Phase 3 with the punch list, apply fixes, re-open, and re-schedule a new wakeup. Don't proceed to Phase 5 until user approves OR timeout fires with no response.

---

## Phase 5 — HTML → PPT

**Delegate to pptx skill.** Architecture decision per page (decided automatically):

| Page type | Strategy |
|---|---|
| Cover / chapter divider / colophon | PNG background (hide-text + Chrome screenshot) + native textbox overlays |
| Card grids / lists / tables (text-heavy) | Pure pptxgenjs native shapes |
| Data charts / complex viz (clip-path / SVG / rotated) | Full PNG screenshot of the page |

Build script template (in pptx skill's `pptxgenjs.md`):
- `src/tokens.js` mirrors `tokens.css` (colors as hex without `#`, fonts as PowerPoint font names). **If the chosen template ships a `tokens.js` (all frontend-slides-ported templates do — check `~/.claude/skills/beautiful-html-templates/source/templates/<slug>/tokens.js`), copy it into the project as the starting point instead of re-deriving from `tokens.css`.** Saves a step and guarantees PPT colors match the HTML preview exactly.
- `src/layouts/<layout>.js` per layout type
- `src/build.js` dispatcher with try/catch + fallback per slide
- `src/content.json` extracted from HTML (one slide = one object)

If the chosen template has `ppt_compat: "lossy"`, read its `ppt-notes.md` for slide-specific translation guidance (which decoration to bake as PNG vs. which textboxes can render natively). The notes file is short and prescriptive — read it before writing the build script.

Auto-render → `build/<filename>.pptx`.

### ⚠️ Step 5.1 — Build script invariants (page-count derivation)

**Never hardcode `TOTAL` or per-page numbers.** Page count, page-number chips, and dispatcher order MUST all derive from a single source-of-truth array. Otherwise inserting / removing / reordering a single page leaks stale "NN / 12" chips into a 14-page deck — a real bug that took 3 cleanup commits to chase in one session.

❌ **Anti-pattern (lived bug)**:
```js
const TOTAL = 12;                                    // hardcoded
function buildP01() { /* ... */ paintChrome(s, 1);   // hardcoded
                       s.addText("01 / 12"); }       // hardcoded again
function buildP02() { /* ... */ paintChrome(s, 2); }
// ... 12 hardcoded calls below
buildP01(); buildP02(); /* ... */ buildP12();
```
When you add a break page between P02 and P03, you must remember to: bump `TOTAL`, renumber every `paintChrome(s, N)`, find every string-concatenated `"NN / 12"` chip, and update the dispatcher. Miss any one and the deck ships with mismatched pagination.

✅ **Required pattern**:
```js
const SLIDES = [
  { id: "cover",  builder: buildP01 },
  { id: "toc",    builder: buildP02 },
  { id: "break1", builder: buildBreak1 },        // insert here ↓
  { id: "p03",    builder: buildP03 },
  // ...
];
const TOTAL = SLIDES.length;                     // derived, single source
SLIDES.forEach((s, i) => s.builder(i + 1));      // pageIdx passed in
```

Then every builder accepts `pageIdx` and forwards: `function buildP01(pn) { paintChrome(s, pn); ... }`. The page-chip text is composed as `String(pn).padStart(2,"0") + " / " + String(TOTAL).padStart(2,"0")` — never as a literal string. Inserting a slide becomes a one-line edit; nothing else needs touching.

This rule applies to the **cover page too** (which often skips `paintChrome` and writes its own "01 / NN" chip).

---

## Phase 6 — Final QA

Phase 6 is a **commit-gate**, not optional polish. Per Hard contract #6, no build ships without a passing reviewer-pass — `node build.js` exiting 0 does NOT prove the rendered output is correct.

### Two reviewer passes (mandatory, in order)

Both passes use the same render pipeline (`soffice + pdftoppm → build/full-NN.jpg`) but ask different questions of different reviewer agents.

#### Pass 1 — Layout reviewer (catches: overflow / collision / wrap)

**⚠️ Mandatory sharding for speed**: a single reviewer agent inspecting N images reads them serially — and serial image reads dominate wall-clock time. Lived measurement: one Pass 1 agent on 9 images took **17 minutes**; the same prompt re-run on the same 9 images via 3 parallel agents (3 images each) took **under 30 seconds total**. The image-read budget is per-agent, not per-pass.

**Sharding rule**: cap each Pass 1 reviewer at **≤ 4 images**. Compute shard count as `ceil(N / 4)`. Dispatch all shards in a SINGLE message with multiple Agent tool calls in parallel (not sequential). Each shard runs the same prompt below over its slice of pages; the orchestrator aggregates findings after all shards return.

Example: 9-page deck → 3 shards × 3 pages each, all dispatched together. 14-page deck → 4 shards (4 + 4 + 3 + 3). Never give a single Pass 1 agent more than 4 pages.

Prompt each shard with its rendered JPGs and ask **3 closed yes/no questions per page**, NOT open-ended visual feedback:

```
For each page JPG, answer yes/no:
1. Is any text visibly overlapping with another text or shape on the same page?
2. Is any text overflowing its visible container (cut off, wrapped onto adjacent
   element, or extending past slide edge)?
3. Is any number, label, or caption rendering at a size that makes adjacent
   columns / siblings read as a single element (e.g. "07" and "14" in adjacent
   cells with < 0.4" gap reading as "0714")?

For every "yes", report page number + 1-line description. Do NOT propose fixes.
```

Closed questions because open-ended "review the design" produces vague reports the agent then has to re-interpret. Yes/no answers cluster by failure mode for batched fixes.

**Common layout bugs this pass catches** (all real bugs from past sessions):
- 380pt chapter-number glyphs overflowing their bbox onto the chapter title below
- "FIG / DAILY SALES · 30D" caption colliding with "PEAK 8 / DAY" badge sharing the same row
- "75K" stat where "K" wraps to a new line because container is 1.55" but glyph needs 2.0"
- Mono footer wrapping at "OIL / PAINTING" because container width was estimated wrong by 20%

#### Pass 2 — Content reviewer (catches: filler, redundant info, "so what")

Spawn ONE agent (this pass is more semantic, doesn't shard well). Prompt with all rendered JPGs and ask **3 questions per visual block** (NOT per page — per block):

```
For each non-decorative visible block on each page, answer:
1. What does this element tell the reader? (1 sentence)
2. Is this same info already shown elsewhere on this page, or in the persistent
   page chrome (header band, page number, footer)?
3. If you removed this block, what would the reader actually lose?

FLAG any block where Q1 is empty/meta, Q2 is yes, OR Q3 is "nothing".

Common offenders to flag aggressively:
- Stat panels containing deck metadata ("07 CHAPTERS / 14 SLIDES") instead of business stats
- Footer captions restating the page title or report date that's already in chrome
- Decorative chips with no readable label, no data, no semantic role
- "Filler" boxes added because a layout had empty space
```

This was added after a real bug: P02's TOC right-side panel said "07 CHAPTERS / 14 SLIDES / ETSY · OIL PAINTING · 2026.02" — every word was either already on the page (page chip already shows 02/14) or was the deck talking about itself. Reader gained zero insight from a high-visual-weight yellow card. Pass 1 wouldn't catch this — only "so what?" would.

### Fix discipline

1. **Aggregate findings by failure mode, not by page** (per beautiful-html-templates "Fix batching" rule). 5 captions colliding across 4 pages is ONE fix to the helper, not 4 fixes.
2. **Structural fixes first** (one edit fixes N pages — e.g. shorten a caption constant, widen a container, fix a layout helper). Per-page nitpicks last.
3. **⚠️ Batch ALL planned fixes before the next rebuild — do NOT render-verify between individual edits.** Each `node build.js && soffice && pdftoppm` cycle is 30-60s wall-clock. With 4 separate fix-then-verify rounds, you burn 4× that just rebuilding, plus your own time reading 4 rounds of screenshots. Make every edit Pass 1 + Pass 2 flagged in a single edit batch, THEN rebuild + render + re-run both passes once. Trust the code edits; the next reviewer pass IS your verification — that's what it's for. The exception is when a single fix is high-risk (touches the layout engine itself) and you want to confirm it didn't cascade — render then, but only then.
4. **Rebuild, re-render, re-run BOTH passes** after the batched fixes. The new render may have shifted other elements. Loop until both passes return zero flags.
5. **Commit only after both passes are clean.** Output: `docs/qa_report.md` (with both pass reports), final `.pptx`, full set of `build/full-NN.jpg` committed for diff-ability.

### What this pass is NOT

- Not a substitute for the user-facing Checkpoint 3 (HTML preview) — that's about *outline & content choices*, this is about *render fidelity & visual quality*.
- Not optional polish — see Hard contract #6. If you're tempted to skip "because the build script succeeded", re-read the contract.
- Not the user's job — asking "does this look OK?" to a user with no rendered context is outsourcing your own QA. Run the passes first, then surface any unresolvable issues.

---

## Iteration mode

When user re-invokes P2H2P on an existing project (e.g. "改 P05 字号大点" / "把 P12 改成彩色" / "加一页 P39 致谢"), don't restart from Phase 0 — detect the project's progress state and resume from the right phase.

### Detecting project state

Look for artifacts produced by each phase. The most-advanced artifact present tells you where to resume:

| Found in project dir | State | Resume from |
|---|---|---|
| `build/*.pptx` | Full pipeline ran to completion | **Iteration mode** (see below) |
| `index.html` + no `build/*.pptx` | Phase 3 done, Phase 5 incomplete | Phase 4 (HTML preview) |
| `docs/OUTLINE.md` + no `index.html` | Phase 1 done, Phase 2/3 incomplete | Phase 2 (template selection) |
| `extract/extracted.md` + no `docs/OUTLINE.md` | Phase 1 mid-run, interrupted | Resume Phase 1 from Step 1.2 |
| None of the above | New project | Phase 0 |

Use `git log --oneline` to cross-check — each phase commits with a marker (`baseline`, `phase 1: extracted + cataloged`, `phase 3: html built`, etc.). If `git log` shows phase N completed but the expected file is missing, something went wrong — ask user before continuing.

### Iteration mode (project already complete)

When `build/*.pptx` exists, the user is asking to tweak an already-shipped deck. Default flow:

1. **Skip Phases 0-2 entirely** — project, content, template are all chosen and don't change
2. **Parse user request** to identify scope:
   - Single text/style edit on one page → "small patch"
   - Add/remove/reorder pages → "structural change"
   - Change template / overall visual → not iteration; ask user to confirm full rebuild
3. **Apply edit to `index.html`** (Phase 3 partial — only touch affected pages/CSS)
4. **Re-open `index.html`** for confirm (mini Checkpoint 3)
5. **Regenerate PPT** — run Phase 5's `node src/build.js`. Never hand-edit `.pptx`; it's regenerable.
6. **QA scope**: skip Phase 6 full re-QA for small patches; run reviewer agent only on affected pages for structural changes.
7. **Commit** the iteration as a new commit on top of the existing git history.

### Critical rule

**HTML is the source of truth. `.pptx` is regenerable.** Never edit `.pptx` XML directly as a "shortcut" — it desyncs HTML and PPT, and the next iteration breaks. If you find yourself reaching for XML editing tools, stop and edit HTML instead.

---

## Morning report contract

When Phase 6 completes (especially after long autonomous runs), write `docs/MORNING_REPORT.md` containing:

1. Git history summary (one line per commit)
2. What was built, with stats (N slides, file size)
3. **What's still imperfect** (deferred fixes, known issues) — be honest
4. **Font tip** — Windows: enable "Embed fonts in file" before saving for USB transport
5. **What to look at first** — point user at 2-3 specific pages most worth checking
6. Next-step suggestions if user wants further polish

---

## Cross-references

- **Template picking + HTML generation**: `~/.claude/skills/beautiful-html-templates/SKILL.md`
- **HTML→PPT conversion + pptxgenjs API + visual QA**: `~/.claude/skills/pptx/SKILL.md`
- **pptxgenjs detail**: `~/.claude/skills/pptx/pptxgenjs.md`
- **Existing PPT editing (alternative path)**: `~/.claude/skills/pptx/editing.md`

This skill orchestrates; those skills do the work. When in doubt about a specific technical detail (e.g., how pptxgenjs handles fonts), defer to the underlying skill.

---

## Lessons baked in (from prior runs)

- **Visual reference > description** for any reviewer agent — always give the target screenshot side-by-side
- **Subagent context budget ≈ 8 image reads** — shard reviewers accordingly
- **Batch fixes by file, not by page** — 5-10 edits beat 30+ piecemeal patches
- **PNG background + textbox overlay**: inspect PNG empty regions BEFORE placing text on top — same-color text on same-color shape disappears
- **Smart routing logic must inspect actual data** — `python -c "import json"` the content first, write the rule second
- **Chinese cultural rule**: B&W photos of living people = inauspicious. Confirm before greyscaling group photos / portraits.
- **Projection font sizes**: body min ≥ 15pt (17-18pt better) for back-of-room readability
- **CSS specificity**: when a color refuses to apply, the rule IS there but a later equal-specificity selector wins. Bump specificity, don't `!important`.
