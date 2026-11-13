// 触摸端 UI 装配：标签页、底部操作栏、上下文操作面板、字符停靠条、轻提示。
// 只在 coarse 指针（或 ?touch=1）时生效；桌面版式与「无常驻文字」口径不受影响。
// 本模块不产生新的编辑命令 —— 所有按钮复用 interactions.js 暴露的同一组动作。
import { TOUCH } from './mode.js';
import * as Cap from './cap.js';
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { chipGlyph, chipDesc } from './waveform.js';
import { esc } from '../core/util.js';

export function attachTouchUI(ctx, dom) {
  if (!TOUCH) return;
  var bar = dom.touchbar, panel = dom.tbpanel, toast = dom.toast;
  var dock = dom.chardock, more = dom.charmore;
  var tabbar = dom.tabbar, app = dom.app;
  if (!bar || !panel) return;                 // 验收页等只带四个基础节点的装配体直接跳过
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

  // 桌面把反馈藏在 title 里；触摸端没有 hover，改成一次性轻提示。
  // 阻止类提示也走轻提示 —— 源码区红点在时序图标签页里根本看不见，
  // 只留红环会「有反馈但不知道原因」，所以红环是主反馈、这行英文是兜底。
  var baseNotify = ctx.notify;
  ctx.notify = function (t, bad, el) {
    baseNotify(t, bad, el);
    if (t) say(t);
  };

  function setView(v) {
    var prev = app && app.getAttribute('data-view');
    if (app) app.setAttribute('data-view', v);
    if (!tabbar) return;
    var bs = tabbar.querySelectorAll('button[data-view]');
    for (var i = 0; i < bs.length; i++)
      bs[i].setAttribute('aria-selected', String(bs[i].getAttribute('data-view') === v));
    // 切回时序图时画布才重新可见；此前 clientWidth 为 0，字符条按兜底宽度排过，
    // 这里补一次重绘让操作层按真实卡片宽度重新排布（就地输入未结算时跳过）。
    if (v === 'diagram' && prev !== 'diagram' && ctx.redraw && !ctx.inlineCtx) ctx.redraw();
  }
  if (tabbar) tabbar.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-view]') : null;
    if (b) setView(b.getAttribute('data-view'));
  });

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
    insert: '<path d="M8.5 5v14M15.5 5v14"/><path d="M12 9.5v5M9.5 12h5"/>',
    delCol: '<path d="M9 5v14"/><path d="M15.5 9l4.5 6M20 9l-4.5 6"/>',
    gap:    '<path d="M12 5v14" stroke-dasharray="2.5 2.5"/>',
    append: '<path d="M9 5v14"/><path d="M14 12h6.5M17.25 8.75v6.5"/>'
  };
  var ICON_KEY = { delete: 'delCol' };
  var NAMES = {
    name: 'signal name', wave: 'row wave', data: 'row data', nodeStr: 'row node',
    phase: 'phase', period: 'period', up: 'move up', down: 'move down', add: 'add row',
    spacer: 'add spacer', del: 'delete row',
    insert: 'insert cycle', delete: 'delete cycle', gap: 'phase line', append: 'append cycle'
  };
  // 动作清单来自 cap.js 的 ACTS —— 与桌面行工具 / 列操作是同一份，避免「面板里少一个
  // 动作」与「图元里多一个按钮」各说各话。图标与英文名留在本文件（只有触摸端用得上）。
  var ROW_ACTS = Cap.ACTS.row;
  var COL_ACTS = Cap.ACTS.col;

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
    setView('diagram');           // 行 / 列动作都作用在画布上，自动切回时序图
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
  // 程序化滚动（revealLane）刚设过的目标位置；scroll 事件里据此区分「自己滚的」与「用户滚的」。
  var selfScrollTop = null;  // 嵌入卡片里 #tbpanel 是唯一能改行 / 列的地方（触摸端不画行工具与拖拽把手），
  // 所以它和右下角那个铅笔 / 对勾按钮会抢同一块地方：把面板实测高度写进 --ctx-h，
  // CSS 据此把退出按钮抬到面板上方，谁也不压谁。
  function markContext(open) {
    var de = document.documentElement;
    if (!open) { de.classList.remove('ctx-open'); de.style.removeProperty('--ctx-h'); return; }
    de.classList.add('ctx-open');
    de.style.setProperty('--ctx-h', (panel.offsetHeight || 0) + 'px');
  }
  function hideContext() {
    if (ctxKind === null) return;
    ctxKind = null; ctxKey = null;
    panel.classList.remove('open');
    panel.textContent = '';
    markContext(false);
  }
  // 上下文条内容跟着「最后选中的对象」走：选中格子时字符条在 SVG 里，这里让位。
  function renderContext() {
    if (state.linkMode || ctx.inlineCtx || state.selCell) { hideContext(); return; }
    var kind = null, acts = null, key = null;
    if (state.sel !== null && state.sel !== undefined) { kind = 'col'; acts = COL_ACTS; key = state.sel; }
    else if (state.selLane) { kind = 'row'; acts = ROW_ACTS; key = state.selLane; }
    if (!kind) { hideContext(); return; }
    if (ctxKind === kind && ctxKey === key) return;   // 同一对象不重绘，避免闪烁
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
    markContext(true);
    // 面板贴在卡片底部、会盖住波形下沿：把选中的那一行滚到面板上方，别让人盲目点按钮。
    // 这次滚动是程序自己发起的，要记下目标位置 —— 否则紧随其后的 scroll 事件会被
    // 当成「用户想看更多」，把刚打开的面板立刻收掉（选中靠下的行时表现为面板一闪就没）。
    if (kind === 'row' && ctx.revealLane) {
      var top0 = ctx.wrap ? ctx.wrap.scrollTop : 0;
      ctx.revealLane(state.selLane, panel.offsetHeight);
      // 只有真的滚动了才记；横纵两个方向都要记 —— 用户随后横向滑动画布时 scrollTop 不变，
      // 只比 scrollTop 会把手势误判成「程序自己滚的」而放过，面板就再也收不起来了。
      selfScrollTop = ctx.wrap && ctx.wrap.scrollTop !== top0
        ? { left: ctx.wrap.scrollLeft, top: ctx.wrap.scrollTop } : null;
    }
  }
  panel.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    // 不收起面板：多个动作常需连点（如连按上移），重绘后 renderContext 会按新状态更新。
    doAct(b.getAttribute('data-act'));
  });

  bar.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;
    var k = b.getAttribute('data-tb');
    if (k === 'undo' || k === 'redo') { ctx.doCmd(k); return; }
    if (k === 'link') {
      setView('diagram');
      ctx.setLinkMode(!state.linkMode);   // 与桌面 HUD 共用唯一的模式切换入口
      return;
    }
    if (k === 'cancel') {
      ctx.cancelModes(); say('Selection cleared'); return;
    }
  });
  bindLongName(bar);
  if (tabbar) bindLongName(tabbar);


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
    dockKey = null; moreOpen = false;
    if (!dockOpen) return;
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
    var quick = QUICK.slice();
    if (state.ch && quick.indexOf(state.ch) < 0) quick.unshift(state.ch);
    quick.forEach(function (v) { dock.appendChild(makeChip(v)); });
    if (more) {
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
    var u = bar.querySelector('[data-tb="undo"]'), r = bar.querySelector('[data-tb="redo"]');
    if (u) u.disabled = !state.undo.length;
    if (r) r.disabled = !state.redo.length;
    var lk = bar.querySelector('[data-tb="link"]');
    if (lk) lk.setAttribute('aria-pressed', String(state.linkMode));
    renderContext();
    renderDock();
  };
  // 滚动＝「我要看更多」：动作菜单（选中行 / 列后升起的那 117px 面板）自动让位。
  // 只收面板，不动选中格与字符停靠条 —— 它们不遮挡画布中部，且是高频输入控件。
  // 面板下次会在重绘时按当前选中重新出现（ctxKey 已清，不会因为「同一对象」被跳过）。
  // 同步 compare 程序滚动：位置对得上就是 revealLane 自己刚滚的那一下，不能当用户滚动处理。
  if (ctx.wrap) ctx.wrap.addEventListener('scroll', function () {
    if (selfScrollTop && Math.abs(ctx.wrap.scrollLeft - selfScrollTop.left) < 2 &&
        Math.abs(ctx.wrap.scrollTop - selfScrollTop.top) < 2) {
      selfScrollTop = null;
      return;
    }
    selfScrollTop = null;
    hideContext();
  }, { passive: true });

  ctx.closePanel = hideContext;
  ctx.hideToast = function () { if (toast) { clearTimeout(toastTimer); toast.classList.remove('show'); } };

  // 首屏手势引导：一段 2.2 秒的「点一下 → 再点一下」动画，替代原来的文字 toast。
  // 画在页面固定层上（不在 SVG 里，所以不占画布、不进波形层、也不会被重绘抹掉），
  // 播完由 JS 整块移除；对读屏是 aria-hidden —— 触摸手势本来就不需要文字说明。
  function guide() {
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
