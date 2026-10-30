/**
 * 图标：直接内联 SVG 源码，不引任何图标库。
 *
 * 为什么不用 Lucide / Phosphor 的包：
 *   它们要么动辄十几 MB（字体图标包只能全量加载），要么需要构建期转换。
 *   而我们第一版一共就几个图标 —— 直接写进源码最省事、最可控、零依赖。
 *   几何风格参考 Lucide（ISC 许可），但下面这些形状都是自己画的。
 *
 * 规则（见 design/STYLE.md）：桌面图标用【实心】，内页图标用【线性】。
 *   本文件是桌面用的实心集合；内页线性图标加到 LINEAR 里。
 */
export type IconName = 'character' | 'chat' | 'settings' | 'help';

const SOLID: Record<IconName, string> = {
  // 人形：圆头 + 半圆肩
  character:
    '<circle cx="12" cy="7.6" r="4.3"/>' +
    '<path d="M3.4 21.4a8.6 8.6 0 0 1 17.2 0z"/>',

  // 气泡：圆角矩形 + 左下角小尾巴（两个形状叠出来，比一条复杂路径好维护）
  chat:
    '<rect x="2.4" y="3" width="19.2" height="13.6" rx="3.4"/>' +
    '<path d="M6.2 15.4h5.4c0 3-2.1 5.1-5.4 5.1z"/>',

  // 滑块：两条横线 + 两个圆点。比齿轮好画，也更符合极简调性
  settings:
    '<rect x="2" y="5.4" width="20" height="2.6" rx="1.3"/>' +
    '<rect x="2" y="16" width="20" height="2.6" rx="1.3"/>' +
    '<circle cx="8.4" cy="6.7" r="3.3"/>' +
    '<circle cx="15.6" cy="17.3" r="3.3"/>',

  // 书：左页实心、右页半透明
  help:
    '<path d="M4 5.2A3.2 3.2 0 0 1 7.2 2H12v20H7.2A3.2 3.2 0 0 1 4 18.8z"/>' +
    '<path d="M13 2h3.8A3.2 3.2 0 0 1 20 5.2v13.6a3.2 3.2 0 0 1-3.2 3.2H13z" opacity=".4"/>',
};

/**
 * 生成一个图标的 SVG 字符串。
 * 颜色跟随 currentColor，所以换主题不用改图标。
 */
export function icon(name: IconName, size = 24): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="currentColor" aria-hidden="true" focusable="false">${SOLID[name]}</svg>`
  );
}
