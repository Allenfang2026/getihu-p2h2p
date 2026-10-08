---
name: p2h2p
description: "End-to-end pipeline for building or rebuilding a slide deck — start from a rough .pptx / text prompt / image (whiteboard photo, handwritten outline, reference screenshot), produce both an editable HTML deck and an editable .pptx. For product-showcase / concept-proposal decks it can also deliver HTML + PDF without a .pptx. Trigger when the user wants to: (a) rebuild an existing ugly PPT into a beautiful one ('重做这份 PPT', 'rebuild this deck'), (b) make a deck from a rough idea or scribble ('做一份 X 主题的 PPT', 'turn this whiteboard photo into slides'), (c) iterate on a previously generated deck ('改 P05 字号'). This skill orchestrates the [beautiful-html-templates] skill (Phase 2-4) and the [pptx] skill (Phase 5-6); both remain independent and callable directly when only one half is needed. Stops at 3 checkpoints (outline / template / HTML preview) and runs everything else autonomously. P2H2P = PPT → HTML → PPT (any input → HTML middle layer → PPT output)."
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
- User wants a product-showcase / concept-proposal deck (HTML first; PDF and/or .pptx) → also follow "Product-showcase decks"

❌ Don't use:
- User only wants to *read* a PPT → use markitdown directly
- User only wants HTML, no PPT → use beautiful-html-templates directly (exception: product-showcase decks → this skill, see "Product-showcase decks")
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
  ⏸️  CHECKPOINT 2: user picks one (product-showcase decks: 3-cover style gate, see S1)
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
3. **3 checkpoints, no more — and they wait for the user**: outline / template / HTML preview. No timers: each checkpoint waits for the user's reply (see "Checkpoint policy + `--auto` flag" below); only `--auto` skips them. Users can override later via Iteration mode.
4. **Failure: recursive shard-and-retry — but "dead" is a proven state, never a hunch**. One linear flow, no exceptions — **every re-dispatch (the first retry included) starts by proving the old agent dead**: (1) confirm death by all three probes at once — (a) jsonl transcript stopped growing for ≥ 90s, AND (b) expected output file absent on disk, AND (c) process gone; miss any one → it's alive-but-slow, keep waiting, do NOT re-dispatch. (2) Only once dead-confirmed: retry once at same scope. (3) If that second attempt also dies (same three-probe test) → split scope in half and dispatch new agents recursively (8 pages → 4+4 → 2+2 → 1+1), each hitting this same flow. (4) Only fall back to degraded text-dump rendering on a single page that fails alone. A re-dispatch that races a still-alive agent onto the same file is the single worst failure mode of this skill (see contract #9 + "Known orchestration failure modes" in Phase 6). This minimizes the blast radius of any one failure.
5. **`git init` is Phase 0.0**: every deck is a git project from second one. Commit per phase. Never `cp foo.html foo.html.bak` as a safety net.
6. **A build doesn't ship until a reviewer-pass agent sees it**: `node build.js` exiting 0 only proves the code ran — it does NOT prove text fits its container, that 380pt glyphs don't overflow their bbox, that captions don't collide with peak badges, or that adjacent columns aren't 0.3" apart and read as one number. After every build (including iterations), render to JPGs and dispatch a reviewer agent against the actual rendered output before declaring done (for small patches: reviewer on affected pages only; for structural changes: full 2-pass — see Iteration mode step 6). Don't ask the user "does this look ok?" as the first visual check — that's the agent outsourcing its own QA. See Phase 6 for the required reviewer-pass contract.
7. **Every visible element must answer "so what?"**: the test for any text/shape/stat on a slide is "what does the reader gain from this, that isn't already visible elsewhere on the same slide or in the page chrome?" If the answer is "nothing" or "the same info" (e.g. a stat panel restating the page count, a footer repeating the slide title), the element is filler — delete it and let the layout breathe, OR replace with content drawn from the actual report data. Self-referential deck metadata is the easiest filler to invent and the most common offender; reject it on sight.
8. **Agent-authored Chinese prose MUST go through `humanizer-zh` before shipping**: any 讲稿 / 说课稿 / narration script, invented slide copy, 大纲 description, or 金句 the agent *wrote itself* (vs. copied from the user's source) is run through the `humanizer-zh` skill and de-AI'd BEFORE it's shown at a checkpoint or baked into slides. Raw first-draft AI Chinese is never the final deliverable — the user flags AI-flavored 中文 on sight. Does NOT apply to text copied verbatim from the user's source (that's contract #1's territory). See Step 1.5b and `[[feedback_dezh_ai_via_humanizer_zh]]`.
9. **Single-writer invariant + no sentinels**: at any moment, AT MOST ONE agent may be writing a given artifact file — this rule covers ANY file a builder/converter/fix agent will write to disk (`build_pptx.js`, `index.html`, `src/tokens.css`, and anything else produced; don't assume only these three are special). Before dispatching any file-writing agent, read `docs/WRITERS.md`: if a row for that file has `status: active`, you MUST NOT dispatch a second one — either wait for it, or TaskStop/kill it and clear its row first. Two agents writing the same file = last-write-wins corruption, the exact 2026-07-23 pptx wreck. **`docs/WRITERS.md` format + lifecycle (mandatory, or the registry rots into a rubber stamp):** one row per active write, e.g.
   ```
   file: build/build_pptx.js
   writer: <agentId>
   dispatched_at: <ISO8601>
   status: active
   ```
   The **orchestrator** owns this file (not the writer agents): set `status: active` at dispatch; the moment the agent returns AND you've `ls`-confirmed its output landed, set that row to `status: done` (or delete it); if you TaskStop/kill an agent, delete its row immediately. A row is only a valid block while `status: active` — never let a `done`/stale row wrongly block a legitimate new dispatch. **Every builder/pptx/fix dispatch prompt MUST state: "the ONLY signal of completion is the output file existing on disk (ls-verifiable) — you are FORBIDDEN from spawning a sentinel, calling Monitor, or telling yourself 'I'll wait for the notification' and returning; that is not done, that is abandoning the task."** Agents that "wait for a notification" instead of producing the file burn budget and self-report false completion. Verify landed files, not `completed` status — see `[[feedback_verify_agent_output_landed_not_status]]`.

---

## Checkpoint policy + `--auto` flag

The 3 checkpoints (outline / template / HTML preview) are designed for **async user review**. Per Allen's 2026-08-28 policy (no more timer-based auto-continue for long tasks), checkpoints do NOT auto-fire on a timer and do NOT set any wakeup/loop.

### Hard rule — every checkpoint waits, no timers

After posting a checkpoint message, just leave the conversation window open and wait for the user's reply — do not schedule any timer, alarm, or loop. If the user takes a long time to respond, keep waiting; do not silently proceed with default decisions after some elapsed time. This replaces an earlier version of this skill that scheduled a 300-second timed wakeup per checkpoint — that pattern is retired along with the rest of the timer-based heartbeat policy.

**Pattern** — every time you stop at a checkpoint:

1. Post the checkpoint message to the user (what to review, how to confirm).
2. Wait. When the user replies, act on their input. Do not proceed on your own initiative.

### `--auto` flag — skip checkpoints entirely

Invoke as `/p2h2p <input> --auto` to bypass all 3 checkpoints — completely unattended run. Don't post checkpoint messages at all; just write defaults to `docs/AUTO_DECISIONS.md` and continue. Useful for:
- Overnight bulk runs
- Batch processing multiple decks
- "Just give me something to start from" workflows

In `--auto` mode, the morning report becomes the user's ONLY interface to the result. `--auto` is the only way this skill proceeds without waiting for the user — outside of `--auto`, no checkpoint ever auto-continues.

### Default actions per checkpoint (used only in `--auto` mode)

| Trigger | Auto-default action |
|---|---|
| Checkpoint 1 (outline / assets / tables) | Accept current OUTLINE as-is, accept agent's ASSET_PLAN decisions, accept TABLES OCR data |
| Checkpoint 2 (template pick) | Pick candidate #1 (highest-ranked match for outline tone) |
| Checkpoint 3 (HTML preview OK?) | Assume OK, proceed to PPT generation |

### Logging — `docs/AUTO_DECISIONS.md`

When AI auto-decides past a checkpoint in `--auto` mode (or via user explicitly telling it to skip), it MUST log the decision:

```markdown
# Auto-decisions (--auto mode, or user told the skill to skip)

- 2026-05-25 02:14: Checkpoint 1 skipped (--auto). Auto-accepted:
  - OUTLINE.md as generated (38 pages, no edits)
  - ASSET_PLAN.md (KEEP×4, DUOTONE×3, DROP×2)
  - TABLES.md (3 charts, all marked confidence:medium)
  - FONTS.md (all 4 fonts → KEEP-with-fallback per default rules)
- 2026-05-25 02:24: Checkpoint 2 skipped (--auto). Auto-picked: `sakura-chroma` (candidate #1)
- 2026-05-25 03:55: Checkpoint 3 skipped (--auto). Assumed OK, proceeded to Phase 5.
```

This file is the FIRST thing the morning report points the user at, so they can spot-fix bad auto-decisions via Iteration mode.

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

## Product-showcase decks (HTML-first, often PDF delivery)

**Trigger**: the deck introduces products / services to a client or partner (产品概念提案、产品介绍、方案展示). The main pipeline applies, with the rules below added. **Delivery branch**: if the user wants HTML (+ PDF) and no .pptx, skip Phase 5 and run Phase 6's two reviewer passes on the HTML page screenshots and the exported PDF pages (S7) — hard contract #6 still applies. If a .pptx is also wanted, run Phase 5–6 as usual.

### S1 — Style gate: 3 covers before any page is built
- Skipping the outline checkpoint ("build directly, no need to confirm structure") does **not** skip the style decision. Palette or mood words ("warm white, ink, a touch of red") are inputs, not a pick. This gate replaces CHECKPOINT 2 for this deck type; skip it only if the user names a concrete style (a template slug, a reference deck / screenshot to match, or a direction already chosen). In `--auto` mode, still render the 3 covers, take #1, and log it in `docs/AUTO_DECISIONS.md`.
- Render the **cover** in 3 genuinely different directions (not one design tweaked three ways), each with **one content-page sample**, on a side-by-side comparison page. Use the deck's real copy — no invented text (contracts #1, #8). Library templates may be the starting point; if a .pptx is also wanted, respect `ppt_compat`. The user picks; only then build pages.
- While waiting, only style-independent groundwork may run (crops, deck shell, build / screenshot scripts). `tokens.css` stays a skeleton; no sample pages.
- After the pick, Step 3.1 pins the style in `src/tokens.css`; add a short `docs/STYLE_SPEC.md` naming each token's usage and the shared component class names. It references tokens and never restates hex / px values.

### S2 — How to show product UI
| Page role | Show the UI as |
|---|---|
| overview and chapter pages, and TOC entries that show a product | the **full screen inside a device mockup** (phone / tablet shell), never a bare screenshot |
| pages that explain a function or step | a **readable local crop** of the real UI; never shrink a full screen to fit |
| overview of N products | N mockups side by side, each with product name + one-line function underneath. **Never** a collage of small fragmented crops |

- Readability: the UI's body text must display no smaller than the deck's smallest caption token. Check: displayed px = source text px × (displayed width ÷ source width). If a crop can't reach that, crop tighter or split the page.
- Reuse mockup assets that already exist in the user's projects (e.g. the phone-shell code of a product promo video) — extract and render them, don't redesign a device frame. Render at 2–3× with a transparent background (a PNG — element screenshot with `omitBackground: true`; JPEG has no alpha); the screen content is the source image the brief designates (if the existing asset shows a different version, swap the screen, keep the shell).

### S3 — Every image must earn its place
- Apply contract #7 to images: remove it — does the reader understand less? If not, delete it; typography or a diagram can carry the page. Never add an image just so the page "looks illustrated".
- If atmosphere / space images are tone-matched to the palette, never apply that filter to product UI, product artwork, QR codes, logos, reference images, or photos of people (contract #1).
- Captions follow contract #1: only text found in the source or brief. Dropping captions never drops the truth duty — body copy must not call a rendering a real photo or a concept UI a shipped product. When an identity note is required, prefer one note per page or one deck-level note over the same disclaimer under every image, unless the user asks otherwise. Don't repeat the brand name next to a logo that already contains it.

### S4 — Text blocks need hierarchy
A block of text = **small heading → one core sentence** (display face, primary ink, one step up the type scale) **→ itemized details** (one step down, muted color, tighter line height, accent bullets). Gap between items < gap between blocks. Process-like details become a mini flow diagram, not a sentence. Three paragraphs of equal size and spacing = rework.

### S5 — Structure and branding consistency
- If chapters are numbered, the numbers match everywhere — TOC, chapter pages, eyebrow labels, and any nav data attribute. Renumber all of them in one pass.
- Logo: original file, original ratio, same position on every page that carries it; don't add a small logo to a page that already shows a large one.
- Supplied QR codes and brand artwork: exact file, no recolor, crop or redraw. Keep brand QR codes visually distinct from product-entry QR placeholders, and never fake a scannable entry code.

### S6 — Iteration discipline
- Apply a user's change only where they point. If the same pattern exists elsewhere, list those pages in one question in the same reply; if they say "only what I mentioned", obey. Reviewer-found defects (overflow, collision) are still fixed everywhere per Phase 6 "Fix discipline".
- Append every user-requested change to `docs/CHANGES.md` (dated, numbered, "overrides the original brief / outline") **before** dispatching it, and include that file in every builder and reviewer prompt, so nobody reverts it by following the original brief.
- Concurrent requests go to the single active writer (contract #9).

### S7 — Exporting the HTML deck to PDF (when asked)
- **Default: raster PDF.** Puppeteer or Playwright, viewport = the deck's native stage size (e.g. 1920×1080), `deviceScaleFactor: 2`. Per page: navigate with the deck's own mechanism (API, hash or keys) and assert the shown page number (indices are often 1-based); await `document.fonts.ready` and image `decode()`; let entry animations and JS-drawn elements (Step 3.7 / 3.8 graphics, connector lines) settle; hide on-screen nav controls; `screenshot({type:'jpeg', quality:92})`. Combine with the img2pdf Python API at dpi = 96 × deviceScaleFactor, so each page is stage px × 0.75 pt (1920×1080 → 1440×810 pt): `img2pdf.convert(files, layout_fun=img2pdf.get_fixed_dpi_layout_fun((192, 192)))` (`pip3 install --user --break-system-packages img2pdf`). JPEGs are embedded as-is. Tell the user once that PDF text isn't selectable.
- **Why not `page.pdf()` / `--print-to-pdf`**: a scale-to-fit stage (`top:50%` + `transform: scale`) can print only its top half, and CSS box-shadows can come out as **solid grey boxes in macOS Preview** while poppler renders them fine, so a pdftoppm-only check misses it. Don't run Ghostscript over a Chrome PDF to shrink it (in a real run it blanked images and worsened the boxes). Use vector export only when selectable text is required, after removing box-shadow / filter and verifying in Preview's engine.
- **Verify with Preview's engine**: `pdfseparate -f N -l N deck.pdf pN.pdf`, then `qlmanage -t -s 1600 -o <dir> pN.pdf` for a shadow-heavy page, a mockup page and a UI-crop page; plus `pdftoppm -r 30` on all pages (montage them) to check count and order.

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
| `chart` | A chart-image whose data was extracted in Step 1.4 | 按 Step 3.7 从图型库选型并渲染 |
| `diagram` | 结构/关系示意图（层级、因果、流程、包含、分组、发散），非数值数据 | 按 Step 3.8 从版式库选型并渲染 |

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

**Exception — product-showcase decks**: screenshots / renders of the product being showcased are product artwork → `KEEP`, never `CHART` or `DUOTONE`, even if the UI contains charts. The chart rule targets data evidence, not the product itself.

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

Post the message, then wait — no timer:

Message to user:
> "Phase 1 完成 — 请一并审：
>
> 1. **大纲** `docs/OUTLINE.md` — N 页，可改顺序/增删/重命名；`Notes` 列标了 confidence-low 的页码
> 2. **图片决策** `docs/ASSET_PLAN.md` — 每张图已默认填 KEEP/DUOTONE/DROP/CHART
> 3. **图表数据** `docs/TABLES.md` — 从截图 OCR 出的数据点，请核对 medium-confidence 的
>    （若本 deck 有图表：顺带确认一句这份 deck **是否商用**（客户交付/述标/对外提案）。商用则 Step 3.7 的图型库不可用，改走 Chart.js/ECharts 自绘 — 见 Step 3.7 Hard gate #0。**这个商用闸门只管图表，不管结构图**：Step 3.8 的结构图版式库是 ISC/MIT 宽松许可，商用非商用都能用，不需要在这里确认，也不要因为本 deck 是商用就跳过 3.8）
> 4. **字体决策** `docs/FONTS.md` — 原 PPT 用了哪些字体 + 默认建议；可改 KEEP / KEEP-with-fallback / REPLACE-WITH
>
> 仅当 OUTLINE `Notes` 列提示某页 confidence:low 时，再打开对应 `slides/p{NN}.json` 检查 role 推断对不对。其它页 JSON 不需要看。
>
> 改完任意文件，说 'continue' 进 Phase 2 模板选择。"

Then wait for the user's reply — no scheduled timer. When they respond, check git log for any user-driven commits to docs/OUTLINE.md / docs/ASSET_PLAN.md / docs/TABLES.md since the checkpoint was posted and proceed with their edits (or their explicit 'continue').

---

## Phase 2 — Template selection

For product-showcase decks, the 3-cover style gate in "Product-showcase decks → S1" replaces CHECKPOINT 2 (covers rendered from the deck's real copy, library templates optional). The `ppt_compat` filter below applies only when a .pptx is also delivered.

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

Post the message, then wait — no timer:

> "3 个模板候选已打开:
> 1. <slug A> — <tone>
> 2. <slug B> — <tone>
> 3. <slug C> — <tone>
> 选哪个？"

When the user responds, use the template they picked and proceed to Phase 3 (HTML build).

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
- Product-showcase decks: rules S2–S5 from "Product-showcase decks" and `docs/CHANGES.md`, verbatim in the prompt

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

### Step 3.7 — 图表渲染（数据图走图型库）

**Trigger**: `docs/TABLES.md` contains any chart data row (produced by Step 1.4's OCR), OR any `slides/p{NN}.json` has a section with `role: chart`. Either signal → this step is mandatory for that page. Builders do NOT freehand a chart and do NOT paste the original screenshot.

The chart library lives at `~/.claude/skills/p2h2p/reference/charts/` — 48 vetted chart implementations (`G1`-`G18` Glance, `L1`-`L15` Lupi, `F1`-`F12` basics, `B1`-`B3` big), copied from the `lieflat-charts` skill. See `reference/charts/PROVENANCE.md` for origin.

#### 🚫 Hard gate #0 — commercial-use check (run BEFORE opening any gallery)

This library is licensed **PolyForm Noncommercial 1.0.0** — the restriction travels with the copied files. Ask one question first:

> **Is this deck used in a for-profit activity?** (paid client deliverable, 述标/投标 presentation, sales or investor pitch, anything billed or sold)

- **Yes → do NOT use this library.** Build the chart directly with Chart.js or ECharts (MIT / Apache-2.0, unrestricted) following the palette + projection rules below. You still get consistent charts; you just don't copy a gallery implementation.
- **No** (personal use, internal notes, teaching, open-source docs, portfolio) **→ proceed.**
- **Unsure → ask the user, don't guess.** Log the answer in `docs/AUTO_DECISIONS.md`.

This gate exists because p2h2p's most common jobs (述标 PPT, client decks) are exactly the prohibited case. Full terms + the two escape routes: `reference/charts/PROVENANCE.md`.

#### ⚠️ Library presence check (first use after cloning this skill)

The library is not redistributed with this repo (PolyForm Noncommercial — see gate #0). Verify it is present before opening any gallery:

```bash
test -f ~/.claude/skills/p2h2p/reference/charts/catalog.md && ls ~/.claude/skills/p2h2p/reference/charts/templates/*.html | wc -l   # expect 6
```

- **Missing** → this is a first use. Install it per `reference/charts/SETUP.md` (one `git clone` + two `cp`).
- **Can't or won't install** (offline, commercial deck, license not acceptable) → skip this library entirely and draw the chart with Chart.js / ECharts, still obeying the projection gate and palette rules below.

#### Selection flow (AI picks by data shape — no fixed style ranking)

1. **Read the data's shape first**, not its topic: a few categories compared? a time series? a 100% composition? signed (+/-) values? many-to-one attribution? per-record distribution?
2. Open `~/.claude/skills/p2h2p/reference/charts/catalog.md` and recall candidates by that shape — all 48 entries are indexed on 数据形状 as the primary key.
3. **No style priority.** Do NOT prefer Lupi over Glance or vice versa. Pick purely on (a) data shape fit and (b) the projection gate below. The upstream catalog's "先审计 Lupi，两组都不适配才进 Glance" ordering is an artifact of the source skill and does not bind here.
4. Open the matching gallery in `reference/charts/templates/` (`lupi-gallery.html` / `basics-gallery.html` / `glance-gallery.html` / `big-*.html`), locate the `<div class="card">` block by its 卡内标题 from the catalog to read the markup, then search the `<script>` for the same-named `// ════` comment block to get the render code.
5. **Adapt that implementation — swap the data, keep the structure.** Never take a chart type as inspiration and then draw your own from scratch; the template IS the deliverable's skeleton.

#### ⚠️ Hard gate — projection legibility

A deck is read on a projector from several meters away. The lieflat library was designed for web/公众号 reading distance — its 0.5-0.7px hairlines and 6.5px labels are literally invisible when projected. After picking an implementation, walk its code and enforce:

| Property in the template | Minimum in a P2H2P deck |
|---|---|
| stroke / line width < 1.5px | bump to ≥ 1.5px |
| SVG text `font-size` < 11px | bump to ≥ 11px |
| body / label text below 14pt equivalent | bump to ≥ 14pt equivalent |

Then re-check: if thickening and enlarging makes elements occlude each other or labels no longer fit their slots, **the chart type is too fine-grained for projection — go back to step 2 and pick a coarser candidate** (usually a Glance-series `G1`-`G18`, which are built for 3-second reading). Do not ship a chart you "fixed" into a tangle.

#### Palette — deck tokens override the upstream rule

- Chart colors come from THIS deck's `src/tokens.css`, never from the template's own hardcoded palette. Feed the deck's primary + background into `reference/charts/deck-tokens.js`'s `buildLadder(primary, background)` to generate the 9-step lightness ladder, and drive the chart off that ladder.
- Keep the **lightness-as-data** encoding: the most important series/segment gets the largest lightness delta from the background.
- **The upstream `lieflat-charts` rule — "只准纸灰+炭黑单色，出现非 ladder 颜色即返工" — does NOT apply in P2H2P and is deliberately repealed here.** A builder that reads `lieflat-charts/SKILL.md` must not import its monochrome mandate; the deck's own tokens win.

#### Structural tokens to preserve

- `rnd()` deterministic pseudo-random — **`Math.random()` is forbidden**; a refresh must reproduce the identical chart, or HTML preview and the PPT screenshot will disagree.
- Area encodes by `sqrt` (radius ∝ √value), so magnitudes read honestly.
- Bar charts never break the axis — baseline stays at zero.

#### Animation

Keep the `obsReveal` scroll-in animation in the HTML preview (Phase 4) — it costs nothing and the deck is browsed live. Phase 5 screenshots the chart in its settled end state, so animation never reaches the `.pptx`. See Phase 5's chart-page strategy.

### Step 3.8 — 结构图渲染（结构/关系图走版式库）

**Trigger**：满足任一条即走这一步，builder 不许手绘结构图、不许贴原图截图。

- 任一 `slides/p{NN}.json` 里有 section 的 `role: diagram`
- `docs/OUTLINE.md` 里某页被标为结构页 / 关系页 / 体系页
- 页面内容语义上是**层级 / 因果 / 流程 / 包含 / 分组 / 发散**关系，而不是数值数据

**与 Step 3.7 的分工（一句话判据）**：**这页要传达的是数字大小，还是要素之间的关系？** 数字 → 3.7 图表；关系 → 3.8 版式。「四个季度的营收」是 3.7；「四个部门的从属结构」是 3.8。两者都要就拆成两块，别混在一张图里。

版式库在 `~/.claude/skills/p2h2p/reference/diagrams/` —— 7 种结构图版式（金字塔 / 同心圆 / 鱼骨 / 流程 / 分组 / 放射 / 左右树），选型目录在 `reference/diagrams/catalog.md`。

#### ✅ 许可证 — 本能力可商用，与 Step 3.7 相反

**Step 3.7 的 PolyForm Noncommercial 硬闸不适用于本步骤。** 结构图版式库的渲染代码是 p2h2p 自己写的，`vendor/` 下的两个第三方库是 **d3-hierarchy（ISC）** 和 **non-layered-tidy-tree-layout（MIT）**，两者都是宽松许可：允许商用、修改、再分发，唯一义务是保留版权声明（文件里已带，原样内联即满足）。

所以**述标 PPT、投标演示、客户交付、销售提案这些 Step 3.7 明令禁止使用图型库的场合，结构图版式库可以放心用**。这正是它相对图表库的优势：p2h2p 最常见的活（述标 / 客户 deck）恰好是图表库被禁的场景，而结构页在这类 deck 里占比很高。不要因为读过 3.7 的商用闸门就连 3.8 一起跳过。来源与许可全文见 `reference/diagrams/vendor/PROVENANCE.md`。

#### 加载顺序（写错就跑不起来）

```html
<script src="../charts/deck-tokens.js"></script>              <!-- 必须最先 -->
<script src="diagram-tokens.js"></script>
<script src="vendor/non-layered-tidy-tree-layout.js"></script> <!-- 树布局算法本体 -->
<script src="vendor/d3-hierarchy.min.js"></script>             <!-- 只有 radial 要 -->
<script src="layout-core.js"></script>
<script src="layouts/radial.js"></script>                      <!-- 见下方注意事项 -->
<script src="layouts/xxx.js"></script>                         <!-- 再引本页要用的版式 -->
```

三处容易写错的地方：

1. **`deck-tokens.js` 在 `reference/charts/` 目录下**，不在 `diagrams/` 里 —— 结构图和图表共用同一份 deck token 实现，路径是 `../charts/deck-tokens.js`。
2. **两个 vendor 库的顺序是 tidy-tree 在前、d3-hierarchy 在后**（`layout-core.js` 要在两者都就位后才加载）。d3-hierarchy 只有放射图用得上，其余版式可以不引。
3. **`layouts/radial.js` 要排在其他版式之前**。除放射图外的 6 种版式（pyramid / concentric / fishbone / flow / grouped / bilateral）都调用 `DIAGRAM_LAYOUTS.radial.nodeStyleAA` 做 AA 对比度兜底。这是**软依赖**——radial 缺席时会静默退回 `T.nodeStyle(depth)`，图照样画得出来、零报错，但**填色和引了 radial 时不一样**（实测 `#a85c3d` vs `#b36241`），同一份数据换版式颜色就变了。所以哪怕本页只用金字塔，也把 radial.js 一起引上。

单文件 deck（Phase 5 要 puppeteer 截图导 PPT，产物必须自包含）**建议把这几个文件直接内联进 `<script>`**，不留外部引用。

#### 调用约定

```js
const res = await DIAGRAM_LAYOUTS[版式名].render(svgEl, data, { scope: cardEl });
```

- **`render` 是 async，必须 `await`**。内部要等字体就绪才能测量中文宽度，漏了 `await` 拿到的是 Promise，图也可能在字体加载完成前量偏。
- `data` 传**已解析的对象**（`slides/p{NN}.json` 里本来就是 JSON），不是 YAML 字符串。catalog 里的 YAML 只是书写形态。
- `opts.scope` 传承载这张图的卡片元素——配色从它身上的 CSS 变量取，见下方调色规则。
- 返回值 `{nodes, bounds, viewBox, projection, ...}`，`projection` 是投屏硬闸的修正报告，必须读，见下。

#### AI 自动选版式的判断规则

按顺序过一遍，**第一条命中就定版式**；全都不命中说明这页大概不是结构页，回去确认是不是该走 3.7 或纯文字排版。

| # | 判据（可判定） | 版式 |
|---|---|---|
| 1 | 数据是 **3–6 层递进**、每层一个概念、上层建立在下层之上（指标体系、战略—战术—执行） | **金字塔 pyramid** |
| 2 | 层与层是**包含 / 嵌套**关系（外层裹住内层），无高低之分，3–5 层 | **同心圆 concentric** |
| 3 | 有明确**先后顺序**：步骤编号、「先…再…」「第一步 / 第二阶段」、箭头链路 | **流程 flow** |
| 4 | 若干**并列主题各带要点**，组之间无层级也无先后（服务内容、三大板块） | **分组 grouped** |
| 5 | 同时满足下面「鱼骨硬前置」三条 | **鱼骨 fishbone** |
| 6 | **中心一个主题**向外发散多分支，分支之间并列、无先后（关键词地图、议题拆解） | **放射 radial** |
| 7 | 是**嵌套树**（数据里有 `children`）且**一级分支 ≥5** 或层深 ≥3，需要视觉平衡塞进 16:9 | **左右树 bilateral** |

**鱼骨硬前置（三条全中才进鱼骨，缺一条就往下走）**。鱼骨排在分组之后，且只认数据结构、不认字面用词：

1. **有单一结果**：能从内容里指出一个明确的结果 / 问题 / 偏差，且它只有一个，可以直接填进 `spine` 字段（如"概算执行率偏离超过 15%"）。若干并列条目没有共同指向的那个结果 → 不满足。
2. **原因分了 ≥2 个大类**：能切出至少两个原因类别填进 `bones`（如"设计变更""材料价格""工期管理"）。只有一层扁平清单、切不出大类 → 不满足。
3. **大类下有子项**：至少有一个 `bones` 项能挂出具体原因（`causes`）。全部大类都是光杆一行 → 不满足。

**只要出现「原因 / 因素 / 导致 / 影响 / 归因 / 偏差」这类因果词、但上面三条没全中，一律走分组 grouped，不进鱼骨。** 描述业务问题时这类词几乎必然出现，靠字面词触发会把并列清单误排成归因图 —— 读者会去图上找"这几类原因到底导致了什么"，而内容里根本没有那个结果。反例：「资产评估投后评价的五个风险因素」，五条并列、没有单一结果、也切不出原因大类 → 第 4 条命中，出**分组图**。正例：「客户投诉率上升的原因分析」，结果是"投诉率上升"，原因分成产品 / 服务 / 物流三类、每类下挂具体条目 → 三条全中，出**鱼骨图**。

（这条与 `catalog.md` D3 的姊妹关系「只有一层原因、没有大类分组 → 换 D5 分组」、以及 `fishbone.js` 的 `describe().whenToUse`「只有一层原因时用 grouped 更清爽」是同一口径。）

两条前置分流，能砍掉一半误判：

- **先看数据口径**。数据里有 `children` 嵌套 → 只在 radial / bilateral 之间选；数据是一层平铺的列表 → 只在 pyramid / concentric / fishbone / flow / grouped 之间选。
- **再看关系类型**，不看题材。"这页讲战略"不是选金字塔的理由，"这页的数据是 3–6 层递进"才是。

**用户可以在数据里写 `layout: xxx` 覆写自动判断，覆写优先，不再跑上表。** 值取版式英文名（`pyramid` / `concentric` / `fishbone` / `flow` / `grouped` / `radial` / `bilateral`）。覆写与自动判断结果不一致时，按覆写执行，并在 `docs/AUTO_DECISIONS.md` 记一行"P{NN} 版式由数据覆写为 xxx（自动判断为 yyy）"。

七种版式的完整数据格式、姊妹关系（什么时候该换用另一种）、各自的已知限制，见 `reference/diagrams/catalog.md`。参考实现和"这样的数据出这样的图"的对照，见 `reference/diagrams/gallery.html`。

#### ⚠️ Hard gate — 投屏可读性

和 3.7 同一条理由：deck 是几米外投屏看的。`render` 收尾会自己调 `DIAGRAM.enforceProjection(svg)`，把线宽顶到 `≥1.5px`、SVG 字号顶到 `≥11px`，**builder 必须读返回值 `res.projection` 并检查修正数量**：

```js
if (res.projection.fixed > 0) console.warn('投屏修正', res.projection);
```

- `fixed === 0` → 版式和内容量匹配，通过。
- `fixed` 少量（个位数，多是最深一层的小字）→ 可接受。
- **`fixed` 很大（几十项，或 `details` 里出现大量 font-size 修正）→ 版式选错了，内容太密。** 顶字号只是把字撑大，撑大后元素会互相压。正确做法是**换更粗放的版式**（层级树 → 分组图；鱼骨 8 根刺 → 拆成两页）或**拆页**，绝不交一张"修好了"的乱图。

配合 catalog 里各版式的已知限制看：金字塔 >6 层、鱼骨 >6 刺、流程 >9 步、分组 >4 组折网格，都是密度警戒线。

#### 调色规则 — 与 Step 3.7 同一条原则

- **颜色全部来自当前 deck 的 CSS 变量**，通过 `DIAGRAM.fromDeck(scope)` 取（读 `--color-primary` / `--color-bg` / `--color-ink`，兼容 `--primary` / `--bg` / `--ink` 等别名），再生成 9 级明度阶。
- **不许在版式调用处写死颜色**。版式文件内部本来就没有硬编码色值；builder 也不许用 `opts` 塞死色。要换配色就改 deck 的 tokens，图自己跟着变。
- **深色底 deck 自动反向**：`fromDeck` 判定 `isDark` 后自己挑字色，并做 AA 对比度兜底，不用手工干预。
- 与 3.7 的 "deck tokens 覆盖上游调色板" 是同一条原则的两个落点。

#### 结构性 token

- `rnd()` 确定性伪随机，**`Math.random()` 同样禁止** —— 刷新必须复现同一张图，否则 HTML 预览和 PPT 截图对不上。
- 布局坐标全部解析求解，不用力导向 / 物理模拟（鱼骨图的注释里专门解释了为什么不引 d3 力导向：每次刷新形状不同、导出 PPT 不可复现）。
- 畸形数据（`null` / 数字 / 布尔 / 空文字）被静默跳过，不生成空白幽灵盒子。所以**图上条数和数据条数对不上时，先查数据里有没有空洞**——不会报错也不会提示。

#### Animation

和 3.7 一致：HTML 预览（Phase 4）保留入场动画，Phase 5 截其**静止终态**，动画不会进 `.pptx`。

#### 导出 PPT 的口径

Phase 5 截图时，**结构图与图表同口径**：截图容器的 @2x PNG，**整张图作为一张 PNG 贴进 pptx**，页面其余部分仍走原生文本框。不做原生可编辑形状（不用 pptxgenjs 的 `addShape` 逐个还原节点和连线）——那样既还原不了梯形/环带/斜刺这些路径，也会让 PPT 与用户在 Checkpoint 3 已经批准的 HTML 长得不一样。见 Phase 5 的 chart-page 策略表。

**Output**：本步产出的是 `index.html` 里结构页的完整 SVG 结构图（含内联的版式库脚本），以及 `docs/AUTO_DECISIONS.md` 里每张结构图的一行记录：页码、选中的版式、是自动判断还是 `layout:` 覆写、`projection.fixed` 的修正数。

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

Open index.html in browser, post the message, then wait — no timer:

> "HTML deck 跑完了:
> /abs/path/to/index.html
>
> 自己用方向键/空格翻页过一遍。OK 我转 PPT；不 OK 列页码 + 问题，我修。"

When the user responds with 'OK', proceed to Phase 5 (HTML → PPT via pptxgenjs).

**If user gives a fix list**: loop into Phase 3 with the punch list, apply fixes, re-open, and wait again. Don't proceed to Phase 5 until the user approves.

---

## Phase 5 — HTML → PPT

> **Product-showcase decks delivered as HTML (+ PDF) only**: skip this phase; export the PDF per "Product-showcase decks → S7", then go to Phase 6.

> ⚠️ **Single-writer + no-sentinel (contract #9) applies hardest here.** The pptx builder script (`build/build_pptx.js`) is ONE file. Register its writer in `docs/WRITERS.md`, dispatch exactly one builder, and put in its prompt: "completion = the .pptx + render JPGs exist on disk (you ls them before returning); no sentinels, no 'waiting for notification'." If you think the builder died and want to re-dispatch, first prove it dead by the three probes in contract #4 (jsonl stalled ≥90s AND no output file AND process gone) — otherwise you'll race two builders onto the same script.

**Delegate to pptx skill.** Architecture decision per page (decided automatically):

| Page type | Strategy |
|---|---|
| Cover / chapter divider / colophon | PNG background (hide-text + Chrome screenshot) + native textbox overlays |
| Card grids / lists / tables (text-heavy) | Pure pptxgenjs native shapes |
| Data charts (Step 3.7 library charts) / 结构图 (Step 3.8 版式库) / complex viz (clip-path / SVG / rotated) | @2x PNG screenshot of the **chart / diagram container only** + native textboxes for the rest of the page |

### Chart pages / 结构图 pages — screenshot the graphic, keep the text native

结构图（Step 3.8）与图表同口径：**整张图作为一张 @2x PNG 贴进 pptx**，页面其余部分走原生文本框。不用 pptxgenjs 的 `addShape` 逐个还原节点和连线——梯形、环带、斜刺这些路径还原不出来，且会让 PPT 与用户在 Checkpoint 3 已批准的 HTML 长得不一样。下面的截图流程对结构图同样适用（把 `.chart` 换成结构图容器的选择器）。

Charts built in Step 3.7 are hand-written SVG or ECharts canvas. pptxgenjs's native chart API cannot reproduce them (no equivalent for custom SVG paths, radial/blob layouts, or ECharts custom series), and re-approximating them with `addChart` yields a different-looking chart than the HTML the user already approved at Checkpoint 3. So: **screenshot the chart, stay native everywhere else.**

- Screenshot the **chart container only** at @2x — not the whole page, and never a full-page shot cropped by eye.
- Get the container's exact rect from the DOM, then feed it to Chrome headless:

```bash
# 1) read the chart container's rect (CSS px) from the rendered page
node -e '...page.evaluate(() => { const r = document.querySelector("#p12 .chart").getBoundingClientRect();
         return {x:r.x, y:r.y, w:r.width, h:r.height}; })...'

# 2) screenshot exactly that rect at 2x device scale
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --force-device-scale-factor=2 --window-size=1280,720 \
  --screenshot="assets/processed/p12_chart@2x.png" \
  --user-data-dir=/tmp/cr_p2h2p_chart "file:///abs/path/index.html"
```
(Puppeteer's `element.screenshot({path, scale:2})` does the same in one call and is preferred when puppeteer is already installed — it clips to the element without a separate rect step.)

- Place the PNG with `addImage` at the same relative position/size the chart occupies in the HTML; every title, axis caption, legend label, and body paragraph **outside** the chart container still renders as a native textbox.
- **Accepted trade-off**: chart data is not editable inside PowerPoint. Visual fidelity is 100% instead. The user has confirmed this trade; don't re-litigate it or silently fall back to `addChart`.

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

Phase 6 is a **commit-gate**, not optional polish. Per Hard contract #6, no build ships without a passing reviewer-pass — `node build.js` exiting 0 does NOT prove the rendered output is correct. With no .pptx (product-showcase HTML + PDF delivery), both passes run on HTML page screenshots at the deck's stage size and on the exported PDF pages rendered via `qlmanage`.

### Two reviewer passes (mandatory, in order)

Both passes use the same render pipeline (`soffice + pdftoppm → build/full-NN.jpg`) but ask different questions of different reviewer agents.

#### Pass 1 — Layout reviewer (catches: overflow / collision / wrap)

**⚠️ Mandatory sharding for speed**: a single reviewer agent inspecting N images reads them serially — and serial image reads dominate wall-clock time. Lived measurement: one Pass 1 agent on 9 images took **17 minutes**; the same prompt re-run on the same 9 images via 3 parallel agents (3 images each) took **under 30 seconds total**. The image-read budget is per-agent, not per-pass.

**Sharding rule**: cap each Pass 1 reviewer at **≤ 4 images** (this is a HARD cap, not a suggestion — for WHY, see "Known orchestration failure modes" #3 below: a reviewer handed more than 4 images overloads context and hallucinates defects). Compute shard count as `ceil(N / 4)`. Dispatch all shards in a SINGLE message with multiple Agent tool calls in parallel (not sequential). Each shard runs the same prompt below over its slice of pages; the orchestrator aggregates findings after all shards return.

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

### Known orchestration failure modes (pre-mortem — read before dispatching Phase 5/6 agents)

These are real wrecks from prior runs. Each is a trap you can avoid by knowing it exists *before* it bites:

1. **Re-dispatch racing a still-alive agent** → two agents write the same file, last-write-wins corruption. Guard: contract #4's three-probe death test + contract #9's `docs/WRITERS.md` registry. "It's been quiet a while" is NOT death.
2. **Sentinel / "waiting for notification" false completion** → an agent spawns a watcher and returns `completed` without producing anything. Guard: contract #9's dispatch-prompt clause; verify the file on disk (`ls`), never trust `completed` status alone.
3. **Reviewer over-reading images → hallucinated bugs.** A reviewer handed > 4 images per shard overloads context and invents defects (real case: font faux-bold synthesis on 宋体/Songti-without-Bold-weight was misread as a "textbox written twice / double-print" bug, triggering a needless fix round). Guard: HARD-cap Pass 1 reviewers at ≤ 4 images (already mandated above — actually enforce it); when a reviewer reports a systemic rendering bug, the orchestrator VERIFIES it firsthand (read the actual render + check the generator source/XML) before dispatching a fix, because a fix for a phantom bug wastes a full cycle. Two independent signals disagreeing (reviewer says "double-print", generator says "single addText") = orchestrator adjudicates by looking, does not just believe the louder one.
4. **Faux-bold ghosting is a viewer artifact, not a file bug.** CJK serif fonts lacking a true Bold weight (Songti SC / STSong) get synthesized bold by some PPT viewers — a slight offset overlay that reads as "ghosting/double text". It does NOT reproduce across renderers and is not in the file. Before "fixing" ghosting, render with a second engine (e.g. qlmanage vs soffice) to confirm; the real fix, if wanted, is a serif face that ships a real Bold weight — a design call for the user, not an auto-fix.

---

## Iteration mode

When user re-invokes P2H2P on an existing project (e.g. "改 P05 字号大点" / "把 P12 改成彩色" / "加一页 P39 致谢"), don't restart from Phase 0 — detect the project's progress state and resume from the right phase.

### Detecting project state

Look for artifacts produced by each phase. The most-advanced artifact present tells you where to resume:

| Found in project dir | State | Resume from |
|---|---|---|
| `build/*.pptx`, or `build/*.pdf` for an HTML + PDF delivery | Full pipeline ran to completion | **Iteration mode** (see below) |
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
5. **Regenerate the deliverables** — .pptx via Phase 5's `node src/build.js`, and/or PDF via S7. Never hand-edit `.pptx`; it's regenerable.
6. **QA scope**: never skip QA entirely (contract #6 covers iterations too) — for a small patch run a LIGHTWEIGHT reviewer pass on the affected pages only (not the full 2-pass QA); for a structural change run the full 2-pass QA. "Small" = text/color/position tweak with no layout-engine change.
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
- **Chart type catalog + gallery implementations (Step 3.7)**: `~/.claude/skills/p2h2p/reference/charts/catalog.md`, origin/licensing in `~/.claude/skills/p2h2p/reference/charts/PROVENANCE.md`
- **Diagram layout catalog + gallery (Step 3.8)**: `~/.claude/skills/p2h2p/reference/diagrams/catalog.md`, live reference page `~/.claude/skills/p2h2p/reference/diagrams/gallery.html`, vendor origin/licensing (ISC + MIT, commercial use OK) in `~/.claude/skills/p2h2p/reference/diagrams/vendor/PROVENANCE.md`

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
