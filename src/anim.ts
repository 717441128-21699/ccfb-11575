/**
 * 调色板动画核心算法 —— 纯函数,不依赖 DOM。
 * 游戏程序的运行时可以直接照抄本文件:每帧用 applyGroups 算出当前调色板,
 * 再用它把索引像素映射成 RGB 即可。
 */

export type GroupMode = 'cycle' | 'pingpong' | 'lerp';

export interface CycleGroup {
  id: number;
  name: string;
  /** 起始色号(含) */
  start: number;
  /** 结束色号(含) */
  end: number;
  /** cycle=单向轮转  pingpong=来回往复  lerp=渐变插值(连续平滑) */
  mode: GroupMode;
  /** 速度:每秒移动的色格数(可为小数,负数等同反向) */
  speed: number;
  /** 方向:1 正向 / -1 反向 */
  direction: 1 | -1;
  enabled: boolean;
}

export interface PaletteImage {
  width: number;
  height: number;
  /** 长度 width*height,每字节一个调色板色号 */
  pixels: Uint8Array;
  /** 256*3,基础调色板 RGB */
  palette: Uint8ClampedArray;
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** 离散模式(cycle / pingpong)在 time 时刻的整数偏移量 */
export function groupOffset(g: CycleGroup, time: number): number {
  const n = g.end - g.start + 1;
  const phase = Math.floor(g.speed * time * g.direction);
  if (g.mode === 'pingpong') {
    const period = 2 * n - 2; // 0..n-1..1 往返
    const p = mod(phase, period);
    return p < n ? p : period - p;
  }
  return mod(phase, n);
}

const tmp = new Uint8ClampedArray(256 * 3);

/**
 * 把 time 时刻的动画调色板算进 dst(长度 768)。
 * 组按数组顺序依次应用;范围重叠时后面的组覆盖前面的结果。
 */
export function applyGroups(
  dst: Uint8ClampedArray,
  base: Uint8ClampedArray,
  groups: readonly CycleGroup[],
  time: number
): void {
  dst.set(base);
  for (const g of groups) {
    if (!g.enabled) continue;
    const n = g.end - g.start + 1;
    if (n < 2 || g.speed === 0) continue;
    const s3 = g.start * 3;
    tmp.set(dst.subarray(s3, s3 + n * 3)); // 以"本组应用前"的颜色为源

    if (g.mode === 'lerp') {
      // 连续相位:色槽 i 的颜色 = 源色槽 (i+phase) 与 (i+phase+1) 的 RGB 插值
      const phase = mod(g.speed * time * g.direction, n);
      const i0 = Math.floor(phase);
      const t = phase - i0;
      for (let i = 0; i < n; i++) {
        const a = mod(i + i0, n) * 3;
        const b = mod(i + i0 + 1, n) * 3;
        const d = s3 + i * 3;
        dst[d] = tmp[a] + (tmp[b] - tmp[a]) * t;
        dst[d + 1] = tmp[a + 1] + (tmp[b + 1] - tmp[a + 1]) * t;
        dst[d + 2] = tmp[a + 2] + (tmp[b + 2] - tmp[a + 2]) * t;
      }
    } else {
      const off = groupOffset(g, time);
      if (off === 0) continue;
      for (let i = 0; i < n; i++) {
        const s = mod(i + off, n) * 3;
        const d = s3 + i * 3;
        dst[d] = tmp[s];
        dst[d + 1] = tmp[s + 1];
        dst[d + 2] = tmp[s + 2];
      }
    }
  }
}

/** 单个组的循环周期(秒),speed 为 0 时返回 0 */
export function groupPeriod(g: CycleGroup): number {
  const n = g.end - g.start + 1;
  const sp = Math.abs(g.speed);
  if (n < 2 || sp === 0) return 0;
  if (g.mode === 'pingpong') return (2 * n - 2) / sp;
  return n / sp;
}

/**
 * 估算所有启用组整体回到初始状态的循环时长(秒),用于 GIF 导出默认值。
 * 把各组周期换算成厘秒取 LCM,超过 30 秒或算不出时回退 4 秒。
 */
export function suggestLoopDuration(groups: readonly CycleGroup[]): number {
  const cs: number[] = [];
  for (const g of groups) {
    if (!g.enabled) continue;
    const p = groupPeriod(g);
    if (p > 0) cs.push(Math.max(1, Math.round(p * 100)));
  }
  if (cs.length === 0) return 4;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let lcm = cs[0];
  for (let i = 1; i < cs.length; i++) {
    lcm = (lcm / gcd(lcm, cs[i])) * cs[i];
    if (lcm > 3000) return 4; // 太长了,用默认值
  }
  const sec = lcm / 100;
  return sec >= 0.5 && sec <= 30 ? sec : 4;
}
