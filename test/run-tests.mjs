/**
 * Node 测试:动画算法、GIF LZW 往返、GIF 结构解析、索引 PNG 解析、量化。
 * 运行:npm test
 */
import { deflateSync } from 'node:zlib';
import { applyGroups, groupOffset, suggestLoopDuration } from '../dist/anim.js';
import { encodeGif, lzwEncode } from '../dist/gifenc.js';
import { tryLoadIndexedPng } from '../dist/pngindexed.js';
import { quantizeRgba } from '../dist/imageio.js';

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${name}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — 期望 ${JSON.stringify(b)},得到 ${JSON.stringify(a)}`}`);
}

// 确定性伪随机
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------- anim ----------
console.log('anim 动画算法');
{
  const g = { id: 1, name: 't', start: 10, end: 13, mode: 'cycle', speed: 2, direction: 1, enabled: true };
  eq(groupOffset(g, 0), 0, 'cycle t=0 偏移 0');
  eq(groupOffset(g, 0.5), 1, 'cycle t=0.5 偏移 1');
  eq(groupOffset(g, 1.75), 3, 'cycle t=1.75 偏移 3');
  eq(groupOffset(g, 2), 0, 'cycle 整周期回 0');
  eq(groupOffset({ ...g, direction: -1 }, 1), 2, 'cycle 反向 t=1 偏移 2(=-2 mod 4)');

  const pp = { ...g, start: 0, end: 2, mode: 'pingpong', speed: 1 };
  eq([0, 1, 2, 3, 4, 5].map((t) => groupOffset(pp, t)), [0, 1, 2, 1, 0, 1], 'pingpong 0,1,2,1,0,1 往复');

  // applyGroups 轮转:槽位 i 取源槽位 (i+off)%n
  const base = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 4; i++) base.set([10 + i, 0, 0], (10 + i) * 3);
  const dst = new Uint8ClampedArray(256 * 3);
  applyGroups(dst, base, [g], 0.5); // off=1
  eq(dst[10 * 3], 11, '轮转后槽位10取源槽位11');
  eq(dst[13 * 3], 10, '轮转后槽位13回卷取源槽位10');

  // lerp:n=2 黑白插值
  const base2 = new Uint8ClampedArray(256 * 3);
  base2.set([0, 0, 0], 0);
  base2.set([100, 100, 100], 3);
  const lg = { id: 2, name: 'l', start: 0, end: 1, mode: 'lerp', speed: 1, direction: 1, enabled: true };
  const dst2 = new Uint8ClampedArray(256 * 3);
  applyGroups(dst2, base2, [lg], 0.25);
  eq(dst2[0], 25, 'lerp 槽位0 = 25% 白');
  eq(dst2[3], 75, 'lerp 槽位1 = 75% 白');

  // 禁用组不生效
  applyGroups(dst2, base2, [{ ...lg, enabled: false }], 0.25);
  eq(dst2[0], 0, '禁用组不改变调色板');

  // 循环时长估算:cycle n=4 speed=2 → 2s;pingpong n=3 speed=1 → 4s;LCM=4s
  const d = suggestLoopDuration([
    { id: 1, name: '', start: 0, end: 3, mode: 'cycle', speed: 2, direction: 1, enabled: true },
    { id: 2, name: '', start: 4, end: 6, mode: 'pingpong', speed: 1, direction: 1, enabled: true },
  ]);
  eq(d, 4, 'LCM 循环时长 = 4s');
}

// ---------- GIF LZW ----------
console.log('GIF LZW 编解码往返');
function lzwDecode(minCodeSize, data) {
  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;
  let codeSize, next, dict;
  const reset = () => {
    dict = [];
    for (let i = 0; i < CLEAR; i++) dict[i] = [i];
    dict[CLEAR] = [];
    dict[EOI] = [];
    next = EOI + 1;
    codeSize = minCodeSize + 1;
  };
  reset();
  const out = [];
  let prev = null;
  let bitPos = 0;
  const totalBits = data.length * 8;
  while (bitPos + codeSize <= totalBits) {
    let code = 0;
    for (let b = 0; b < codeSize; b++) {
      code |= ((data[(bitPos + b) >> 3] >> ((bitPos + b) & 7)) & 1) << b;
    }
    bitPos += codeSize;
    if (code === CLEAR) {
      reset();
      prev = null;
      continue;
    }
    if (code === EOI) break;
    let entry;
    if (prev === null) {
      entry = dict[code];
      if (!entry) throw new Error(`首码非法: ${code}`);
    } else {
      if (code < next) entry = dict[code];
      else if (code === next) entry = [...prev, prev[0]];
      else throw new Error(`非法码: ${code} (next=${next})`);
      dict[next++] = [...prev, entry[0]];
      // 与编码器(gif.js 同源)对齐:编码器"先发射、后分配、发射前检查",
      // 所以解码器在 next 达到 2^codeSize 时才升位宽
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    out.push(...entry);
    prev = entry;
  }
  return Uint8Array.from(out);
}

function roundtrip(pixels, name) {
  const compressed = lzwEncode(8, pixels);
  const back = lzwDecode(8, compressed);
  ok(back.length === pixels.length && back.every((v, i) => v === pixels[i]), `${name}(${pixels.length} 像素 → ${compressed.length} 字节)`);
}
{
  roundtrip(new Uint8Array([0, 1, 2, 3]), '极小图');
  roundtrip(new Uint8Array(1000).fill(7), '纯色');
  const r1 = rng(42);
  roundtrip(Uint8Array.from({ length: 70000 }, () => Math.floor(r1() * 256)), '随机噪声(触发字典清空)');
  const r2 = rng(7);
  const img = new Uint8Array(320 * 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) img[y * 320 + x] = (x >> 4) + ((y >> 4) << 4) + (r2() < 0.05 ? 1 : 0);
  roundtrip(img, '类像素画 320x200');
}

// ---------- GIF 结构 ----------
console.log('GIF 结构解析');
function parseGif(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const read = (n) => {
    const s = bytes.subarray(pos, pos + n);
    pos += n;
    return s;
  };
  const header = String.fromCharCode(...read(6));
  if (header !== 'GIF89a') throw new Error('bad header');
  const w = dv.getUint16(pos, true);
  const h = dv.getUint16(pos + 2, true);
  const packed = bytes[pos + 4];
  pos += 7;
  if (packed & 0x80) read(3 * 2 ** ((packed & 7) + 1)); // GCT
  const frames = [];
  for (;;) {
    const b = bytes[pos++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      pos++; // label
      for (;;) {
        const len = bytes[pos++];
        if (len === 0) break;
        pos += len;
      }
      continue;
    }
    if (b !== 0x2c) throw new Error(`未知块 0x${b.toString(16)} @${pos - 1}`);
    pos += 8; // x,y,w,h
    const ipacked = bytes[pos++];
    let lct = null;
    if (ipacked & 0x80) lct = read(3 * 2 ** ((ipacked & 7) + 1));
    const minCode = bytes[pos++];
    const chunks = [];
    for (;;) {
      const len = bytes[pos++];
      if (len === 0) break;
      chunks.push(read(len));
    }
    const data = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      data.set(c, off);
      off += c.length;
    }
    frames.push({ lct, indices: lzwDecode(minCode, data) });
  }
  return { w, h, frames };
}
{
  const W = 8;
  const H = 5;
  const r = rng(99);
  const indices = Uint8Array.from({ length: W * H }, () => Math.floor(r() * 4));
  const basePal = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) basePal.set([i, i, i], i * 3);
  const pal1 = new Uint8ClampedArray(basePal);
  pal1.set([255, 0, 0], 3 * 3);
  const pal2 = new Uint8ClampedArray(basePal);
  pal2.set([0, 255, 0], 3 * 3);
  const gif = encodeGif(W, H, basePal, [
    { palette: pal1, delayCs: 5 },
    { palette: pal2, delayCs: 5 },
  ], indices);
  ok(gif[0] === 0x47 && gif[1] === 0x49 && gif[2] === 0x46, 'GIF 文件头');
  ok(gif[gif.length - 1] === 0x3b, 'GIF 结尾 0x3B');
  const parsed = parseGif(gif);
  eq([parsed.w, parsed.h], [W, H], 'GIF 尺寸');
  eq(parsed.frames.length, 2, 'GIF 帧数 = 2');
  ok(parsed.frames[0].indices.every((v, i) => v === indices[i]), '帧1 像素还原');
  ok(parsed.frames[1].indices.every((v, i) => v === indices[i]), '帧2 像素还原');
  eq([...parsed.frames[0].lct.subarray(9, 12)], [255, 0, 0], '帧1 局部调色板生效');
  eq([...parsed.frames[1].lct.subarray(9, 12)], [0, 255, 0], '帧2 局部调色板生效');
}

// ---------- 索引 PNG 解析 ----------
console.log('索引 PNG 解析(保留色号顺序)');
function crc32(u8) {
  let c = ~0;
  for (const b of u8) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function buildIndexedPng(width, height, bitDepth, palette, indices, filters) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = 3; // 索引色
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((c, i) => plte.set(c, i * 3));
  // 打包扫描线(高位在前)+ 滤波
  const perByte = 8 / bitDepth;
  const stride = Math.ceil(width / perByte);
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const idx = indices[y * width + x];
      const bytePos = y * stride + Math.floor(x / perByte);
      const shift = 8 - bitDepth * ((x % perByte) + 1);
      raw[bytePos] |= idx << shift;
    }
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const filtered = [];
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length];
    filtered.push(f);
    for (let x = 0; x < stride; x++) {
      const v = raw[y * stride + x];
      const a = x > 0 ? raw[y * stride + x - 1] : 0;
      const b = y > 0 ? raw[(y - 1) * stride + x] : 0;
      const c = x > 0 && y > 0 ? raw[(y - 1) * stride + x - 1] : 0;
      let enc = v;
      if (f === 1) enc = v - a;
      else if (f === 2) enc = v - b;
      else if (f === 3) enc = v - ((a + b) >> 1);
      else if (f === 4) enc = v - paeth(a, b, c);
      filtered.push(enc & 0xff);
    }
  }
  const idat = deflateSync(new Uint8Array(filtered));
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, pngChunk('IHDR', ihdr), pngChunk('PLTE', plte), pngChunk('IDAT', new Uint8Array(idat)), pngChunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out.buffer;
}
{
  const palette = [
    [10, 20, 30],
    [200, 100, 50],
    [1, 2, 3],
    [250, 250, 250],
    [99, 88, 77],
  ];
  const W = 7;
  const H = 5;
  const indices = Uint8Array.from({ length: W * H }, (_, i) => (i * 3 + 1) % 5);
  const buf = buildIndexedPng(W, H, 8, palette, indices, [0, 1, 2, 3, 4]); // 所有滤波类型轮一遍
  const img = await tryLoadIndexedPng(buf);
  ok(img !== null, '解析成功');
  eq([img.width, img.height], [W, H], '尺寸正确');
  ok(img.pixels.every((v, i) => v === indices[i]), '像素色号逐字节一致');
  ok(palette.every((c, i) => img.palette[i * 3] === c[0] && img.palette[i * 3 + 1] === c[1] && img.palette[i * 3 + 2] === c[2]), '调色板顺序保留');

  // 4bit 位深
  const idx4 = Uint8Array.from([1, 2, 3, 4, 4, 3, 2, 1]);
  const img4 = await tryLoadIndexedPng(buildIndexedPng(4, 2, 4, palette, idx4, [0]));
  ok(img4 !== null && [...img4.pixels].join() === [...idx4].join(), '4bit 位深解包');

  // 非索引 PNG → null(走量化回退)
  const ihdrTruecolor = new Uint8Array(13);
  new DataView(ihdrTruecolor.buffer).setUint32(0, 1);
  new DataView(ihdrTruecolor.buffer).setUint32(4, 1);
  ihdrTruecolor[8] = 8;
  ihdrTruecolor[9] = 2; // 真彩色
  const tc = new Uint8Array([...new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...pngChunk('IHDR', ihdrTruecolor)]);
  eq(await tryLoadIndexedPng(tc.buffer), null, '真彩色 PNG 返回 null');
}

// ---------- 量化 ----------
console.log('RGBA 量化');
{
  // 3 种颜色 → 精确调色板
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  const cols = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];
  for (let i = 0; i < 16; i++) rgba.set([...cols[i % 3], 255], i * 4);
  const q = quantizeRgba(rgba, 4, 4);
  ok(q.pixels.length === 16, '像素数正确');
  const used = new Set(q.pixels);
  eq(used.size, 3, '3 种颜色 → 3 个色号');
  ok(cols.every((c) => { const o = [...used].some((idx) => q.palette[idx * 3] === c[0] && q.palette[idx * 3 + 1] === c[1] && q.palette[idx * 3 + 2] === c[2]); return o; }), '颜色精确保留');

  // 300 种颜色 → 量化到 256
  const big = new Uint8ClampedArray(300 * 4);
  for (let i = 0; i < 300; i++) big.set([i % 256, (i * 7) % 256, (i * 13) % 256, 255], i * 4);
  const q2 = quantizeRgba(big, 300, 1);
  ok(q2.pixels.length === 300 && Math.max(...q2.pixels) < 256, '超出 256 色时量化');
}

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
