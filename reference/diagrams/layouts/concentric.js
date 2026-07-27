/* ═══════════════════════════════════════════════════════════════
   CONCENTRIC — 同心圆（包含关系）

   一圈套一圈，从内到外。讲的是"外层包含内层"：核心圈层-扩展圈层-生态
   圈层、个人-团队-组织-行业、核心技术-产品-市场。与金字塔的区别是金字
   塔讲"垒上去"（有高低），同心圆讲"套进去"（有内外，无高低）。

   ── 数据 ─────────────────────────────────────────────────
   {rings: [{text, note?}, ...]}，第 0 个是圆心（实心圆），其余是圆环。

   ── 文字为什么不沿弧排 ───────────────────────────────────
   沿弧排文字（textPath）看着高级，但三个硬伤：①中文方块字沿弧排会逐字
   歪，投屏放大后每个字的倾斜不一致，很难读；②截图转 PPT 时 textPath
   依赖的 <path> 若被优化掉，文字整块丢失；③行数一多根本排不下。
   所以一律用「圆环顶部（12 点方向）水平排布」——文字压在环带上，水平
   居中，可读性和普通标签一样。这是有意的取舍，别改回沿弧。

   ── 环宽怎么定 ───────────────────────────────────────────
   等半径分环（每环同宽），但环宽有下限：必须放得下该环文字的高度 +
   上下留白。文字放不下时先缩字号（最多缩到 PROJECTION.minSvgFont），
   再不行就换行 —— 换行会撑高需求，所以是「量→定环宽→再量」的两轮。

   ── 依赖 ─────────────────────────────────────────────────
     deck-tokens.js → diagram-tokens.js → layout-core.js → 本文件
   挂载：window.DIAGRAM_LAYOUTS.concentric
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DIAGRAM = global.DIAGRAM;
  const L = global.DIAGRAM_LAYOUT;
  if (!DIAGRAM) throw new Error('[concentric] 需要先加载 diagram-tokens.js');
  if (!L) throw new Error('[concentric] 需要先加载 layout-core.js');

  const GEOM = DIAGRAM.GEOM;
  const r2 = v => Math.round(v * 100) / 100;
  const MIN_FONT = global.DECK.PROJECTION.minSvgFont;

  const DEF = {
    coreRadius: 96,      // 圆心实心圆半径（会被文字撑大）
    ringWidth: 74,       // 单环带宽（会被文字撑大）
    ringGap: 4,          // 环与环之间的缝
    labelPad: 10,        // 环内文字上下留白
    coreMaxTextW: 0.78,  // 圆心文字最大宽 / 直径
  };

  /* ── 1 · 环数据规整 ──────────────────────────────────────────
     畸形项直接丢。同心圆的幽灵环比树的幽灵节点更麻烦：它会白占一整圈
     半径，把外层全部推远，整张图缩到看不清，而且圈上没字看不出是错。 */

  /**
   * 把原始环数组过滤成 {text, note} 列表。
   * @param {Array} raw
   * @returns {Array<{text:string, note:string, data:Object}>}
   */
  function normalizeRings(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;                    // 类型不对就当空数组
    (raw || []).forEach(item => {
      if (item == null) return;
      const ty = typeof item;
      if (ty !== 'object' && ty !== 'string') return;      // 数字/布尔一律丢
      const o = ty === 'string' ? { text: item } : item;
      const text = o.text != null ? String(o.text) : (o.label != null ? String(o.label) : '');
      if (!text.trim()) return;
      out.push({ text, note: o.note != null ? String(o.note) : '', data: o });
    });
    return out;
  }

  /* ── 2 · 文字装配：先缩字号，实在不行才换行 ──────────────────
     圆环顶部可用的水平宽度不是环宽，是「在该环顶部这条水平带上，圆环
     内外弧之间能容纳的最长水平线段」。保守起见直接取环的内径×1.4 ——
     顶部带宽越窄越靠近圆心水平弦长越短，用内径估是安全侧。          */

  /**
   * 给一段文字挑一个能在 maxW × maxH 里放下的字号 + 行数组。
   * @param {string} text
   * @param {number} baseSize   起始字号
   * @param {number} weight
   * @param {number} maxW       可用宽
   * @param {number} maxLines   最多几行
   * @returns {{lines:string[], size:number, lineHeight:number, height:number, width:number}}
   */
  function fitText(text, baseSize, weight, maxW, maxLines) {
    let size = baseSize;
    let best = null;
    // 每次降 1px，降到投屏下限为止；先试单行，放不下再允许换行
    while (size >= MIN_FONT) {
      const wr = L.wrapText(text, size, weight, maxW);
      if (!best) best = { wr, size };
      if (wr.lines.length <= maxLines) { best = { wr, size }; break; }
      size -= 1;
    }
    const wr = best.wr;
    return {
      lines: wr.lines.slice(0, Math.max(1, maxLines)),
      size: best.size,
      lineHeight: wr.lineHeight,
      height: Math.min(wr.lines.length, Math.max(1, maxLines)) * wr.lineHeight,
      width: wr.width,
    };
  }

  /* ── 3 · 布局 ────────────────────────────────────────────────
     3.1 圆心：半径按文字块外接圆算（文字宽高的一半的斜边），不足给下限
     3.2 各环：环宽按该环文字块高 + 上下留白定，取所有环的最大值统一
         （环宽不一致的同心圆看着像年轮，读不出"等价的一层"）
     3.3 文字落点：圆心居中；每环放在环带顶部的中线上              */

  /**
   * 同心圆布局。
   * @param {Array} rings  normalizeRings 的输出
   * @param {Object} opts  {coreRadius, ringWidth, ringGap}
   * @returns {{nodes:Array, radius:number, ringW:number, coreR:number}}
   */
  function layoutConcentric(rings, opts) {
    opts = opts || {};
    const gap = opts.ringGap == null ? DEF.ringGap : opts.ringGap;
    const n = rings.length;
    if (!n) return { nodes: [], radius: 0, ringW: 0, coreR: 0 };

    const noteSize = Math.max(DIAGRAM.TYPO.l3.size - 1, 11);

    /* 3.1 圆心 */
    const core = rings[0];
    const coreF = DIAGRAM.TYPO.root;
    const coreR0 = opts.coreRadius == null ? DEF.coreRadius : opts.coreRadius;
    const coreFit = fitText(core.text, coreF.size, coreF.weight,
      coreR0 * 2 * DEF.coreMaxTextW, 3);
    let coreNote = null;
    if (core.note) {
      coreNote = L.wrapText(core.note, noteSize, 400, coreR0 * 2 * DEF.coreMaxTextW);
    }
    const coreTextH = coreFit.height + (coreNote ? coreNote.height + 4 : 0);
    const coreTextW = Math.max(coreFit.width, coreNote ? coreNote.width : 0);
    // 文字块外接圆半径 + 内边距；不小于给定下限
    const coreR = Math.max(coreR0,
      Math.ceil(Math.hypot(coreTextW / 2, coreTextH / 2)) + GEOM.padY + 4);

    /* 3.2 各环：两轮。第一轮按默认环宽估文字高，定出统一环宽；第二轮按
           最终几何重排文字（环宽变了，可用宽跟着变，行数会不一样）。

           可用宽不是环宽，是「文字块所在那条水平带上，圆环内外弧之间能
           容纳的最长水平线段」。文字块贴着环带外缘，底部最多压到内径，
           所以最窄处是 y = -inner 那条弦，半宽 = √(outer² - inner²)。
           第一版用 inner×1.4 是拍脑袋的保守值，实测把「评估方法与作业
           规范」逼成两行、第二行只剩一个「范」字，很难看。改用真实弦长
           后同样的文字一行放得下。                                      */
    const ringW0 = opts.ringWidth == null ? DEF.ringWidth : opts.ringWidth;

    /** 某环顶部可用的水平宽（真实弦长，留一点内边距） */
    const chordW = (inner, outer) =>
      Math.max(120, 2 * Math.sqrt(Math.max(1, outer * outer - inner * inner)) - GEOM.padX * 2);

    function measureRings(ringW) {
      const list = [];
      for (let i = 1; i < n; i++) {
        const f = DIAGRAM.TYPO.byDepth(Math.min(i, 3));
        const inner = coreR + (i - 1) * (ringW + gap) + gap;
        const availW = chordW(inner, inner + ringW);
        const fit = fitText(rings[i].text, f.size, f.weight, availW, 2);
        let note = null;
        if (rings[i].note) note = L.wrapText(rings[i].note, noteSize, 400, availW);
        list.push({ fit, note, weight: f.weight, availW });
      }
      return list;
    }

    let provisional = measureRings(ringW0);
    const needH = provisional.reduce((mx, p) =>
      Math.max(mx, p.fit.height + (p.note ? p.note.height + 3 : 0)), 0);
    const ringW = Math.max(ringW0, Math.ceil(needH + DEF.labelPad * 2));
    if (ringW !== ringW0) provisional = measureRings(ringW);   // 环宽变了要重排

    /* 3.3 落坐标。圆心在 (0,0)；每环记内外半径与文字锚点 */
    const nodes = [];
    nodes.push({
      index: 0, ring: false,
      text: core.text, note: core.note, data: core.data,
      depth: 0,
      r: coreR, innerR: 0, outerR: coreR,
      lines: coreFit.lines, fontSize: coreFit.size, fontWeight: coreF.weight,
      lineHeight: coreFit.lineHeight,
      _noteLines: coreNote ? coreNote.lines : null,
      _noteLH: coreNote ? coreNote.lineHeight : 0,
      _noteSize: noteSize,
      labelX: 0, labelY: 0, labelAnchorMid: true,
      _fitW: coreR * 2 * DEF.coreMaxTextW,            // 文字预算（自检用）
      // 包围盒（重叠检测 / viewBox 用）
      x: -coreR, y: -coreR, w: coreR * 2, h: coreR * 2, cx: 0, cy: 0,
    });

    for (let i = 1; i < n; i++) {
      const p = provisional[i - 1];
      const inner = coreR + (i - 1) * (ringW + gap) + gap;
      const outer = inner + ringW;
      const d = Math.min(i, 3);
      const bodyH = p.fit.height;
      const noteH = p.note ? p.note.height + 3 : 0;
      // 文字块整体垂直居中于环带（顶部 12 点方向）
      const top = -outer + (ringW - bodyH - noteH) / 2;
      nodes.push({
        index: i, ring: true,
        text: rings[i].text, note: rings[i].note, data: rings[i].data,
        depth: d,
        innerR: inner, outerR: outer, r: (inner + outer) / 2,
        lines: p.fit.lines, fontSize: p.fit.size, fontWeight: p.weight,
        lineHeight: p.fit.lineHeight,
        _noteLines: p.note ? p.note.lines : null,
        _noteLH: p.note ? p.note.lineHeight : 0,
        _noteSize: noteSize,
        labelX: 0, labelY: top,
        _fitW: p.availW,                              // 文字预算（自检用）
        // 包围盒取环的外接正方形
        x: -outer, y: -outer, w: outer * 2, h: outer * 2, cx: 0, cy: 0,
      });
    }

    const radius = nodes[nodes.length - 1].outerR;
    return { nodes, radius, ringW, coreR };
  }

  /* ── 4 · 渲染 ────────────────────────────────────────────────
     画法：从外往内画实心圆（外层大圆先画，内层小圆压在上面）。用实心圆
     叠加而不是画环（annulus path），有两个好处：①不用处理 fill-rule 的
     偶奇规则，各家 SVG 渲染器对带洞路径的处理不完全一致；②相邻环之间
     的缝靠"内圆比外圆的内径小一点点"自然形成，不用额外描白边。

     代价是：环的填充不能带透明度（会透出下面那圈）。同心圆本来也不需要
     透明填充，所以这个代价不成立，取叠加法。                        */

  /* 层级配色复用 radial 的 AA 死区兜底，保证同一份数据换版式颜色不变 */
  function nodeStyleAA(T, depth) {
    const R = global.DIAGRAM_LAYOUTS && global.DIAGRAM_LAYOUTS.radial;
    if (R && R.nodeStyleAA) return R.nodeStyleAA(T, depth);
    return T.nodeStyle(depth);
  }

  /**
   * 画一个环/圆心的文字（正文 + note），逐行 tspan。
   * @param {SVGElement} g
   * @param {Object} n     环节点
   * @param {string} fill  字色
   */
  function drawRingText(g, n, fill) {
    const lines = n.lines && n.lines.length ? n.lines : [n.text || ''];
    const lh = n.lineHeight || Math.round((n.fontSize || 14) * 1.4);
    const bodyH = lines.length * lh;
    const noteH = n._noteLines ? n._noteLines.length * n._noteLH : 0;
    // ring：labelY 是文字块顶部；core：labelY 是块中心
    const firstY = n.ring
      ? n.labelY + lh / 2
      : n.labelY - (bodyH + noteH) / 2 + lh / 2;

    const t = DIAGRAM.el(g, 'text', {
      x: r2(n.labelX), y: r2(firstY), 'text-anchor': 'middle',
      'font-size': n.fontSize, 'font-weight': n.fontWeight,
      'font-family': 'inherit', fill: fill, 'dominant-baseline': 'middle',
    });
    lines.forEach((line, i) => {
      const ts = DIAGRAM.el(t, 'tspan', { x: r2(n.labelX), dy: i === 0 ? 0 : lh });
      ts.textContent = line;
    });

    if (n._noteLines && n._noteLines.length) {
      const nt = DIAGRAM.el(g, 'text', {
        x: r2(n.labelX), y: r2(firstY + bodyH - lh / 2 + n._noteLH / 2 + 2),
        'text-anchor': 'middle', 'font-size': n._noteSize, 'font-weight': 400,
        'font-family': 'inherit', fill: fill, opacity: 0.72,
        'dominant-baseline': 'middle',
      });
      n._noteLines.forEach((line, i) => {
        const ts = DIAGRAM.el(nt, 'tspan', { x: r2(n.labelX), dy: i === 0 ? 0 : n._noteLH });
        ts.textContent = line;
      });
    }
  }

  /* ── 5 · 对外渲染入口 ────────────────────────────────────────
     签名与其余六种版式完全一致：
       async render(svg, data, opts) → {nodes, bounds, viewBox, ...}      */

  /**
   * 渲染同心圆。
   * @param {SVGElement} svg  目标 SVG（须已在 DOM 中）
   * @param {Object} data     {title?, rings:[{text, note?}, ...]}；也接受直接给数组
   * @param {Object} [opts]   {scope, tokens, coreRadius, ringWidth, ringGap}
   * @returns {Promise<{nodes:Array, bounds:Object, viewBox:string, projection:Object,
   *                    ringCount:number, radius:number}>}
   */
  async function render(svg, data, opts) {
    opts = opts || {};
    await L.ready();                                  // 字体没就绪就测量 = 全盘偏错

    const T = opts.tokens || DIAGRAM.fromDeck(opts.scope);
    const rawRings = Array.isArray(data) ? data
      : (data && (data.rings || data.circles || data.layers)) || [];
    const rings = normalizeRings(rawRings);

    const info = layoutConcentric(rings, opts);
    const nodes = info.nodes;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const gDisc = DIAGRAM.el(svg, 'g', { 'data-layer': 'rings' });
    const gText = DIAGRAM.el(svg, 'g', { 'data-layer': 'labels' });

    const n = nodes.length;
    /* 5.1 从外往内画实心圆。内层色更重（depth 小），所以 depth 直接用
           环号：0=圆心最重，向外递减。                             */
    for (let i = n - 1; i >= 0; i--) {
      const nd = nodes[i];
      const st = nodeStyleAA(T, nd.depth);
      nd._fill = st.fill;
      nd._ink = st.ink;
      const g = DIAGRAM.el(gDisc, 'g', {});
      DIAGRAM.el(g, 'circle', {
        cx: 0, cy: 0, r: r2(nd.outerR),
        fill: st.fill, stroke: st.stroke, 'stroke-width': GEOM.strokeW,
      });
      DIAGRAM.tip(g, nd.text);
    }

    /* 5.2 文字全部画在最上层，避免被后画的内圈盖住 */
    nodes.forEach(nd => {
      const g = DIAGRAM.el(gText, 'g', {});
      drawRingText(g, nd, nd._ink);
    });

    const vb = L.fitViewBox(svg, nodes);
    const projection = DIAGRAM.enforceProjection(svg);

    return {
      nodes,
      bounds: L.boundsOf(nodes),
      viewBox: vb.viewBox,
      projection,
      ringCount: n,
      radius: info.radius,
      ringWidth: info.ringW,
    };
  }

  /* ── 6 · 版式自述（供目录 / 自动选型使用） ─────────────────── */

  /**
   * 版式元信息。
   * @returns {{name:string, zhName:string, dataShape:string, whenToUse:string}}
   */
  function describe() {
    return {
      name: 'concentric',
      zhName: '同心圆',
      dataShape: '{rings: [{text, note?}, ...]}（从内到外的扁平层数组，第 0 项是圆心）',
      whenToUse: '包含关系：外层把内层裹在里面，层与层无高低之分。核心圈—扩展圈—生态圈、'
        + '个人—团队—组织—行业、核心技术—产品—市场。常见 3–5 环；'
        + '有高低递进用金字塔，有先后顺序用流程图。',
    };
  }

  global.DIAGRAM_LAYOUTS = global.DIAGRAM_LAYOUTS || {};
  global.DIAGRAM_LAYOUTS.concentric = {
    render, describe,
    layout: layoutConcentric,
    // 导出内部件供单测 / 其他版式复用
    normalizeRings, fitText, drawRingText, nodeStyleAA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
