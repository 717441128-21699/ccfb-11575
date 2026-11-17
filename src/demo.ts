/**
 * 内置演示图:320x200,包含瀑布、火焰、霓虹招牌、星空、地板灯带,
 * 自带 6 个循环组,打开编辑器即可预览调色板动画效果。
 */

import type { CycleGroup, PaletteImage } from './anim.js';

function setRamp(pal: Uint8ClampedArray, start: number, stops: [number, number, number][]): void {
  const n = stops.length;
  for (let i = 0; i < n; i++) {
    pal[(start + i) * 3] = stops[i][0];
    pal[(start + i) * 3 + 1] = stops[i][1];
    pal[(start + i) * 3 + 2] = stops[i][2];
  }
}

/** 在两个 RGB 之间生成 n 级渐变 */
function gradient(c0: [number, number, number], c1: [number, number, number], n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    out.push([
      Math.round(c0[0] + (c1[0] - c0[0]) * t),
      Math.round(c0[1] + (c1[1] - c0[1]) * t),
      Math.round(c0[2] + (c1[2] - c0[2]) * t),
    ]);
  }
  return out;
}

// 简单确定性伪随机(演示图每次生成一致)
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function createDemo(): { image: PaletteImage; groups: CycleGroup[] } {
  const W = 320;
  const H = 200;
  const pixels = new Uint8Array(W * H);
  const palette = new Uint8ClampedArray(256 * 3);
  const rng = makeRng(12345);

  // ---- 调色板布局 ----
  // 0:夜空底色  1:远山  2:地面  3:石头  4:月亮  5-7:静态星星
  palette.set([10, 12, 34], 0 * 3);
  palette.set([24, 28, 58], 1 * 3);
  palette.set([30, 26, 40], 2 * 3);
  palette.set([58, 54, 70], 3 * 3);
  palette.set([240, 236, 200], 4 * 3);
  palette.set([180, 190, 255], 5 * 3);
  palette.set([255, 240, 180], 6 * 3);
  palette.set([200, 160, 255], 7 * 3);
  // 16-31:火焰(黑红→红→橙→黄→白)
  setRamp(palette, 16, [
    ...gradient([40, 4, 4], [160, 20, 8], 6),
    ...gradient([170, 24, 8], [255, 120, 16], 5),
    ...gradient([255, 130, 20], [255, 240, 200], 5),
  ]);
  // 32-47:水流(深藍→蓝→青→白)
  setRamp(palette, 32, [
    ...gradient([8, 20, 80], [20, 80, 200], 8),
    ...gradient([24, 90, 210], [120, 220, 255], 5),
    ...gradient([130, 225, 255], [255, 255, 255], 3),
  ]);
  // 48-55:霓虹(品红→青)
  setRamp(palette, 48, gradient([255, 40, 200], [40, 255, 240], 8));
  // 56-63:地板灯带(彩虹)
  setRamp(palette, 56, [
    [255, 60, 60],
    [255, 160, 40],
    [255, 240, 60],
    [80, 255, 80],
    [40, 220, 160],
    [60, 160, 255],
    [140, 80, 255],
    [255, 80, 220],
  ]);
  // 64-71:星星闪烁(暗蓝→亮白)
  setRamp(palette, 64, gradient([30, 34, 70], [240, 248, 255], 8));
  // 72-79:岩浆(暗红→亮橙)
  setRamp(palette, 72, gradient([60, 8, 4], [255, 180, 40], 8));
  // 其余色号填灰阶,方便直接画画
  for (let i = 80; i < 256; i++) {
    const v = Math.round(((i - 80) / 175) * 255);
    palette.set([v, v, v], i * 3);
  }

  const px = (x: number, y: number, c: number): void => {
    if (x >= 0 && x < W && y >= 0 && y < H) pixels[y * W + x] = c;
  };

  // ---- 场景 ----
  // 天空
  pixels.fill(0, 0, W * 108);
  // 星星(一部分用闪烁组 64-71)
  for (let i = 0; i < 140; i++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * 100);
    px(x, y, rng() < 0.5 ? 64 + Math.floor(rng() * 8) : 5 + Math.floor(rng() * 3));
  }
  // 月亮
  for (let y = -8; y <= 8; y++)
    for (let x = -8; x <= 8; x++) if (x * x + y * y <= 64) px(268 + x, 26 + y, 4);
  // 远山
  for (let x = 0; x < W; x++) {
    const h = 96 + Math.floor(10 * Math.sin(x * 0.05) + 6 * Math.sin(x * 0.13 + 2));
    for (let y = h; y < 112; y++) px(x, y, 1);
  }
  // 地面
  pixels.fill(2, W * 112, W * H);
  // 石头点缀
  for (let i = 0; i < 60; i++) px(Math.floor(rng() * W), 112 + Math.floor(rng() * 70), 3);

  // 瀑布:山体缺口 x 140-184,从 y 40 泻到 y 150
  for (let y = 40; y < 150; y++)
    for (let x = 140; x < 185; x++) {
      const streak = Math.floor(rng() * 4); // 每列固定相位,形成竖直水纹
      pixels[y * W + x] = 32 + ((y * 2 + streak * 4 + ((x * 7) % 3)) % 16);
    }
  // 瀑布顶的水源
  for (let y = 34; y < 40; y++) for (let x = 136; x < 189; x++) px(x, y, 32 + ((x + y) % 16));
  // 底部水潭
  for (let y = 150; y < 164; y++)
    for (let x = 118; x < 208; x++) pixels[y * W + x] = 32 + ((x + y * 3) % 16);

  // 篝火:左下 x 24-72, y 150-172,火舌朝上
  for (let y = 150; y < 172; y++)
    for (let x = 24; x < 73; x++) {
      const dx = Math.abs(x - 48) / 24;
      const dy = (171 - y) / 22;
      const heat = Math.max(0, 1 - dx * dx - dy * 0.7 + rng() * 0.25);
      if (heat > 0.15) pixels[y * W + x] = 16 + Math.min(15, Math.floor(heat * 16));
    }
  // 木柴
  for (let x = 34; x < 63; x++) px(x, 172, 3);

  // 霓虹招牌:右上边框 + 横条
  for (let x = 216; x < 306; x++) {
    px(x, 48, 48 + (x % 8));
    px(x, 84, 48 + ((x + 4) % 8));
  }
  for (let y = 48; y < 85; y++) {
    px(216, y, 48 + (y % 8));
    px(305, y, 48 + ((y + 4) % 8));
  }
  for (let x = 228; x < 294; x++) px(x, 66, 48 + ((x * 2) % 8)); // 招牌中间一道霓虹管

  // 岩浆裂缝:右下
  for (let i = 0; i < 90; i++) {
    const x = 230 + Math.floor(rng() * 80);
    const y = 168 + Math.floor(rng() * 24);
    px(x, y, 72 + Math.floor(rng() * 8));
  }

  // 地板灯带:底部两行跑马灯
  for (let y = 188; y < 196; y++)
    for (let x = 0; x < W; x++) pixels[y * W + x] = 56 + (Math.floor(x / 8) % 8);

  const groups: CycleGroup[] = [
    { id: 1, name: '瀑布', start: 32, end: 47, mode: 'cycle', speed: 8, direction: 1, enabled: true },
    { id: 2, name: '火焰', start: 16, end: 31, mode: 'lerp', speed: 2, direction: 1, enabled: true },
    { id: 3, name: '霓虹', start: 48, end: 55, mode: 'pingpong', speed: 4, direction: 1, enabled: true },
    { id: 4, name: '灯带', start: 56, end: 63, mode: 'cycle', speed: 4, direction: -1, enabled: true },
    { id: 5, name: '星空', start: 64, end: 71, mode: 'lerp', speed: 1, direction: 1, enabled: true },
    { id: 6, name: '岩浆', start: 72, end: 79, mode: 'pingpong', speed: 2, direction: 1, enabled: true },
  ];

  return { image: { width: W, height: H, pixels, palette }, groups };
}
