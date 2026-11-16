/* ==========================================================================
   ⚠️ 这一版是**过渡兼容层**，不是主实现。

   主实现已经换成「聊天美化」里那套完整挂件系统：
     apps/chat/beauty/model.ts     （8 个预设 + 数据模型）
     apps/chat/beauty/pendant.ts  （含猫耳朵那套 SVG）

   这里为什么还留着 4 个简单圆环：
     Character 记录上有一个 `avatarFrame` 字段，老数据里可能存着
     'ring' / 'orbit' 这类值。删掉这张表，老用户打开就看不到框了。
     所以它保留为「角色自己身上的框」这条独立路径，
     而美化系统里的「我的头像框」走的是另一套（存 settings，不存角色）。
   ========================================================================== */

/** 内置头像框。id 存数据库里，所以这里只增不改 */
export type AvatarFrameId = 'ring' | 'ring-dashed' | 'corners' | 'orbit';

export interface AvatarFrame {
  id: AvatarFrameId;
  label: string;
}

export const AVATAR_FRAMES: AvatarFrame[] = [
  { id: 'ring', label: '细圈' },
  { id: 'ring-dashed', label: '虚线圈' },
  { id: 'corners', label: '四角' },
  { id: 'orbit', label: '轨道' },
];

const FRAME_SVG: Record<AvatarFrameId, string> = {
  // 最克制的一版：一圈细描边，稍微向外让开，不压头像
  ring: '<circle cx="50" cy="50" r="46" stroke="currentColor" stroke-width="2" fill="none"/>',

  // 虚线：更轻，适合安静的界面
  'ring-dashed':
    '<circle cx="50" cy="50" r="46" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="4 6"/>',

  // 四角：只在四个角上画短弧，中间完全留白，最不占视觉
  corners:
    '<path d="M8 24V16a8 8 0 0 1 8-8h8" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M76 8h8a8 8 0 0 1 8 8v8" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M92 76v8a8 8 0 0 1-8 8h-8" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M24 92h-8a8 8 0 0 1-8-8v-8" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>',

  // 轨道：圈 + 右上一个小点，像卫星
  orbit:
    '<circle cx="50" cy="50" r="46" stroke="currentColor" stroke-width="2" fill="none"/>' +
    '<circle cx="78" cy="20" r="4" fill="currentColor"/>',
};

/**
 * 头像框的 SVG。
 *
 * @param id 框的标识；为空或未知时返回空串（调用方直接不渲染这一层）
 * @param size 头像实际直径，框会按同尺寸铺上去
 */
export function avatarFrameHTML(id: string | undefined, size: number): string {
  if (!id) return '';
  const svg = FRAME_SVG[id as AvatarFrameId];
  if (!svg) return '';
  return (
    `<svg class="avatar-frame" style="--avatar-size:${size}px" viewBox="0 0 100 100" ` +
    `aria-hidden="true" focusable="false">${svg}</svg>`
  );
}

export function avatarFrameLabel(id: string | undefined): string {
  if (!id) return '无';
  return AVATAR_FRAMES.find((frame) => frame.id === id)?.label ?? '无';
}