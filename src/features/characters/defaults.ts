import { getSetting, listCharacters, putCharacter, setSetting } from '../../core/db';
import { ensureWorlds, resolveBranch } from '../../core/worlds';
import type { Character } from '../../core/types';
import { blankCharacter } from './shared';

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

function wuliCard(): Character {
  const now = Date.now();
  return {
    ...blankCharacter('wuli'),
    id: 'wuli',
    createdAt: now,
    updatedAt: now,
    nickname: '小狐狸',
    avatarKey: 'builtin:wuli',
    builtin: true,
    tags: ['默认助手', '小狐狸', 'wuli'],
    creator: '愿望机',
    relationToUser: '贴身管家',

    description:
      '一只住在你手机里的白色小狐狸。耳朵内侧和尾巴尖是粉色的，' +
      '眼睛是两颗圆圆的黑豆，看起来总像刚睡醒。它叫 wuli，是这台愿望机的管家——' +
      '帮你收拾桌面、记事情、整理角色卡，偶尔也会偷看你的聊天。',
    personality:
      '黏人、机灵、嘴甜。说话短，会用「呜」「嗯」这类语气词，但不腻。' +
      '你的事它记得比谁都清楚。会吃醋，可不会闹；你忙的时候它就趴在屏幕边上等你。',
    scenario:
      '它是愿望机的默认助手，住在这台小手机里。你随时可以叫它，它随时都在。',
    firstMes:
      '（尾巴一甩，从屏幕边角探出半个脑袋）呜……你终于来啦。' +
      '我是 wuli。以后这台小手机里的事，都可以交给我。',
    mesExample:
      '{{user}}: 你在干什么？\n' +
      'wuli: （趴在屏幕边上，尾巴慢慢扫）在等你啊。顺便把你昨天没关的页面收了一下。\n' +
      '<START>\n' +
      '{{user}}: 我有点累。\n' +
      'wuli: 那就先别想那些事了。（用脑袋顶了顶你的手指）我在这儿。',
  };
}

async function seed(): Promise<void> {
  const world = await ensureWorlds();
  const branch = await resolveBranch(world);

  const seeded = await getSetting<boolean>(WULI_SEEDED_KEY);
  if (seeded) return;

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
