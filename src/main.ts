import './app.css';
import { HOME, navigate, route, startRouter } from './core/router';
import { mountDesktop } from './features/desktop/desktop';
import { mountLockscreen } from './features/lockscreen/lockscreen';

/* ==========================================================================
   入口：注册路由、挂载页面。

   T2 起桌面是真的了，其余四屏仍是占位 ——
   它们会在 T4~T8 里被逐个替换掉，谁做出来就把对应的 route 换掉。
   ========================================================================== */

const found = document.querySelector<HTMLDivElement>('#app');
if (!found) throw new Error('index.html 里缺少 #app 挂载点');
const app: HTMLDivElement = found;

/** 临时占位页。title 是写死的字面量，不涉及用户输入 */
function mountPlaceholder(title: string): void {
  app.innerHTML = `
    <div class="placeholder">
      <p class="placeholder__title">${title}</p>
      <p class="placeholder__hint">这一屏还没做</p>
      <button class="btn jelly" type="button" data-go="${HOME}">回桌面</button>
    </div>`;
}

route('/desktop', () => mountDesktop(app));
route('/character', () => mountPlaceholder('角色'));
route('/chat', () => mountPlaceholder('聊天'));
route('/settings', () => mountPlaceholder('设置'));
route('/help', () => mountPlaceholder('帮助'));

// 全局事件委托：绑在挂载点上，页面怎么换都不用重新绑
app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
  const go = el?.dataset.go;
  if (go) navigate(go);
});

if (!location.hash) navigate(HOME);
startRouter();

// 顺序很重要：先把桌面渲染好（此时它被锁屏盖住），再盖上锁屏。
// 反过来的话，上滑解锁的那一瞬间底下还是空的，会闪一下白。
// 将来「要不要锁屏」的开关只影响这一行。
mountLockscreen(() => {});

// 存储自检条：只在开发模式（npm run dev）加载。
// 正式构建时 import.meta.env.DEV 是 false，动态 import 会被整段摇掉，
// 产物里根本不含这段代码 —— 所以它不算「发出去的东西」。
// ⚠️ T4 做完设置页后，连同 src/features/debug/ 一起删掉。
if (import.meta.env.DEV) {
  void import('./features/debug/db-probe').then((m) => m.mountDbProbe());
}
