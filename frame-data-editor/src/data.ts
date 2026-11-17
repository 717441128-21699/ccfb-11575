// 示例角色数据。判定框按"朝右"存储,原点 = 角色脚底中心,y 向下为正。

import { Box, Character, FrameBoxes, Move, totalFrames } from './types.js';

const STAND_HURT: Box = { x: -20, y: -110, w: 40, h: 110 };

interface MoveSpec {
  id: string; name: string; command: string;
  startup: number; active: number; recovery: number;
  damage: number; hitstun: number; blockstun: number;
  cancelWindow: { start: number; end: number } | null;
  cancelInto: string[];
  hitbox: Box | null; // 持续帧的攻击框
}

function buildMove(spec: MoveSpec): Move {
  const { id, name, command, startup, active, recovery, damage, hitstun, blockstun,
    cancelWindow, cancelInto, hitbox } = spec;
  const m: Move = {
    id, name, command, startup, active, recovery, damage, hitstun, blockstun,
    cancelWindow, cancelInto: [...cancelInto], frames: [],
  };
  for (let f = 0; f < totalFrames(m); f++) {
    const isActive = f >= startup && f < startup + active;
    const frame: FrameBoxes = {
      hit: isActive && hitbox ? [{ ...hitbox }] : [],
      hurt: [{ ...STAND_HURT }],
    };
    m.frames.push(frame);
  }
  return m;
}

export function createSampleCharacter(): Character {
  return {
    id: 'arashi',
    name: '阿岚',
    moves: [
      buildMove({
        id: '5A', name: '轻拳', command: '5P',
        startup: 4, active: 3, recovery: 7,
        damage: 30, hitstun: 14, blockstun: 10,
        cancelWindow: { start: 4, end: 9 },
        cancelInto: ['5A', '5B', '5C', '236A', '236B'],
        hitbox: { x: 18, y: -92, w: 42, h: 22 },
      }),
      buildMove({
        id: '5B', name: '中拳', command: '5K',
        startup: 7, active: 4, recovery: 12,
        damage: 60, hitstun: 16, blockstun: 12,
        cancelWindow: { start: 7, end: 13 },
        cancelInto: ['5C', '236A', '236B'],
        hitbox: { x: 20, y: -88, w: 56, h: 26 },
      }),
      buildMove({
        id: '5C', name: '重拳', command: '6P',
        startup: 11, active: 5, recovery: 18,
        damage: 90, hitstun: 20, blockstun: 14,
        cancelWindow: { start: 11, end: 17 },
        cancelInto: ['236A', '236B', '236236A'],
        hitbox: { x: 22, y: -96, w: 68, h: 34 },
      }),
      buildMove({
        id: '236A', name: '波动拳', command: '236P',
        startup: 12, active: 6, recovery: 20,
        damage: 80, hitstun: 22, blockstun: 16,
        cancelWindow: null, cancelInto: [],
        hitbox: { x: 30, y: -80, w: 60, h: 40 },
      }),
      buildMove({
        id: '236B', name: '升龙拳', command: '623P',
        startup: 6, active: 8, recovery: 26,
        damage: 120, hitstun: 26, blockstun: 10,
        cancelWindow: null, cancelInto: [],
        hitbox: { x: 10, y: -140, w: 44, h: 90 },
      }),
      buildMove({
        id: '236236A', name: '超必杀·疾风乱舞', command: '236236P',
        startup: 24, active: 8, recovery: 30,
        damage: 200, hitstun: 30, blockstun: 18,
        cancelWindow: null, cancelInto: [],
        hitbox: { x: 24, y: -100, w: 90, h: 60 },
      }),
    ],
  };
}
