// 纯文本工具：SVG / HTML 转义与截断，无 DOM 依赖，Node 与浏览器共用。
export function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
export function cut(s,n){ s=String(s); return s.length>n?s.slice(0,Math.max(1,n-1))+'…':s; }
