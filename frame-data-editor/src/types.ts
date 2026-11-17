// 核心数据模型:判定框以角色脚底为原点,x 向右(角色朝右时),y 向下。
// 所有框在存储时一律按"朝右"记录,渲染时根据朝向做镜像。

export interface Box {
  x: number; // 左上角 x(相对原点)
  y: number; // 左上角 y(相对原点,向下为正,所以站立受击框 y 为负)
  w: number;
  h: number;
}

export interface FrameBoxes {
  hit: Box[];   // 攻击框(红)
  hurt: Box[];  // 受击框(绿)
}

export interface CancelWindow {
  start: number; // 招式时间轴上的帧号(含),0 起
  end: number;   // 含
}

export interface Move {
  id: string;
  name: string;
  command: string;      // 搓招指令,如 "236P";普通技可为 "5P" 或 ""
  startup: number;      // 发生帧
  active: number;       // 持续帧
  recovery: number;     // 收招帧
  damage: number;
  hitstun: number;      // 命中硬直(帧)
  blockstun: number;    // 防御硬直(帧)
  cancelWindow: CancelWindow | null;
  cancelInto: string[]; // 可取消成的招式 id
  frames: FrameBoxes[]; // 长度 = startup + active + recovery
}

export interface Character {
  id: string;
  name: string;
  moves: Move[];
}

export type Phase = 'startup' | 'active' | 'recovery';

export const totalFrames = (m: Move): number => m.startup + m.active + m.recovery;

export function findMove(char: Character, id: string): Move {
  const m = char.moves.find((mm) => mm.id === id);
  if (!m) throw new Error(`未知招式: ${id}`);
  return m;
}
