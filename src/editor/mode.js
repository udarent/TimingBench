// 输入模式判定：模块求值时确定一次，几何常量与触摸 UI 共用同一结果。
// 桌面默认 fine；粗指针设备自动启用；桌面可用 ?touch=1 预览触摸版式。
// Node 下没有 window，恒为 false —— 自检 / 验收套件始终按桌面几何运行。
function detect() {
  try {
    if (typeof window === 'undefined') return false;
    // ?touch=1 / ?touch=0 优先于设备能力：前者在桌面预览触摸版式，后者在粗指针设备
    // （或继承了 coarse 的 iframe）里强制桌面版式 —— 验收套件靠它把「两个版式」都锁死。
    var forced = window.location ? new URLSearchParams(window.location.search).get('touch') : null;
    if (forced === '1') return true;
    if (forced === '0') return false;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  } catch (e) { /* 无 matchMedia / 无 URLSearchParams 时按桌面处理 */ }
  return false;
}

export const TOUCH = detect();
