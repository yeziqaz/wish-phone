import { getSetting, setSetting } from './db';
import type { Bindings, ModelKind, ModelRef } from './types';

/**
 * 主模型绑定：聊天 / 生图 / 语音 / 视频各一个，外加角色专属覆盖。
 *
 * 为什么存 settings 表而不是新开一张表：
 *   它就是一个很小的配置对象，没有列表查询需求，
 *   加一张表反而多一次迁移。等有了「按会话绑定」再升级。
 */

const KEY = 'modelBindings';

export async function getBindings(): Promise<Bindings> {
  const value = await getSetting<Bindings>(KEY);
  return {
    byKind: value?.byKind ?? {},
    characters: value?.characters ?? {},
  };
}

/** 设 / 清某个用途的主模型。传 null 表示清掉 */
export async function setKindBinding(kind: ModelKind, ref: ModelRef | null): Promise<void> {
  const bindings = await getBindings();
  if (ref) bindings.byKind[kind] = ref;
  else delete bindings.byKind[kind];
  await setSetting(KEY, bindings);
}

/** 角色专属覆盖。传 null 表示回到「跟随全局」 */
export async function setCharacterBinding(
  characterId: string,
  kind: ModelKind,
  ref: ModelRef | null,
): Promise<void> {
  const bindings = await getBindings();
  const current = bindings.characters[characterId] ?? {};
  if (ref) current[kind] = ref;
  else delete current[kind];

  if (Object.keys(current).length > 0) bindings.characters[characterId] = current;
  else delete bindings.characters[characterId];

  await setSetting(KEY, bindings);
}
