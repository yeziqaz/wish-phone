import type { Assignment, Capability, RequestLog, Site, SiteLimits, SiteModel, Target } from '../core/api-types';
import {
  assignmentId,
  CAPABILITY_LABEL,
  DEFAULT_LIMITS,
} from '../core/api-types';
import {
  deleteAssignment,
  deleteSite,
  getSite,
  listAssignments,
  listSites,
  newId,
  putAssignment,
  putLog,
  putSite,
} from '../core/db';
import { ApiError, toApiError } from './errors';
import { chat as rawChat, generateImage as rawGenerateImage, synthesizeSpeech as rawSpeech } from './client';
import type { ChatMessage } from './types';

/* ==========================================================================
   统一调用入口（设计文档 §10.1）

   所有 AI 调用只能从这里出去。内部顺序严格照文档：
     1. getProfile  → 角色 > App > 全局，都没有就报「还没设置」
     2. 辅助模型改写（挂在生图/生视频上）
     3. 选 Key（轮询 / 固定，跳过停用和异常）
     4. 进限流队列
     5. 交给适配器
     6. 失败 → 重试 → 备用模型
     7. 写日志（无论成败）

   ⚠️ 这一层不许碰 DOM。它抛 ApiError 或 SetupError，界面负责翻译。
   ⚠️ 这个文件不发 fetch —— 请求都经 adapters/ 与 client.ts。
   ========================================================================== */

/** 配置缺失（不是网络错误）。界面应该引导用户去分配页，而不是显示「重试」 */
export class SetupError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability, message?: string) {
    super(message ?? `还没有设置${CAPABILITY_LABEL[capability]}模型`);
    this.name = 'SetupError';
    this.capability = capability;
  }
}

export interface CallContext {
  appId?: string;
  roleId?: string;
}

/** 解析出来的「这次用哪个站点的哪个模型」 */
export interface Profile {
  capability: Capability;
  site: Site;
  model: SiteModel;
  /** 备用模型，可能为 null */
  fallback: { site: Site; model: SiteModel } | null;
  /** 辅助模型（提示词改写），可能为 null */
  aux: { site: Site; model: SiteModel } | null;
}

/* ==========================================================================
   1. 解析分配：角色 > App > 全局
   ========================================================================== */

/**
 * 找出这个能力最终用哪条分配。
 *
 * 文档 §10.1：先查角色有没有设置 → 没有就查 App → 再没有就用全局。
 * 返回 null 表示三层都没设置。
 */
/**
 * 纯逻辑版：给定一份分配清单，算出这个能力该用哪条。
 *
 * 和下面的 resolveAssignment 分开，是为了能脱离数据库测「角色 > App > 全局」
 * 这条优先级 —— 这是整个模块最容易写错、也最难在界面上看出来的地方。
 */
export function pickAssignment(
  all: Assignment[],
  capability: Capability,
  context: CallContext = {},
): Assignment | null {
  const find = (scope: Assignment['scope'], scopeId: string): Assignment | undefined =>
    all.find(
      (item) => item.scope === scope && item.scopeId === scopeId && item.kind === capability,
    );

  // 角色自己有设置就用角色的
  if (context.roleId) {
    const role = find('role', context.roleId);
    if (role?.target) return role;
  }
  // 没有再看这个 App 有没有单独设
  if (context.appId) {
    const app = find('app', context.appId);
    if (app?.target) return app;
  }
  // 都没有就用全局
  const global = find('global', '');
  return global?.target ? global : null;
}

export async function resolveAssignment(
  capability: Capability,
  context: CallContext = {},
): Promise<Assignment | null> {
  return pickAssignment(await listAssignments(), capability, context);
}

/** 把分配里的 target 换成真实的站点和模型。站点或模型没了就是 null */
async function loadTarget(
  target: { siteId: string; modelId: string } | null,
): Promise<{ site: Site; model: SiteModel } | null> {
  if (!target?.siteId) return null;
  const site = await getSite(target.siteId);
  if (!site) return null;
  const model = site.models.find((item) => item.id === target.modelId);
  if (!model) return null;
  return { site, model };
}

/**
 * 拿到这次调用的完整画像。
 * 分配有、但站点或模型已经被删了 → 当成「没设置」处理并说清楚原因。
 */
export async function getProfile(
  capability: Capability,
  context: CallContext = {},
): Promise<Profile> {
  const assignment = await resolveAssignment(capability, context);
  if (!assignment) throw new SetupError(capability);

  const main = await loadTarget(assignment.target);
  if (!main) {
    throw new SetupError(
      capability,
      `${CAPABILITY_LABEL[capability]}模型指向的站点或模型已经不在了，去「分配」里重新选一个。`,
    );
  }

  return {
    capability,
    site: main.site,
    model: main.model,
    fallback: assignment.fallback ? await loadTarget(assignment.fallback) : null,
    aux: assignment.aux && assignment.aux.mode !== 'off' ? await loadAux(assignment, context) : null,
  };
}

/** 辅助模型：off 已在外层排除，followText 用文本能力的分配，custom 用指定的 */
async function loadAux(
  assignment: Assignment,
  context: CallContext,
): Promise<{ site: Site; model: SiteModel } | null> {
  const aux = assignment.aux;
  if (!aux) return null;
  if (aux.mode === 'custom') return loadTarget({ siteId: aux.siteId, modelId: aux.modelId });

  // followText：递归查文本能力的分配。用 resolveAssignment 而不是 getProfile，
  // 免得文本能力没设置时直接抛异常 —— 改写是可选的，没有就跳过。
  const text = await resolveAssignment('text', context);
  return text ? loadTarget(text.target) : null;
}

/* ==========================================================================
   2. 选 Key（文档 §10.3）

   轮询：记住每个站点的游标，依次往下走。
   固定：只用 fixedKeyId。
   两种都跳过 enabled=false 和 abnormal=true。
   ========================================================================== */

/** 轮询游标。只活在内存里，刷新页面从头开始 —— 这没有副作用 */
const cursors = new Map<string, number>();

/** 连续失败计数，连续 3 次鉴权/余额类错误就标异常 */
const failures = new Map<string, number>();
const ABNORMAL_THRESHOLD = 3;

export function pickSiteKey(site: Site): { id: string; value: string } | null {
  const usable = site.keys.filter((key) => key.enabled && !key.abnormal && key.value.trim());
  if (usable.length === 0) return null;

  if (site.keyMode === 'fixed' && site.fixedKeyId) {
    const fixed = usable.find((key) => key.id === site.fixedKeyId);
    if (fixed) return fixed;
  }

  const index = cursors.get(site.id) ?? 0;
  const key = usable[index % usable.length];
  cursors.set(site.id, index + 1);
  return key ?? null;
}

/** 这个错误算不算「这个 Key 本身有问题」（文档 §10.3 只算鉴权和余额） */
function isKeyFault(error: unknown): boolean {
  return error instanceof ApiError && (error.info.kind === 'auth' || error.info.kind === 'quota');
}

/** 记一次失败；到阈值就把 Key 标记成异常 */
export async function noteKeyResult(site: Site, keyId: string, ok: boolean): Promise<void> {
  const slot = `${site.id}:${keyId}`;
  if (ok) {
    failures.delete(slot);
    // 成功后顺手解除异常标记（文档 §10.3：测试成功也能解除）
    const key = site.keys.find((item) => item.id === keyId);
    if (key?.abnormal) {
      key.abnormal = false;
      site.updatedAt = Date.now();
      await putSite(site);
    }
    return;
  }

  const count = (failures.get(slot) ?? 0) + 1;
  failures.set(slot, count);
  if (count < ABNORMAL_THRESHOLD) return;

  const key = site.keys.find((item) => item.id === keyId);
  if (key && !key.abnormal) {
    key.abnormal = true;
    site.updatedAt = Date.now();
    await putSite(site);
  }
  failures.delete(slot);
}

/** 手动恢复一个被标异常的 Key（配置 Tab 的「恢复」按钮用） */
export async function recoverKey(site: Site, keyId: string): Promise<void> {
  const key = site.keys.find((item) => item.id === keyId);
  if (!key) return;
  key.abnormal = false;
  site.updatedAt = Date.now();
  await putSite(site);
  failures.delete(`${site.id}:${keyId}`);
}

/* ==========================================================================
   3. 限流队列（文档 §10.2）

   站点级：并发数 + 每分钟次数。超出时按 overflow 排队或直接报错。
   队列状态留给「限制」Tab 实时显示。
   ========================================================================== */

interface Gauge {
  /** 正在进行的请求数 */
  running: number;
  /** 最近 60 秒的请求时间戳 */
  recent: number[];
}

const gauges = new Map<string, Gauge>();

function gaugeOf(siteId: string): Gauge {
  const found = gauges.get(siteId);
  if (found) return found;
  const created: Gauge = { running: 0, recent: [] };
  gauges.set(siteId, created);
  return created;
}

/**
 * 站点限制和模型限制取更严格的那个（文档 §10.4）。
 * 都是 0 表示不限；限流只认「有上限」的那一侧。
 */
function strictLimits(site: Site, model: SiteModel | null): SiteLimits {
  const base = site.limits ?? DEFAULT_LIMITS;
  const modelLimits = model?.limits;
  if (!modelLimits) return base;

  const tighter = (a: number, b: number): number => {
    // 0 = 不限，所以两个里取「非 0 且更小」的那个；两个都有限就取 min
    if (a === 0) return b;
    if (b === 0) return a;
    return Math.min(a, b);
  };

  return {
    concurrent: tighter(base.concurrent, modelLimits.concurrent ?? 0),
    rpm: tighter(base.rpm, modelLimits.rpm ?? 0),
    timeout: modelLimits.timeout ?? base.timeout,
    retry: modelLimits.retry ?? base.retry,
    overflow: base.overflow,
  };
}

/** 供测试与限制页用：把「取更严格」的结果导出来看 */
export const mergeStrictLimits = strictLimits;

/** 供限制 Tab 读的实时状态 */
export function quotaSnapshot(site: Site): { running: number; usedThisMinute: number } {
  const gauge = gaugeOf(site.id);
  const cutoff = Date.now() - 60_000;
  return {
    running: gauge.running,
    usedThisMinute: gauge.recent.filter((time) => time > cutoff).length,
  };
}

/** 队列里还有几个在等 */
const waiting = new Map<string, number>();
export function waitingCount(siteId: string): number {
  return waiting.get(siteId) ?? 0;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 拿到一个「可以发请求了」的名额。用完必须 release。
 * 0 表示不限。模型级限制和站点级取更严格的那个。
 */
async function acquire(site: Site, model: SiteModel | null = null): Promise<() => void> {
  const effective = strictLimits(site, model);
  const limits = effective;
  const gauge = gaugeOf(site.id);
  const release = (): void => {
    gauge.running = Math.max(0, gauge.running - 1);
  };

  const tooMany = (): boolean => {
    const now = Date.now();
    gauge.recent = gauge.recent.filter((time) => time > now - 60_000);
    const concurrentHit = limits.concurrent > 0 && gauge.running >= limits.concurrent;
    const rpmHit = limits.rpm > 0 && gauge.recent.length >= limits.rpm;
    return concurrentHit || rpmHit;
  };

  if (!tooMany()) {
    gauge.running += 1;
    gauge.recent.push(Date.now());
    return release;
  }

  if (effective.overflow === 'error') {
    throw new ApiError({
      kind: 'rate',
      title: '这个站点太忙了',
      detail: `「${site.name}」现在的并发或速率到了上限，而你把它设成了「直接报错」。`,
      hint: '等一会儿再试，或者去站点的「限制」Tab 把它改成「排队等待」。',
    });
  }

  // 排队：每 200ms 看一次有没有空位，最多等到超时
  const deadline = Date.now() + Math.max(1000, limits.timeout * 1000);
  waiting.set(site.id, (waiting.get(site.id) ?? 0) + 1);
  try {
    while (tooMany()) {
      if (Date.now() > deadline) {
        throw new ApiError({
          kind: 'rate',
          title: '排队等太久了',
          detail: `在「${site.name}」的队列里等了超过 ${limits.timeout} 秒，还是没轮上。`,
          hint: '把限制调宽松一点，或者过一会儿再发。',
        });
      }
      await sleep(200);
    }
    gauge.running += 1;
    gauge.recent.push(Date.now());
    return release;
  } finally {
    waiting.set(site.id, Math.max(0, (waiting.get(site.id) ?? 1) - 1));
  }
}

/* ==========================================================================
   4. 写日志（文档 §10.1 第 7 步）

   Token 用接口返回的真实值，拿不到就是 null → 界面显示「—」。
   **绝不估算**（文档 §14）。
   ========================================================================== */

async function writeLog(entry: Omit<RequestLog, 'id' | 'time'>): Promise<void> {
  try {
    await putLog({ ...entry, id: newId(), time: Date.now() });
  } catch {
    // 日志写失败不许影响主流程 —— 用户要的是回复，不是日志
  }
}

/* ==========================================================================
   5. 统一入口
   ========================================================================== */

export interface TextRequest {
  messages: ChatMessage[];
  temperature?: number;
}

export interface TextResult {
  text: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  /** 用了几次尝试 / 是否切过备用模型，便于界面提示 */
  attempts: number;
  usedFallback: boolean;
}

/**
 * 生成文本。这是聊天页唯一应该调的函数。
 *
 * 失败时抛 ApiError（网络/服务端问题）或 SetupError（没配置）。
 */
export async function callText(
  request: TextRequest,
  context: CallContext = {},
): Promise<TextResult> {
  const profile = await getProfile('text', context);

  // 候选序列：主模型 → 备用模型（文档 §10.1 第 6 步）
  const candidates: Array<{ site: Site; model: SiteModel; isFallback: boolean }> = [
    { site: profile.site, model: profile.model, isFallback: false },
  ];
  if (profile.fallback) {
    candidates.push({ ...profile.fallback, isFallback: true });
  }

  let attempts = 0;
  let lastError: unknown = null;
  let failedFrom: string | null = null;

  for (const candidate of candidates) {
    const effective = strictLimits(candidate.site, candidate.model);
    const tries = 1 + Math.max(0, effective.retry);

    // 切到备用模型那一刻，把主模型的失败记进日志（文档 §13 验收：日志里能看到切换）
    if (candidate.isFallback && lastError instanceof ApiError) {
      // candidates[0] 一定存在（主候选永远排第一），这里只是绕过 TS 的无下标访问
      const primarySite = candidates[0]?.site;
      const primaryModel = candidates[0]?.model;
      if (primarySite && primaryModel) {
        await writeLog({
          siteId: primarySite.id,
          modelId: primaryModel.id,
          kind: 'text',
          scope: { appId: context.appId ?? '', roleId: context.roleId ?? '' },
          inputTokens: null,
          outputTokens: null,
          durationMs: 0,
          status: 'error',
          errorMessage: lastError.info.detail,
        });
      }
    }

    for (let round = 0; round < tries; round += 1) {
      attempts += 1;
      const key = pickSiteKey(candidate.site);

      if (!key) {
        lastError = new SetupError(
          'text',
          `「${candidate.site.name}」没有可用的 Key。去站点的「配置」里加一个，或者把停用的打开。`,
        );
        break; // 换下一个候选（备用模型可能就正常）
      }

      const release = await acquire(candidate.site, candidate.model);
      const started = Date.now();
      // release 只能调一次：并发计数减多了会让限制形同虚设
      let released = false;
      const free = (): void => {
        if (released) return;
        released = true;
        release();
      };

      try {
        const result = await rawChat(request.messages, {
          baseUrl: candidate.site.url,
          apiKey: key.value,
          model: candidate.model.id,
          temperature: request.temperature ?? 0.8,
        });

        free();
        await noteKeyResult(candidate.site, key.id, true);
        await writeLog({
          siteId: candidate.site.id,
          modelId: candidate.model.id,
          kind: 'text',
          scope: { appId: context.appId ?? '', roleId: context.roleId ?? '' },
          inputTokens: result.usage.promptTokens || null,
          outputTokens: result.usage.completionTokens || null,
          durationMs: Date.now() - started,
          status: 'success',
          errorMessage: '',
          ...(failedFrom ? { switchedFrom: failedFrom } : {}),
        });

        return {
          text: result.text,
          model: result.model,
          usage: {
            inputTokens: result.usage.promptTokens || null,
            outputTokens: result.usage.completionTokens || null,
          },
          attempts,
          usedFallback: candidate.isFallback,
        };
      } catch (error) {
        free();
        lastError = error;

        if (isKeyFault(error)) await noteKeyResult(candidate.site, key.id, false);

        // 配置类错误（地址/模型不对）重试没有意义，直接换候选
        const retryable =
          error instanceof ApiError &&
          (error.info.kind === 'network' ||
            error.info.kind === 'server' ||
            error.info.kind === 'rate' ||
            error.info.kind === 'offline' ||
            error.info.kind === 'cors');

        if (!retryable) break;
        if (round + 1 < tries) await sleep(400 * (round + 1));
      } finally {
        free();
      }
    }
  }

  // 全都没成：把最后一次的错误原样抛出去，它会带有人话说明
  const error = lastError instanceof SetupError ? lastError : toApiError(lastError);
  await writeLog({
    siteId: profile.site.id,
    modelId: profile.model.id,
    kind: 'text',
    scope: { appId: context.appId ?? '', roleId: context.roleId ?? '' },
    inputTokens: null,
    outputTokens: null,
    durationMs: 0,
    status: 'error',
    errorMessage: error instanceof ApiError ? error.info.detail : error.message,
  });
  throw error;
}

/* ==========================================================================
   6. 分配页要用的小工具
   ========================================================================== */

/** 某个能力、某作用域，现在有没有自定义 */
export async function hasCustom(
  scope: Assignment['scope'],
  scopeId: string,
  kind: Capability,
): Promise<boolean> {
  const all = await listAssignments();
  return all.some(
    (item) => item.scope === scope && item.scopeId === scopeId && item.kind === kind && !!item.target,
  );
}

/** 写一条分配。target 传 null 表示「跟随上级」 */
export async function assign(
  scope: Assignment['scope'],
  scopeId: string,
  kind: Capability,
  target: Target | null,
  extra: { fallback?: Assignment['fallback']; aux?: Assignment['aux'] } = {},
): Promise<void> {
  const all = await listAssignments();
  const id = assignmentId(scope, scopeId, kind);
  const existing = all.find((item) => item.id === id);

  if (!target) {
    // 「跟随上级」= 这条分配本身不该存在。
    // 但如果它还挂着备用模型 / 辅助模型，就留一个 target 为 null 的空壳，
    // 因为那些设置是用户单独配的，不该跟着一起没。
    const keep = extra.fallback !== undefined ? extra.fallback : (existing?.fallback ?? null);
    const keepAux = extra.aux !== undefined ? extra.aux : (existing?.aux ?? null);
    if (keep || keepAux) {
      await putAssignment({ id, scope, scopeId, kind, target: null, fallback: keep, aux: keepAux });
      return;
    }
    // 只删这一条，不碰同一个作用域下的其它能力
    await deleteAssignment(id);
    return;
  }

  await putAssignment({
    id,
    scope,
    scopeId,
    kind,
    target,
    fallback: extra.fallback !== undefined ? extra.fallback : (existing?.fallback ?? null),
    aux: extra.aux !== undefined ? extra.aux : (existing?.aux ?? null),
  });
}

/** 清掉某个角色 / App 的全部自定义 */
export async function clearCustom(scope: Assignment['scope'], scopeId: string): Promise<void> {
  const { clearAssignments } = await import('../core/db');
  await clearAssignments(scope, scopeId);
}

/** 所有已启用的模型，按站点分组。选择器用这个 */
export async function availableModels(
  kind: Capability,
): Promise<Array<{ site: Site; models: SiteModel[] }>> {
  const sites = await listSites();
  return sites
    .map((site) => ({
      site,
      models: site.models.filter((model) => model.enabled && model.kinds.includes(kind)),
    }))
    .filter((entry) => entry.models.length > 0);
}

/** 删站点前查一遍：有分配指向它，就要提醒 */
export async function referencesOf(siteId: string): Promise<Assignment[]> {
  const all = await listAssignments();
  return all.filter(
    (item) =>
      item.target?.siteId === siteId ||
      item.fallback?.siteId === siteId ||
      item.aux?.siteId === siteId,
  );
}

/** 站点删掉之后，把指向它的分配清空（保留「没设置」状态） */
export async function detachSite(siteId: string): Promise<void> {
  const all = await listAssignments();
  for (const item of all) {
    let touched = false;
    if (item.target?.siteId === siteId) {
      item.target = null;
      touched = true;
    }
    if (item.fallback?.siteId === siteId) {
      item.fallback = null;
      touched = true;
    }
    if (item.aux?.siteId === siteId) {
      item.aux = null;
      touched = true;
    }
    if (touched) await putAssignment(item);
  }
}

export { deleteSite };
/* ==========================================================================
   6. 生图（设计文档 §11 / §9.2 的入口）

   走和文本一样的 解析分配 → 选 Key → 限流 → 发请求 → 写日志。
   区别只在最后一步交给 generateImage，不在 rawChat。

   提示词改写（§7.3）：挂在生图上。用户说「画一个雨天的教室」，
   先给改写模型扩写成详细描述，再交给生图模型。关闭时直接用原句。
   ========================================================================== */

export interface ImageRequest {
  prompt: string;
  /** 像素尺寸，透传给接口 */
  size?: string;
  /**
   * 跳过改写。true 时不管有没有配改写模型，都拿原句去生图。
   * 备用模型切换后自动带 true，避免二次改写。
   */
  noRewrite?: boolean;
}

export interface ImageResult {
  url: string;
  /** 实际发给生图模型的提示词（改写过就不是原句了） */
  prompt: string;
  /** 改写过 */
  rewritten: boolean;
  attempts: number;
  usedFallback: boolean;
}

export async function callImage(
  request: ImageRequest,
  context: CallContext = {},
): Promise<ImageResult> {
  const profile = await getProfile('image', context);

  // 辅助模型改写：off 时直接用原句。followText / custom 的站点已经在
  // getProfile 里解析好了。改写失败不许拦住主流程 —— 用户要的是图。
  let prompt = request.prompt;
  let rewritten = false;
  if (profile.aux && !request.noRewrite) {
    try {
      const key = pickSiteKey(profile.aux.site);
      if (key) {
        const rewrittenPrompt = await rawChat(
          [
            {
              role: 'system',
              content:
                '你是生图提示词改写器。把用户的一句话扩写成详细的画面描述：主体、构图、光线、风格、色调。只输出描述本身，不要解释。',
            },
            { role: 'user', content: request.prompt },
          ],
          {
            baseUrl: profile.aux.site.url,
            apiKey: key.value,
            model: profile.aux.model.id,
            temperature: 0.4,
          },
        ).then((result) => result.text.trim());
        if (rewrittenPrompt !== '') {
          prompt = rewrittenPrompt;
          rewritten = true;
        }
      }
    } catch {
      // 改写失败就用原句，不生图才叫事故
    }
  }

  const candidates: Array<{ site: Site; model: SiteModel; isFallback: boolean }> = [
    { site: profile.site, model: profile.model, isFallback: false },
  ];
  if (profile.fallback) candidates.push({ ...profile.fallback, isFallback: true });

  let attempts = 0;
  let lastError: unknown = null;

  for (const candidate of candidates) {
    const effective = strictLimits(candidate.site, candidate.model);
    const tries = 1 + Math.max(0, effective.retry);

    for (let round = 0; round < tries; round += 1) {
      attempts += 1;
      // 每一轮都要有自己的「已释放」标记：重试时名额必须真的还回去
      let released = false;
      const key = pickSiteKey(candidate.site);
      if (!key) {
        lastError = new SetupError(
          'image',
          `「${candidate.site.name}」没有可用的 Key。去站点的「配置」里加一个，或者把停用的打开。`,
        );
        break;
      }

      const release = await acquire(candidate.site, candidate.model);
      const free = (): void => {
        if (released) return;
        released = true;
        release();
      };
      const started = Date.now();

      try {
        const result = await rawGenerateImage(prompt, {
          baseUrl: candidate.site.url,
          apiKey: key.value,
          model: candidate.model.id,
          temperature: 0,
          ...(request.size ? { size: request.size } : {}),
        });

        free();
        await noteKeyResult(candidate.site, key.id, true);
        await writeLog({
          siteId: candidate.site.id,
          modelId: candidate.model.id,
          kind: 'image',
          scope: { appId: context.appId ?? '', roleId: context.roleId ?? '' },
          inputTokens: null,
          outputTokens: null,
          durationMs: Date.now() - started,
          status: 'success',
          errorMessage: '',
          ...(candidate.isFallback && lastError instanceof ApiError
            ? { switchedFrom: candidates[0]?.model.id }
            : {}),
        });

        return {
          url: result.url,
          prompt,
          rewritten,
          attempts,
          usedFallback: candidate.isFallback,
        };
      } catch (error) {
        free();
        lastError = error;

        if (isKeyFault(error)) await noteKeyResult(candidate.site, key.id, false);

        const retryable =
          error instanceof ApiError &&
          (error.info.kind === 'network' ||
            error.info.kind === 'server' ||
            error.info.kind === 'rate' ||
            error.info.kind === 'offline' ||
            error.info.kind === 'cors' ||
            error.info.kind === 'unknown');

        if (!retryable) break;
        if (round + 1 < tries) await sleep(400 * (round + 1));
      }
    }
  }

  const error = lastError instanceof SetupError ? lastError : toApiError(lastError);
  await writeLog({
    siteId: profile.site.id,
    modelId: profile.model.id,
    kind: 'image',
    scope: { appId: context.appId ?? '', roleId: context.roleId ?? '' },
    inputTokens: null,
    outputTokens: null,
    durationMs: 0,
    status: 'error',
    errorMessage: error instanceof ApiError ? error.info.detail : error.message,
  });
  throw error;
}

/* ==========================================================================
   7. 语音（设计文档 §12 入口；第一版先跑通 OpenAI 兼容的 /audio/speech）

   返回 Blob，界面自己转 object URL 播放。
   不做重试循环（语音通常单次就够），失败原样抛。
   ========================================================================== */

export interface SpeechRequest {
  text: string;
  /** 音色名。各站点叫法不一样，透传 */
  voice?: string;
}

export async function callSpeech(
  request: SpeechRequest,
  context: CallContext = {},
): Promise<Blob> {
  const profile = await getProfile('tts', context);
  const key = pickSiteKey(profile.site);
  if (!key) {
    throw new SetupError('tts', `「${profile.site.name}」没有可用的 Key。`);
  }

  const release = await acquire(profile.site, profile.model);
  const started = Date.now();
  let released = false;
  const free = (): void => {
    if (released) return;
    released = true;
    release();
  };

  try {
    const blob = await rawSpeech(request.text, {
      baseUrl: profile.site.url,
      apiKey: key.value,
      model: profile.model.id,
      temperature: 0,
      ...(request.voice ? { voice: request.voice } : {}),
    });

    free();
    await noteKeyResult(profile.site, key.id, true);
    await writeLog({
      siteId: profile.site.id,
      modelId: profile.model.id,
      kind: 'tts',
      scope: { appId: context.appId ?? '', roleId: context.roleId ?? '' },
      inputTokens: null,
      outputTokens: null,
      durationMs: Date.now() - started,
      status: 'success',
      errorMessage: '',
    });
    return blob;
  } catch (error) {
    free();
    if (isKeyFault(error)) await noteKeyResult(profile.site, key.id, false);

    const finalError = toApiError(error);
    await writeLog({
      siteId: profile.site.id,
      modelId: profile.model.id,
      kind: 'tts',
      scope: { appId: context.appId ?? '', roleId: context.roleId ?? '' },
      inputTokens: null,
      outputTokens: null,
      durationMs: Date.now() - started,
      status: 'error',
      errorMessage: finalError.info.detail || finalError.message,
    });
    throw finalError;
  }
}
