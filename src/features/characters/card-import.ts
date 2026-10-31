import type { Character, Lorebook } from '../../core/types';
import { blankCharacter } from './shared';

/* ==========================================================================
   角色卡导入

   支持两种东西：
     1. PNG 角色卡 —— 图里藏着一个 tEXt 块，key 是 chara（V2）或 ccv3（V3）
     2. 纯 JSON    —— 直接就是卡的内容

   ⚠️ 铁律（AGENTS.md §4.1）：
      原始 JSON 必须原样留在 character.raw 里。
      导出时以它为基准，绝不能拿我们的字段重建 —— 规范明文要求
      MUST NOT destroy unknown keys，重建会把别人的 extensions 抹掉。
   ========================================================================== */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** base64 → 能正确解码中文的字符串 */
function base64ToText(value: string): string {
  const cleaned = value.replace(/[\s\r\n]+/g, '');
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** 把 PNG 里所有 tEXt 块读出来 */
function readPngTexts(buffer: ArrayBuffer): Record<string, string> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8) throw new Error('文件太小，不像一张 PNG');
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('这不是 PNG 文件');
  }

  const view = new DataView(buffer);
  const latin1 = new TextDecoder('latin1');
  const texts: Record<string, string> = {};
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = latin1.decode(bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === 'tEXt') {
      const chunk = bytes.subarray(dataStart, dataEnd);
      const zero = chunk.indexOf(0);
      if (zero > 0) {
        const keyword = latin1.decode(chunk.subarray(0, zero));
        const text = latin1.decode(chunk.subarray(zero + 1));
        texts[keyword] = text;
      }
    }

    // length(4) + type(4) + data + crc(4)
    offset = dataEnd + 4;
  }

  return texts;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * 把一份角色卡 JSON 变成我们的 Character。
 * 认 V2（spec + data 包一层）和 V1（字段平铺）两种。
 */
export function characterFromCard(raw: unknown, source: 'json' | 'png'): Character {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('角色卡内容不是对象');
  }
  const card = raw as Record<string, unknown>;

  const spec = str(card.spec);
  // V2/V3 把内容包在 data 里；V1 是平铺的
  const data =
    card.data && typeof card.data === 'object' && !Array.isArray(card.data)
      ? (card.data as Record<string, unknown>)
      : card;

  const character = blankCharacter(str(data.name).trim() || '未命名角色');
  character.source = source;
  character.spec = spec === 'chara_card_v3' ? 'v3' : spec === 'chara_card_v2' ? 'v2' : 'v1';

  character.description = str(data.description);
  character.personality = str(data.personality);
  character.scenario = str(data.scenario);
  character.firstMes = str(data.first_mes);
  character.alternateGreetings = strArray(data.alternate_greetings);
  character.mesExample = str(data.mes_example);

  character.systemPrompt = str(data.system_prompt);
  character.postHistoryInstructions = str(data.post_history_instructions);

  // 下面这几项只展示，永远不进提示词
  character.creatorNotes = str(data.creator_notes);
  character.tags = strArray(data.tags);
  character.creator = str(data.creator);
  character.characterVersion = str(data.character_version);

  if (data.extensions && typeof data.extensions === 'object' && !Array.isArray(data.extensions)) {
    character.extensions = data.extensions as Record<string, unknown>;
  }

  // 世界书：有就存着，第一版不做嵌入逻辑
  if (data.character_book && typeof data.character_book === 'object') {
    character.lorebook = data.character_book as Lorebook;
  }

  // V3 才有的
  if (typeof data.nickname === 'string') character.nickname = data.nickname;
  if (Array.isArray(data.assets)) character.assets = data.assets;
  if (Array.isArray(data.source_urls)) character.sourceUrls = strArray(data.source_urls);

  // ⚠️ 原文照留，导出时靠它回写
  character.raw = raw;

  return character;
}

/** 从一张 PNG 里取出角色卡 */
export function characterFromPng(buffer: ArrayBuffer): Character {
  const texts = readPngTexts(buffer);

  // V3 优先
  const payload = texts.ccv3 ?? texts.chara;
  if (!payload) {
    throw new Error('这张 PNG 里没有角色卡数据（找不到 chara / ccv3 块）');
  }

  let json: unknown;
  try {
    json = JSON.parse(base64ToText(payload));
  } catch {
    throw new Error('PNG 里的角色卡数据解不出来，可能不是标准的角色卡');
  }

  return characterFromCard(json, 'png');
}

/** 从一份 JSON 文本里取出角色卡 */
export function characterFromJsonText(text: string): Character {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('这不是有效的 JSON');
  }
  return characterFromCard(json, 'json');
}

/** 读用户选的那个文件，猜它是 PNG 还是 JSON */
export async function characterFromFile(file: File): Promise<Character> {
  const isPng =
    file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');

  if (isPng) {
    return characterFromPng(await file.arrayBuffer());
  }
  return characterFromJsonText(await file.text());
}
