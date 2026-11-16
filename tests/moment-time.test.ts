import assert from 'node:assert/strict';
import test from 'node:test';

import { momentTime } from '../src/apps/chat/home/moment-time.ts';

/* ==========================================================================
   朋友圈时间说法

   重点不是「能显示」，而是几条不该出错的地方：
   - 时钟回拨 / 未来时间不许出现「-3 分钟前」
   - 昨天不能因为「差 25 小时」就被算成日期
   - 跨年要带上年份
   ========================================================================== */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 固定一个「现在」，避免测试依赖跑的时刻 */
const NOW = new Date('2026-11-11T16:00:00+08:00').getTime();

test('一分钟以内说刚刚', () => {
  assert.strictEqual(momentTime(NOW, NOW), '刚刚');
  assert.strictEqual(momentTime(NOW - 59_000, NOW), '刚刚');
});

test('一小时以内说分钟', () => {
  assert.strictEqual(momentTime(NOW - MINUTE, NOW), '1 分钟前');
  assert.strictEqual(momentTime(NOW - 59 * MINUTE, NOW), '59 分钟前');
});

test('一天以内说小时', () => {
  assert.strictEqual(momentTime(NOW - HOUR, NOW), '1 小时前');
  assert.strictEqual(momentTime(NOW - 23 * HOUR, NOW), '23 小时前');
});

test('昨天说「昨天」，而不是「25 小时前」或日期', () => {
  // 前一天 14:00，距现在 26 小时 —— 按小时算会很难读，按日期算又还太近
  const yesterdayAfternoon = new Date('2026-11-10T14:00:00+08:00').getTime();
  assert.strictEqual(momentTime(yesterdayAfternoon, NOW), '昨天');
});

test('前天及更早说日期', () => {
  const twoDaysAgo = new Date('2026-11-09T10:00:00+08:00').getTime();
  assert.strictEqual(momentTime(twoDaysAgo, NOW), '11 月 9 日');
});

test('去年的动态带上年份', () => {
  const lastYear = new Date('2025-03-04T10:00:00+08:00').getTime();
  assert.strictEqual(momentTime(lastYear, NOW), '2025 年 3 月 4 日');
});

test('时钟回拨：未来时间不许出现负号', () => {
  assert.strictEqual(momentTime(NOW + 5 * MINUTE, NOW), '刚刚');
  assert.ok(!momentTime(NOW + DAY, NOW).includes('-'));
});

test('非法时间戳不抛错，返回空字符串', () => {
  assert.strictEqual(momentTime(Number.NaN, NOW), '');
});

test('跨年边界：12 月 31 日到 1 月 1 日', () => {
  const now = new Date('2027-01-01T10:00:00+08:00').getTime();
  const lastDay = new Date('2026-12-31T14:00:00+08:00').getTime();
  // 只差 20 小时，仍按小时说 —— 「昨天」是给超过 24 小时的跨日准备的
  assert.strictEqual(momentTime(lastDay, now), '20 小时前');

  // 超过 24 小时且落在昨天：说「昨天」，不是「12 月 31 日」
  const yesterdayEarly = new Date('2026-12-31T08:00:00+08:00').getTime();
  assert.strictEqual(momentTime(yesterdayEarly, now), '昨天');

  const older = new Date('2026-12-30T14:00:00+08:00').getTime();
  assert.strictEqual(momentTime(older, now), '2026 年 12 月 30 日');
});
