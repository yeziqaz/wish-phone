import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 统一调用入口的纯逻辑部分（不碰 IndexedDB 的部分）。
 *
 * call.ts 里的 pickSiteKey / quotaSnapshot / noteKeyResult 走的是模块级
 * 内存 Map，这里直接 import 测它们 —— 它们不发 HTTP、不碰 DOM。
 */
import { pickSiteKey, quotaSnapshot, waitingCount } from '../src/ai/call';
import type { Site } from '../src/core/api-types';

function makeSite(keys: Array<{ enabled?: boolean; abnormal?: boolean; value?: string; id?: string; label?: string }> = []): Site {
  const site = {} as Site;
  site.id = 's1';
  site.name = '测试站';
  site.url = 'https://example.com/v1';
  site.siteType = 'official';
  site.models = [];
  site.keys = keys.map((key, index) => ({
    id: key.id ?? `k${index + 1}`,
    label: key.label ?? '',
    value: key.value ?? `sk-${index + 1}`,
    enabled: key.enabled ?? true,
    abnormal: key.abnormal ?? false,
  }));
  site.keyMode = 'roundrobin';
  site.limits = { concurrent: 2, rpm: 100, overflow: 'queue', timeout: 30, retry: 1 };
  return site;
}

test('选 Key：轮询顺序，跳过停用和异常', () => {
  const site = makeSite([
    { id: 'a', label: '甲' },
    { id: 'b', label: '乙', enabled: false },
    { id: 'c', label: '丙', abnormal: true },
    { id: 'd', label: '丁' },
  ]);
  // 轮询走两遍，验证它只碰可用的 a 和 d
  const first = pickSiteKey(site);
  const second = pickSiteKey(site);
  assert.equal(first?.id, 'a');
  assert.equal(second?.id, 'd');
});

test('选 Key：固定模式只认 fixedKeyId', () => {
  const site = makeSite([{ id: 'a' }, { id: 'b' }]);
  site.keyMode = 'fixed';
  site.fixedKeyId = 'b';
  const picked = pickSiteKey(site);
  assert.equal(picked?.id, 'b');
});

test('选 Key：固定 Key 被停用了就整个站没 Key 可用', () => {
  const site = makeSite([{ id: 'a', enabled: false }, { id: 'b' }]);
  site.keyMode = 'fixed';
  site.fixedKeyId = 'a';
  // 固定 Key 不在可用名单里，就退化成轮询
  const picked = pickSiteKey(site);
  assert.equal(picked?.id, 'b');
});

test('限流快照：初始为 0', () => {
  const site = makeSite([]);
  site.id = 'fresh-' + Math.random().toString(36).slice(2);
  const snap = quotaSnapshot(site);
  assert.equal(snap.running, 0);
  assert.equal(snap.usedThisMinute, 0);
  assert.equal(waitingCount(site.id), 0);
});

import { mergeStrictLimits } from '../src/ai/call';

test('模型级限制：和站点取更严格（文档 §10.4）', () => {
  const site = makeSite([]);
  site.limits = { concurrent: 4, rpm: 120, overflow: 'queue', timeout: 30, retry: 1 };

  // 完全没配模型限制 → 全部跟随站点
  const model = { id: 'm1', name: 'm1', enabled: true, kinds: ['text' as const], series: 'other' as const, contextLength: 0, isPrimary: false, manualEdited: { kinds: false, series: false }, limits: null };
  assert.deepEqual(mergeStrictLimits(site, model), site.limits);

  // 模型只配了并发 2、速率 60 → 并发取 2（更严），速率取 60（更严），超时/重试仍跟随
  model.limits = { concurrent: 2, rpm: 60 };
  const merged = mergeStrictLimits(site, model);
  assert.equal(merged.concurrent, 2);
  assert.equal(merged.rpm, 60);
  assert.equal(merged.timeout, 30);
  assert.equal(merged.retry, 1);

  // 模型配得比站点松 → 取站点的
  model.limits = { concurrent: 8, rpm: 200 };
  assert.equal(mergeStrictLimits(site, model).concurrent, 4);

  // 0 = 不限：模型说不限并发，就取站点；两边都不限，就是不设限
  model.limits = { concurrent: 0, rpm: 0 };
  assert.equal(mergeStrictLimits(site, model).concurrent, 4);
  site.limits = { concurrent: 0, rpm: 0, overflow: 'queue', timeout: 30, retry: 0 };
  assert.equal(mergeStrictLimits(site, model).concurrent, 0);
});

import { pickAssignment } from '../src/ai/call';

/** 造一条分配 */
function assignment(
  scope: 'global' | 'app' | 'role',
  scopeId: string,
  kind: 'text' | 'image',
  modelId: string | null,
): any {
  return {
    id: `${scope}:${scopeId}:${kind}`,
    scope,
    scopeId,
    kind,
    target: modelId ? { type: 'model', siteId: 's1', modelId } : null,
    fallback: null,
    aux: null,
  };
}

test('分配优先级：角色 > App > 全局（文档 §10.1）', () => {
  const glob = assignment('global', '', 'text', 'global-model');
  const appOnly = [glob, assignment('app', 'chat', 'text', 'app-model')];
  const both = [...appOnly, assignment('role', 'r1', 'text', 'role-model')];

  // 三层都有 → 角色赢
  assert.equal(pickAssignment(both, 'text', { appId: 'chat', roleId: 'r1' })?.target?.modelId, 'role-model');
  // 角色没有 → App 赢
  assert.equal(pickAssignment(appOnly, 'text', { appId: 'chat', roleId: 'r1' })?.target?.modelId, 'app-model');
  // App 也没有 → 全局
  assert.equal(pickAssignment([glob], 'text', { appId: 'chat', roleId: 'r1' })?.target?.modelId, 'global-model');
});

test('分配优先级：别的角色 / 别的 App 的设置不会串味', () => {
  const all = [
    assignment('global', '', 'text', 'global-model'),
    assignment('app', 'chat', 'text', 'chat-model'),
    assignment('role', 'r1', 'text', 'r1-model'),
  ];

  // 用 r2 聊天 → 不受 r1 影响，走 App
  assert.equal(pickAssignment(all, 'text', { appId: 'chat', roleId: 'r2' })?.target?.modelId, 'chat-model');
  // 论坛是别的 App，没有自己的设置 → 走全局
  assert.equal(pickAssignment(all, 'text', { appId: 'forum' })?.target?.modelId, 'global-model');
});

test('分配解析：target 为空等于没设置，要往上找', () => {
  const all = [
    assignment('global', '', 'text', 'global-model'),
    assignment('app', 'chat', 'text', null),
    assignment('role', 'r1', 'text', null),
  ];
  // 角色和 App 都是空壳 → 仍然落到全局
  assert.equal(pickAssignment(all, 'text', { appId: 'chat', roleId: 'r1' })?.target?.modelId, 'global-model');
});

test('分配解析：能力互不干扰', () => {
  const all = [
    assignment('global', '', 'text', 'text-model'),
    assignment('global', '', 'image', 'image-model'),
  ];
  assert.equal(pickAssignment(all, 'text', {})?.target?.modelId, 'text-model');
  assert.equal(pickAssignment(all, 'image', {})?.target?.modelId, 'image-model');
});

test('分配解析：一条都没设就返回 null（界面据此提示「去设置」）', () => {
  assert.equal(pickAssignment([], 'text', { appId: 'chat', roleId: 'r1' }), null);
  assert.equal(pickAssignment([assignment('global', '', 'text', null)], 'text', {}), null);
});
