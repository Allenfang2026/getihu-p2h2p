/* ═══════════════════════════════════════════════════════════════
   RADIAL — 放射思维导图

   根节点在画布中心，分支向四周辐射。适合"一个主题发散出若干并列方向"
   的场面：品牌关键词、能力地图、议题拆解。不适合有明确先后 / 上下级
   落差的内容（那走 bilateral 或组织架构）。

   ── 算法本体 = vendor/d3-hierarchy.min.js 的 d3.tree ──────────
   极坐标树：把 tree 的 size 设成 [2π, R]，布局出来的
     node.x = 角度（弧度）
     node.y = 半径
   separation 用 d3 官方推荐的径向写法：
     (a, b) => (a.parent == b.parent ? 1 : 2) / a.depth
   除以 depth 是关键——同样的角度间隔在外圈对应的弧长更大，不衰减的话
   外圈会被撑得极散、内圈挤成一团。

   ── d3.tree 的等尺寸假设怎么绕 ─────────────────────────────
   d3.tree 假定所有节点等尺寸（Reingold-Tilford 的原始前提），而我们的
   中文节点从 2 字到 25 字都有。两处修正：

     1. 半径步长按「该层实测最大节点宽」定，不是均分 R。d3 给的 y 是
        depth × (R / maxDepth) 的均匀阶，直接丢掉重算。
     2. 角度按节点在自己所处半径上占的弧宽做二次修正：一个节点在半径
        r 上占的角宽 ≈ (w + gap) / r。把每层节点按角度排序后逐个检查
        相邻两个的角度差够不够，不够就整体把这一层往外推（增大半径步
        长）重排，最多迭代 5 次。

   迭代而不是一次算死，是因为推大半径本身会让所需角宽变小，是个收敛
   过程；解析解要解不等式组，收益不抵复杂度。

   ── 依赖 ─────────────────────────────────────────────────
     deck-tokens.js → diagram-tokens.js → vendor/d3-hierarchy.min.js
     → layout-core.js → 本文件
   挂载：window.DIAGRAM_LAYOUTS.radial
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DIAGRAM = global.DIAGRAM;
  const L = global.DIAGRAM_LAYOUT;
  if (!DIAGRAM) throw new Error('[radial] 需要先加载 diagram-tokens.js');
  if (!L) throw new Error('[radial] 需要先加载 layout-core.js');

  const GEOM = DIAGRAM.GEOM;
  const TAU = Math.PI * 2;
  const r2 = v => Math.round(v * 100) / 100;

  /* ── 1 · 极坐标工具 ──────────────────────────────────────────
     角度口径：0 = 正右方（12 点方向减 90°），顺时针增长。d3.tree 给的
     x 是 0～2π，直接当角度用；转直角坐标时减 π/2，让第一个分支落在正
     上方而不是正右方——正上方起手是思维导图的惯例，读图从顶端开始。 */

  const polar = (angle, radius) => [
    Math.cos(angle - Math.PI / 2) * radius,
    Math.sin(angle - Math.PI / 2) * radius,
  ];

  // 角度归一到 [0, 2π)
  const norm = a => ((a % TAU) + TAU) % TAU;

  /* 判断角度落在右半边还是左半边（减了 π/2 之后的实际朝向）。
     右半边 = cos(angle - π/2) >= 0，即 sin(angle) >= 0，即 0 ≤ a ≤ π。 */
  const isRightSide = a => Math.sin(norm(a)) >= -1e-9;

  /* ── 1.5 · AA 兜底：把落在"死区"的填充色推出去 ───────────────
     pickInk() 已经在两个候选字色里挑对比度最高的那个，但有一段填充明度
     是「黑字白字都不够」的死区：实测暖色 deck 第 1 层 #b36241 配深字
     3.72、配浅字 4.12，两个都够不着 AA 的 4.5。这不是选色逻辑的问题，
     是那个填充色本身没法承载正文。

     解法是动填充不是动字：沿明度方向小步推（每步 1%），推到任一候选字
     色达标为止，上下两个方向同时试、谁先达标用谁。实测推 3～5% 就够，
     肉眼看仍是同一档色阶，层级关系不破。

     只在真的不达标时才动，达标的填充原样返回 —— 绝不无差别改色。    */

  const AA = 4.5;
  const MAX_NUDGE = 60;             // 最多推 60 步（60% 明度），够不到就认输

  /**
   * 若填充色配任何字色都达不到 AA，沿明度方向把它推出死区。
   * @param {string} fill      原填充色
   * @param {string} darkInk   深色候选字
   * @param {string} lightInk  浅色候选字
   * @param {number} [target=4.5]
   * @returns {string} 达标的填充色（原本就达标则原样返回）
   */
  function ensureAAFill(fill, darkInk, lightInk, target) {
    target = target == null ? AA : target;
    const best = f => Math.max(
      DIAGRAM.contrastRatio(f, darkInk),
      DIAGRAM.contrastRatio(f, lightInk)
    );
    if (best(fill) >= target) return fill;

    const DECK = global.DECK;
    const hsl = DECK.hexToHsl(fill);
    if (!hsl) return fill;

    let up = fill, down = fill;
    for (let i = 1; i <= MAX_NUDGE; i++) {
      const dl = i * 0.01;
      up = DECK.hslToHex(hsl.h, hsl.s, Math.min(1, hsl.l + dl));
      if (best(up) >= target) return up;
      down = DECK.hslToHex(hsl.h, hsl.s, Math.max(0, hsl.l - dl));
      if (best(down) >= target) return down;
    }
    return best(up) > best(down) ? up : down;      // 都不达标就交对比度高的
  }

  /**
   * 取某层的节点样式，并保证填充 + 字色达 AA。
   * 两个版式共用，保证同一份数据在两种版式下配色一致。
   * @param {Object} T      DIAGRAM.fromDeck() 的返回
   * @param {number} depth
   * @returns {{fill:string, stroke:string, ink:string, radius:number, font:Object}}
   */
  function nodeStyleAA(T, depth) {
    const st = T.nodeStyle(depth);
    const fill = ensureAAFill(st.fill, T.inkOnLight, T.inkOnDark);
    if (fill === st.fill) return st;
    return {
      fill,
      stroke: st.stroke,
      ink: DIAGRAM.pickInk(fill, T.inkOnLight, T.inkOnDark),
      radius: st.radius,
      font: st.font,
    };
  }

  /* ── 2 · 半径规划 ────────────────────────────────────────────
     每层的半径 = 上一层半径 + 上一层最大节点宽 + levelGap。
     用「宽」而不是对角线：节点长边水平摆放，径向方向上占的就是宽度。
     根节点单独算：它的半径永远是 0，第一圈从 rootW/2 + levelGap 起步。 */

  /**
   * 按每层实测尺寸规划半径阶。
   *
   * 径向间距用的是「该层的代表宽度」而不是最大宽度：一层里只要有一个
   * 25 字的长节点，用最大值会把整圈都推到那个长度上，图会散得像烟花、
   * 中间空一大片。取 75 分位数（并且不低于中位数的 1.15 倍）——长节点
   * 自己的多出来那截靠角度修正让开，不拖累整圈。
   *
   * 另外径向上真正要避让的是节点的「径向投影」：右半边和左半边的节点
   * 水平摆放，径向占的确实是宽；但正上/正下方的节点径向占的是高。用
   * 宽度当上界是安全侧，只是偏保守，所以再乘 0.8 收一收。
   *
   * @param {Array<Array>} byDepth  按深度分组的节点数组
   * @param {number} levelGap       层间距（边到边）
   * @param {number} [scale=1]      整体半径放大系数（迭代扩张用）
   * @returns {number[]} 下标 = 深度，值 = 该层节点中心所在半径
   */
  function planRadii(byDepth, levelGap, scale) {
    scale = scale == null ? 1 : scale;

    // 一层的径向代表半宽：75 分位，再和中位数×1.15 取大，最后收 0.8
    function reprHalf(layer) {
      if (!layer || !layer.length) return 0;
      const ws = layer.map(n => n.w).sort((a, b) => a - b);
      const q = p => ws[Math.min(ws.length - 1, Math.floor((ws.length - 1) * p))];
      const v = Math.max(q(0.75), q(0.5) * 1.15);
      return (v / 2) * 0.8;
    }

    const radii = [0];
    for (let d = 1; d < byDepth.length; d++) {
      const prevHalf = d === 1
        ? ((byDepth[0] && byDepth[0][0] ? byDepth[0][0].w : 0) / 2)   // 根用自己的实宽
        : reprHalf(byDepth[d - 1]);
      const curHalf = reprHalf(byDepth[d]);
      radii[d] = radii[d - 1] + (prevHalf + curHalf + levelGap) * scale;
    }
    return radii;
  }

  /* ── 3 · 角度二次修正 ────────────────────────────────────────
     d3 按「叶子数」分角度，不知道节点多宽。同一层里 25 字的节点和 2 字
     的节点拿到一样的角度配额，长的那个必然压到邻居身上。

     修正思路：把每层节点按角度排序，算每个节点在自己半径上真实需要的
     角半宽 halfAngle = (w/2 + siblingGap/2) / r，然后从第一个开始往后
     推——后一个的角度至少要等于「前一个角度 + 前者角半宽 + 后者角半宽」。
     推完如果总跨度超过 2π（转了一整圈还没排完），说明这一层半径不够，
     返回 false 让外层放大半径重来。

     注意只在层内推、不动跨层关系：父子的角度一致性靠 d3 保证，这里推
     动子节点会让连线歪，所以推的幅度封顶（不超过原角度 ± 该层平均间隔
     的一半），推不动就直接判失败去扩半径。                          */

  /**
   * 尝试在给定半径下把一层节点的角度推开到不重叠。
   * @param {Array} layer     该层节点（带 _angle）
   * @param {number} radius   该层半径
   * @param {number} gap      相邻节点最小弧长间隙 px
   * @returns {boolean} true = 排得开（角度已就地更新）；false = 半径不够
   */
  function relaxLayer(layer, radius, gap) {
    if (layer.length <= 1 || radius <= 0) return true;

    // 每个节点在本层半径上需要的角半宽
    const need = layer.map(n => (n.w / 2 + gap / 2) / radius);
    const total = need.reduce((s, v) => s + v * 2, 0);
    if (total > TAU) return false;                 // 一整圈都塞不下，直接判失败

    const sorted = layer.slice().sort((a, b) => a._angle - b._angle);
    const half = sorted.map(n => (n.w / 2 + gap / 2) / radius);

    /* 单向推：从当前第一个节点起，沿角度方向逐个往后顶。

       ── 为什么不做"环形摊平"（试过，更差，别再改回去）──────────
       单向推有个明显的保守之处：一圈是闭环，推到最后一个时可能和起点撞
       上，而起点前面其实还空着一片，于是判失败去扩半径。看上去把富余量
       在整圈上按比例摊平更"聪明"——实测也确实把半径从 335/623/893 压到
       248/462/662、viewBox 从 1564 缩到 1232，图紧凑不少。

       但紧凑是有代价的：节点挨得越近，连线可穿行的通道越窄，穿透数从 0
       涨到 3（「退出路径…」「成功度打分」「评委会现场质询…」各中一条）。
       零穿透是硬验收项，图略散不是——所以这里保留保守的单向推，让排不开
       时老老实实扩半径。这是有意的取舍，不是没想到。                */

    let cursor = sorted[0]._angle;
    for (let i = 1; i < sorted.length; i++) {
      const minA = cursor + half[i - 1] + half[i];
      if (sorted[i]._angle < minA) sorted[i]._angle = minA;
      cursor = sorted[i]._angle;
    }
    // 首尾闭合检查：最后一个和第一个绕回来也不能撞
    const wrap = sorted[0]._angle + TAU - cursor;
    if (wrap < half[sorted.length - 1] + half[0]) return false;
    return true;
  }

  /* ── 4 · 布局主流程 ──────────────────────────────────────────
     1) buildTree 拿到带实测尺寸的树
     2) d3.tree 在 [0, 2π] × [0, 1] 上排一遍，只取角度
     3) 按实测尺寸规划半径
     4) 逐层做角度修正；任一层排不开就整体扩半径重来（最多 5 轮）
     5) 极坐标 → 直角坐标，写回 n.x/n.y（盒子左上角）                */

  const MAX_ITER = 5;

  /**
   * 放射布局。原地写入每个节点的 x/y/cx/cy/_angle/_radius。
   * @param {Object} root  L.buildTree 的返回值
   * @param {Object} [opts] {levelGap, siblingGap}
   * @returns {{root:Object, iterations:number, radii:number[]}}
   */
  function layoutRadial(root, opts) {
    opts = opts || {};
    const levelGap = opts.levelGap == null ? GEOM.levelGap : opts.levelGap;
    const sibGap = opts.siblingGap == null ? GEOM.subtreeGap : opts.siblingGap;

    const d3 = global.d3;
    if (!d3 || !d3.tree || !d3.hierarchy) {
      throw new Error('[radial] 需要先加载 vendor/d3-hierarchy.min.js');
    }

    const all = L.flatten(root);
    const maxDepth = all.reduce((m, n) => Math.max(m, n.depth), 0);

    /* 4.1 先按深度分组，并预估各层半径 —— separation 需要知道半径才能
           把「节点多宽」换算成「占多少角度」。                        */
    const byDepth = [];
    all.forEach(n => {
      (byDepth[n.depth] = byDepth[n.depth] || []).push(n);
    });
    let radii = planRadii(byDepth, levelGap, 1);

    /* 4.2 d3 排角度。size 的第二维给 1（只要角度，半径自己算）。

       separation 不用纯拓扑的 (a.parent==b.parent?1:2)/depth：那个公式
       只看树结构，不知道节点多宽，25 字的节点和 2 字的节点拿到一样的角
       度配额，长的必然压到邻居身上，全靠事后 relaxLayer 补救；补救不了
       就只能整体扩半径，图越排越散（实测半径阶被顶到 335/623/893，中间
       空出一大片）。

       改成把节点实际宽度换算成角度一起计入：节点在半径 r 上占的角宽
       ≈ w / r。取相邻两个节点各自角半宽之和，与拓扑基准值取大——拓扑
       项保证兄弟/非兄弟的疏密层次，宽度项保证长节点自己挤开邻居。   */
    const h = d3.hierarchy(root, n => n.children);

    const angWidth = hn => {
      const r = radii[hn.depth] || 0;
      if (r <= 0) return 0;
      return (hn.data.w + sibGap) / r;
    };

    d3.tree()
      .size([TAU, 1])
      .separation((a, b) => {
        const topo = (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth);
        // d3 的 separation 返回值是「以整圈 2π 归一化前的相对配额」，
        // 角宽同样除以 2π 才能和拓扑项放在一个量纲上比较
        const geo = (angWidth(a) / 2 + angWidth(b) / 2) / TAU * (TAU / Math.max(1, a.depth));
        return Math.max(topo, geo);
      })(h);

    h.each(hn => { hn.data._angle = hn.x; hn.data._d3depth = hn.depth; });
    root._angle = 0;                                  // 根在中心，角度无意义

    /* 4.3 迭代：规划半径 → 逐层修正 → 排不开就扩半径重来。
           有了角宽补偿，正常数据第一轮就该过，扩半径只是兜底。      */
    let scale = 1, iterations = 0;
    const snapshot = all.map(n => n._angle);          // 每轮从原始角度重来

    for (let iter = 0; iter < MAX_ITER; iter++) {
      iterations = iter + 1;
      all.forEach((n, i) => { n._angle = snapshot[i]; });
      radii = planRadii(byDepth, levelGap, scale);

      let ok = true;
      for (let d = 1; d <= maxDepth; d++) {
        if (!relaxLayer(byDepth[d] || [], radii[d], sibGap)) { ok = false; break; }
      }
      if (ok) break;
      scale *= 1.35;                                  // 排不开就整体撑大重排
    }

    /* 4.4 极坐标 → 直角坐标。写的是盒子左上角，跟 layoutTidyTree 同口径 */
    all.forEach(n => {
      const r = radii[n.depth] || 0;
      const [px, py] = n.depth === 0 ? [0, 0] : polar(n._angle, r);
      n._radius = r;
      n.cx = px;
      n.cy = py;
      n.x = px - n.w / 2;
      n.y = py - n.h / 2;
      n._right = n.depth === 0 ? true : isRightSide(n._angle);
    });

    return { root, iterations, radii };
  }

  /* ── 5 · 径向连线 ────────────────────────────────────────────
     不用折线，用三次贝塞尔：起点在父节点边缘朝子节点的那一侧，终点在子
     节点边缘朝父节点的那一侧，两个控制点都放在「径向中间半径」上，各自
     保持自己的角度。这样出来的曲线沿着径向平滑外扩，形状接近
     d3.linkRadial（d3-shape 没打包进来，自己写这一条比再塞一个库划算）。

     起终点做边缘裁剪：从中心点沿连线方向退到矩形边界上，连线才不会从
     节点中心穿出来压住文字。                                       */

  /**
   * 把一个点沿方向 (dx,dy) 从矩形中心退到矩形边界。
   * @param {Object} n  {cx,cy,w,h}
   * @param {number} dx 方向向量 x
   * @param {number} dy 方向向量 y
   * @param {number} [inset=0] 再往里/往外让开的量
   * @returns {[number,number]}
   */
  function edgePoint(n, dx, dy, inset) {
    inset = inset || 0;
    const hw = n.w / 2 + inset, hh = n.h / 2 + inset;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-9 && ay < 1e-9) return [n.cx, n.cy];
    // 取横竖两个方向上先撞到边的那个
    const tx = ax < 1e-9 ? Infinity : hw / ax;
    const ty = ay < 1e-9 ? Infinity : hh / ay;
    const t = Math.min(tx, ty);
    return [n.cx + dx * t, n.cy + dy * t];
  }

  /**
   * 父→子的径向平滑连线。
   *
   * 控制点沿各自的角度放在起终点之间的半径上，不是简单放在中间半径。
   * 简单取中间半径时，父子角度差一大，曲线会沿着中间那道圆弧横扫出去
   * 一大截，正好从夹在中间的邻居节点身上碾过去（实测两张放射图各有 1
   * 条这样的线）。改成「起点控制点贴近起点半径、终点控制点贴近终点半
   * 径」（各让开 38%），曲线就被约束在起终点之间那条窄带里，横扫幅度
   * 大幅收窄，同时仍然是平滑曲线不是折线。
   *
   * @param {Object} p 父节点（带 cx/cy/w/h/_angle/_radius）
   * @param {Object} c 子节点
   * @returns {string} path d
   */
  const LINK_BOW = 0.38;          // 控制点从各自端点往对面推的比例

  function radialLink(p, c) {
    const [pcx, pcy] = [p.cx, p.cy];
    const [ccx, ccy] = [c.cx, c.cy];

    // 起点：父节点边缘，方向朝子节点
    const [sx, sy] = edgePoint(p, ccx - pcx, ccy - pcy, 0);
    // 终点：子节点边缘，方向朝父节点
    const [ex, ey] = edgePoint(c, pcx - ccx, pcy - ccy, 0);

    const r0 = p._radius, r1 = c._radius;
    const dr = r1 - r0;

    /* 第二个控制点永远沿子节点的角度放 —— 曲线末端顺着径向扎进子节点，
       这是径向树的形状特征。                                          */
    const [c2x, c2y] = polar(c._angle, r1 - dr * LINK_BOW);

    /* 第一个控制点：默认沿父节点的角度放（曲线从父节点径向出发）。

       但这个默认值有个必然的坏情况：控制点落在起点「后方」时，曲线会先
       往回兜一圈再出去，正好从父节点自己身上碾过去。两种情形都会触发——
       根节点（radius=0，压根没有自己的角度），以及父子角度差很大的普通
       父节点（角度修正把子节点推到父节点侧后方时就会这样）。
       实测中招的是「工程建设项目类评价」(169.6°) → 它的子节点：父节点角
       度指向左下，子节点却在右边，控制点直接落进父节点框里。

       判据不是「是不是根」，而是「控制点在不在起点前方」：拿控制点相对
       起点的向量和「起点→终点」向量点乘，为负就是往回兜。这种情况一律
       退回沿起点→终点方向推，连线就永远朝着子节点走，不回头。       */
    const vx = ex - sx, vy = ey - sy;
    let c1x, c1y;
    if (p.depth === 0) {
      c1x = sx + vx * LINK_BOW;
      c1y = sy + vy * LINK_BOW;
    } else {
      const pt = polar(p._angle, r0 + dr * LINK_BOW);
      c1x = pt[0]; c1y = pt[1];
      // 点乘 < 0 = 控制点在起点后方，曲线会往回兜 → 退回直线方向
      if ((c1x - sx) * vx + (c1y - sy) * vy < 0) {
        c1x = sx + vx * LINK_BOW;
        c1y = sy + vy * LINK_BOW;
      }
    }

    return `M${r2(sx)} ${r2(sy)} C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(ex)} ${r2(ey)}`;
  }

  /* ── 6 · 渲染 ────────────────────────────────────────────────
     文字对齐是放射图的经典处理：右半边左对齐、左半边右对齐。不这么做的
     话左侧节点的文字会朝远离中心的方向铺开，视线要从外往里读，很别扭。
     根节点永远居中。                                               */

  /**
   * 画一个节点的多行文字（tspan，绝不用 foreignObject）。
   * @param {SVGElement} g   挂载父元素
   * @param {Object} n       节点
   * @param {string} anchor  'start' | 'middle' | 'end'
   * @param {string} fill    字色
   * @param {number} [weightBoost=0] 字重加成（emphasis 用）
   */
  function drawText(g, n, anchor, fill, weightBoost) {
    const lines = n.lines && n.lines.length ? n.lines : [n.text || ''];
    const lh = n.lineHeight || Math.round((n.fontSize || 14) * 1.4);
    const noteH = n._noteLines ? n._noteLines.length * n._noteLH : 0;

    const tx = anchor === 'start' ? n.x + GEOM.padX
      : anchor === 'end' ? n.x + n.w - GEOM.padX
        : n.cx;

    // 正文整块垂直居中；有 note 时正文整体上移半个 note 高
    const bodyH = lines.length * lh;
    const firstY = n.y + (n.h - bodyH - noteH) / 2 + lh / 2;

    const t = DIAGRAM.el(g, 'text', {
      x: tx, y: firstY,
      'text-anchor': anchor,
      'font-size': n.fontSize || 14,
      'font-weight': (n.fontWeight == null ? 400 : n.fontWeight) + (weightBoost || 0),
      'font-family': 'inherit',
      fill: fill,
      'dominant-baseline': 'middle',
    });
    lines.forEach((line, i) => {
      const ts = DIAGRAM.el(t, 'tspan', { x: tx, dy: i === 0 ? 0 : lh });
      ts.textContent = line;
    });

    // note：正文下方的小字
    if (n._noteLines && n._noteLines.length) {
      const nt = DIAGRAM.el(g, 'text', {
        x: tx, y: firstY + bodyH - lh / 2 + n._noteLH / 2 + 2,
        'text-anchor': anchor,
        'font-size': n._noteSize,
        'font-weight': 400,
        'font-family': 'inherit',
        fill: fill,
        opacity: 0.72,
        'dominant-baseline': 'middle',
      });
      n._noteLines.forEach((line, i) => {
        const ts = DIAGRAM.el(nt, 'tspan', { x: tx, dy: i === 0 ? 0 : n._noteLH });
        ts.textContent = line;
      });
    }
  }

  /* ── 7 · 对外渲染入口 ────────────────────────────────────────
     签名与其余六种版式完全一致：
       async render(svg, data, opts) → {nodes, bounds, viewBox, ...}      */

  /**
   * 渲染放射思维导图。
   * @param {SVGElement} svg   目标 SVG（须已在 DOM 中）
   * @param {Object} data      {title?, root:{text, children:[...]}} 或直接给 root
   * @param {Object} [opts]    {scope, maxWidth, levelGap, siblingGap, tokens}
   * @returns {Promise<{nodes:Array, bounds:Object, viewBox:string, projection:Object,
   *                    iterations:number, radii:number[]}>}
   */
  async function render(svg, data, opts) {
    opts = opts || {};
    await L.ready();                                  // 字体没就绪就测量 = 全盘偏错

    const T = opts.tokens || DIAGRAM.fromDeck(opts.scope);
    const rootData = data && data.root ? data.root : data;
    const maxW = opts.maxWidth == null ? GEOM.maxW : opts.maxWidth;

    /* 7.1 建树。maxWidth 收窄一点：放射图节点四散分布，节点越窄越不容易
           在角度上互相压，比树状图更吃这个。                         */
    const root = L.buildTree(rootData, {
      styleFor(depth, raw) {
        const f = DIAGRAM.TYPO.byDepth(depth);
        return {
          fontSize: f.size,
          fontWeight: (raw && raw.emphasis) ? Math.min(900, f.weight + 100) : f.weight,
          maxWidth: depth === 0 ? maxW : Math.min(maxW, 200),
        };
      },
    });

    /* 7.2 note：作为节点高度的一部分先量好，布局才知道要留多少地方 */
    const noteSize = Math.max(DIAGRAM.TYPO.l3.size - 1, 11);
    L.flatten(root).forEach(n => {
      const note = n.data && n.data.note;
      if (!note) return;
      const wrapped = L.wrapText(note, noteSize, 400, Math.min(maxW, 200));
      n._noteLines = wrapped.lines;
      n._noteLH = wrapped.lineHeight;
      n._noteSize = noteSize;
      n.h += wrapped.height + 4;                      // 撑高节点盒
      n.w = Math.max(n.w, Math.ceil(wrapped.width + GEOM.padX * 2));
    });

    /* 7.3 布局 */
    const info = layoutRadial(root, {
      levelGap: opts.levelGap,
      siblingGap: opts.siblingGap,
    });
    const nodes = L.flatten(root);

    /* 7.4 绘制。连线先画，压在节点下面 */
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const gLinks = DIAGRAM.el(svg, 'g', { 'data-layer': 'links', fill: 'none' });
    const gNodes = DIAGRAM.el(svg, 'g', { 'data-layer': 'nodes' });

    nodes.forEach(p => {
      p.children.forEach(c => {
        DIAGRAM.el(gLinks, 'path', {
          d: radialLink(p, c),
          fill: 'none',
          stroke: c.depth <= 1 ? T.link : T.linkFaint,
          'stroke-width': GEOM.linkW,
          'stroke-linecap': 'round',
        });
      });
    });

    nodes.forEach(n => {
      const emph = !!(n.data && n.data.emphasis);
      // emphasis 用最深一档（第 0 层的色），其余按自身深度取
      const st = nodeStyleAA(T, emph ? 0 : n.depth);
      const g = DIAGRAM.el(gNodes, 'g', {});
      DIAGRAM.el(g, 'rect', {
        x: r2(n.x), y: r2(n.y), width: r2(n.w), height: r2(n.h),
        rx: n.depth === 0 ? Math.round(GEOM.nodeRadius * 1.4) : st.radius,
        ry: n.depth === 0 ? Math.round(GEOM.nodeRadius * 1.4) : st.radius,
        fill: st.fill, stroke: st.stroke, 'stroke-width': GEOM.strokeW,
      });
      // 右半边左对齐、左半边右对齐；根节点居中
      const anchor = n.depth === 0 ? 'middle' : (n._right ? 'start' : 'end');
      drawText(g, n, anchor, st.ink, emph ? 100 : 0);
      DIAGRAM.tip(g, n.text);
    });

    /* 7.5 viewBox + 投屏硬闸 */
    const vb = L.fitViewBox(svg, nodes);
    const projection = DIAGRAM.enforceProjection(svg);

    return {
      nodes,
      bounds: L.boundsOf(nodes),
      viewBox: vb.viewBox,
      projection,
      iterations: info.iterations,
      radii: info.radii,
    };
  }

  /* ── 版式自述（供目录 / 自动选型使用） ─────────────────────── */

  /**
   * 版式元信息。
   * @returns {{name:string, zhName:string, dataShape:string, whenToUse:string}}
   */
  function describe() {
    return {
      name: 'radial',
      zhName: '放射思维导图',
      dataShape: '{title?, root: {text, note?, emphasis?, children: [...]}}（嵌套树，也可直接给根节点）',
      whenToUse: '中心发散：一个主题向四周辐射出若干并列分支。品牌关键词、能力地图、'
        + '议题拆解。不适合有明确先后（用 flow）或上下级落差（用 bilateral）的内容；'
        + '一级分支多于 4 个、层深 3 层以上时 bilateral 更省地方。',
    };
  }

  global.DIAGRAM_LAYOUTS = global.DIAGRAM_LAYOUTS || {};
  global.DIAGRAM_LAYOUTS.radial = {
    render, describe,
    layout: layoutRadial,
    // 导出内部件供单测 / 其他版式复用
    polar, isRightSide, edgePoint, radialLink, planRadii, relaxLayer, drawText,
    ensureAAFill, nodeStyleAA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
