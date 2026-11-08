// 让 Node 认得项目里那种不带扩展名的相对导入（'./api-catalog' → './api-catalog.ts'）。
// Vite 走 bundler 解析，天生支持；Node 的 ESM 解析是严格的，所以要在这里补一下。
// 只用 Node 自带的模块钩子，不装任何依赖。
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      // 落到下面走原样解析，报错信息才准确
    }
  }
  return next(specifier, context);
}
