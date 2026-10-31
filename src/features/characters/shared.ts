import { newId } from '../../core/db';
import type { Character } from '../../core/types';

/**
 * 角色这一块共用的东西。
 * 同目录的文件之间可以互相引用（AGENTS.md 禁止的是**跨 feature 目录**互引）。
 */

/** 一个全新的空角色（用户手填，不是从角色卡导入的） */
export function blankCharacter(name = ''): Character {
  const now = Date.now();
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    spec: 'manual',
    source: 'manual',

    name,
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    alternateGreetings: [],
    mesExample: '',

    raw: null,

    systemPrompt: '',
    postHistoryInstructions: '',
    creatorNotes: '',
    tags: [],
    creator: '',
    characterVersion: '',
    extensions: {},
  };
}

/** 列表上那一行小字：优先用描述，没写就提示还没填 */
export function characterSummary(character: Character): string {
  const text = character.description.replace(/\s+/g, ' ').trim();
  if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  if (character.personality.trim()) return '已经写了性格，描述还没填';
  return '还没写描述';
}

/** 这个角色有没有做过开场白 —— 建会话时要靠它 */
export function hasGreeting(character: Character): boolean {
  return (
    character.firstMes.trim().length > 0 ||
    character.alternateGreetings.some((item) => item.trim().length > 0)
  );
}
