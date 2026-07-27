/* ═══════════════════════════════════════════════════════════════
   DIAGRAM TOKENS — p2h2p 结构图设计变量层

   结构图 = 思维导图 / 金字塔 / 鱼骨图 / 组织架构 / 流程 / 象限 / 时间轴
   这类"讲结构不讲数值"的图。与 Step 3.7 的数据图表并列，共用同一套
   deck 配色来源，保证同一份 deck 里图表和结构图看上去是一个系统。

   分工（重要）：
     · deck-tokens.js（window.DECK）—— 色彩正本。hex⇄HSL、buildLadder
       明度阶、fromCssVars 取 deck 变量、PROJECTION 投屏下限、rnd 确定性
       伪随机、el/txt/tip SVG 快捷。本文件一律复用，绝不重复实现。
     · diagram-tokens.js（window.DIAGRAM）—— 只补结构图特有的那层：
       按层级深浅的节点填充、连线色、自动黑白字、几何常量、字号阶、
       以及 enforceProjection() 这个投屏硬闸的程序化实现。

   依赖：必须先加载 deck-tokens.js。
   用法：<script src="deck-tokens.js"></script>
         <script src="diagram-tokens.js"></script>
         const T = DIAGRAM.fromDeck();
   单文件 HTML deck 建议直接内联进 <script>。
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DECK = global.DECK;
  if (!DECK) {
    throw new Error('[diagram-tokens] 需要先加载 deck-tokens.js（window.DECK 未定义）');
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ── 1 · 对比度：按背景明度自动选深色字 / 浅色字 ─────────────
     结构图和数据图最大的差别是"节点里必须放字"。节点填充随层级由深
     到浅，同一套文字色必然在某一层撞上对比度不足。用相对亮度判一次，
     谁能看清用谁。

     亮度公式用 WCAG 2.x 的相对亮度（sRGB 反 gamma 后按 .2126/.7152/
     .0722 加权）。阈值取 0.55 而非教科书的 0.5：结构图节点面积小、
     字号也不大，宁可偏早一点切到深色字。                        */

  // 单通道 sRGB 反 gamma
  function srgbToLin(c) {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /**
   * 计算颜色的 WCAG 相对亮度。
   * @param {string} hex  '#rrggbb' / '#rgb'
   * @returns {number} 0（纯黑）～ 1（纯白）；解析失败返回 1
   */
  function luminance(hex) {
    const c = DECK.hexToRgb(hex);
    if (!c) return 1;
    return 0.2126 * srgbToLin(c.r) + 0.7152 * srgbToLin(c.g) + 0.0722 * srgbToLin(c.b);
  }

  const INK_THRESHOLD = 0.55;

  /**
   * 按底色明度挑一个能看清的文字色。
   * 先按 0.55 阈值选，再用实际对比度复核：两个候选谁的对比度高就用谁。
   * 只用阈值会在"中等明度填充 + 两个候选都不够黑/够白"时选错——中间
   * 层的节点填充恰恰最容易落在这个区间（实测 #a9b7d8 配近白字只有
   * 1.83:1，肉眼几乎看不清）。阈值给方向，对比度做仲裁。
   *
   * @param {string} bgHex     节点填充色
   * @param {string} darkInk   底色亮时用的深色字
   * @param {string} lightInk  底色暗时用的浅色字
   * @returns {string} darkInk 或 lightInk 中对比度更高的那个
   */
  function pickInk(bgHex, darkInk, lightInk) {
    const first = luminance(bgHex) > INK_THRESHOLD ? darkInk : lightInk;
    const other = first === darkInk ? lightInk : darkInk;
    // 阈值选中的那个若已达 AA（4.5:1），直接用；否则拿对比度高的兜底
    if (contrastRatio(bgHex, first) >= 4.5) return first;
    return contrastRatio(bgHex, other) > contrastRatio(bgHex, first) ? other : first;
  }

  /**
   * 对比度比值（WCAG），用于自检。
   * @param {string} a hex
   * @param {string} b hex
   * @returns {number} 1 ～ 21
   */
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* ── 2 · 几何常量 ────────────────────────────────────────────
     节点内边距横向明显大于纵向（18/12）：中文方块字横向密度高，左右
     太紧会贴边；纵向行高本身已经带气口。

     节点圆角从 DECK.SHAPE.cardRadius 推导（× 0.42，钳在 6–14）：卡片
     24px 的大圆角放到 40px 高的小节点上会圆成药丸，层级感全丢。      */

  const CARD_R = (DECK.SHAPE && DECK.SHAPE.cardRadius) || 24;

  const GEOM = {
    padX: 18,             // 节点内边距 · 横
    padY: 12,             // 节点内边距 · 竖
    minW: 72,             // 节点最小宽（两个字也不至于成小方块）
    minH: 40,             // 节点最小高
    maxW: 260,            // 单行最大宽，超了走换行
    levelGap: 72,         // 层与层之间（父到子的主轴间距）
    siblingGap: 16,       // 同一个父节点下相邻兄弟的间距
    subtreeGap: 28,       // 不同父节点的相邻子树之间的间距（大于 siblingGap）
    curve: 0.5,           // 连线曲率 0=折线 1=最弯；贝塞尔控制点占间距比例
    nodeRadius: clamp(Math.round(CARD_R * 0.42), 6, 14),
    leafRadius: clamp(Math.round(CARD_R * 0.30), 4, 10),  // 末级节点更方一点
    strokeW: Math.max(DECK.PROJECTION.minStroke, 1.5),    // 节点描边
    linkW: Math.max(DECK.PROJECTION.minStroke, 1.5),      // 连线
    pad: 32,              // viewBox 四周留白
  };

  /* ── 3 · 字号阶 ──────────────────────────────────────────────
     四档：根 / 一级 / 二级 / 三级及以下。全部 ≥ PROJECTION.minSvgFont，
     字族一律 inherit 跟 deck 走（同 DECK.FONT.family 的口径）。      */

  const MIN_SVG = DECK.PROJECTION.minSvgFont;
  const sz = v => Math.max(MIN_SVG, v);

  const TYPO = {
    family: 'inherit',
    root: { size: sz(22), weight: 700, lineHeight: 1.32 },  // 根节点 / 中心主题
    l1:   { size: sz(17), weight: 650, lineHeight: 1.36 },  // 一级分支
    l2:   { size: sz(14), weight: 500, lineHeight: 1.40 },  // 二级
    l3:   { size: sz(13), weight: 400, lineHeight: 1.44 },  // 三级及以下（含末梢）
    /**
     * 按深度取字号档。
     * @param {number} depth 0=根
     * @returns {{size:number,weight:number,lineHeight:number}}
     */
    byDepth(depth) {
      if (depth <= 0) return this.root;
      if (depth === 1) return this.l1;
      if (depth === 2) return this.l2;
      return this.l3;
    },
  };

  /* ── 4 · 从 deck 生成完整结构图色板 ──────────────────────────
     底座是 DECK.fromCssVars()，本函数只在其上补层级色。

     ladder 语义（deck-tokens.js 定的）：下标越大越"重"。浅底 deck 的
     "重" = 深；深底 deck 的 "重" = 亮。所以两种底下都直接用「下标大 =
     根节点」，深浅方向自动就反过来了，不需要额外分支——但节点文字色
     必须重算（pickInk 按实际填充亮度判），这才是深色 deck 真正的坑。 */

  // 从 ladder 上按 0～1 的位置取色（位置 1 = 最重）
  const at = (ladder, t) => ladder[clamp(Math.round((ladder.length - 1) * t), 0, ladder.length - 1)];

  // 层级 → ladder 位置：根最重，越深越淡，第 4 层之后不再变淡
  const DEPTH_T = [1.00, 0.72, 0.48, 0.30, 0.30, 0.30];
  const tForDepth = d => DEPTH_T[clamp(d, 0, DEPTH_T.length - 1)];

  /**
   * 生成一整套结构图 token，跟随当前 deck 的 CSS 变量配色。
   * @param {Element} [scope] 取值起点，默认 :root；传某页元素可做单页覆写
   * @param {Object}  [opts]  透传给 DECK.fromCssVars 的 {steps, base, bg, ink}
   * @returns {Object} 见下方 return 的字段说明
   */
  function fromDeck(scope, opts) {
    opts = opts || {};
    const deck = DECK.fromCssVars(scope, opts);
    const ladder = deck.ladder;
    const isDark = deck.isDark;

    // 深浅底各自的两个极端字色：文字要么贴背景色（反白/反黑），要么用 ink
    const darkInk = isDark ? deck.bg : deck.ink;   // 用在"亮填充"上的深字
    const lightInk = isDark ? deck.ink : deck.bg;  // 用在"暗填充"上的浅字
    // 注意深色 deck 下 deck.ink 本身就是浅色（--color-ink 取的是正文色），
    // deck.bg 是深色，所以上面两行是对的：亮底配深字=deck.bg，暗底配浅字=deck.ink。

    /**
     * 某一层级的完整节点样式。
     * @param {number} depth 0=根
     * @returns {{fill:string,stroke:string,ink:string,radius:number,font:Object}}
     */
    function nodeStyle(depth) {
      const fill = at(ladder, tForDepth(depth));
      // 描边比填充再重一档，浅层节点靠它才有轮廓；最重那层则往回退一点
      const strokeT = clamp(tForDepth(depth) + 0.18, 0, 1);
      const stroke = at(ladder, strokeT === tForDepth(depth) ? clamp(strokeT - 0.18, 0, 1) : strokeT);
      return {
        fill,
        stroke,
        ink: pickInk(fill, darkInk, lightInk),
        radius: depth >= 3 ? GEOM.leafRadius : GEOM.nodeRadius,
        font: TYPO.byDepth(depth),
      };
    }

    // 连线：比节点描边淡一档，避免线抢过节点
    const linkT = 0.55;
    const link = at(ladder, linkT);
    const linkFaint = at(ladder, 0.34);

    return {
      /* 直接透传的 deck 层 */
      base: deck.base, bg: deck.bg, ink: deck.ink, isDark,
      muted: deck.muted, faint: deck.faint, grid: deck.grid,
      ladder, L: deck.L, LAD: deck.LAD,

      /* 结构图专用 */
      nodeStyle,                       // (depth) => 该层的填充/描边/字色/圆角/字号
      fills: DEPTH_T.map(t => at(ladder, t)),   // 层级填充色阶，调试/图例用
      link,                            // 主连线色（比节点描边淡一档）
      linkFaint,                       // 次级连线 / 虚线 / 引导线
      inkOnDark: lightInk,             // 暗填充上的字色
      inkOnLight: darkInk,             // 亮填充上的字色
      /* 语义色（强调/警示这类）：仍从 ladder 取，不引外部调色板，
         保证"同一色系深浅即语义"这条 deck 规则不被破坏 */
      accent: at(ladder, 1.00),
      accentSoft: at(ladder, 0.62),
      surface: at(ladder, 0.08),       // 分组底板 / 泳道底色

      GEOM, TYPO,
      pickInk, luminance, contrastRatio,
    };
  }

  /* ── 5 · 投屏硬闸的程序化实现 ────────────────────────────────
     Step 3.7 的投屏下限原本靠人肉走查模板代码。结构图版式是程序生成
     的，直接跑一遍 DOM 把违规值顶上去，比走查可靠。

     覆盖三个来源：presentation 属性（stroke-width="1"）、内联 style、
     以及 CSS 计算值（模板 class 里写死的细线）。计算值改不动源 CSS，
     只能就地写内联 style 盖过去。                                 */

  const MIN_STROKE = DECK.PROJECTION.minStroke;

  function numOf(v) {
    if (v == null) return NaN;
    const n = parseFloat(String(v));
    return isNaN(n) ? NaN : n;
  }

  /**
   * 遍历 SVG，把低于投屏下限的 stroke-width / font-size 顶到下限。
   * 单位是 px 之外的（em/rem/%）跳过，不瞎换算。
   * @param {SVGElement|string} svgRoot  SVG 元素或其 id
   * @returns {{fixed:number, strokes:number, fonts:number, details:Array}}
   *          fixed = 被修正的元素数（同一元素两项都改也只算一次）
   */
  function enforceProjection(svgRoot) {
    const root = typeof svgRoot === 'string' ? document.getElementById(svgRoot) : svgRoot;
    const out = { fixed: 0, strokes: 0, fonts: 0, details: [] };
    if (!root || !root.querySelectorAll) return out;

    const nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    const canCompute = typeof getComputedStyle === 'function';

    nodes.forEach(n => {
      if (!n.setAttribute) return;
      let touched = false;

      /* stroke-width：只有真的在描边（stroke 不是 none）才管 */
      const cs = canCompute ? getComputedStyle(n) : null;
      const strokePaint = (cs && cs.stroke) || n.getAttribute('stroke') || '';
      const hasStroke = strokePaint && strokePaint !== 'none' && strokePaint !== 'transparent';
      if (hasStroke) {
        let sw = numOf(n.style && n.style.strokeWidth);
        if (isNaN(sw)) sw = numOf(n.getAttribute('stroke-width'));
        if (isNaN(sw) && cs) sw = numOf(cs.strokeWidth);
        if (isNaN(sw)) sw = 1;                       // SVG 默认 1px
        if (sw > 0 && sw < MIN_STROKE) {
          n.style.strokeWidth = MIN_STROKE + 'px';
          out.strokes++; touched = true;
          out.details.push({ el: n, prop: 'stroke-width', from: sw, to: MIN_STROKE });
        }
      }

      /* font-size：只管 text / tspan（其余元素的字号不落地） */
      const tag = (n.tagName || '').toLowerCase();
      if (tag === 'text' || tag === 'tspan') {
        const raw = (n.style && n.style.fontSize) || n.getAttribute('font-size') || '';
        // 带非 px 单位的跳过
        if (!/[a-z%]/i.test(String(raw).replace(/px/i, '')) || raw === '') {
          let fs = numOf(raw);
          if (isNaN(fs) && cs) fs = numOf(cs.fontSize);
          if (!isNaN(fs) && fs > 0 && fs < MIN_SVG) {
            n.style.fontSize = MIN_SVG + 'px';
            out.fonts++; touched = true;
            out.details.push({ el: n, prop: 'font-size', from: fs, to: MIN_SVG });
          }
        }
      }

      if (touched) out.fixed++;
    });

    return out;
  }

  /* ── 6 · 结构图卡骨架 CSS ────────────────────────────────────
     和 DECK.CARD_CSS 同构，但不写死 stroke-width（结构图的线宽由
     enforceProjection 逐元素兜底，全局 max() 会把连线也拉粗成一样）。 */
  const DIAGRAM_CSS = `
  .diagram-card{border-radius:${CARD_R}px;padding:${(DECK.SHAPE && DECK.SHAPE.cardPad) || '28px'};color:inherit}
  .diagram-card h2{font-weight:700;font-size:22px;letter-spacing:-.02em;margin:0 0 4px}
  .diagram-card .sub{font-size:15px;opacity:.68;margin-bottom:16px}
  .diagram-card svg{display:block;width:100%;height:auto}
  .diagram-card svg text{font-family:${TYPO.family};dominant-baseline:middle}
  .diagram-card .src{font-size:12px;opacity:.45;margin-top:12px;letter-spacing:.08em;font-weight:500;text-transform:uppercase}`;

  global.DIAGRAM = {
    fromDeck,
    pickInk, luminance, contrastRatio, INK_THRESHOLD,
    GEOM, TYPO, DEPTH_T, DIAGRAM_CSS,
    enforceProjection,
    // 转发常用的 deck 工具，省得版式文件两处 import
    rnd: DECK.rnd, el: DECK.el, txt: DECK.txt, tip: DECK.tip,
  };
})(typeof window !== 'undefined' ? window : globalThis);
