/* ==========================================================================
   聊天室的时间显示

   只显示「时:分」，不显示日期 —— 聊天里日期是靠分隔条提示的，
   每条消息都顶一个完整时间会让消息流变得很吵。
   ========================================================================== */

import type { Message } from '../../../core/types';

/** 消息旁边的时间：只有时和分 */
export function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * 要不要在这一条前面插入时间分隔条。
 *
 * 5 分钟是「还在一段对话里」和「隔了一会儿」的分界：
 * 更短会让分隔条满天飞，更长会让人分不清先后。
 */
export function shouldShowTime(previous: Message | undefined, current: Message): boolean {
  if (!previous) return true;
  const a = new Date(previous.createdAt).getTime();
  const b = new Date(current.createdAt).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? b - a > 5 * 60 * 1000 : false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
