import type { ApiProtocol } from './types';
import type { SiteType } from './api-types';
import {
  inferProtocol,
  inferSiteType,
  nameFromUrl,
  normalizeBaseUrl,
} from './api-catalog';

/* ==========================================================================
   粘贴识别（设计文档 §5.1、§5.2）

   规矩：
     - **纯本地、离线**，这个文件不许 import 任何 ai/ 里的东西，也不许发请求
     - 只认文本、只吐草稿；存不存、拉不拉模型由界面决定
     - 以后支持新格式只加规则，界面一个字都不用动

   两条规则：
     规则一（主）：按行顺序 —— 名称 → 地址 → 一行或多行 Key
     规则二（兜底）：格式乱了就按 URL 切块，块里的密钥、剩下的当名字
   ========================================================================== */

export interface SiteDraft {
  name: string;
  url: string;
  keys: string[];
  siteType: SiteType;
  protocol: ApiProtocol;
  /** 自动替他改了什么，确认卡上要明说 */
  notes: string[];
  /** 哪几项是猜的 / 空的，确认卡上标黄 */
  uncertain: { name: boolean; url: boolean; keys: boolean };
}

interface RawDraft {
  name: string;
  url: string;
  keys: string[];
}

/* ---------------------------- 判定 ---------------------------- */

const URL_RE = /https?:\/\/[^\s"'<>，,；;、）)】]+/gi;
const BEARER_RE = /^bearer\s+/i;
const PREFIX_KEY_RE = /^(sk|ak)-[A-Za-z0-9._-]{6,}$/i;
/** 长度 ≥ 32 的纯字母数字串，也当 Key（很多中转站不带 sk- 前缀） */
const LONG_TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/;
/** 从词尾去掉的中文标点和引号 */
const TRAILING_JUNK_RE = /[）)】」》"'“”‘’.,，。；;、:：]+$/;
/** 从词首去掉的装饰符号 */
const LEADING_JUNK_RE = /^[\s:：\-—"'“”‘’]+/;
/** 切词：空白和中英文标点都算分隔符 */
const TOKEN_RE = /[^\s,，;；、]+/g;

export function looksLikeUrl(line: string): boolean {
  return /^https?:\/\//i.test(line.trim());
}

function stripBearer(token: string): string {
  return token.trim().replace(BEARER_RE, '');
}

export function looksLikeKey(line: string): boolean {
  const token = stripBearer(line).replace(TRAILING_JUNK_RE, '');
  if (!token) return false;
  return PREFIX_KEY_RE.test(token) || LONG_TOKEN_RE.test(token);
}

/* ---------------------------- 规则一：按行 ---------------------------- */

function parseByLines(text: string): RawDraft[] {
  const drafts: RawDraft[] = [];
  let current: RawDraft | null = null;

  const flush = (): void => {
    if (current && (current.url || current.keys.length > 0)) drafts.push(current);
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (looksLikeUrl(line)) {
      // 已经拿过地址了，又来一个 → 上一个站点到此为止
      if (current?.url) flush();
      // ⚠️ 不能整个换掉：名称行刚填进去的名字要留着
      current ??= { name: '', url: '', keys: [] };
      current.url = line.match(URL_RE)?.[0] ?? line;
      continue;
    }

    if (looksLikeKey(line)) {
      current ??= { name: '', url: '', keys: [] };
      current.keys.push(stripBearer(line).replace(TRAILING_JUNK_RE, ''));
      continue;
    }

    // 普通行 = 名称。前面已经有地址或 Key，说明这是下一个站点的开头
    flush();
    current = { name: line, url: '', keys: [] };
  }

  flush();
  return drafts;
}

/* ---------------------------- 规则二：按 URL 切块 ---------------------------- */

/** 把整段文本里所有像 Key 的词连同位置一起抠出来 */
function keyTokens(text: string): { value: string; at: number }[] {
  const result: { value: string; at: number }[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const value = stripBearer(match[0]).replace(TRAILING_JUNK_RE, '');
    if (looksLikeKey(value)) result.push({ value, at: match.index ?? 0 });
  }
  return result;
}

function nameIn(head: string): string {
  const lines = head
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // 名字通常紧贴在地址上方，从下往上找第一个像名字的短句
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (looksLikeKey(line)) continue;
    const cleaned = line.replace(TRAILING_JUNK_RE, '').replace(LEADING_JUNK_RE, '');
    if (cleaned.length >= 2 && cleaned.length <= 20) return cleaned;
  }
  return '';
}

function parseByScan(text: string): RawDraft[] {
  const urls = [...text.matchAll(URL_RE)].map((match) => {
    const start = match.index ?? 0;
    return { url: match[0].replace(TRAILING_JUNK_RE, ''), start, end: start + match[0].length };
  });
  if (urls.length === 0) return [];

  const drafts: RawDraft[] = urls.map((item, index) => ({
    // 名称取「上一个地址之后、这个地址之前」的那几行
    name: nameIn(text.slice(index === 0 ? 0 : (urls[index - 1]?.end ?? 0), item.start)),
    url: item.url,
    keys: [],
  }));

  // 密钥按「离哪个地址最近」归属：优先挂到它前面那个地址；
  // 写在所有地址之前（一个都还没出现）就挂给第一个地址。
  for (const token of keyTokens(text)) {
    let owner = -1;
    for (let index = 0; index < urls.length; index += 1) {
      if ((urls[index]?.end ?? 0) <= token.at) owner = index;
      else break;
    }
    drafts[owner === -1 ? 0 : owner]?.keys.push(token.value);
  }

  return drafts;
}

/* ---------------------------- 合并与收尾 ---------------------------- */

/** 同一个地址粘了两遍就并成一个，Key 取并集 */
function mergeByUrl(drafts: RawDraft[]): RawDraft[] {
  const merged: RawDraft[] = [];
  for (const draft of drafts) {
    const key = draft.url.replace(/\/+$/, '').toLowerCase();
    const hit = merged.find((item) => item.url.replace(/\/+$/, '').toLowerCase() === key);
    if (hit) {
      hit.keys.push(...draft.keys);
      if (!hit.name && draft.name) hit.name = draft.name;
      continue;
    }
    merged.push({ ...draft, keys: [...draft.keys] });
  }
  return merged;
}

/** 同一个 Key 只留一个，顺序不变 */
function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function finalize(raw: RawDraft): SiteDraft {
  const rawUrl = raw.url.replace(TRAILING_JUNK_RE, '');
  const protocol = inferProtocol(rawUrl);
  const siteType = inferSiteType(rawUrl);
  const { url, note } = normalizeBaseUrl(rawUrl, protocol);

  const notes: string[] = [];
  if (note) notes.push(note);

  const guessName = raw.name.replace(TRAILING_JUNK_RE, '').replace(LEADING_JUNK_RE, '').slice(0, 40);
  const name = guessName || nameFromUrl(rawUrl);
  if (!guessName) notes.push(`名称没认出来，先按域名填了「${name}」`);

  const keys = uniqueKeys(raw.keys);
  if (keys.length === 0) notes.push('没找到 Key，保存前要自己填一个');

  return {
    name,
    url,
    keys,
    siteType,
    protocol,
    notes,
    uncertain: { name: !guessName, url: false, keys: keys.length === 0 },
  };
}

/** 名称重了就加后缀，如「某站 (2)」，免得列表里两张卡一模一样 */
function dedupeNames(drafts: SiteDraft[]): SiteDraft[] {
  const used = new Map<string, number>();
  return drafts.map((draft) => {
    const count = (used.get(draft.name) ?? 0) + 1;
    used.set(draft.name, count);
    return count === 1 ? draft : { ...draft, name: `${draft.name} (${count})` };
  });
}

/**
 * 把一段粘贴文本变成站点草稿。
 * 识别不出任何地址就返回空数组 —— 界面据此提示「没认出来，试试手动添加」。
 */
export function parseSites(text: string): SiteDraft[] {
  if (!text.trim()) return [];

  const byLines = parseByLines(text);
  const clean =
    byLines.length > 0 && byLines.every((draft) => Boolean(draft.url) && draft.keys.length > 0);

  const raw = clean ? byLines : parseByScan(text);
  if (raw.length === 0) return [];

  return dedupeNames(mergeByUrl(raw).map(finalize));
}
