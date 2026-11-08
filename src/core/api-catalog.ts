import type { ApiProtocol } from './types';
import type { Capability, Series, SiteType } from './api-types';

/* ==========================================================================
   模型 / 站点的「猜」规则
   依据：docs/API与模型模块设计文档-v1.1.md §5.2、§6.3

   全部是纯函数：输入字符串，输出结论。界面只管把结论画出来，
   用户改过的一律以用户的为准（见 SiteModel.manualEdited）。
   ========================================================================== */

/* ---------------------------- 系列 ---------------------------- */

const SERIES_TABLE: { keywords: string[]; series: Series }[] = [
  { keywords: ['claude'], series: 'claude' },
  { keywords: ['gemini', 'gemma'], series: 'gemini' },
  { keywords: ['deepseek'], series: 'deepseek' },
  { keywords: ['grok'], series: 'grok' },
  { keywords: ['glm'], series: 'glm' },
  { keywords: ['kimi'], series: 'kimi' },
  { keywords: ['minimax', 'abab'], series: 'minimax' },
  { keywords: ['doubao', 'seed'], series: 'doubao' },
  { keywords: ['agents', 'agens', 'agent'], series: 'agents' },
  { keywords: ['gpt', 'chatgpt', 'o1', 'o3', 'o4'], series: 'gpt' },
  { keywords: ['qwen', 'qwq'], series: 'qwen' },
];

/** 按模型名猜系列。都不中就「未分类」。以后新增系列只加一行表 */
export function inferSeries(modelId: string): Series {
  const name = modelId.toLowerCase();
  for (const row of SERIES_TABLE) {
    if (row.keywords.some((keyword) => name.includes(keyword))) return row.series;
  }
  return 'other';
}

/* ---------------------------- 能力 ---------------------------- */

/**
 * 顺序有讲究：越具体的排越前。
 * 比如 `text-embedding-3` 必须落到「向量」而不是「文本」，
 * `gpt-4o` 必须落到「文本+看图」而不是先被 `gpt` 吃掉。
 */
const CAPABILITY_TABLE: { keywords: string[]; kinds: Capability[] }[] = [
  { keywords: ['embedding', 'embed'], kinds: ['embedding'] },
  { keywords: ['tts', 'speech', 'voice', 'audio'], kinds: ['tts'] },
  {
    keywords: ['dall-e', 'dalle', 'flux', 'nai', 'image', 'sd', 'sdxl', 'stable-diffusion'],
    kinds: ['image'],
  },
  { keywords: ['video', 'kling', 'veo', 'sora'], kinds: ['video'] },
  {
    // claude-3 之后全系都能看图，所以 sonnet / opus / haiku 也一起算进来
    keywords: [
      'vision',
      'vl',
      '-4o',
      '4o-',
      'gemini',
      'claude-3',
      'claude-4',
      'claude-sonnet',
      'claude-opus',
      'claude-haiku',
    ],
    kinds: ['text', 'vision'],
  },
];

/** 按模型名猜能力，可多标签。都不中就按「文本」——绝大多数模型都能聊天 */
export function inferKinds(modelId: string): Capability[] {
  const name = `-${modelId.toLowerCase()}-`;
  for (const row of CAPABILITY_TABLE) {
    if (row.keywords.some((keyword) => name.includes(keyword))) return [...row.kinds];
  }
  return ['text'];
}

/* ---------------------------- 站点 ---------------------------- */

/** 一眼能看出是官方的域名。判断不出来的一律当中转站，用户可以改 */
const OFFICIAL_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
  'dashscope.aliyuncs.com',
  'open.bigmodel.cn',
  'api.moonshot.cn',
];

/** 聚合平台：一个 Key 通吃多家模型，余额接口也各家不同 */
const AGGREGATOR_HOSTS = ['openrouter.ai', 'api.siliconflow.cn', 'api.siliconflow.com'];

/** 特殊协议的官方站。命中就顺带把协议也定了 */
const PROTOCOL_HOSTS: { keyword: string; protocol: ApiProtocol; siteType: SiteType }[] = [
  { keyword: 'novelai', protocol: 'novelai', siteType: 'official' },
  { keyword: 'elevenlabs', protocol: 'elevenlabs', siteType: 'official' },
  { keyword: 'minimax', protocol: 'minimax', siteType: 'official' },
  { keyword: 'fish', protocol: 'fishaudio', siteType: 'official' },
];

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]?.toLowerCase() ?? '';
}

/** 猜协议。只有这几家是已知的非 OpenAI 格式，其余都按 OpenAI 兼容处理 */
export function inferProtocol(url: string): ApiProtocol {
  const host = hostOf(url);
  const hit = PROTOCOL_HOSTS.find((row) => host.includes(row.keyword));
  return hit ? hit.protocol : 'openai';
}

/** 猜站点类型：官方直连 / 中转站 / 聚合平台 */
export function inferSiteType(url: string): SiteType {
  const host = hostOf(url);
  const special = PROTOCOL_HOSTS.find((row) => host.includes(row.keyword));
  if (special) return special.siteType;
  if (OFFICIAL_HOSTS.some((item) => host === item)) return 'official';
  if (AGGREGATOR_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))) return 'aggregator';
  return 'relay';
}

/** 找不到名字时拿域名顶一下，如 `api.deepseek.com` → `deepseek` */
export function nameFromUrl(url: string): string {
  const host = hostOf(url).replace(/^www\./, '');
  const parts = host.split('.').filter((part) => part && part !== 'api' && part !== 'com' && part !== 'cn');
  return parts[0] || host || '未命名站点';
}

/* ---------------------------- URL 规范化 ---------------------------- */

export interface NormalizedUrl {
  url: string;
  /** 自动改过什么，确认卡上要告诉用户（空串 = 没动） */
  note: string;
}

/**
 * OpenAI 兼容站的地址统一成「到 /v1 为止」：
 * 末尾多余的 `/`、`/chat/completions` 去掉，没有版本号的补 `/v1`。
 * 别的协议格式各不相同，只做去尾斜杠。
 */
export function normalizeBaseUrl(raw: string, protocol: ApiProtocol): NormalizedUrl {
  const url = raw.trim().replace(/\/+$/, '');
  if (protocol !== 'openai') return { url, note: '' };

  const notes: string[] = [];
  let next = url;

  if (/\/chat\/completions$/i.test(next)) {
    next = next.replace(/\/chat\/completions$/i, '');
    notes.push('已去掉末尾的 /chat/completions');
  }
  if (!/\/v\d+$/i.test(next)) {
    next = `${next}/v1`;
    notes.push('已自动补全 /v1');
  } else if (next !== url) {
    notes.push('已去掉末尾多余的 /');
  }

  return { url: next, note: notes.join('；') };
}

/* ---------------------------- 小类 ---------------------------- */

/**
 * 归一化为一个可读的细分类名称。
 * 同一档位的版本、日期、latest 等后缀必须归到同一组：
 * `claude-opus-4-5`、`claude-opus-4-6` → `opus`
 * `gpt-4o-mini` → `4o-mini`
 * `gemini-2.5-pro` → `2.5-pro`
 *
 * 这是展示分组，不改变模型 ID，也不参与请求。
 */
export function inferSubSeries(modelId: string): string {
  const name = modelId.toLowerCase().trim();
  const row = SERIES_TABLE.find((item) => item.keywords.some((keyword) => name.includes(keyword)));

  let rest = name;
  if (row) {
    for (const keyword of row.keywords) rest = rest.split(keyword).join('');
  } else {
    rest = rest.replace(/^(openai|anthropic|google|meta|xai|mistral)[\s/_-]*/i, '');
  }

  rest = rest
    .replace(/[-_\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-\d{8}/g, '')
    .replace(/-(latest|preview|chat|instruct|turbo)$/g, '')
    .replace(/^(\d+(?:[.-]\d+)?)-?(opus|sonnet|haiku)$/i, '$2-$1');

  if (row?.series === 'claude') {
    if (/(^|-)opus(?:-|$)/.test(rest)) return 'opus';
    if (/(^|-)sonnet(?:-|$)/.test(rest)) return 'sonnet';
    if (/(^|-)haiku(?:-|$)/.test(rest)) return 'haiku';
  }

  return rest;
}

/** 小类显示名 */
export function subSeriesLabel(sub: string): string {
  if (sub === '') return '本系其他';
  return sub.charAt(0).toUpperCase() + sub.slice(1);
}
