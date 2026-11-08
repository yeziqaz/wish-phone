/**
 * 世界书的选择与拼装。
 *
 * 这里是**纯函数**，不碰 DOM、不碰数据库 —— 所以能单独测，也不会把界面逻辑
 * 拖进提示词里。真正决定「读了哪几条」的规则就三条：
 *
 *   1. 只认挂在**这个角色**身上的书（谁挂谁生效，没挂就不注入）
 *   2. 常驻条目每次都进；非驻留条目要关键词命中才进
 *   3. 总字数有上限，超了就先丢关键词命中的那些，别把上下文撑爆
 *
 * 规则来源：docs/概念梳理-世界书-身份-好友.md §2
 */
import type { Worldbook, WorldbookEntry } from './types';

/**
 * 一次最多注入多少字（中文按 1 字 ≈ 1 token 粗估，4000 字算宽松的上限）。
 * 宁可少给设定，也别让用户的下一条消息被挤出上下文。
 */
export const LORE_BUDGET = 4000;

export interface LoreHit {
  /** 哪个书里的。只用于调试和「这次读了什么」的显示，不进正文 */
  bookName: string;
  entry: WorldbookEntry;
}

/** 关键词是否命中。判断方式是「包含」，不区分大小写 */
export function matchesKeywords(entry: WorldbookEntry, lowerText: string): boolean {
  return entry.keywords.some((keyword) => {
    const key = keyword.trim().toLowerCase();
    return key.length > 0 && lowerText.includes(key);
  });
}

/**
 * 从这些书里挑出这次该进提示词的条目。
 *
 * @param books    角色身上挂的书（已经按 id 取好的）
 * @param scanText 用来找关键词的文本，通常是最近几条消息 + 这句新输入
 */
export function collectLore(
  books: Worldbook[],
  scanText: string,
  budget: number = LORE_BUDGET,
): LoreHit[] {
  const lowerText = scanText.toLowerCase();
  const seen = new Set<string>();
  const picked: LoreHit[] = [];
  let used = 0;

  const push = (bookName: string, entry: WorldbookEntry): void => {
    // 同一本书里重复的 id、或者两本书里碰巧撞了 id，都只算一次
    if (seen.has(entry.id)) return;
    const cost = entry.content.length;
    // 超预算就跳过这一条，后面的短条目还能进
    if (used + cost > budget) return;
    seen.add(entry.id);
    used += cost;
    picked.push({ bookName, entry });
  };

  // 两轮：先常驻（不依赖命中，优先级更高），再关键词
  for (const constantPass of [true, false]) {
    for (const book of books) {
      for (const entry of book.entries) {
        if (!entry.enabled) continue;
        if (!entry.content.trim()) continue;
        if (Boolean(entry.constant) !== constantPass) continue;
        if (!constantPass && !matchesKeywords(entry, lowerText)) continue;
        push(book.name, entry);
      }
    }
  }

  return picked;
}

/**
 * 拼成提示词里的一段。没命中就返回空串，调用方直接当成「没有世界书」。
 *
 * 不加「来自哪本书」这类前缀：模型不需要知道书的组织结构，
 * 加了反而容易被它复述出来（「根据设定里写的……」）。
 */
export function renderLore(hits: LoreHit[]): string {
  if (hits.length === 0) return '';
  return `【设定】\n${hits.map((hit) => hit.entry.content.trim()).join('\n\n')}`;
}
