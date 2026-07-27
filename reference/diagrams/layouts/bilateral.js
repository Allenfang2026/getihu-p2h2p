/* ═══════════════════════════════════════════════════════════════
   BILATERAL — 左右分栏树

   根节点居中，子节点分左右两侧展开。比放射图规整，比单向树紧凑，是
   "一个主题两三层展开、要塞进 16:9 一页"最稳的版式。

   ── 为什么不是一次布局能出的 ───────────────────────────────
   整齐树算法（non-layered tidy tree）的输出永远是单方向的：所有子节点
   都在父节点的同一侧。左右分栏本质上是两棵树共用一个根，必须跑两次。

   流程：
     1. 把根的子节点分成左右两组（按叶子数贪心平衡，不是简单对半）
     2. 各自造一棵临时树（根 + 该侧子节点），跑 layoutTidyTree
        右侧 direction = 'LR'，左侧 direction = 'RL'
     3. 两侧各自把根对齐到原点，左侧整体 x 取负，与右侧拼接
     4. 重算整体包围盒，根节点垂直居中于两侧的公共中线

   ── 为什么分组按叶子数而不是子树数 ─────────────────────────
   一级分支下面挂 6 个子节点和挂 1 个子节点，垂直方向占的高度差 6 倍。
   按分支个数对半分（3 : 3）可能得到 12 : 3 的叶子数，一边拖得老长、
   一边空着。贪心按叶子数分配（每次把下一个分支给当前较轻的一侧）能把
   高度差压到一个分支以内，这是最省事又够用的做法。

   ── 依赖 ─────────────────────────────────────────────────
     deck-tokens.js → diagram-tokens.js
     → vendor/non-layered-tidy-tree-layout.js → layout-core.js → 本文件
   挂载：window.DIAGRAM_LAYOUTS.bilateral
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DIAGRAM = global.DIAGRAM;
  const L = global.DIAGRAM_LAYOUT;
  if (!DIAGRAM) throw new Error('[bilateral] 需要先加载 diagram-tokens.js');
  if (!L) throw new Error('[bilateral] 需要先加载 layout-core.js');

  const GEOM = DIAGRAM.GEOM;
  const r2 = v => Math.round(v * 100) / 100;

  /* ── 1 · 叶子数统计与左右分组 ────────────────────────────────
     叶子数 = 该子树在垂直方向上真正占位的行数。中间节点自己不额外占行
     （它垂直居中于自己的子节点之间），所以只数叶子。                */

  /** 数一棵子树的叶子数（自身是叶子则记 1）@param {Object} n @returns {number} */
  function leafCount(n) {
    if (!n.children || !n.children.length) return 1;
    let s = 0;
    n.children.forEach(c => { s += leafCount(c); });
    return s;
  }

  /**
   * 把根的子节点贪心分成左右两组，尽量平衡叶子总数。
   * 保序：右侧拿到的分支保持原顺序，左侧同理——不打乱作者写的顺序，
   * 否则读图的人对不上原文。
   * @param {Array} kids 根的直接子节点
   * @returns {{left:Array, right:Array, leftLeaves:number, rightLeaves:number}}
   */
  function splitSides(kids) {
    const right = [], left = [];
    let rw = 0, lw = 0;
    kids.forEach(k => {
      const c = leafCount(k);
      // 先喂较轻的一侧；持平时优先右侧（读图习惯从右上起手）
      if (rw <= lw) { right.push(k); rw += c; }
      else { left.push(k); lw += c; }
    });
    return { left, right, leftLeaves: lw, rightLeaves: rw };
  }

  /* ── 2 · 单侧布局 ────────────────────────────────────────────
     造一棵临时树：根节点复用真根的尺寸（这样两侧算出来的根位置一致），
     子节点直接挂真节点。layoutTidyTree 是原地写 x/y 的，跑两次会互相
     覆盖——但两侧的子树集合不相交，只有根节点被写两次，所以跑完立刻把
     该侧节点的坐标抄走存到 _sx/_sy，再跑另一侧。                    */

  /**
   * 给一侧跑整齐树布局，返回该侧节点相对「根中心」的坐标。
   * @param {Object} realRoot 真根（提供 w/h）
   * @param {Array}  kids     该侧的子节点
   * @param {'LR'|'RL'} dir
   * @param {Object} gaps     {levelGap, siblingGap, subtreeGap}
   * @returns {{nodes:Array, rootCx:number, rootCy:number}}
   */
  function layoutSide(realRoot, kids, dir, gaps) {
    if (!kids.length) return { nodes: [], rootCx: 0, rootCy: 0 };

    // 临时根：只借 w/h，children 换成该侧的
    const stub = {
      text: realRoot.text, depth: 0, parent: null,
      w: realRoot.w, h: realRoot.h,
      lines: realRoot.lines, lineHeight: realRoot.lineHeight,
      fontSize: realRoot.fontSize, fontWeight: realRoot.fontWeight,
      children: kids, _index: -1, x: 0, y: 0, data: realRoot.data,
    };

    L.layoutTidyTree(stub, {
      direction: dir,
      levelGap: gaps.levelGap,
      siblingGap: gaps.siblingGap,
      subtreeGap: gaps.subtreeGap,
    });

    // 抄走这一侧所有节点的坐标（相对该侧根中心）
    const rootCx = stub.x + stub.w / 2;
    const rootCy = stub.y + stub.h / 2;
    const out = [];
    (function rec(n) {
      if (n !== stub) {
        n._sx = n.x - rootCx;                         // 相对根中心
        n._sy = n.y - rootCy;
        out.push(n);
      }
      n.children.forEach(rec);
    })(stub);

    return { nodes: out, rootCx, rootCy };
  }

  /* ── 3 · 布局主流程 ────────────────────────────────────────── */

  /**
   * 左右分栏布局。原地写入每个节点的 x/y/cx/cy/_side。
   * @param {Object} root L.buildTree 的返回值
   * @param {Object} [opts] {levelGap, siblingGap, subtreeGap}
   * @returns {{root:Object, left:Array, right:Array, balance:string}}
   */
  function layoutBilateral(root, opts) {
    opts = opts || {};
    const gaps = {
      levelGap: opts.levelGap == null ? GEOM.levelGap : opts.levelGap,
      siblingGap: opts.siblingGap == null ? GEOM.siblingGap : opts.siblingGap,
      subtreeGap: opts.subtreeGap == null ? GEOM.subtreeGap : opts.subtreeGap,
    };

    const kids = root.children || [];
    const split = splitSides(kids);

    /* 3.1 右侧先跑（LR），坐标抄进 _sx/_sy */
    const R = layoutSide(root, split.right, 'LR', gaps);
    /* 3.2 左侧再跑（RL）。RL 出来的 x 已经是「越深越靠左」的方向，
           但整棵树仍在正 x 半区、根在最右。抄完把 x 相对根取负即可。 */
    const Lft = layoutSide(root, split.left, 'RL', gaps);

    /* 3.3 拼接：右侧 x 直接用（根在左、子树往右），左侧 x 取镜像。
           左侧跑 RL 后根在最右端，其子节点的 _sx 已经是负值，方向天然
           就对，不需要再翻——直接用即可。这里显式标记 _side 供渲染用。 */
    split.right.forEach(k => mark(k, 'right'));
    split.left.forEach(k => mark(k, 'left'));

    function mark(n, side) {
      n._side = side;
      n.children.forEach(c => mark(c, side));
    }

    /* 3.4 落到最终坐标系：根中心放 (0,0)，两侧节点用相对坐标还原。
           垂直方向再各自居中——两侧叶子数不同时，各自的重心不在一条线
           上，不居中会看着一边高一边低。                            */
    const all = [];
    function place(list) {
      list.forEach(n => {
        n.x = n._sx;
        n.y = n._sy;
        all.push(n);
      });
    }

    // 各侧先算自己的垂直包围盒，把中心对到 0
    function recenterY(list) {
      if (!list.length) return;
      let y1 = Infinity, y2 = -Infinity;
      list.forEach(n => { y1 = Math.min(y1, n._sy); y2 = Math.max(y2, n._sy + n.h); });
      const dy = -(y1 + y2) / 2;
      list.forEach(n => { n._sy += dy; });
    }
    recenterY(R.nodes);
    recenterY(Lft.nodes);

    place(R.nodes);
    place(Lft.nodes);

    // 根节点：中心在 (0,0)
    root.x = -root.w / 2;
    root.y = -root.h / 2;
    root._side = 'root';
    all.push(root);

    all.forEach(n => { n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2; });

    return {
      root,
      left: Lft.nodes, right: R.nodes,
      balance: split.leftLeaves + ' : ' + split.rightLeaves,
    };
  }

  /* ── 4 · 水平贝塞尔连线 ──────────────────────────────────────
     控制点纯水平拉出（副轴不动），出来是标准的树状 S 形。左右两侧方向
     相反，靠父子的 cx 大小关系自动判，不需要传 side。

     起终点贴节点边缘（不是中心），线才不会从节点里穿出来。          */

  /**
   * 父→子的水平平滑连线。
   * @param {Object} p 父节点
   * @param {Object} c 子节点
   * @param {number} [curve=GEOM.curve]
   * @returns {string} path d
   */
  function hLink(p, c, curve) {
    const k = curve == null ? GEOM.curve : curve;
    const toRight = c.cx >= p.cx;

    const x1 = toRight ? p.x + p.w : p.x;
    const y1 = p.cy;
    const x2 = toRight ? c.x : c.x + c.w;
    const y2 = c.cy;

    const dx = (x2 - x1) * k;
    return `M${r2(x1)} ${r2(y1)} C${r2(x1 + dx)} ${r2(y1)} ${r2(x2 - dx)} ${r2(y2)} ${r2(x2)} ${r2(y2)}`;
  }

  /* ── 5 · 渲染 ────────────────────────────────────────────────
     左右两侧文字对齐方向相反：左侧右对齐（文字贴近中心那一边）、右侧
     左对齐。根节点居中。理由和放射图一样——让视线始终从中心往外读。 */

  /**
   * 渲染左右分栏树。
   * @param {SVGElement} svg  目标 SVG（须已在 DOM 中）
   * @param {Object} data     {title?, root:{...}} 或直接给 root
   * @param {Object} [opts]   {scope, maxWidth, levelGap, siblingGap, subtreeGap, tokens}
   * @returns {Promise<{nodes:Array, bounds:Object, viewBox:string, projection:Object,
   *                    balance:string}>}
   */
  async function render(svg, data, opts) {
    opts = opts || {};
    await L.ready();                                  // 必须等字体，否则测量全错

    const T = opts.tokens || DIAGRAM.fromDeck(opts.scope);
    const rootData = data && data.root ? data.root : data;
    const maxW = opts.maxWidth == null ? GEOM.maxW : opts.maxWidth;

    const root = L.buildTree(rootData, {
      styleFor(depth, raw) {
        const f = DIAGRAM.TYPO.byDepth(depth);
        return {
          fontSize: f.size,
          fontWeight: (raw && raw.emphasis) ? Math.min(900, f.weight + 100) : f.weight,
          maxWidth: depth === 0 ? maxW : Math.min(maxW, 220),
        };
      },
    });

    /* note 先量进节点高度，布局才知道要留位置 */
    const noteSize = Math.max(DIAGRAM.TYPO.l3.size - 1, 11);
    L.flatten(root).forEach(n => {
      const note = n.data && n.data.note;
      if (!note) return;
      const wrapped = L.wrapText(note, noteSize, 400, Math.min(maxW, 220));
      n._noteLines = wrapped.lines;
      n._noteLH = wrapped.lineHeight;
      n._noteSize = noteSize;
      n.h += wrapped.height + 4;
      n.w = Math.max(n.w, Math.ceil(wrapped.width + GEOM.padX * 2));
    });

    const info = layoutBilateral(root, {
      levelGap: opts.levelGap,
      siblingGap: opts.siblingGap,
      subtreeGap: opts.subtreeGap,
    });
    const nodes = L.flatten(root);

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const gLinks = DIAGRAM.el(svg, 'g', { 'data-layer': 'links', fill: 'none' });
    const gNodes = DIAGRAM.el(svg, 'g', { 'data-layer': 'nodes' });

    nodes.forEach(p => {
      p.children.forEach(c => {
        DIAGRAM.el(gLinks, 'path', {
          d: hLink(p, c, opts.curve),
          fill: 'none',
          stroke: c.depth <= 1 ? T.link : T.linkFaint,
          'stroke-width': GEOM.linkW,
          'stroke-linecap': 'round',
        });
      });
    });

    nodes.forEach(n => {
      const emph = !!(n.data && n.data.emphasis);
      const st = nodeStyleAA(T, emph ? 0 : n.depth);
      const g = DIAGRAM.el(gNodes, 'g', {});
      DIAGRAM.el(g, 'rect', {
        x: r2(n.x), y: r2(n.y), width: r2(n.w), height: r2(n.h),
        rx: n.depth === 0 ? Math.round(GEOM.nodeRadius * 1.4) : st.radius,
        ry: n.depth === 0 ? Math.round(GEOM.nodeRadius * 1.4) : st.radius,
        fill: st.fill, stroke: st.stroke, 'stroke-width': GEOM.strokeW,
      });
      // 左侧右对齐 / 右侧左对齐 / 根居中
      const anchor = n._side === 'root' ? 'middle'
        : (n._side === 'left' ? 'end' : 'start');
      drawText(g, n, anchor, st.ink, emph ? 100 : 0);
      DIAGRAM.tip(g, n.text);
    });

    const vb = L.fitViewBox(svg, nodes);
    const projection = DIAGRAM.enforceProjection(svg);

    return {
      nodes,
      bounds: L.boundsOf(nodes),
      viewBox: vb.viewBox,
      projection,
      balance: info.balance,
    };
  }

  /* 层级配色：与 radial 同一实现（含 AA 死区兜底），复用它保证同一份数据
     换版式时颜色不变。radial.js 未加载时退回不带兜底的原始色。       */
  function nodeStyleAA(T, depth) {
    const R = global.DIAGRAM_LAYOUTS && global.DIAGRAM_LAYOUTS.radial;
    if (R && R.nodeStyleAA) return R.nodeStyleAA(T, depth);
    return T.nodeStyle(depth);
  }

  /* 文字绘制：与 radial 同一实现（含 note 小字），复用它避免两处走样。
     radial.js 未加载时退回本地副本。                                */
  function drawText(g, n, anchor, fill, weightBoost) {
    const R = global.DIAGRAM_LAYOUTS && global.DIAGRAM_LAYOUTS.radial;
    if (R && R.drawText) return R.drawText(g, n, anchor, fill, weightBoost);

    const lines = n.lines && n.lines.length ? n.lines : [n.text || ''];
    const lh = n.lineHeight || Math.round((n.fontSize || 14) * 1.4);
    const noteH = n._noteLines ? n._noteLines.length * n._noteLH : 0;
    const tx = anchor === 'start' ? n.x + GEOM.padX
      : anchor === 'end' ? n.x + n.w - GEOM.padX : n.cx;
    const bodyH = lines.length * lh;
    const firstY = n.y + (n.h - bodyH - noteH) / 2 + lh / 2;

    const t = DIAGRAM.el(g, 'text', {
      x: tx, y: firstY, 'text-anchor': anchor,
      'font-size': n.fontSize || 14,
      'font-weight': (n.fontWeight == null ? 400 : n.fontWeight) + (weightBoost || 0),
      'font-family': 'inherit', fill: fill, 'dominant-baseline': 'middle',
    });
    lines.forEach((line, i) => {
      const ts = DIAGRAM.el(t, 'tspan', { x: tx, dy: i === 0 ? 0 : lh });
      ts.textContent = line;
    });
    if (n._noteLines && n._noteLines.length) {
      const nt = DIAGRAM.el(g, 'text', {
        x: tx, y: firstY + bodyH - lh / 2 + n._noteLH / 2 + 2,
        'text-anchor': anchor, 'font-size': n._noteSize, 'font-weight': 400,
        'font-family': 'inherit', fill: fill, opacity: 0.72,
        'dominant-baseline': 'middle',
      });
      n._noteLines.forEach((line, i) => {
        const ts = DIAGRAM.el(nt, 'tspan', { x: tx, dy: i === 0 ? 0 : n._noteLH });
        ts.textContent = line;
      });
    }
  }

  /* ── 版式自述（供目录 / 自动选型使用） ─────────────────────── */

  /**
   * 版式元信息。
   * @returns {{name:string, zhName:string, dataShape:string, whenToUse:string}}
   */
  function describe() {
    return {
      name: 'bilateral',
      zhName: '左右分栏树',
      dataShape: '{title?, root: {text, note?, emphasis?, children: [...]}}（嵌套树，与 radial 同一格式）',
      whenToUse: '层级展开：根居中、分支左右两侧铺开，比放射图规整、比单向树紧凑，'
        + '是"一个主题两三层展开要塞进 16:9 一页"最稳的版式。体系结构、组织架构、'
        + '内容目录。分支少（一级 ≤4）想要发散张力用 radial；只有两层且每支下就是'
        + '几条要点，用 grouped 更整齐。',
    };
  }

  global.DIAGRAM_LAYOUTS = global.DIAGRAM_LAYOUTS || {};
  global.DIAGRAM_LAYOUTS.bilateral = {
    render, describe,
    layout: layoutBilateral,
    leafCount, splitSides, hLink,
  };
})(typeof window !== 'undefined' ? window : globalThis);
