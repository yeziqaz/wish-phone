/* ==========================================================================
   一轮回复拆成多个气泡

   为什么要有这一层：微信、QQ、豆包上的对话是「一条消息 = 一口气」，
   两三行就停，隔一下再发下一条。而模型一次吐出来的往往是一大段，
   直接显示成一个大气泡，读起来像在看文章，不像在聊天。

   ⚠️ 但「拆」是有边界的 —— 见 PASSTHROUGH：
     代码、表格、命令行、引用块这些，拆开就没法用了。

   规则常量都在这里，用户改数字即可，不用碰逻辑。
   这是纯函数，不碰 DOM，所以可以单测（tests/chat-split.test.ts）。
   ========================================================================== */

/** 一轮最多几个气泡 */
export const MAX_BUBBLES = 8;
/** 单个气泡最多多少字，超过就在句末标点处断开 */
export const MAX_CHARS = 60;

/**
 * 不该被拆开的内容，整块原样保留。
 *
 * 为什么要有这一条：
 *   wuli 这类「干活的」角色会贴代码、贴命令、贴表格。
 *   代码里的换行是语法的一部分，拆成多个气泡就直接坏了。
 *
 * 判断方式：整段（或整行）以这些标记开头/包裹时，视为不可拆块。
 */
const PASSTHROUGH_PATTERNS: RegExp[] = [
  // ``` 围起来的代码块（可能带语言标记）
  /^```[\s\S]*?```$/,
  // Markdown 表格：至少两行，且含 | 分隔
  /^\|?.*\|.*\n\s*\|?[\s:\-|]+$/,
  // 命令行 / 终端输出：以 $ 或 > 开头
  /^[$>]\s/,
  // 缩进代码块：四空格或制表符开头
  /^(?: {4}|\t)/,
];

/** 这一段是不是「整块保留、不许拆」 */
function isPassthrough(block: string): boolean {
  return PASSTHROUGH_PATTERNS.some((pattern) => pattern.test(block));
}

/**
 * 把文本切成「可拆区」和「不可拆区」交替的片段。
 *
 * 代码块（``` ... ```）会连同围栏一起保留为不可拆区；
 * 其余部分照常按换行处理。
 */
function segment(text: string): Array<{ text: string; fixed: boolean }> {
  const out: Array<{ text: string; fixed: boolean }> = [];

  // 先把 ``` 代码块整体捞出来，剩下的按普通文本处理
  const fence = /```[\s\S]*?```/g;
  let cursor = 0;
  let match = fence.exec(text);

  while (match) {
    if (match.index > cursor) {
      out.push({ text: text.slice(cursor, match.index), fixed: false });
    }
    out.push({ text: match[0], fixed: true });
    cursor = match.index + match[0].length;
    match = fence.exec(text);
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor), fixed: false });
  }

  return out;
}

/**
 * 按句末标点把一段过长的文字切开。
 * 只在「已经超过 MAX_CHARS」时才切，且优先切在 。！？… 之后；
 * 找不到合适断点就原样返回 —— 宁可留一个长气泡，也不要在词中间断开。
 */
function breakLongLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];

  const pieces: string[] = [];
  let rest = line;
  // 句末标点 + 紧随的引号 / 括号都要一起留在这句里
  const sentenceEnd = /[。！？…!?]+[」』”’）)]*/g;

  while (rest.length > maxChars) {
    let cut = -1;
    sentenceEnd.lastIndex = 0;
    let match = sentenceEnd.exec(rest);
    while (match) {
      const end = match.index + match[0].length;
      if (end <= maxChars) cut = end;
      else break;
      match = sentenceEnd.exec(rest);
    }
    if (cut <= 0) break; // 这一行没有合适的句末标点，别硬切

    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

/**
 * 把一轮 AI 回复拆成若干个气泡。
 *
 * @param text 已经剥掉动作描写的「说出口的话」
 * @returns 至少 1 条；内容为空时返回空数组
 */
export interface SplitOptions {
  /** 单条最多几个字。默认 MAX_CHARS */
  maxChars?: number;
  /** 一轮最多几条。默认 MAX_BUBBLES */
  maxBubbles?: number;
}

export function splitIntoBubbles(text: string, options: SplitOptions = {}): string[] {
  const maxChars = options.maxChars ?? MAX_CHARS;
  const maxBubbles = options.maxBubbles ?? MAX_BUBBLES;
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks = segment(trimmed);
  const lines: string[] = [];

  for (const chunk of chunks) {
    if (chunk.fixed) {
      // 代码块这类整块塞进一个气泡，一个字都不动
      const whole = chunk.text.trim();
      if (whole) lines.push(whole);
      continue;
    }

    // 普通文本：按换行拆，空行和单个换行都算断点
    for (const line of chunk.text.split(/\n+/)) {
      const piece = line.trim();
      if (!piece) continue;
      // 表格、命令、缩进代码这类整行保留
      if (isPassthrough(piece)) {
        lines.push(piece);
        continue;
      }
      lines.push(...breakLongLine(piece, maxChars));
    }
  }

  if (lines.length === 0) return [trimmed];

  // 超过上限就合并相邻的短行，而不是丢掉内容。
  // 但不合并「不许拆」的块 —— 代码和表格必须独立成泡。
  while (lines.length > maxBubbles) {
    let shortest = 1;
    let shortestLen = Infinity;
    for (let i = 1; i < lines.length; i += 1) {
      const prev = lines[i - 1];
      const cur = lines[i];
      if (!prev || !cur) continue;
      // 两边都不能是固定块
      if (isPassthrough(prev) || isPassthrough(cur) || prev.includes('```') || cur.includes('```')) {
        continue;
      }
      if (prev.length + cur.length < shortestLen) {
        shortestLen = prev.length + cur.length;
        shortest = i;
      }
    }
    // 全是固定块、没得合并：直接退出，宁可超出上限也不破坏内容
    if (shortestLen === Infinity) break;
    const merged = `${lines[shortest - 1] ?? ''}\n${lines[shortest] ?? ''}`;
    lines.splice(shortest - 1, 2, merged);
  }

  return lines;
}
/**
 * 拆分尺子按角色定位给。
 *
 * 角色扮演的角色：一条一口气，60 字，最多 8 条 —— 像真人连发。
 * wuli（助手）：单条放宽到 120 字，最多 6 条 —— 它常要把步骤说完整，
 *   60 字会把「第一步：打开设置」这种话和下一句硬粘在一起。
 *
 * 代码块在两种情况下都整块保留（见上面的 PASSTHROUGH_PATTERNS）。
 */
export function splitOptionsFor(character: { builtin?: boolean }): SplitOptions {
  return character.builtin
    ? { maxChars: 120, maxBubbles: 6 }
    : { maxChars: 60, maxBubbles: 8 };
}
