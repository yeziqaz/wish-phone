import { newId } from '../../core/db';
import type { ApiProtocol, ModelKind, Provider } from '../../core/types';
import type { ParsedProvider } from './smart-parse';

/**
 * providers 目录内的共用东西。
 * 同目录的文件之间可以互相引用（AGENTS.md 禁止的是**跨 feature 目录**互引）。
 */

export interface ProtocolDef {
  id: ApiProtocol;
  label: string;
  kinds: import('../../core/types').ModelKind[];
  /** 这个协议真的能用了没有。没适配的只能建站，不能拉模型。 */
  ready: boolean;
}

/**
 * 协议挂在模块下面：文本有 OpenAI/Gemini/Claude，生图有 OpenAI/NovelAI，
 * 语音有 ElevenLabs/MiniMax/FishAudio。没适配的如实标出来，不装能用。
 */
export const PROTOCOLS: ProtocolDef[] = [
  { id: 'openai', label: 'OpenAI 兼容', kinds: ['text', 'image', 'voice', 'video'], ready: true },
  { id: 'gemini', label: 'Gemini', kinds: ['text'], ready: false },
  { id: 'claude', label: 'Claude', kinds: ['text'], ready: false },
  { id: 'novelai', label: 'NovelAI', kinds: ['image'], ready: false },
  { id: 'elevenlabs', label: 'ElevenLabs', kinds: ['voice'], ready: false },
  { id: 'minimax', label: 'MiniMax', kinds: ['voice'], ready: false },
  { id: 'fishaudio', label: 'FishAudio', kinds: ['voice'], ready: false },
  { id: 'custom', label: '自定义协议', kinds: ['text', 'image', 'voice', 'video'], ready: true },
];

export function protocolsForKind(kind: ModelKind): ProtocolDef[] {
  return PROTOCOLS.filter((protocol) => protocol.kinds.includes(kind));
}

export const PROTOCOL_LABEL: Record<ApiProtocol, string> = Object.fromEntries(
  PROTOCOLS.map((protocol) => [protocol.id, protocol.label]),
) as Record<ApiProtocol, string>;

/**
 * 哪个协议是**真的能用**的。
 * gemini / claude 的原生格式是两套完全不同的请求与响应结构，
 * 排在后面的批次 —— 界面上要如实标出来，不能让用户填完才发现不通。
 */
export const PROTOCOL_READY: Record<ApiProtocol, boolean> = Object.fromEntries(
  PROTOCOLS.map((protocol) => [protocol.id, protocol.ready]),
) as Record<ApiProtocol, boolean>;

export const ALL_PROTOCOLS: ApiProtocol[] = PROTOCOLS.map((protocol) => protocol.id);

/** 一个空白的服务商 */
const DEFAULT_PATH: Record<ModelKind, string> = {
  text: '/chat/completions',
  image: '/images/generations',
  voice: '/audio/speech',
  video: '',
};

export function defaultApiPath(kind: ModelKind): string {
  return DEFAULT_PATH[kind];
}

export function blankProvider(name = '新服务商', kind: ModelKind = 'text'): Provider {
  const now = Date.now();
  return {
    id: newId(),
    name,
    protocol: 'openai',
    kind,
    baseUrl: '',
    apiPath: DEFAULT_PATH[kind],
    multiKey: false,
    keyMode: 'rotate',
    keys: [],
    models: [],
    generation: { temperature: 0.8, maxTokens: null, topP: null },
    advanced: {
      stream: false,
      rateLimit: { enabled: false, perMinute: 60 },
      breaker: { enabled: false, failCount: 5, cooldownSec: 60 },
    },
    vendor: '',
    group: '',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** 把「智能添加」解析出来的东西变成一份服务商草稿 */
export function fromParsed(parsed: ParsedProvider): Provider {
  const provider = blankProvider(parsed.name || '新服务商');
  provider.baseUrl = parsed.baseUrl;

  // 认出几个 Key 就带几个；超过一个就自动开多 Key 模式。
  // 名字用原文里写的那个（「key1:」「大号:」前面的字），没写就留空，交给界面补默认名
  provider.keys = parsed.apiKeys.map((item) => ({
    id: newId(),
    value: item.value,
    label: item.label,
    enabled: true,
    weight: 1,
    callCount: 0,
    failCount: 0,
  }));
  provider.multiKey = provider.keys.length > 1;

  // 模型不再自动带进来：拉取时在抽屉里挑，避免顺手塞一堆用不上的
  provider.models = [];

  return provider;
}

/**
 * 「智能添加」解析出来的结果，用内存传给编辑页。
 *
 * ⚠️ 绝不能走 URL 参数 —— 里面有 Key，进地址栏就等于泄露
 *    （宪法 §5：Key 不许放进 URL query）。
 */
let pending: ParsedProvider[] = [];

export function setPendingParse(value: ParsedProvider[]): void {
  pending = value;
}

/** 取一次就清掉，避免下次进编辑页又被塞一遍 */
export function takePendingParse(): ParsedProvider[] {
  const value = pending;
  pending = [];
  return value;
}

/**
 * 按模型 ID 猜它是干什么的。
 *
 * ⚠️ 这是猜，不是实测。很多站子的 /models 只给一串 ID，不给类型；
 *    猜错了用户可以在拉取抽屉里点标签改。
 */
export function guessModelKind(id: string): import('../../core/types').ModelKind {
  const s = id.toLowerCase();

  // 视频优先：有些视频模型名字里也带 image
  if (/sora|veo-|kling|runway|pika|hailuo|seedance|luma|(^|[-_])video|wan2\.|minimax-video/.test(s)) {
    return 'video';
  }
  // 语音：tts / 朗读 / 转写都先归到这里
  if (/tts|text-to-speech|speech|whisper|audio|voice|eleven|cosyvoice|sovits|fish|minimax.*speech/.test(s)) {
    return 'voice';
  }
  // 生图
  if (/dall-e|dalle|gpt-image|image-gen|imagegen|flux|stable-diffusion|sdxl|(^|[-_])sd[-_]?[0-9x]|stable|midjourney|(^|[-_])mj[-_]|seedream|kolors|wanx|imagen|ideogram|recraft|image/.test(s)) {
    return 'image';
  }
  return 'text';
}
