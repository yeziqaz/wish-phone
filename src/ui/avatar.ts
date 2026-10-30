import { esc } from '../core/dom';

/**
 * 头像：一个圆里放名字的第一个字。
 *
 * ⚠️ 关于「自动生成颜色」：整站基调现在是**黑白灰**，
 *    所以这里生成的是**灰阶档位**，不是彩色。
 *    档位由名字稳定算出 —— 同一个名字永远同一档，不会每次刷新都换。
 *    将来主题系统支持彩色时，只要改 TONE_CLASS 这张表，调用方一行都不用动。
 */

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

export function avatarHTML(name: string, size = 40): string {
  return (
    `<span class="avatar ${avatarTone(name)}" style="--avatar-size:${size}px" ` +
    `aria-hidden="true">${esc(avatarText(name))}</span>`
  );
}
