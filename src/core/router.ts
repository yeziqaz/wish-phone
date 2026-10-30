/**
 * hash 路由。
 *
 * 为什么用 hash 而不是 History API：
 *   1. GitHub Pages 部署零配置，不需要 404 回退重写
 *   2. Capacitor 在 WebView 117+ 上自定义 scheme 改不了 URL 路径，
 *      官方明确建议用 hash 策略（见 docs/research/技术调研报告.md）
 *
 * 页面可以返回一个「清理函数」，切走时自动执行。
 * 桌面的时钟定时器就靠它停掉，否则会一直在后台空转。
 */
type Handler = (params: URLSearchParams) => (() => void) | void;

const routes = new Map<string, Handler>();

/** 默认落地页 */
export const HOME = '/desktop';

let current = '';
let cleanup: (() => void) | null = null;

/** 注册一条路由，path 形如 '/desktop' */
export function route(path: string, handler: Handler): void {
  routes.set(path, handler);
}

/** 跳转。已在同一路径时不重复触发 */
export function navigate(path: string): void {
  if (location.hash.slice(1) !== path) location.hash = path;
}

function resolve(): void {
  const raw = decodeURIComponent(location.hash.slice(1)) || HOME;
  const [path = HOME, query = ''] = raw.split('?');

  if (path === current) return;

  const handler = routes.get(path);
  if (!handler) {
    // 地址敲错了就回首页；首页本身没注册就老实待着，避免死循环
    if (path !== HOME && routes.has(HOME)) navigate(HOME);
    return;
  }

  // 先拆掉上一页，再搭新页 —— 顺序反了会清掉新页刚建立的东西
  cleanup?.();
  cleanup = null;
  current = path;

  const result = handler(new URLSearchParams(query));
  if (typeof result === 'function') cleanup = result;
}

export function startRouter(): void {
  addEventListener('hashchange', resolve);
  resolve();
}
