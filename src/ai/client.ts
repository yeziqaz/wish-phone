/**
 * AI 客户端 —— 全项目唯一能发 HTTP 的地方。
 *
 * ⚠️ AGENTS.md §2 铁律：任何在别处冒出来的 fetch( 都是违规。
 *    将来加代理、兼容模式、Keystore，只改这一个文件。
 *
 * 第一版的策略：
 *   - 用浏览器原生 fetch（保留 AbortController 和超时）
 *   - 非流式：一次请求拿完整结果，前端做打字机回放
 *   - credentials: 'omit' —— 不带 cookie，不暴露来源
 *   - Key 只放 Authorization 头，不进 URL、不进 body、不进日志
 *
 * 流式（SSE）在 v1 里不做。原因见 docs/research/技术调研报告.md：
 *   Capacitor WebView 的 fetch 仍然受 CORS 限制；
 *   只有 CapacitorHttp 能绕 CORS，但那会丢掉流式、AbortController 和超时。
 *   所以流式留到有方案时再做，v1 是「非流式 + 本地打字机」。
 */
import type { ApiConfig, ChatMessage, CompletionResult, ModelInfo } from './types';
import { ApiError, classify, describeResponse, describeFailure, toApiError } from './errors';

/** 超时毫秒。聊天可能比较慢，给 60 秒 */
const TIMEOUT_MS = 60_000;

/**
 * 把用户填的地址整理成规范的 base URL。
 *
 * 容错规则（任务单 T4 要求）：
 *   - 去掉首尾空格
 *   - 去掉结尾的斜杠
 *   - 如果没有 /v1 结尾，不自动加 —— 有些接口本身就不带 /v1
 *     （但 chat/completions 的路径要拼对，见下面 buildUrl）
 */
export function normalizeBaseUrl(input: string): string {
  const base = input.trim().replace(/\/+$/, '');
  // 允许粘贴完整的常见 OpenAI 接口地址；不猜 /v1，也不改域名。
  return base.replace(/\/(?:chat\/completions|models|images\/generations|audio\/speech)$/i, '');
}

/**
 * 拼出最终请求地址。
 * 规则：如果 base 已经以 /v1 结尾，直接拼 /chat/completions；
 *       否则也直接拼 —— 不猜测，用户填什么就是什么。
 *       这样「带 /v1」和「不带 /v1」都能用，只要用户填对了。
 */
function buildUrl(base: string, path: string): string {
  const b = normalizeBaseUrl(base);
  // base 可能是 'https://api.example.com/v1' 或 'https://api.example.com'
  // path 是 '/chat/completions' 或 '/models'
  // 直接拼接，中间保证有且仅有一个斜杠
  const sep = b.endsWith('/') || path.startsWith('/') ? '' : '/';
  return b + sep + path;
}

/** 安全地拼 Authorization 头。Key 不进任何其他地方 */
function authHeader(key: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** 通用请求：带超时、带错误分类。成功返回 Response，失败抛 ApiError */
async function request(
  url: string,
  config: ApiConfig,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = {
    ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...authHeader(config.apiKey.trim()),
    ...(init.headers as Record<string, string> | undefined),
  };

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      credentials: 'omit',
      signal: controller.signal,
    });

    // 响应体只能读一次：错误检查读副本，原件留给调用方 .json()
    const error = await describeResponse(response.clone());
    if (error) throw error;
    return response;
  } catch (error) {
    // 已经是分类好的 ApiError，直接抛
    if (error instanceof ApiError) throw error;

    // AbortError = 超时
    if (error instanceof Error && error.name === 'AbortError') {
      throw classify('network', {
        raw: '请求超时（60 秒内没有收到响应）',
        detail: '等了 60 秒接口还没有回应。',
        hint: '可能是网络太慢，或者接口本身响应就慢。可以稍后再试。',
      });
    }

    // 其他 fetch 失败（TypeError 等）= 跨域或连不上
    throw await describeFailure(error);
  } finally {
    clearTimeout(timeout);
  }
}

/** 拉取可用模型列表。用来帮用户省去手打模型名 */
export async function listModels(config: ApiConfig): Promise<ModelInfo[]> {
  const url = buildUrl(config.baseUrl, '/models');
  const response = await request(url, config, { method: 'GET' });

  const data: unknown = await response.json();
  const envelope = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const list = Array.isArray(data) ? data : envelope.data ?? envelope.models;
  if (!Array.isArray(list)) {
    throw classify('server', {
      detail: '接口响应里没有可识别的模型列表。',
      hint: '可手动填写模型名；部分站点支持聊天，但不提供模型列表。',
    });
  }
  const models = new Map<string, ModelInfo>();
  for (const value of list) {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const rawId = typeof value === 'string' ? value : item.id ?? item.name ?? item.model;
    if (typeof rawId !== 'string' || !rawId.trim()) continue;
    const id = rawId.trim();
    const ctx = [item.context_length, item.context_window, item.max_context_length, item.max_model_len]
      .find((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    models.set(id, ctx ? { id, contextLength: ctx } : { id });
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 发一次对话请求。
 *
 * @param messages 完整的对话历史（含 system prompt）
 * @param config 运行时配置
 * @returns 完整结果（文本 + 用量 + finish_reason）
 */
export async function chat(
  messages: ChatMessage[],
  config: ApiConfig,
): Promise<CompletionResult> {
  const url = buildUrl(config.baseUrl, config.path || '/chat/completions');

  const body = {
    model: config.model,
    messages,
    temperature: config.temperature,
    stream: false,
  };

  const response = await request(url, config, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
      finish_reason?: string;
    }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter((part) => part && (part.type === 'text' || part.type === 'output_text' || !part.type))
      .map((part) => typeof part.text === 'string' ? part.text : '').join('')
    : '';
  if (!text) {
    throw classify('server', {
      raw: JSON.stringify(data).slice(0, 1200),
      detail: '接口返回了成功状态，但消息体里没有内容。',
      hint: '可能是接口返回格式和标准 OpenAI 格式不同。展开原始错误看看。',
    });
  }

  return {
    text,
    model: data.model ?? config.model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
    finishReason: choice?.finish_reason ?? null,
  };
}

/**
 * 测试连接：发一个最小请求，看通不通。
 *
 * 用 /models 接口（GET，不需要消耗额度）。
 * 有些服务不支持 /models，那退而用一条最小 chat 请求。
 */
export async function testConnection(config: ApiConfig): Promise<{
  ok: true;
  models: ModelInfo[];
}> {
  try {
    const models = await listModels(config);
    return { ok: true, models };
  } catch (error) {
    // /models 不支持？用一条最小 chat 试试
    if (error instanceof ApiError && (error.info.kind === 'notFound' || error.info.kind === 'server')) {
      await chat(
        [{ role: 'user', content: 'Hi' }],
        { ...config, temperature: 0 },
      );
      return { ok: true, models: [{ id: config.model }] };
    }
    throw toApiError(error);
  }
}

/* ==========================================================================
   静默 GET（给余额查询用）
   --------------------------------------------------------------------------
   为什么要单独一个函数：
     request() 会把失败翻译成准备给用户看的 ApiError，
     而余额查询要的恰恰是「查不到就安静地算了」，不是报错。

   但它仍然必须住在 client.ts —— AGENTS §2：全项目只有这里能发 HTTP。
   Key 依然只走 Authorization 头，不出现在 URL、body、日志里。
   ========================================================================== */

export async function silentJsonGet(
  url: string,
  options: { apiKey?: string; timeoutMs?: number } = {},
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const text = await response.text();
    if (!text) return null;
    // 返回的是网页（填错地址、被防护页挡）就当没有，不报错
    if (/^\s*</.test(text.slice(0, 100))) return null;

    const data: unknown = JSON.parse(text);
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ==========================================================================
   生图（设计文档 §9.2）
   --------------------------------------------------------------------------
   OpenAI 兼容的生图接口是 POST /images/generations，
   返回 { data: [{ url }] } 或 { data: [{ b64_json }] }。

   两种都要吃下：
     · 给了 url → 直接把地址交给界面显示
     · 给了 b64   → 拼成 data URL，省一次下载
   ========================================================================== */

export interface ImageResult {
  /** data URL 或远程 http 地址，直接塞进 <img src> */
  url: string;
  /** 改写后的提示词（如果开了改写）会在上层填 */
}

export async function generateImage(
  prompt: string,
  config: ApiConfig & { size?: string },
): Promise<ImageResult> {
  const url = buildUrl(config.baseUrl, '/images/generations');

  const response = await request(url, config, {
    method: 'POST',
    body: JSON.stringify({
      model: config.model,
      prompt,
      n: 1,
      ...(config.size ? { size: config.size } : {}),
    }),
  });

  const data = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };

  const first = data.data?.[0];
  if (!first) {
    throw classify('server', {
      raw: JSON.stringify(data).slice(0, 1200),
      detail: '接口说成功了，但一张图都没返回。',
      hint: '可能是这个模型不支持这个接口，或者提示词被安全策略拦了。',
    });
  }

  if (first.b64_json) return { url: `data:image/png;base64,${first.b64_json}` };
  if (first.url) return { url: first.url };

  throw classify('server', {
    raw: JSON.stringify(first).slice(0, 800),
    detail: '接口返回的图片里既没有地址也没有内容。',
    hint: '换个模型试试，或者展开原始错误看看它到底返回了什么。',
  });
}

/* ==========================================================================
   语音合成（设计文档 §9.2）
   --------------------------------------------------------------------------
   POST /audio/speech 返回的是**二进制音频**，不是 JSON。
   这里给回 Blob，界面自己做 object URL 播放。
   ========================================================================== */

export async function synthesizeSpeech(
  text: string,
  config: ApiConfig & { voice?: string; format?: string },
): Promise<Blob> {
  const url = buildUrl(config.baseUrl, '/audio/speech');

  const response = await request(url, config, {
    method: 'POST',
    body: JSON.stringify({
      model: config.model,
      input: text,
      voice: config.voice || 'alloy',
      response_format: config.format || 'mp3',
    }),
  });

  return response.blob();
}
