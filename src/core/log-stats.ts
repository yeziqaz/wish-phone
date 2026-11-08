import type { Capability, RequestLog } from './api-types';

/* ==========================================================================
   日志统计（纯函数，好测）

   用量页、站点日志 Tab 都从这里算，别各写一份。
   ⚠️ Token 只做加法，**不许估算**（文档 §14）：
      全是 null 的组，结果是 null 而不是 0，界面显示「—」。
   ========================================================================== */

export interface Bucket {
  key: string;
  label: string;
  count: number;
  errors: number;
  /** 一条都没返回用量时是 null */
  inputTokens: number | null;
  outputTokens: number | null;
}

/** 加 Token：全都是 null 就还是 null */
function addTokens(values: Array<number | null>): number | null {
  const real = values.filter((value): value is number => typeof value === 'number');
  return real.length === 0 ? null : real.reduce((sum, value) => sum + value, 0);
}

export function summarize(logs: RequestLog[]): {
  count: number;
  errors: number;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  return {
    count: logs.length,
    errors: logs.filter((log) => log.status === 'error').length,
    inputTokens: addTokens(logs.map((log) => log.inputTokens)),
    outputTokens: addTokens(logs.map((log) => log.outputTokens)),
  };
}

/** 按某个维度分组。keyOf 返回 '' 的分到「未记录」 */
export function bucketBy(
  logs: RequestLog[],
  keyOf: (log: RequestLog) => string,
  labelOf?: (key: string, logs: RequestLog[]) => string,
): Bucket[] {
  const groups = new Map<string, RequestLog[]>();
  for (const log of logs) {
    const key = keyOf(log) || '';
    const found = groups.get(key);
    if (found) found.push(log);
    else groups.set(key, [log]);
  }

  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      label: labelOf ? labelOf(key, items) : key || '未记录',
      count: items.length,
      errors: items.filter((log) => log.status === 'error').length,
      inputTokens: addTokens(items.map((log) => log.inputTokens)),
      outputTokens: addTokens(items.map((log) => log.outputTokens)),
    }))
    .sort((a, b) => b.count - a.count);
}

/** 这个月（按本地时区）的起始时间戳 */
export function monthStart(now = Date.now()): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** 今天零点 */
export function dayStart(now = Date.now()): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 今天 / 本月各多少条、多少 Token */
export function rangeStats(logs: RequestLog[], since: number): {
  count: number;
  errors: number;
  tokens: number | null;
} {
  const picked = logs.filter((log) => log.time >= since);
  const input = addTokens(picked.map((log) => log.inputTokens));
  const output = addTokens(picked.map((log) => log.outputTokens));
  return {
    count: picked.length,
    errors: picked.filter((log) => log.status === 'error').length,
    tokens: input === null && output === null ? null : (input ?? 0) + (output ?? 0),
  };
}

/** 一个能力英文 key 换成中文。日志里存的是英文 */
export function kindLabel(kind: Capability): string {
  switch (kind) {
    case 'text':
      return '文本';
    case 'image':
      return '生图';
    case 'vision':
      return '看图';
    case 'video':
      return '生视频';
    case 'tts':
      return '语音';
    case 'embedding':
      return '向量';
    default:
      return kind;
  }
}

/** 时间戳 → 「今天 14:32」「昨天 09:10」「11-02 18:20」 */
export function logTime(time: number, now = Date.now()): string {
  const date = new Date(time);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');

  if (time >= dayStart(now)) return `今天 ${hh}:${mm}`;
  if (time >= dayStart(now - 86_400_000)) return `昨天 ${hh}:${mm}`;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day} ${hh}:${mm}`;
}

/** 耗时的人话：<1s 显示毫秒，其余显示一位小数的秒 */
export function durationText(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
