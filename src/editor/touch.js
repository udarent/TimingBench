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
  var toastTimer = null, openPanel = null;

  function say(t) {
    if (!toast) return;
    toast.textContent = String(t);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1900);
  }
  ctx.say = say;

  // 桌面把反馈藏在 title 里；触摸端没有 hover，改成一次性轻提示。错误仍走源码区红点。
  var baseNotify = ctx.notify;
  ctx.notify = function (t, bad) {
    baseNotify(t, bad);
    if (!bad && t) say(t);
  };

  function setView(v) {
    if (app) app.setAttribute('data-view', v);
    if (!tabbar) return;
    var bs = tabbar.querySelectorAll('button[data-view]');
    for (var i = 0; i < bs.length; i++)
      bs[i].setAttribute('aria-selected', String(bs[i].getAttribute('data-view') === v));
  }
  if (tabbar) tabbar.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-view]') : null;
    if (b) setView(b.getAttribute('data-view'));
  });

  // 两个面板的对象：左侧是按钮文案，动作由 doAct 分派到既有命令
  var PANELS = {
    obj: [
      ['char', '✎ 波形字符'], ['label', '▤ 数据标签'], ['node', '◇ 节点标记'],
      ['name', 'Aa 信号名'], ['wave', '~ 行 wave'], ['data', '= 行 data'],
      ['nodeStr', '◇ 行 node'], ['phase', 'φ 相位'], ['period', 'T 周期'],
      ['up', '↑ 上移'], ['down', '↓ 下移'], ['add', '+ 增行'],
      ['spacer', '∅ 空行'], ['del', '✕ 删行']
    ],
    col: [
      ['insert', '+ 插入周期'], ['delete', '− 删除周期'],
      ['gap', '| 相位线'], ['append', '+ 末尾追加']
    ]
  };

  function needCell() {
    if (state.selCell && state.ir) return state.selCell;
    say('先点一个波形格'); return null;
  }
  function needLane() {
    if (state.selLane && state.ir) return state.selLane;
    say('先点一行信号名或波形格'); return null;
  }
  function needCol() {
    if (state.ir && state.sel !== null && state.sel !== undefined) return state.sel;
    say('先点一个列号'); return null;
  }

  function doAct(k) {
    setView('diagram');           // 对象 / 列操作都作用在画布上，自动切回时序图
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
        if (l) ctx.commit({ t: 'moveLane', lane: l, v: k }, k === 'up' ? '上移一行' : '下移一行');
        return;
      case 'add': case 'spacer': case 'del':
        l = needLane(); if (l) ctx.handleTool(k, l); return;
      case 'insert': case 'delete': case 'gap':
        c = needCol(); if (c === null) return;
        n = state.ir.ticks;
        if (c >= n && k !== 'insert') { say('末尾幽灵列只能追加周期'); return; }
        ctx.handleColAct(k, c); return;
      case 'append':
        if (!state.ir) { say('画布尚未就绪'); return; }
        ctx.handleColAct('insert', state.ir.ticks); return;
    }
  }

  function pressed(which, on) {
    var bs = bar.querySelectorAll('button[data-panel]');
    for (var i = 0; i < bs.length; i++)
      bs[i].setAttribute('aria-pressed', String(on && bs[i].getAttribute('data-panel') === which));
  }
  function closePanel() {
    openPanel = null;
    panel.classList.remove('open');
    panel.textContent = '';
    pressed('', false);
  }
  function togglePanel(which) {
    if (openPanel === which) { closePanel(); return; }
    closePanel();
    openPanel = which;
    (PANELS[which] || []).forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-act', item[0]);
      b.textContent = item[1];
      panel.appendChild(b);
    });
    panel.classList.add('open');
    pressed(which, true);
  }
  panel.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    var k = b.getAttribute('data-act');
    closePanel();
    doAct(k);
  });

  bar.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-panel')) { togglePanel(b.getAttribute('data-panel')); return; }
    var k = b.getAttribute('data-tb');
    if (k === 'undo' || k === 'redo') { ctx.doCmd(k); return; }
    if (k === 'link') {
      if (state.connect) { state.connect = null; ctx.redraw(); say('已取消连线'); }
      else say('依次点两个节点锚点完成连线；再点此可取消');
      return;
    }
    if (k === 'cancel') {
      closePanel(); ctx.cancelModes(); say('已清除选中'); return;
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openPanel) closePanel();
  });

  ctx.afterRedraw = function () {
    var u = bar.querySelector('[data-tb="undo"]'), r = bar.querySelector('[data-tb="redo"]');
    if (u) u.disabled = !state.undo.length;
    if (r) r.disabled = !state.redo.length;
  };
  ctx.closePanel = closePanel;

  setTimeout(function () { say('点格子选中 → 点字符条写入；双敲或长按就地编辑'); }, 500);
}
