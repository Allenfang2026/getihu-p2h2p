/* ═══════════════════════════════════════════════════════════════
   gallery.html 的示例数据与页面装配。

   每种版式一份：真实中文业务数据（资产评估/工程项目语境）+ 与之
   逐字对应的 YAML 展示文本。YAML 只是给人看的书写形态，实际调用
   render 时传的是上面那个已解析的对象——两者内容必须一致，改一处
   要同步改另一处。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 1 · 七种版式的示例数据 ──────────────────────────────── */

  const ITEMS = [
    {
      id: 'pyramid',
      zh: '金字塔',
      en: 'pyramid',
      shape: '层级递进的<b>扁平层数组</b>，从顶到底，上层建立在下层之上。常见 3–6 层。',
      wide: true, fit: 'tall',
      note: '层与层<b>没有父子关系</b>——第 2 层不隶属于第 1 层，只是垫在它下面。'
          + '所以数据是扁平数组，不是树。',
      data: {
        layers: [
          { text: '总体评价结论', note: '成功 / 基本成功 / 部分成功' },
          { text: '准则层', note: '四个维度加权汇总',
            items: ['过程规范性', '目标达成度', '效益可持续性'] },
          { text: '指标层', note: '共 18 项可量化指标',
            items: ['概算执行率', '结算审减率', '产能利用率'] },
          { text: '基础数据层', note: '财务报表 · 施工日志 · 第三方检测报告' },
        ],
      },
      yaml: [
        'layers:                      # 从顶到底',
        '  - text: 总体评价结论',
        '    note: 成功 / 基本成功 / 部分成功',
        '  - text: 准则层',
        '    note: 四个维度加权汇总',
        '    items:                   # 层内要点，扁平一串',
        '      - 过程规范性',
        '      - 目标达成度',
        '      - 效益可持续性',
        '  - text: 指标层',
        '    note: 共 18 项可量化指标',
        '    items: [概算执行率, 结算审减率, 产能利用率]',
        '  - text: 基础数据层',
        '    note: 财务报表 · 施工日志 · 第三方检测报告',
      ].join('\n'),
    },

    {
      id: 'concentric',
      zh: '同心圆',
      en: 'concentric',
      shape: '从内到外的<b>包含关系</b>，扁平数组，第 0 项是圆心。层与层无高低之分，只有内外。常见 3–5 环。',
      wide: true, fit: 'tall',
      note: '文字一律<b>水平排在环带 12 点方向</b>，不沿弧排——沿弧排中文会逐字歪，'
          + '截图转 PPT 时还可能整块丢字。这是有意取舍。',
      data: {
        rings: [
          { text: '注册资产评估师团队', note: '核心执业资格' },
          { text: '评估方法与作业规范' },
          { text: '行业数据库与案例积累', note: '近五年 1200 余单' },
          { text: '客户与监管信任关系' },
        ],
      },
      yaml: [
        'rings:                       # 从内到外，第 0 项是圆心',
        '  - text: 注册资产评估师团队',
        '    note: 核心执业资格',
        '  - text: 评估方法与作业规范',
        '  - text: 行业数据库与案例积累',
        '    note: 近五年 1200 余单',
        '  - text: 客户与监管信任关系',
      ].join('\n'),
    },

    {
      id: 'fishbone',
      zh: '鱼骨图',
      en: 'fishbone',
      shape: '<b>单一结果 + 多类原因</b>。主干指向右端的结果，斜刺是大类原因，小刺是具体原因。常见 4–6 根大刺。',
      note: '上下分配按子项数<b>贪心平衡</b>，不是奇偶轮流——所以哪根刺在上面由数据决定，'
          + '指定不了。小刺是裸文字无底色，每根控制在 5 条以内。',
      wide: true,
      data: {
        spine: '概算执行率偏离超过 15%',
        bones: [
          { text: '设计变更', causes: ['地质条件与勘察不符', '功能需求中途追加', '规范升级'] },
          { text: '材料价格', causes: ['钢材市场波动', '运距超出预估'] },
          { text: '工期管理', causes: ['征拆滞后', '雨季停工超预期'] },
          { text: '合同与计量', causes: ['清单漏项', '计量口径分歧'] },
        ],
      },
      yaml: [
        'spine: 概算执行率偏离超过 15%    # 结果，画在最右端',
        'bones:                         # 大类原因',
        '  - text: 设计变更',
        '    causes: [地质条件与勘察不符, 功能需求中途追加, 规范升级]',
        '  - text: 材料价格',
        '    causes: [钢材市场波动, 运距超出预估]',
        '  - text: 工期管理',
        '    causes: [征拆滞后, 雨季停工超预期]',
        '  - text: 合同与计量',
        '    causes: [清单漏项, 计量口径分歧]',
      ].join('\n'),
    },

    {
      id: 'flow',
      zh: '流程图',
      en: 'flow',
      shape: '<b>有先后顺序的步骤</b>序列，只有一个维度：时间/顺序。可编号，可给某步挂分支说明。',
      note: '超过 5 步自动折成<b>蛇形</b>多行，偶数行从右往左读（省掉横穿整图的回扫线，'
          + '方向靠箭头标明）。步骤盒统一等宽等高。',
      wide: true,
      data: {
        numbered: true,
        steps: [
          { text: '立项与资料清单', note: '明确评价范围与口径' },
          { text: '现场踏勘与访谈' },
          { text: '数据核对与指标测算', branch: '数据缺口回补，超三次出具受限说明' },
          { text: '成功度打分', note: '四维度加权' },
          { text: '出具报告并送审', branch: '评审意见逐条回应后定稿' },
        ],
      },
      yaml: [
        'numbered: true               # 步骤盒标序号',
        'steps:',
        '  - text: 立项与资料清单',
        '    note: 明确评价范围与口径',
        '  - text: 现场踏勘与访谈',
        '  - text: 数据核对与指标测算',
        '    branch: 数据缺口回补，超三次出具受限说明   # 虚线分支框',
        '  - text: 成功度打分',
        '    note: 四维度加权',
        '  - text: 出具报告并送审',
        '    branch: 评审意见逐条回应后定稿',
      ].join('\n'),
    },

    {
      id: 'grouped',
      zh: '逻辑分组图',
      en: 'grouped',
      shape: '<b>并列的若干组</b>，每组带若干要点，组与组之间无层级。咨询报告正文页的标准版式。',
      note: '所有组<b>等宽等高</b>，内容量悬殊时短组底部留大片白——"留白比参差好"是有意取舍。'
          + '<code>flow: true</code> 的组间箭头只在同一行内画，跨行不画。',
      wide: true,
      data: {
        flow: true,
        groups: [
          { title: '前期准备', note: '进场前完成', items: [
            { text: '尽职调查', note: '产权、合规、财务三线并行' },
            { text: '评估方案设计' },
            { text: '作业组人员配置' },
          ]},
          { title: '现场作业', items: [
            { text: '资产盘点与核实' },
            { text: '权属文件收集', note: '含权证瑕疵清单' },
            { text: '市场询价与比对' },
          ]},
          { title: '成果交付', items: [
            { text: '评估报告编制' },
            { text: '内部三级复核' },
            { text: '送审答疑与归档' },
          ]},
        ],
      },
      yaml: [
        'flow: true                   # 组间加箭头；省略则纯并列',
        'groups:',
        '  - title: 前期准备',
        '    note: 进场前完成',
        '    items:',
        '      - text: 尽职调查',
        '        note: 产权、合规、财务三线并行',
        '      - text: 评估方案设计',
        '      - text: 作业组人员配置',
        '  - title: 现场作业',
        '    items:',
        '      - text: 资产盘点与核实',
        '      - text: 权属文件收集',
        '        note: 含权证瑕疵清单',
        '      - text: 市场询价与比对',
        '  - title: 成果交付',
        '    items: [评估报告编制, 内部三级复核, 送审答疑与归档]',
      ].join('\n'),
    },

    {
      id: 'radial',
      zh: '放射思维导图',
      en: 'radial',
      shape: '<b>嵌套树</b>。根在画布中心，分支向四周辐射。适合一个主题发散出若干并列方向。',
      note: '与左右树<b>吃同一份数据</b>，可以直接换版式，颜色不变。'
          + '角度排布靠迭代扩半径收敛，取的是"紧凑度换零穿透"——宁可散开也不让连线穿过节点。',
      wide: true,
      data: {
        root: {
          text: '评估机构能力地图',
          children: [
            { text: '专业资质', children: ['注册评估师', '证券期货资格'] },
            { text: '方法体系', note: '三法并用', children: ['市场法', '收益法', '成本法'] },
            { text: '行业积累', emphasis: true, children: ['案例数据库', '同业对标口径'] },
            { text: '质量控制', children: ['三级复核', '风险预警'] },
          ],
        },
      },
      yaml: [
        'root:',
        '  text: 评估机构能力地图',
        '  children:',
        '    - text: 专业资质',
        '      children: [注册评估师, 证券期货资格]',
        '    - text: 方法体系',
        '      note: 三法并用',
        '      children: [市场法, 收益法, 成本法]',
        '    - text: 行业积累',
        '      emphasis: true          # 字重加一档',
        '      children: [案例数据库, 同业对标口径]',
        '    - text: 质量控制',
        '      children: [三级复核, 风险预警]',
      ].join('\n'),
    },

    {
      id: 'bilateral',
      zh: '左右分栏树',
      en: 'bilateral',
      shape: '<b>嵌套树</b>，与放射图同一份数据格式。根居中，分支分左右两侧展开。分支多、层深时最省地方。',
      fit: 'flat',
      note: '左右分组按<b>叶子数贪心平衡</b>，不是按分支个数对半——哪个分支落在左边由数据决定，'
          + '指定不了。返回值的 <code>balance</code> 字段可查两侧叶子数差。',
      wide: true,
      data: {
        root: {
          text: '资产评估投后评价体系',
          children: [
            { text: '股权类', children: [
              { text: '经营与财务复核', children: ['营收与利润率', '同业对标偏离度'] },
              { text: '估值复核', children: ['市盈率法'] },
              { text: '退出路径可行性' },
            ]},
            { text: '工程建设类', note: '市政 · 建筑 · 环保改造', children: [
              { text: '投资控制', children: ['概算执行率', '结算审减率'] },
              { text: '进度偏差' },
              { text: '运营期产能利用率' },
            ]},
            { text: '成功度打分', emphasis: true, children: ['四维度权重', '评委质询归档'] },
            { text: '风险评价', children: ['市场风险敞口', '周期敏感性'] },
          ],
        },
      },
      yaml: [
        'root:',
        '  text: 资产评估投后评价体系',
        '  children:',
        '    - text: 股权类',
        '      children:',
        '        - text: 经营与财务复核',
        '          children: [营收与利润率, 同业对标偏离度]',
        '        - text: 估值复核',
        '          children: [市盈率法]',
        '        - text: 退出路径可行性',
        '    - text: 工程建设类',
        '      note: 市政 · 建筑 · 环保改造',
        '      children:',
        '        - text: 投资控制',
        '          children: [概算执行率, 结算审减率]',
        '        - text: 进度偏差',
        '        - text: 运营期产能利用率',
        '    - text: 成功度打分',
        '      emphasis: true',
        '      children: [四维度权重, 评委质询归档]',
        '    - text: 风险评价',
        '      children: [市场风险敞口, 周期敏感性]',
      ].join('\n'),
    },
  ];

  /* ── 2 · 三套配色 ────────────────────────────────────────── */

  const THEMES = [
    { cls: 't-warm', name: '浅色暖橙 · 衬线',  dots: ['#B4522A', '#FBF6EE', '#2A1C12'] },
    { cls: 't-cool', name: '深色冷蓝 · 无衬线', dots: ['#5AA9E6', '#101826', '#E6EDF7'] },
    { cls: 't-grey', name: '中性灰 · 无衬线',   dots: ['#4A4A48', '#FFFFFF', '#1B1B19'] },
  ];

  /* ── 3 · 装配 DOM ───────────────────────────────────────── */

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function buildItems() {
    const host = document.getElementById('items');
    ITEMS.forEach((it, i) => {
      const sec = document.createElement('section');
      sec.className = 'item';
      sec.innerHTML =
        '<div class="item-head">'
        + '<span class="idx">D' + (i + 1) + '</span>'
        + '<h2>' + esc(it.zh) + '</h2>'
        + '<span class="en">' + esc(it.en) + '.js</span>'
        + '</div>'
        + '<p class="shape">' + it.shape + '</p>'
        + '<div class="pair' + (it.wide ? ' stack' : '') + '">'
        +   '<div class="diagram-card' + (it.fit ? ' ' + it.fit : '') + '" id="card-' + it.id + '">'
        +     '<svg id="svg-' + it.id + '"></svg>'
        +   '</div>'
        +   '<div class="data">'
        +     '<div class="cap">这份数据</div>'
        +     '<pre><code>' + esc(it.yaml) + '</code></pre>'
        +   '</div>'
        + '</div>'
        + '<p class="note">' + it.note + '</p>';
      host.appendChild(sec);
    });
  }

  function buildSwitcher() {
    const host = document.getElementById('themes');
    THEMES.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.cls = t.cls;
      b.setAttribute('aria-pressed', document.body.classList.contains(t.cls) ? 'true' : 'false');
      b.innerHTML = '<span class="dots">'
        + t.dots.map(c => '<i style="background:' + c + '"></i>').join('')
        + '</span>' + esc(t.name);
      b.addEventListener('click', () => applyTheme(t.cls));
      host.appendChild(b);
    });
  }

  let rendering = false;

  async function applyTheme(cls) {
    THEMES.forEach(t => document.body.classList.remove(t.cls));
    document.body.classList.add(cls);
    document.querySelectorAll('#themes button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.cls === cls ? 'true' : 'false');
    });
    await renderAll();
  }

  /* 全量重渲染。配色不是改 CSS 就能生效的——节点填充色是 render 时
     从 scope 元素上读 CSS 变量算出来写进 SVG 属性的，所以换主题必须
     重跑一遍 render。这正是"跟着模板变"的实现方式。              */
  async function renderAll() {
    if (rendering) return;
    rendering = true;
    const hint = document.getElementById('hint');
    hint.textContent = '渲染中…';

    const report = [];
    for (const it of ITEMS) {
      const svg = document.getElementById('svg-' + it.id);
      const card = document.getElementById('card-' + it.id);
      const lay = window.DIAGRAM_LAYOUTS && window.DIAGRAM_LAYOUTS[it.id];
      if (!svg || !card || !lay) { report.push(it.id + ' 缺失'); continue; }
      try {
        const res = await lay.render(svg, it.data, { scope: card });
        if (res && res.projection && res.projection.fixed) {
          report.push(it.zh + ' 投屏修正 ' + res.projection.fixed);
        }
      } catch (e) {
        report.push(it.zh + ' 渲染失败：' + e.message);
        console.error('[gallery] ' + it.id, e);
      }
    }

    hint.textContent = report.length
      ? report.join(' · ')
      : '七种版式已渲染 · 投屏硬闸零修正';
    document.body.dataset.ready = '1';
    rendering = false;
  }

  /* ── 4 · 启动 ───────────────────────────────────────────── */

  buildItems();
  buildSwitcher();
  renderAll();

  // 供自检脚本调用：等所有图渲染完
  window.__galleryReady = () => document.body.dataset.ready === '1';
  window.__setTheme = applyTheme;
})();
