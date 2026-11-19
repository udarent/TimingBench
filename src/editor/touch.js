// 编辑器 UI 外壳：全局顶栏、上下文操作条、字符停靠条、轻提示。
// 四场景共用同一份代码 —— 桌面与触摸的差别只在 CSS 决定摆哪、多大。
// 本模块不产生新的编辑命令 —— 所有按钮复用 interactions.js 暴露的同一组动作。
import { TOUCH } from './mode.js';
import * as Cap from './cap.js';
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { chipGlyph, chipDesc } from './waveform.js';
import { esc } from '../core/util.js';

export function attachTouchUI(ctx, dom) {
  var topbar = dom.topbar, panel = dom.tbpanel, toast = dom.toast;
  var dock = dom.chardock;
  // 不再因为「没有底部操作栏 / 上下文条容器」整块退出：字符停靠条（dock）在桌面
  // 与验收页里也要工作，缺哪个节点就跳过哪部分（下面各函数自带空值保护）。
  var state = ctx.state;
  var toastTimer = null;

  function say(t) {
    if (!toast) return;
    toast.textContent = String(t);
    // 轻提示钉在视口底部，而触摸端的字符停靠条也在那儿 —— 不算出停靠区高度，
    // 拦截类提示会正好盖在最常用的那排字符上（1.9 秒，正好是用户要接着点的那一刻）。
    var dz = document.getElementById('dockzone');
    toast.style.setProperty('--toast-lift', ((dz && dz.offsetHeight) || 0) + 'px');
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1900);
  }
  ctx.say = say;

  // ---- 全局顶栏 -----------------------------------------------------------
  // 撤销 / 重做改的是源码历史，分屏方向改的是页面版式，生成嵌入代码读的是当前源码 ——
  // 三者都与「画布内容」无关，所以不该只画在波形区里（左右分栏时尤其明显）。
  // 连线开关也放这里：它只是切换画布的输入语义，按钮本身不需要贴着波形。
  // 画布内因此不再画 HUD，sticky 顶栏的 translate 补偿（旧 syncPinned）一并消失。
  var TOP_META = {
    undo:   { txt: '↶', name: 'Undo (Ctrl+Z)' },
    redo:   { txt: '↷', name: 'Redo (Ctrl+Y)' },
    layout: { txt: '⇄', name: 'Split direction' },
    embed:  { txt: '<>', name: 'Embed code' }
  };
  // 视图只剩两态：波形 / 波形+代码（0.25.0 撤掉「只代码」——没有对应的使用场景）。
  // 一个切换键，图标固定是 { }：**灰 = 代码区关着，亮 = 代码区开着**。
  // 换图标表示状态（▬/◫、方波/分栏）都试过：16px 下细节认不出，而且两个图标来回换
  // 会让人以为按钮本身也换了。同一个符号只变颜色，状态一眼就懂。
  var VIEW_TXT = '{ }';                    // 符号固定，状态只靠颜色
  var VIEW_NAME = {
    diagram: 'Code hidden — click to show code',
    both:    'Code shown — click to hide code'
  };
  var topKey = '';
  function renderTopbar() {
    if (!topbar) return;
    var cmds = Cap.hudCmds(Cap.sceneOf(state));
    var cols = ctx.currentLayout ? ctx.currentLayout() === 'cols' : true;
    var view = ctx.currentView ? ctx.currentView() : 'both';
    // 只在「按钮集合 / 可用态 / 模式 / 视图」变化时重建，避免每次 redraw 都闪一下
    var key = cmds.join(',') + '|' + state.undo.length + '|' + state.redo.length + '|' +
      (cols ? 'C' : 'R') + '|' + (state.readonly ? 'R' : '-') + '|' + view;
    if (key === topKey && topbar.childNodes.length) return;
    topKey = key;
    topbar.textContent = '';
    cmds.forEach(function (c) {
      // view 是一个切换键（不是分段控件）：图标显示当前视图，点一下切到另一边。
      if (c === 'view') {
        var vname = VIEW_NAME[view] || VIEW_NAME.both;
        var vb = document.createElement('button');
        vb.type = 'button';
        vb.className = 'hudBtn viewBtn' + (view === 'both' ? ' sel' : '');
        vb.setAttribute('data-cmd', 'view:toggle');
        vb.setAttribute('aria-pressed', view === 'both' ? 'true' : 'false');
        vb.title = vname;
        vb.setAttribute('aria-label', vname);
        vb.textContent = VIEW_TXT;
        topbar.appendChild(vb);
        return;
      }
      var m = TOP_META[c];
      if (!m) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hudBtn';
      b.setAttribute('data-cmd', c);
      var name = m.name;
      if (c === 'layout') {
        name = cols ? 'Code left / diagram right — click for stacked'
                    : 'Stacked — click for code left / diagram right';
      }
      b.textContent = c === 'layout' ? (cols ? '⇄' : '⇅') : m.txt;
      b.title = name;
      b.setAttribute('aria-label', name);
      var dim = (c === 'undo' && !state.undo.length) || (c === 'redo' && !state.redo.length);
      if (dim) { b.disabled = true; b.classList.add('dim'); }
      topbar.appendChild(b);
    });
  }
  if (topbar) topbar.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-cmd]') : null;
    if (!b || b.disabled) return;
    ctx.doCmd(b.getAttribute('data-cmd'));
  });

  // 桌面把反馈藏在 title 里；触摸端没有 hover，改成一次性轻提示。
  // 阻止类提示也走轻提示 —— 源码区红点在时序图标签页里根本看不见，
  // 只留红环会「有反馈但不知道原因」，所以红环是主反馈、这行英文是兜底。
  var baseNotify = ctx.notify;
  ctx.notify = function (t, bad, el) {
    baseNotify(t, bad, el);
    if (t) say(t);
  };


  // 上下文图标条：没有「对象 / 列」两个文字面板，也没有 18 个文字按钮。
  // 选中格子 → 字符条（画在 SVG 里）；选中行 → 行动作；选中列 → 列动作。
  // 图标尽量画成「被操作对象的缩略图」（方波 / 色块 / 节点圆点 …），
  // 概念符号（相位、周期）保留社区惯用的 φ / T。辨识兜底是「长按出名称」。
  // 图标重设计（0.9.17）：此前 label / node 用「空心方框 + 小符号」，方框被描边后像「没加载
  // 出来的空框」，用户误以为是显示 bug。改为清晰的实物化图形：标签=带孔的吊牌、节点=带实心
  // 点的环、连线=两个节点加连线。其余图标也统一成「描边线条 + 必要处实心」的清晰风格。
  var ICONS = {
    name:   '<path d="M5 7h14M5 12h11M5 17h13"/>',
    wave:   '<path d="M3 15h3v-6h4v6h4V9h4v6h3"/>',
    data:   '<rect x="4" y="8" width="16" height="8" rx="1"/><path d="M10 8v8M14 8v8"/>',
    nodeStr:'<path d="M3 12h6M15 12h6"/><circle cx="12" cy="12" r="3.2"/>',
    phase:  '<text x="12" y="17.5" text-anchor="middle" font-size="16" font-family="Georgia,serif" fill="currentColor" stroke="none">φ</text>',
    period: '<path d="M4 12h16"/><path d="M7.5 8.5L4 12l3.5 3.5M16.5 8.5L20 12l-3.5 3.5"/>',
    up:     '<path d="M12 19V6M7 11l5-5 5 5"/>',
    down:   '<path d="M12 5v13M7 13l5 5 5-5"/>',
    add:    '<path d="M12 5v14M5 12h14"/>',
    spacer: '<path d="M4 9h16M4 15h16"/>',
    del:    '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>',
    // 格级：标签=带孔的吊牌（清晰可辨的「标注」意象），节点=带实心点的环（锚点标记）。
    // 与行级的 data / nodeStr（整行）刻意画得不同，免得两个图标看着一样却差一个量级。
    label:  '<path d="M4 7h9l7 7-7 7H4z"/><circle cx="8.5" cy="11.5" r="1.5"/>',
    node:   '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>',
    insert: '<path d="M8.5 5v14M15.5 5v14"/><path d="M12 9.5v5M9.5 12h5"/>',
    delCol: '<path d="M9 5v14"/><path d="M15 9l4.5 6M20 9l-4.5 6"/>',
    gap:    '<path d="M12 5v14" stroke-dasharray="2.4 2.4"/>',
    append: '<path d="M9 5v14"/><path d="M14 12h6.5M17.25 8.75v6.5"/>',
    // 分组三件套：花括号 + 行线 / 范围向外推一行的箭头（画成「范围在长」而不是「行在动」）
    group:  '<path d="M8 4c-2.2 0-3 1-3 3v10c0 2 .8 3 3 3"/><path d="M12 8h8M12 12h8M12 16h8"/>',
    spanUp: '<path d="M4 20h16"/><path d="M12 16V7M8 11l4-4 4 4"/>',
    spanDown:'<path d="M4 4h16"/><path d="M12 8v9M8 13l4 4 4-4"/>',
    link:   '<circle cx="6.5" cy="12" r="2.6"/><circle cx="17.5" cy="12" r="2.6"/><path d="M9.1 12h5.8"/>'
  };
  var ICON_KEY = { delete: 'delCol' };
  // 24 单位线性图标的拼装只写一处：格级动作与行/列动作共用同一批路径，
  // 各写一份就等于同一图标有两处可能漂移的字符串。
  function iconSvg(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[ICON_KEY[name] || name] || '') + '</svg>';
  }
  var NAMES = {
    name: 'signal name', wave: 'row wave', data: 'row data', nodeStr: 'row node',
    label: 'cell data label', node: 'cell node marker',
    phase: 'phase', period: 'period', up: 'move up', down: 'move down', add: 'add row',
    spacer: 'add spacer', del: 'delete row',
    insert: 'insert cycle', delete: 'delete cycle', gap: 'phase line', append: 'append cycle',
    group: 'group rows', spanUp: 'extend row range up', spanDown: 'extend row range down',
    link: 'connect two nodes (wire)'
  };
  // 动作清单来自 cap.js 的 ACTS —— 与桌面行工具 / 列操作是同一份，避免「面板里少一个
  // 动作」与「图元里多一个按钮」各说各话。图标与英文名留在本文件（只有触摸端用得上）。
  var ROW_ACTS = Cap.ACTS.row;
  var COL_ACTS = Cap.ACTS.col;
  // 停靠条左侧那三个格级动作（label / node / link）—— 0.18.0 从上下文条挪过来
  var DOCK_ACTS = Cap.ACTS.dock;

  function needCell() {
    if (state.selCell && state.ir) return state.selCell;
    say('Select a wave cell first'); return null;
  }
  function needLane() {
    if (state.selLane && state.ir) return state.selLane;
    say('Select a signal row first'); return null;
  }
  function needCol() {
    if (state.ir && state.sel !== null && state.sel !== undefined) return state.sel;
    say('Select a column first'); return null;
  }

  function doAct(k) {
    var c, l, n;
    switch (k) {
      case 'char':   c = needCell(); if (c) ctx.openCellCharEditor(c.lane, c.tick); return;
      case 'label':  c = needCell(); if (c) ctx.openLabelEditor(c.lane, c.tick); return;
      case 'node':   c = needCell(); if (c) ctx.openNodeEditor(c.lane, c.tick, ''); return;
      case 'link':   ctx.doCmd('link'); return;
      case 'name':   l = needLane(); if (l) ctx.openInlineFor({ nameLane: l }); return;
      // phase 走图形化的相位尺（连续量，拖动比敲数字快得多）；其余仍是文本输入
      case 'phase':
        l = needLane();
        if (l && ctx.openPhaseEdit) ctx.openPhaseEdit(l);
        return;
      case 'wave': case 'data': case 'nodeStr': case 'period':
        l = needLane();
        if (l) ctx.openRowEditor(l, { wave: 'wave', data: 'data', nodeStr: 'node', period: 'period' }[k]);
        return;
      case 'up': case 'down':
        l = needLane();
        if (l) ctx.commit({ t: 'moveLane', lane: l, v: k }, k === 'up' ? 'move row up' : 'move row down');
        return;
      case 'add': case 'spacer': case 'del':
        l = needLane(); if (l) ctx.handleTool(k, l); return;
      // 分组：group 打开组名输入（作用于当前行范围），spanUp / spanDown 把范围向外推一行
      case 'group':
        if (!needLane()) return;
        if (ctx.openGroupEditor) ctx.openGroupEditor();
        return;
      case 'spanUp': case 'spanDown':
        if (!needLane()) return;
        if (ctx.extendSpan) ctx.extendSpan(k === 'spanUp' ? -1 : 1);
        return;
      case 'insert': case 'delete': case 'gap':
        c = needCol(); if (c === null) return;
        n = state.ir.ticks;
        if (c >= n && k !== 'insert') { say('The trailing column can only append'); return; }
        ctx.handleColAct(k, c); return;
      case 'append':
        if (!state.ir) { say('Canvas not ready'); return; }
        ctx.handleColAct('insert', state.ir.ticks); return;
    }
  }

  // 长按 480ms 出名称：触摸端没有 hover，这是 title 的等价物，
  // 也是「零常驻文字」下的辨识兜底。移动超过 12px 视为滚动，取消。
  function bindLongName(root) {
    if (!TOUCH) return;                              // 桌面用 title / aria-label，不做长按提示
    var els = root.querySelectorAll('[data-name]');
    for (var i = 0; i < els.length; i++) (function (el) {
      var t = null, x0 = 0, y0 = 0;
      function cancel() { if (t) { clearTimeout(t); t = null; } }
      el.addEventListener('pointerdown', function (e) {
        cancel(); x0 = e.clientX; y0 = e.clientY;
        t = setTimeout(function () { t = null; say(el.getAttribute('data-name')); }, 480);
      });
      el.addEventListener('pointermove', function (e) {
        if (t && (Math.abs(e.clientX - x0) > 12 || Math.abs(e.clientY - y0) > 12)) cancel();
      });
      el.addEventListener('pointerup', cancel);
      el.addEventListener('pointercancel', cancel);
      el.addEventListener('pointerleave', cancel);
    })(els[i]);
  }

  var ctxKind = null, ctxKey = null, ctxActKey = '';
  // 打开面板那一刻的滚动位置（见 renderContext 末尾）：用于把「布局抖动引发的 scroll」
  // 与「用户真的想滑动」区分开。
  var ctxScroll = null;
  // 程序化滚动（revealLane）刚设过的目标位置；scroll 事件里据此区分「自己滚的」与「用户滚的」。
  var selfScrollTop = null;
  // CSS 据此把退出按钮抬到面板上方，谁也不压谁。
  function hideContext() {
    // 清理是幂等的，不再用 `ctxKind === null` 早退：面板可能已被别的路径清空而 key 未变。
    ctxKind = null; ctxKey = null; ctxActKey = '';
    panel.classList.remove('open');
    panel.textContent = '';
  }
  // 上下文条内容跟着「最后选中的对象」走：格子 → 格级动作，列 → 列动作，行 → 行动作。
  // ---- 动作可用性（0.19.0）--------------------------------------------------
  // 「把按钮画出来」和「点它有用」是两件事。以前一律画全部动作，点了才发现「这格不是数据块」
  // 「空行没有这些字段」—— 等于让用户先撞一次墙才知道不行。现在按当前对象**过滤**：不可用的不画。
  // 判据只收「点了必然无效」的那几种，不猜「可能无效」的，否则按钮会随状态跳来跳去。
  function laneById(id) {
    if (!state.ir || !id) return null;
    for (var i = 0; i < state.ir.lanes.length; i++) {
      if (state.ir.lanes[i].id === id) return state.ir.lanes[i];
    }
    return null;
  }
  // 格子级：label 只对**总线格**有意义（普通电平格没有标签可写，`openLabelEditor` 就是这么守的）；
  // node 只在本行字符范围内有位置（比 slots 还长的「续写格」写不进 node 数组）；
  // link 任何 signal 格都能起手（没有锚点字符时 `handleAnchor` 会自动分配一个字母）。
  function availCell(act) {
    var sc = state.selCell;
    if (!sc) return false;
    var l = laneById(sc.lane);
    if (!l || l.kind !== 'signal') return false;
    if (act === 'link') return true;
    if (act === 'node') return sc.tick < l.slots.length;
    if (act === 'label') {
      var sl = l.slots[sc.tick];
      return !!sl && !!sl.point && !sl.gap && Core.BUS.test(sl.w);
    }
    return false;
  }
  // 行级：空行（spacer）没有 name / wave / data / node / phase / period 这些字段 —— 改它等于
  // 把它变成信号行，不是「编辑这一行的值」；首行不能上移、末行不能下移（IR 里是静默无效）。
  function availRow(act) {
    var l = laneById(state.selLane);
    if (!l || !state.ir) return false;
    var li = state.ir.lanes.indexOf(l), n = state.ir.lanes.length;
    var isSp = l.kind === 'spacer';
    switch (act) {
      case 'name': case 'wave': case 'data': case 'nodeStr': case 'phase': case 'period':
        return !isSp;
      case 'link':
        return !isSp;                       // 连线要落到具体格子上，空行没有格子
      case 'up':
        return li > 0;
      case 'down':
        return li >= 0 && li < n - 1;
      default:
        return true;                        // add / spacer / del / group / spanUp / spanDown
    }
  }
  // 列级：末尾那个「幽灵列」只承担追加周期 —— 删除与相位线在它上面没有意义
  // （doAct 里本来就拦着，现在连按钮也不画）。
  function availCol(act) {
    var c = state.sel;
    if (c === null || c === undefined || !state.ir) return false;
    if (act === 'insert' || act === 'append' || act === 'link') return true;
    return c < state.ir.ticks;
  }

  // 一个上下文动作按钮：三级共用，保证图标 / 语义完全一致。
  function makeCtxBtn(k) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctxbtn';
    b.setAttribute('data-act', k);
    b.setAttribute('data-name', NAMES[k] || k);
    b.setAttribute('aria-label', NAMES[k] || k);
    // 这些按钮只有图标、没有文字，桌面端 mouse 用户能拿到的唯一线索就是 title。
    b.title = NAMES[k] || k;
    if (k === 'link') b.setAttribute('aria-pressed', String(!!state.linkMode));
    b.innerHTML = iconSvg(k);
    return b;
  }

  // 三级共用同一个容器与同一段渲染代码，差别只是喂进去的动作清单。
  // 0.26.0：**不再折叠**。以前按可用宽度切片、放不下的收进「⋯」，多一次点击还多一层；
  // 现在把当前可用的动作一次全画出来，宽度不够就由 CSS 换行、让停靠区多占一行
  // （画布随 flex 自然让位，按钮永远不会盖在波形上）。
  function renderContext() {
    if (!panel) return;                           // 不跑编辑器的页面（如验收页）没有上下文条容器
    if (ctx.inlineCtx) { hideContext(); return; }
    var kind = null, acts = null, key = null, laneOf = null;
    // 格级动作（label / node / link）已搬到字符停靠条的左侧（0.18.0）—— 选中格子时
    // 上下文条**整条收起**，不再和停靠条各占一行。
    // 必须显式 return：选格时 selLane 往往也被设着，漏掉这一句就会落到下面的行分组上，
    // 表现为「点格子却弹出 15 个行动作」。
    if (state.selCell && state.ir) { hideContext(); return; }
    if (state.sel !== null && state.sel !== undefined) { kind = 'col'; acts = COL_ACTS.filter(availCol); key = state.sel; }
    else if (state.selLane) { kind = 'row'; acts = ROW_ACTS.filter(availRow); key = state.selLane; laneOf = state.selLane; }
    if (!kind) { hideContext(); return; }
    // 同一对象不重绘（避免连点闪烁）—— 但必须确认面板**当前真的是开着的**：
    // 面板可能被 hideContext 清空过而 key 未变（清空路径不止一条），此时若只看 key
    // 就会跳过重建，表现为「点了行、面板却空着」。
    // 可用集进 key：改了字符会让 label 由隐藏变可用，必须重建。
    var actKey = acts.join(',') + '|' + (state.linkMode ? 'L' : '-');
    if (ctxKind === kind && ctxKey === key && ctxActKey === actKey &&
        panel.classList.contains('open') && panel.childNodes.length) return;
    ctxKind = kind; ctxKey = key; ctxActKey = actKey;
    panel.textContent = '';
    acts.forEach(function (k) { panel.appendChild(makeCtxBtn(k)); });
    panel.classList.add('open');
    bindLongName(panel);
    // 记下「打开面板这一刻的滚动位置」：重绘会换掉 SVG，内容尺寸变化可能让浏览器把
    // scrollTop 夹回去并派发 scroll —— 那不是用户想滑动，不能拿它收面板（否则刚弹就消失）。
    ctxScroll = ctx.wrap ? { left: ctx.wrap.scrollLeft, top: ctx.wrap.scrollTop } : null;
    // 面板贴在卡片底部、会盖住波形下沿：把选中的那一行滚到面板上方，别让人盲目点按钮。
    // 这次滚动是程序自己发起的，要记下目标位置 —— 否则紧随其后的 scroll 事件会被
    // 当成「用户想看更多」，把刚打开的面板立刻收掉（选中靠下的行时表现为面板一闪就没）。
    if (laneOf !== null && ctx.revealLane && TOUCH) {
      var top0 = ctx.wrap ? ctx.wrap.scrollTop : 0;
      ctx.revealLane(laneOf);
      // 只有真的滚动了才记；横纵两个方向都要记 —— 用户随后横向滑动画布时 scrollTop 不变，
      // 只比 scrollTop 会把手势误判成「程序自己滚的」而放过，面板就再也收不起来了。
      selfScrollTop = ctx.wrap && ctx.wrap.scrollTop !== top0
        ? { left: ctx.wrap.scrollLeft, top: ctx.wrap.scrollTop } : null;
    }
  }
  function onCtxClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    // 不收起面板：多个动作常需连点（如连按上移），重绘后 renderContext 会按新状态更新。
    doAct(b.getAttribute('data-act'));
  }
  if (panel) panel.addEventListener('click', onCtxClick);


  // ---- 字符停靠条 ---------------------------------------------------------
  // 触摸端不再把 23 个字符画进 SVG 里（那条东西会钉在画布底部、随着滚动被反复 transform，
  // 在矮框里几乎盖掉整张波形，手指一动它跟着变 —— 也就是「按钮在浮动」）。
  // 改成停在波形区底部的 HTML 条：不随画布滚动、命中区 44px 起。
  // 0.26.0：**取消折叠**，23 颗按常用度排序一次全铺出来，窄屏由 CSS 换行成多排。
  var QUICK = ['0', '1', 'x', 'z'];
  var dockKey = null;

  // 收起停靠条。写成幂等函数而不是「判 dockKey 有没有值」——
  // closeCharDock 会主动把 dockKey 置 null，用 dockKey 当开关会让清理条件失效，
  // 表现为「Esc 清掉了选中，底部字符条还挂着 6 个按钮」。
  function hideDock() {
    // 无条件清空：一旦 renderDock 半途失败（或从别的场景切进来），靠状态早退会留下一排
    // 点不动的按钮。清空是幂等的，代价只是一次 innerHTML 赋值。
    dockKey = null;
    if (dock) { dock.textContent = ''; dock.classList.remove('open'); }
  }

  function chipButton(v) {
    return '<svg viewBox="0 0 ' + G.CHIP_W + ' ' + G.CHIP_H + '" aria-hidden="true">' + chipGlyph(v) + '</svg>' +
      '<span>' + esc(v) + '</span>';
  }
  function makeChip(v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chipbtn' + (state.ch === v ? ' on' : '');
    b.setAttribute('data-ch', v);
    var name = v + ' — ' + chipDesc(v);
    b.setAttribute('data-name', name);
    b.setAttribute('aria-label', 'Write ' + name);
    b.innerHTML = chipButton(v);
    return b;
  }
  // 停靠条左侧那三个格级动作的按钮：尺寸复用 .chipbtn，图标走上下文条同一套 ICONS。
  function makeActBtn(act) {
    var pressed = act === 'link' && !!state.linkMode;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chipbtn act' + (pressed ? ' on' : '');
    b.setAttribute('data-cellact', act);
    b.setAttribute('data-name', NAMES[act] || act);
    b.setAttribute('aria-label', NAMES[act] || act);
    b.title = NAMES[act] || act;
    if (act === 'link') b.setAttribute('aria-pressed', String(!!state.linkMode));
    b.innerHTML = iconSvg(act);
    return b;
  }
  function renderDock() {
    if (!dock) return;
    // 0.18.0：连线模式**也要显示**。左侧那个 link 按钮是退出连线模式的唯一入口 ——
    // 原来这里带 `!state.linkMode`，而 link 按钮又在 dock 里，进去之后整条 dock 隐藏，
    // 按钮就再也点不到了（纯死锁）。
    var visible = !state.readonly && !!state.selCell && !ctx.inlineCtx;
    if (!visible) { hideDock(); return; }
    // 0.26.0：**不折叠**。23 颗按常用度排序一次全画出来，宽度不够就让 CSS 换行 ——
    // 停靠区多占一行、画布顺势让位，永远不会有按钮被藏进「⋯」里等第二次点击。
    var acts = DOCK_ACTS.filter(availCell);
    var charsOn = !state.linkMode;
    var order = QUICK.concat(Core.ALL.filter(function (v) { return QUICK.indexOf(v) < 0; }));
    if (state.ch && order.indexOf(state.ch) < 0) order.unshift(state.ch); // 当前字符永远可见
    // 可用集与字符序都要进 key：同一格把 0 改成 = 之后 label 由不可用变可用，必须重建；
    // 字符序虽固定，但 state.ch 变了要重画选中态（按钮的 .on）。
    var key = state.selCell.lane + '@' + state.selCell.tick + '|' + state.ch +
      '|' + acts.join(',') + '|' + (charsOn ? '-' : 'L');
    if (key === dockKey) return;
    dockKey = key;
    dock.textContent = '';
    acts.forEach(function (a) { dock.appendChild(makeActBtn(a)); });
    if (charsOn) {
      if (acts.length) {
        var dp = document.createElement('span');
        dp.className = 'docksep';
        dock.appendChild(dp);
      }
      order.forEach(function (v) { dock.appendChild(makeChip(v)); });
    }
    dock.classList.add('open');
    bindLongName(dock);
  }

  function onDockClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    // 左侧三个格级动作：走与上下文条同一个 doAct，执行体只有一份
    var ca = b.getAttribute('data-cellact');
    if (ca) { doAct(ca); return; }
    var ch = b.getAttribute('data-ch');
    if (ch) ctx.writeChar(ch);
  }
  if (dock) dock.addEventListener('click', onDockClick);
  ctx.closeCharDock = hideDock;

  ctx.afterRedraw = function () {
    // 每次重绘后重新决定：上下文条该显示哪一级动作、字符停靠条该不该在。
    renderTopbar();
    renderContext();
    renderDock();
  };
  // 滚动＝「我要看更多」：动作菜单（选中行 / 列后升起的那 117px 面板）自动让位。
  // 只收面板，不动选中格与字符停靠条 —— 它们不遮挡画布中部，且是高频输入控件。
  // 面板下次会在重绘时按当前选中重新出现（ctxKey 已清，不会因为「同一对象」被跳过）。
  // 同步 compare 程序滚动：位置对得上就是 revealLane 自己刚滚的那一下，不能当用户滚动处理。
  if (ctx.wrap) ctx.wrap.addEventListener('scroll', function () {
    // ① revealLane 自己刚滚的那一下：位置对得上就放过
    if (selfScrollTop && Math.abs(ctx.wrap.scrollLeft - selfScrollTop.left) < 2 &&
        Math.abs(ctx.wrap.scrollTop - selfScrollTop.top) < 2) {
      selfScrollTop = null;
      return;
    }
    selfScrollTop = null;
    // ② 重绘换掉 SVG 后浏览器把 scrollTop 夹回原位时也会派发 scroll：位置与「开面板那一刻」
    //    一致说明画布没动，同样不能收面板。
    if (ctxScroll && Math.abs(ctx.wrap.scrollLeft - ctxScroll.left) < 2 &&
        Math.abs(ctx.wrap.scrollTop - ctxScroll.top) < 2) {
      return;
    }
    ctxScroll = null;
    hideContext();
  }, { passive: true });

  ctx.closePanel = hideContext;
  ctx.hideToast = function () { if (toast) { clearTimeout(toastTimer); toast.classList.remove('show'); } };

  // 首屏手势引导：一段 2.2 秒的「点一下 → 再点一下」动画，替代原来的文字 toast。
  // 画在页面固定层上（不在 SVG 里，所以不占画布、不进波形层、也不会被重绘抹掉），
  // 播完由 JS 整块移除；对读屏是 aria-hidden —— 触摸手势本来就不需要文字说明。
  function guide() {
    if (!TOUCH) return;                              // 首屏手势动画只对触摸端有意义
    if (ctx.isReadonly && ctx.isReadonly()) return;   // 只读预览没有「点格子」这回事
    var cell = ctx.wrap && ctx.wrap.querySelector('rect.cell');
    if (!cell) return;
    var r = cell.getBoundingClientRect();
    if (r.width < 1) return;                          // 画布还不可见（停在源码页）就跳过
    var g = document.createElement('div');
    g.className = 'gesture';
    g.setAttribute('aria-hidden', 'true');
    g.style.left = (r.left + r.width / 2) + 'px';
    g.style.top = (r.top + r.height / 2) + 'px';
    g.innerHTML = '<i class="ring r1"></i><i class="ring r2"></i><i class="finger"></i>';
    document.body.appendChild(g);
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 2400);
  }

  setTimeout(function () {
    // 只读预览没有字符条可点，这条引导不适用，也不该弹。
    if (ctx.isReadonly && ctx.isReadonly()) return;
    var c = ctx.wrap && ctx.wrap.querySelector('rect.cell');
    if (!c) return;                                   // 还没布局好就不再重试，宁缺不闪
    guide();
  }, 500);
}
