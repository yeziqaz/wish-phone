/**
 * AI 层的数据形状。
 *
 * 这一层**不碰 DOM，也不碰 IndexedDB** —— 配置怎么存由调用方（设置页）决定，
 * client 只管「怎么发请求」。这样 client 能在 Node 里直接跑测试。
 */

/** 运行时配置。apiKey 只在内存里，不参与持久化 */
export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

/** 存进 settings 表的那部分：不含密钥 */
export interface ApiConfigSaved {
  baseUrl: string;
  model: string;
  temperature: number;
  rememberKey: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 服务端返回的 finish_reason，排查「为什么截断」时有用 */
  finishReason: string | null;
}

export interface ModelInfo {
  id: string;
  /** 有些服务会带，有些不带 */
  label?: string;
  /** 上下文长度。只有部分服务在 /models 里返回 */
  contextLength?: number;
}
