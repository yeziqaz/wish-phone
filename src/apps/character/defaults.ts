import {
  getSetting,
  listCharacters,
  listConversations,
  listMessages,
  putCharacter,
  putMessage,
  setSetting,
} from '../../core/db';
import { ensureWorlds, resolveBranch } from '../../core/worlds';
import type { Character } from '../../core/types';
import { blankCharacter } from './shared';
import { isLegacyWuliGreeting, upgradeWuliCard, wuliCardText } from './wuli-card';

/**
 * 内置角色 wuli。
 *
 * wuli 是这台愿望机的默认小狐狸管家（用户 2026-10-31 给的形象）。
 * 「默认角色」的意思是：第一次打开就有一张能直接用的卡，不用先导入。
 *
 * 注意：用户删掉 wuli 之后，不会在下次启动时又冒出来 ——
 * 用设置里的一次性标记 wuliSeeded 记住「已经给过了」。
 */

const WULI_SEEDED_KEY = 'wuliSeeded';

/**
 * 内置角色卡的版本号。
 *
 * 为什么要版本号：wuli 的卡只在首次启动时写入数据库，
 * 之后改 defaults.ts 对老用户没有任何影响 —— 他们的库里还是旧卡。
 * 早期用户拿到的「黏人嘴甜版」和现在这版差别很大，所以需要一次迁移。
 *
 * 迁移范围严格限定：
 *   ✅ 只替换 id === 'wuli' 且 builtin === true 的那一张卡的文字字段
 *   ❌ 不动角色 id / 世界归属 / 创建时间
 *   ❌ 不动任何消息和会话（聊天记录一个字都不碰）
 *   ❌ 不动用户自己建的角色
 *
 * 版本变了就再跑一次，跑了就记下来，不会重复。
 */
const WULI_CARD_VERSION_KEY = 'wuliCardVersion';
const WULI_CARD_VERSION = 2;

/**
 * 开场白的版本号。
 *
 * 和角色卡版本分开记：
 *   角色卡改了，只需覆盖卡面文字；
 *   开场白改了，必须动「已经复制成消息的那一条」—— 这是两件不同的事，
 *   混用一个版本号会让其中一半永远跑不到。
 */
const WULI_GREETING_VERSION_KEY = 'wuliGreetingVersion';
const WULI_GREETING_VERSION = 2;

function wuliCard(): Character {
  const text = wuliCardText();
  return {
    ...blankCharacter(text.name),
    id: 'wuli',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    avatarKey: 'builtin:wuli',
    builtin: true,
    ...text,
  };
}

/**
 * 把老版本的 wuli 卡升级成当前版本。
 *
 * 只覆盖「卡的文字内容」，其余字段原样保留：
 *   - id / worldId / branchId / createdAt：保留（否则会话和世界归属会断）
 *   - avatarFrame：保留（用户自己挑的头像框，不该被重置）
 */
async function migrateWuliCard(): Promise<void> {
  const version = await getSetting<number>(WULI_CARD_VERSION_KEY);
  if (typeof version === 'number' && version >= WULI_CARD_VERSION) return;

  const characters = await listCharacters();
  const existing = characters.find((c) => c.id === 'wuli' && c.builtin === true);

  // 没有这张卡（用户删了，或者还没种下去）就不用迁移 —— 交给 seed 处理
  if (existing) {
    await putCharacter(upgradeWuliCard(existing, Date.now()));
  }

  await setSetting(WULI_CARD_VERSION_KEY, WULI_CARD_VERSION);
}

/**
 * 替换「已经存在数据库里的旧开场白」。
 *
 * 为什么需要：
 *   开场白在**第一次进入聊天**时就复制成一条消息存进 messages 表了
 *   （见 chat.ts 的 greetingOf + putMessage）。之后改角色卡的 firstMes，
 *   那条旧消息不会跟着变 —— 用户会看到聊天里是旧问候语。
 *
 * 迁移范围（极窄）：
 *   ✅ 只改 wuli 的会话里、role === 'assistant'、且是**第一条**消息
 *   ✅ 且它必须正好等于某个已知的旧开场白（防止误伤用户后来发的消息）
 *   ❌ 不动第二条及以后的所有消息
 *   ❌ 不动用户自己发的消息
 *   ❌ 不动其他角色的会话
 */
async function migrateWuliGreeting(): Promise<void> {
  const version = await getSetting<number>(WULI_GREETING_VERSION_KEY);
  if (typeof version === 'number' && version >= WULI_GREETING_VERSION) return;

  const fresh = wuliCardText().firstMes;
  const conversations = await listConversations('wuli');

  for (const conversation of conversations) {
    const history = await listMessages(conversation.id);
    const first = history[0];
    if (!first || first.role !== 'assistant') continue;

    // 只认已知的旧开场白。不认识的就不动 —— 宁可漏改，不许误改
    if (!isLegacyWuliGreeting(first.content, first.role, 0)) continue;

    await putMessage({ ...first, content: fresh });
  }

  await setSetting(WULI_GREETING_VERSION_KEY, WULI_GREETING_VERSION);
}

async function seed(): Promise<void> {
  const world = await ensureWorlds();
  const branch = await resolveBranch(world);

  const seeded = await getSetting<boolean>(WULI_SEEDED_KEY);
  if (!seeded) {
    // 极端情况：已经有一张叫 wuli 的手动卡，就不再塞第二张
    const characters = await listCharacters();
    const exists = characters.some((c) => c.id === 'wuli' || c.name.trim().toLowerCase() === 'wuli');
    if (!exists && branch) {
      await putCharacter({
        ...wuliCard(),
        worldId: world.id,
        branchId: branch.id,
      });
    }
    await setSetting(WULI_SEEDED_KEY, true);
  }

  // 无论刚种下去的还是早就有的，都检查一次版本
  await migrateWuliCard();
  await migrateWuliGreeting();
}

/**
 * 手动强制重跑迁移（连版本号也一起重置）。
 *
 * 用途：迁移逻辑本身有 bug 时，用户不用清数据 —— 点一下就能重来。
 * 入口在角色档案页（内置角色那张卡的「重装最新设定」）。
 */
export async function forceReapplyBuiltins(): Promise<void> {
  await setSetting(WULI_CARD_VERSION_KEY, 0);
  await setSetting(WULI_GREETING_VERSION_KEY, 0);
  await migrateWuliCard();
  await migrateWuliGreeting();
}

/** 当前两个版本号的实际值，给诊断用 */
export async function builtinVersionInfo(): Promise<{ card: number; greeting: number }> {
  const card = await getSetting<number>(WULI_CARD_VERSION_KEY);
  const greeting = await getSetting<number>(WULI_GREETING_VERSION_KEY);
  return {
    card: typeof card === 'number' ? card : 0,
    greeting: typeof greeting === 'number' ? greeting : 0,
  };
}

let running: Promise<void> | null = null;

/** 幂等：同时被多处调用也只跑一次 */
export function ensureDefaults(): Promise<void> {
  running ??= seed().catch((error: unknown) => {
    // 失败时清掉缓存，下次还能重试；但不要把它变成永久失败
    running = null;
    throw error;
  });
  return running;
}
