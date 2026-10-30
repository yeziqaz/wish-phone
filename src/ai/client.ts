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
  return input.trim().replace(/\/+$/, '');
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
    'Content-Type': 'application/json',
    ...authHeader(config.apiKey),
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
    throw await describeFailure(error, { probeUrl: url });
  } finally {
    clearTimeout(timeout);
  }
}

/** 拉取可用模型列表。用来帮用户省去手打模型名 */
export async function listModels(config: ApiConfig): Promise<ModelInfo[]> {
  const url = buildUrl(config.baseUrl, '/models');
  const response = await request(url, config, { method: 'GET' });

  type RawModel = { id: string } & Record<string, unknown>;
  const data = (await response.json()) as { data?: RawModel[]; models?: RawModel[] };
  // OpenAI 格式是 { data: [{id}] }，有些服务返回 { models: [{id}] }
  const list = data.data ?? data.models ?? [];
  return list
    .map((m) => {
      // 上下文长度没有统一字段名，常见的几种都试一下；都没有就不填
      const ctx = [m.context_length, m.context_window, m.max_context_length, m.max_model_len].find(
        (v): v is number => typeof v === 'number' && v > 0,
      );
      return ctx ? { id: m.id, contextLength: ctx } : { id: m.id };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
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
  const url = buildUrl(config.baseUrl, '/chat/completions');

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
      message?: { content?: string };
      finish_reason?: string;
    }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const choice = data.choices?.[0];
  if (!choice?.message?.content) {
    throw classify('server', {
      raw: JSON.stringify(data).slice(0, 1200),
      detail: '接口返回了成功状态，但消息体里没有内容。',
      hint: '可能是接口返回格式和标准 OpenAI 格式不同。展开原始错误看看。',
    });
  }

  return {
    text: choice.message.content,
    model: data.model ?? config.model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
    finishReason: choice.finish_reason ?? null,
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
