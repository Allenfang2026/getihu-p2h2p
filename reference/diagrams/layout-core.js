/* ═══════════════════════════════════════════════════════════════
   LAYOUT CORE — p2h2p 结构图布局基础设施

   所有版式（思维导图 / 组织架构 / 金字塔 / 鱼骨 / 流程 / 象限 / 时间轴）
   共用这一层。解决的核心问题是"节点尺寸不一"——中文节点从两个字到
   二十个字都有，任何按固定格子排的算法都会撞车或留一片空白。

   三块职责：
     A. 测量 —— 离屏 SVG + getBBox() 拿真实渲染尺寸
     B. 换行 —— 中文可任意断，英文只在空格/连字符断，混排按字符类型判
     C. 布局 —— 薄适配层，算法本体调 vendor/ 里的成熟库

   ── 布局算法为什么不自己写 ────────────────────────────────
   经典 Reingold-Tilford（1981）和 Buchheim 等人（2002）的线性时间版
   都假设「所有节点等宽」，d3.tree 继承了这个假设——这正是它排变尺寸
   节点会重叠的原因。变尺寸的论文正解是 A.J. van der Ploeg 的
   《Drawing Non-layered Tidy Trees in Linear Time》，
   `non-layered-tidy-tree-layout` 就是它的 JS 移植（MIT，零依赖，
   1.4KB gzip）。手撸一遍等于重复造轮子且容易出错，本文件只做格式
   转换和方向映射，算法本体交给它。

   ── 依赖 ──────────────────────────────────────────────────
   零 npm 运行时依赖，vendor 目录的 UMD 除外。加载顺序：
     <script src="../charts/deck-tokens.js"></script>
     <script src="diagram-tokens.js"></script>
     <script src="vendor/non-layered-tidy-tree-layout.js"></script>
     <script src="vendor/d3-hierarchy.min.js"></script>   ← 可选，只有
                                                             径向/环形版式要
     <script src="layout-core.js"></script>

   ── 必须 await 字体就绪 ────────────────────────────────────
   字体没加载完时测到的是 fallback 字体的宽度，全盘偏错，而且这个错
   会一路带到 PPT 截图。所有测量入口前必须 await DIAGRAM_LAYOUT.ready()。

   挂载：window.DIAGRAM_LAYOUT
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DIAGRAM = global.DIAGRAM;
  if (!DIAGRAM) {
    throw new Error('[layout-core] 需要先加载 diagram-tokens.js（window.DIAGRAM 未定义）');
  }
  const GEOM = DIAGRAM.GEOM;
  const NS = 'http://www.w3.org/2000/svg';

  /* ── 1 · 字体就绪闸门 ────────────────────────────────────────
     document.fonts.ready 在所有 @font-face 下载完成后 resolve。没等它
     就 getBBox()，量到的是 fallback 字体（比如中文还没 fallback 到
     PingFang 时用的是系统默认字），宽度能差 8% 以上，节点全部错位。

     再补一帧 rAF：fonts.ready resolve 的那一刻浏览器可能还没完成一次
     重排，隔一帧再测最稳。                                        */

  let readyPromise = null;

  /**
   * 等字体加载完成。所有测量/布局之前必须 await 它。
   * @returns {Promise<void>}
   */
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(resolve => {
      const nextFrame = () => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
      };
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        document.fonts.ready.then(nextFrame, nextFrame);
      } else {
        nextFrame();     // 老浏览器没有 FontFaceSet，只能直接过
      }
    });
    return readyPromise;
  }

  /* ── 2 · 离屏测量台 ──────────────────────────────────────────
     一个常驻的隐藏 SVG，往里塞 <text> 再读 getBBox()。

     为什么不是 canvas.measureText：canvas 2D 上下文自己解析字体栈，
     拿不到页面 CSS（font-family:inherit、字重映射、中文 fallback 到
     PingFang 还是 Noto）的结果。SVG 里量的就是最终要画的那个字体。

     两个必须踩对的点：
       · 元素没插进 document 时 getBBox() 返回全 0 —— 必须 appendChild
         到 document.body，不能只在内存里建。
       · display:none 的元素 getBBox() 同样返回 0 —— 只能用
         visibility:hidden + 挪到屏幕外。                          */

  let stage = null;      // <svg> 测量台
  let stageText = null;  // 复用的 <text>

  function ensureStage() {
    if (stage && stage.isConnected) return;
    stage = document.createElementNS(NS, 'svg');
    stage.setAttribute('aria-hidden', 'true');
    stage.setAttribute('width', '10');
    stage.setAttribute('height', '10');
    // 注意：visibility:hidden，不是 display:none（后者 getBBox 恒返回 0）
    stage.style.cssText =
      'position:absolute;left:-99999px;top:-99999px;' +
      'width:10px;height:10px;overflow:visible;visibility:hidden;pointer-events:none';
    stageText = document.createElementNS(NS, 'text');
    stageText.setAttribute('x', '0');
    stageText.setAttribute('y', '0');
    stageText.style.whiteSpace = 'pre';
    stage.appendChild(stageText);
    document.body.appendChild(stage);   // 必须真的进 DOM，否则 getBBox 全 0
  }

  /** 移除离屏测量台并清空缓存（页面卸载时自动调用，也可手动调） */
  function disposeStage() {
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    stage = null; stageText = null;
    cache = Object.create(null); cacheSize = 0;
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', disposeStage);
    window.addEventListener('unload', disposeStage);
  }

  let cache = Object.create(null);
  let cacheSize = 0;
  const CACHE_MAX = 4000;

  /**
   * 测量一段文字的真实渲染尺寸（单行，不换行）。
   * 同步函数——调用前调用方必须已经 await 过 ready()。
   * @param {string} text        文本
   * @param {number} fontSize    px
   * @param {number|string} [fontWeight=400]
   * @param {number} [maxWidth]  仅参与语义，不做裁剪（换行交给 wrapText）
   * @returns {{width:number, height:number}} px
   */
  function measureText(text, fontSize, fontWeight, maxWidth) {
    const s = text == null ? '' : String(text);
    const fw = fontWeight == null ? 400 : fontWeight;
    const key = fontSize + '|' + fw + '|' + s;
    const hit = cache[key];
    if (hit) return hit;

    if (typeof document === 'undefined') {          // 非浏览器兜底：粗估
      return { width: s.length * fontSize * 0.6, height: fontSize * 1.2 };
    }
    ensureStage();
    stageText.setAttribute('font-size', fontSize);
    stageText.setAttribute('font-weight', fw);
    stageText.textContent = s === '' ? ' ' : s;

    let box;
    try { box = stageText.getBBox(); }
    catch (e) { box = { width: s.length * fontSize * 0.6, height: fontSize * 1.2 }; }

    const res = {
      width: s === '' ? 0 : box.width,
      height: box.height || fontSize * 1.2,
    };
    if (cacheSize >= CACHE_MAX) { cache = Object.create(null); cacheSize = 0; }
    cache[key] = res; cacheSize++;
    return res;
  }

  /* ── 3 · 换行：中英混排 ──────────────────────────────────────
     断行规则：
       · CJK（汉字/假名/谚文）+ 全角标点 → 任意两字之间都能断
       · 拉丁字母、数字 → 只能在空格 / 连字符 / 斜杠后断
       · 行首禁则：闭引号、逗号句号这类不能落在行首，往上一行挤
       · 行尾禁则：开括号类不能挂在行尾，挪到下一行

     换行结果最终要落成一串 <tspan>，**不许用 foreignObject**：
     foreignObject 里的 HTML 在 PPT 截图后若再转矢量会整块丢内容。
     所以这里返回行数组，由版式文件逐行 <tspan> 画出来。          */

  const RE_CJK = /[⺀-鿿豈-﫿＀-￯　-〿가-힯]/;
  const NO_LINE_START = '、。，．；：？！）〕〉》」』】〗｝,.;:?!)]}’”>%°';
  const NO_LINE_END = '（〔〈《「『【〖｛([{‘“<';

  const isCJK = ch => RE_CJK.test(ch);
  const isBreakAfter = ch => ch === ' ' || ch === '\t' || ch === '-' || ch === '/' || ch === '—';

  /**
   * 把一段文字切成不可再分的断点单元。
   * CJK 每字一个单元；连续拉丁/数字聚成一个单词单元；空格并入前一单元。
   * @param {string} s
   * @returns {string[]}
   */
  function tokenize(s) {
    const out = [];
    let buf = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (isCJK(ch)) {
        if (buf) { out.push(buf); buf = ''; }
        out.push(ch);
      } else if (ch === ' ' || ch === '\t' || isBreakAfter(ch)) {
        buf += ch;
        out.push(buf); buf = '';           // 断点在这些字符之后
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  /**
   * 自动换行。中文任意断，英文只在空格/连字符断，混排按字符类型判。
   * 调用前必须已 await ready()。
   * @param {string} text
   * @param {number} fontSize    px
   * @param {number} [fontWeight=400]
   * @param {number} maxWidth    行最大宽度 px
   * @returns {{lines:string[], width:number, height:number, lineHeight:number}}
   *          width = 最长行的实测宽；height = 行数 × 行高
   */
  function wrapText(text, fontSize, fontWeight, maxWidth) {
    const s = text == null ? '' : String(text);
    const fw = fontWeight == null ? 400 : fontWeight;
    const limit = maxWidth && maxWidth > 0 ? maxWidth : Infinity;
    const lineH = Math.round(fontSize * 1.4);

    const paras = s.split('\n');
    const lines = [];

    paras.forEach(para => {
      if (para === '') { lines.push(''); return; }
      const toks = tokenize(para);
      let cur = '';
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        const trial = cur + t;
        const w = measureText(trial.replace(/\s+$/, ''), fontSize, fw).width;
        if (cur !== '' && w > limit) {
          // 行首禁则：本 token 以禁则字符开头就别断在这，硬塞进上一行
          if (NO_LINE_START.indexOf(t.charAt(0)) >= 0) { cur = trial; continue; }
          // 行尾禁则：上一行末尾是开括号类，把它挪到新行
          const trimmed = cur.replace(/\s+$/, '');
          const lastCh = trimmed.slice(-1);
          if (NO_LINE_END.indexOf(lastCh) >= 0 && trimmed.length > 1) {
            lines.push(trimmed.slice(0, -1));
            cur = lastCh + t;
            continue;
          }
          lines.push(trimmed);
          cur = t.replace(/^\s+/, '');
        } else {
          cur = trial;
        }
      }
      lines.push(cur.replace(/\s+$/, ''));
    });

    let width = 0;
    lines.forEach(l => { width = Math.max(width, measureText(l, fontSize, fw).width); });

    return { lines, width, height: lines.length * lineH, lineHeight: lineH };
  }

  /* ── 4 · 节点盒子尺寸 ────────────────────────────────────────── */

  /**
   * 算一个节点的最终盒子尺寸（含内边距、最小尺寸兜底）。
   * 调用前必须已 await ready()。
   * @param {string} text
   * @param {Object} [opts]
   *   @param {number} [opts.fontSize=14]
   *   @param {number} [opts.fontWeight=400]
   *   @param {number} [opts.maxWidth=GEOM.maxW]   文字区最大宽（不含内边距）
   *   @param {number} [opts.padX=GEOM.padX]
   *   @param {number} [opts.padY=GEOM.padY]
   *   @param {number} [opts.minW=GEOM.minW]
   *   @param {number} [opts.minH=GEOM.minH]
   * @returns {{w:number,h:number,lines:string[],lineHeight:number,textW:number,textH:number}}
   */
  function measureNode(text, opts) {
    opts = opts || {};
    const fs = opts.fontSize || 14;
    const fw = opts.fontWeight == null ? 400 : opts.fontWeight;
    const padX = opts.padX == null ? GEOM.padX : opts.padX;
    const padY = opts.padY == null ? GEOM.padY : opts.padY;
    const minW = opts.minW == null ? GEOM.minW : opts.minW;
    const minH = opts.minH == null ? GEOM.minH : opts.minH;
    const maxW = opts.maxWidth == null ? GEOM.maxW : opts.maxWidth;

    const wrapped = wrapText(text, fs, fw, maxW);
    const w = Math.max(minW, Math.ceil(wrapped.width + padX * 2));
    const h = Math.max(minH, Math.ceil(wrapped.height + padY * 2));

    return {
      w, h,
      lines: wrapped.lines,
      lineHeight: wrapped.lineHeight,
      textW: wrapped.width,
      textH: wrapped.height,
    };
  }

  /* ── 5 · 建树 ────────────────────────────────────────────────── */

  /**
   * 把嵌套数据转成带尺寸的树节点。调用前必须已 await ready()。
   * @param {Object} data  {text, children:[...]}；children 也可叫 nodes/items
   * @param {Object} [opts]
   *   @param {function} [opts.styleFor]  (depth,raw)=>{fontSize,fontWeight,maxWidth,...}
   *                                      默认走 DIAGRAM.TYPO.byDepth
   *   @param {number}   [opts.maxDepth]  超过这个深度的分支丢弃
   * @returns {Object} 根节点
   *   {text, depth, w, h, children, parent, _index, lines, lineHeight, x, y, data}
   */
  function buildTree(data, opts) {
    opts = opts || {};
    const TYPO = DIAGRAM.TYPO;
    const styleFor = opts.styleFor || (depth => {
      const f = TYPO.byDepth(depth);
      return { fontSize: f.size, fontWeight: f.weight, maxWidth: GEOM.maxW };
    });
    const maxDepth = opts.maxDepth == null ? Infinity : opts.maxDepth;

    let counter = 0;

    function walk(raw, depth, parent) {
      const text = raw == null ? '' :
        (typeof raw === 'string' ? raw
          : (raw.text != null ? raw.text : (raw.label != null ? raw.label : '')));
      const st = styleFor(depth, raw) || {};
      const m = measureNode(text, {
        fontSize: st.fontSize, fontWeight: st.fontWeight, maxWidth: st.maxWidth,
        padX: st.padX, padY: st.padY, minW: st.minW, minH: st.minH,
      });

      const node = {
        text, depth, parent: parent || null,
        w: m.w, h: m.h,
        lines: m.lines, lineHeight: m.lineHeight,
        fontSize: st.fontSize, fontWeight: st.fontWeight,
        children: [],
        _index: counter++,
        x: 0, y: 0,
        data: (raw && typeof raw === 'object') ? raw : { text: text },
      };

      const kids = (raw && typeof raw === 'object')
        ? (raw.children || raw.nodes || raw.items || [])
        : [];
      if (depth < maxDepth) {
        for (let i = 0; i < kids.length; i++) {
          /* 跳过畸形项，不生成"幽灵节点"。
             上游数据出空洞是很现实的：数组 filter 漏了、JSON 序列化产生
             null、YAML 里写了个空列表项。放行的话 null 会被转成 text:''
             的正常节点，占 72×40px 空盒、参与布局、还画连线 —— 图上平白
             多出看不出内容的空白方块，且没有任何提示。
             只认对象和字符串；null/undefined/数字/布尔一律丢弃。       */
          const rawKid = kids[i];
          if (rawKid == null) continue;
          const ty = typeof rawKid;
          if (ty !== 'object' && ty !== 'string') continue;

          const c = walk(rawKid, depth + 1, node);
          c._sibIndex = node.children.length;
          node.children.push(c);
        }
      }
      return node;
    }

    const root = walk(data, 0, null);
    root._sibIndex = 0;
    return root;
  }

  /** 先序遍历，返回所有节点的扁平数组 @param {Object} root @returns {Array} */
  function flatten(root) {
    const out = [];
    (function rec(n) { out.push(n); n.children.forEach(rec); })(root);
    return out;
  }

  /* ── 6 · 整齐树布局（薄适配层） ──────────────────────────────

     算法本体 = vendor/non-layered-tidy-tree-layout.js
       论文：A.J. van der Ploeg《Drawing Non-layered Tidy Trees in
       Linear Time》。"non-layered" 就是指它不假设同层节点等高/等宽，
       变尺寸节点是它的原生能力，不是打补丁打出来的。

     库的坐标系固定是自顶向下（TB）：x = 副轴（兄弟展开方向），
     y = 主轴（深度方向），返回的 x/y 已经是节点盒子左上角。
     所以本函数干三件事：
       1. 把我们的树转成库要的 {width, height, children} 格式
       2. 调库
       3. 把 TB 坐标轴变换成请求的 direction，并归一化到原点

     间距映射（BoundingBox(gap, bottomPadding) 的语义）：
       gap           → 副轴上兄弟之间的间隙 = siblingGap
       bottomPadding → 主轴上层与层之间的间隙 = levelGap
     库对"同父兄弟"和"不同父的相邻子树"用的是同一个 gap，没有分开的
     参数。我们的 subtreeGap 比 siblingGap 大，所以取两者较大值喂给
     库——宁可整体松一点，也不能让两棵子树贴到一起。这是接库带来的
     取舍，如实记在这里。                                          */

  /**
   * 整齐树布局。原生支持变尺寸节点（算法来自 vendor 库）。
   * @param {Object} root  buildTree 的返回值
   * @param {Object} [opts]
   *   @param {'LR'|'RL'|'TB'|'BT'} [opts.direction='LR']
   *   @param {number} [opts.levelGap=GEOM.levelGap]     层间距（主轴，边到边）
   *   @param {number} [opts.siblingGap=GEOM.siblingGap] 同父兄弟间距（副轴）
   *   @param {number} [opts.subtreeGap=GEOM.subtreeGap] 相邻子树间距（副轴）
   * @returns {Object} root（原地写入每个节点的 x/y/cx/cy，并返回）
   */
  function layoutTidyTree(root, opts) {
    opts = opts || {};
    const dir = opts.direction || 'LR';
    const levelGap = opts.levelGap == null ? GEOM.levelGap : opts.levelGap;
    const sibGap = opts.siblingGap == null ? GEOM.siblingGap : opts.siblingGap;
    const subGap = opts.subtreeGap == null ? GEOM.subtreeGap : opts.subtreeGap;

    const lib = global.nonLayeredTidyTreeLayout;
    if (!lib || !lib.Layout || !lib.BoundingBox) {
      throw new Error('[layout-core] 需要先加载 vendor/non-layered-tidy-tree-layout.js');
    }

    const all = flatten(root);
    if (!all.length) return root;

    const horizontal = dir === 'LR' || dir === 'RL';
    // 喂给库时，主轴永远当成"高"，副轴当成"宽"（库是 TB 口径）
    const mainSize = n => (horizontal ? n.w : n.h);
    const crossSize = n => (horizontal ? n.h : n.w);

    /* 6.1 转成库要的格式，并留一条回指原节点的引用 */
    function toLib(n) {
      const o = { width: crossSize(n), height: mainSize(n), _src: n, children: [] };
      n.children.forEach(c => o.children.push(toLib(c)));
      return o;
    }
    const libRoot = toLib(root);

    /* 6.2 调库。gap 取 sibling/subtree 较大值（见上方取舍说明） */
    const bb = new lib.BoundingBox(Math.max(sibGap, subGap), levelGap);
    const res = new lib.Layout(bb).layout(libRoot);

    /* 6.3 把库的 (x=副轴, y=主轴) 变换回请求的 direction。
           先收集，再统一归一化到左上角 (0,0)。                     */
    let mainMax = 0;
    (function collect(o) {
      mainMax = Math.max(mainMax, o.y + o.height);
      o.children.forEach(collect);
    })(res.result);

    (function apply(o) {
      const n = o._src;
      const cross = o.x;                      // 副轴左上角
      let main = o.y;                         // 主轴左上角
      if (dir === 'RL' || dir === 'BT') main = mainMax - o.y - o.height;
      if (horizontal) { n.x = main; n.y = cross; }
      else            { n.x = cross; n.y = main; }
      o.children.forEach(apply);
    })(res.result);

    // 归一化：整棵树左上角挪到 (0,0)
    let minX = Infinity, minY = Infinity;
    all.forEach(n => { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); });
    all.forEach(n => {
      n.x -= minX; n.y -= minY;
      n.cx = n.x + n.w / 2;
      n.cy = n.y + n.h / 2;
    });

    return root;
  }

  /* ── 7 · 包围盒与 viewBox ─────────────────────────────────── */

  /**
   * 一组节点的整体包围盒。
   * @param {Array|Object} nodes 带 {x,y,w,h} 的节点数组，或树根（自动 flatten）
   * @returns {{x:number,y:number,w:number,h:number,x2:number,y2:number}}
   */
  function boundsOf(nodes) {
    const list = Array.isArray(nodes) ? nodes : flatten(nodes);
    if (!list.length) return { x: 0, y: 0, w: 0, h: 0, x2: 0, y2: 0 };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    list.forEach(n => {
      x1 = Math.min(x1, n.x);
      y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + n.w);
      y2 = Math.max(y2, n.y + n.h);
    });
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, x2, y2 };
  }

  /**
   * 按节点分布自动设置 SVG 的 viewBox，内容居中、四周留白一致。
   * @param {SVGElement|string} svg      SVG 元素或其 id
   * @param {Array|Object} nodes         节点数组或树根
   * @param {number} [padding=GEOM.pad]  四周留白 px
   * @returns {{x:number,y:number,w:number,h:number,viewBox:string}}
   */
  function fitViewBox(svg, nodes, padding) {
    const p = padding == null ? GEOM.pad : padding;
    const b = boundsOf(nodes);
    const vb = {
      x: b.x - p, y: b.y - p,
      w: Math.max(1, b.w + p * 2), h: Math.max(1, b.h + p * 2),
    };
    vb.viewBox = [vb.x, vb.y, vb.w, vb.h].map(v => Math.round(v * 100) / 100).join(' ');
    const node = typeof svg === 'string' ? document.getElementById(svg) : svg;
    if (node && node.setAttribute) {
      node.setAttribute('viewBox', vb.viewBox);
      node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
    return vb;
  }

  /* ── 8 · 连线路径 ────────────────────────────────────────────
     父子之间的三次贝塞尔。控制点沿主轴方向拉出 curve × 间距，副轴不动，
     出来就是"从父节点侧边平滑弯到子节点侧边"的经典树连线。         */

  /**
   * 生成父→子的连线 path d。
   * @param {Object} parent 带 {x,y,w,h}
   * @param {Object} child  带 {x,y,w,h}
   * @param {'LR'|'RL'|'TB'|'BT'} [dir='LR']
   * @param {number} [curve=GEOM.curve] 0=直折线 1=最弯
   * @returns {string} SVG path 的 d 属性值
   */
  function linkPath(parent, child, dir, curve) {
    dir = dir || 'LR';
    const k = curve == null ? GEOM.curve : curve;
    let x1, y1, x2, y2, c1x, c1y, c2x, c2y;

    if (dir === 'LR' || dir === 'RL') {
      const rl = dir === 'RL';
      x1 = rl ? parent.x : parent.x + parent.w;
      y1 = parent.y + parent.h / 2;
      x2 = rl ? child.x + child.w : child.x;
      y2 = child.y + child.h / 2;
      const dx = (x2 - x1) * k;
      c1x = x1 + dx; c1y = y1; c2x = x2 - dx; c2y = y2;
    } else {
      const bt = dir === 'BT';
      x1 = parent.x + parent.w / 2;
      y1 = bt ? parent.y : parent.y + parent.h;
      x2 = child.x + child.w / 2;
      y2 = bt ? child.y + child.h : child.y;
      const dy = (y2 - y1) * k;
      c1x = x1; c1y = y1 + dy; c2x = x2; c2y = y2 - dy;
    }
    const r = v => Math.round(v * 100) / 100;
    return `M${r(x1)} ${r(y1)} C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(x2)} ${r(y2)}`;
  }

  /* ── 9 · 文字落 tspan ────────────────────────────────────────
     wrapText 出来的行数组必须画成 <tspan>，不许用 foreignObject——
     foreignObject 里的 HTML 在 PPT 截图后若再转矢量会整块丢内容。   */

  /**
   * 把多行文字画进一个 <text>（逐行 tspan，整体垂直居中于节点盒）。
   * @param {SVGElement} parent  挂载父节点（通常是 <g>）
   * @param {Object} node        带 {x,y,w,h,lines,lineHeight,fontSize,fontWeight}
   * @param {Object} [style]     {fill, fontFamily, textAnchor}
   * @returns {SVGTextElement}
   */
  function drawNodeText(parent, node, style) {
    style = style || {};
    const lines = node.lines && node.lines.length ? node.lines : [node.text || ''];
    const lh = node.lineHeight || Math.round((node.fontSize || 14) * 1.4);
    const anchor = style.textAnchor || 'middle';
    const cx = anchor === 'start' ? node.x + GEOM.padX
      : anchor === 'end' ? node.x + node.w - GEOM.padX
        : node.x + node.w / 2;
    // 首行基线：整块文字垂直居中
    const totalH = lines.length * lh;
    const firstY = node.y + (node.h - totalH) / 2 + lh / 2;

    const t = DIAGRAM.el(parent, 'text', {
      x: cx, y: firstY,
      'text-anchor': anchor,
      'font-size': node.fontSize || 14,
      'font-weight': node.fontWeight == null ? 400 : node.fontWeight,
      'font-family': style.fontFamily || 'inherit',
      fill: style.fill || 'currentColor',
      'dominant-baseline': 'middle',
    });
    lines.forEach((line, i) => {
      const ts = DIAGRAM.el(t, 'tspan', { x: cx, dy: i === 0 ? 0 : lh });
      ts.textContent = line;
    });
    return t;
  }

  global.DIAGRAM_LAYOUT = {
    ready,
    measureText, wrapText, measureNode, disposeStage,
    buildTree, flatten,
    layoutTidyTree,
    boundsOf, fitViewBox, linkPath, drawNodeText,
    tokenize,   // 导出供换行规则的单测使用
  };
})(typeof window !== 'undefined' ? window : globalThis);
