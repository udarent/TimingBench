// 源码 ⇄ URL 片段的载荷编解码：把一份 WaveJSON 压成可以放进 iframe src 的短串，
// 让「只有 iframe、没有脚本」的宿主（Obsidian 笔记、只允许 HTML 的编辑器）也能带内容。
//
// 用 base64url（+ → -、/ → _、去掉尾随 =），因此片段里不会出现 & # 空格 等
// 在 URL / HTML 属性里需要再转义的字符；先按 UTF-8 取字节再编码，非 ASCII 不会坏。
// Node 与浏览器共用同一份实现，自检和页面不会各写一遍。

function toBytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  // 老环境兜底：按 UTF-8 手工取字节
  var out = [], i, c;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0xd800 || c >= 0xe000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return new Uint8Array(out);
}

function fromBytes(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  var s = '', i, c, c2, c3, c4;
  for (i = 0; i < bytes.length;) {
    c = bytes[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) { c2 = bytes[i++]; s += String.fromCharCode(((c & 31) << 6) | (c2 & 63)); }
    else if (c < 0xf0) {
      c2 = bytes[i++]; c3 = bytes[i++];
      s += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
    } else {
      c2 = bytes[i++]; c3 = bytes[i++]; c4 = bytes[i++];
      c = ((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63);
      c -= 0x10000;
      s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    }
  }
  return s;
}

function b64encode(bytes) {
  if (typeof btoa === 'function') {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '', i2, n;
  for (i2 = 0; i2 < bytes.length; i2 += 3) {
    n = (bytes[i2] << 16) | ((bytes[i2 + 1] || 0) << 8) | (bytes[i2 + 2] || 0);
    out += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63] +
      (i2 + 1 < bytes.length ? ABC[(n >> 6) & 63] : '=') +
      (i2 + 2 < bytes.length ? ABC[n & 63] : '=');
  }
  return out;
}

function b64decode(str) {
  if (typeof atob === 'function') {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var clean = str.replace(/=+$/, ''), buf = [], bits = 0, acc = 0, j, v;
  for (j = 0; j < clean.length; j++) {
    v = ABC.indexOf(clean.charAt(j));
    if (v < 0) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; buf.push((acc >> bits) & 255); }
  }
  return new Uint8Array(buf);
}

// WaveJSON → `wj=` 后面的串
export function encodePayload(text) {
  return b64encode(toBytes(String(text === undefined || text === null ? '' : text)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// `wj=` 后面的串 → WaveJSON；解不出来就返回空串（调用方保留默认示例，不抛错）
export function decodePayload(token) {
  if (!token) return '';
  try {
    var s = String(token).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return fromBytes(b64decode(s));
  } catch (e) { return ''; }
}
