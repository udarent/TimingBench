// 顶栏「重型入口」的开关：源码视图（图形 / 代码 / 双栏）与「生成嵌入代码」。
//
// 为什么要有这层：普通的嵌入波形（笔记里的一张只读卡）只需要「看 + 改波形」，
// 顶栏挂着「切到代码」「双栏」「再嵌一次」只是噪音 —— 卡片通常只有三四百像素宽，
// 三个入口能吃掉半行。所以默认按场景给：
//   · 独立编辑页（editor.html，非嵌入）：两项都开 —— 那本来就是它的用途。
//   · 嵌入卡片：默认都关，只留 撤销 / 重做。
//
// 需要时由宿主显式打开（两种写法等价）：
//   URL：  editor.html?embed=1&src=1&snippet=1
//   属性： <div data-timingbench data-src="1" data-snippet="1">  ← embed.js 转成上面的 URL
// 也接受 =0 显式关掉（独立编辑页想极简时用）。
import { EMBED } from './embed.js';

function flag(name, dflt) {
  try {
    var v = new URLSearchParams(window.location.search).get(name);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (e) { /* 无 URLSearchParams：按默认值 */ }
  return dflt;
}

// 源码 / 双栏入口：没有它就只能看图形，代码编辑与分屏按钮一起消失。
export var SRC = flag('src', !EMBED);
// 「<>」生成嵌入代码：把这张图再嵌一次。
export var SNIPPET = flag('snippet', !EMBED);
