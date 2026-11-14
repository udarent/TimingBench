// 嵌入壳：只有 ?embed=1 时启用。
// 职责：默认只读（只画波形）、点一下进编辑、Esc 回只读、
// 与宿主页面 postMessage 双向同步（源码 / 只读态 / 高度）。
// 不碰渲染内核与编辑语义 —— 只控制「哪些层画、哪些事件放行」。
import { EMBED, EDIT_ON_START } from './embed.js';
import { G } from './geometry.js';
import { TOUCH } from './mode.js';
import { decodePayload } from './payload.js';

// 只有 iframe、没有脚本的宿主（Obsidian 笔记、只能贴 HTML 的编辑器）走 URL 片段带内容：
//   editor.html?embed=1#wj=<base64url(WaveJSON)>
// 片段不发给服务器，也不会被当查询串截断；用 URLSearchParams 取是为了将来能再加参数。
// 解不出来就当没有 —— 保留默认示例，不报错、不白屏。
function hashPayload() {
  try {
    var h = String(location.hash || '').replace(/^#/, '');
    if (!h) return '';
    var raw = new URLSearchParams(h).get('wj');
    return raw ? decodePayload(raw) : '';
  } catch (e) { return ''; }
}

export function attachEmbed(ctx, opts) {
  if (!EMBED || typeof window === 'undefined') return;
  var state = ctx.state;
  var docEl = document.documentElement;
  var hint = opts && opts.hint;
  var origin = '*';   // 宿主域名未知，默认放开；文档说明可用 event.origin 校验

  docEl.classList.add('is-embed');
  state.embedCard=true;        // 画布高度只按内容算，不留视口空白

  // ---- 全屏编辑：卡片太矮时，动作行 + 字符条会把画布挤到几乎不可见 ------------------
  // 嵌入卡片本质是固定尺寸的 iframe，唯一能真正「变大」的办法是浏览器原生全屏。
  // 只在「卡片确实太小」且「有真实用户手势」时尝试（脚本合成的 pointer 事件、宿主 setMode
  // 消息都不算手势）；失败（宿主没给 allowfullscreen、iOS Safari 不支持元素全屏）就静默
  // 退回卡片内编辑 —— 此时 CSS 会把上下文条压成单行，至少不会折成好几排把画布吃光。
  var fsForEdit = false;   // 当前这次全屏是为「编辑」开的：退出全屏时一并回只读
  var fsActive = false;    // 此刻确实处于全屏（退出失败时不要假装退出了）
  function fsCurrent() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fsSupported() { return !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen); }
  function hasGesture() {
    try { var ua = navigator.userActivation; return !ua || ua.isActive !== false; }
    catch (e) { return true; }
  }
  // 只对「粗指针 + 卡片确实太小」生效：全屏是为手指准备的补救 —— 44px 的动作按钮在小卡片里
  // 会折成好几排，把画布挤没。细指针没有这个问题（CSS 已把上下文条压成单行、可横向滚动），
  // 而宿主页面点一下就把整块屏幕抢走，比挤一点更糟。
  function isCramped() { return TOUCH && (window.innerWidth < 520 || window.innerHeight < 340); }
  function requestFs() {
    var fn = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
    if (!fn) return;
    try {
      var p = fn.call(docEl);
      if (p && p.then) p.then(function () { fsActive = true; }, function () { /* 被拒绝：留在卡片内编辑 */ });
    } catch (e) { /* 同步抛错同样退回卡片内 */ }
  }
  // 退出全屏要够耐用：不同引擎的前缀 API 不同，且首次调用偶尔因「请求仍在 pending」被拒，
  // 所以按前缀逐个尝试并重试几次。哪怕浏览器脚本退出被拦，用户仍可用系统 Esc / 返回手势退出。
  function exitFs() {
    var d = document;
    var fn = d.exitFullscreen || d.webkitExitFullscreen || d.mozCancelFullScreen || d.msExitFullscreen;
    if (!fn) return;
    var tries = 0;
    (function attempt() {
      tries++;
      var retry = function () { if (tries < 4) setTimeout(attempt, 80); };
      try {
        var p = fn.call(d);
        if (p && p.then) p.then(function () { fsActive = false; }, retry);
        else fsActive = false;
      } catch (e) { retry(); }
    })();
  }

  function post(type, payload) {
    try {
      if (window.parent && window.parent !== window)
        window.parent.postMessage(Object.assign({ source: 'timingbench', type: type }, payload || {}), origin);
    } catch (e) { /* cross-origin write blocked: local editing is unaffected */ }
  }

  function emitSrc() {
    var raw = ctx.code && ctx.code.value;
    if (typeof raw === 'string') post('change', { wavejson: raw });
  }

  // ---- 只读 ↔ 编辑 ---------------------------------------------------------
  // 提示条是一个图标按钮：铅笔 = 点一下可编辑，对勾 = 编辑中、点一下结束。
  // 视觉上零常驻文字，语义只走 aria-label（嵌入页是英文优先）。
  function setEditing(on, anchor, keepFs) {
    var wasReadonly = state.readonly;
    ctx.setReadonly(!on);
    if (anchor && wasReadonly && on) anchorCell(anchor);
    if (hint) {
      hint.setAttribute('aria-label', on ? 'Finish editing and go back to read-only' : 'Edit this timing diagram');
      hint.setAttribute('aria-pressed', on ? 'true' : 'false');
      hint.classList.toggle('editing', !!on);
    }
    // 进入编辑：卡片太小就尝试全屏，把整块屏幕让给波形 + 两条操作条。
    if (on && wasReadonly && !keepFs && isCramped() && fsSupported() && hasGesture()) {
      fsForEdit = true;
      if (!fsCurrent()) requestFs();
    }
    // 离开编辑：若这次全屏是为编辑开的，顺带退出全屏（退出失败会重试，不会假装已退）。
    if (!on && !keepFs) {
      fsForEdit = false;
      if (fsActive || fsCurrent()) exitFs();
    }
    post('mode', { editing: !!on });
  }
  ctx.requestEdit = function (anchor) { setEditing(true, anchor); };

  // 用户按 Esc / 系统手势退出全屏：若这次全屏是为编辑开的，也回到只读卡片。
  function onFsChange() {
    fsActive = !!fsCurrent();
    // 全屏态参与布局：全屏时画布按 1:1 画、靠滚动移动（见 shapes.js 的 fit 规则），
    // 回到卡片后立刻恢复「等比缩进卡片」。两种状态都要重画，否则尺寸会停在旧值上。
    state.fsEdit = fsActive;
    if (fsActive) { ctx.redraw(); return; }
    if (fsForEdit) { fsForEdit = false; if (!state.readonly) setEditing(false, null, true); }
    else ctx.redraw();
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // 从只读切到编辑，缩放会从「整图缩进卡片」跳成 1:1 —— 如果不管滚动位置，
  // 手指下面那块内容会整体挪走，第二次点按就落到别的格子上（手机端最难受的地方）。
  // 这里把被点的格子「钉」在原来的屏幕位置上：知道它的内部坐标、知道手指在视口里的位置，
  // 反解出该有的 scrollLeft / scrollTop。视图可能被等比缩过（触摸端 / 只读卡放大），
  // 所以内部坐标要乘 state.fit 才是像素。
  // 纵向到底是谁在滚，不能想当然：独立编辑器里是 .svgwrap（inset:0 + overflow:auto），
  // 嵌入卡片里 .svgwrap 的高度被内容撑开、自己滚不动，真正滚的是 body（body{overflow:auto}）
  // —— 这时改 wrap.scrollTop 和 window.scrollBy 都没反应。往上找第一个真能滚的祖先。
  function verticalScroller(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var oy = '';
      try { oy = window.getComputedStyle(n).overflowY; } catch (e) { oy = ''; }
      if (/(auto|scroll)/.test(oy) && n.scrollHeight > n.clientHeight + 2) return n;
    }
    var doc = document.scrollingElement || document.documentElement;
    if (doc && doc.scrollHeight > doc.clientHeight + 2) return doc;
    return null;
  }

  function anchorCell(anchor) {
    if (!anchor || !anchor.cell) return;
    var st = ctx.state, ir = st.ir, wrap = ctx.wrap;
    if (!ir || !wrap) return;
    var li = -1;
    ir.lanes.forEach(function (l, i) { if (l.id === anchor.cell.lane) li = i; });
    if (li < 0) return;
    var k = st.fit || 1;
    var cx = (G.XS + anchor.cell.tick * G.CELL + G.CELL / 2) * k;
    var cy = (G.TOP + li * G.ROW_H + G.ROW_H / 2) * k;
    var r = wrap.getBoundingClientRect();
    var vx = (anchor.x || 0) - r.left, vy = (anchor.y || 0) - r.top;
    var maxL = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    wrap.scrollLeft = Math.min(maxL, Math.max(0, cx - vx));
    // 纵向：位移量在两种滚动容器下是同一个数（内容坐标差），只是要施加到会动的那个上
    var dy = cy - vy;
    var vs = verticalScroller(wrap);
    if (vs) vs.scrollTop = Math.min(vs.scrollHeight - vs.clientHeight, Math.max(0, vs.scrollTop + dy));
  }

  // 点提示条可来回切换：只读时进编辑，编辑态时回只读。
  // 主通道用 pointerdown→pointerup 自己判定「一次干净的点按」：手机上小按钮的 click 很可能
  // 因手指轻微滑动被当成滚动而**被浏览器吞掉**（表现为「点了没反应」）。pointerup 不受影响，
  // 但只在位移 ≤12px、时长 ≤600ms 时才算点按，拖动看图不会误切。click 仅作兜底（键盘 Enter /
  // 无 Pointer Events 的环境），与 pointerup 之间有 350ms 去重，避免一次点击触发两次。
  if (hint) {
    var hintDown = null, suppressClickUntil = 0;
    function toggleHint() { if (state.readonly) setEditing(true); else setEditing(false); }
    hint.addEventListener('pointerdown', function (e) {
      hintDown = { x: e.clientX || 0, y: e.clientY || 0, t: Date.now(), id: e.pointerId };
    });
    hint.addEventListener('pointerup', function (e) {
      var d = hintDown; hintDown = null;
      if (!d || e.pointerId !== d.id) return;
      if (Math.abs((e.clientX || 0) - d.x) > 12 || Math.abs((e.clientY || 0) - d.y) > 12) return; // 拖动：不算点按
      if (Date.now() - d.t > 600) return;                                                        // 长按：不算点按
      e.stopPropagation();
      toggleHint();
      suppressClickUntil = Date.now() + 350;   // 紧随其后补发的 click 属于同一次点按，忽略，避免双切换
    });
    hint.addEventListener('pointercancel', function () { hintDown = null; });
    hint.addEventListener('click', function (e) {
      e.stopPropagation();
      if (Date.now() < suppressClickUntil) return;
      toggleHint();
    });
  }

  // Esc 退出编辑（就地输入 / 连线模式优先自己处理，已在 interactions 里拦截）
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // 内层（就地编辑框 / 清选中）已经消费过这次 Esc 就不再接管 —— 层级见 interactions.js
    if (e.defaultPrevented) return;
    if (state.readonly) return;
    if (ctx.inlineCtx || state.linkMode) return;   // 让内层先消费
    if (ctx.closePanel) ctx.closePanel();
    setEditing(false);
  });

  // 编辑后把源码推给宿主（宿主可据此保存）
  var baseCommit = ctx.commit;
  ctx.commit = function (op, label, silent) {
    var r = baseCommit(op, label, silent);
    emitSrc();
    return r;
  };
  var baseFromCode = ctx.fromCode;
  ctx.fromCode = function (src) {
    var r = baseFromCode(src);
    emitSrc();
    return r;
  };
  var baseDoCmd = ctx.doCmd;
  ctx.doCmd = function (act) {
    var r = baseDoCmd(act);
    emitSrc();
    return r;
  };

  // ---- 高度自适应：把波形真实高度告诉宿主，宿主据此设 iframe 高度 --------
  var lastH = 0;
  function reportHeight() {
    // 全屏时 contentH 是屏幕高 —— 别把它推给宿主，否则退出全屏瞬间卡片会被撑到整屏高。
    // 退出全屏会触发 resize→redraw→reportHeight，届时已不在全屏，自然会补上正确高度。
    if (fsCurrent()) return;
    // 顶栏是页面级 flex 子项（撤销 / 重做 / 嵌入），不在 SVG 的 contentH 里，上报时要加上。
    var topEl = document.getElementById('topbar');
    var topH = topEl && topEl.offsetHeight ? topEl.offsetHeight : 0;
    var h = Math.ceil((state.contentH || state.H || 0) + topH + 2);
    if (h > 0 && Math.abs(h - lastH) >= 1) { lastH = h; post('height', { height: h }); }
  }
  var baseRedraw = ctx.redraw;
  ctx.redraw = function () { baseRedraw(); reportHeight(); };

  // ---- 接收宿主指令 -------------------------------------------------------
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'host' || typeof d.type !== 'string') return;
    if (d.type === 'setSource' && typeof d.wavejson === 'string') {
      if (ctx.code) ctx.code.value = d.wavejson;
      ctx.fromCode(d.wavejson);
      reportHeight();
      return;
    }
    if (d.type === 'setMode') { setEditing(d.editing === true || d.mode === 'edit'); return; }
  });

  // 初始态：默认只读（?mode=edit 可直接进编辑）
  // 内容来源优先级：宿主显式 setSource（走 data-wavejson / mount）> URL 片段 > 默认示例。
  // 片段先落地，宿主的 setSource 到了自然会覆盖它。
  var seeded = hashPayload();
  if (seeded) {
    if (ctx.code) ctx.code.value = seeded;
    ctx.fromCode(seeded);
  }
  setEditing(EDIT_ON_START);
  post('ready', { wavejson: ctx.code ? ctx.code.value : '', editing: EDIT_ON_START });
  setTimeout(reportHeight, 0);
}
