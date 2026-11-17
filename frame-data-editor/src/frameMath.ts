// 帧数学:阶段划分、有利/不利帧、确反判定。

import { Move, Phase, totalFrames } from './types.js';

export function phaseOfFrame(m: Move, f: number): Phase {
  if (f < m.startup) return 'startup';
  if (f < m.startup + m.active) return 'active';
  return 'recovery';
}

// 命中后攻击方的有利帧数(假设第一帧持续帧命中)。
// = 对手硬直 - 命中后自己还要僵的帧数(剩余持续帧 + 收招帧)
export function advantageOnHit(m: Move): number {
  return m.hitstun - (m.active - 1) - m.recovery;
}

// 被防后的有利帧数(负值 = 不利,可能被确反)
export function advantageOnBlock(m: Move): number {
  return m.blockstun - (m.active - 1) - m.recovery;
}

// 防守方能否用某招确反:攻击方不利帧为 -adv,防守方先动 -adv 帧,
// 招式发生帧 <= 这个空档即可在攻击方恢复前命中。
export function canPunish(advantageOfAttacker: number, defenderMove: Move): boolean {
  return advantageOfAttacker < 0 && defenderMove.startup <= -advantageOfAttacker;
}

export interface AdvantageReport {
  moveId: string;
  onHit: number;
  onBlock: number;
  total: number;
}

export function advantageReport(m: Move): AdvantageReport {
  return { moveId: m.id, onHit: advantageOnHit(m), onBlock: advantageOnBlock(m), total: totalFrames(m) };
}
