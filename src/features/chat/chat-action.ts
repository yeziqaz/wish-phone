/**
 * 把 AI 回复中的中文圆括号或星号动作（如 "(尾巴一甩...)"、"*微笑*"）
 * 从正文中分离出来，返回 { actionText, mainText }。
 * 用于实现「此刻/动作小窗」沉浸式展示，避免括号动作直接污染纯对话流。
 */
export function parseCharacterAction(content: string): { actionText: string | null; mainText: string } {
  const trimmed = content.trim();
  const match = trimmed.match(/^[\(\（]([^\)\）]+)[\)\）]\s*([\s\S]*)$/);
  if (match && match[1]) {
    return {
      actionText: match[1].trim(),
      mainText: match[2] ? match[2].trim() || trimmed : trimmed,
    };
  }

  const asteriskMatch = trimmed.match(/^\*([^\*]+)\*\s*([\s\S]*)$/);
  if (asteriskMatch && asteriskMatch[1]) {
    return {
      actionText: asteriskMatch[1].trim(),
      mainText: asteriskMatch[2] ? asteriskMatch[2].trim() || trimmed : trimmed,
    };
  }

  return { actionText: null, mainText: content };
}
