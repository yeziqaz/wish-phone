/* ==========================================================================
   把美化数据翻译成「渲染参数」

   为什么要有这一层：
     chat.ts 只应该知道「这个头像要带什么装饰、这个气泡要什么样式」，
     不该知道挂件预设长什么样、SVG 怎么画。中间加这一层，
     以后换掉美化的数据结构，chat.ts 一行都不用改。
   ========================================================================== */

import type { AvatarDecoration, AvatarDecorationItem } from '../../../ui/avatar-decoration';
import { pendantSVG } from './pendant';
import { allPendants, type BeautyRole, type BeautyScheme, type Sticker } from './model';
import { activeScheme, assetUrl, beautyData, beautyReady } from './store';
import { previewBubbleStyle } from './css';

/** 把一条贴纸数据渲染成装饰项 */
function stickerItem(sticker: Sticker): AvatarDecorationItem {
  const preset = allPendants(beautyData()).find((item) => item.id === sticker.assetId);
  const url = assetUrl(sticker.assetId);
  return {
    html: pendantSVG(preset, url),
    x: sticker.x,
    y: sticker.y,
    scale: sticker.scale,
    rotation: sticker.rotation,
    zIndex: sticker.zIndex,
  };
}

/**
 * 某个角色的头像装饰。
 *
 * @param role 'user' = 我，'wuli' = 对话中的角色
 * @returns 没有装饰时返回 undefined，调用方走原来的头像路径
 */
export function avatarDecorOf(role: BeautyRole): AvatarDecoration | undefined {
  if (!beautyReady()) return undefined;
  const scheme = activeScheme();
  const avatar = scheme.participants[role].avatar;

  const frameUrl = avatar.frameId ? assetUrl(avatar.frameId) : '';
  const framePreset = avatar.frameId && !frameUrl
    ? allPendants(beautyData()).find((item) => item.id === avatar.frameId)
    : undefined;

  const frameHTML = frameUrl
    ? `<img class="pendant-img" src="${frameUrl}" alt="" loading="lazy" decoding="async">`
    : framePreset
      ? pendantSVG(framePreset)
      : '';

  const stickers = avatar.stickers.map(stickerItem);
  if (!frameHTML && stickers.length === 0) return undefined;
  return { frameHTML, stickers };
}

/** 气泡里的贴纸（绝对定位在四个角） */
export function bubbleStickersHTML(role: BeautyRole, scheme?: BeautyScheme): string {
  if (!beautyReady() && !scheme) return '';
  const target = scheme ?? activeScheme();
  const stickers = target.participants[role].bubble.stickers;
  if (!stickers.length) return '';

  return stickers
    .map((sticker) => {
      const preset = allPendants(beautyData()).find((item) => item.id === sticker.assetId);
      const url = assetUrl(sticker.assetId);
      const left = sticker.corner.endsWith('left') ? '0%' : '100%';
      const top = sticker.corner.startsWith('top') ? '0%' : '100%';
      return (
        `<span class="bubble-sticker" style="left:${left};top:${top};z-index:${sticker.zIndex + 2};` +
        `transform:translate(calc(-50% + ${sticker.x}px), calc(-50% + ${sticker.y}px)) ` +
        `rotate(${sticker.rotation}deg) scale(${sticker.scale})">` +
        `${url ? `<img src="${url}" alt="">` : esc2(preset?.glyph ?? '★')}</span>`
      );
    })
    .join('');
}

/** 只在内部用的最小转义（避免再引一个依赖走一圈） */
function esc2(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** 气泡的内联样式（空串表示用 CSS 里的默认值） */
export function bubbleStyleOf(role: BeautyRole): string {
  if (!beautyReady()) return '';
  return previewBubbleStyle(activeScheme(), role, assetUrl);
}
