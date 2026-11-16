/* ==========================================================================
   板块：气泡

   一个气泡能被改的九个维度，全部保留原项目的范围：
     模版 / 透明度 0-100% / 填充色 / 渐变（色 + 角度 0-360）
     圆角 0-36 / 边框色 / 边框宽 0-6（0.5 步进）/ 阴影强度 0-30

   为什么阴影是「强度」而不是「阴影值」：
     强度同时放大偏移、模糊和黑度（见 css.ts 的 bubbleShadow），
     只加模糊会让阴影摊成一片灰雾，看起来像脏了。
   ========================================================================== */

import { esc } from '../../../../core/dom';
import { BUBBLE_PRESETS, allPendants, type BeautyRole, type BeautyScheme, type Sticker } from '../model';
import { beautyData } from '../store';
import { colorRow, pendantCard, rangeRow, segRow } from './rows';
import { BUBBLE_SHAPES, shapeDataUri } from '../shape';
import { bubbleStickerControls } from './sticker-controls';

export interface BubbleTabState {
  subject: BeautyRole;
  selectedSticker: string;
}

export function bubbleTabHTML(scheme: BeautyScheme, state: BubbleTabState): string {
  const data = beautyData();
  const bubble = scheme.participants[state.subject].bubble;
  const applied = bubble.stickers;
  const active: Sticker | undefined =
    applied.find((item) => item.assetId === state.selectedSticker) ?? applied.at(-1);

  const templates = BUBBLE_PRESETS.map(
    (item) =>
      `<button class="beauty-card${bubble.templateId === item.id ? ' is-on' : ''}" type="button"
         data-bubble="${esc(item.id)}" aria-pressed="${bubble.templateId === item.id}">
        <span class="beauty-swatch" style="background:${item.fill};border-color:${item.border};border-radius:${item.radius}px">你好</span>
        <small class="beauty-card__name">${esc(item.name)}</small>
      </button>`,
  ).join('');

  /**
   * 形状卡片：用真实配色现场画一张缩略图，
   * 而不是放一张固定的示意 —— 这样用户能直接看到「我的颜色 + 这个形状」是什么样。
   */
  const currentShape = bubble.bubbleShape?.shapeId ?? '';
  const shapes =
    `<button class="beauty-card${!currentShape ? ' is-on' : ''}" type="button"
       data-shape="" aria-pressed="${!currentShape}">
      <span class="beauty-shape-preview"
            style="background:${esc(bubble.fill)};border-color:${esc(bubble.border)}">你好</span>
      <small class="beauty-card__name">无（圆角）</small>
    </button>` +
    BUBBLE_SHAPES.map((item) => {
      const on = currentShape === item.id;
      const uri = shapeDataUri(item, bubble.fill, bubble.border);
      return `<button class="beauty-card${on ? ' is-on' : ''}" type="button"
         data-shape="${esc(item.id)}" aria-pressed="${on}">
        <span class="beauty-shape-preview" style="border-style:solid;border-color:transparent;
              border-width:14px 16px 14px 16px;
              border-image:url(&quot;${uri}&quot;) ${item.slice.join(' ')} fill / 14px 16px 14px 16px stretch;
              border-radius:0;background:transparent">${esc(item.name)}</span>
        <small class="beauty-card__name">${esc(item.name)}</small>
      </button>`;
    }).join('');

  const gradient = bubble.gradientColor
    ? colorRow('bubble.gradientColor', '渐变颜色', bubble.gradientColor) +
      rangeRow('bubble.gradientAngle', '渐变角度', bubble.gradientAngle, 0, 360, 1, '°')
    : '';

  const stickerGrid = allPendants(data)
    .map((item) => pendantCard(item, applied.some((sticker) => sticker.assetId === item.id)))
    .join('');

  const appliedChips = applied.length
    ? `<h2 class="beauty-h2">已添加气泡贴纸</h2>
       <div class="beauty-chips">${applied
         .map((item) => {
           const preset = allPendants(data).find((value) => value.id === item.assetId);
           const on = active?.assetId === item.assetId;
           return `<button class="beauty-chip${on ? ' is-on' : ''}" type="button"
                     data-pick-bubble-sticker="${esc(item.assetId)}"
                     aria-pressed="${on}">${esc(preset?.name ?? '贴纸')}</button>`;
         })
         .join('')}</div>`
    : '';

  return `
    ${segRow('subject', [{ id: 'user', label: '我的气泡' }, { id: 'wuli', label: '角色气泡' }], state.subject)}
    <h2 class="beauty-h2">气泡形状</h2>
    <p class="beauty-note">选中后气泡按图片九宫格渲染 —— 四个角不变形，中间跟着文字拉伸。
      没有选中的就是普通圆角矩形。</p>
    <div class="beauty-grid beauty-grid--bubble">${shapes}</div>
    <h2 class="beauty-h2">气泡模版</h2>
    <div class="beauty-grid beauty-grid--bubble">${templates}</div>
    ${rangeRow('bubble.opacity', '透明度', Math.round(bubble.opacity * 100), 0, 100, 1, '%')}
    ${colorRow('bubble.fill', '填充颜色', bubble.fill)}
    <label class="beauty-field beauty-field--switch">
      <span class="beauty-field__label">使用渐变</span>
      <input class="beauty-switch" type="checkbox" role="switch" data-switch="gradient" ${bubble.gradientColor ? 'checked' : ''}>
    </label>
    ${gradient}
    ${rangeRow('bubble.radius', '圆角', bubble.radius, 0, 36)}
    ${colorRow('bubble.border', '边框颜色', bubble.border)}
    ${rangeRow('bubble.borderWidth', '边框宽度', bubble.borderWidth, 0, 6, 0.5, 'px')}
    ${rangeRow('bubble.shadow', '阴影强度', bubble.shadow, 0, 30)}
    <h2 class="beauty-h2">气泡贴纸</h2>
    <div class="beauty-grid beauty-grid--sticker">${stickerGrid}</div>
    <button class="btn beauty-btn beauty-btn--import" type="button" data-import-bubble>导入自定义气泡贴纸（PNG）</button>
    ${appliedChips}
    ${active ? bubbleStickerControls(active) : ''}`;
}
