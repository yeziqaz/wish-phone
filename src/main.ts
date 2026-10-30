import './app.css';
import { HOME, navigate, route, startRouter } from './core/router';
import { mountDesktop } from './features/desktop/desktop';

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
