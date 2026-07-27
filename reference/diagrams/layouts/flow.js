/* ═══════════════════════════════════════════════════════════════
   FLOW — 流程图（顺序步骤）

   横向串联的步骤，箭头指向下一步。讲的是"先做什么再做什么"：作业流程、
   项目阶段、审批链路、方法论的执行顺序。与金字塔（有高低）、同心圆
   （有内外）的区别是它只有一个维度——时间/顺序。

   ── 数据 ─────────────────────────────────────────────────
   {steps: [{text, note?, branch?}, ...], numbered?: true}
   branch = 该步骤下方挂一个分支说明框，虚线连接（"若不通过则…"这类）。

   ── 折行为什么用蛇形不用换行重排 ─────────────────────────
   步骤数一多（>5），单行横排会把每个步骤压成窄条，中文标题必然换行成
   三四行，整排看着像栅栏。折成多行后有两种接法：
     · 每行都从左开始（打字机式）→ 行末到下一行行首要拉一条长回扫线，
       这条线横穿整张图，视觉上很吵
     · 蛇形（左→右，下一行右→左）→ 行末直接往下拐一小段就接上了
   蛇形省掉了回扫线，代价是偶数行的阅读方向是从右往左。流程图的箭头本
   身就标了方向，读者跟着箭头走不会错，所以取蛇形。

   ── 等宽格子而不是按内容排 ───────────────────────────────
   步骤盒统一宽度（取所有步骤的最大需求宽）。不等宽的流程图看着像"步骤
   有轻重"，但顺序步骤本来是等价的，宽度差会误导。高度同理。

   ── 依赖 ─────────────────────────────────────────────────
     deck-tokens.js → diagram-tokens.js → layout-core.js → 本文件
   挂载：window.DIAGRAM_LAYOUTS.flow
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DIAGRAM = global.DIAGRAM;
  const L = global.DIAGRAM_LAYOUT;
  if (!DIAGRAM) throw new Error('[flow] 需要先加载 diagram-tokens.js');
  if (!L) throw new Error('[flow] 需要先加载 layout-core.js');

  const GEOM = DIAGRAM.GEOM;
  const r2 = v => Math.round(v * 100) / 100;

  const DEF = {
    stepGap: 46,         // 同行相邻步骤的水平间距（留给箭头）
    rowGap: 96,          // 蛇形折行的行间距（要放得下拐弯 + 分支框）
    wrapAt: 5,           // 超过几步开始折行
    maxPerRow: 5,        // 折行后每行最多几步
    stepMaxW: 190,       // 步骤文字最大宽
    branchGap: 22,       // 分支框与主步骤的垂直距离
    branchMaxW: 170,
    numGap: 6,           // 序号与标题的间距
  };

  /* ── 1 · 数据规整 ────────────────────────────────────────────
     畸形项直接丢。流程图的幽灵步骤最坑：它是个空盒子，前后箭头照连，
     读图人会以为"这一步的说明漏掉了"，而不是"这一步不存在"。      */

  /**
   * 把原始 steps 数组过滤成 {text, note, branch} 列表。
   * @param {Array} raw
   * @returns {Array<{text:string, note:string, branch:string, data:Object}>}
   */
  function normalizeSteps(raw) {
    const out = [];
    (raw || []).forEach(item => {
      if (item == null) return;
      const ty = typeof item;
      if (ty !== 'object' && ty !== 'string') return;      // 数字/布尔一律丢
      const o = ty === 'string' ? { text: item } : item;
      const text = o.text != null ? String(o.text) : (o.label != null ? String(o.label) : '');
      if (!text.trim()) return;
      let branch = '';
      if (o.branch != null) {
        branch = typeof o.branch === 'object'
          ? String(o.branch.text != null ? o.branch.text : '')
          : String(o.branch);
      }
      out.push({
        text,
        note: o.note != null ? String(o.note) : '',
        branch: branch.trim(),
        data: o,
      });
    });
    return out;
  }

  /* ── 2 · 布局 ────────────────────────────────────────────────
     2.1 逐步量文字，取统一盒宽/盒高
     2.2 按 wrapAt 决定分几行，蛇形铺开
     2.3 分支框挂在主步骤正下方                                  */

  /**
   * 每行放几步。总步数 ≤ wrapAt 时一行放完；否则尽量均分，
   * 每行不超过 maxPerRow，且各行步数差不超过 1（行长参差看着像没排齐）。
   * @param {number} n        总步数
   * @param {number} wrapAt
   * @param {number} maxPerRow
   * @returns {number[]} 每行的步数
   */
  function planRows(n, wrapAt, maxPerRow) {
    if (n <= 0) return [];
    if (n <= wrapAt) return [n];
    const rows = Math.ceil(n / maxPerRow);
    const base = Math.floor(n / rows);
    const extra = n % rows;
    const out = [];
    for (let i = 0; i < rows; i++) out.push(base + (i < extra ? 1 : 0));
    return out;
  }

  /**
   * 流程布局。
   * @param {Array} steps  normalizeSteps 的输出
   * @param {Object} opts  {numbered, stepGap, rowGap, wrapAt, maxPerRow}
   * @returns {{nodes:Array, branches:Array, rows:Array, stepW:number, stepH:number,
   *            links:Array}}
   */
  function layoutFlow(steps, opts) {
    opts = opts || {};
    const stepGap = opts.stepGap == null ? DEF.stepGap : opts.stepGap;
    const rowGap = opts.rowGap == null ? DEF.rowGap : opts.rowGap;
    const wrapAt = opts.wrapAt == null ? DEF.wrapAt : opts.wrapAt;
    const maxPerRow = opts.maxPerRow == null ? DEF.maxPerRow : opts.maxPerRow;
    const numbered = !!opts.numbered;

    const n = steps.length;
    if (!n) return { nodes: [], branches: [], rows: [], stepW: 0, stepH: 0, links: [] };

    const f = DIAGRAM.TYPO.l1;
    const noteSize = Math.max(DIAGRAM.TYPO.l3.size - 1, 11);
    const numSize = Math.max(DIAGRAM.TYPO.l3.size, 12);

    /* 2.1 逐步量，取统一尺寸 */
    const metrics = steps.map(s => {
      const m = L.measureNode(s.text, {
        fontSize: f.size, fontWeight: f.weight, maxWidth: DEF.stepMaxW,
      });
      let note = null;
      if (s.note) note = L.wrapText(s.note, noteSize, 400, DEF.stepMaxW);
      return { m, note };
    });
    const numH = numbered ? Math.round(numSize * 1.4) + DEF.numGap : 0;
    const stepW = Math.max.apply(null, metrics.map(x =>
      Math.max(x.m.w, x.note ? Math.ceil(x.note.width) + GEOM.padX * 2 : 0)));
    const stepH = Math.max.apply(null, metrics.map(x =>
      x.m.h + (x.note ? x.note.height + 4 : 0))) + numH;

    /* 2.2 蛇形铺开 */
    const rowPlan = planRows(n, wrapAt, maxPerRow);
    const widest = Math.max.apply(null, rowPlan);
    const rowWidth = widest * stepW + (widest - 1) * stepGap;

    const nodes = [];
    let idx = 0;
    rowPlan.forEach((cnt, row) => {
      const rtl = row % 2 === 1;                      // 奇数行从右往左
      const y = row * (stepH + rowGap);
      // 该行如果比最宽行短，靠"来向"那一侧对齐（顺着蛇形走不留空档）
      const rowW = cnt * stepW + (cnt - 1) * stepGap;
      const offset = rtl ? rowWidth - rowW : 0;
      for (let k = 0; k < cnt; k++) {
        const pos = rtl ? (cnt - 1 - k) : k;          // 该行内从左数第几个格子
        const x = offset + pos * (stepW + stepGap);
        const s = steps[idx];
        const mm = metrics[idx];
        nodes.push({
          index: idx, order: idx + 1, row, rtl,
          text: s.text, note: s.note, data: s.data,
          depth: 1,
          lines: mm.m.lines, lineHeight: mm.m.lineHeight,
          fontSize: f.size, fontWeight: f.weight,
          _noteLines: mm.note ? mm.note.lines : null,
          _noteLH: mm.note ? mm.note.lineHeight : 0,
          _noteSize: noteSize,
          _numH: numH, _numSize: numSize,
          x, y, w: stepW, h: stepH,
          cx: x + stepW / 2, cy: y + stepH / 2,
          _fitW: stepW - GEOM.padX * 2,               // 文字预算（自检用）
        });
        idx++;
      }
    });

    /* 2.3 分支框：挂在主步骤正下方，虚线连 */
    const branches = [];
    nodes.forEach(nd => {
      const b = steps[nd.index].branch;
      if (!b) return;
      const wr = L.wrapText(b, noteSize, 400, DEF.branchMaxW);
      const bw = Math.max(90, Math.ceil(wr.width) + GEOM.padX * 1.4);
      const bh = wr.height + GEOM.padY;
      const box = {
        index: nd.index, isBranch: true, text: b,
        lines: wr.lines, lineHeight: wr.lineHeight,
        fontSize: noteSize, fontWeight: 400,
        x: nd.cx - bw / 2, y: nd.y + nd.h + DEF.branchGap,
        w: bw, h: bh,
      };
      box.cx = box.x + bw / 2; box.cy = box.y + bh / 2;
      box._fitW = DEF.branchMaxW;                     // 文字预算（自检用）
      box._from = nd;
      branches.push(box);
      nd._branch = box;
    });

    /* 2.4 连接：同行内水平箭头；跨行时走"出行末 → 下拐 → 进下一行行首"
           的直角折线（不是曲线——流程图的拐弯用直角更像工程图）。   */
    const links = [];
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = nodes[i], b = nodes[i + 1];
      if (a.row === b.row) {
        const toRight = b.cx > a.cx;
        links.push({
          kind: 'h',
          x1: toRight ? a.x + a.w : a.x, y1: a.cy,
          x2: toRight ? b.x : b.x + b.w, y2: b.cy,
        });
      } else {
        // 折行：从 a 的底边中点往下，横移到 b 的正上方，再往下扎进 b
        const midY = (a.y + a.h + b.y) / 2;
        links.push({
          kind: 'v',
          x1: a.cx, y1: a.y + a.h,
          mx: b.cx, my: midY,
          x2: b.cx, y2: b.y,
        });
      }
    }

    return { nodes, branches, rows: rowPlan, stepW, stepH, links };
  }

  /* ── 3 · 渲染 ────────────────────────────────────────────────
     颜色：步骤全部同一档（nodeStyle(1)）——顺序步骤是等价的，用色阶
     渐变会读成"越往后越重要"。要强调某一步靠数据里的 emphasis 字段
     单独提到第 0 档，不做通排渐变。

     箭头用 <marker> 定义，颜色走 T.link。marker id 必须每张图唯一
     （同页多张图会撞 id，后画的那张会拿到前一张的 marker 颜色），
     用数据内容算一个确定性 id —— 禁 Math.random()，刷新必须长一样。 */

  /* 层级配色复用 radial 的 AA 死区兜底，保证同一份数据换版式颜色不变 */
  function nodeStyleAA(T, depth) {
    const R = global.DIAGRAM_LAYOUTS && global.DIAGRAM_LAYOUTS.radial;
    if (R && R.nodeStyleAA) return R.nodeStyleAA(T, depth);
    return T.nodeStyle(depth);
  }

  /** 折线 path：直角拐弯，转角处不倒圆（工程图口径） */
  function elbowPath(lk) {
    if (lk.kind === 'h') {
      return `M${r2(lk.x1)} ${r2(lk.y1)} L${r2(lk.x2)} ${r2(lk.y2)}`;
    }
    return `M${r2(lk.x1)} ${r2(lk.y1)} L${r2(lk.x1)} ${r2(lk.my)} `
      + `L${r2(lk.mx)} ${r2(lk.my)} L${r2(lk.x2)} ${r2(lk.y2)}`;
  }

  /**
   * 画步骤盒里的文字：可选序号（01/02）+ 标题 + note。
   * @param {SVGElement} g
   * @param {Object} n     步骤节点
   * @param {string} fill  字色
   * @param {boolean} numbered
   */
  function drawStepText(g, n, fill, numbered) {
    const lines = n.lines && n.lines.length ? n.lines : [n.text || ''];
    const lh = n.lineHeight || Math.round((n.fontSize || 14) * 1.4);
    const bodyH = lines.length * lh;
    const noteH = n._noteLines ? n._noteLines.length * n._noteLH : 0;
    const numH = numbered ? n._numH : 0;
    const tx = n.cx;
    // 整块（序号 + 标题 + note）垂直居中
    const blockTop = n.y + (n.h - numH - bodyH - noteH) / 2;

    if (numbered) {
      const nt = DIAGRAM.el(g, 'text', {
        x: r2(tx), y: r2(blockTop + n._numSize * 0.7),
        'text-anchor': 'middle', 'font-size': n._numSize, 'font-weight': 700,
        'font-family': 'inherit', fill: fill, opacity: 0.62,
        'letter-spacing': '.12em', 'dominant-baseline': 'middle',
      });
      nt.textContent = (n.order < 10 ? '0' : '') + n.order;
    }

    const firstY = blockTop + numH + lh / 2;
    const t = DIAGRAM.el(g, 'text', {
      x: r2(tx), y: r2(firstY), 'text-anchor': 'middle',
      'font-size': n.fontSize, 'font-weight': n.fontWeight,
      'font-family': 'inherit', fill: fill, 'dominant-baseline': 'middle',
    });
    lines.forEach((line, i) => {
      const ts = DIAGRAM.el(t, 'tspan', { x: r2(tx), dy: i === 0 ? 0 : lh });
      ts.textContent = line;
    });

    if (n._noteLines && n._noteLines.length) {
      const nt2 = DIAGRAM.el(g, 'text', {
        x: r2(tx), y: r2(firstY + bodyH - lh / 2 + n._noteLH / 2 + 2),
        'text-anchor': 'middle', 'font-size': n._noteSize, 'font-weight': 400,
        'font-family': 'inherit', fill: fill, opacity: 0.72,
        'dominant-baseline': 'middle',
      });
      n._noteLines.forEach((line, i) => {
        const ts = DIAGRAM.el(nt2, 'tspan', { x: r2(tx), dy: i === 0 ? 0 : n._noteLH });
        ts.textContent = line;
      });
    }
  }

  /* ── 4 · 对外渲染入口 ────────────────────────────────────────
     签名与其余六种版式完全一致：
       async render(svg, data, opts) → {nodes, bounds, viewBox, ...}      */

  /**
   * 渲染流程图。
   * @param {SVGElement} svg  目标 SVG（须已在 DOM 中）
   * @param {Object} data     {steps:[{text, note?, branch?}, ...], numbered?}
   *                          也接受直接给数组
   * @param {Object} [opts]   {scope, tokens, numbered, stepGap, rowGap, wrapAt, maxPerRow}
   * @returns {Promise<{nodes:Array, bounds:Object, viewBox:string, projection:Object,
   *                    stepCount:number, rows:number[], branches:number}>}
   */
  async function render(svg, data, opts) {
    opts = opts || {};
    await L.ready();                                  // 字体没就绪就测量 = 全盘偏错

    const T = opts.tokens || DIAGRAM.fromDeck(opts.scope);
    const rawSteps = Array.isArray(data) ? data
      : (data && (data.steps || data.stages || data.phases)) || [];
    const steps = normalizeSteps(rawSteps);
    const numbered = opts.numbered != null ? !!opts.numbered
      : !!(data && data.numbered);

    const info = layoutFlow(steps, Object.assign({}, opts, { numbered }));
    const nodes = info.nodes;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const defs = DIAGRAM.el(svg, 'defs', {});
    const gLinks = DIAGRAM.el(svg, 'g', { 'data-layer': 'links', fill: 'none' });
    const gNodes = DIAGRAM.el(svg, 'g', { 'data-layer': 'nodes' });

    /* 4.1 箭头 marker。id 由内容确定性推出，禁 Math.random() */
    const seed = steps.reduce((s, x, i) => s + x.text.length * (i + 3), steps.length * 31);
    const mid = 'flow-arrow-' + Math.abs((seed * 2654435761) % 1000000);
    const marker = DIAGRAM.el(defs, 'marker', {
      id: mid, viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
      markerUnits: 'userSpaceOnUse',
    });
    DIAGRAM.el(marker, 'path', { d: 'M0 0 L10 5 L0 10 z', fill: T.link });

    /* 4.2 连接线 */
    info.links.forEach(lk => {
      DIAGRAM.el(gLinks, 'path', {
        d: elbowPath(lk), fill: 'none', stroke: T.link,
        'stroke-width': GEOM.linkW, 'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'marker-end': `url(#${mid})`,
      });
    });

    /* 4.3 分支虚线：主步骤底边 → 分支框顶边 */
    info.branches.forEach(b => {
      DIAGRAM.el(gLinks, 'path', {
        d: `M${r2(b.cx)} ${r2(b._from.y + b._from.h)} L${r2(b.cx)} ${r2(b.y)}`,
        fill: 'none', stroke: T.linkFaint,
        'stroke-width': GEOM.linkW, 'stroke-dasharray': '5 4',
        'stroke-linecap': 'round',
      });
    });

    /* 4.4 步骤盒 */
    nodes.forEach(nd => {
      const emph = !!(nd.data && nd.data.emphasis);
      const st = nodeStyleAA(T, emph ? 0 : 1);
      nd._fill = st.fill; nd._ink = st.ink;
      const g = DIAGRAM.el(gNodes, 'g', {});
      DIAGRAM.el(g, 'rect', {
        x: r2(nd.x), y: r2(nd.y), width: r2(nd.w), height: r2(nd.h),
        rx: st.radius, ry: st.radius,
        fill: st.fill, stroke: st.stroke, 'stroke-width': GEOM.strokeW,
      });
      drawStepText(g, nd, st.ink, numbered);
      DIAGRAM.tip(g, nd.text);
    });

    /* 4.5 分支框：淡底（surface 档）+ 正文 ink，明确低一级 */
    const stB = nodeStyleAA(T, 3);
    info.branches.forEach(b => {
      const g = DIAGRAM.el(gNodes, 'g', {});
      DIAGRAM.el(g, 'rect', {
        x: r2(b.x), y: r2(b.y), width: r2(b.w), height: r2(b.h),
        rx: GEOM.leafRadius, ry: GEOM.leafRadius,
        fill: stB.fill, stroke: stB.stroke, 'stroke-width': GEOM.strokeW,
        'stroke-dasharray': '5 4',
      });
      b._fill = stB.fill; b._ink = stB.ink;
      const lh = b.lineHeight;
      const firstY = b.y + (b.h - b.lines.length * lh) / 2 + lh / 2;
      const t = DIAGRAM.el(g, 'text', {
        x: r2(b.cx), y: r2(firstY), 'text-anchor': 'middle',
        'font-size': b.fontSize, 'font-weight': 400,
        'font-family': 'inherit', fill: stB.ink, 'dominant-baseline': 'middle',
      });
      b.lines.forEach((line, i) => {
        const ts = DIAGRAM.el(t, 'tspan', { x: r2(b.cx), dy: i === 0 ? 0 : lh });
        ts.textContent = line;
      });
      DIAGRAM.tip(g, b.text);
    });

    const boxes = nodes.concat(info.branches);
    const vb = L.fitViewBox(svg, boxes);
    const projection = DIAGRAM.enforceProjection(svg);

    return {
      nodes: boxes,
      bounds: L.boundsOf(boxes),
      viewBox: vb.viewBox,
      projection,
      stepCount: nodes.length,
      rows: info.rows,
      branches: info.branches.length,
    };
  }

  /* ── 5 · 版式自述（供目录 / 自动选型使用） ─────────────────── */

  /**
   * 版式元信息。
   * @returns {{name:string, zhName:string, dataShape:string, whenToUse:string}}
   */
  function describe() {
    return {
      name: 'flow',
      zhName: '流程图',
      dataShape: '{steps: [{text, note?, branch?}, ...], numbered?: true}',
      whenToUse: '顺序步骤：先做什么再做什么。作业流程、项目阶段、审批链路、'
        + '方法论的执行顺序。超过 5 步自动折成蛇形多行；branch 字段给某一步'
        + '挂虚线分支说明。无先后关系的并列项用 grouped。',
    };
  }

  global.DIAGRAM_LAYOUTS = global.DIAGRAM_LAYOUTS || {};
  global.DIAGRAM_LAYOUTS.flow = {
    render, describe,
    layout: layoutFlow,
    // 导出内部件供单测 / 其他版式复用
    normalizeSteps, planRows, elbowPath, drawStepText, nodeStyleAA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
