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
  /** 可能有好几个 —— 有的站给两个号，或者按模型系列发 Key */
  apiKeys: string[];
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

/**
 * 找密钥。一个站可能给好几个，所以这里全部找出来，不是只取第一个。
 * 顺序：明确标注的 → sk- 前缀的 → 孤立的超长串。
 */
function pickKeys(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const trimmed = value.trim().replace(/[.,;'"]+$/, '');
    if (trimmed.length < 8 || seen.has(trimmed)) return;
    seen.add(trimmed);
    found.push(trimmed);
  };

  for (const match of text.matchAll(
    /(?:api[\s_-]?key|secret|token|密钥|key)\s*\d*\s*[:：=]\s*["']?([A-Za-z0-9_\-.]{8,})/gi,
  )) {
    push(match[1] ?? '');
  }

  for (const match of text.matchAll(/\bsk-[A-Za-z0-9_-]{8,}\b/g)) {
    push(match[0]);
  }

  // 长串要先把网址剔掉，否则域名路径会被当成 Key
  const withoutUrls = text.replace(URL_RE, ' ');
  for (const match of withoutUrls.matchAll(/\b[A-Za-z0-9_-]{32,}\b/g)) {
    if (/^\d+$/.test(match[0])) continue;
    push(match[0]);
  }

  return found;
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

/**
 * 第一行是不是站名。
 * 用户规定格式里站名就写在第一行，所以这个要优先于「从域名猜」。
 */
function firstLineName(text: string): string {
  const first = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return '';
  if (/https?:\/\//i.test(first)) return '';
  // 带冒号的可能是「密钥：xxx」这类标注行
  if (/[:：=]/.test(first)) return '';
  if (first.length > 30) return '';
  // 「欢迎使用 XX 中转站！」里真正有用的是后半截
  return first
    .replace(/^(欢迎使用|欢迎来到|欢迎)\s*/, '')
    .replace(/[!！。,，]+$/, '')
    .trim();
}

/** 猜名字：明确标注 > 第一行 > 中文行 > 从域名里挑一个像的 */
function pickName(text: string, baseUrl: string): string {
  const labelled = text.match(/(?:名称|站名|站点|站子|名字|服务商|平台|name)\s*[:：=]\s*(.+)/i);
  if (labelled?.[1]) {
    const value = labelled[1].trim();
    // 别把一整行别的信息也吞进来
    if (value.length > 0 && value.length <= 30) return value;
  }

  // 第一行就是站名（用户规定的格式）
  const first = firstLineName(text);
  if (first) return first;

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

  const name = str(json.name ?? json.title ?? json.provider);

  const apiKeys: string[] = [];
  const keyRaw =
    json.api_keys ?? json.apiKeys ?? json.api_key ?? json.apiKey ?? json.key ?? json.token;
  if (Array.isArray(keyRaw)) {
    for (const item of keyRaw) {
      const value = str(item);
      if (value) apiKeys.push(value);
    }
  } else {
    const value = str(keyRaw);
    if (value) apiKeys.push(value);
  }

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

  return { name, baseUrl, apiKeys, models, notes: ['从 JSON 配置里读出来的'] };
}

/** 解析「一个」站子的那一段文字 */
function parseOneBlock(block: string): ParsedProvider | null {
  const baseUrl = pickUrl(block);
  const apiKeys = pickKeys(block);
  const models = Array.from(new Set(block.match(MODEL_RE) ?? []));
  const name = pickName(block, baseUrl);

  if (!baseUrl && apiKeys.length === 0 && !name) return null;

  const notes: string[] = [];
  if (name) notes.push(`站名：${name}`);
  if (baseUrl) notes.push(`地址：${baseUrl}`);
  if (apiKeys.length > 0) notes.push(`密钥：${apiKeys.length} 个`);

  return { name, baseUrl, apiKeys, models, notes };
}

/**
 * 主入口：把一段文本解析成**若干个**服务商草稿。
 *
 * 支持一次粘好几个站子，格式是「空行分隔」：
 *
 *   站名1
 *   https://api.aa.com/v1
 *   key1:sk-xxx
 *   key2:sk-yyy
 *
 *   站名2
 *   https://api.bb.com/v1
 *   key1:sk-zzz
 *
 * 如果粘进来的是一整段没有空行的混杂文字，仍然按一个站子解析，
 * 所以老的粘贴方式照样能用。
 */
export function parseProvidersText(text: string): ParsedProvider[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 单个 JSON 配置
  const json = tryJson(trimmed);
  if (json) {
    const one = fromJson(json);
    if (one) return [one];
  }

  // 空行切块
  const blocks = trimmed
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) {
    const one = parseOneBlock(trimmed);
    return one ? [one] : [];
  }

  // 至少两块各自认出了地址，才当成「一次多个站子」
  const each = blocks
    .map(parseOneBlock)
    .filter((item): item is ParsedProvider => item !== null);
  if (each.filter((item) => item.baseUrl).length >= 2) return each;

  // 不是多站格式，退回整体当一个站子解析
  const whole = parseOneBlock(trimmed);
  return whole ? [whole] : [];
}

/** 只要一个站子时用它（保留老接口的形状） */
export function parseProviderText(text: string): ParsedProvider {
  return parseProvidersText(text)[0] ?? { name: '', baseUrl: '', apiKeys: [], models: [], notes: ['没能认出什么，请手动填写'] };
}
