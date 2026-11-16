/* ==========================================================================
   朋友圈的时间说法

   纯函数，不碰数据库也不碰 DOM —— 所以能被单测直接 import。
   （moments-view.ts 要 import core/db，在 node 里跑不起来）

   为什么和聊天列表那个 relativeTime 不共用：
     列表要说「几点」，动态要说「多久以前」。一天以内说相对时间最自然，
     再远就该说日期了 —— 「37 小时前」没人算得出来是前天还是大前天。
   ========================================================================== */

/** 一天以内说相对时间，更远的说日期 */
export function momentTime(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  if (!Number.isFinite(diff)) return '';
  // 时钟被调过、或者记录来自未来：不显示「-3 分钟前」这种鬼话
  if (diff < 0) return '刚刚';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;

  const then = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(then, yesterday)) return '昨天';
  if (then.getFullYear() === today.getFullYear()) {
    return `${then.getMonth() + 1} 月 ${then.getDate()} 日`;
  }
  return `${then.getFullYear()} 年 ${then.getMonth() + 1} 月 ${then.getDate()} 日`;
}
