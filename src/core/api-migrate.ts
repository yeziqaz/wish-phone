import type { Bindings, ModelKind, Provider } from './types';
import type { Assignment, Capability, Site, SiteLimits, SiteModel } from './api-types';
import { DEFAULT_LIMITS, assignmentId } from './api-types';
import { inferSeries, inferSiteType } from './api-catalog';
import {
  listProviders,
  listSites,
  newId,
  putAssignment,
  putSite,
} from './db';
// 老的分配关系存在 settings 里，读法只有这一个地方知道，不在这里重复拼 key
import { getBindings } from './model-bindings';

/* ==========================================================================
   老数据搬家：Provider（v2~v4） → Site + Assignment（v5，设计文档 v1.1）

   为什么放在应用层、不塞进 IndexedDB 的 upgrade：
     要读 settings 里的分配关系，还要能把老 Provider 的额外字段留着，
     塞进 upgrade 里既挤又没法重试。

   幂等：sites 表非空就直接返回，反复启动不会跑第二遍。
   **老 providers 表一个字都不删** —— 界面换完、用户确认没问题之后再说。
   ========================================================================== */

/** 老的四类，映射到新的六种能力 */
const LEGACY_KIND: Record<ModelKind, Capability> = {
  text: 'text',
  image: 'image',
  voice: 'tts',
  video: 'video',
};

function limitsOf(provider: Provider): SiteLimits {
  const advanced = provider.advanced;
  return {
    concurrent: DEFAULT_LIMITS.concurrent,
    // 老结构里限流是个开关，关着就按默认值走
    rpm: advanced?.rateLimit?.enabled ? advanced.rateLimit.perMinute : DEFAULT_LIMITS.rpm,
    overflow: 'queue',
    timeout: DEFAULT_LIMITS.timeout,
    retry: advanced?.breaker?.enabled ? advanced.breaker.failCount : DEFAULT_LIMITS.retry,
  };
}

function modelsOf(provider: Provider): SiteModel[] {
  return provider.models.map((model) => {
    // 这里**故意不重新推断**能力：老卡片上的标签是用户看到过的，
    // 搬家时原样留着更安全。多标签重新推断发生在步骤 3「拉取模型」时。
    const kinds = [LEGACY_KIND[(model.kind ?? provider.kind ?? 'text') as ModelKind] ?? 'text'];
    return {
      id: model.id,
      name: model.displayName || model.id,
      kinds,
      series: inferSeries(model.id),
      enabled: model.enabled,
      isPrimary: false,
      // 老卡片上的能力是推断出来的，不算「用户改过」
      manualEdited: { kinds: false, series: false },
      limits: null,
      contextLength: model.contextLength ?? null,
    };
  });
}

/**
 * 老 Provider 上有几项新结构放不下（自定义接口路径、厂商、分组）。
 * 不丢，全部折进备注里，用户以后自己决定留不留。
 */
function noteOf(provider: Provider): string {
  const lines: string[] = [];
  if (provider.apiPath && provider.apiPath !== '/chat/completions') {
    lines.push(`自定义接口路径：${provider.apiPath}`);
  }
  if (provider.vendor) lines.push(`厂商：${provider.vendor}`);
  if (provider.group) lines.push(`分组：${provider.group}`);
  return lines.join('\n');
}

export function siteFromProvider(provider: Provider): Site {
  const keys = provider.keys.map((key) => ({
    id: key.id || newId(),
    value: key.value,
    label: key.label,
    enabled: key.enabled,
    abnormal: false,
  }));

  // 老结构：multiKey 关着就只用第一个 Key；开着时 rotate = 轮流、group = 固定
  const fixed = !provider.multiKey || provider.keyMode === 'group';

  return {
    id: provider.id,
    name: provider.name,
    siteType: inferSiteType(provider.baseUrl),
    protocol: provider.protocol,
    url: provider.baseUrl,
    keys,
    keyMode: fixed ? 'fixed' : 'roundrobin',
    fixedKeyId: fixed ? (keys[0]?.id ?? '') : '',
    limits: limitsOf(provider),
    models: modelsOf(provider),
    links: [],
    note: noteOf(provider),
    balance: null,
    lastTest: null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

/** 老的「全局 / 角色」两层，升级成新的「global / role」两条分配记录 */
export function assignmentsFromBindings(bindings: Bindings, siteIds: Set<string>): Assignment[] {
  const result: Assignment[] = [];

  const push = (
    scope: 'global' | 'role',
    scopeId: string,
    kind: ModelKind,
    ref: { providerId: string; modelId: string } | undefined,
  ): void => {
    if (!ref || !siteIds.has(ref.providerId)) return;
    const capability = LEGACY_KIND[kind];
    if (!capability) return;
    result.push({
      id: assignmentId(scope, scopeId, capability),
      scope,
      scopeId,
      kind: capability,
      target: { type: 'model', siteId: ref.providerId, modelId: ref.modelId },
      fallback: null,
      aux: null,
    });
  };

  for (const [kind, ref] of Object.entries(bindings.byKind)) {
    push('global', '', kind as ModelKind, ref);
  }
  for (const [characterId, perKind] of Object.entries(bindings.characters)) {
    for (const [kind, ref] of Object.entries(perKind ?? {})) {
      push('role', characterId, kind as ModelKind, ref);
    }
  }

  return result;
}

export interface MigrationResult {
  sites: number;
  assignments: number;
  skipped: boolean;
}

/**
 * 执行搬家。返回搬了多少条。
 * `skipped: true` 表示 sites 表里已经有东西了，这次什么都没做。
 */
export async function migrateProvidersToSites(): Promise<MigrationResult> {
  const existing = await listSites();
  if (existing.length > 0) return { sites: 0, assignments: 0, skipped: true };

  const providers = await listProviders();
  if (providers.length === 0) return { sites: 0, assignments: 0, skipped: false };

  const sites = providers.map(siteFromProvider);
  for (const site of sites) await putSite(site);

  const bindings = await getBindings();
  const assignments = assignmentsFromBindings(bindings, new Set(sites.map((site) => site.id)));
  for (const assignment of assignments) await putAssignment(assignment);

  return { sites: sites.length, assignments: assignments.length, skipped: false };
}
