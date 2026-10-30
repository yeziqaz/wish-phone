/**
 * hash 路由。
 *
 * 为什么用 hash 而不是 History API：
 *   1. GitHub Pages 部署零配置，不需要 404 回退重写
 *   2. Capacitor 在 WebView 117+ 上自定义 scheme 改不了 URL 路径，
 *      官方明确建议用 hash 策略（见 docs/research/技术调研报告.md）
 */
type Handler = (params: URLSearchParams) => void;

const routes = new Map<string, Handler>();

/** 默认落地页 */
export const HOME = '/desktop';

let current = '';

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

  current = path;
  handler(new URLSearchParams(query));
}

export function startRouter(): void {
  addEventListener('hashchange', resolve);
  resolve();
}
