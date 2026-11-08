/**
 * IndexedDB 封装（用 idb，ISC 许可，gzip 约 3.4KB）。
 *
 * 为什么不用 Dexie：我们只需要「几张表 + 简单查询」，
 * 30KB 的 ORM 换不来什么，而且它会把 IndexedDB 的语义藏起来 ——
 * 对这个项目「让零基础用户看得懂」的目标是减分项。
 *
 * ⚠️ 三条铁律：
 *   1. 数据库是异步打开的，openDB 完成前不许读写；
 *      所有操作都必须先 await db()，不要在模块顶层直接调 store。
 *   2. 版本升级必须写迁移分支，**任何情况下不许 deleteObjectStore**（那等于删用户数据）。
 *   3. 删除要用事务把关联数据一起带走，别留孤儿记录。
 */
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type {
  Branch,
  Character,
  Conversation,
  Message,
  Provider,
  SettingRecord,
  World,
  Worldbook,
} from './types';
import type { Assignment, RequestLog, Site } from './api-types';
import { LOG_RETENTION_DAYS } from './api-types';

const DB_NAME = 'wish-phone';
const DB_VERSION = 5;

interface WishDB extends DBSchema {
  characters: {
    key: string;
    value: Character;
    indexes: { byUpdatedAt: number };
  };
  conversations: {
    key: string;
    value: Conversation;
    indexes: { byCharacter: string; byUpdatedAt: number };
  };
  messages: {
    key: string;
    value: Message;
    /** 复合索引：同一会话内按时间顺序取出 */
    indexes: { byConversation: [string, string] };
  };
  settings: {
    key: string;
    value: SettingRecord;
  };
  providers: {
    key: string;
    value: Provider;
    indexes: { byUpdatedAt: number };
  };
  worlds: {
    key: string;
    value: World;
    indexes: { byUpdatedAt: number };
  };
  branches: {
    key: string;
    value: Branch;
    indexes: { byWorld: string };
  };
  worldbooks: {
    key: string;
    value: Worldbook;
    indexes: { byUpdatedAt: number };
  };
  /* v5 起：API 与模型按设计文档 v1.1 重做。
     老 providers 表先留着（界面还没换完），不许删。 */
  sites: {
    key: string;
    value: Site;
    indexes: { byUpdatedAt: number };
  };
  assignments: {
    key: string;
    value: Assignment;
    indexes: { byScope: string };
  };
  requestLogs: {
    key: string;
    value: RequestLog;
    indexes: { byTime: number; bySite: string };
  };
}

let handle: Promise<IDBPDatabase<WishDB>> | null = null;

/** 拿到数据库连接。第一次调用时才真正打开 */
export function db(): Promise<IDBPDatabase<WishDB>> {
  handle ??= openDB<WishDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // v0 → v1：建全部表
      if (oldVersion < 1) {
        const characters = database.createObjectStore('characters', { keyPath: 'id' });
        characters.createIndex('byUpdatedAt', 'updatedAt');

        const conversations = database.createObjectStore('conversations', { keyPath: 'id' });
        conversations.createIndex('byCharacter', 'characterId');
        conversations.createIndex('byUpdatedAt', 'updatedAt');

        const messages = database.createObjectStore('messages', { keyPath: 'id' });
        messages.createIndex('byConversation', ['conversationId', 'createdAt']);

        database.createObjectStore('settings', { keyPath: 'key' });
      }

      // v1 → v2：加「API 服务商」表。
      // 老版本那条单份 apiConfig 的迁移放在应用层（见 migrateLegacyApiConfig），
      // 因为那段逻辑要读 settings 表并构造完整的 Provider，塞在 upgrade 里太挤。
      if (oldVersion < 2) {
        const providers = database.createObjectStore('providers', { keyPath: 'id' });
        providers.createIndex('byUpdatedAt', 'updatedAt');
      }

      // v2 → v3：加「世界」和「时间线（平行时空）」两张表。
      // 角色表不加索引：本地数据量很小，按分支过滤在内存里做更简单，
      // 也避免给老库加索引时出错。角色记录本身只是多了几个可选字段。
      if (oldVersion < 3) {
        const worlds = database.createObjectStore('worlds', { keyPath: 'id' });
        worlds.createIndex('byUpdatedAt', 'updatedAt');

        const branches = database.createObjectStore('branches', { keyPath: 'id' });
        branches.createIndex('byWorld', 'worldId');
      }

      // v3 → v4：加「世界书」表。
      // 角色表不加字段也不加索引：挂载关系是角色记录上的一个可选数组，
      // 老角色没有它就是「没挂任何书」，正好符合「新建角色不自动挂」的规则。
      if (oldVersion < 4) {
        const worldbooks = database.createObjectStore('worldbooks', { keyPath: 'id' });
        worldbooks.createIndex('byUpdatedAt', 'updatedAt');
      }

      // v4 → v5：加「站点 / 分配 / 请求日志」三张表（设计文档 v1.1 §11）。
      // 老 providers 表原地不动：数据搬运放在应用层（见 migrateProvidersToSites），
      // 因为要读 settings 里的分配关系，而且必须能重试。
      if (oldVersion < 5) {
        const sites = database.createObjectStore('sites', { keyPath: 'id' });
        sites.createIndex('byUpdatedAt', 'updatedAt');

        const assignments = database.createObjectStore('assignments', { keyPath: 'id' });
        assignments.createIndex('byScope', 'scope');

        const logs = database.createObjectStore('requestLogs', { keyPath: 'id' });
        logs.createIndex('byTime', 'time');
        logs.createIndex('bySite', 'siteId');
      }

      // 将来加字段时在这里续写，例如：
      // if (oldVersion < 6) {
      //   tx.objectStore('characters').createIndex('byName', 'name');
      // }
      // ⛔ 永远不要 deleteObjectStore —— 那是直接抹掉用户的数据。
    },
  });
  return handle;
}

/**
 * 本地唯一 id。
 *
 * ⚠️ crypto.randomUUID 只在「安全上下文」里存在 —— https 或 localhost。
 *    如果用局域网 IP（http://192.168.x.x:5173）在手机上打开，它会是 undefined，
 *    直接调用就当场崩掉。所以必须有回退。
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 回退方案：时间戳 + 随机数。本地单用户、不会高并发，够用了
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 复合索引的范围：某个会话的全部消息 */
function conversationRange(conversationId: string): IDBKeyRange {
  // \uffff 是安全的字符串上界，能覆盖所有正常内容
  return IDBKeyRange.bound([conversationId, ''], [conversationId, '\uffff']);
}

/* ============================ 角色 ============================ */

export async function listCharacters(): Promise<Character[]> {
  const database = await db();
  const all = await database.getAllFromIndex('characters', 'byUpdatedAt');
  // 最近改过的排在前面
  return all.reverse();
}

export function getCharacter(id: string): Promise<Character | undefined> {
  return db().then((database) => database.get('characters', id));
}

export async function putCharacter(character: Character): Promise<void> {
  const database = await db();
  await database.put('characters', character);
}

/**
 * 删除角色，连同它的所有会话和消息。
 * 没用一个大事务把三步包起来：事务里 await 循环很容易踩「事务提前提交」的坑，
 * 而这是本地单用户场景，不需要那种原子性。
 */
export async function deleteCharacter(id: string): Promise<void> {
  const database = await db();
  const conversations = await database.getAllFromIndex('conversations', 'byCharacter', id);
  for (const conversation of conversations) {
    await deleteConversation(conversation.id);
  }
  await database.delete('characters', id);
}

/* ============================ 世界 / 时间线 ============================ */

export async function listWorlds(): Promise<World[]> {
  const database = await db();
  const all = await database.getAllFromIndex('worlds', 'byUpdatedAt');
  return all.reverse();
}

export function getWorld(id: string): Promise<World | undefined> {
  return db().then((database) => database.get('worlds', id));
}

export async function putWorld(world: World): Promise<void> {
  const database = await db();
  await database.put('worlds', world);
}

export async function listBranches(worldId: string): Promise<Branch[]> {
  const database = await db();
  const all = await database.getAllFromIndex('branches', 'byWorld', worldId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export function getBranch(id: string): Promise<Branch | undefined> {
  return db().then((database) => database.get('branches', id));
}

export async function putBranch(branch: Branch): Promise<void> {
  const database = await db();
  await database.put('branches', branch);
}

/** 某个时间线里的全部角色。按最近修改排序 */
export async function listCharactersInBranch(
  worldId: string,
  branchId: string,
): Promise<Character[]> {
  const database = await db();
  const all = await database.getAllFromIndex('characters', 'byUpdatedAt');
  return all
    .filter((c) => c.branchId === branchId && c.worldId === worldId)
    .reverse();
}

/** 数某个时间线里有几个角色。列表上显示 x 个用 */
export async function countCharactersInBranch(branchId: string): Promise<number> {
  const database = await db();
  const all = await database.getAll('characters');
  return all.filter((c) => c.branchId === branchId).length;
}

/**
 * 删除一条时间线，连同这条线里的角色。
 * 世界本身由调用方决定要不要一起删；这里只管分支内部的数据。
 */
export async function deleteBranchData(branchId: string): Promise<void> {
  const database = await db();
  const characters = await database.getAll('characters');
  for (const character of characters) {
    if (character.branchId === branchId) await deleteCharacter(character.id);
  }
  await database.delete('branches', branchId);
}

/** 删除一个世界：先删各条时间线和里面的角色，再删世界本体 */
export async function deleteWorldData(worldId: string): Promise<void> {
  const branches = await listBranches(worldId);
  for (const branch of branches) await deleteBranchData(branch.id) /* 分支里的角色一起删 */;
  const database = await db();
  await database.delete('worlds', worldId);
}

/* ============================ 世界书 ============================ */

export async function listWorldbooks(): Promise<Worldbook[]> {
  const database = await db();
  const all = await database.getAllFromIndex('worldbooks', 'byUpdatedAt');
  // 最近改过的排在前面
  return all.reverse();
}

export function getWorldbook(id: string): Promise<Worldbook | undefined> {
  return db().then((database) => database.get('worldbooks', id));
}

export async function putWorldbook(worldbook: Worldbook): Promise<void> {
  const database = await db();
  await database.put('worldbooks', worldbook);
}

/**
 * 删一本书，顺手把挂过它的角色摘干净 ——
 * 否则角色身上会留下指向不存在书的 id，界面上会出现一行空白。
 */
export async function deleteWorldbook(id: string): Promise<void> {
  const database = await db();
  await database.delete('worldbooks', id);

  const characters = await database.getAll('characters');
  for (const character of characters) {
    if (!character.worldbookIds?.includes(id)) continue;
    character.worldbookIds = character.worldbookIds.filter((item) => item !== id);
    character.updatedAt = Date.now();
    await database.put('characters', character);
  }
}

/** 把一批 id 对应成书。返回的顺序跟传入的 id 一致；已经不存在的书直接跳过 */
export async function getWorldbooks(ids: string[]): Promise<Worldbook[]> {
  if (ids.length === 0) return [];
  const database = await db();
  const books: Worldbook[] = [];
  for (const id of ids) {
    const book = await database.get('worldbooks', id);
    if (book) books.push(book);
  }
  return books;
}

/* ============================ 会话 ============================ */

export async function listConversations(characterId?: string): Promise<Conversation[]> {
  const database = await db();
  const all = characterId
    ? await database.getAllFromIndex('conversations', 'byCharacter', characterId)
    : await database.getAll('conversations');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(id: string): Promise<Conversation | undefined> {
  return db().then((database) => database.get('conversations', id));
}

export async function putConversation(conversation: Conversation): Promise<void> {
  const database = await db();
  await database.put('conversations', conversation);
}

/** 删除会话，连同它的所有消息 */
export async function deleteConversation(id: string): Promise<void> {
  const database = await db();
  const messages = await database.getAllFromIndex('messages', 'byConversation', conversationRange(id));

  const tx = database.transaction('messages', 'readwrite');
  for (const message of messages) void tx.store.delete(message.id);
  await tx.done;

  await database.delete('conversations', id);
}

/* ============================ 消息 ============================ */

export async function listMessages(conversationId: string): Promise<Message[]> {
  const database = await db();
  // 复合索引 [conversationId, createdAt]，所以拿到的天然就是时间顺序
  return database.getAllFromIndex('messages', 'byConversation', conversationRange(conversationId));
}

export function getMessage(id: string): Promise<Message | undefined> {
  return db().then((database) => database.get('messages', id));
}

export async function putMessage(message: Message): Promise<void> {
  const database = await db();
  await database.put('messages', message);
}

export async function deleteMessage(id: string): Promise<void> {
  const database = await db();
  await database.delete('messages', id);
}

/* ============================ 设置 ============================ */

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const database = await db();
  const record = await database.get('settings', key);
  return record?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const database = await db();
  await database.put('settings', { key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  const database = await db();
  await database.delete('settings', key);
}

/* ============================ 概览与清空 ============================ */

export interface StorageStats {
  characters: number;
  conversations: number;
  messages: number;
  providers: number;
  settings: number;
  /** 浏览器报告的已用空间（字节），拿不到时为 null */
  usageBytes: number | null;
}

/** 看一眼现在存了多少东西。设置页的「数据储存」和数据自检都用它 */
export async function stats(): Promise<StorageStats> {
  const database = await db();
  const [characters, conversations, messages, providers, settings] = await Promise.all([
    database.count('characters'),
    database.count('conversations'),
    database.count('messages'),
    database.count('providers'),
    database.count('settings'),
  ]);

  let usageBytes: number | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    usageBytes = estimate?.usage ?? null;
  } catch {
    // 拿不到就算了，不是错误
  }

  return { characters, conversations, messages, providers, settings, usageBytes };
}

/* ============================ API 服务商 ============================ */

/**
 * 老记录缺后来新增的字段时补上默认值（只在读出时补，不改库里的原件）。
 * 多 Key 模式默认关；模型不带 keyId 即为所有 Key 共用。
 */
function normalizeProvider(p: Provider): Provider {
  return {
    ...p,
    kind: p.kind ?? 'text',
    multiKey: p.multiKey ?? p.keys.length > 1,
    keyMode: p.keyMode ?? 'rotate',
    keys: p.keys.map((k) => ({ ...k, label: k.label ?? '' })),
    models: p.models.map((m) => ({
      ...m,
      maxOutput: m.maxOutput ?? null,
      kind: m.kind ?? 'text',
    })),
  };
}

export async function listProviders(): Promise<Provider[]> {
  const database = await db();
  const all = await database.getAllFromIndex('providers', 'byUpdatedAt');
  // 最近改过的排在前面
  return all.reverse().map(normalizeProvider);
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const database = await db();
  const found = await database.get('providers', id);
  return found ? normalizeProvider(found) : undefined;
}

export async function putProvider(provider: Provider): Promise<void> {
  const database = await db();
  await database.put('providers', provider);
}

export async function deleteProviderRecord(id: string): Promise<void> {
  const database = await db();
  await database.delete('providers', id);
}

/**
 * 清空全部数据（设置页的「清空数据」用它）。
 * 只清空对象仓库，不删数据库本身 —— 删库再重建会让连接句柄失效。
 */
export async function clearAll(): Promise<void> {
  const database = await db();
  const tx = database.transaction(
    ['characters', 'conversations', 'messages', 'providers', 'settings', 'worlds', 'branches', 'worldbooks'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('characters').clear(),
    tx.objectStore('conversations').clear(),
    tx.objectStore('messages').clear(),
    tx.objectStore('providers').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('worlds').clear(),
    tx.objectStore('branches').clear(),
    tx.objectStore('worldbooks').clear(),
  ]);
  await tx.done;
}

/* ============================ 老数据迁移 ============================ */

/** 老版本（T4 早期）存在 settings 里的那份单条配置 */
interface LegacyApiConfig {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  rememberKey?: boolean;
}

/**
 * 把老版本的一条 apiConfig 升级成一个「服务商」。
 *
 * 只在 providers 表**还是空的**时候才做，所以反复启动也不会重复迁移。
 * 迁移完把老 key 删掉，避免两份配置各说各话。
 *
 * 返回 true 表示这次真的迁移了。
 */
export async function migrateLegacyApiConfig(): Promise<boolean> {
  const database = await db();
  if ((await database.count('providers')) > 0) return false;

  const legacy = await getSetting<LegacyApiConfig>('apiConfig');
  if (!legacy?.baseUrl) return false;

  const oldKey = await getSetting<string>('apiKey');
  const now = Date.now();

  const provider: Provider = {
    id: newId(),
    name: '我的服务商',
    protocol: 'openai',
    baseUrl: legacy.baseUrl,
    apiPath: '/chat/completions',
    multiKey: false,
    keyMode: 'rotate',
    keys: oldKey
      ? [
          {
            id: newId(),
            value: oldKey,
            label: '',
            enabled: true,
            weight: 1,
            callCount: 0,
            failCount: 0,
          },
        ]
      : [],
    models: legacy.model
      ? [
          {
            id: legacy.model,
            displayName: legacy.model,
            contextLength: null,
      maxOutput: null,
            enabled: true,
            source: 'manual',
          },
        ]
      : [],
    generation: { temperature: legacy.temperature ?? 0.8, maxTokens: null, topP: null },
    advanced: {
      stream: false,
      rateLimit: { enabled: false, perMinute: 60 },
      breaker: { enabled: false, failCount: 5, cooldownSec: 60 },
    },
    vendor: '',
    group: '',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  await putProvider(provider);
  await deleteSetting('apiConfig');
  await deleteSetting('apiKey');
  return true;
}

/* ============================ 站点（设计文档 v1.1） ============================ */

export async function listSites(): Promise<Site[]> {
  const database = await db();
  const all = await database.getAllFromIndex('sites', 'byUpdatedAt');
  // 最近改过的排前面
  return all.reverse();
}

export function getSite(id: string): Promise<Site | undefined> {
  return db().then((database) => database.get('sites', id));
}

export async function putSite(site: Site): Promise<void> {
  const database = await db();
  await database.put('sites', site);
}

/** 删站点的同时把引用它的分配一并清掉，否则界面上会出现指向空站点的行 */
export async function deleteSite(id: string): Promise<void> {
  const database = await db();
  await database.delete('sites', id);

  const assignments = await database.getAll('assignments');
  for (const item of assignments) {
    const touchesTarget = item.target?.siteId === id;
    const touchesFallback = item.fallback?.siteId === id;
    const touchesAux = item.aux?.siteId === id;
    if (!touchesTarget && !touchesFallback && !touchesAux) continue;

    if (touchesTarget) item.target = null;
    if (touchesFallback) item.fallback = null;
    if (touchesAux) item.aux = null;
    await database.put('assignments', item);
  }
}

/* ============================ 分配 ============================ */

export async function listAssignments(): Promise<Assignment[]> {
  const database = await db();
  return database.getAll('assignments');
}

export async function putAssignment(assignment: Assignment): Promise<void> {
  const database = await db();
  await database.put('assignments', assignment);
}

/** 删掉一条分配。比 clearAssignments 精确，改单个能力时用它 */
export async function deleteAssignment(id: string): Promise<void> {
  const database = await db();
  await database.delete('assignments', id);
}

/** 清掉某个作用域下的全部分配。scopeId 传角色 / App 的 id，全局传 '' */
export async function clearAssignments(scope: string, scopeId: string): Promise<void> {
  const database = await db();
  const all = await database.getAllFromIndex('assignments', 'byScope', scope);
  const tx = database.transaction('assignments', 'readwrite');
  for (const item of all) {
    if (item.scopeId === scopeId) void tx.store.delete(item.id);
  }
  await tx.done;
}

/* ============================ 请求日志 ============================ */

export async function putLog(log: RequestLog): Promise<void> {
  const database = await db();
  await database.put('requestLogs', log);
}

/** 倒序取出最近若干条，用量页和站点日志都读它 */
export async function listLogs(limit = 200): Promise<RequestLog[]> {
  const database = await db();
  const all = await database.getAllFromIndex('requestLogs', 'byTime');
  return all.slice(-limit).reverse();
}

/**
 * 清掉超期的日志（文档 §8.3，默认保留 30 天）。
 * 每次启动顺手跑一次就够，不需要定时器。
 */
export async function pruneLogs(retentionDays = LOG_RETENTION_DAYS): Promise<number> {
  const database = await db();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const all = await database.getAllFromIndex('requestLogs', 'byTime');
  const expired = all.filter((log) => log.time < cutoff);
  if (expired.length === 0) return 0;

  const tx = database.transaction('requestLogs', 'readwrite');
  for (const log of expired) void tx.store.delete(log.id);
  await tx.done;
  return expired.length;
}

export async function clearLogs(): Promise<void> {
  const database = await db();
  await database.clear('requestLogs');
}
