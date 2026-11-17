/**
 * 导出/导入:游戏用动画数据 JSON、工程文件、GIF、当前帧 PNG 数据。
 * 纯数据层,不碰 DOM;下载动作由 main.ts 完成。
 */

import { applyGroups, suggestLoopDuration, type CycleGroup, type PaletteImage } from './anim.js';
import { encodeGif } from './gifenc.js';

export const DATA_FORMAT = 'palette-cycle-anim';
export const PROJECT_FORMAT = 'palette-cycle-project';

function toHex(pal: Uint8ClampedArray, i: number): string {
  const h = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${h(pal[i * 3])}${h(pal[i * 3 + 1])}${h(pal[i * 3 + 2])}`;
}

function fromHex(s: string): [number, number, number] {
  const v = parseInt(s.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface GroupJson {
  name: string;
  start: number;
  end: number;
  mode: string;
  speed: number;
  direction: number;
  enabled: boolean;
}

function groupToJson(g: CycleGroup): GroupJson {
  return {
    name: g.name,
    start: g.start,
    end: g.end,
    mode: g.mode,
    speed: g.speed,
    direction: g.direction,
    enabled: g.enabled,
  };
}

function groupFromJson(j: GroupJson, id: number): CycleGroup {
  const mode = j.mode === 'pingpong' || j.mode === 'lerp' ? j.mode : 'cycle';
  const start = Math.max(0, Math.min(255, Math.round(j.start)));
  const end = Math.max(start, Math.min(255, Math.round(j.end)));
  return {
    id,
    name: String(j.name ?? `组${id}`),
    start,
    end,
    mode,
    speed: Math.max(0, Math.min(64, Number(j.speed) || 0)),
    direction: j.direction === -1 ? -1 : 1,
    enabled: j.enabled !== false,
  };
}

/** 给游戏程序的动画数据(像素可选) */
export function buildDataJson(image: PaletteImage, groups: readonly CycleGroup[], includePixels: boolean): string {
  const palette: string[] = [];
  for (let i = 0; i < 256; i++) palette.push(toHex(image.palette, i));
  const out: Record<string, unknown> = {
    format: DATA_FORMAT,
    version: 1,
    width: image.width,
    height: image.height,
    palette,
    groups: groups.map(groupToJson),
  };
  if (includePixels) {
    out.pixels = { encoding: 'base64', data: bytesToBase64(image.pixels) };
  }
  return JSON.stringify(out, null, 2);
}

/** 工程文件(含像素,可完整恢复) */
export function buildProjectJson(image: PaletteImage, groups: readonly CycleGroup[]): string {
  const palette: string[] = [];
  for (let i = 0; i < 256; i++) palette.push(toHex(image.palette, i));
  return JSON.stringify({
    format: PROJECT_FORMAT,
    version: 1,
    width: image.width,
    height: image.height,
    palette,
    groups: groups.map(groupToJson),
    pixels: { encoding: 'base64', data: bytesToBase64(image.pixels) },
  });
}

export interface LoadedProject {
  image: PaletteImage;
  groups: CycleGroup[];
}

/** 解析工程文件或数据文件(数据文件需含像素才能恢复画面) */
export function parseProjectJson(text: string): LoadedProject {
  const j = JSON.parse(text) as {
    format?: string;
    width?: number;
    height?: number;
    palette?: string[];
    groups?: GroupJson[];
    pixels?: { encoding?: string; data?: string };
  };
  if (j.format !== PROJECT_FORMAT && j.format !== DATA_FORMAT) {
    throw new Error(`无法识别的格式: ${String(j.format)}`);
  }
  const width = j.width ?? 0;
  const height = j.height ?? 0;
  if (width <= 0 || height <= 0 || !Array.isArray(j.palette)) throw new Error('工程数据不完整');
  if (!j.pixels?.data) throw new Error('该文件不含像素数据,无法作为工程打开');

  const palette = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256 && i < j.palette.length; i++) {
    const [r, g, b] = fromHex(j.palette[i]);
    palette[i * 3] = r;
    palette[i * 3 + 1] = g;
    palette[i * 3 + 2] = b;
  }
  const pixels = base64ToBytes(j.pixels.data);
  if (pixels.length !== width * height) throw new Error('像素数据长度与尺寸不符');
  const groups = (j.groups ?? []).map((g, i) => groupFromJson(g, i + 1));
  return { image: { width, height, pixels, palette }, groups };
}

/** 导出 GIF:按 fps 采样一个完整循环,所有帧共享像素数据,只换调色板 */
export function buildGif(
  image: PaletteImage,
  groups: readonly CycleGroup[],
  durationSec: number,
  fps: number
): Uint8Array<ArrayBuffer> {
  const frameCount = Math.max(1, Math.min(600, Math.round(durationSec * fps)));
  const delayCs = Math.max(2, Math.round(100 / fps));
  const pal = new Uint8ClampedArray(256 * 3);
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    applyGroups(pal, image.palette, groups, f / fps);
    frames.push({ palette: new Uint8ClampedArray(pal), delayCs });
  }
  return encodeGif(image.width, image.height, image.palette, frames, image.pixels, true);
}

export { suggestLoopDuration };
