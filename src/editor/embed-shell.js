// 嵌入壳：只有 ?embed=1 时启用。
// 职责：默认只读（只画波形）、点一下进编辑、Esc 回只读、
// 与宿主页面 postMessage 双向同步（源码 / 只读态 / 高度）。
// 不碰渲染内核与编辑语义 —— 只控制「哪些层画、哪些事件放行」。
import { EMBED, EDIT_ON_START } from './embed.js';
import { G, cellGeo } from './geometry.js';
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
  // state.fsEdit 是「此刻确实处于全屏」的唯一事实：退出失败时不能假装已退出，
  // 绘制层（shapes.js 的 fit 规则）也读它 —— 全屏里按 1:1 画、靠滑动移动。
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
      if (p && p.then) p.then(function () { state.fsEdit = true; }, function () { /* 被拒绝：留在卡片内编辑 */ });
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
        if (p && p.then) p.then(function () { state.fsEdit = false; }, retry);
        else state.fsEdit = false;
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
      if (state.fsEdit || fsCurrent()) exitFs();
    }
    post('mode', { editing: !!on });
  }
  ctx.requestEdit = function (anchor) { setEditing(true, anchor); };

  // 用户按 Esc / 系统手势退出全屏：若这次全屏是为编辑开的，也回到只读卡片。
  function onFsChange() {
    // state.fsEdit 同时是布局开关：全屏里画布按 1:1 画、靠滑动移动（见 shapes.js 的 fit 规则），
    // 回到卡片立即恢复「等比缩进卡片」。两种状态都要重画，否则尺寸会停在旧值上。
    var wasFs = state.fsEdit;
    state.fsEdit = !!fsCurrent();
    // 进出全屏换掉的是**整条 fit 基数**（卡片等比 ↔ 全屏 1:1），倍数必须归位：
    // 留着的话「卡片里放大 3 倍」会被乘到全屏基数上，一进去就是 3 倍屏。
    state.zoom = 1;
    if (state.fsEdit) {
      // 记住进全屏前的分屏方向。判据用「还没记过」，**不用 wasFs** —— requestFullscreen 的
      // promise 可能先于 fullscreenchange 结算（实测就是：事件到时 state.fsEdit 已经 true），
      // 拿 wasFs 判会一次都记不上，退出时自然还原不了。
      if (layout0 === undefined) layout0 = state.layout || null;
      fsOrient = null;
      showOrient(hasOrientApi && !orientMarkedBad());   // 有 API 就露出来，点一次才知道行不行
      paintOrient();
      ctx.redraw();
      return;
    }
    releaseOrient();
    if (fsForEdit) { fsForEdit = false; if (!state.readonly) setEditing(false, null, true); }
    else ctx.redraw();
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // ---- 全屏里的「横屏 / 竖屏」-------------------------------------------
  // 手机上一张 390px 宽的卡片进全屏后仍然竖着，宽图只能横向拖。真要转屏幕只有
  // `screen.orientation.lock()` 一条路。
  //
  // ⚠️ 判据不能用「lock 函数在不在」—— 实测桌面 Chromium 也有这个方法，但一调必拒
  // （NotSupportedError）；小米 HyperOS + Obsidian 这类 WebView 里同样存在、同样必拒。
  //
  // ⚠️ **更不能用「先锁一次试试」来探测**（0.21.3 试过，0.21.5 撤回）：实测那一下会真的
  // 把屏幕转过去（锁目标取自 screen.orientation.type，而它在 iframe 里未必描述设备方向），
  // 用户看到的是「点进编辑，画面先转一下」，之后能不能回正全看 unlock() 有没有生效 ——
  // 比它要解决的问题更糟。**探测本身不许有副作用**，所以这个功能改成「点一次才知道」：
  //   · 有 API 就露出按钮；
  //   · 第一次点击失败 ⇒ **静默**收起按钮并记住（本会话不再出现），不弹提示 ——
  //     环境不支持不是用户的错，报错只会像故障；
  //   · 成功后方向状态记在 fsOrient 里，之后按钮只按它翻转，不再读「当前方向」
  //     （那张表在 iframe 里不可信，读它会让按钮永远显示同一个方向）。
  // 不自己用 CSS 旋转 DOM：那会让 clientX/clientY 与图元坐标错位，命中、就地编辑、
  // 捏合锚点全部要跟着反变换，代价远大于收益。
  var so = (typeof screen !== 'undefined' && screen.orientation) || null;
  var ORIENT_BAD = 'tb-orient-bad';
  // 「这个环境锁不了」的结论：内存里记一份，sessionStorage 再记一份。
  // 内存那份是**主力** —— 实测在宿主是 opaque origin / 隐私模式的 iframe 里，
  // sessionStorage 直接抛 SecurityError，只靠存储的话结论记不住，按钮会一次次冒出来。
  var orientBad = false;
  function orientMarkedBad() {
    if (orientBad) return true;
    try { return sessionStorage.getItem(ORIENT_BAD) === '1'; } catch (e) { return false; }
  }
  function markOrientBad() {
    orientBad = true;
    try { sessionStorage.setItem(ORIENT_BAD, '1'); } catch (e) { /* 存储不可用：内存那份已生效 */ }
  }
  var hasOrientApi = !!(TOUCH && so && typeof so.lock === 'function');
  var orientBtn = opts && opts.orient;
  var fsOrient = null, layout0;   // layout0 未进过全屏时是 undefined，别当成 null 去清用户的偏好
  function showOrient(on) {
    if (!docEl.classList) return;
    if (on) docEl.classList.add('is-orient'); else docEl.classList.remove('is-orient');
  }
  function orientNow() {
    var t = (so && so.type) || '';
    if (!t) t = window.innerWidth > window.innerHeight ? 'landscape-primary' : 'portrait-primary';
    return t.indexOf('landscape') === 0 ? 'landscape' : 'portrait';
  }
  // 方向**真的**变成 want 了吗？这一问是必需的，不是保险：
  // 小米 HyperOS 的浏览器会接受 lock()（promise resolve）、屏幕却不转，而**锁定状态已经生效**
  // —— 用户看到的是「点了没反应」，接着发现「连转手机也不灵了」（旋转自由被那次锁没收）。
  // 所以锁完必须校验，没转就立刻 unlock。
  // 两个来源任一命中即算成：orientation.type 会先更新，窗口尺寸要等转屏动画结束才跟上。
  // 尺寸那一路只在全屏里采信 —— 卡片里的 innerWidth/Height 是卡片尺寸，不代表设备方向。
  function orientFits(want) {
    var t = (so && so.type) || '';
    if (t && t.indexOf(want) === 0) return true;
    if (!state.fsEdit) return false;
    var w = window.innerWidth || 0, h = window.innerHeight || 0;
    if (!w || !h || w === h) return false;
    return want === 'landscape' ? w > h : h > w;
  }
  // 按钮显示的是「点一下会切到哪」：现在竖着就画横屏图标，反之亦然。
  function paintOrient() {
    if (!orientBtn) return;
    var cur = fsOrient || orientNow();
    var want = cur === 'landscape' ? 'portrait' : 'landscape';
    orientBtn.classList.toggle('want-port', want === 'portrait');
    var label = 'Switch to ' + want;
    orientBtn.setAttribute('aria-label', label);
    orientBtn.title = label;
  }
  function releaseOrient() {
    try { if (so && so.unlock) so.unlock(); } catch (e) { /* 没锁过 / 不支持：忽略 */ }
    fsOrient = null;
    if (layout0 !== undefined) { if (ctx.setLayout) ctx.setLayout(layout0 || null); layout0 = undefined; }
    paintOrient();
  }
  function toggleOrient() {
    var want = (fsOrient || orientNow()) === 'landscape' ? 'portrait' : 'landscape';
    var done = function () {
      fsOrient = want;
      // 版式跟着方向走：横屏左右分栏、竖屏上下。手机转过来后宽度通常仍不到 860px 的自动
      // 阈值，少了这一句，「横屏」拿到的是横的屏幕 + 竖的版式，等于白转。
      if (ctx.setLayout) ctx.setLayout(want === 'landscape' ? 'cols' : 'rows');
      paintOrient();
    };
    var fail = function () {
      // 这个环境锁不了（桌面 / WebView / 权限被宿主挡掉 / iframe 不给）。**静默收起并记住**：
      // 留着一个点了没反应的控件比没有更糟，而弹一句「不支持」只会让用户以为是故障 ——
      // 环境不支持不是用户做错了什么。按钮消失即是最清楚的答复。
      markOrientBad();
      showOrient(false);
    };
    // 锁被接受 ≠ 屏幕转了：校验一轮，没转就把旋转自由还给设备再降级（见 orientFits 的注释）。
    var verify = function () {
      var n = 0;
      (function tick() {
        if (orientFits(want)) { done(); return; }
        if (++n > 7) {                        // 约 560ms：够 Android 转屏动画，又不至于让用户干等
          try { if (so && so.unlock) so.unlock(); } catch (e) { /* 没锁住：无所谓 */ }
          fsOrient = null;
          fail();
          return;
        }
        setTimeout(tick, 70);
      })();
    };
    if (!so || !so.lock) { fail(); return; }
    try {
      var pr = so.lock(want);
      if (pr && pr.then) pr.then(verify, fail); else verify();
    } catch (e) { fail(); }
  }
  if (orientBtn) {
    orientBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleOrient(); });
  }
  if (so && so.addEventListener) so.addEventListener('change', paintOrient);
  window.addEventListener('orientationchange', paintOrient);

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
    var li = -1, lane = null;
    ir.lanes.forEach(function (l, i) { if (l.id === anchor.cell.lane) { li = i; lane = l; } });
    if (li < 0 || !lane) return;
    var svg = wrap.querySelector('svg');
    var vb = svg && svg.viewBox && svg.viewBox.baseVal, sr = svg && svg.getBoundingClientRect();
    if (!vb || !sr || !sr.width || !vb.width) return;
    // 格心按行级标尺算（period 行更宽、phase 行整体左移）；period:1 时与 CELL 等价。
    // 用户坐标 → 屏幕像素一律走**真实渲染矩形**，不用 state.fit：只读卡片的 svg 被 CSS
    // 拉满（width:100%/height:100% + meet），渲染比与 state.fit 并不相等，用后者会差出
    // 十几像素（0.20.1 实测：未放大时点进编辑，横向偏 10px）。
    var px = sr.left + (cellGeo(lane, anchor.cell.tick).cx - vb.x) * sr.width / vb.width;
    var py = sr.top + (G.TOP + li * G.ROW_H + G.ROW_H / 2 - vb.y) * sr.height / vb.height;
    // 用**位移**而不是绝对值：滚动 ΔS 会让画布整体平移 ΔS，所以「目标屏幕位置 − 现在位置」
    // 就是该追加的滚动量。这一式对「滚 wrap 自己」和「滚祖先」同时成立（原来按绝对值写，
    // 在画布自己已经能滚的情形会多滚一个当前 scrollTop —— 0.20.1 实测纵向偏 456px）。
    var maxL = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    wrap.scrollLeft = Math.min(maxL, Math.max(0, wrap.scrollLeft + (px - (anchor.x || 0))));
    var vs = verticalScroller(wrap);
    if (vs) {
      var want = vs.scrollTop + (py - (anchor.y || 0));
      vs.scrollTop = Math.min(vs.scrollHeight - vs.clientHeight, Math.max(0, want));
    }
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
    // 顶栏与底部两条（上下文条 / 字符停靠条）都是**页面级 flex 子项**，不在 SVG 的 contentH 里，
    // 上报时要一起加上 —— 少算它们，宿主 iframe 还是只读时的高度，chrome 一出现就把画布挤成
    // 一条缝：tutorial 第 1 步那种 96px 的卡片进编辑后画布高度会是 0（顶栏 40 + 停靠区 91 > 96）。
    // 只读态底部两条不展开（高度 0），所以算出来的值与之前完全一致，卡片高度不会变。
    var topEl = document.getElementById('topbar');
    var topH = topEl && topEl.offsetHeight ? topEl.offsetHeight : 0;
    var dockEl = document.getElementById('dockzone');
    var dockH = dockEl && dockEl.offsetHeight ? dockEl.offsetHeight : 0;
    var h = Math.ceil((state.contentH || state.H || 0) + topH + dockH + 2);
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
