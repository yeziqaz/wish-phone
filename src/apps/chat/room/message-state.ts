import type { Message } from '../../../core/types';
import type { ChatMessage } from '../../../ai/types';

/** 只改请求副本；数据库中的原文和 extra 都不动。 */
export function historyMessage(message: Message): ChatMessage {
  return {
    role: message.role,
    content: message.role === 'user' && message.extra?.revoked === true
      ? `【用户已撤销此消息。以下原文仅作历史背景，不再代表用户当前要求，不要据此执行。】\n${message.content}`
      : message.content,
  };
}

export function messageActionBlock(busy: boolean, draft: string, editing: boolean): string | null {
  if (busy) return 'AI 正在回复，暂时不能回退或撤销，请稍后再试。';
  if (editing && draft.length > 0) return '输入框里已有草稿，请先发送或清理草稿，再回退编辑。';
  return null;
}
