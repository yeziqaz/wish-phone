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
    title: '被浏览器拦住了（跨域）',
    detail:
      '地址是通的，但浏览器不允许网页从这个地址读数据。这是浏览器的安全限制，不是接口坏了。',
    hint:
      '看看接口文档里有没有「允许跨域」的开关，或者换一个自带跨域支持的服务（DeepSeek、OpenRouter、硅基流动等都支持）。自建中转服务通常默认就放开了。',
  },
  network: {
    title: '连不上这个地址',
    detail: '地址根本没有回应。可能是域名写错、端口不对、地址不通，或者接口需要连特定网络。',
    hint:
      '确认地址有没有抄错（含 /v1 时通常需要，不含时一般不用）。如果是局域网里自建的服务，确认手机和电脑在同一个 Wi-Fi 下。',
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
 * 把一个 HTTP 响应分类成人话错误。成功时返回 null。
 * 这一步是「测试连接」和「聊天」共用的核心。
 */
export async function describeResponse(response: Response): Promise<ApiError | null> {
  const text = await response.text().catch(() => '');
  const raw = `HTTP ${response.status} ${response.statusText}\n\n${text.slice(0, 1200)}`;

  if (response.ok) {
    // 有些服务状态码是 200，但 body 里写着错误
    const data = parseBody(text);
    if (data && (data.error || data.detail || looksLikeQuota(text))) {
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

/**
 * 把 fetch 抛出来的东西分类。
 *
 * 这里有一个**真的能区分「跨域」和「连不上」**的做法：
 * 用一次 mode: 'no-cors' 的探测请求。
 *   - no-cors 的响应是 opaque（读不到内容），但它能告诉我们「服务器到底有没有回应」
 *   - 拿到响应 → 服务器活着，那之前的失败就是跨域
 *   - 抛错 → 根本没连上（域名、端口、网络、被墙）
 * 这样用户就能被告知准确的原因，而不是一句含糊的「连不上」。
 */
export async function describeFailure(
  error: unknown,
  options: { probeUrl?: string } = {},
): Promise<ApiError> {
  if (!navigator.onLine) {
    return classify('offline', {
      raw: error instanceof Error ? error.message : String(error),
    });
  }

  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  const reachable = await probeReachable(options.probeUrl);
  return reachable
    ? classify('cors', { raw })
    : classify('network', { raw });
}

/** 用 no-cors 探测某个地址能不能连上。失败一律当作「连不上」 */
async function probeReachable(url?: string): Promise<boolean> {
  if (!url) return true; // 探测不了就保守一点，交给上层给出含糊但诚实的说明
  try {
    await fetch(url, { mode: 'no-cors', credentials: 'omit', signal: AbortSignal.timeout(6000) });
    return true;
  } catch {
    return false;
  }
}

/** 把任何抛出的东西统一成一个 ApiError（已经是 ApiError 就原样返回） */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError({
    kind: 'unknown',
    title: COPY.unknown.title,
    detail: error instanceof Error ? error.message : String(error),
    hint: COPY.unknown.hint,
  });
}
