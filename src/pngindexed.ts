/**
 * 索引色 PNG 解析器:直接读 PLTE / IDAT,保留原图的调色板顺序和像素色号。
 * 调色板循环动画依赖"连续色号"的约定,所以导入时必须拿到原始索引,
 * 不能用浏览器解码后的 RGB 反推(顺序会丢)。
 * 仅支持颜色类型 3(索引色)、非隔行;其他情况返回 null 走量化回退路径。
 */

import type { PaletteImage } from './anim.js';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // PNG 的 IDAT 是 zlib 格式(deflate + zlib 头)
  const DS = (globalThis as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> })
    .DecompressionStream;
  if (!DS) throw new Error('当前环境不支持 DecompressionStream');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** 去除 PNG 扫描线滤波,返回每行 packed 字节 */
function unfilter(raw: Uint8Array, width: number, height: number, bitDepth: number): Uint8Array {
  const stride = Math.ceil((width * bitDepth) / 8);
  const out = new Uint8Array(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x > 0 ? out[row + x - 1] : 0; // 左
      const b = y > 0 ? out[prev + x] : 0; // 上
      const c = x > 0 && y > 0 ? out[prev + x - 1] : 0; // 左上
      switch (filter) {
        case 0:
          out[row + x] = v;
          break;
        case 1:
          out[row + x] = (v + a) & 0xff;
          break;
        case 2:
          out[row + x] = (v + b) & 0xff;
          break;
        case 3:
          out[row + x] = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          out[row + x] = (v + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`未知 PNG 滤波类型 ${filter}`);
      }
    }
  }
  return out;
}

/** 把 packed 扫描线按位深展开成每像素一个字节的色号 */
function unpackIndices(packed: Uint8Array, width: number, height: number, bitDepth: number): Uint8Array {
  const indices = new Uint8Array(width * height);
  if (bitDepth === 8) {
    indices.set(packed.subarray(0, width * height));
    return indices;
  }
  const stride = Math.ceil((width * bitDepth) / 8);
  const perByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const byte = packed[row + Math.floor(x / perByte)];
      const shift = 8 - bitDepth * ((x % perByte) + 1); // 高位在前
      indices[y * width + x] = (byte >> shift) & mask;
    }
  }
  return indices;
}

/**
 * 尝试按索引色 PNG 解析;不是索引 PNG(或解析失败)时返回 null。
 */
export async function tryLoadIndexedPng(buf: ArrayBuffer): Promise<PaletteImage | null> {
  const d = new DataView(buf);
  if (buf.byteLength < 8) return null;
  for (let i = 0; i < 8; i++) {
    if (d.getUint8(i) !== PNG_SIG[i]) return null;
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8ClampedArray | null = null;
  const idatParts: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= buf.byteLength) {
    const len = d.getUint32(pos);
    const type = String.fromCharCode(d.getUint8(pos + 4), d.getUint8(pos + 5), d.getUint8(pos + 6), d.getUint8(pos + 7));
    const dataStart = pos + 8;
    if (dataStart + len > buf.byteLength) return null;
    if (type === 'IHDR') {
      width = d.getUint32(dataStart);
      height = d.getUint32(dataStart + 4);
      bitDepth = d.getUint8(dataStart + 8);
      colorType = d.getUint8(dataStart + 9);
      interlace = d.getUint8(dataStart + 12);
    } else if (type === 'PLTE') {
      palette = new Uint8ClampedArray(256 * 3);
      const n = Math.min(len, 256 * 3);
      for (let i = 0; i < n; i++) palette[i] = d.getUint8(dataStart + i);
    } else if (type === 'IDAT') {
      idatParts.push(new Uint8Array(buf, dataStart, len));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4; // 跳过 CRC
  }

  if (colorType !== 3 || interlace !== 0 || !palette || idatParts.length === 0) return null;
  if (bitDepth !== 1 && bitDepth !== 2 && bitDepth !== 4 && bitDepth !== 8) return null;
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null;

  const total = idatParts.reduce((s, p) => s + p.length, 0);
  const idat = new Uint8Array(total);
  let off = 0;
  for (const p of idatParts) {
    idat.set(p, off);
    off += p.length;
  }

  const raw = await inflate(idat);
  const packed = unfilter(raw, width, height, bitDepth);
  const indices = unpackIndices(packed, width, height, bitDepth);
  return { width, height, pixels: indices, palette };
}
