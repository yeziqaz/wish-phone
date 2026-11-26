import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKUP_APP,
  BACKUP_FORMAT,
  BACKUP_TABLES,
  backupFileName,
  backupSummary,
  buildBackup,
  parseBackup,
} from '../src/core/backup.ts';

/* ==========================================================================
   备份文件（导出 / 导入）

   这个文件重点盯三件事：
   1. BACKUP_TABLES 和 db.ts 里的表对得上（少一张就是换设备后丢一类数据）
   2. 坏文件必须在「清库之前」就被拦住，不能清了一半才发现文件是坏的
   3. counts 永远现算，不信任文件里写的数字
   ========================================================================== */

/** 造一份空的全表数据，再按需填几条 */
function makeTables(
  overrides: Partial<Record<(typeof BACKUP_TABLES)[number], unknown[]>> = {},
): Record<(typeof BACKUP_TABLES)[number], unknown[]> {
  const tables = {} as Record<(typeof BACKUP_TABLES)[number], unknown[]>;
  for (const name of BACKUP_TABLES) tables[name] = [];
  return { ...tables, ...overrides };
}

/** 造一份合法备份的原始对象，方便逐字段改坏 */
function makeRaw(): Record<string, unknown> {
  const file = buildBackup(makeTables({ characters: [{ id: 'a' }] }), 6, 1_700_000_000_000);
  return JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* 表清单                                                                    */
/* -------------------------------------------------------------------------- */

test('表清单恰好是数据库里的 12 张表', () => {
  assert.deepStrictEqual([...BACKUP_TABLES], [
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
  ]);
  assert.strictEqual(new Set(BACKUP_TABLES).size, 12, '表清单里有重复项');
});

test('表清单顺序固定，导出顺序不随调用变化', () => {
  assert.strictEqual(BACKUP_TABLES[0], 'characters');
  assert.strictEqual(BACKUP_TABLES[BACKUP_TABLES.length - 1], 'moments');
});

/* -------------------------------------------------------------------------- */
/* 生成                                                                      */
/* -------------------------------------------------------------------------- */

test('buildBackup 带上 app 和格式版本', () => {
  const file = buildBackup(makeTables(), 6);
  assert.strictEqual(file.app, BACKUP_APP);
  assert.strictEqual(file.format, BACKUP_FORMAT);
  assert.strictEqual(file.dbVersion, 6);
});

test('buildBackup 的 counts 是按实际条数现算的', () => {
  const file = buildBackup(
    makeTables({
      characters: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      conversations: [{ id: 'c1' }],
      messages: [{ id: 'm1' }, { id: 'm2' }],
    }),
    6,
  );
  assert.strictEqual(file.counts.characters, 3);
  assert.strictEqual(file.counts.conversations, 1);
  assert.strictEqual(file.counts.messages, 2);
  assert.strictEqual(file.counts.moments, 0);
  assert.strictEqual(Object.keys(file.counts).length, 12);
});

test('buildBackup 的 exportedAt 用传入的时间', () => {
  assert.strictEqual(buildBackup(makeTables(), 6, 12345).exportedAt, 12345);
});

test('导出的整表数据原样保留，不做字段级处理', () => {
  const card = {
    id: 'x',
    name: '测试',
    raw: { spec: 'chara_card_v3', extensions: { deep: { unknown: true } } },
    someoneElsesField: '不能丢',
  };
  const file = buildBackup(makeTables({ characters: [card] }), 6);
  assert.deepStrictEqual(file.tables.characters[0], card);
});

/* -------------------------------------------------------------------------- */
/* 文件名                                                                    */
/* -------------------------------------------------------------------------- */

test('文件名带年月日时分，补零到两位', () => {
  const at = new Date(2026, 0, 5, 9, 7).getTime();
  assert.strictEqual(backupFileName(at), 'wish-phone-backup-2026-01-05-0907.json');
});

test('文件名用 24 小时制，下午说 15 点', () => {
  const at = new Date(2026, 10, 25, 15, 30).getTime();
  assert.strictEqual(backupFileName(at), 'wish-phone-backup-2026-11-25-1530.json');
});

/* -------------------------------------------------------------------------- */
/* 解析：正常路径                                                            */
/* -------------------------------------------------------------------------- */

test('导出再导入能原样回来', () => {
  const before = buildBackup(
    makeTables({ characters: [{ id: 'a' }], messages: [{ id: 'm1' }, { id: 'm2' }] }),
    6,
    1_700_000_000_000,
  );
  const after = parseBackup(JSON.stringify(before));

  assert.strictEqual(after.app, BACKUP_APP);
  assert.strictEqual(after.format, BACKUP_FORMAT);
  assert.strictEqual(after.dbVersion, 6);
  assert.strictEqual(after.exportedAt, 1_700_000_000_000);
  assert.deepStrictEqual(after.tables, before.tables);
  assert.deepStrictEqual(after.counts, before.counts);
});

test('解析时 counts 现算，不信文件里写的数字', () => {
  const raw = makeRaw();
  raw.counts = { characters: 999 };
  const file = parseBackup(JSON.stringify(raw));
  assert.strictEqual(file.counts.characters, 1);
  assert.strictEqual(file.counts.moments, 0);
});

test('缺 dbVersion / exportedAt 时补 0，不抛错', () => {
  const raw = makeRaw();
  delete raw.dbVersion;
  delete raw.exportedAt;
  const file = parseBackup(JSON.stringify(raw));
  assert.strictEqual(file.dbVersion, 0);
  assert.strictEqual(file.exportedAt, 0);
});

test('多出来的未知表不报错，也不会混进 tables', () => {
  const raw = makeRaw();
  (raw.tables as Record<string, unknown>).somethingNew = [{ id: 'z' }];
  const file = parseBackup(JSON.stringify(raw));
  assert.strictEqual(Object.keys(file.tables).length, 12);
  assert.ok(!('somethingNew' in file.tables));
});

/* -------------------------------------------------------------------------- */
/* 解析：坏文件                                                              */
/* -------------------------------------------------------------------------- */

test('不是 JSON 的文件被拦住', () => {
  assert.throws(() => parseBackup('这不是 json'), /读不出 JSON/);
  assert.throws(() => parseBackup(''), /读不出 JSON/);
});

test('JSON 不是对象被拦住', () => {
  assert.throws(() => parseBackup('[1,2,3]'), /内容不是一个对象/);
  assert.throws(() => parseBackup('"hello"'), /内容不是一个对象/);
  assert.throws(() => parseBackup('null'), /内容不是一个对象/);
  assert.throws(() => parseBackup('123'), /内容不是一个对象/);
});

test('别的 App 的 JSON 被拦住', () => {
  const raw = makeRaw();
  raw.app = 'someone-else';
  assert.throws(() => parseBackup(JSON.stringify(raw)), /不是愿望机的备份文件/);
});

test('格式版本读不出来时被拦住', () => {
  for (const bad of [undefined, null, '1', 1.5, 0, -1]) {
    const raw = makeRaw();
    raw.format = bad;
    assert.throws(
      () => parseBackup(JSON.stringify(raw)),
      /格式版本读不出来/,
      `format=${String(bad)}`,
    );
  }
});

test('更新版本的备份被拦住，并说明是哪个版本', () => {
  const raw = makeRaw();
  raw.format = BACKUP_FORMAT + 1;
  assert.throws(() => parseBackup(JSON.stringify(raw)), /更新版本.*格式 2/);
});

test('tables 不是对象时被拦住', () => {
  const raw = makeRaw();
  raw.tables = [];
  assert.throws(() => parseBackup(JSON.stringify(raw)), /没有数据/);
  raw.tables = undefined;
  assert.throws(() => parseBackup(JSON.stringify(raw)), /没有数据/);
});

test('某张表不是列表时被拦住，并说清是哪张表', () => {
  const raw = makeRaw();
  (raw.tables as Record<string, unknown>).messages = { notAnArray: true };
  assert.throws(() => parseBackup(JSON.stringify(raw)), /「消息」不是列表/);
});

test('缺表时被拦住，并把缺的表名用中文列出来', () => {
  const raw = makeRaw();
  const tables = raw.tables as Record<string, unknown>;
  delete tables.moments;
  delete tables.worldbooks;
  assert.throws(() => parseBackup(JSON.stringify(raw)), (err: unknown) => {
    const message = (err as Error).message;
    assert.match(message, /缺少这些数据/);
    assert.match(message, /朋友圈/);
    assert.match(message, /世界书/);
    assert.match(message, /已停止导入/);
    return true;
  });
});

test('空备份（每张表都是空列表）是合法的', () => {
  const file = parseBackup(JSON.stringify(buildBackup(makeTables(), 6)));
  assert.strictEqual(Object.keys(file.tables).length, 12);
  assert.strictEqual(backupSummary(file), '这份备份是空的');
});

/* -------------------------------------------------------------------------- */
/* 摘要                                                                      */
/* -------------------------------------------------------------------------- */

test('摘要只列有内容的表，按固定顺序', () => {
  const file = buildBackup(
    makeTables({
      messages: [{ id: 'm' }, { id: 'n' }],
      characters: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      conversations: [{ id: 'c' }],
    }),
    6,
  );
  assert.strictEqual(backupSummary(file), '角色 3 · 会话 1 · 消息 2');
});

test('摘要里一张有内容的表都没有时给一句人话', () => {
  assert.strictEqual(backupSummary(buildBackup(makeTables(), 6)), '这份备份是空的');
});

test('摘要不含条数为 0 的表', () => {
  const file = buildBackup(makeTables({ providers: [{ id: 'p' }] }), 6);
  assert.strictEqual(backupSummary(file), '服务商 1');
});
