// 编辑器 UI 外壳：全局顶栏、上下文操作条、字符停靠条、轻提示。
// 四场景共用同一份代码 —— 桌面与触摸的差别只在 CSS 决定摆哪、多大。
// 本模块不产生新的编辑命令 —— 所有按钮复用 interactions.js 暴露的同一组动作。
import { TOUCH } from './mode.js';
import * as Cap from './cap.js';
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { EMBED } from './embed.js';
import { chipGlyph, chipDesc } from './waveform.js';
import { esc } from '../core/util.js';

export function attachTouchUI(ctx, dom) {
  var topbar = dom.topbar, panel = dom.tbpanel, toast = dom.toast;
  var dock = dom.chardock, more = dom.charmore;
  // 不再因为「没有底部操作栏 / 上下文条容器」整块退出：字符停靠条（dock）在桌面
  // 与验收页里也要工作，缺哪个节点就跳过哪部分（下面各函数自带空值保护）。
  var state = ctx.state;
  var toastTimer = null;

  function say(t) {
    if (!toast) return;
    toast.textContent = String(t);
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
    link:   { txt: '◇', name: 'Link mode: click two cells' },
    layout: { txt: '⇄', name: 'Split direction' },
    embed:  { txt: '<>', name: 'Embed code' }
  };
  var topKey = '';
  function renderTopbar() {
    if (!topbar) return;
    var cmds = Cap.hudCmds(Cap.sceneOf(state), EMBED);
    var cols = ctx.currentLayout ? ctx.currentLayout() === 'cols' : true;
    // 只在「按钮集合 / 可用态 / 模式」变化时重建，避免每次 redraw 都闪一下
    var key = cmds.join(',') + '|' + state.undo.length + '|' + state.redo.length + '|' +
      (state.linkMode ? 'L' : '-') + '|' + (cols ? 'C' : 'R') + '|' + (state.embedCard ? 'E' : '-');
    if (key === topKey && topbar.childNodes.length) return;
    topKey = key;
    topbar.textContent = '';
    cmds.forEach(function (c) {
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
      } else if (c === 'link' && state.linkMode) {
        name = 'Link mode: on — click to exit';
      }
      b.textContent = c === 'layout' ? (cols ? '⇄' : '⇅') : m.txt;
      b.title = name;
      b.setAttribute('aria-label', name);
      if (c === 'link') b.setAttribute('aria-pressed', String(!!state.linkMode));
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
  var ICONS = {
    name:   '<path d="M7 17.5L11 6.5l4 11M8.6 13.6h4.8"/>',
    wave:   '<path d="M3 15h3v-6h4v6h4V9h4v6h3"/>',
    data:   '<path d="M4 9.5h16v5H4z"/><path d="M10 9.5v5M15 9.5v5"/>',
    nodeStr:'<path d="M3 12h6M15 12h6"/><circle cx="12" cy="12" r="2.2"/>',
    phase:  '<text x="12" y="17.5" text-anchor="middle" font-size="16" font-family="Georgia,serif" fill="currentColor" stroke="none">φ</text>',
    period: '<path d="M4 12h16"/><path d="M7.5 8.5L4 12l3.5 3.5M16.5 8.5L20 12l-3.5 3.5"/>',
    up:     '<path d="M12 19.5V6"/><path d="M7 11l5-5 5 5"/>',
    down:   '<path d="M12 4.5V18"/><path d="M7 13l5 5 5-5"/>',
    add:    '<path d="M3.5 17.5h9"/><path d="M17 6.5v9M12.5 11h9"/>',
    spacer: '<path d="M4 8.5h16M4 15.5h16"/>',
    del:    '<path d="M3.5 17.5h9"/><path d="M15 8.5l6 6M21 8.5l-6 6"/>',
    // 格级两项画成「这一格 + 格里的东西」：铅笔是标签文字，圆点是锚点字符。
    // 与行级的 data / nodeStr（整行）刻意画得不同，免得两个图标看着一样却差一个量级。
    label:  '<rect x="3.5" y="6" width="10" height="12" rx="1.5"/><path d="M16 15.5l1.5-1.5 3 3-1.5 1.5z"/><path d="M16 15.5l-1.2 3.2 3.2-1.2"/>',
    node:   '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/><circle cx="12" cy="12" r="2.4"/>',
    insert: '<path d="M8.5 5v14M15.5 5v14"/><path d="M12 9.5v5M9.5 12h5"/>',
    delCol: '<path d="M9 5v14"/><path d="M15.5 9l4.5 6M20 9l-4.5 6"/>',
    gap:    '<path d="M12 5v14" stroke-dasharray="2.5 2.5"/>',
    append: '<path d="M9 5v14"/><path d="M14 12h6.5M17.25 8.75v6.5"/>'
  };
  var ICON_KEY = { delete: 'delCol' };
  var NAMES = {
    name: 'signal name', wave: 'row wave', data: 'row data', nodeStr: 'row node',
    label: 'cell data label', node: 'cell node marker',
    phase: 'phase', period: 'period', up: 'move up', down: 'move down', add: 'add row',
    spacer: 'add spacer', del: 'delete row',
    insert: 'insert cycle', delete: 'delete cycle', gap: 'phase line', append: 'append cycle'
  };
  // 动作清单来自 cap.js 的 ACTS —— 与桌面行工具 / 列操作是同一份，避免「面板里少一个
  // 动作」与「图元里多一个按钮」各说各话。图标与英文名留在本文件（只有触摸端用得上）。
  var ROW_ACTS = Cap.ACTS.row;
  var COL_ACTS = Cap.ACTS.col;
  var CELL_ACTS = Cap.ACTS.cell;

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
      case 'name':   l = needLane(); if (l) ctx.openInlineFor({ nameLane: l }); return;
      case 'wave': case 'data': case 'nodeStr': case 'phase': case 'period':
        l = needLane();
        if (l) ctx.openRowEditor(l, { wave: 'wave', data: 'data', nodeStr: 'node', phase: 'phase', period: 'period' }[k]);
        return;
      case 'up': case 'down':
        l = needLane();
        if (l) ctx.commit({ t: 'moveLane', lane: l, v: k }, k === 'up' ? 'move row up' : 'move row down');
        return;
      case 'add': case 'spacer': case 'del':
        l = needLane(); if (l) ctx.handleTool(k, l); return;
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

  var ctxKind = null, ctxKey = null;
  // 打开面板那一刻的滚动位置（见 renderContext 末尾）：用于把「布局抖动引发的 scroll」
  // 与「用户真的想滑动」区分开。
  var ctxScroll = null;
  // 程序化滚动（revealLane）刚设过的目标位置；scroll 事件里据此区分「自己滚的」与「用户滚的」。
  var selfScrollTop = null;
  // CSS 据此把退出按钮抬到面板上方，谁也不压谁。
  function hideContext() {
    if (ctxKind === null) return;
    ctxKind = null; ctxKey = null;
    panel.classList.remove('open');
    panel.textContent = '';
  }
  // 上下文条内容跟着「最后选中的对象」走：格子 → 格级动作，列 → 列动作，行 → 行动作。
  // 三级共用同一个容器与同一段渲染代码，差别只是喂进去的动作清单。
  function renderContext() {
    if (!panel) return;                           // 不跑编辑器的页面（如验收页）没有上下文条容器
    if (state.linkMode || ctx.inlineCtx) { hideContext(); return; }
    var kind = null, acts = null, key = null, laneOf = null;
    if (state.selCell && state.ir) {
      // 格级：改这一格的 data 标签 / 节点锚点字符。这两件事原先只有桌面的 ✎ 徽标能做
      // （触摸端没有 hover，13×11 的命中区手指也点不中），是 CAP 里最后一处 swap。
      // 现在四场景共用这一条通道，画布上不再画徽标。
      kind = 'cell'; acts = CELL_ACTS;
      key = state.selCell.lane + '@' + state.selCell.tick;
      laneOf = state.selCell.lane;
    }
    else if (state.sel !== null && state.sel !== undefined) { kind = 'col'; acts = COL_ACTS; key = state.sel; }
    else if (state.selLane) { kind = 'row'; acts = ROW_ACTS; key = state.selLane; laneOf = state.selLane; }
    if (!kind) { hideContext(); return; }
    // 同一对象不重绘（避免连点闪烁）—— 但必须确认面板**当前真的是开着的**：
    // 面板可能被 hideContext 清空过而 key 未变（清空路径不止一条），此时若只看 key
    // 就会跳过重建，表现为「点了行、面板却空着」。
    if (ctxKind === kind && ctxKey === key && panel.classList.contains('open') && panel.childNodes.length) return;
    ctxKind = kind; ctxKey = key;
    panel.textContent = '';
    acts.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctxbtn';
      b.setAttribute('data-act', k);
      b.setAttribute('data-name', NAMES[k] || k);
      b.setAttribute('aria-label', NAMES[k] || k);
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[ICON_KEY[k] || k] || '') + '</svg>';
      panel.appendChild(b);
    });
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
      ctx.revealLane(laneOf, panel.offsetHeight);
      // 只有真的滚动了才记；横纵两个方向都要记 —— 用户随后横向滑动画布时 scrollTop 不变，
      // 只比 scrollTop 会把手势误判成「程序自己滚的」而放过，面板就再也收不起来了。
      selfScrollTop = ctx.wrap && ctx.wrap.scrollTop !== top0
        ? { left: ctx.wrap.scrollLeft, top: ctx.wrap.scrollTop } : null;
    }
  }
  if (panel) panel.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    // 不收起面板：多个动作常需连点（如连按上移），重绘后 renderContext 会按新状态更新。
    doAct(b.getAttribute('data-act'));
  });

  // ---- 字符停靠条 ---------------------------------------------------------
  // 触摸端不再把 23 个字符画进 SVG 里（那条东西会钉在画布底部、随着滚动被反复 transform，
  // 在嵌入卡片那种矮框里几乎盖掉整张波形，手指一动它跟着变 —— 也就是「按钮在浮动」）。
  // 改成停在卡片底部的 HTML 条：固定高度、不随画布滚动、命中区 44px 起。
  // 第一排只放最常用的几个 + 「⋯」，其余 23 个进一个可收起的面板，避免横向滑好几屏。
  var QUICK = ['0', '1', 'x', 'z'];
  var dockKey = null, moreOpen = false, dockOpen = false;

  // 收起停靠条。写成幂等函数而不是「判 dockKey 有没有值」——
  // closeCharDock 会主动把 dockKey 置 null，用 dockKey 当开关会让清理条件失效，
  // 表现为「Esc 清掉了选中，底部字符条还挂着 6 个按钮」。
  function hideDock() {
    // 无条件清空：原先靠 dockOpen 早退，一旦 renderDock 半途失败（或从别的场景切进来）
    // 就会留下一排点不动的按钮。清空是幂等的，代价只是一次 innerHTML 赋值。
    dockKey = null; moreOpen = false;
    dockOpen = false;
    if (dock) { dock.textContent = ''; dock.classList.remove('open'); }
    if (more) { more.textContent = ''; more.classList.remove('open'); }
    document.documentElement.classList.remove('more-open');
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
  function renderDock() {
    if (!dock) return;
    var visible = !state.readonly && !state.linkMode && !!state.selCell && !ctx.inlineCtx;
    if (!visible) { hideDock(); return; }
    var key = state.selCell.lane + '@' + state.selCell.tick + '|' + state.ch + '|' + moreOpen;
    if (key === dockKey) return;                 // 同一状态不重建，避免点一下闪一下
    dockKey = key;
    dock.textContent = '';
    // 当前字符不在快捷四个里时，把它临时顶到第一位 —— 免得「选中是什么」看不出来
    // 桌面一条放得下 23 颗（30px × 23 ≈ 690），全平铺；触摸端只放 4 颗 + 「⋯」折叠。
    // 这是宽度决定的**布局**差异，不是能力差异 —— 控件与写入逻辑是同一份。
    var quick = TOUCH ? QUICK.slice() : Core.ALL.slice();
    if (TOUCH && state.ch && quick.indexOf(state.ch) < 0) quick.unshift(state.ch);
    quick.forEach(function (v) { dock.appendChild(makeChip(v)); });
    if (more && TOUCH) {                              // 只有触摸端需要折叠入口
      var mb = document.createElement('button');
      mb.type = 'button';
      mb.className = 'chipbtn more' + (moreOpen ? ' on' : '');
      mb.setAttribute('data-more', '1');
      mb.setAttribute('data-name', 'more characters');
      mb.setAttribute('aria-label', 'More characters');
      mb.setAttribute('aria-expanded', String(moreOpen));
      mb.innerHTML = '<span>⋯</span>';
      dock.appendChild(mb);

      more.textContent = '';
      if (moreOpen) {
        Core.ALL.forEach(function (v) { more.appendChild(makeChip(v)); });
        more.classList.add('open');
      } else more.classList.remove('open');
      document.documentElement.classList.toggle('more-open', moreOpen);
    }
    var xb = document.createElement('button');
    xb.type = 'button';
    xb.className = 'chipbtn clear';
    xb.setAttribute('data-clear', '1');
    xb.setAttribute('data-name', 'done');
    xb.setAttribute('aria-label', 'Done editing this cell');
    xb.innerHTML = '<span>✕</span>';
    dock.appendChild(xb);
    dock.classList.add('open');
    dockOpen = true;
    bindLongName(dock);
    if (moreOpen && more) bindLongName(more);
  }
  function onDockClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.getAttribute('data-more')) { moreOpen = !moreOpen; dockKey = null; renderDock(); return; }
    if (b.getAttribute('data-clear')) { state.selCell = null; moreOpen = false; ctx.redraw(); return; }
    var ch = b.getAttribute('data-ch');
    if (ch) { moreOpen = false; ctx.writeChar(ch); }
  }
  if (dock) dock.addEventListener('click', onDockClick);
  if (more) more.addEventListener('click', onDockClick);
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
    if (ctx.isReadonly && ctx.isReadonly()) return;   // 嵌入卡片只读态没有「点格子」这回事
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
    // 只读（嵌入卡片默认态）没有字符条可点，这条引导不适用，也不该弹。
    if (ctx.isReadonly && ctx.isReadonly()) return;
    var c = ctx.wrap && ctx.wrap.querySelector('rect.cell');
    if (!c) return;                                   // 还没布局好就不再重试，宁缺不闪
    guide();
  }, 500);
}
