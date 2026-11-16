/* ⚠️ 架构说明：`ui/` 不许依赖任何具体 app（AGENTS.md 铁律 3 的精神）。
   这里的做法是**反向依赖注入** —— ui 只接收已经渲染好的 SVG 字符串，
   不知道「挂件」这个概念来自聊天美化。features 那边算好 SVGG 再传进来。 */

export interface AvatarDecorationItem {
  /** 已经渲染好的 SVG / img 字符串 */
  html: string;
  /** 相对中心的百分比位移（-80 ~ 80） */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
}

export interface AvatarDecoration {
  frameHTML: string;
  stickers: AvatarDecorationItem[];
}

/**
 * 头像装饰层。
 *
 * ⚠️ 核心技法逐字移植自用户自己的项目 components/CharacterAvatar.vue：
 *   `mask-image: radial-gradient(circle closest-side, transparent 33.3333%, #000 calc(33.3333% + .5px))`
 *
 *   这一行是整个系统的关键：装饰层被铺到头像的 -100% ~ 200% 那么大，
 *   然后用遮罩把**头像本体那 1/3 挖空**。所以：
 *     - 贴纸可以放到头像外面很远，不会被裁掉
 *     - 但导入的大图永远不会盖住角色的脸
 *
 *   如果没用这个遮罩，用户导入一张普通照片当挂件，角色的脸就被糊住了。
 */
export function avatarDecorationHTML(decoration: AvatarDecoration | undefined): string {
  if (!decoration) return '';
  const hasFrame = !!decoration.frameHTML;
  const hasStickers = decoration.stickers.length > 0;
  if (!hasFrame && !hasStickers) return '';

  const stickers = decoration.stickers
    .map(
      (item) =>
        `<span class="avatar-sticker" style="left:${50 + item.x}%;top:${50 + item.y}%;` +
        `z-index:${item.zIndex};transform:translate(-50%,-50%) scale(${item.scale}) rotate(${item.rotation}deg)">` +
        `${item.html}</span>`,
    )
    .join('');

  return (
    '<span class="avatar-decoration" aria-hidden="true">' +
    '<span class="avatar-decoration__content">' +
    (hasFrame ? `<span class="avatar-frame">${decoration.frameHTML}</span>` : '') +
    stickers +
    '</span></span>'
  );
}
