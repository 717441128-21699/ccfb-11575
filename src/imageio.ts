/**
 * 图片导入:索引色 PNG 走精确解析(保留色号顺序),
 * 其他图片用 Canvas 解码后量化到 256 色调色板。
 */

import type { PaletteImage } from './anim.js';
import { tryLoadIndexedPng } from './pngindexed.js';

/** 3-3-2 位均匀量化的 256 色调色板(兜底用) */
export function quantizedPalette(): Uint8ClampedArray {
  const pal = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const r3 = (i >> 5) & 7;
    const g3 = (i >> 2) & 7;
    const b2 = i & 3;
    pal[i * 3] = Math.round((r3 / 7) * 255);
    pal[i * 3 + 1] = Math.round((g3 / 7) * 255);
    pal[i * 3 + 2] = Math.round((b2 / 3) * 255);
  }
  return pal;
}

/** 把 RGBA 像素量化成索引图。颜色数 ≤256 时保留精确颜色,否则 3-3-2 均匀量化。 */
export function quantizeRgba(rgba: Uint8ClampedArray, width: number, height: number): PaletteImage {
  const count = width * height;
  const colorToIndex = new Map<number, number>();
  const colors: number[] = [];
  let exact = true;

  // 第一遍:统计不同颜色(透明像素按黑色处理)
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const a = rgba[o + 3];
    const key =
      a < 128 ? 0 : ((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]) + 1; // +1 与透明区分
    if (!colorToIndex.has(key)) {
      if (colors.length >= 256) {
        exact = false;
        break;
      }
      colorToIndex.set(key, colors.length);
      colors.push(key);
    }
  }

  const pixels = new Uint8Array(count);
  if (exact) {
    const palette = new Uint8ClampedArray(256 * 3);
    colors.forEach((key, idx) => {
      const rgb = key === 0 ? 0 : key - 1;
      palette[idx * 3] = (rgb >> 16) & 0xff;
      palette[idx * 3 + 1] = (rgb >> 8) & 0xff;
      palette[idx * 3 + 2] = rgb & 0xff;
    });
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const a = rgba[o + 3];
      const key = a < 128 ? 0 : ((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]) + 1;
      pixels[i] = colorToIndex.get(key)!;
    }
    return { width, height, pixels, palette };
  }

  // 颜色太多:3-3-2 均匀量化
  const palette = quantizedPalette();
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) {
      pixels[i] = 0;
      continue;
    }
    pixels[i] = ((rgba[o] >> 5) << 5) | ((rgba[o + 1] >> 5) << 2) | (rgba[o + 2] >> 6);
  }
  return { width, height, pixels, palette };
}

/** 通用图片导入(浏览器环境):优先精确解析索引 PNG,失败则 Canvas 解码 + 量化 */
export async function loadImageFile(file: File): Promise<{ image: PaletteImage; exact: boolean }> {
  const buf = await file.arrayBuffer();
  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
    try {
      const indexed = await tryLoadIndexedPng(buf);
      if (indexed) return { image: indexed, exact: true };
    } catch {
      // 落到量化路径
    }
  }
  const bitmap = await createImageBitmap(new Blob([buf]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { image: quantizeRgba(data.data, canvas.width, canvas.height), exact: false };
}

/** 新建画布的默认 256 色调色板:16 灰阶 + 6x6x6 色立方 + 高饱和灰 */
export function defaultPalette(): Uint8ClampedArray {
  const pal = new Uint8ClampedArray(256 * 3);
  // 0-15:灰阶
  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 255);
    pal[i * 3] = v;
    pal[i * 3 + 1] = v;
    pal[i * 3 + 2] = v;
  }
  // 16-231:6x6x6 色立方
  let idx = 16;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) {
        pal[idx * 3] = Math.round((r / 5) * 255);
        pal[idx * 3 + 1] = Math.round((g / 5) * 255);
        pal[idx * 3 + 2] = Math.round((b / 5) * 255);
        idx++;
      }
  // 232-255:高亮灰(方便做霓虹/发光)
  for (let i = 0; i < 24; i++) {
    const v = Math.round(128 + (i / 23) * 127);
    pal[idx * 3] = v;
    pal[idx * 3 + 1] = v;
    pal[idx * 3 + 2] = v;
    idx++;
  }
  return pal;
}
