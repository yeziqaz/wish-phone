import { icon } from '../ui/icons';
import { dockApps, gridApps, type AppDef } from './registry';
import './desktop.css';

/* ==========================================================================
   桌面：图标网格 + Dock

   顶部那条状态栏（时钟 / 信号 / WiFi / 电量）**不在这一屏了**，
   搬去了 shell/statusbar.ts，成为盖在所有页面之上的全局一层。

   为什么搬：它原来只长在桌面上，一进聊天 APP 就没了，
   那条带子就退化成各页面顶部的一点内边距，看着不像「手机的一部分」。
   现在它是外壳，每一屏都在，而且只有一条 —— 不会和真机状态栏叠成两套。

   大时钟在锁屏（shell/lockscreen）。第一版桌面固定，不做拖拽、不做多页。
   ========================================================================== */

/* APP 列表不在这里了 —— 见 shell/registry.ts。
   桌面只负责「怎么摆」，不负责「有哪些」。 */

function appButton(app: AppDef, extra = ''): string {
  return `
    <button class="app jelly ${extra}" type="button" data-go="${app.route}"
            aria-label="${app.label}">
      <span class="app__icon">${icon(app.icon, 24)}</span>
      <span class="app__label">${app.label}</span>
    </button>`;
}

export function mountDesktop(root: HTMLElement): void {
  root.innerHTML = `
    <div class="desktop">
      <main class="desktop__grid">
        ${gridApps().map((a) => appButton(a)).join('')}
      </main>

      <footer class="desktop__dock">
        ${dockApps().map((a) => appButton(a, 'app--dock')).join('')}
      </footer>
    </div>`;
}
