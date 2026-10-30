/**
 * 智能粘贴：从一段杂乱文本里，认出站子的名称、地址、Key 和模型。
 *
 * ⚠️ 全程在本地解析 —— 粘进来的内容（里面很可能有 Key）
 *    一个字都不会发出去。这正是不做成「AI 帮你识别」的原因：
 *    为了认一个地址就把用户的 Key 送到别处，代价太大。
 *    这里用的是确定性的规则，快、免费、离线可用。
 */

export interface ParsedProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** 解析结果的说明，给用户看我们认出了什么 */
  notes: string[];
}

const URL_RE = /https?:\/\/[^\s"'<>`,;)\]]+/gi;

/** 已知模型名的前缀。用来从文本里捞出模型列表 */
const MODEL_RE =
  /\b(gpt-[a-z0-9._-]+|chatgpt-[a-z0-9._-]+|o[134]-[a-z0-9._-]+|claude-[a-z0-9._-]+|deepseek-[a-z0-9._-]+|qwen[a-z0-9._-]*|qwq[a-z0-9._-]*|gemini-[a-z0-9._-]+|glm-[a-z0-9._-]+|moonshot-[a-z0-9._-]+|kimi-[a-z0-9._-]+|llama-[a-z0-9._-]+|mistral-[a-z0-9._-]+|yi-[a-z0-9._-]+|doubao-[a-z0-9._-]+|ernie-[a-z0-9._-]+|grok-[a-z0-9._-]+)\b/gi;

/** 从一堆 URL 里挑最像接口端点的那个 */
function pickUrl(text: string): string {
  const urls = text.match(URL_RE) ?? [];
  if (urls.length === 0) return '';

  const scored = urls.map((url) => {
    let score = 0;
    if (/\/v1\b/.test(url)) score += 4;
    if (/\bapi\b/i.test(url)) score += 2;
    if (/chat|completions/i.test(url)) score += 1;
    // 官网、文档、控制台这些肯定不是接口地址
    if (/\/(docs|login|register|dashboard|pricing|about|blog)\b/i.test(url)) score -= 5;
    return { url, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return (scored[0]?.url ?? '').replace(/[.,;]+$/, '');
}

/** 找密钥：先看有没有明确标注，再看特征前缀，最后看孤立长串 */
function pickKey(text: string): string {
  const labelled = text.match(
    /(?:api[\s_-]?key|secret|token|密钥|key)\s*[:：=]\s*["']?([A-Za-z0-9_\-.]{12,})/i,
  );
  if (labelled?.[1]) return labelled[1];

  const prefixed = text.match(/\bsk-[A-Za-z0-9_-]{8,}\b/);
  if (prefixed?.[0]) return prefixed[0];

  const long = (text.match(/\b[A-Za-z0-9_-]{32,}\b/g) ?? []).filter(
    // 排除纯粹是 URL 的一部分或全是数字的
    (s) => !/^\d+$/.test(s),
  );
  return long[0] ?? '';
}

/**
 * 这些子域名段没有辨识度，不能拿来当站名。
 * api.xx.com 应该叫「xx」而不是「api」。
 */
const GENERIC_HOST_PARTS = new Set([
  'api',
  'apis',
  'www',
  'openai',
  'ai',
  'chat',
  'gpt',
  'llm',
  'proxy',
  'relay',
  'gateway',
  'gw',
  'service',
  'server',
  'bot',
  'v1',
  'v2',
  // 顶级域名也不是名字
  'com',
  'net',
  'org',
  'io',
  'cn',
  'dev',
  'app',
  'co',
  'me',
  'xyz',
  'top',
  'cc',
  'info',
  'site',
]);

/** 从域名里挑一个像名字的段。挑不出来就返回空，让用户自己填 */
function nameFromHost(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    const meaningful = parts.find((part) => !GENERIC_HOST_PARTS.has(part.toLowerCase()));
    return meaningful ?? '';
  } catch {
    return '';
  }
}

/** 猜名字：明确标注 > 从域名里挑一个像的 */
function pickName(text: string, baseUrl: string): string {
  const labelled = text.match(/(?:名称|站名|站点|站子|名字|服务商|平台|name)\s*[:：=]\s*(.+)/i);
  if (labelled?.[1]) {
    const value = labelled[1].trim();
    // 别把一整行别的信息也吞进来
    if (value.length > 0 && value.length <= 30) return value;
  }

  // 中文名优先于从域名推出来的英文
  return chineseLine(text) || (baseUrl ? nameFromHost(baseUrl) : '');
}

/**
 * 没有「站名：」这类标注时，找一行短的中文当名字，
 * 例如第一行写着「XX 中转站」。带地址、Key、模型的行跳过。
 */
function chineseLine(text: string): string {
  for (const rawLine of text.split(/\r?\n/)) {
    const lineText = rawLine
      .trim()
      .replace(/^(欢迎使用|欢迎来到|欢迎)\s*/, '')
      .replace(/[!！。,，:：]+$/, '')
      .trim();
    if (!lineText || lineText.length > 20) continue;
    if (!/[\u4e00-\u9fff]/.test(lineText)) continue;
    if (/https?:\/\/|sk-|[:：=]/i.test(lineText)) continue;
    if (/地址|密钥|模型|官网|文档|key|url|token/i.test(lineText)) continue;
    return lineText;
  }
  return '';
}

function tryJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 很多站子直接给一段 JSON 配置，这种情况解析得最准 */
function fromJson(json: Record<string, unknown>): ParsedProvider | null {
  const baseUrl = str(json.base_url ?? json.baseUrl ?? json.api_base ?? json.apiBase ?? json.url);
  if (!baseUrl) return null;

  const apiKey = str(json.api_key ?? json.apiKey ?? json.key ?? json.token);
  const name = str(json.name ?? json.title ?? json.provider);

  const models: string[] = [];
  const raw = json.models ?? json.model_list ?? json.modelList ?? json.model;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') models.push(item);
      else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const id = str(record.id ?? record.name);
        if (id) models.push(id);
      }
    }
  } else if (typeof raw === 'string') {
    models.push(...raw.split(/[,，\s]+/).filter(Boolean));
  }

  return { name, baseUrl, apiKey, models, notes: ['从 JSON 配置里读出来的'] };
}

/**
 * 主入口：把一段文本解析成服务商草稿。
 * 认不出来就返回空字符串，由界面提示用户手填 —— 绝不瞎猜。
 */
export function parseProviderText(text: string): ParsedProvider {
  const json = tryJson(text);
  if (json) {
    const parsed = fromJson(json);
    if (parsed) return parsed;
  }

  const baseUrl = pickUrl(text);
  const apiKey = pickKey(text);
  const models = Array.from(new Set(text.match(MODEL_RE) ?? []));
  const name = pickName(text, baseUrl);

  const notes: string[] = [];
  if (baseUrl) notes.push('认出接口地址');
  if (apiKey) notes.push('认出密钥');
  if (models.length > 0) notes.push(`认出 ${models.length} 个模型`);
  if (notes.length === 0) notes.push('没能认出什么，请手动填写');

  return { name, baseUrl, apiKey, models, notes };
}
