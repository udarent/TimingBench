// 嵌入模式判定：?embed=1 时只渲染波形卡片，供宿主页面 iframe 引入。
// Node 下没有 window，恒为 false —— 自检 / 验收套件仍按整页模式运行。
function detect() {
  try {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('embed') === '1';
  } catch (e) { return false; }
}

export const EMBED = detect();

// 宿主可用 ?mode=edit 让卡片一进来就是编辑态；默认只读（看为主，点一下才进编辑）。
function initialEditable() {
  try {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('mode') === 'edit';
  } catch (e) { return false; }
}

export const EDIT_ON_START = initialEditable();
