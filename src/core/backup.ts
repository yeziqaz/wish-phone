/* ==========================================================================
   备份文件（导出 / 导入）

   这个文件只做纯逻辑：把一堆表拼成一个对象、把一段文字解析回一个对象。
   它**不碰数据库**，所以可以脱离浏览器直接跑测试（见 tests/backup.test.ts）。

   真正的读写库在 core/db.ts 的 createBackup / restoreBackup 里。

   为什么要整表原样导出，而不是「按字段重建」：
     Character 上有个 raw 字段，装的是别人卡里的原始 JSON。
     Character Card 规范明文要求 MUST NOT destroy unknown keys ——
     按我们认识的字段重建，会把 extensions 和所有我们不认识的字段抹掉。
     整表原样搬运，未知字段自然就跟着走了。

   ⚠️ 文件里含 API Key 明文。这是刻意的：没有 Key 的备份换设备后不能用。
      所以界面上必须明说「别发给别人」。
   ========================================================================== */

/** 备份文件的 app 标记。导入时先认这个，免得把别人的 JSON 塞进来 */
export const BACKUP_APP = 'wish-phone';

/** 备份文件的格式版本。改结构时 +1，并在这里写迁移 */
export const BACKUP_FORMAT = 1;

/**
 * 要备份的表，顺序即导出顺序。
 *
 * ⚠️ 以后 db.ts 里加新表，**必须**同步加到这里 ——
 *    否则导出的备份会漏掉那张表，换设备后就丢了。
 *    tests/backup.test.ts 里有一条测试盯着这件事。
 */
export const BACKUP_TABLES = [
  'characters',
  'conversations',
  'messages',
  'settings',
  'providers',
  'worlds',
  'branches',
  'worldbooks',
  'sites',
  'assignments',
  'requestLogs',
  'moments',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

/** 表名的人话说法。报错和摘要都用它，不把英文表名甩给用户 */
export const BACKUP_TABLE_LABEL: Record<BackupTable, string> = {
  characters: '角色',
  conversations: '会话',
  messages: '消息',
  settings: '设置',
  providers: '服务商',
  worlds: '世界',
  branches: '时间线',
  worldbooks: '世界书',
  sites: '站点',
  assignments: '模型分配',
  requestLogs: '请求日志',
  moments: '朋友圈',
};

export interface BackupFile {
  app: string;
  format: number;
  /** 导出时数据库的版本号，方便以后排查「老备份导进新库」 */
  dbVersion: number;
  exportedAt: number;
  /** 每张表各多少条。由 tables 现算，不信任文件里写的数字 */
  counts: Record<BackupTable, number>;
  tables: Record<BackupTable, unknown[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countTables(tables: Record<BackupTable, unknown[]>): Record<BackupTable, number> {
  const counts = {} as Record<BackupTable, number>;
  for (const name of BACKUP_TABLES) counts[name] = tables[name].length;
  return counts;
}

/** 把从库里读出来的各表数据拼成一个备份对象 */
export function buildBackup(
  tables: Record<BackupTable, unknown[]>,
  dbVersion: number,
  now = Date.now(),
): BackupFile {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    dbVersion,
    exportedAt: now,
    counts: countTables(tables),
    tables,
  };
}

/** 导出的文件名：wish-phone-backup-2026-11-25-1530.json */
export function backupFileName(now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `wish-phone-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/**
 * 解析一段备份文本。
 *
 * 全部校验都在写库之前做完 —— 宁可在这里报错，也不要清了一半再发现文件是坏的。
 * 任何一条不满足都抛错，message 是可以直接显示给用户的中文。
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('这个文件不是备份文件（读不出 JSON）。');
  }

  if (!isRecord(raw)) throw new Error('这个文件不是备份文件（内容不是一个对象）。');
  if (raw.app !== BACKUP_APP) throw new Error('这不是愿望机的备份文件。');

  const format = raw.format;
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    throw new Error('备份文件的格式版本读不出来，文件可能损坏了。');
  }
  if (format > BACKUP_FORMAT) {
    throw new Error(`这份备份来自更新版本的愿望机（格式 ${format}），请先升级后再导入。`);
  }

  if (!isRecord(raw.tables)) throw new Error('备份文件里没有数据。');
  const bag = raw.tables;

  const tables = {} as Record<BackupTable, unknown[]>;
  const missing: string[] = [];
  for (const name of BACKUP_TABLES) {
    const rows = bag[name];
    if (rows === undefined) {
      missing.push(BACKUP_TABLE_LABEL[name]);
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new Error(`备份文件里的「${BACKUP_TABLE_LABEL[name]}」不是列表，文件可能损坏了。`);
    }
    tables[name] = rows;
  }
  // 缺表就整个停下：导进去会先清空，少一张表就是白白丢一类数据
  if (missing.length > 0) {
    throw new Error(`备份文件缺少这些数据：${missing.join('、')}。为免覆盖后丢东西，已停止导入。`);
  }

  return {
    app: BACKUP_APP,
    format,
    dbVersion: typeof raw.dbVersion === 'number' ? raw.dbVersion : 0,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    counts: countTables(tables),
    tables,
  };
}

/** 一行摘要，给导入前的确认框用：「角色 3 · 会话 5 · 消息 120」 */
export function backupSummary(file: BackupFile): string {
  const parts: string[] = [];
  for (const name of BACKUP_TABLES) {
    const count = file.counts[name];
    if (count > 0) parts.push(`${BACKUP_TABLE_LABEL[name]} ${count}`);
  }
  return parts.length === 0 ? '这份备份是空的' : parts.join(' · ');
}
