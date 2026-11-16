import { esc } from '../core/dom';
import wuliAvatar from '../assets/wuli-avatar.jpg';
import { avatarFrameHTML } from './avatar-frame';
import { avatarDecorationHTML, type AvatarDecoration } from './avatar-decoration';

/**
 * 头像。
 *
 * 三种情况：
 *   1. 有头像图（内置角色用打包进来的图；用户自设的以后是 data URL）→ 画 img
 *   2. 没有图 → 一个圆里放名字的第一个字
 *
 * ⚠️ 关于「自动生成颜色」：整站基调现在是**黑白灰**，
 *    所以这里生成的是**灰阶档位**，不是彩色。
 *    档位由名字稳定算出 —— 同一个名字永远同一档，不会每次刷新都换。
 *    将来主题系统支持彩色时，只要改 TONE_CLASS 这张表，调用方一行都不用动。
 */

/**
 * 内置角色头像。
 *
 * 为什么不把图片存进 IndexedDB：
 *   打包进来的图的 URL 会带构建哈希，每次发版都变；
 *   存进库里的旧 URL 过几天就 404 了。所以库里只存 'builtin:wuli' 这种稳定标记，
 *   URL 由这个表在运行时翻译。
 */
const BUILTIN_AVATARS: Record<string, string> = {
  'builtin:wuli': wuliAvatar,
};

const TONE_CLASS = [
  'avatar--tone0',
  'avatar--tone1',
  'avatar--tone2',
  'avatar--tone3',
] as const;

/** 中文取第一个字，英文取第一个字母（大写），其他原样 */
export function avatarText(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  const first = Array.from(trimmed)[0] ?? '·';
  // 中日韩文字原样返回
  if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(first)) return first;
  return first.toUpperCase();
}

/** 由名字算出灰阶档位。同一个名字永远同一档 */
export function avatarTone(name: string): string {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  }
  return TONE_CLASS[Math.abs(hash) % TONE_CLASS.length] ?? TONE_CLASS[0];
}

/** 头像标识 → 真实图片地址。没有图返回 null */
export function avatarImage(avatarKey?: string): string | null {
  if (!avatarKey) return null;
  return BUILTIN_AVATARS[avatarKey] ?? (avatarKey.startsWith('data:') ? avatarKey : null);
}

/**
 * 有图就用图，没图用名字首字。
 *
 * @param frameId 头像框（可空）。框是纯装饰，不挡点击。
 */
export function avatarHTML(
  name: string,
  size = 40,
  avatarKey?: string,
  frameId?: string,
  decoration?: AvatarDecoration,
): string {
  const src = avatarImage(avatarKey);
  // 优先用完整的装饰层（挂件框 + 贴纸）；没有就走旧的单框路径
  const layer = decoration ? avatarDecorationHTML(decoration) : avatarFrameHTML(frameId, size);
  const framed = layer ? ' avatar--framed' : '';
  if (src) {
    return (
      `<span class="avatar avatar--image${framed}" style="--avatar-size:${size}px" aria-hidden="true">` +
      `<img class="avatar__img" src="${esc(src)}" alt="" loading="lazy" decoding="async">${layer}</span>`
    );
  }
  return (
    `<span class="avatar ${avatarTone(name)}${framed}" style="--avatar-size:${size}px" ` +
    `aria-hidden="true">${esc(avatarText(name))}${layer}</span>`
  );
}
