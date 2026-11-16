/* ==========================================================================
   桌面 APP 注册表

   这是「手机上有哪些 APP」的唯一真源。

   以前这张表硬编码在 desktop.ts 里，加一个 APP 要回去改渲染代码 ——
   桌面和「有哪些 APP」两件事被绑在一起了。分出来之后：
     · 加 APP = 往下面数组里加一行
     · 桌面只管怎么摆，不管有哪些

   ---------- 一个新 APP 要做什么 ----------

     1. 在 src/apps/<名字>/ 建目录，导出 mountXxx(root)
     2. 在 main.ts 里 route('/<名字>', ...) 注册路由
     3. 往下面的 APPS 里加一行（图标见 src/ui/icons）

   第 2 步暂时还不能省：路由表仍在 main.ts。
   等 APP 多到一定程度，会改成「路由也由 APP 自己声明」，
   但那需要处理注册顺序（'/character/new' 必须排在 '/character/:id' 前），
   不是这一批该做的事。
   ========================================================================== */

import type { IconName } from '../ui/icons';

export interface AppDef {
  /** 唯一 id，也用作 data 属性 */
  id: string;
  /** 图标下面那一行字 */
  label: string;
  icon: IconName;
  route: string;
  /** 'grid' 摆在桌面网格，'dock' 摆在底部固定栏 */
  place: 'grid' | 'dock';
}

/**
 * 桌面上的 APP，按显示顺序。
 *
 * 每个 APP 只出现一次：要么在网格，要么在 Dock。
 */
export const APPS: AppDef[] = [
  { id: 'chat', label: '聊天', icon: 'chat', route: '/chat', place: 'grid' },
  { id: 'character', label: '角色', icon: 'character', route: '/character', place: 'grid' },
  { id: 'help', label: '帮助', icon: 'help', route: '/help', place: 'grid' },
  { id: 'settings', label: '设置', icon: 'settings', route: '/settings', place: 'dock' },
];

/** 摆在网格里的 */
export function gridApps(): AppDef[] {
  return APPS.filter((app) => app.place === 'grid');
}

/** 摆在 Dock 里的 */
export function dockApps(): AppDef[] {
  return APPS.filter((app) => app.place === 'dock');
}
