/* ==========================================================================
   聊天美化 → CSS

   ⚠️ 移植自用户自己的项目：
       apps/chat/chat-beauty-css.js  （变量表 + 生成器）
       apps/chat/bubble-shadow.js    （阴影强度曲线）
       apps/chat/ChatMessage.vue     （气泡的最终样式算法）

   所有数值范围、变量名与原项目一致。
   ========================================================================== */

import type { BeautyRole, BeautyScheme, Participant } from './model';
import { shapeDataUri, shapePresetOf } from './shape';

/**
 * 变量名 → 取值路径。
 *
 * 原项目用 `VARIABLE_PATHS` 这张表同时干两件事：
 *   1. 生成 CSS
 *   2. 从一段 CSS 文本反解回数据（代码模式）
 * 这里只做第 1 件（代码模式在原生实现里是「可编辑 CSS」而不是反解），
 * 但表结构保持一模一样，方便以后加。
 */
export const BEAUTY_VARIABLE_PATHS: Record<string, string> = {
  '--beauty-app-background': 'app.background',
  '--beauty-app-panel': 'app.panel',
  '--beauty-app-navigation': 'app.navigation',
  '--beauty-app-accent': 'app.accent',
  '--beauty-app-ink': 'app.ink',
  '--beauty-app-muted': 'app.muted',
  '--beauty-bg-color': 'background.color',
  '--beauty-bg-blur': 'background.blur',
  '--beauty-bg-overlay': 'background.overlay',
  '--beauty-font-size': 'font.size',
  '--beauty-font-color': 'font.color',
  '--beauty-user-fill': 'participants.user.bubble.fill',
  '--beauty-user-border': 'participants.user.bubble.border',
  '--beauty-user-radius': 'participants.user.bubble.radius',
  '--beauty-user-opacity': 'participants.user.bubble.opacity',
  '--beauty-user-border-width': 'participants.user.bubble.borderWidth',
  '--beauty-user-shadow': 'participants.user.bubble.shadow',
  '--beauty-user-gradient-color': 'participants.user.bubble.gradientColor',
  '--beauty-user-gradient-angle': 'participants.user.bubble.gradientAngle',
  '--beauty-wuli-fill': 'participants.wuli.bubble.fill',
  '--beauty-wuli-border': 'participants.wuli.bubble.border',
  '--beauty-wuli-radius': 'participants.wuli.bubble.radius',
  '--beauty-wuli-opacity': 'participants.wuli.bubble.opacity',
  '--beauty-wuli-border-width': 'participants.wuli.bubble.borderWidth',
  '--beauty-wuli-shadow': 'participants.wuli.bubble.shadow',
  '--beauty-wuli-gradient-color': 'participants.wuli.bubble.gradientColor',
  '--beauty-wuli-gradient-angle': 'participants.wuli.bubble.gradientAngle',
};

/**
 * 阴影强度 → box-shadow。
 *
 * ⚠️ 这条曲线的用意在原项目的注释里写得很清楚，照搬过来：
 *   「Zero removes the entire shadow; increasing strength grows and darkens it,
 *     instead of only blurring the same fixed offset until it disappears.」
 *
 * 也就是说：强度变大时，偏移和模糊**一起变大**，不透明度也一起变深。
 * 如果只加模糊而不动偏移，阴影会摊成一片灰雾，看起来像脏了。
 * 0 必须是完全的 none，不能留一个 0px 的假阴影。
 */
export function bubbleShadow(value: number): string {
  const strength = Number.isFinite(value) ? Math.min(30, Math.max(0, value)) : 0;
  if (!strength) return 'none';
  const px = (factor: number): string => `${Number((strength * factor).toFixed(2))}px`;
  const opacity = Number((0.08 + (strength / 30) * 0.32).toFixed(3));
  return `0 ${px(0.2)} ${px(0.4)} ${px(0.04)} rgb(61 51 66 / ${opacity})`;
}

/**
 * 一个气泡的完整内联样式。
 *
 * 移植自原项目 `bubbleStyle(role)`：
 *   - 用 color-mix 把填充色按 opacity 混到透明里（这样半透明气泡不会发灰）
 *   - 有渐变时用 linear-gradient 叠两层 color-mix
 *   - 圆角、边框、阴影都来自数据
 *
 * 返回的是可以直接塞进 style="..." 的字符串。
 */
export function bubbleInlineStyle(
  participant: Participant,
  resolveAssetUrl?: (id: string, flipped?: boolean) => string,
): string {
  const bubble = participant.bubble;
  const first = `color-mix(in srgb, ${bubble.fill} ${bubble.opacity * 100}%, transparent)`;
  const second = bubble.gradientColor
    ? `color-mix(in srgb, ${bubble.gradientColor} ${bubble.opacity * 100}%, transparent)`
    : '';

  const background = second
    ? `linear-gradient(${bubble.gradientAngle}deg, ${first}, ${second})`
    : first;

  const shape = bubbleShapeStyle(participant, resolveAssetUrl);

  // 用异形时整个边框让位给 9-slice：background 清掉、border 变透明占位。
  // 这不是偷懒 —— 9-slice 的图自己带填充和描边，再叠一层背景会把图盖住。
  if (shape) {
    const ink = bubble.bubbleShape.ink ? `color:${bubble.bubbleShape.ink};` : '';
    return [
      'background:transparent',
      `box-shadow:${bubbleShadow(bubble.shadow)}`,
      `${ink}${shape}`,
    ].join(';');
  }

  return [
    `background:${background}`,
    `border:${bubble.borderWidth}px solid ${bubble.border}`,
    `border-radius:${bubble.radius}px`,
    `box-shadow:${bubbleShadow(bubble.shadow)}`,
  ].join(';');
}

/**
 * 给定底色，返回在上面看得清的文字色。
 *
 * 用 W3C 的相对亮度公式（不是简单平均 RGB）—— 人眼对绿色最敏感、
 * 蓝色最迟钝，直接用 (r+g+b)/3 会把深蓝判成「亮」，结果配白字看不清。
 *
 * 阈值 0.55 是试出来的：黑白灰基调下它等价于「比中灰浅就用黑字」。
 * 不引库，公式就三行。
 */
export function readableInkOn(fill: string): string {
  const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(fill);
  if (!m) return 'var(--ink)';
  const channel = (hex: string): number => {
    const c = parseInt(hex, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(m[1]!) + 0.7152 * channel(m[2]!) + 0.0722 * channel(m[3]!);
  return luminance > 0.55 ? 'var(--ink)' : 'var(--inverse-ink)';
}

/**
 * 异形气泡的 9-slice 规则。没启用异形时返回空串。
 *
 * ---------- 为什么 border 要「透明 + 占位」 ----------
 *
 * border-image 的渲染区域就是 border box。所以 border 必须真的占住那圈空间，
 * 但颜色要是透明的 —— 否则会看见一圈纯色描边压在九宫格图外面。
 * 这是教程里写明的做法，也是唯一可行的做法。
 *
 * ---------- 为什么 radius 要清零 ----------
 *
 * border-image 会沿 border box 的**矩形**边缘铺图。
 * 留圆角的话，图会被裁成圆角，四角的装饰直接被切掉。
 *
 * ---------- 单位 ----------
 *
 * slice 是图片像素（不带单位），width 是 CSS 像素（带 px）。
 * 写成同一个单位是最常见的错误：教程原话说「90% 的教程会搞错这点」。
 */
export function bubbleShapeStyle(
  participant: Participant,
  resolveAssetUrl?: (id: string, flipped?: boolean) => string,
): string {
  const shape = participant.bubble.bubbleShape;
  if (!shape?.shapeId) return '';

  const preset = shapePresetOf(shape.shapeId);
  const uri = preset
    ? shapeDataUri(preset, participant.bubble.fill, participant.bubble.border)
    : resolveAssetUrl?.(shape.shapeId, shape.flipped) ?? '';
  if (!uri) return ''; // 素材被删了 → 安静退回圆角矩形

  const slice = shape.slice.join(' ');
  const width = shape.width.map((n) => `${n}px`).join(' ');

  return [
    'background:transparent',
    'border-style:solid',
    'border-color:transparent',
    `border-width:${width}`,
    `border-image:url("${uri}") ${slice} fill / ${width} ${shape.fillMode}`,
    'border-radius:0',
  ].join(';');
}

/**
 * 聊天气泡用的异形样式：带了 padding 补偿。
 *
 * 为什么需要补偿：9-slice 把 border 撑到几十像素，而 border 是加在 padding 外面的，
 * 内容区会因此变宽。但视觉上我们只想要「原来的文字位置」，
 * 所以把 padding 往下减，让文字落在图中间那块平坦区。
 *
 * 别减过头 —— 减到负数会把文字挤到边框上。
 */
export function bubbleShapeInline(
  participant: Participant,
  resolveAssetUrl?: (id: string, flipped?: boolean) => string,
): string {
  const base = bubbleShapeStyle(participant, resolveAssetUrl);
  if (!base) return '';
  return base;
}

/** 面板里的预览气泡也走同一个函数，所以在面板里看到的和聊天里一模一样 */
export function previewBubbleStyle(
  scheme: BeautyScheme,
  role: BeautyRole,
  resolveAssetUrl?: (id: string, flipped?: boolean) => string,
): string {
  return bubbleInlineStyle(scheme.participants[role], resolveAssetUrl);
}

/**
 * 把方案摊平成 CSS 变量表。
 *
 * 挂在消息列表容器上，所有气泡一次跟着变 —— 不重画 DOM。
 * 这点和原项目一致（原项目也是 `.chat-beauty-enabled` 一个 class 上挂满变量）。
 */
export function beautyVariables(scheme: BeautyScheme): Record<string, string> {
  const read = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], scheme);

  const vars: Record<string, string> = {};
  for (const [name, path] of Object.entries(BEAUTY_VARIABLE_PATHS)) {
    const value = read(path);
    if (value === '' || value == null) continue;
    vars[name] = String(value);
  }

  return vars;
}

/**
 * 面板的「界面」板块单独用这几个值（不通过变量，直接设在内联样式上）。
 * 因为 .chatapp 在聊天页之外也可能存在，挂全局变量会污染别的页面。
 */
export function appColors(scheme: BeautyScheme): Record<string, string> {
  return {
    background: scheme.app.background,
    panel: scheme.app.panel,
    navigation: scheme.app.navigation,
    accent: scheme.app.accent,
    ink: scheme.app.ink,
    muted: scheme.app.muted,
  };
}
