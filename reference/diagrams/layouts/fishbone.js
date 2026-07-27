/* ═══════════════════════════════════════════════════════════════
   FISHBONE — 鱼骨图（石川图 / 因果分析）

   一条水平主干指向右端的「结果」，主干上交替向上下伸出斜刺（大类原因），
   每根斜刺上再挂若干水平小刺（具体原因）。讲的是"哪些因素导致了这个
   结果"，是质量分析、事故复盘、问题归因的标准版式。

   ── 数据 ─────────────────────────────────────────────────
   {spine: '结果/问题描述', bones: [{text, causes: [...]}]}

   ── 为什么不引 d3 ─────────────────────────────────────────
   参考实现（bollwyvl 的 d3 fishbone gist）用力导向布局排刺，好处是自动
   避让，坏处是每次刷新形状不同、刺的角度乱、导出 PPT 不可复现。鱼骨图
   的骨架本来就是刚性的（主干水平、斜刺固定角度、小刺水平），坐标是算
   出来的不是"跑"出来的。所以只借它的结构思路，坐标全部解析求解。

   ── 上下分配为什么不能奇偶轮流 ───────────────────────────
   简单奇偶分（0上 1下 2上 3下）在刺的子项数悬殊时会一边拖得老长、一边
   空着：4 根刺子项数 6/1/1/1，奇偶分得到上侧 7、下侧 2，整张图上半部
   高度是下半部的三倍多，主干被顶到画面很下面。改成贪心按子项数分配
   （每次把下一根刺给当前较轻的一侧），高度差能压到一根刺以内。

   ── 依赖 ─────────────────────────────────────────────────
     deck-tokens.js → diagram-tokens.js → layout-core.js → 本文件
   挂载：window.DIAGRAM_LAYOUTS.fishbone
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DIAGRAM = global.DIAGRAM;
  const L = global.DIAGRAM_LAYOUT;
  if (!DIAGRAM) throw new Error('[fishbone] 需要先加载 diagram-tokens.js');
  if (!L) throw new Error('[fishbone] 需要先加载 layout-core.js');

  const GEOM = DIAGRAM.GEOM;
  const r2 = v => Math.round(v * 100) / 100;

  const DEF = {
    boneAngle: 60,       // 斜刺与主干的夹角（度）；60° 是石川图的经典角度
    ribGap: 34,          // 同一根斜刺上相邻小刺的间距（沿刺方向）
    ribStart: 42,        // 第一根小刺距主干的距离（沿刺方向）
    ribLen: 16,          // 小刺自身的水平短线长
    boneGapX: 30,        // 相邻两根斜刺根部在主干上的最小水平间距
    headGap: 40,         // 最后一根刺到结果框的水平距离
    tailGap: 26,         // 主干左端多伸出的一截（鱼尾）
    labelGap: 8,         // 刺标签与刺尖的距离
    maxRibW: 190,        // 小刺文字最大宽
    maxBoneW: 170,       // 大类标签最大宽
  };

  const D2R = Math.PI / 180;

  /* ── 1 · 数据规整 ────────────────────────────────────────────
     畸形项直接丢。鱼骨图的幽灵刺特别难发现：它是一根没有标签的斜线，
     肉眼容易当成装饰线，但它占着主干的一段长度、把后面的刺全推走。 */

  /**
   * 把原始 bones 数组过滤成 {text, causes} 列表。
   * @param {Array} raw
   * @returns {Array<{text:string, causes:string[], data:Object}>}
   */
  function normalizeBones(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;                    // 类型不对就当空数组
    (raw || []).forEach(item => {
      if (item == null) return;
      const ty = typeof item;
      if (ty !== 'object' && ty !== 'string') return;      // 数字/布尔一律丢
      const o = ty === 'string' ? { text: item } : item;
      const text = o.text != null ? String(o.text) : (o.label != null ? String(o.label) : '');
      if (!text.trim()) return;
      const causes = [];
      const rawCauses = o.causes || o.children || o.items || [];
      (Array.isArray(rawCauses) ? rawCauses : []).forEach(c => {  // 类型不对就当空数组
        if (c == null) return;
        const t2 = typeof c;
        if (t2 !== 'object' && t2 !== 'string') return;
        const s = t2 === 'string' ? c : (c.text != null ? c.text : c.label);
        if (s == null || !String(s).trim()) return;
        causes.push(String(s));
      });
      out.push({ text, causes, data: o });
    });
    return out;
  }

  /* ── 2 · 上下分配 ────────────────────────────────────────────
     权重 = 该刺的小刺数（决定它沿刺方向要伸多长，进而决定占多少垂直
     高度）。保序：上侧和下侧各自保持原顺序，读图人对得上原文。      */

  /**
   * 贪心按子项数把刺分到上下两侧，尽量平衡两侧总高度。
   * @param {Array} bones
   * @returns {{up:Array, down:Array, upW:number, downW:number}}
   */
  function splitSides(bones) {
    const up = [], down = [];
    let uw = 0, dw = 0;
    bones.forEach(b => {
      const w = Math.max(1, b.causes.length);
      // 先喂较轻的一侧；持平时优先上侧（读图习惯先看上半部）
      if (uw <= dw) { up.push(b); uw += w; }
      else { down.push(b); dw += w; }
    });
    return { up, down, upW: uw, downW: dw };
  }

  /* ── 3 · 布局 ────────────────────────────────────────────────
     坐标系：主干在 y=0，从左（鱼尾）往右（鱼头/结果）。斜刺根部在主干
     上，往外上/外下方伸，并且向左倾斜（刺尖比刺根更靠左）——这是石川图
     的标准朝向，视觉上像箭头都指向右侧的结果。

     一根刺的方向向量：
       up:   (-cos60, -sin60)   刺尖在左上
       down: (-cos60, +sin60)   刺尖在左下
     小刺挂在斜刺上，水平向左伸出短线，标签接在短线左端。            */

  /**
   * 鱼骨布局。
   * @param {string} spineText  结果文字
   * @param {Array} bones       normalizeBones 的输出
   * @param {Object} opts       {boneAngle, ribGap, ...}
   * @returns {{head:Object, bones:Array, spine:Object, nodes:Array, balance:string}}
   */
  function layoutFishbone(spineText, bones, opts) {
    opts = opts || {};
    const ang = (opts.boneAngle == null ? DEF.boneAngle : opts.boneAngle) * D2R;
    const dxU = -Math.cos(ang), dyU = -Math.sin(ang);     // 上刺方向
    const ribGap = opts.ribGap == null ? DEF.ribGap : opts.ribGap;
    const ribStart = opts.ribStart == null ? DEF.ribStart : opts.ribStart;

    const split = splitSides(bones);
    const noteSize = Math.max(DIAGRAM.TYPO.l3.size - 1, 11);

    /* 3.1 结果框（鱼头）：最重色 + 加粗，是全图视觉终点 */
    const headF = DIAGRAM.TYPO.root;
    const headM = L.measureNode(spineText || '', {
      fontSize: headF.size, fontWeight: Math.min(900, headF.weight + 100),
      maxWidth: 200,
    });

    /* 3.2 逐根刺算几何。先按侧内序号排一遍水平位置，再算刺长。
           刺长 = ribStart + (小刺数-1)×ribGap + 尾部余量，
           没有小刺时给一个固定短长度。                              */
    const boneF = DIAGRAM.TYPO.l1;
    const ribF = DIAGRAM.TYPO.l3;

    function prepBone(b, side, idx) {
      const m = L.measureNode(b.text, {
        fontSize: boneF.size, fontWeight: boneF.weight, maxWidth: DEF.maxBoneW,
      });
      const ribs = b.causes.map(txt => {
        const wr = L.wrapText(txt, ribF.size, ribF.weight, DEF.maxRibW);
        return {
          text: txt, lines: wr.lines, lineHeight: wr.lineHeight,
          fontSize: ribF.size, fontWeight: ribF.weight,
          tw: wr.width, th: wr.height,
        };
      });
      const len = ribs.length
        ? ribStart + (ribs.length - 1) * ribGap + 26
        : ribStart + 8;
      return {
        text: b.text, data: b.data, side, sideIndex: idx,
        lines: m.lines, lineHeight: m.lineHeight,
        fontSize: boneF.size, fontWeight: boneF.weight,
        tw: m.textW, th: m.textH, boxW: m.w, boxH: m.h,
        _fitW: DEF.maxBoneW,                         // 文字预算（自检用）
        ribs, length: len,
      };
    }

    const upB = split.up.map((b, i) => prepBone(b, 'up', i));
    const downB = split.down.map((b, i) => prepBone(b, 'down', i));

    /* 3.3 水平位置：两侧交错排布，避免上下两根刺根部重合（重合时两根
           刺的标签会在主干两侧对撞）。做法是把上下两列的根部 x 交错
           半个 boneGapX。                                            */
    const stepBase = opts.boneGapX == null ? DEF.boneGapX : opts.boneGapX;

    /* 一根刺在主干上真正占的水平宽。
       第一版只算「刺斜着占的 len×cos + 标签宽的一半」，8 根刺时撞了两处
       （「方法」×「周边投诉」、「设备」×「质检返工」）——漏掉的是小刺标签：
       小刺挂在斜刺上还要再往左伸 ribLen + 标签宽，最长的那条小刺标签才是
       这根刺真正的左边界，可能比刺尖还靠左一大截。所以取「刺尖标签左缘」
       和「最长小刺标签左缘」两者中更靠左的那个来算占宽。               */
    function occupy(b) {
      const tipLeft = Math.abs(dxU) * b.length + b.boxW / 2;      // 刺尖标签左缘
      let ribLeft = 0;
      b.ribs.forEach((rb, i) => {
        const t = ribStart + i * ribGap;
        ribLeft = Math.max(ribLeft,
          Math.abs(dxU) * t + DEF.ribLen + 4 + rb.tw + 6);         // 小刺标签左缘
      });
      return Math.max(tipLeft, ribLeft) + stepBase;
    }
    const upOcc = upB.map(occupy);
    const downOcc = downB.map(occupy);

    let x = 0;
    upB.forEach((b, i) => { b.rootX = x + upOcc[i] / 2; x += upOcc[i]; });
    const upSpan = x;
    x = 0;
    downB.forEach((b, i) => { b.rootX = x + downOcc[i] / 2; x += downOcc[i]; });
    const downSpan = x;

    /* 两侧总跨度不同时，把短的那侧按比例摊开到长的那侧的跨度上——
       否则一侧的刺挤在左半段、另一侧铺满，主干看着一头空。          */
    const span = Math.max(upSpan, downSpan, 1);
    if (upSpan > 0 && upSpan < span) {
      const k = span / upSpan;
      upB.forEach(b => { b.rootX *= k; });
    }
    if (downSpan > 0 && downSpan < span) {
      const k = span / downSpan;
      downB.forEach(b => { b.rootX *= k; });
    }
    // 交错：下侧整体右移半步，避免上下根部对齐时标签打架
    downB.forEach(b => { b.rootX += stepBase * 0.5; });

    /* 3.4 逐根刺落坐标 */
    const all = upB.concat(downB);
    const nodes = [];

    all.forEach(b => {
      const sy = b.side === 'up' ? dyU : -dyU;         // 上为负 y
      b.tipX = b.rootX + dxU * b.length;
      b.tipY = 0 + sy * b.length;

      /* 大类标签：贴在刺尖外侧，水平居中于刺尖，垂直往外让开一点 */
      b.labelX = b.tipX - b.boxW / 2;
      b.labelY = b.side === 'up'
        ? b.tipY - DEF.labelGap - b.boxH
        : b.tipY + DEF.labelGap;
      b.x = b.labelX; b.y = b.labelY; b.w = b.boxW; b.h = b.boxH;
      b.cx = b.x + b.w / 2; b.cy = b.y + b.h / 2;
      nodes.push(b);

      /* 小刺：沿刺方向等距分布，各自往左伸一小段水平线，标签接在左端 */
      b.ribs.forEach((rb, i) => {
        const t = ribStart + i * ribGap;
        const ax = b.rootX + dxU * t;                  // 挂点（在斜刺上）
        const ay = 0 + sy * t;
        rb.ax = ax; rb.ay = ay;
        rb.bx = ax - DEF.ribLen;                       // 水平短线左端
        rb.by = ay;
        // 标签盒：接在短线左端，垂直居中
        rb.w = Math.ceil(rb.tw) + 6;
        rb.h = rb.th + 4;
        rb._fitW = rb.w;                             // 裸文字，无内边距预算
        rb.x = rb.bx - rb.w - 4;
        rb.y = ay - rb.h / 2;
        rb.cx = rb.x + rb.w / 2;
        rb.cy = ay;
        rb.side = b.side;
        rb.isRib = true;
        nodes.push(rb);
      });
    });

    /* 3.5 主干与鱼头。主干右端接鱼头，左端比最左的刺尖再往左伸一截。 */
    const rightMost = all.length ? Math.max.apply(null, all.map(b => b.rootX)) : 0;
    const headX = rightMost + DEF.headGap;
    const head = {
      text: spineText || '', isHead: true, depth: 0,
      lines: headM.lines, lineHeight: headM.lineHeight,
      fontSize: headF.size, fontWeight: Math.min(900, headF.weight + 100),
      x: headX, y: -headM.h / 2, w: headM.w, h: headM.h,
      cx: headX + headM.w / 2, cy: 0,
      _fitW: 200,                                     // 文字预算（自检用）
    };
    nodes.push(head);

    let leftMost = 0;
    all.forEach(b => { leftMost = Math.min(leftMost, b.tipX, b.labelX); });
    all.forEach(b => b.ribs.forEach(rb => { leftMost = Math.min(leftMost, rb.x); }));
    const spine = {
      x1: leftMost - DEF.tailGap, y1: 0,
      x2: headX, y2: 0,
    };

    return {
      head, spine,
      bones: all,
      nodes,
      balance: split.upW + ' : ' + split.downW,
      up: upB.length, down: downB.length,
    };
  }

  /* ── 4 · 渲染 ────────────────────────────────────────────────
     颜色分工：
       鱼头 = nodeStyle(0)，最重 + 加粗（视觉终点）
       大类标签 = nodeStyle(1)，有底色的胶囊（是"一类原因"的标题）
       小刺 = 无底色纯文字，用正文 ink（有底色会让图变成一堆方块，
              读不出主次；石川图的小刺本来就是裸文字）
       线   = T.link（主干、斜刺）/ T.linkFaint（小刺短线）        */

  /* 层级配色复用 radial 的 AA 死区兜底，保证同一份数据换版式颜色不变 */
  function nodeStyleAA(T, depth) {
    const R = global.DIAGRAM_LAYOUTS && global.DIAGRAM_LAYOUTS.radial;
    if (R && R.nodeStyleAA) return R.nodeStyleAA(T, depth);
    return T.nodeStyle(depth);
  }

  /**
   * 画多行文字（逐行 tspan，整体垂直居中于给定盒子）。
   * @param {SVGElement} g
   * @param {Object} box   {x,y,w,h,lines,lineHeight,fontSize,fontWeight}
   * @param {string} fill
   * @param {string} [anchor='middle']
   */
  function drawBoxText(g, box, fill, anchor) {
    anchor = anchor || 'middle';
    const lines = box.lines && box.lines.length ? box.lines : [box.text || ''];
    const lh = box.lineHeight || Math.round((box.fontSize || 14) * 1.4);
    const tx = anchor === 'start' ? box.x + 3
      : anchor === 'end' ? box.x + box.w - 3 : box.x + box.w / 2;
    const firstY = box.y + (box.h - lines.length * lh) / 2 + lh / 2;
    const t = DIAGRAM.el(g, 'text', {
      x: r2(tx), y: r2(firstY), 'text-anchor': anchor,
      'font-size': box.fontSize, 'font-weight': box.fontWeight,
      'font-family': 'inherit', fill: fill, 'dominant-baseline': 'middle',
    });
    lines.forEach((line, i) => {
      const ts = DIAGRAM.el(t, 'tspan', { x: r2(tx), dy: i === 0 ? 0 : lh });
      ts.textContent = line;
    });
    return t;
  }

  /* ── 5 · 对外渲染入口 ────────────────────────────────────────
     签名与其余六种版式完全一致：
       async render(svg, data, opts) → {nodes, bounds, viewBox, ...}      */

  /**
   * 渲染鱼骨图。
   * @param {SVGElement} svg  目标 SVG（须已在 DOM 中）
   * @param {Object} data     {spine:'结果', bones:[{text, causes:[...]}]}
   * @param {Object} [opts]   {scope, tokens, boneAngle, ribGap, ribStart, boneGapX}
   * @returns {Promise<{nodes:Array, bounds:Object, viewBox:string, projection:Object,
   *                    boneCount:number, balance:string}>}
   */
  async function render(svg, data, opts) {
    opts = opts || {};
    await L.ready();                                  // 字体没就绪就测量 = 全盘偏错

    const T = opts.tokens || DIAGRAM.fromDeck(opts.scope);
    const spineText = (data && (data.spine || data.result || data.title)) || '';
    const bones = normalizeBones(data && (data.bones || data.categories || data.causes));

    const info = layoutFishbone(spineText, bones, opts);

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const gLines = DIAGRAM.el(svg, 'g', { 'data-layer': 'links', fill: 'none' });
    const gNodes = DIAGRAM.el(svg, 'g', { 'data-layer': 'nodes' });

    /* 5.1 主干（带箭头指向鱼头） */
    const defs = DIAGRAM.el(svg, 'defs', {});
    const mid = 'fb-arrow-' + Math.abs(
      (spineText.length * 7919) ^ (info.bones.length * 104729));   // 确定性 id，禁 Math.random
    const marker = DIAGRAM.el(defs, 'marker', {
      id: mid, viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
      markerUnits: 'userSpaceOnUse',
    });
    DIAGRAM.el(marker, 'path', { d: 'M0 0 L10 5 L0 10 z', fill: T.link });

    DIAGRAM.el(gLines, 'path', {
      d: `M${r2(info.spine.x1)} 0 L${r2(info.spine.x2)} 0`,
      fill: 'none', stroke: T.link,
      'stroke-width': GEOM.linkW * 1.6, 'stroke-linecap': 'round',
      'marker-end': `url(#${mid})`,
    });

    /* 5.2 斜刺 + 小刺短线 */
    info.bones.forEach(b => {
      DIAGRAM.el(gLines, 'path', {
        d: `M${r2(b.rootX)} 0 L${r2(b.tipX)} ${r2(b.tipY)}`,
        fill: 'none', stroke: T.link,
        'stroke-width': GEOM.linkW * 1.2, 'stroke-linecap': 'round',
      });
      b.ribs.forEach(rb => {
        DIAGRAM.el(gLines, 'path', {
          d: `M${r2(rb.ax)} ${r2(rb.ay)} L${r2(rb.bx)} ${r2(rb.by)}`,
          fill: 'none', stroke: T.linkFaint,
          'stroke-width': GEOM.linkW, 'stroke-linecap': 'round',
        });
      });
    });

    /* 5.3 大类标签胶囊 */
    const st1 = nodeStyleAA(T, 1);
    info.bones.forEach(b => {
      const g = DIAGRAM.el(gNodes, 'g', {});
      DIAGRAM.el(g, 'rect', {
        x: r2(b.x), y: r2(b.y), width: r2(b.w), height: r2(b.h),
        rx: st1.radius, ry: st1.radius,
        fill: st1.fill, stroke: st1.stroke, 'stroke-width': GEOM.strokeW,
      });
      b._fill = st1.fill; b._ink = st1.ink;
      drawBoxText(g, b, st1.ink, 'middle');
      DIAGRAM.tip(g, b.text);
    });

    /* 5.4 小刺：裸文字右对齐（贴着短线左端往左铺）*/
    info.bones.forEach(b => {
      b.ribs.forEach(rb => {
        const g = DIAGRAM.el(gNodes, 'g', {});
        rb._fill = T.bg; rb._ink = T.ink;
        drawBoxText(g, rb, T.ink, 'end');
        DIAGRAM.tip(g, rb.text);
      });
    });

    /* 5.5 鱼头（结果框）*/
    const st0 = nodeStyleAA(T, 0);
    {
      const h = info.head;
      const g = DIAGRAM.el(gNodes, 'g', {});
      DIAGRAM.el(g, 'rect', {
        x: r2(h.x), y: r2(h.y), width: r2(h.w), height: r2(h.h),
        rx: Math.round(GEOM.nodeRadius * 1.4), ry: Math.round(GEOM.nodeRadius * 1.4),
        fill: st0.fill, stroke: st0.stroke, 'stroke-width': GEOM.strokeW,
      });
      h._fill = st0.fill; h._ink = st0.ink;
      drawBoxText(g, h, st0.ink, 'middle');
      DIAGRAM.tip(g, h.text);
    }

    /* viewBox：节点盒 + 主干两端都要框进去 */
    const boxes = info.nodes.concat([
      { x: info.spine.x1, y: -2, w: info.spine.x2 - info.spine.x1, h: 4 },
    ]);
    const vb = L.fitViewBox(svg, boxes);
    const projection = DIAGRAM.enforceProjection(svg);

    return {
      nodes: info.nodes,
      bounds: L.boundsOf(boxes),
      viewBox: vb.viewBox,
      projection,
      boneCount: info.bones.length,
      balance: info.balance,
      upDown: info.up + ' 上 / ' + info.down + ' 下',
    };
  }

  /* ── 6 · 版式自述（供目录 / 自动选型使用） ─────────────────── */

  /**
   * 版式元信息。
   * @returns {{name:string, zhName:string, dataShape:string, whenToUse:string}}
   */
  function describe() {
    return {
      name: 'fishbone',
      zhName: '鱼骨图',
      dataShape: "{spine: '结果/问题', bones: [{text, causes: ['具体原因', ...]}]}",
      whenToUse: '因果分析：多个大类原因共同导致一个结果。质量归因、事故复盘、'
        + '问题拆解（人机料法环）。常见 4–6 根大刺、每根 2–5 条小刺；'
        + '只有一层原因时用 grouped 更清爽。',
    };
  }

  global.DIAGRAM_LAYOUTS = global.DIAGRAM_LAYOUTS || {};
  global.DIAGRAM_LAYOUTS.fishbone = {
    render, describe,
    layout: layoutFishbone,
    // 导出内部件供单测 / 其他版式复用
    normalizeBones, splitSides, drawBoxText, nodeStyleAA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
