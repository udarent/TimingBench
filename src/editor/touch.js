// 触摸端 UI 装配：标签页、底部操作栏、上下文操作面板、轻提示。
// 只在 coarse 指针（或 ?touch=1）时生效；桌面版式与「无常驻文字」口径不受影响。
// 本模块不产生新的编辑命令 —— 所有按钮复用 interactions.js 暴露的同一组动作。
import { TOUCH } from './mode.js';

export function attachTouchUI(ctx, dom) {
  if (!TOUCH) return;
  var bar = dom.touchbar, panel = dom.tbpanel, toast = dom.toast;
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
  var ROW_ACTS = ['name','wave','data','nodeStr','phase','period','up','down','add','spacer','del'];
  var COL_ACTS = ['insert','delete','gap','append'];

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
  function hideContext() {
    if (ctxKind === null) return;
    ctxKind = null; ctxKey = null;
    panel.classList.remove('open');
    panel.textContent = '';
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

  ctx.afterRedraw = function () {
    var u = bar.querySelector('[data-tb="undo"]'), r = bar.querySelector('[data-tb="redo"]');
    if (u) u.disabled = !state.undo.length;
    if (r) r.disabled = !state.redo.length;
    var lk = bar.querySelector('[data-tb="link"]');
    if (lk) lk.setAttribute('aria-pressed', String(state.linkMode));
    renderContext();
  };
  ctx.closePanel = hideContext;
  ctx.hideToast = function () { if (toast) { clearTimeout(toastTimer); toast.classList.remove('show'); } };

  setTimeout(function () {
    // 只读（嵌入卡片默认态）没有字符条可点，这条引导不适用，也不该弹 ——
    // 何况它是中文，会出现在英文宿主页面里。
    if (ctx.isReadonly && ctx.isReadonly()) return;
    say('Tap a cell, then a character. Double-tap or long-press to edit in place.');
  }, 500);
}
