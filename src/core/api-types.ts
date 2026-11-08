import type { ApiProtocol } from './types';

/* ==========================================================================
   API 与模型 · 数据模型
   依据：docs/API与模型模块设计文档-v1.1.md §11

   四个概念，和文档用词一一对应，不许再起别名：
     站点 Site        一个 API 来源（URL + Key）。**站点不分能力**
     模型 SiteModel   站点下能调用的模型，能力是**多标签**
     分配 Assignment  全局 / App / 角色 三层，决定「某能力用哪个站点的哪个模型」
     日志 RequestLog  每次对外请求一条，用量页和站点日志都读它

   ⚠️ 这里和老的 `Provider` / `ModelKind` 是两套东西。
   老的按「一个站子就是一个模块」设计（见 types.ts §Provider），
   文档把它推倒了；迁移期间两边并存，等界面换完再删老的。
   ========================================================================== */

/** 六种能力（文档 §2）。别再叫 kind，那是模型上的标签 */
export type Capability = 'text' | 'image' | 'vision' | 'video' | 'tts' | 'embedding';

export const CAPABILITY_LABEL: Record<Capability, string> = {
  text: '文本',
  image: '生图',
  vision: '看图',
  video: '生视频',
  tts: '语音',
  embedding: '向量',
};

/** 顺序就是界面上筛选按钮的顺序 */
export const CAPABILITIES: Capability[] = ['text', 'image', 'vision', 'video', 'tts', 'embedding'];

/** 厂商系列。只用来筛选，不影响调用 */
export type Series =
  | 'claude'
  | 'gemini'
  | 'deepseek'
  | 'grok'
  | 'glm'
  | 'kimi'
  | 'minimax'
  | 'doubao'
  | 'agents'
  | 'gpt'
  | 'qwen'
  | 'other';

export const SERIES_LABEL: Record<Series, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  grok: 'Grok',
  glm: 'GLM',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  doubao: '豆包',
  agents: 'Agents',
  gpt: 'GPT',
  qwen: 'Qwen',
  other: '未分类',
};

/** 分类的固定顺序（用户指定：Claude, Gemini, DeepSeek, Grok, GLM, Kimi, Qwen, 其他） */
export const SERIES_ORDER: Series[] = [
  'claude',
  'gemini',
  'deepseek',
  'grok',
  'glm',
  'kimi',
  'minimax',
  'doubao',
  'agents',
  'gpt',
  'qwen',
  'other',
];

/** 站点类型。只影响标签和推断出来的默认协议 */
export type SiteType = 'official' | 'relay' | 'aggregator';

export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  official: '官方直连',
  relay: '中转站',
  aggregator: '聚合平台',
};

export interface SiteKey {
  id: string;
  value: string;
  /** 备注名，如「主号」「小号」 */
  label: string;
  enabled: boolean;
  /** 连续失败被自动摘掉，界面上打红点 */
  abnormal: boolean;
}

/** 站点级限制。模型级只存用户改过的那几项 */
export interface SiteLimits {
  /** 同时最多几个请求在进行，0 = 不限 */
  concurrent: number;
  /** 每分钟最多几次请求，0 = 不限 */
  rpm: number;
  /** 超限时：排队等 / 直接报错 */
  overflow: 'queue' | 'error';
  /** 单次请求最长等待秒数 */
  timeout: number;
  /** 失败后自动重试几次 */
  retry: number;
}

export const DEFAULT_LIMITS: SiteLimits = {
  concurrent: 3,
  rpm: 60,
  overflow: 'queue',
  timeout: 120,
  retry: 1,
};

export interface SiteModel {
  /** 接口返回的模型 ID，发请求时用它 */
  id: string;
  /** 显示名，默认同 id */
  name: string;
  /** 能力是多标签：一个模型可以既能文本又能看图 */
  kinds: Capability[];
  series: Series;
  enabled: boolean;
  /** 主模型标记（星标） */
  isPrimary: boolean;
  /** 用户手改过的项。重新拉取模型时**不许**被覆盖 */
  manualEdited: { kinds: boolean; series: boolean };
  /** null = 全部跟随站点 */
  limits: Partial<SiteLimits> | null;
  /** 上下文长度，接口不返回就是 null */
  contextLength: number | null;
}

export interface SiteLink {
  name: string;
  url: string;
}

export interface SiteBalance {
  value: number;
  unit: string;
  updatedAt: number;
}

export interface SiteTest {
  ok: boolean;
  at: number;
  message: string;
}

export interface Site {
  id: string;
  name: string;
  siteType: SiteType;
  protocol: ApiProtocol;
  url: string;
  keys: SiteKey[];
  /** 轮询用哪个 Key / 固定用哪个 Key */
  keyMode: 'roundrobin' | 'fixed';
  fixedKeyId: string;
  limits: SiteLimits;
  models: SiteModel[];
  links: SiteLink[];
  note: string;
  balance: SiteBalance | null;
  lastTest: SiteTest | null;
  createdAt: number;
  updatedAt: number;
}

/** 作用域：越具体优先级越高（角色 > App > 全局） */
export type Scope = 'global' | 'app' | 'role';

export interface Target {
  type: 'model';
  siteId: string;
  modelId: string;
}

/** 辅助模型：目前只有「生图/生视频的提示词改写」用得上 */
export interface AuxModel {
  mode: 'off' | 'followText' | 'custom';
  siteId: string;
  modelId: string;
}

export interface Assignment {
  /** 由 scope + scopeId + kind 拼出来，天然去重 */
  id: string;
  scope: Scope;
  /** 全局作用域时为 '' */
  scopeId: string;
  kind: Capability;
  target: Target | null;
  /** 主模型失败时自动切过去 */
  fallback: { siteId: string; modelId: string } | null;
  aux: AuxModel | null;
}

export interface RequestLog {
  id: string;
  time: number;
  siteId: string;
  modelId: string;
  kind: Capability;
  /** 谁发起的：App 和角色。全局调用两者都是 '' */
  scope: { appId: string; roleId: string };
  /** 站点不返回用量时是 null，界面显示「—」，**不许估算** */
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  status: 'success' | 'error';
  errorMessage: string;
  /**
   * 这条请求成功是因为切了备用模型才成的。
   * 值是失败的主模型 id，界面上显示「由 X 切换而来」。
   * 文档 §13：备用模型切换要在日志里看得到。
   */
  switchedFrom?: string;
}

/** Assignment 的 id 规则，读写两边都走它，免得各拼各的 */
export function assignmentId(scope: Scope, scopeId: string, kind: Capability): string {
  return `${scope}:${scopeId}:${kind}`;
}

/** 日志保留天数（文档 §8.3），超期自动清理 */
export const LOG_RETENTION_DAYS = 30;
