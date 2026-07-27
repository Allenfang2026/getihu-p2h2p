/* ═══════════════════════════════════════════════════════════════
   PYRAMID — 金字塔（层级递进）

   顶窄底宽的梯形叠层。讲的是"上层建立在下层之上"这类递进关系：
   战略/战术/执行、马斯洛需求、能力金字塔、评价体系的目标层-准则层-
   指标层。不适合并列关系（那走 grouped）也不适合先后顺序（那走 flow）。

   ── 数据是扁平层数组，不是树 ─────────────────────────────
   {layers: [{text, note?, items?}, ...]}，第 0 个是塔尖。这跟 radial /
   bilateral 的嵌套树是两种口径：金字塔的"层"没有父子关系，第 2 层不
   隶属于第 1 层，只是垫在它下面。硬套 buildTree 会造出一条假的父子链，
   连带 leafCount / tidy tree 那一套全跑偏，所以这里自己走扁平流程。
   items 是层内挂的小字要点，也是扁平的一串，不再往下递归。

   ── 梯形宽度怎么定 ───────────────────────────────────────
   顶宽 topW → 底宽 botW 线性插值。每层是一个上底、下底不等的梯形，
   上底 = 该层顶部的插值宽，下底 = 该层底部的插值宽，相邻两层天然接缝
   对齐，不留三角缝。

   宽度不是想给多少给多少：顶层必须放得下自己的文字。所以 topW 有下限
   ——先按各层实测文字宽反推每层需要的最小梯形宽，再取"能同时满足所有
   层"的那组 topW/botW。层数越多顶层越窄，8 层时顶层文字放不下是必然的，
   兜底是把塔尖文字挪到梯形右侧引出（见 3.3）。

   ── 依赖 ─────────────────────────────────────────────────
     deck-tokens.js → diagram-tokens.js → layout-core.js → 本文件
   挂载：window.DIAGRAM_LAYOUTS.pyramid
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DIAGRAM = global.DIAGRAM;
  const L = global.DIAGRAM_LAYOUT;
  if (!DIAGRAM) throw new Error('[pyramid] 需要先加载 diagram-tokens.js');
  if (!L) throw new Error('[pyramid] 需要先加载 layout-core.js');

  const GEOM = DIAGRAM.GEOM;
  const r2 = v => Math.round(v * 100) / 100;

  /* ── 1 · 尺寸常量 ────────────────────────────────────────────
     层高按内容撑，但有下限：太矮的梯形看不出体积感，层级读不出来。
     底宽默认 720：16:9 的一页里金字塔通常占左侧 2/3，720 是实测比较
     舒服的值，调用方可以用 opts.baseWidth 覆盖。                 */

  const DEF = {
    baseWidth: 720,      // 底层下底宽
    apexRatio: 0.22,     // 塔尖上底宽 / 底宽（层多时会被自动抬高）
    layerGap: 6,         // 层与层之间的缝（画出来的分隔白线）
    minLayerH: 54,       // 单层最小高
    itemGap: 8,          // 层内 items 之间的间距
    itemPad: 14,         // items 与梯形边的距离
    calloutGap: 26,      // 引出线的水平长度
  };

  /* ── 2 · 层数据规整 ──────────────────────────────────────────
     畸形项直接丢：数组里混 null/undefined/数字/布尔时不生成幽灵层。
     金字塔的幽灵层比树的幽灵节点更刺眼——它会在塔身中间劈出一条空带，
     而且宽度插值还照算，肉眼看就是"塔断了一节"。                 */

  /**
   * 把原始层数组过滤成可用的 {text, note, items} 列表。
   * @param {Array} raw
   * @returns {Array<{text:string, note:string, items:Array, data:Object}>}
   */
  function normalizeLayers(raw) {
    const out = [];
    (raw || []).forEach(item => {
      if (item == null) return;
      const ty = typeof item;
      if (ty !== 'object' && ty !== 'string') return;      // 数字/布尔一律丢
      const o = ty === 'string' ? { text: item } : item;
      const text = o.text != null ? String(o.text) : (o.label != null ? String(o.label) : '');
      if (!text.trim()) return;                            // 空文字层等于没内容
      const items = [];
      (o.items || o.points || []).forEach(it => {
        if (it == null) return;
        const t2 = typeof it;
        if (t2 !== 'object' && t2 !== 'string') return;
        const s = t2 === 'string' ? it : (it.text != null ? it.text : it.label);
        if (s == null || !String(s).trim()) return;
        items.push(String(s));
      });
      out.push({ text, note: o.note != null ? String(o.note) : '', items, data: o });
    });
    return out;
  }

  /* ── 3 · 布局 ────────────────────────────────────────────────
     3.1 先按层数定 topW/botW，再逐层算梯形四角
     3.2 层高由文字实测高撑起（含 note），不足 minLayerH 补齐
     3.3 塔尖太窄放不下文字时改走右侧引出（callout）              */

  /**
   * 某层顶部/底部在整座塔上的插值宽度。
   * @param {number} t     0 = 塔尖，1 = 塔底
   * @param {number} topW
   * @param {number} botW
   * @returns {number}
   */
  const widthAt = (t, topW, botW) => topW + (botW - topW) * t;

  /**
   * 金字塔布局：算出每层的梯形四角、文字盒、items 盒。
   * @param {Array} layers  normalizeLayers 的输出
   * @param {Object} opts   {baseWidth, apexRatio, layerGap, minLayerH, maxWidth}
   * @returns {{layers:Array, nodes:Array, topW:number, botW:number, callouts:number}}
   */
  function layoutPyramid(layers, opts) {
    opts = opts || {};
    const botW = opts.baseWidth == null ? DEF.baseWidth : opts.baseWidth;
    const gap = opts.layerGap == null ? DEF.layerGap : opts.layerGap;
    const minH = opts.minLayerH == null ? DEF.minLayerH : opts.minLayerH;
    const n = layers.length;
    if (!n) return { layers: [], nodes: [], topW: 0, botW: botW, callouts: 0 };

    /* 3.1 塔尖宽：层数少时给足（0.22 太尖会显得头重脚轻），层数多时
           反而要抬高——8 层的塔如果尖还是 0.22，中间几层的宽度差只有
           几个像素，看不出递进。经验值：层数 ≤3 用 0.34，≥7 用 0.30，
           中间线性过渡到 0.22。单层退化成矩形。                     */
    let ratio = opts.apexRatio;
    if (ratio == null) {
      if (n <= 1) ratio = 1;
      else if (n <= 3) ratio = 0.34;
      else if (n <= 6) ratio = DEF.apexRatio;
      else ratio = 0.30;
    }
    const topW = botW * ratio;

    /* 3.2 逐层量文字。

       可用文字宽取「该层上部 40% 处的插值宽」减内边距，不是上底宽。
       第一版用上底（最窄处）确实绝对安全，但代价太大：塔尖那层的上底
       只有 158px，「总体评价结论」被逼成两行、第二行只剩一个「论」字，
       note 也跟着断成「成功 / 基本成功 / 部分」+「成功」，很难看。

       梯形是往下越来越宽的，文字块整体垂直居中、又永远在层高的中段，
       所以按 40% 处取宽仍在文字实际所在位置的下界之内 —— 文字上沿最多
       贴到 40% 线，两个上角不会戳出斜边。这是有依据的放宽，不是拍脑袋。 */
    let callouts = 0;
    const nodes = [];
    let y = 0;

    layers.forEach((lay, i) => {
      const t0 = n === 1 ? 0 : i / n;                 // 该层顶部在塔上的位置
      const t1 = n === 1 ? 1 : (i + 1) / n;
      const wTop = widthAt(t0, topW, botW);
      const wBot = widthAt(t1, topW, botW);

      const f = DIAGRAM.TYPO.byDepth(Math.min(i, 3));
      const wText = widthAt(t0 + (t1 - t0) * 0.4, topW, botW);   // 层内 40% 处的宽
      const textMaxW = Math.max(40, wText - GEOM.padX * 2);

      const m = L.measureNode(lay.text, {
        fontSize: f.size, fontWeight: f.weight,
        maxWidth: textMaxW, minW: 0, minH: 0,
      });

      /* 塔尖放不下：实测最长行仍超出可用宽 → 改走右侧引出。
         判据不是"层号 0"而是"真的放不下"，两层的塔尖宽 0.34×720=245px
         完全放得下，不该无差别引出。                                 */
      const longest = m.lines.reduce(
        (mx, ln) => Math.max(mx, L.measureText(ln, f.size, f.weight).width), 0);
      const overflow = longest > textMaxW + 0.5;

      let noteLines = null, noteLH = 0, noteSize = 0;
      if (lay.note) {
        noteSize = Math.max(DIAGRAM.TYPO.l3.size - 1, 11);
        const wrapped = L.wrapText(lay.note, noteSize, 400,
          overflow ? 240 : Math.max(60, textMaxW));
        noteLines = wrapped.lines;
        noteLH = wrapped.lineHeight;
      }

      /* items：层内小字要点，横向铺在梯形下半部；放不下就并入引出区 */
      const itemSize = Math.max(DIAGRAM.TYPO.l3.size - 1, 11);
      const itemBoxes = lay.items.map(txt => {
        const wr = L.wrapText(txt, itemSize, 400, 200);
        return { text: txt, lines: wr.lines, lineHeight: wr.lineHeight,
                 w: Math.ceil(wr.width) + 18, h: wr.height + 10, fontSize: itemSize };
      });

      const bodyH = overflow ? 0 : m.h;
      const noteH = noteLines && !overflow ? noteLines.length * noteLH + 4 : 0;
      const itemsH = itemBoxes.length
        ? itemBoxes.reduce((mx, b) => Math.max(mx, b.h), 0) + DEF.itemGap
        : 0;
      const h = Math.max(minH, bodyH + noteH + itemsH + DEF.itemPad);

      const cx = 0;                                   // 塔心固定在 x=0
      const node = {
        index: i,
        text: lay.text,
        note: lay.note,
        data: lay.data,
        depth: Math.min(i, 3),
        fontSize: f.size, fontWeight: f.weight,
        lines: m.lines, lineHeight: m.lineHeight,
        _noteLines: noteLines, _noteLH: noteLH, _noteSize: noteSize,
        items: itemBoxes,
        callout: overflow,
        wTop, wBot,
        // 梯形四角（顺时针，从左上起）
        pts: [
          [cx - wTop / 2, y], [cx + wTop / 2, y],
          [cx + wBot / 2, y + h], [cx - wBot / 2, y + h],
        ],
        // 文字预算：正常层按层内 40% 处宽，引出层按引出框宽（自检用）
        _fitW: overflow ? 240 : textMaxW,
        wText,                                        // 文字块宽（渲染时用）
        // 包围盒（给 boundsOf / 重叠检测用，取梯形外接矩形）
        x: cx - wBot / 2, y: y, w: wBot, h: h,
        cx: cx, cy: y + h / 2,
      };
      if (overflow) callouts++;

      /* items 横排：以该层中线宽为基准均分，居中 */
      if (itemBoxes.length) {
        const midW = (wTop + wBot) / 2 - GEOM.padX * 2;
        const totalW = itemBoxes.reduce((s, b) => s + b.w, 0)
          + DEF.itemGap * (itemBoxes.length - 1);
        // 排不下就压缩间距（不压宽度，宽度压了文字要重排）
        const scale = totalW > midW ? Math.max(0.2, midW / totalW) : 1;
        const g = DEF.itemGap * scale;
        const used = itemBoxes.reduce((s, b) => s + b.w, 0) + g * (itemBoxes.length - 1);
        let ix = cx - used / 2;
        const iy = y + h - itemsH + DEF.itemGap / 2;
        itemBoxes.forEach(b => {
          b.x = ix; b.y = iy;
          b.cx = ix + b.w / 2; b.cy = iy + b.h / 2;
          ix += b.w + g;
        });
      }

      nodes.push(node);
      y += h + gap;
    });

    /* 3.3 引出层：文字盒挂在梯形右侧，走一条短横线连过去 */
    nodes.forEach(nd => {
      if (!nd.callout) return;
      const f = DIAGRAM.TYPO.byDepth(nd.depth);
      const wr = L.wrapText(nd.text, f.size, f.weight, 240);
      nd.lines = wr.lines;
      nd.lineHeight = wr.lineHeight;
      const cw = Math.ceil(wr.width) + 4;
      const chNote = nd._noteLines ? nd._noteLines.length * nd._noteLH + 4 : 0;
      nd.calloutBox = {
        x: nd.cx + nd.wTop / 2 + DEF.calloutGap,
        y: nd.cy - (wr.height + chNote) / 2,
        w: cw, h: wr.height + chNote,
      };
      // 引出线：从梯形右斜边中点拉到文字盒左侧
      nd.calloutLine = [
        nd.cx + (nd.wTop + nd.wBot) / 4, nd.cy,
        nd.calloutBox.x - 6, nd.cy,
      ];
    });

    return { layers: nodes, nodes, topW, botW, callouts };
  }

  /* ── 4 · 渲染 ────────────────────────────────────────────────
     颜色：顶层最重（nodeStyle(0)），往下逐层递减。深度封顶在 3——
     DEPTH_T 第 4 项之后不再变淡，8 层塔的下面五层会是同一个色，这在
     视觉上反而对：递进感由宽度承担，颜色只区分"上中下"三段。      */

  /**
   * 层号 → 色阶深度。层数多时把 0..n-1 压缩映射到 0..3，
   * 保证无论 2 层还是 8 层，塔尖永远最重、塔底永远最淡。
   * @param {number} i 层号
   * @param {number} n 总层数
   * @returns {number} 0～3
   */
  function depthOf(i, n) {
    if (n <= 1) return 0;
    return Math.round(i / (n - 1) * 3);
  }

  /** 梯形 path d @param {Array} pts 四角 @returns {string} */
  function trapPath(pts) {
    return 'M' + pts.map(p => r2(p[0]) + ' ' + r2(p[1])).join(' L') + ' Z';
  }

  /* 层级配色复用 radial 的 AA 死区兜底，保证同一份数据换版式颜色不变 */
  function nodeStyleAA(T, depth) {
    const R = global.DIAGRAM_LAYOUTS && global.DIAGRAM_LAYOUTS.radial;
    if (R && R.nodeStyleAA) return R.nodeStyleAA(T, depth);
    return T.nodeStyle(depth);
  }

  /**
   * 画一层的文字（正文 + note），逐行 tspan，绝不用 foreignObject。
   * @param {SVGElement} g
   * @param {Object} n     层节点
   * @param {Object} box   文字块所在矩形 {x,y,w,h}
   * @param {string} fill  字色
   * @param {string} anchor
   */
  function drawLayerText(g, n, box, fill, anchor) {
    const lines = n.lines && n.lines.length ? n.lines : [n.text || ''];
    const lh = n.lineHeight || Math.round((n.fontSize || 14) * 1.4);
    const noteH = n._noteLines ? n._noteLines.length * n._noteLH : 0;
    const tx = anchor === 'start' ? box.x
      : anchor === 'end' ? box.x + box.w : box.x + box.w / 2;
    const bodyH = lines.length * lh;
    const firstY = box.y + (box.h - bodyH - noteH) / 2 + lh / 2;

    const t = DIAGRAM.el(g, 'text', {
      x: r2(tx), y: r2(firstY), 'text-anchor': anchor,
      'font-size': n.fontSize, 'font-weight': n.fontWeight,
      'font-family': 'inherit', fill: fill, 'dominant-baseline': 'middle',
    });
    lines.forEach((line, i) => {
      const ts = DIAGRAM.el(t, 'tspan', { x: r2(tx), dy: i === 0 ? 0 : lh });
      ts.textContent = line;
    });

    if (n._noteLines && n._noteLines.length) {
      const nt = DIAGRAM.el(g, 'text', {
        x: r2(tx), y: r2(firstY + bodyH - lh / 2 + n._noteLH / 2 + 2),
        'text-anchor': anchor, 'font-size': n._noteSize, 'font-weight': 400,
        'font-family': 'inherit', fill: fill, opacity: 0.72,
        'dominant-baseline': 'middle',
      });
      n._noteLines.forEach((line, i) => {
        const ts = DIAGRAM.el(nt, 'tspan', { x: r2(tx), dy: i === 0 ? 0 : n._noteLH });
        ts.textContent = line;
      });
    }
  }

  /* ── 5 · 对外渲染入口 ────────────────────────────────────────
     签名与其余六种版式完全一致：
       async render(svg, data, opts) → {nodes, bounds, viewBox, ...}      */

  /**
   * 渲染金字塔。
   * @param {SVGElement} svg  目标 SVG（须已在 DOM 中）
   * @param {Object} data     {title?, layers:[{text, note?, items?}, ...]}
   *                          也接受直接给数组
   * @param {Object} [opts]   {scope, tokens, baseWidth, apexRatio, layerGap, minLayerH}
   * @returns {Promise<{nodes:Array, bounds:Object, viewBox:string, projection:Object,
   *                    layerCount:number, callouts:number}>}
   */
  async function render(svg, data, opts) {
    opts = opts || {};
    await L.ready();                                  // 字体没就绪就测量 = 全盘偏错

    const T = opts.tokens || DIAGRAM.fromDeck(opts.scope);
    const rawLayers = Array.isArray(data) ? data
      : (data && (data.layers || data.levels || data.rows)) || [];
    const layers = normalizeLayers(rawLayers);

    const info = layoutPyramid(layers, opts);
    const nodes = info.nodes;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const gBody = DIAGRAM.el(svg, 'g', { 'data-layer': 'layers' });
    const gCall = DIAGRAM.el(svg, 'g', { 'data-layer': 'callouts' });

    const n = nodes.length;
    nodes.forEach(nd => {
      const d = depthOf(nd.index, n);
      nd.depth = d;
      const st = nodeStyleAA(T, d);
      nd._fill = st.fill;
      nd._ink = st.ink;

      const g = DIAGRAM.el(gBody, 'g', {});
      DIAGRAM.el(g, 'path', {
        d: trapPath(nd.pts),
        fill: st.fill, stroke: st.stroke, 'stroke-width': GEOM.strokeW,
        'stroke-linejoin': 'round',
      });

      if (!nd.callout) {
        /* 文字块限制在层内 40% 处的宽度里（口径与 3.2 的测量一致），
           文字上角就不会戳出斜边 */
        const itemsH = nd.items.length
          ? nd.items.reduce((mx, b) => Math.max(mx, b.h), 0) + DEF.itemGap : 0;
        drawLayerText(g, nd, {
          x: nd.cx - nd.wText / 2 + GEOM.padX,
          y: nd.y,
          w: Math.max(20, nd.wText - GEOM.padX * 2),
          h: nd.h - itemsH,
        }, st.ink, 'middle');
      }

      /* items：层内小字胶囊。底色用当前层填充上再叠一层半透明白/黑，
         不引新色 —— 同色系深浅即语义那条 deck 规则不能破。         */
      nd.items.forEach((b, k) => {
        const ig = DIAGRAM.el(g, 'g', {});
        DIAGRAM.el(ig, 'rect', {
          x: r2(b.x), y: r2(b.y), width: r2(b.w), height: r2(b.h),
          rx: GEOM.leafRadius, ry: GEOM.leafRadius,
          fill: st.ink, opacity: 0.13, stroke: 'none',
        });
        const lh = b.lineHeight;
        const firstY = b.y + (b.h - b.lines.length * lh) / 2 + lh / 2;
        const t = DIAGRAM.el(ig, 'text', {
          x: r2(b.cx), y: r2(firstY), 'text-anchor': 'middle',
          'font-size': b.fontSize, 'font-weight': 500,
          'font-family': 'inherit', fill: st.ink, 'dominant-baseline': 'middle',
        });
        b.lines.forEach((line, i) => {
          const ts = DIAGRAM.el(t, 'tspan', { x: r2(b.cx), dy: i === 0 ? 0 : lh });
          ts.textContent = line;
        });
        DIAGRAM.tip(ig, b.text);
        void k;
      });

      DIAGRAM.tip(g, nd.text);
    });

    /* 引出的塔尖文字：画在最上层，文字色走正文 ink（不在填充上，
       所以不能用 st.ink —— 那是配填充算的）。                     */
    nodes.forEach(nd => {
      if (!nd.callout || !nd.calloutBox) return;
      const g = DIAGRAM.el(gCall, 'g', {});
      DIAGRAM.el(g, 'path', {
        d: `M${r2(nd.calloutLine[0])} ${r2(nd.calloutLine[1])} L${r2(nd.calloutLine[2])} ${r2(nd.calloutLine[3])}`,
        fill: 'none', stroke: T.link, 'stroke-width': GEOM.linkW,
        'stroke-linecap': 'round',
      });
      drawLayerText(g, nd, nd.calloutBox, T.ink, 'start');
      DIAGRAM.tip(g, nd.text);
    });

    /* viewBox：梯形外接矩形 + 引出框都要框进去 */
    const boxes = nodes.slice();
    nodes.forEach(nd => { if (nd.calloutBox) boxes.push(nd.calloutBox); });
    const vb = L.fitViewBox(svg, boxes);
    const projection = DIAGRAM.enforceProjection(svg);

    return {
      nodes,
      bounds: L.boundsOf(boxes),
      viewBox: vb.viewBox,
      projection,
      layerCount: n,
      callouts: info.callouts,
    };
  }

  /* ── 6 · 版式自述（供目录 / 自动选型使用） ─────────────────── */

  /**
   * 版式元信息。
   * @returns {{name:string, zhName:string, dataShape:string, whenToUse:string}}
   */
  function describe() {
    return {
      name: 'pyramid',
      zhName: '金字塔',
      dataShape: '{layers: [{text, note?, items?}, ...]}（从顶到底的扁平层数组）',
      whenToUse: '层级递进：上层建立在下层之上。战略—战术—执行、目标层—准则层—指标层、'
        + '能力金字塔。常见 3–6 层；不适合并列关系（用 grouped）或先后顺序（用 flow）。',
    };
  }

  global.DIAGRAM_LAYOUTS = global.DIAGRAM_LAYOUTS || {};
  global.DIAGRAM_LAYOUTS.pyramid = {
    render, describe,
    layout: layoutPyramid,
    // 导出内部件供单测 / 其他版式复用
    normalizeLayers, widthAt, depthOf, trapPath, drawLayerText, nodeStyleAA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
