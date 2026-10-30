import './app.css';
import { migrateLegacyApiConfig } from './core/db';
import { loadPrefs } from './core/prefs';
import { HOME, navigate, route, startRouter } from './core/router';
import { mountDesktop } from './features/desktop/desktop';
import { mountLockscreen } from './features/lockscreen/lockscreen';
import { mountProviderEdit } from './features/providers/provider-edit';
import { mountProviderList } from './features/providers/provider-list';
import { mountDataStore } from './features/settings/data-store';
import { mountSettings } from './features/settings/settings';

/* ==========================================================================
   入口：注册路由、挂载页面。

   设置页现在是**目录式**的（见 AGENTS.md §3.7）：
     /settings                      目录
     /settings/data                 数据储存
     /settings/providers            服务商列表
     /settings/providers/new        新建
     /settings/providers/:id        编辑

   角色和聊天仍是占位，会在 T5 / T6 里替换掉。
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
route('/help', () => mountPlaceholder('帮助'));

route('/settings', () => void mountSettings(app));
route('/settings/data', () => void mountDataStore(app));
route('/settings/providers', () => void mountProviderList(app));
// ⚠️ 'new' 必须注册在 ':id' 前面 —— 路由匹配按注册顺序走
route('/settings/providers/new', () => void mountProviderEdit(app, 'new'));
route('/settings/providers/:id', ({ params }) => void mountProviderEdit(app, params.id ?? ''));

// 全局事件委托：绑在挂载点上，页面怎么换都不用重新绑
app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
  const go = el?.dataset.go;
  if (go) navigate(go);
});

// 老版本把 API 配置存在 settings 表里，这里把它升级成一个「服务商」。
// 不 await：它只在第一次启动、且确实有老数据时才做事，
// 而用户从解锁到点进设置至少也要一两秒，撞不上。
void migrateLegacyApiConfig();
// 偏好读进内存，桌面才知道顶部状态栏该不该显示
void loadPrefs();

if (!location.hash) navigate(HOME);
startRouter();

// 顺序很重要：先把桌面渲染好（此时它被锁屏盖住），再盖上锁屏。
// 反过来的话，上滑解锁的那一瞬间底下还是空的，会闪一下白。
// 将来「要不要锁屏」的开关只影响这一行。
mountLockscreen();
