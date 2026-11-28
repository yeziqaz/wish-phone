/**
 * 错误分类：把浏览器和接口抛出来的各种东西，翻译成一句人话。
 *
 * 目标：用户在界面上**永远不该看到** "401 Unauthorized" 这种原文。
 *      原始报错放进折叠区，人话放在外面。
 */

export type ApiErrorKind =
  | 'offline' // 设备本身没网
  | 'cors' // 浏览器拦住了（跨域）
  | 'network' // 连不上这个地址
  | 'auth' // 密钥不对 / 没权限
  | 'quota' // 余额不足 / 额度用完
  | 'rate' // 限流
  | 'notFound' // 路径不对
  | 'tooLarge' // 请求太大
  | 'server' // 服务端 5xx 或返回了错误体
  | 'badInput' // 我们自己填错了
  | 'unknown';

export interface ApiErrorInfo {
  kind: ApiErrorKind;
  /** 短标题，适合当折叠区的标题 */
  title: string;
  /** 人话说明发生了什么 */
  detail: string;
  /** 下一步该怎么办 */
  hint: string;
  status?: number;
  /** 原始报错，只放进折叠区。绝不包含密钥。 */
  raw?: string;
}

/** 各分类的人话文案。集中在一处，改文案不用翻代码 */
const COPY: Record<ApiErrorKind, { title: string; detail: string; hint: string }> = {
  offline: {
    title: '设备没联网',
    detail: '这台手机（或浏览器）现在没有可用的网络连接。',
    hint: '先连上 Wi-Fi 或流量，再点测试连接。',
  },
  cors: {
    title: '浏览器无法读取接口响应（可能跨域）',
    detail: '浏览器未能读取接口响应，可能是站点未允许跨域访问，也可能是网络、证书或接口地址问题；仅凭这个报错无法确定。',
    hint: '若相同配置在原生客户端可用、网页不可用，请联系站点确认 CORS 支持。服务端需放行当前网页来源、OPTIONS 预检及 Authorization、Content-Type 请求头，并在实际响应中返回 Access-Control-Allow-Origin。前端无法解除服务端跨域限制。不要使用公共代理转发 Key。',
  },
  network: {
    title: '接口请求失败',
    detail: '浏览器未能完成接口请求。可能是网络、证书、接口地址或跨域访问限制；无法据此确认接口是否正常。',
    hint: '检查地址和网络。HTTPS 网页访问 HTTP 接口还可能被混合内容规则拦截，请使用站点提供的 HTTPS 地址；若相同配置在原生客户端可用而网页不可用，请联系站点确认 CORS 支持：放行当前网页来源、OPTIONS 预检及 Authorization、Content-Type 请求头，实际响应需带 Access-Control-Allow-Origin。前端无法解除服务端跨域限制，不要使用公共代理转发 Key。',
  },
  auth: {
    title: '密钥不对',
    detail: '接口认得这个地址，但不接受这个密钥。',
    hint:
      '检查一下 Key 有没有多打空格、少打字符，或者是不是已经过期。注意 Key 前后都不能有空格。',
  },
  quota: {
    title: '额度用完了',
    detail: '密钥有效，但账户里的余额或额度不够了。',
    hint: '去服务商的后台充值，或者换一个还有额度的账户。',
  },
  rate: {
    title: '请求太频繁',
    detail: '接口没问题、密钥也对，只是短时间内发得太多了。',
    hint: '等一会儿再试。如果是自己建的服务，可以调高它的限流上限。',
  },
  notFound: {
    title: '路径不对',
    detail: '服务端在等你给的这个地址上找不到接口。通常是 /v1 少了或多了。',
    hint: '试试在地址末尾加上或去掉 /v1，再看一次。',
  },
  tooLarge: {
    title: '请求太大',
    detail: '发过去的内容超出了接口允许的上限。',
    hint: '聊太久之后历史会很长。可以先新建一个会话重新开始。',
  },
  server: {
    title: '服务端出错了',
    detail: '接口那边自己出了问题，跟我们填的东西没关系。',
    hint: '稍等一会儿再试。如果一直这样，去服务商的公告页看看是不是在维护。',
  },
  badInput: {
    title: '填错了',
    detail: '有些必填的东西没填，或者格式不对。',
    hint: '接口地址和模型名都是必填的。',
  },
  unknown: {
    title: '出了点问题',
    detail: '没能判断出具体是哪种情况。',
    hint: '展开下面的「查看原始错误」，把内容发给开发者。',
  },
};

export class ApiError extends Error {
  readonly info: ApiErrorInfo;

  constructor(info: ApiErrorInfo) {
    super(info.title);
    this.name = 'ApiError';
    this.info = info;
  }
}

export function classify(
  kind: ApiErrorKind,
  options: { status?: number; raw?: string; detail?: string; hint?: string } = {},
): ApiError {
  const base = COPY[kind];
  return new ApiError({
    kind,
    title: base.title,
    detail: options.detail ?? base.detail,
    hint: options.hint ?? base.hint,
    status: options.status,
    raw: options.raw,
  });
}

/** 判断响应体里有没有「额度不够」的意思 —— 有些服务用 200 返回这个 */
const QUOTA_WORDS = ['insufficient_quota', 'quota_exceeded', 'billing_not_active', 'no_credit', '余额', '额度', '欠费', '欠费停机'];

function looksLikeQuota(text: string): boolean {
  const lower = text.toLowerCase();
  return QUOTA_WORDS.some((word) => lower.includes(word.toLowerCase()));
}

/**
 * 从响应体里抠出人类能看懂的错误说明。
 * 各家结构不统一：OpenAI 是 error.message，Anthropic 是 message，
 * 有些中转站直接返回 {"detail": "..."}。
 */
function pickMessage(data: Record<string, unknown>, fallback: string): string {
  const err = data.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === 'string' && m) return m;
  }
  for (const key of ['message', 'detail', 'error_message', 'msg']) {
    const v = data[key];
    if (typeof v === 'string' && v) return v;
  }
  return fallback;
}

/** 把响应体文本解析成对象；不是 JSON 就返回 null */
function parseBody(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 这一坨看起来是网页吗？
 *
 * 用途：地址有时会被填成服务商官网或首页，请求会**成功返回 200，但内容是一张 HTML 页面**。
 * 这时候直接 response.json()，浏览器会抛出
 *   Failed to execute 'json' on 'Response': Unexpected token '<', "<!DOCTYPE "...
 * 这句英文对用户没有任何意义，必须在进 json() 之前就拦下来。
 */
function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype\s+html|<html\b|<\?xml\b|<head\b|<body\b)/i.test(text.slice(0, 200));
}

/**
 * 把一个 HTTP 响应分类成人话错误。成功时返回 null。
 * 这一步是「测试连接」和「聊天」共用的核心。
 */
export async function describeResponse(response: Response): Promise<ApiError | null> {
  const text = await response.text().catch(() => '');
  const raw = `HTTP ${response.status} ${response.statusText}\n\n${text.slice(0, 1200)}`;

  if (response.ok) {
    // 有些服务状态码是 200，但 body 里写着错误
    const data = parseBody(text);

    // 200，但内容压根不是 JSON —— 光这一条就能解释绝大多数「地址填成了网站」
    if (!data) {
      const trimmed = text.trim();
      if (!trimmed) return null; // 空 body 交给调用方按「没有内容」处理
      if (looksLikeHtml(trimmed)) {
        return classify('notFound', {
          status: response.status,
          raw,
          detail: '这个地址回了一整页网页，不是接口数据。可能是地址填成了服务商首页，也可能是被防护页挡在了外面。',
          hint: '接口地址一般长这样：https://api.example.com/v1。检查一下是不是漏了 /v1、填成了官网；如果地址没错，换个网络再试。',
        });
      }
      return classify('server', {
        status: response.status,
        raw,
        detail: '接口回了 200，但内容不是 JSON，读不出来。',
        hint: '可能是这个接口的返回格式和 OpenAI 不一样。展开原始错误能看它到底回了什么。',
      });
    }

    if (data.error || data.detail || looksLikeQuota(text)) {
      return classify(looksLikeQuota(text) ? 'quota' : 'server', {
        raw,
        detail: `接口返回了错误：${pickMessage(data, '未知错误')}`,
      });
    }
    return null;
  }

  const data = parseBody(text);
  const message = data ? pickMessage(data, text.slice(0, 200)) : text.slice(0, 200);
  const quotaHit = looksLikeQuota(text);

  switch (response.status) {
    case 401:
    case 403:
      return classify('auth', { status: response.status, raw, detail: message || undefined });
    case 402:
      return classify('quota', { status: response.status, raw, detail: message || undefined });
    case 429:
      return classify('rate', { status: response.status, raw, detail: message || undefined });
    case 413:
      return classify('tooLarge', { status: response.status, raw, detail: message || undefined });
    case 404:
      return classify('notFound', { status: response.status, raw, detail: message || undefined });
    default:
      break;
  }

  if (response.status >= 500) {
    return classify('server', { status: response.status, raw, detail: message || undefined });
  }
  if (quotaHit) {
    return classify('quota', { status: response.status, raw, detail: message || undefined });
  }
  return classify('unknown', {
    status: response.status,
    raw,
    detail: message ? `接口返回：${message}` : undefined,
  });
}

/** 浏览器不暴露 CORS/TLS/DNS 的确切失败原因，不额外发 no-cors 探测。 */
export async function describeFailure(error: unknown): Promise<ApiError> {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return classify('offline', { raw });
  }
  return classify('network', { raw });
}
/**
 * 把任何抛出的东西统一成一个 ApiError（已经是 ApiError 就原样返回）。
 *
 * ⚠️ 兜底路径**不许**把 error.message 当正文显示 —— 浏览器抛的是英文
 *    （"Failed to execute 'json' on 'Response'..."），直接显示等于没翻译。
 *    英文原文塞进 raw，只出现在「查看原始错误」折叠区里。
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new ApiError({
    kind: 'unknown',
    title: COPY.unknown.title,
    detail: COPY.unknown.detail,
    hint: COPY.unknown.hint,
    raw,
  });
}
