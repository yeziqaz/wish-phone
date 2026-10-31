/**
 * 图标：直接内联 SVG 源码，不引任何图标库。
 *
 * 为什么不用 Lucide / Phosphor 的包：
 *   它们要么动辄十几 MB（字体图标包只能全量加载），要么需要构建期转换。
 *   而我们一共就十几个图标 —— 直接写进源码最省事、最可控、零依赖。
 *   几何风格参考 Lucide（ISC 许可），但下面这些形状都是自己画的。
 *
 * 规则（见 design/STYLE.md）：
 *   桌面图标用【实心】→ icon()
 *   内页图标用【线性】→ line()
 */
export type IconName = 'character' | 'chat' | 'settings' | 'help';

const SOLID: Record<IconName, string> = {
  // 人形：圆头 + 半圆肩
  character: '<circle cx="12" cy="7.6" r="4.3"/><path d="M3.4 21.4a8.6 8.6 0 0 1 17.2 0z"/>',

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

export type LineIconName =
  | 'provider'
  | 'data'
  | 'statusbar'
  | 'chevron'
  | 'plus'
  | 'trash'
  | 'back'
  | 'wand'
  | 'check'
  | 'eye'
  | 'eyeOff'
  | 'zap';

const LINE: Record<LineIconName, string> = {
  // 云 + 一条底线：服务商
  provider: '<path d="M7 16h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.8 7.2 3.9 3.9 0 0 0 7 16z"/>',

  // 数据库：三层圆柱
  data:
    '<ellipse cx="12" cy="6" rx="7.5" ry="3"/>' +
    '<path d="M4.5 6v12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6"/>' +
    '<path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3"/>',

  // 手机
  statusbar: '<rect x="5.5" y="2.5" width="13" height="19" rx="3"/><path d="M10 5.2h4"/>',

  chevron: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 12.2h9L17.5 7"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',

  // 魔棒：智能导入
  wand:
    '<path d="M3.5 20.5 13 11"/>' +
    '<path d="M15.5 3.5 16.6 6.4 19.5 7.5 16.6 8.6 15.5 11.5 14.4 8.6 11.5 7.5 14.4 6.4z"/>',

  check: '<path d="M5 12.5 10 17.5 19 7"/>',

  // 眼睛：显示 / 隐藏密钥
  eye:
    '<path d="M2.6 12.3a1 1 0 0 1 0-.6 10.4 10.4 0 0 1 18.8 0 1 1 0 0 1 0 .6 10.4 10.4 0 0 1-18.8 0z"/>' +
    '<circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M10.7 5.1a10.4 10.4 0 0 1 10.7 6.6 1 1 0 0 1 0 .6 10.5 10.5 0 0 1-1.4 2.4"/>' +
    '<path d="M14 14.2a3 3 0 0 1-4.2-4.2"/>' +
    '<path d="M17.5 17.5a10.4 10.4 0 0 1-14.9-4.9 1 1 0 0 1 0-.6 10.5 10.5 0 0 1 4.3-4.9"/>' +
    '<path d="m3 3 18 18"/>',

  // 闪电：测试连接
  zap: '<path d="M4.4 14a1 1 0 0 1-.8-1.6l9.6-9.9a.5.5 0 0 1 .9.5l-1.9 5.9a1 1 0 0 0 .9 1.3h6.5a1 1 0 0 1 .8 1.6l-9.6 9.9a.5.5 0 0 1-.9-.5l1.9-5.9a1 1 0 0 0-.9-1.3z"/>',
};

const LINE_ATTRS =
  'fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round"';

/** 桌面用的实心图标 */
export function icon(name: IconName, size = 24): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="currentColor" aria-hidden="true" focusable="false">${SOLID[name]}</svg>`
  );
}

/** 内页用的线性图标 */
export function line(name: LineIconName, size = 20): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `${LINE_ATTRS} aria-hidden="true" focusable="false">${LINE[name]}</svg>`
  );
}
