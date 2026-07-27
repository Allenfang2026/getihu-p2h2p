/* ═══════════════════════════════════════════════════════════════
   GROUPED — 逻辑分组图（咨询报告风格）

   若干圆角矩形容器横向并排，每个容器里标题在上、要点卡片纵向排列。
   讲的是"把一堆要点归成几类"：能力模块、服务内容、方案要素、三大板块。
   是最像咨询报告正文页的版式，也是最容易滥用的——只有真的分得出类
   才用它，硬凑的分组比不分组更糟。

   ── 数据 ─────────────────────────────────────────────────
   {groups: [{title, note?, items: [{text, note?}]}], flow?: true}
   flow=true 时组间加箭头，表示这几组之间有先后关系（否则纯并列）。

   ── 严格对齐是这个版式的全部 ─────────────────────────────
   咨询报告的分组图靠"绝对整齐"取胜：所有组等宽、等高，组内所有卡片
   等宽、顶端对齐、间距一致。稍微差几个像素就从"专业"掉到"随手做的"。
   所以这里全部走统一格子：
     · 组宽 = 所有组的最大需求宽（不是各自按内容）
     · 组高 = 所有组的最大需求高（短的组底部留白，不拉伸卡片）
     · 卡片宽 = 组宽 - 左右内边距，所有卡片一样宽
   代价是内容量悬殊时短组会有大片留白。留白比参差好，取留白。

   ── 折行成网格 ───────────────────────────────────────────
   组数多时（>4）折成网格。与流程图的蛇形不同，这里每行都从左开始
   （打字机式）——分组是并列关系，没有"顺着走"的方向，蛇形反而会让人
   误以为第二行要从右往左读。

   ── 依赖 ─────────────────────────────────────────────────
     deck-tokens.js → diagram-tokens.js → layout-core.js → 本文件
   挂载：window.DIAGRAM_LAYOUTS.grouped
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DIAGRAM = global.DIAGRAM;
  const L = global.DIAGRAM_LAYOUT;
  if (!DIAGRAM) throw new Error('[grouped] 需要先加载 diagram-tokens.js');
  if (!L) throw new Error('[grouped] 需要先加载 layout-core.js');

  const GEOM = DIAGRAM.GEOM;
  const r2 = v => Math.round(v * 100) / 100;

  const DEF = {
    groupGap: 34,        // 组与组的水平间距（flow=true 时要放得下箭头）
    rowGap: 30,          // 网格折行的行间距
    maxPerRow: 4,        // 每行最多几组
    padX: 16,            // 组容器内边距 · 横
    padY: 16,            // 组容器内边距 · 竖
    titleGap: 12,        // 组标题与第一张卡片的间距
    cardGap: 9,          // 卡片之间的垂直间距
    cardPadX: 12,        // 卡片内边距 · 横
    cardPadY: 9,         // 卡片内边距 · 竖
    groupMaxW: 240,      // 组容器最大宽
    groupMinW: 150,
  };

  /* ── 1 · 数据规整 ────────────────────────────────────────────
     两层都要过滤：groups 里的畸形项、以及每组 items 里的畸形项。
     分组图的幽灵组是个空白容器，比其它版式更显眼（一大块纯色空框），
     幽灵卡片则是组内一条空白横条，读者会以为内容没加载出来。      */

  /**
   * 把原始 groups 数组过滤成 {title, note, items} 列表。
   * @param {Array} raw
   * @returns {Array<{title:string, note:string, items:Array, data:Object}>}
   */
  function normalizeGroups(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;                    // 类型不对就当空数组
    (raw || []).forEach(item => {
      if (item == null) return;
      const ty = typeof item;
      if (ty !== 'object' && ty !== 'string') return;      // 数字/布尔一律丢
      const o = ty === 'string' ? { title: item } : item;
      const title = o.title != null ? String(o.title)
        : (o.text != null ? String(o.text) : (o.label != null ? String(o.label) : ''));
      if (!title.trim()) return;
      const items = [];
      const rawItems = o.items || o.points || o.children || [];
      (Array.isArray(rawItems) ? rawItems : []).forEach(it => {   // 类型不对就当空数组
        if (it == null) return;
        const t2 = typeof it;
        if (t2 !== 'object' && t2 !== 'string') return;
        const text = t2 === 'string' ? it
          : (it.text != null ? String(it.text) : (it.label != null ? String(it.label) : ''));
        if (!String(text).trim()) return;
        items.push({
          text: String(text),
          note: (t2 === 'object' && it.note != null) ? String(it.note) : '',
          data: t2 === 'object' ? it : { text: text },
        });
      });
      out.push({
        title,
        note: o.note != null ? String(o.note) : '',
        items, data: o,
      });
    });
    return out;
  }

  /* ── 2 · 布局 ────────────────────────────────────────────────
     两轮测量：第一轮按最大允许宽量出每组需要多宽，取全局最大值定组宽；
     第二轮按定下来的组宽重排文字（重排会改行数、改高度），再取全局
     最大高定组高。一轮量不出来——宽度定死之前不知道会换几行。      */

  /**
   * 分组布局。
   * @param {Array} groups  normalizeGroups 的输出
   * @param {Object} opts   {groupGap, rowGap, maxPerRow, flow}
   * @returns {{groups:Array, nodes:Array, rows:number[], groupW:number, groupH:number,
   *            links:Array}}
   */
  function layoutGrouped(groups, opts) {
    opts = opts || {};
    const gGap = opts.groupGap == null ? DEF.groupGap : opts.groupGap;
    const rGap = opts.rowGap == null ? DEF.rowGap : opts.rowGap;
    const maxPerRow = opts.maxPerRow == null ? DEF.maxPerRow : opts.maxPerRow;

    const n = groups.length;
    if (!n) return { groups: [], nodes: [], rows: [], groupW: 0, groupH: 0, links: [] };

    const titleF = DIAGRAM.TYPO.l1;
    const cardF = DIAGRAM.TYPO.l2;
    const noteSize = Math.max(DIAGRAM.TYPO.l3.size - 1, 11);

    /* 2.1 第一轮：按最大允许宽量，取全局组宽 */
    const innerMax = DEF.groupMaxW - DEF.padX * 2;
    let needW = DEF.groupMinW - DEF.padX * 2;
    groups.forEach(g => {
      const tw = L.wrapText(g.title, titleF.size, titleF.weight, innerMax).width;
      needW = Math.max(needW, tw);
      if (g.note) {
        needW = Math.max(needW, L.wrapText(g.note, noteSize, 400, innerMax).width);
      }
      g.items.forEach(it => {
        const w = L.wrapText(it.text, cardF.size, cardF.weight,
          innerMax - DEF.cardPadX * 2).width + DEF.cardPadX * 2;
        needW = Math.max(needW, w);
      });
    });
    const innerW = Math.min(innerMax, Math.ceil(needW));
    const groupW = innerW + DEF.padX * 2;
    const cardW = innerW;

    /* 2.2 第二轮：按定下来的宽度重排，量各组高度 */
    const prepared = groups.map(g => {
      const tw = L.wrapText(g.title, titleF.size, titleF.weight, innerW);
      const gn = g.note ? L.wrapText(g.note, noteSize, 400, innerW) : null;
      const cards = g.items.map(it => {
        const cw = L.wrapText(it.text, cardF.size, cardF.weight,
          cardW - DEF.cardPadX * 2);
        const cn = it.note
          ? L.wrapText(it.note, noteSize, 400, cardW - DEF.cardPadX * 2)
          : null;
        const h = cw.height + (cn ? cn.height + 3 : 0) + DEF.cardPadY * 2;
        return {
          text: it.text, note: it.note, data: it.data,
          lines: cw.lines, lineHeight: cw.lineHeight,
          fontSize: cardF.size, fontWeight: cardF.weight,
          _noteLines: cn ? cn.lines : null,
          _noteLH: cn ? cn.lineHeight : 0,
          _noteSize: noteSize,
          w: cardW, h: Math.ceil(h),
          _fitW: cardW - DEF.cardPadX * 2,            // 卡片内边距是 12 不是 GEOM.padX
        };
      });
      const headH = tw.height + (gn ? gn.height + 3 : 0);
      const bodyH = cards.length
        ? cards.reduce((s, c) => s + c.h, 0) + DEF.cardGap * (cards.length - 1)
        : 0;
      return {
        title: g.title, note: g.note, data: g.data,
        titleLines: tw.lines, titleLH: tw.lineHeight,
        titleSize: titleF.size, titleWeight: titleF.weight,
        noteLines: gn ? gn.lines : null,
        noteLH: gn ? gn.lineHeight : 0,
        noteSize: noteSize,
        cards, headH, bodyH,
      };
    });

    /* 标题区高度全组统一取最大值。
       各组按自己的标题高排卡片时，带 note 的组（多一行小字）会把第一张
       卡片压低一截，几个组并排看过去卡片行错开半行 —— 咨询报告版式最忌
       这个。统一头高后所有组的第一张卡片在同一条水平线上，代价只是没
       note 的组标题下多一点空白。                                     */
    const headH = Math.max.apply(null, prepared.map(p => p.headH));
    prepared.forEach(p => {
      p.headH = headH;
      p.needH = DEF.padY * 2 + headH + (p.cards.length ? DEF.titleGap + p.bodyH : 0);
    });
    const groupH = Math.max.apply(null, prepared.map(p => p.needH));

    /* 2.3 网格铺开。每行都从左开始（并列关系，不用蛇形）。
           最后一行不满时整行居中——左对齐的残行会让整块看着缺一角。 */
    const rows = [];
    for (let i = 0; i < n; i += maxPerRow) rows.push(Math.min(maxPerRow, n - i));
    const widest = Math.max.apply(null, rows);
    const gridW = widest * groupW + (widest - 1) * gGap;

    const nodes = [];
    let idx = 0;
    rows.forEach((cnt, row) => {
      const rowW = cnt * groupW + (cnt - 1) * gGap;
      const offset = (gridW - rowW) / 2;              // 残行居中
      const y = row * (groupH + rGap);
      for (let k = 0; k < cnt; k++) {
        const p = prepared[idx];
        const x = offset + k * (groupW + gGap);
        const node = Object.assign({}, p, {
          index: idx, row, col: k,
          depth: 1,
          x, y, w: groupW, h: groupH,
          cx: x + groupW / 2, cy: y + groupH / 2,
          text: p.title,                              // boundsOf / tip 用
          lines: p.titleLines, lineHeight: p.titleLH,
          fontSize: p.titleSize, fontWeight: p.titleWeight,
          _noteLines: p.noteLines, _noteLH: p.noteLH, _noteSize: p.noteSize,
          _fitW: innerW,                              // 容器内边距是 16 不是 GEOM.padX
        });
        /* 卡片落坐标：统一标题区之下，从上往下顺排（headH 全组一致） */
        let cy = y + DEF.padY + p.headH + DEF.titleGap;
        node.cards = p.cards.map(c => {
          const box = Object.assign({}, c, {
            x: x + DEF.padX, y: cy, cx: x + groupW / 2, cy: cy + c.h / 2,
            isCard: true, group: idx,
          });
          cy += c.h + DEF.cardGap;
          return box;
        });
        node._headH = p.headH;
        nodes.push(node);
        idx++;
      }
    });

    /* 2.4 组间箭头（flow=true 时）：同行内水平相连；跨行时不连
           ——网格换行的箭头要绕整行，比不画更吵。折行时改在行末
           标一个"续"的指示（这里选择不画，靠阅读顺序即可）。      */
    const links = [];
    if (opts.flow) {
      for (let i = 0; i + 1 < nodes.length; i++) {
        const a = nodes[i], b = nodes[i + 1];
        if (a.row !== b.row) continue;
        links.push({ x1: a.x + a.w, y1: a.cy, x2: b.x, y2: b.cy });
      }
    }

    return { groups: nodes, nodes, rows, groupW, groupH, links };
  }

  /* ── 3 · 渲染 ────────────────────────────────────────────────
     颜色分工（克制是这个版式的要求）：
       组容器 = surface 档（最淡），只是个底板，不该抢眼
       组标题 = 正文 ink（不是配填充算的字色 —— 底板太淡时 pickInk 会
                选浅字，在浅底板上反而看不清）
       卡片   = nodeStyle(2)，中间档，是真正承载内容的元素
     整体只有卡片有明显颜色，容器和标题都退到背景里。这跟其它版式
     "容器重、内容轻"的思路相反，是咨询报告的惯例。                */

  /* 层级配色复用 radial 的 AA 死区兜底，保证同一份数据换版式颜色不变 */
  function nodeStyleAA(T, depth) {
    const R = global.DIAGRAM_LAYOUTS && global.DIAGRAM_LAYOUTS.radial;
    if (R && R.nodeStyleAA) return R.nodeStyleAA(T, depth);
    return T.nodeStyle(depth);
  }

  /**
   * 画多行文字（逐行 tspan）。y 给的是文字块顶部，不是中心。
   * @param {SVGElement} g
   * @param {Object} spec  {x, y, w, lines, lineHeight, fontSize, fontWeight}
   * @param {string} fill
   * @param {string} [anchor='start']
   * @param {number} [opacity=1]
   * @returns {number} 文字块底部 y
   */
  function drawLines(g, spec, fill, anchor, opacity) {
    anchor = anchor || 'start';
    const lines = spec.lines && spec.lines.length ? spec.lines : [spec.text || ''];
    const lh = spec.lineHeight || Math.round((spec.fontSize || 14) * 1.4);
    const tx = anchor === 'middle' ? spec.x + spec.w / 2
      : anchor === 'end' ? spec.x + spec.w : spec.x;
    const attrs = {
      x: r2(tx), y: r2(spec.y + lh / 2), 'text-anchor': anchor,
      'font-size': spec.fontSize, 'font-weight': spec.fontWeight,
      'font-family': 'inherit', fill: fill, 'dominant-baseline': 'middle',
    };
    if (opacity != null && opacity < 1) attrs.opacity = opacity;
    const t = DIAGRAM.el(g, 'text', attrs);
    lines.forEach((line, i) => {
      const ts = DIAGRAM.el(t, 'tspan', { x: r2(tx), dy: i === 0 ? 0 : lh });
      ts.textContent = line;
    });
    return spec.y + lines.length * lh;
  }

  /* ── 4 · 对外渲染入口 ────────────────────────────────────────
     签名与其余六种版式完全一致：
       async render(svg, data, opts) → {nodes, bounds, viewBox, ...}      */

  /**
   * 渲染逻辑分组图。
   * @param {SVGElement} svg  目标 SVG（须已在 DOM 中）
   * @param {Object} data     {groups:[{title, note?, items:[{text, note?}]}], flow?}
   *                          也接受直接给数组
   * @param {Object} [opts]   {scope, tokens, flow, groupGap, rowGap, maxPerRow}
   * @returns {Promise<{nodes:Array, bounds:Object, viewBox:string, projection:Object,
   *                    groupCount:number, cardCount:number, rows:number[]}>}
   */
  async function render(svg, data, opts) {
    opts = opts || {};
    await L.ready();                                  // 字体没就绪就测量 = 全盘偏错

    const T = opts.tokens || DIAGRAM.fromDeck(opts.scope);
    const rawGroups = Array.isArray(data) ? data
      : (data && (data.groups || data.blocks || data.modules)) || [];
    const groups = normalizeGroups(rawGroups);
    const useFlow = opts.flow != null ? !!opts.flow : !!(data && data.flow);

    const info = layoutGrouped(groups, Object.assign({}, opts, { flow: useFlow }));
    const nodes = info.nodes;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const defs = DIAGRAM.el(svg, 'defs', {});
    const gBoard = DIAGRAM.el(svg, 'g', { 'data-layer': 'groups' });
    const gLinks = DIAGRAM.el(svg, 'g', { 'data-layer': 'links', fill: 'none' });
    const gCards = DIAGRAM.el(svg, 'g', { 'data-layer': 'nodes' });

    /* 4.1 组容器：surface 档淡底 + 细描边 */
    const stBoard = nodeStyleAA(T, 4);                // 第 4 档 = DEPTH_T 尾部最淡
    const stCard = nodeStyleAA(T, 2);

    nodes.forEach(nd => {
      const g = DIAGRAM.el(gBoard, 'g', {});
      DIAGRAM.el(g, 'rect', {
        x: r2(nd.x), y: r2(nd.y), width: r2(nd.w), height: r2(nd.h),
        rx: GEOM.nodeRadius + 4, ry: GEOM.nodeRadius + 4,
        fill: stBoard.fill, stroke: stBoard.stroke, 'stroke-width': GEOM.strokeW,
      });
      nd._fill = stBoard.fill;
      nd._ink = stBoard.ink;

      /* 组标题：用配容器底色算出来的 ink（容器很淡时它就是正文色） */
      let ty = drawLines(g, {
        x: nd.x + DEF.padX, y: nd.y + DEF.padY, w: nd.w - DEF.padX * 2,
        lines: nd.titleLines, lineHeight: nd.titleLH,
        fontSize: nd.titleSize, fontWeight: nd.titleWeight,
      }, stBoard.ink, 'start');

      if (nd.noteLines && nd.noteLines.length) {
        drawLines(g, {
          x: nd.x + DEF.padX, y: ty + 3, w: nd.w - DEF.padX * 2,
          lines: nd.noteLines, lineHeight: nd.noteLH,
          fontSize: nd.noteSize, fontWeight: 400,
        }, stBoard.ink, 'start', 0.68);
      }
      void ty;
      DIAGRAM.tip(g, nd.title);
    });

    /* 4.2 组间箭头 */
    if (info.links.length) {
      const seed = groups.reduce((s, g, i) => s + g.title.length * (i + 5), groups.length * 17);
      const mid = 'grp-arrow-' + Math.abs((seed * 2654435761) % 1000000);
      const marker = DIAGRAM.el(defs, 'marker', {
        id: mid, viewBox: '0 0 10 10', refX: '9', refY: '5',
        markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
        markerUnits: 'userSpaceOnUse',
      });
      DIAGRAM.el(marker, 'path', { d: 'M0 0 L10 5 L0 10 z', fill: T.link });
      info.links.forEach(lk => {
        DIAGRAM.el(gLinks, 'path', {
          d: `M${r2(lk.x1 + 6)} ${r2(lk.y1)} L${r2(lk.x2 - 6)} ${r2(lk.y2)}`,
          fill: 'none', stroke: T.link, 'stroke-width': GEOM.linkW,
          'stroke-linecap': 'round', 'marker-end': `url(#${mid})`,
        });
      });
    }

    /* 4.3 要点卡片 */
    let cardCount = 0;
    nodes.forEach(nd => {
      nd.cards.forEach(c => {
        cardCount++;
        const g = DIAGRAM.el(gCards, 'g', {});
        DIAGRAM.el(g, 'rect', {
          x: r2(c.x), y: r2(c.y), width: r2(c.w), height: r2(c.h),
          rx: GEOM.leafRadius, ry: GEOM.leafRadius,
          fill: stCard.fill, stroke: stCard.stroke, 'stroke-width': GEOM.strokeW,
        });
        c._fill = stCard.fill; c._ink = stCard.ink;
        const by = drawLines(g, {
          x: c.x + DEF.cardPadX, y: c.y + DEF.cardPadY, w: c.w - DEF.cardPadX * 2,
          lines: c.lines, lineHeight: c.lineHeight,
          fontSize: c.fontSize, fontWeight: c.fontWeight,
        }, stCard.ink, 'start');
        if (c._noteLines && c._noteLines.length) {
          drawLines(g, {
            x: c.x + DEF.cardPadX, y: by + 3, w: c.w - DEF.cardPadX * 2,
            lines: c._noteLines, lineHeight: c._noteLH,
            fontSize: c._noteSize, fontWeight: 400,
          }, stCard.ink, 'start', 0.72);
        }
        DIAGRAM.tip(g, c.text);
      });
    });

    /* viewBox：只框组容器就够（卡片全在容器内） */
    const vb = L.fitViewBox(svg, nodes);
    const projection = DIAGRAM.enforceProjection(svg);

    /* 返回的 nodes 含组容器和卡片两级，方便调用方做重叠/溢出自检 */
    const allBoxes = [];
    nodes.forEach(nd => { allBoxes.push(nd); nd.cards.forEach(c => allBoxes.push(c)); });

    return {
      nodes: allBoxes,
      groups: nodes,
      bounds: L.boundsOf(nodes),
      viewBox: vb.viewBox,
      projection,
      groupCount: nodes.length,
      cardCount,
      rows: info.rows,
    };
  }

  /* ── 5 · 版式自述（供目录 / 自动选型使用） ─────────────────── */

  /**
   * 版式元信息。
   * @returns {{name:string, zhName:string, dataShape:string, whenToUse:string}}
   */
  function describe() {
    return {
      name: 'grouped',
      zhName: '逻辑分组图',
      dataShape: '{groups: [{title, note?, items: [{text, note?}]}], flow?: true}',
      whenToUse: '并列归类：一堆要点归成几个类别，每类下面若干条。服务内容、'
        + '能力模块、方案要素、三大板块。咨询报告正文页的标准版式；'
        + 'flow=true 时组间加箭头表示先后。组数多于 4 自动折成网格。',
    };
  }

  global.DIAGRAM_LAYOUTS = global.DIAGRAM_LAYOUTS || {};
  global.DIAGRAM_LAYOUTS.grouped = {
    render, describe,
    layout: layoutGrouped,
    // 导出内部件供单测 / 其他版式复用
    normalizeGroups, drawLines, nodeStyleAA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
