// 双栏 / 上下分区的**可拖动分隔条**（0.27.0）。
//
// 为什么要有它：默认 50/50 只是起点。读源码时希望代码区宽一点，改波形时希望画布宽一点，
// 该由用户当下的任务决定，而不是由我们的默认值决定 —— 于是把那条分隔线做成能拖的。
//
// 三个约束，都是踩过坑之后定下的：
//   ① **比例用百分比存**，不用像素：窗口一变、转个手机，按比例缩放才是用户想要的；
//      但每边至少留 MIN_PX（读源码至少要看得到几行、画布至少要点得着格子），
//      所以按当前容器尺寸换算成百分比上下限，窄屏时下限自动抬高。
//   ② **两侧方向各存一份**（tb-split-cols / tb-split-rows）：横向拖成 30/70 的人，
//      切到上下分区时不该继承这个 30 —— 那是另一个维度上的偏好。
//   ③ **拖完才落盘**：pointermove 里每帧写 localStorage 会卡（同步 IO），
//      而且中间态本来也没有记录价值；松手写一次就够。
var STORE = { cols: 'tb-split-cols', rows: 'tb-split-rows' };
var MIN_PX = 220;          // 每边的最小可用宽度 / 高度
var HARD_MIN = 10;         // 百分比硬下限（容器极窄时也不至于把一边拖没）
var DEFAULT = 50;

export function attachSplitter(ctx, dom) {
  var app = dom.app, bar = dom.splitter;
  if (!app || !bar || !ctx.currentLayout) return;   // 只读预览等宿主没有分栏，直接跳过

  var ratio = { cols: DEFAULT, rows: DEFAULT };

  function layout() {
    var l = ctx.currentLayout();
    return l === 'rows' ? 'rows' : 'cols';
  }

  // 读取已保存的比例。坏值 / 越界值一律当没存过 —— 否则一个手改过的 localStorage
  // 就能让界面每次进来都停在「一边 3%」没法自救（拖回来当然可以，但不该需要自救）。
  function load() {
    Object.keys(STORE).forEach(function (k) {
      var v = NaN;
      try { v = parseFloat(localStorage.getItem(STORE[k])); } catch (e) { /* 隐私模式 */ }
      if (isFinite(v) && v >= HARD_MIN && v <= 100 - HARD_MIN) ratio[k] = v;
    });
  }

  // 把「百分比」夹到当前尺寸下真正合法的区间：先按 MIN_PX 算可用区间，再与硬下限取严。
  function clamp(k, v) {
    var size = k === 'cols' ? app.clientWidth : app.clientHeight;
    if (!size) return v;
    var lo = Math.max(HARD_MIN, (MIN_PX / size) * 100);
    var hi = Math.min(100 - HARD_MIN, 100 - (MIN_PX / size) * 100);
    if (lo > hi) return DEFAULT;                 // 容器本身就装不下两边（极窄），回到均分
    return Math.min(hi, Math.max(lo, v));
  }

  function paint() {
    var k = layout();
    var v = clamp(k, ratio[k]);
    app.style.setProperty('--split', v.toFixed(2) + '%');
    bar.setAttribute('aria-orientation', k === 'cols' ? 'vertical' : 'horizontal');
    bar.setAttribute('aria-valuenow', String(Math.round(v)));
    bar.setAttribute('aria-valuemin', String(HARD_MIN));
    bar.setAttribute('aria-valuemax', String(100 - HARD_MIN));
    bar.title = 'Drag to resize · double-click to reset';
  }

  function commit(k) {
    try { localStorage.setItem(STORE[k], String(Math.round(ratio[k] * 10) / 10)); } catch (e) { /* 忽略 */ }
  }

  function reset() {
    var k = layout();
    ratio[k] = DEFAULT;
    paint(); commit(k);
  }

  // ---- 拖动 ---------------------------------------------------------------
  // 指针事件而不是鼠标事件：触摸屏也能拖（.splitter 上写了 touch-action:none，
  // 否则手指一按就被当成滚动画布，pointermove 直接 cancel）。
  var drag = null;

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;   // 只吃主键，右键留给菜单
    drag = { k: layout(), id: e.pointerId, moved: false };
    if (bar.setPointerCapture) { try { bar.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
    bar.classList.add('drag');
    document.documentElement.classList.add('is-resizing');
    document.documentElement.classList.toggle('is-resizing-rows', drag.k === 'rows');
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var r = app.getBoundingClientRect();
    var p = drag.k === 'cols'
      ? ((e.clientX - r.left) / (r.width || 1)) * 100
      : ((e.clientY - r.top) / (r.height || 1)) * 100;
    ratio[drag.k] = clamp(drag.k, p);
    drag.moved = true;
    app.style.setProperty('--split', ratio[drag.k].toFixed(2) + '%');
    bar.setAttribute('aria-valuenow', String(Math.round(ratio[drag.k])));
  }

  function onUp(e) {
    if (!drag) return;
    var k = drag.k;
    drag = null;
    bar.classList.remove('drag');
    document.documentElement.classList.remove('is-resizing', 'is-resizing-rows');
    if (bar.releasePointerCapture) { try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
    if (k) commit(k);
    // 松手后按新宽度重画一次：ResizeObserver 有 120ms 去抖，拖的过程中可能还没跟上，
    // 而「拖完停在这儿」这一帧必须准（否则图上的刻度与可见宽度对不上）。
    if (ctx.redraw) ctx.redraw();
  }

  if (ctx.on) {
    ctx.on(bar, 'pointerdown', onDown);
    ctx.on(window, 'pointermove', onMove, { passive: true });
    ctx.on(window, 'pointerup', onUp);
    ctx.on(window, 'pointercancel', onUp);
    // 容器尺寸变了，百分比不变但 MIN_PX 换算出的区间会变 —— 重新夹一次
    ctx.on(window, 'resize', paint);
  }
  ctx.on(bar, 'dblclick', function (e) { e.preventDefault(); reset(); });

  // ---- 键盘 ---------------------------------------------------------------
  // 分隔条本身可聚焦（role=separator + tabindex），所以键盘用户也能调比例：
  // 方向键 2%、Shift 10%、Home/End 到极限、Enter / Space 回 50%（与双击等价）。
  ctx.on(bar, 'keydown', function (e) {
    var k = layout();
    var step = e.shiftKey ? 10 : 2;
    var v = ratio[k];
    if (k === 'cols' ? e.key === 'ArrowLeft' : e.key === 'ArrowUp') v -= step;
    else if (k === 'cols' ? e.key === 'ArrowRight' : e.key === 'ArrowDown') v += step;
    else if (e.key === 'Home') v = HARD_MIN;
    else if (e.key === 'End') v = 100 - HARD_MIN;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reset(); return; }
    else return;
    e.preventDefault();
    ratio[k] = clamp(k, v);
    paint(); commit(k);
    if (ctx.redraw) ctx.redraw();
  });

  load();
  paint();
  // 切分屏方向（⇄）时由 index.js 的 applyLayout 调它：比例换到另一档，
  // aria-orientation 与光标方向也要跟着翻（否则上下分区里还挂着 col-resize）。
  ctx.repaintSplitter = paint;
}
