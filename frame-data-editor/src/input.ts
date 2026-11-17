// 输入缓冲与搓招识别。
// 方向用小键盘记法:7 8 9 / 4 5 6 / 1 2 3(6 = 前,2 = 下,假设角色朝右)。
// 指令串如 "236P":前面的数字是方向序列,末尾字母是按键。
// 识别规则:在 buffer 帧窗口内,方向序列作为子序列出现(允许中间夹杂其它方向),
// 最后按下对应按键即成立。

export interface InputEvent {
  frame: number;
  dir: number;          // 1-9,5 = 回中
  buttons: string[];    // 该帧按下的键,如 ["P"]
}

export interface ParsedCommand {
  dirs: number[];
  button: string | null;
}

export function parseCommand(cmd: string): ParsedCommand {
  const dirs: number[] = [];
  let button: string | null = null;
  for (const ch of cmd.trim()) {
    if (ch >= '1' && ch <= '9') dirs.push(Number(ch));
    else if (/[A-Za-z]/.test(ch)) button = ch.toUpperCase();
  }
  return { dirs, button };
}

// 在 atFrame 这一刻判定指令是否成立。
export function matchCommand(
  events: InputEvent[],
  cmd: string,
  buffer: number,
  atFrame: number,
): boolean {
  const { dirs, button } = parseCommand(cmd);
  const windowStart = atFrame - buffer;
  const inWindow = events
    .filter((e) => e.frame > windowStart && e.frame <= atFrame)
    .sort((a, b) => a.frame - b.frame);

  // 按键锚点:窗口内最后一次按下该键的事件;指令无按键则以窗口末尾为锚。
  let anchorIdx = inWindow.length - 1;
  if (button) {
    anchorIdx = -1;
    for (let i = inWindow.length - 1; i >= 0; i--) {
      if (inWindow[i].buttons.includes(button)) { anchorIdx = i; break; }
    }
    if (anchorIdx < 0) return false;
  }

  // 方向子序列匹配(锚点之前,含锚点帧的方向)
  let need = 0;
  for (let i = 0; i <= anchorIdx && need < dirs.length; i++) {
    if (inWindow[i].dir === dirs[need]) need++;
  }
  return need === dirs.length;
}

// 从一串输入里识别出所有成立的招式指令,返回指令串列表。
export function recognizeCommands(
  events: InputEvent[],
  commands: string[],
  buffer: number,
  atFrame: number,
): string[] {
  return commands.filter((c) => c.length > 0 && matchCommand(events, c, buffer, atFrame));
}
