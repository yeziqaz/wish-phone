/**
 * hash 路由。
 *
 * 为什么用 hash 而不是 History API：
 *   1. GitHub Pages 部署零配置，不需要 404 回退重写
 *   2. Capacitor 在 WebView 117+ 上自定义 scheme 改不了 URL 路径，
 *      官方明确建议用 hash 策略（见 docs/research/技术调研报告.md）
 *
 * 支持动态段，为了设置页的分级子页面：
 *   route('/settings/providers/:id', ({ params }) => { ... params.id ... })
 *   匹配按**注册顺序**，所以 /settings/providers/new 要注册在 /:id 前面。
 *
 * 页面可以返回一个「清理函数」，切走时自动执行。
 */
export interface RouteContext {
  /** 路径里的动态段，如 /settings/providers/:id → { id: 'xxx' } */
  params: Record<string, string>;
  /** ? 后面的查询参数 */
  query: URLSearchParams;
  /** 当前路径，不含 query */
  path: string;
}

type Handler = (ctx: RouteContext) => (() => void) | void;

interface Route {
  pattern: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

/** 默认落地页 */
export const HOME = '/desktop';

let current = '';
let cleanup: (() => void) | null = null;

/** 把 '/a/:b/c' 编译成正则，并记下动态段的名字 */
function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      // 静态段要转义，免得 '.' 之类被当成正则元字符
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), keys };
}

/** 注册一条路由。带动态段时，具体路径要注册在通配路径之前 */
export function route(pattern: string, handler: Handler): void {
  const { regex, keys } = compile(pattern);
  routes.push({ pattern, regex, keys, handler });
}

/** 跳转。已在同一路径时不重复触发 */
export function navigate(path: string): void {
  if (location.hash.slice(1) !== path) location.hash = path;
}

/** 返回上一页；没有历史就回首页 */
export function back(): void {
  if (history.length > 1) history.back();
  else navigate(HOME);
}

function resolve(): void {
  const raw = decodeURIComponent(location.hash.slice(1)) || HOME;

  const mark = raw.indexOf('?');
  const path = mark >= 0 ? raw.slice(0, mark) : raw;
  const query = new URLSearchParams(mark >= 0 ? raw.slice(mark + 1) : '');

  if (path === current) return;

  const matched = routes.find((r) => r.regex.test(path));
  if (!matched) {
    // 地址敲错了就回首页；首页本身没注册就老实待着，避免死循环
    if (path !== HOME && routes.some((r) => r.pattern === HOME)) navigate(HOME);
    return;
  }

  const params: Record<string, string> = {};
  const result = matched.regex.exec(path);
  matched.keys.forEach((key, index) => {
    const value = result?.[index + 1];
    if (value !== undefined) params[key] = value;
  });

  // 先拆掉上一页，再搭新页 —— 顺序反了会清掉新页刚建立的东西
  cleanup?.();
  cleanup = null;
  current = path;

  const returned = matched.handler({ params, query, path });
  if (typeof returned === 'function') cleanup = returned;
}

export function startRouter(): void {
  addEventListener('hashchange', resolve);
  resolve();
}
