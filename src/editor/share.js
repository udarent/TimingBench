// 嵌入代码分享：把当前 WaveJSON 生成宿主可粘贴的 HTML 片段，并提供复制面板。
// 只读当前编辑器状态、只写一个浮层 DOM，不参与渲染与编辑语义。

export function attachShare(ctx) {
  if (typeof document === 'undefined') return;
  var panel = null, codeEl = null, tipEl = null;

  // 站点基址：从当前页面地址推导，自托管 / 本地 / Pages 都能得到正确前缀
  function baseUrl() {
    try {
      var u = new URL(location.href);
      return u.origin + u.pathname.replace(/[^/]*$/, '');
    } catch (e) { return ''; }
  }

  // 属性值用双引号包裹：WaveJSON 里基本都是单引号，这样片段可读性最好；
  // 只需转义 & < > 与双引号（&#34; 比 &quot; 在部分高亮器里更稳定）。
  function attrText(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&#34;');
  }

  // 数量级参考：嵌入卡片默认只读，高度等于「波形内容 + 底部留白」，不含字符条
  function snippet() {
    var src = (ctx.code && ctx.code.value) || '';
    var h = Math.ceil((ctx.state.barY || 240) + 20);
    var open = '<' + 'script src="' + baseUrl() + 'embed.js">';
    var close = '<' + '/script>';
    return open + close + '\n' +
      '<div data-timingbench data-height="' + h + '"\n' +
      '     data-wavejson="' + attrText(src) + '"></div>';
  }

  function build() {
    panel = document.createElement('div');
    panel.className = 'shareMask';
    panel.innerHTML =
      '<div class="sharePanel" role="dialog" aria-modal="true" aria-label="嵌入代码">' +
        '<div class="shareHead"><span>嵌到你的页面</span>' +
          '<button type="button" class="shareClose" aria-label="关闭">✕</button></div>' +
        '<p class="shareHint">把下面两行贴进你的页面，就会显示这张波形；读者点一下即可编辑。</p>' +
        '<textarea class="shareCode" readonly spellcheck="false" aria-label="嵌入代码"></textarea>' +
        '<div class="shareFoot"><button type="button" class="shareCopy">复制代码</button>' +
          '<span class="shareTip" aria-live="polite"></span></div>' +
      '</div>';
    document.body.appendChild(panel);
    codeEl = panel.querySelector('.shareCode');
    tipEl = panel.querySelector('.shareTip');

    panel.querySelector('.shareClose').addEventListener('click', close);
    panel.addEventListener('mousedown', function (e) { if (e.target === panel) close(); });
    panel.querySelector('.shareCopy').addEventListener('click', copy);
    codeEl.addEventListener('focus', function () { codeEl.select(); });
    // Esc 关闭：捕获阶段处理，避免被画布的内层 Esc 逻辑先吃掉
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }, true);
  }

  function copy() {
    var text = codeEl.value;
    function done(ok) {
      tipEl.textContent = ok ? '已复制' : '请手动全选复制';
      tipEl.className = 'shareTip' + (ok ? ' ok' : '');
      setTimeout(function () { if (tipEl) tipEl.textContent = ''; }, 1800);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback(text)); });
        return;
      }
    } catch (e) { /* 落到兜底 */ }
    done(fallback(text));
  }

  function fallback(text) {
    try {
      codeEl.removeAttribute('readonly');
      codeEl.select();
      var ok = document.execCommand && document.execCommand('copy');
      codeEl.setAttribute('readonly', '');
      return !!ok;
    } catch (e) { return false; }
  }

  function close() {
    if (!panel) return;
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null; codeEl = null; tipEl = null;
    ctx.focusCanvas();
  }

  ctx.openEmbedCode = function () {
    if (panel) { codeEl && codeEl.select(); return; }
    build();
    codeEl.value = snippet();
    codeEl.scrollTop = 0;
    try { codeEl.focus({ preventScroll: true }); } catch (e) { try { codeEl.focus(); } catch (e2) {} }
  };
  ctx.closeEmbedCode = close;
}
