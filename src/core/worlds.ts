import {
  db,
  getSetting,
  getWorld,
  listBranches,
  listCharactersInBranch,
  listWorlds,
  newId,
  putBranch,
  putCharacter,
  putWorld,
  setSetting,
} from './db';
import type { Branch, Character, World } from './types';

/**
 * 世界（世界观）与时间线（平行时空）。
 *
 * 数据关系：
 *   世界 1 ── N 时间线 1 ── N 角色
 *
 * 为什么角色要同时记 worldId 和 branchId：
 *   - branchId 决定「你现在看到的是哪一份角色」
 *   - worldId 让列表能直接按世界筛选，不用先查分支再查角色
 *
 * 为什么时间线里的角色是「复制」而不是「引用」：
 *   平行时空的意思就是「同一个世界里，事情走向不一样」。
 *   如果在两个时空里共用同一张角色卡，一边改了另一边也会跟着变，
 *   那就不是平行时空了，而是同一个角色开着两个聊天窗口。
 *   所以新建平行时空时，角色会整份复制，id 也是新的。
 */

/** 当前正在看哪个世界。存在 settings 表里，跨启动保留 */
const ACTIVE_WORLD_KEY = 'activeWorldId';

export async function getActiveWorldId(): Promise<string | null> {
  const value = await getSetting<string>(ACTIVE_WORLD_KEY);
  return typeof value === 'string' && value ? value : null;
}

export async function setActiveWorldId(id: string): Promise<void> {
  await setSetting(ACTIVE_WORLD_KEY, id);
}

/** 当前世界。设置里指的那个不在了（被删）就退回第一个 */
export async function resolveActiveWorld(worlds: World[]): Promise<World | null> {
  const stored = await getActiveWorldId();
  const hit = stored ? worlds.find((w) => w.id === stored) : undefined;
  const world = hit ?? worlds[0] ?? null;
  if (world && world.id !== stored) await setActiveWorldId(world.id);
  return world;
}

export function makeBranch(worldId: string, name = '主线', note = ''): Branch {
  const now = Date.now();
  return {
    id: newId(),
    worldId,
    createdAt: now,
    updatedAt: now,
    name,
    note,
  };
}

/** 新建一个世界，自带一条「主线」时间线，并切成当前世界 */
export async function createWorld(name: string, description: string): Promise<World> {
  const now = Date.now();
  const branch = makeBranch('', '主线');
  const world: World = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name: name.trim() || '未命名世界',
    description: description.trim(),
    activeBranchId: branch.id,
  };
  branch.worldId = world.id;

  await putWorld(world);
  await putBranch(branch);
  await setActiveWorldId(world.id);
  return world;
}

/** 世界当前该看哪条时间线。记录坏了就退回第一条 */
export async function resolveBranch(world: World): Promise<Branch | null> {
  const branches = await listBranches(world.id);
  const hit = branches.find((b) => b.id === world.activeBranchId);
  if (hit) return hit;
  const first = branches[0] ?? null;
  if (first && world.activeBranchId !== first.id) {
    await putWorld({ ...world, activeBranchId: first.id, updatedAt: Date.now() });
  }
  return first;
}

/** 切到某个世界的某条时间线（同时把这个世界切成当前世界） */
export async function switchTimeline(worldId: string, branchId: string): Promise<void> {
  const world = await getWorld(worldId);
  if (!world) return;
  if (world.activeBranchId !== branchId) {
    await putWorld({ ...world, activeBranchId: branchId, updatedAt: Date.now() });
  }
  await setActiveWorldId(worldId);
}

/**
 * 从某条时间线复制出一条新的平行时空。
 *
 * 复制的是「角色卡」：名字、人设、开场白、头像、原始 JSON 全带过去，
 * 但 id 是新的 —— 以后在一边改角色，另一边不会跟着变。
 * 记忆、关系、朋友圈在后面的批次里做，到时候也需要一起复制。
 */
export async function forkBranch(
  world: World,
  sourceBranch: Branch,
  name: string,
  note: string,
): Promise<Branch> {
  const branch = makeBranch(world.id, name.trim() || '平行时空', note.trim());
  await putBranch(branch);

  const characters = await listCharactersInBranch(world.id, sourceBranch.id);
  const now = Date.now();
  for (const character of characters) {
    const copy: Character = {
      ...character,
      id: newId(),
      createdAt: now,
      updatedAt: now,
      worldId: world.id,
      branchId: branch.id,
    };
    await putCharacter(copy);
  }

  return branch;
}

/**
 * 启动时把世界这一层补齐。
 *
 * 做三件事：
 *   1. 一个世界都没有 → 建「默认世界 · 主线」
 *   2. 有世界但当前世界记录丢了 → 指向第一个
 *   3. 老角色没有归属 → 塞进「默认世界 · 主线」
 *
 * 必须幂等：每次启动都会跑，不能每跑一次就多一个世界。
 */
export async function ensureWorlds(): Promise<World> {
  let worlds = await listWorlds();
  let world: World;

  if (worlds.length === 0) {
    world = await createWorld(
      '默认世界',
      '一个普通的现代都市。你住在这里，认识的人也都在这一座城市里。',
    );
    worlds = [world];
  } else {
    const active = await resolveActiveWorld(worlds);
    world = active ?? worlds[0]!;
  }

  const branch = await resolveBranch(world);
  if (!branch) return world;

  // 老数据（v2 及以前建的角色）没有归属，归到默认世界的第一个分支
  const database = await db();
  const all = await database.getAll('characters');
  const orphans = all.filter((c) => !c.branchId || !c.worldId);
  if (orphans.length > 0) {
    const defaultWorld = worlds[0]!;
    const defaultBranch = (await listBranches(defaultWorld.id))[0];
    if (defaultBranch) {
      for (const character of orphans) {
        await putCharacter({
          ...character,
          worldId: defaultWorld.id,
          branchId: defaultBranch.id,
        });
      }
    }
  }

  // 老世界（v3 早期如果 activeBranchId 为空）也补一下
  for (const item of worlds) {
    if (!item.activeBranchId) {
      const first = await listBranches(item.id);
      if (first[0]) {
        await putWorld({ ...item, activeBranchId: first[0].id, updatedAt: Date.now() });
      }
    }
  }

  return world;
}
