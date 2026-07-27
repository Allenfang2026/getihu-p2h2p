/* ═══════════════════════════════════════════════════════════════
   DECK TOKENS — p2h2p 图表风格正本

   改编自 lieflat-charts 的 mono-tokens.js
     上游 commit：e5b369d
     上游许可证：PolyForm Noncommercial License 1.0.0（禁商用）

   有意偏离上游之处（本副本与上游分叉，不做同步）：
     1. 上游是写死的单色 ladder（纸灰 #F0EFEB → 炭黑 #1C1C1A 九级）。
        本副本改为 buildLadder(baseColor, bgColor, steps)，跟随每个 deck
        自己的配色生成明度阶；语义仍是「明度即数据」：第 0 项最浅、
        最后一项最深。
     2. 新增 fromCssVars()，从页面 CSS 自定义属性（--color-primary /
        --color-bg 等）自动取色，图表随 deck 主题走。
     3. 新增 PROJECTION 投屏可读性下限（线宽 1.5px / 正文 14pt /
        SVG 内 11px），远大于上游的 0.5px 线宽、6.5px 字号 —— 上游面向
        近距离阅读的网页长文，本副本面向投影仪和会议室后排。

   保留不动：rnd() 确定性伪随机、obsReveal() 滚入即播机制、圆角 / 字号
   结构、quarticOut 动画曲线与 stagger 时长、prefers-reduced-motion 降级。

   用法：<script src="deck-tokens.js"></script>，全部挂在 window.DECK 上；
   单文件 HTML deck 建议直接把本文件内联进 <script>。
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── 0 · 色彩工具：hex ⇄ HSL ──────────────────────────────
     ladder 的插值在 HSL 的 lightness 维度做，色相和饱和度取基色的，
     这样九级阶看上去是"同一个颜色的深浅"，不会跑色。            */

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // '#2563EB' / '#25f' / '2563EB' → {r,g,b} 0-255
  function hexToRgb(hex) {
    let h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 8) h = h.slice(0, 6);           // 丢掉 alpha
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  const hex2 = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  const rgbToHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

  // {r,g,b} 0-255 → {h:0-360, s:0-1, l:0-1}
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else                h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  }

  // {h,s,l} → '#rrggbb'
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if      (h <  60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  const hexToHsl = hex => { const c = hexToRgb(hex); return c ? rgbToHsl(c.r, c.g, c.b) : null; };

  /* ── 1 · ladder：明度即数据 ────────────────────────────────
     buildLadder(基色, 背景色, 级数) → ['#最浅', …, '#最深']

     背景浅（常规浅色 deck）：最浅端贴近背景（基色低饱和的淡影），
     最深端是基色压暗后的重色 —— 与上游"纸灰→炭黑"同构。
     背景深（暗色 deck）：自动反向，最浅端反而是高明度色，
     保证任何一级都能从背景里跳出来（对比度不塌）。

     语义不变：数组下标越大 = 越重要 / 数值越大。多系列按重要性
     从深到浅倒着取（L[L.length-1] 给主系列）。                 */

  const DEFAULT_STEPS = 9;

  function buildLadder(baseColor, bgColor, steps) {
    steps = steps || DEFAULT_STEPS;
    const base = hexToHsl(baseColor) || { h: 0, s: 0, l: 0.11 };   // 兜底：炭黑
    const bg   = hexToHsl(bgColor)   || { h: 0, s: 0, l: 0.94 };   // 兜底：纸灰
    const bgIsDark = bg.l < 0.5;

    // 最浅端：贴近背景但必须可见（浅底往下压一点，深底往上提一点）
    // 最深端：基色本身压到足够重（浅底）/ 提到足够亮（深底）
    let lLight, lDark, sLight, sDark;
    if (bgIsDark) {
      lLight = clamp(bg.l + 0.12, 0.16, 0.40);   // 深底上的"最浅"= 略亮于底
      lDark  = clamp(Math.max(base.l, 0.62), 0.62, 0.92);
      sLight = base.s * 0.30;
      sDark  = clamp(base.s * 0.85, 0, 1);
    } else {
      lLight = clamp(bg.l - 0.06, 0.72, 0.94);   // 浅底上的"最浅"= 略暗于底
      lDark  = clamp(Math.min(base.l, 0.34), 0.08, 0.34);
      sLight = base.s * 0.30;
      sDark  = clamp(base.s * 0.90, 0, 1);
    }

    const out = [];
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 1 : i / (steps - 1);   // 0 = 最浅 → 1 = 最深
      const l = lLight + (lDark - lLight) * t;
      const s = sLight + (sDark - sLight) * t;
      out.push(hslToHex(base.h, s, l));
    }
    return out;
  }

  /* ── 2 · 从 deck 的 CSS 变量取色 ────────────────────────────
     fromCssVars() 读当前页面的自定义属性，产出一整套 token。
     支持的变量名按优先级往下找，找不到就退回中性默认值。      */

  const VAR_CANDIDATES = {
    base: ['--color-primary', '--primary', '--color-accent', '--accent', '--color-ink', '--ink'],
    bg:   ['--color-bg', '--bg', '--color-background', '--background', '--color-surface', '--surface'],
    ink:  ['--color-ink', '--ink', '--color-text', '--text', '--color-fg', '--fg'],
  };

  const FALLBACK = { base: '#1C1C1A', bg: '#F0EFEB', ink: '#1C1C1A' };

  function readVar(names, scope) {
    if (typeof getComputedStyle !== 'function') return null;
    const node = scope || (typeof document !== 'undefined' ? document.documentElement : null);
    if (!node) return null;
    const cs = getComputedStyle(node);
    for (const n of names) {
      const v = (cs.getPropertyValue(n) || '').trim();
      if (v && hexToRgb(v)) return v.startsWith('#') ? v : '#' + v.replace(/^#/, '');
    }
    return null;
  }

  /**
   * 从页面 CSS 变量生成跟随 deck 配色的图表 token。
   * @param {Element}  [scope]  取值起点，默认 :root；给某一页元素可做单页覆写
   * @param {Object}   [opts]   { steps, base, bg, ink } 显式覆盖
   * @returns {{base,bg,ink,muted,faint,grid,ladder,L,LAD,tip,isDark}}
   */
  function fromCssVars(scope, opts) {
    opts = opts || {};
    const base = opts.base || readVar(VAR_CANDIDATES.base, scope) || FALLBACK.base;
    const bg   = opts.bg   || readVar(VAR_CANDIDATES.bg,   scope) || FALLBACK.bg;
    const ink  = opts.ink  || readVar(VAR_CANDIDATES.ink,  scope) || FALLBACK.ink;
    const steps = opts.steps || DEFAULT_STEPS;

    const ladder = buildLadder(base, bg, steps);
    const bgHsl  = hexToHsl(bg) || { h: 0, s: 0, l: 0.94 };
    const isDark = bgHsl.l < 0.5;

    // 次级 / 辅助层：从 ladder 上取，保证同一色系
    const mid = ladder[Math.floor((steps - 1) * 0.45)];
    const soft = ladder[Math.floor((steps - 1) * 0.22)];
    const hair = ladder[0];

    return {
      base, bg, ink, isDark,
      muted: mid,          // 副标题、次级文字
      faint: soft,         // 来源行、辅助刻度
      grid:  hair,         // 网格线、发丝线
      ladder,
      L:   ladder.slice().reverse(),                       // 由深到浅，主系列在前
      LAD: [ladder[steps - 1], ladder[Math.floor(steps * 0.7)],
            ladder[Math.floor(steps * 0.45)], ladder[Math.floor(steps * 0.22)], ladder[0]],
      tip: { backgroundColor: ink, borderWidth: 0, padding: [10, 14],
             textStyle: { color: bg, fontFamily: 'inherit', fontSize: 13 } },
    };
  }

  /* ── 3 · 投屏可读性下限（硬约束，别往下调） ─────────────────
     PPT 要投到投影仪 / 大屏，会议室后排看。上游那套 0.5px 发丝线、
     6.5px SVG 字号在屏幕上精致，投出来直接消失。               */
  const PROJECTION = {
    minStroke:  1.5,   // 任何线（轴线、网格、连线、描边）的最小 px 宽
    minFontPt:  14,    // HTML 正文最小磅值
    minSvgFont: 11,    // SVG <text> 最小 px 字号；低于这个就别画，改 hover / 图例
  };

  /* ── 4 · 字体 ────────────────────────────────────────────
     字族跟 deck 走（继承 --font-* 或 body），这里只定尺寸与字重结构。 */
  const FONT = {
    family: 'inherit',
    title:    { size: 22,   weight: 700, spacing: '-.02em' },  // 卡内 h2
    titleBig: { size: 26,   weight: 700, spacing: '-.02em' },  // 整页大图 h2
    sub:      { size: 15,   weight: 400 },                     // 副标题 / 图例说明
    src:      { size: 12,   weight: 500, spacing: '.08em' },   // 来源行，全大写
    value:    { weight: 800 },                                 // 图内数值一律 800
    axis:     { size: 13,   weight: 600 },                     // 轴标签
    // SVG 内最小字号下限：投屏口径，见 PROJECTION.minSvgFont
    minHalf: PROJECTION.minSvgFont,
    minWide: PROJECTION.minSvgFont,
  };

  /* ── 5 · 形状 ────────────────────────────────────────────── */
  const SHAPE = {
    cardRadius: 24,
    cardPad: '28px 28px 20px',
    barRadius: 99,           // 柱端胶囊圆角（竖柱只圆上端，横柱只圆外端）
    tooltipRadius: 12,
  };

  /* ── 6 · 动画性格 ────────────────────────────────────────
     快进快停，quarticOut / cubicOut，不弹跳（elasticOut 只给波浪入场）。 */
  const MOTION = {
    enter: 900,
    enterSlow: 1200,
    easing: 'quarticOut',
    staggerDot: 12,          // 点阵逐个延迟 ms（8–15 区间）
    staggerBar: 100,         // 条形逐根延迟 ms（80–130 区间）
    css: `
  .pop{transform-box:fill-box;transform-origin:center;animation:pop .5s cubic-bezier(.2,.7,.3,1.3) both}
  @keyframes pop{from{transform:scale(0)}to{transform:none}}
  .fade{animation:fade .9s ease both}
  @keyframes fade{from{opacity:0}}
  .draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1s cubic-bezier(.4,0,.2,1) both}
  @keyframes draw{to{stroke-dashoffset:0}}
  @media (prefers-reduced-motion:reduce){
    .pop,.fade{animation:none}
    .draw{animation:none;stroke-dasharray:none;stroke-dashoffset:0}
  }`,
  };

  /* ── 7 · 确定性伪随机 ────────────────────────────────────
     演示数据一律用它，不用 Math.random()——刷新必须长一样，
     否则截图 / 导 PDF / 回归对比全部失效。                     */
  const rnd = (i, k) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;

  /* ── 8 · 几何 ────────────────────────────────────────────── */
  const D2R = Math.PI / 180;
  const pol = (cx, cy, r, deg) => [cx + r * Math.cos(deg * D2R), cy + r * Math.sin(deg * D2R)];
  const sect = (cx, cy, r0, r1, a0, a1) => {
    const big = a1 - a0 > 180 ? 1 : 0;
    const [xa, ya] = pol(cx, cy, r1, a0), [xb, yb] = pol(cx, cy, r1, a1);
    const [xc, yc] = pol(cx, cy, r0, a1), [xd, yd] = pol(cx, cy, r0, a0);
    return `M${xa} ${ya} A${r1} ${r1} 0 ${big} 1 ${xb} ${yb} L${xc} ${yc} A${r0} ${r0} 0 ${big} 0 ${xd} ${yd} Z`;
  };
  // 手绘感圆（editorial 系气泡用）：圆周叠两个慢波 + 噪声，seed 定形
  const blob = (x, y, r, seed) => {
    const n = Math.max(14, Math.round(r * 1.6)), pts = [];
    for (let t = 0; t < n; t++) {
      const a = t / n * Math.PI * 2;
      const w = 1 + .055 * Math.sin(a * 2 + seed * 7) + .04 * Math.sin(a * 3 + seed * 13)
              + (rnd(seed + t, 3) - .5) * .03;
      pts.push([x + Math.cos(a) * r * w, y + Math.sin(a) * r * w]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let t = 0; t < n; t++) {
      const p = pts[t], q = pts[(t + 1) % n];
      d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${((p[0]+q[0])/2).toFixed(1)} ${((p[1]+q[1])/2).toFixed(1)}`;
    }
    return d + ' Z';
  };

  /* ── 9 · SVG 快捷 ────────────────────────────────────────── */
  const NS = 'http://www.w3.org/2000/svg';
  const el  = (p, t, a) => { const n = document.createElementNS(NS, t);
    for (const k in a) n.setAttribute(k, a[k]); p.appendChild(n); return n; };
  const txt = (p, a, s) => { const n = el(p, 'text', a); n.textContent = s; return n; };
  const tip = (n, s) => { const t = document.createElementNS(NS, 'title');
    t.textContent = s; n.appendChild(t); };

  /* ── 10 · 统一 reveal：滚入视野才播，点击重播 ──────────────
     带 timer 登记（keep），重播前清干净，防动画叠加。
     PPT 场景下整页往往一进场就可见，threshold .3 依然成立。     */
  const timers = {};
  const keep = (id, t) => { (timers[id] = timers[id] || []).push(t); };
  const obsReveal = (id, fn) => {
    const n = document.getElementById(id);
    if (!n) return;
    const go = () => {
      (timers[id] || []).forEach(clearInterval); timers[id] = [];
      if (n.tagName === 'svg' || n.tagName === 'SVG') n.innerHTML = '';
      fn(n);
    };
    const io = new IntersectionObserver(es => {
      if (es[0].isIntersecting) { go(); io.disconnect(); }
    }, { threshold: .3 });
    io.observe(n);
    n.style.cursor = 'pointer';
    n.addEventListener('click', go);
  };
  // ECharts 版 reveal
  const eReveal = (id, opt) => obsReveal(id, elDom => {
    const g = echarts.getInstanceByDom(elDom) || echarts.init(elDom);
    g.clear(); g.setOption(opt);
  });

  /* ── 11 · 图表卡骨架 CSS（跟随 deck 变量，不写死颜色） ──────
     <div class="chart-card">
       <h2>结论式标题</h2>
       <div class="sub">副标题 · 图例说明 · 时间范围</div>
       <div class="ch" id="xx"></div>  或  <svg id="xx" viewBox="0 0 400 320">
       <div class="src">图型名 · 系列名 · 数据来源（全大写）</div>
     </div>                                                        */
  const CARD_CSS = `
  .chart-card{border-radius:${SHAPE.cardRadius}px;padding:${SHAPE.cardPad};color:inherit}
  .chart-card h2{font-weight:${FONT.title.weight};font-size:${FONT.title.size}px;letter-spacing:${FONT.title.spacing};margin:0 0 4px}
  .chart-card .sub{font-size:${FONT.sub.size}px;opacity:.68;margin-bottom:16px}
  .chart-card .src{font-size:${FONT.src.size}px;opacity:.45;margin-top:12px;letter-spacing:${FONT.src.spacing};font-weight:${FONT.src.weight};text-transform:uppercase}
  .chart-card .ch{height:360px}
  .chart-card svg text{font-family:inherit}
  .chart-card svg [stroke]{stroke-width:max(${PROJECTION.minStroke}px,var(--chart-stroke,${PROJECTION.minStroke}px))}` + MOTION.css;

  global.DECK = {
    // 颜色：全部由 deck 配色推导，没有写死的调色板
    buildLadder, fromCssVars,
    hexToRgb, rgbToHex, rgbToHsl, hslToHex, hexToHsl,
    DEFAULT_STEPS, FALLBACK, VAR_CANDIDATES,
    // 投屏硬下限
    PROJECTION,
    // 结构性 token
    FONT, SHAPE, MOTION, CARD_CSS,
    // 工具
    rnd, pol, sect, blob, el, txt, tip, obsReveal, eReveal, keep,
  };
})(typeof window !== 'undefined' ? window : globalThis);
