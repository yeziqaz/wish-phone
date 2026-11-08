import type { ApiConfig, ModelInfo } from '../types';
import type { Site, SiteBalance, SiteModel, SiteTest } from '../../core/api-types';
import { putSite } from '../../core/db';
import { inferKinds, inferSeries } from '../../core/api-catalog';
import { ApiError, toApiError } from '../errors';
import { listModels, silentJsonGet, testConnection } from '../client';

/* ==========================================================================
   OpenAI 兼容适配器（设计文档 §9.1 / §9.2）

   这个文件不许自己发请求 —— 所有 HTTP 都走 client.ts（AGENTS §2 铁律）。
   它只干两件事：把 Site 翻译成 client 认识的配置、把返回结果翻回 Site。

   别的协议（NovelAI / MiniMax …）以后各写一份，对外露出同一组函数，
   业务代码不关心对方是哪家。
   ========================================================================== */

/** 挑一个能用的 Key：跳过停用的和被测出异常的。选定就固定用它 */
export function pickKey(site: Site): string {
  if (site.keyMode === 'fixed' && site.fixedKeyId) {
    const fixed = site.keys.find((key) => key.id === site.fixedKeyId && key.enabled);
    if (fixed && !fixed.abnormal) return fixed.value;
  }
  return site.keys.find((key) => key.enabled && !key.abnormal)?.value ?? '';
}

function configOf(site: Site, key: string, model = ''): ApiConfig {
  return { baseUrl: site.url, apiKey: key, model, temperature: 0 };
}

/** 站点里第一个启用的模型，测试连接时用来兜底 */
function firstModelId(site: Site): string {
  return site.models.find((model) => model.enabled)?.id ?? site.models[0]?.id ?? '';
}

/**
 * 把接口返回的模型列表和站点里已有的合并。
 *
 * 三条不能破的规矩（文档 §6.3）：
 *   1. 用户手动改过的能力 / 系列，重新拉取时**不许**被覆盖
 *   2. 已经启用过的模型，重新拉取后仍然是启用的
 *   3. 已经拉下来、这次接口没返回的模型，直接不要（跟着服务端走）
 */
export function mergeModels(previous: SiteModel[], incoming: ModelInfo[]): SiteModel[] {
  return incoming.map((info) => {
    const old = previous.find((model) => model.id === info.id);
    return {
      id: info.id,
      name: info.label || info.id,
      kinds: old?.manualEdited.kinds ? old.kinds : inferKinds(info.id),
      series: old?.manualEdited.series ? old.series : inferSeries(info.id),
      // 新拉下来的模型**默认不启用**（用户要求：别一口气全开）。
      // 已经拉过一次的模型保留原来的开关状态。
      enabled: old?.enabled ?? false,
      isPrimary: old?.isPrimary ?? false,
      manualEdited: old?.manualEdited ?? { kinds: false, series: false },
      limits: old?.limits ?? null,
      contextLength: info.contextLength ?? old?.contextLength ?? null,
    };
  });
}

export interface PullResult {
  ok: boolean;
  models: SiteModel[];
  message: string;
}

/** 拉取模型列表。失败时把原因翻成人话，不抛异常 */
export async function pullModels(site: Site): Promise<PullResult> {
  const key = pickKey(site);
  if (!key) return { ok: false, models: site.models, message: '这个站点还没有可用的 Key' };

  try {
    const infos = await listModels(configOf(site, key));
    if (infos.length === 0) {
      return { ok: false, models: site.models, message: '接口连上了，但一个模型都没返回' };
    }
    return { ok: true, models: mergeModels(site.models, infos), message: `拉到 ${infos.length} 个模型` };
  } catch (error) {
    return { ok: false, models: site.models, message: humanize(error) };
  }
}

/** 测试连接。不消耗额度：优先打 /models，不支持才退回一条最小对话 */
export async function testSite(site: Site): Promise<SiteTest> {
  const key = pickKey(site);
  if (!key) return { ok: false, at: Date.now(), message: '这个站点还没有可用的 Key' };

  try {
    await testConnection(configOf(site, key, firstModelId(site)));
    return { ok: true, at: Date.now(), message: '连接正常' };
  } catch (error) {
    return { ok: false, at: Date.now(), message: humanize(error) };
  }
}

/** 把 API 层的人话错误压成一行，塞进站点的 lastTest */
function humanize(error: unknown): string {
  const apiError = error instanceof ApiError ? error : toApiError(error);
  return apiError.info.detail || apiError.info.title;
}
/* ==========================================================================
   余额查询（设计文档 §9.3）

   中转站常见的是 new-api / one-api 面板，余额在 /dashboard/billing/... 或
   /api/user/self 这类路径上，各家不统一。

   规矩（文档 §9.3 + §14）：
     · 查不到就返回 null，**不报错、不打扰用户**，界面显示「不支持查询」
     · 绝不猜测余额，更不许拿估算值填上
   ========================================================================== */

interface BalanceProbe {
  /** 相对于 base url 的路径 */
  path: string;
  /** 从返回的 JSON 里抠出余额；抠不出来返回 null */
  read: (data: Record<string, unknown>) => { value: number; unit: string } | null;
}

/** 按可能性排的探测清单。第一条命中就停 */
const BALANCE_PROBES: BalanceProbe[] = [
  {
    // new-api / one-api 最常见的两个字段：remain_quota（按 500000 = 1 美元）/ quota
    path: '/dashboard/billing/subscription',
    read: (data) => {
      const hardLimit = data.hard_limit_usd ?? data.system_hard_limit_usd;
      if (typeof hardLimit === 'number') return { value: round(hardLimit), unit: 'USD' };
      const remain = data.remain_quota ?? data.quota;
      if (typeof remain === 'number') return { value: round(remain / 500_000), unit: 'USD' };
      return null;
    },
  },
  {
    path: '/dashboard/billing/usage',
    read: (data) => {
      const total = data.total_usage ?? data.usage;
      if (typeof total === 'number') return { value: round(total / 100), unit: 'USD' };
      return null;
    },
  },
  {
    path: '/api/user/self',
    read: (data) => {
      const inner = data.data;
      const node = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : data;
      const quota = node.quota;
      if (typeof quota === 'number') return { value: round(quota / 500_000), unit: 'USD' };
      return null;
    },
  },
  {
    path: '/credits',
    read: (data) => {
      const credits = data.credits ?? data.balance;
      if (typeof credits === 'number') return { value: round(credits), unit: '' };
      if (typeof credits === 'string' && credits.trim() !== '' && Number.isFinite(Number(credits))) {
        return { value: round(Number(credits)), unit: '' };
      }
      return null;
    },
  },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 查余额。查到了就写回站点并返回新值；查不到返回 null。
 *
 * ⚠️ 这个函数**永远不会抛异常**。余额是锦上添花，不能因为它让页面红一片。
 */
export async function refreshBalance(site: Site): Promise<SiteBalance | null> {
  const key = pickKey(site);
  if (!key) return null;

  for (const probe of BALANCE_PROBES) {
    try {
      const response = await silentJsonGet(`${site.url.replace(/\/+$/, '')}${probe.path}`, {
        apiKey: key,
        timeoutMs: 8000,
      });
      if (!response) continue;
      const found = probe.read(response);
      if (!found) continue;

      const balance: SiteBalance = {
        value: found.value,
        unit: found.unit,
        updatedAt: Date.now(),
      };
      site.balance = balance;
      site.updatedAt = Date.now();
      await putSite(site);
      return balance;
    } catch {
      // 换下一条路径继续试。查不到就是「不支持」，不是错误
    }
  }

  // 全都试不出来：把结果记成 null，界面显示「不支持查询」
  site.balance = null;
  await putSite(site);
  return null;
}
