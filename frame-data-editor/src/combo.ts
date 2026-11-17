// 连段验证器:把一串招按帧逐帧模拟,判断每一步之间对手有没有空档可以防。
//
// 时间轴约定(均为全局帧号,0 起):
//   - 招式 i 从 T 开始,命中帧 = T + startup(第一帧持续帧判定命中)。
//   - 命中/被防硬直 stun 帧:对手在 hitFrame+1 .. hitFrame+stun 期间不可行动,
//     第 hitFrame+stun+1 帧恢复可行动(可以拉防)。
//   - 空档 gap = 下一招命中帧 - (上一招硬直结束帧 + 1)。
//     gap <= 0:对手还没恢复就被打中 → 连段成立;
//     gap >= 1:对手有 gap 帧可以行动 → 可以防,连段断。
//   - 取消:在取消窗口内的接触帧(默认 = 命中帧,可指定)直接打断上一招进入下一招,
//     且下一招必须在上一招的 cancelInto 表里。
//   - 目押(link):上一招全部帧数走完后下一招才开始。
//   - 对手状态由第一招决定:第一招命中则全程吃命中硬直,第一招被防则全程拉防吃防御硬直
//     (此时验证的是压制是否无缝,而不是连段是否成立)。

import { Character, Move, findMove, totalFrames } from './types.js';

export type Via = 'cancel' | 'link';

export interface StepInput {
  moveId: string;
  via: Via;          // 相对上一招的衔接方式(第一步忽略)
  cancelAt?: number; // via = 'cancel' 时指定的取消帧;缺省 = 上一招命中帧
}

export type StepStatus = 'OK' | 'INVALID_CANCEL' | 'INVALID_WINDOW' | 'BLOCKABLE';

export interface StepResult {
  moveId: string;
  moveName: string;
  startFrame: number;
  hitFrame: number;
  gap: number; // 对手可行动的空档帧数;<=0 表示无缝
  status: StepStatus;
  note: string;
}

export type ComboVerdict = 'TRUE_COMBO' | 'BLOCKABLE' | 'INVALID';

export interface ComboResult {
  steps: StepResult[];
  verdict: ComboVerdict;
  totalDamage: number; // 只累计断连之前的伤害
  firstBlocked: boolean;
}

export function simulateCombo(
  char: Character,
  steps: StepInput[],
  firstBlocked: boolean,
): ComboResult {
  const results: StepResult[] = [];
  let verdict: ComboVerdict = 'TRUE_COMBO';
  let totalDamage = 0;

  if (steps.length === 0) return { steps: [], verdict: 'TRUE_COMBO', totalDamage: 0, firstBlocked };

  const first = findMove(char, steps[0].moveId);
  let prevMove: Move = first;
  let prevStart = 0;
  let prevHit = first.startup;
  // 对手硬直结束的帧号(该帧仍不可行动,下一帧才恢复)
  let stunEnd = prevHit + (firstBlocked ? first.blockstun : first.hitstun);
  totalDamage += firstBlocked ? 0 : first.damage;

  results.push({
    moveId: first.id,
    moveName: first.name,
    startFrame: 0,
    hitFrame: prevHit,
    gap: 0,
    status: 'OK',
    note: firstBlocked ? '第一招被防,对手进入防御硬直' : '第一招命中',
  });

  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    const move = findMove(char, step.moveId);
    let startFrame: number;
    let status: StepStatus = 'OK';
    let note = '';

    if (step.via === 'cancel') {
      const cancelAt = step.cancelAt ?? prevMove.startup; // 默认在接触帧取消
      const w = prevMove.cancelWindow;
      if (!w || cancelAt < w.start || cancelAt > w.end) {
        status = 'INVALID_WINDOW';
        note = `第 ${cancelAt} 帧不在 ${prevMove.name} 的取消窗口` +
          (w ? `(${w.start}-${w.end})内` : '(该招没有取消窗口)');
      } else if (!prevMove.cancelInto.includes(move.id)) {
        status = 'INVALID_CANCEL';
        note = `${prevMove.name} 不能取消成 ${move.name}`;
      }
      startFrame = prevStart + cancelAt;
    } else {
      startFrame = prevStart + totalFrames(prevMove); // 目押:等上一招完全结束
    }

    const hitFrame = startFrame + move.startup;
    const gap = hitFrame - stunEnd - 1;

    if (status === 'OK' && gap > 0) {
      status = 'BLOCKABLE';
      note = firstBlocked
        ? `对手有 ${gap} 帧空档,可以抢招或脱身`
        : `对手有 ${gap} 帧空档,可以拉防`;
    } else if (status === 'OK') {
      note = gap === 0 ? '无缝衔接(极限目押/取消)' : `提前 ${-gap} 帧命中,对手还在硬直中`;
    }

    results.push({
      moveId: move.id, moveName: move.name, startFrame, hitFrame, gap, status, note,
    });

    if (status !== 'OK') {
      verdict = status === 'BLOCKABLE' ? 'BLOCKABLE' : 'INVALID';
      break; // 连段在这里就断了
    }

    totalDamage += firstBlocked ? 0 : move.damage;
    stunEnd = hitFrame + (firstBlocked ? move.blockstun : move.hitstun);
    prevMove = move;
    prevStart = startFrame;
  }

  return { steps: results, verdict, totalDamage, firstBlocked };
}
