/**
 * GIF89a 编码器 —— 专为调色板动画优化:
 * 所有帧共享同一份索引像素数据,每帧只换局部调色板(LCT),
 * 所以 LZW 压缩只跑一次,导出一个完整循环非常快。
 * 纯函数,不依赖 DOM,可在 Node 中测试。
 */

export interface GifFrame {
  /** 256*3 的当帧调色板 */
  palette: Uint8ClampedArray;
  /** 帧延时,单位 1/100 秒 */
  delayCs: number;
}

class ByteWriter {
  private buf: number[] = [];
  u8(v: number): void {
    this.buf.push(v & 0xff);
  }
  u16(v: number): void {
    this.buf.push(v & 0xff, (v >> 8) & 0xff);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.buf.push(s.charCodeAt(i) & 0xff);
  }
  bytes(b: Uint8Array | Uint8ClampedArray): void {
    for (let i = 0; i < b.length; i++) this.buf.push(b[i]);
  }
  toUint8Array(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.buf);
  }
}

/**
 * GIF 变长 LZW 压缩(经典 compress 算法移植,与 gif.js 同源)。
 * minCodeSize 对 256 色图固定为 8。
 */
export function lzwEncode(minCodeSize: number, pixels: Uint8Array): Uint8Array {
  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;
  const MAX_BITS = 12;
  const out: number[] = [];

  let curAccum = 0;
  let curBits = 0;
  let nBits = minCodeSize + 1;
  let maxCode = (1 << nBits) - 1;
  let freeEnt = EOI + 1;
  let dict = new Map<number, number>();

  const emit = (code: number): void => {
    curAccum |= code << curBits;
    curBits += nBits;
    while (curBits >= 8) {
      out.push(curAccum & 0xff);
      curAccum >>= 8;
      curBits -= 8;
    }
    // 下一个待分配编码超出当前位宽能表示的范围 → 位宽 +1(与解码器同步)
    if (freeEnt > maxCode && nBits < MAX_BITS) {
      nBits++;
      maxCode = (1 << nBits) - 1;
    }
  };

  const clearTable = (): void => {
    dict = new Map<number, number>();
    freeEnt = EOI + 1;
    nBits = minCodeSize + 1;
    maxCode = (1 << nBits) - 1;
  };

  emit(CLEAR);
  if (pixels.length > 0) {
    let ent = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const c = pixels[i];
      const key = (ent << 8) | c;
      const found = dict.get(key);
      if (found !== undefined) {
        ent = found;
        continue;
      }
      emit(ent);
      if (freeEnt < 4096) {
        dict.set(key, freeEnt++);
      } else {
        emit(CLEAR);
        clearTable();
      }
      ent = c;
    }
    emit(ent);
  }
  emit(EOI);
  if (curBits > 0) out.push(curAccum & 0xff);
  return new Uint8Array(out);
}

function writePalette(w: ByteWriter, pal: Uint8ClampedArray): void {
  for (let i = 0; i < 256 * 3; i++) w.u8(i < pal.length ? pal[i] : 0);
}

/**
 * 编码调色板动画 GIF。
 * @param width/height 画面尺寸
 * @param basePalette  全局调色板(256*3)
 * @param frames       每帧的动画调色板与延时
 * @param indices      索引像素(所有帧共享)
 */
export function encodeGif(
  width: number,
  height: number,
  basePalette: Uint8ClampedArray,
  frames: readonly GifFrame[],
  indices: Uint8Array,
  loop = true
): Uint8Array<ArrayBuffer> {
  const w = new ByteWriter();

  // Header + Logical Screen Descriptor
  w.str('GIF89a');
  w.u16(width);
  w.u16(height);
  w.u8(0xf7); // 有全局调色板, 8bit 色深, 调色板 256 项
  w.u8(0); // 背景色索引
  w.u8(0); // 像素纵横比
  writePalette(w, basePalette);

  // NETSCAPE 循环扩展
  if (loop) {
    w.u8(0x21);
    w.u8(0xff);
    w.u8(11);
    w.str('NETSCAPE2.0');
    w.u8(3);
    w.u8(1);
    w.u16(0); // 0 = 无限循环
    w.u8(0);
  }

  // 像素数据每帧相同,只压缩一次
  const compressed = lzwEncode(8, indices);

  for (const f of frames) {
    // Graphic Control Extension
    w.u8(0x21);
    w.u8(0xf9);
    w.u8(4);
    w.u8(0x00); // 无透明色,处置方式 0
    w.u16(Math.max(2, Math.round(f.delayCs)));
    w.u8(0);
    w.u8(0);

    // Image Descriptor:全帧,带 256 项局部调色板(当帧动画调色板)
    w.u8(0x2c);
    w.u16(0);
    w.u16(0);
    w.u16(width);
    w.u16(height);
    w.u8(0x87); // LCT 标志 + 256 项
    writePalette(w, f.palette);

    // 图像数据:最小码长 8 + 子块
    w.u8(8);
    for (let off = 0; off < compressed.length; off += 255) {
      const len = Math.min(255, compressed.length - off);
      w.u8(len);
      for (let i = 0; i < len; i++) w.u8(compressed[off + i]);
    }
    w.u8(0); // 块结束
  }

  w.u8(0x3b); // Trailer
  return w.toUint8Array();
}
