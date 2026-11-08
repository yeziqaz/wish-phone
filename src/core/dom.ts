/**
 * DOM 小工具。跨页面复用的那几件。
 */

/**
 * HTML 转义。
 * ⚠️ 凡是**用户输入**要拼进 innerHTML 的，必须先过这里。
 *    角色名、服务商名、模型名都会来自用户，不转义就是一个注入口。
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** querySelector 的简写：找不到就抛错，比拿到 null 一路传下去好排查 */
export function must<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`找不到元素：${selector}`);
  return el;
}

/** 允许找不到的查询 */
export function find<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

/** 只在文字真的变了才写，避免无意义的排版开销 */
export function setText(el: Element | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

/** 把毫秒时间戳写成"刚刚 / 5 分钟前 / 10月30日"这样的中文 */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 字节数转人话 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ==========================================================================
   事件绑定：同 key 替换，不叠加

   页面重绘时如果每次都 host.addEventListener，同一个元素上会叠出好几份
   监听器 —— 点一下「选择模型」会弹出两个选择器、请求会发两遍。

   但「只绑一次」也不对：重绘后旧监听器还捕获着旧的 site / assignments，
   点下去拿到的就是过期数据。所以这里做的是**替换**：
   同一个 host 上，同 key 的旧监听器先摘掉，再挂新的。
   ========================================================================== */

const BOUND = Symbol('dsh-bound');

type BoundMap = Map<string, { type: string; handler: (event: Event) => void }>;

function boundMap(host: HTMLElement): BoundMap {
  const slot = host as unknown as Record<symbol, BoundMap>;
  const found = slot[BOUND];
  if (found) return found;
  const created: BoundMap = new Map();
  slot[BOUND] = created;
  return created;
}

/**
 * 在 host 上绑事件。同 key 再绑一次会**替换**掉旧的。
 *
 * @param key 事件标识，区分同一元素上的多种事件
 * @param type 事件类型
 * @param handler 处理函数；每次重绘传新的，旧的自动摘掉
 */
export function bindOnce(
  host: HTMLElement,
  key: string,
  type: 'click' | 'change' | 'input' | 'touchstart' | 'touchend',
  handler: (event: Event) => void,
): void {
  const map = boundMap(host);
  const previous = map.get(key);
  if (previous) host.removeEventListener(previous.type, previous.handler);
  map.set(key, { type, handler });
  host.addEventListener(type, handler);
}

/** 清掉这个宿主上的全部绑定。页面销毁、路由切走时用 */
export function unbindAll(host: HTMLElement): void {
  const map = boundMap(host);
  for (const { type, handler } of map.values()) host.removeEventListener(type, handler);
  map.clear();
}
