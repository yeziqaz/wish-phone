import './app.css';
import { migrateLegacyApiConfig, pruneLogs } from './core/db';
import { migrateProvidersToSites } from './core/api-migrate';
import { loadPrefs } from './core/prefs';
import { HOME, navigate, route, startRouter } from './core/router';
import { mountDesktop } from './features/desktop/desktop';
import { mountLockscreen } from './features/lockscreen/lockscreen';
import { mountProviderEdit } from './features/providers/provider-edit';
import { mountProviderList } from './features/providers/provider-list';
import { mountApiPage } from './features/api/api-page';
import { mountSiteDetail } from './features/api/site-detail';
import { mountRoleList, mountRoleDetail } from './features/api/assign-roles';
import { mountApiType } from './features/providers/api-type';
import type { ModelKind } from './core/types';
import { mountCharacterList } from './features/characters/character-list';
import { mountCharacterEdit } from './features/characters/character-edit';
import { mountDataStore } from './features/settings/data-store';
import { mountSettings } from './features/settings/settings';
import { mountChatHome } from './features/chat/chat-home';
import { mountChat } from './features/chat/chat';
import { mountWorldEdit } from './features/worlds/world-edit';
import { mountLoreList } from './features/lore/lore-list';
import { mountLoreEdit } from './features/lore/lore-edit';
import { ensureDefaults } from './features/characters/defaults';

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
route('/character', () => void mountCharacterList(app));
// 注意：'/character/new' 必须排在 '/character/:id' 前面，否则 new 会被当成 id
route('/character/new', () => void mountCharacterEdit(app, 'new'));
route('/character/:id', ({ params }) => void mountCharacterEdit(app, params.id ?? ''));
route('/chat', () => void mountChatHome(app));
route('/chat/:id', ({ params }) => mountChat(app, params.id ?? ''));
route('/help', () => mountPlaceholder('帮助'));

route('/settings', () => void mountSettings(app));
route('/settings/data', () => void mountDataStore(app));
route('/world/new', () => void mountWorldEdit(app, 'new'));
route('/world/:id', ({ params }) => void mountWorldEdit(app, params.id ?? ''));
route('/settings/lore', () => void mountLoreList(app));
route('/settings/lore/:id', ({ params }) => mountLoreEdit(app, params.id ?? ''));
// 新版「API 与模型」（设计文档 v1.1）。必须注册在老路由 /settings/api/:kind 之前
route('/settings/api', () => void mountApiPage(app));
// 站点详情。带 /site/ 前缀，免得和老路由 /settings/api/:kind 撞上
route('/settings/api/site/:id', ({ params }) => void mountSiteDetail(app, params.id ?? ''));
// 角色模型设置：列表 + 单个角色。必须注册在 /settings/api 之后、:kind 之前
route('/settings/api/roles', ({ query }) => {
  const roleId = query.get('role');
  if (roleId) void mountRoleDetail(app, roleId);
  else void mountRoleList(app);
});
route('/settings/providers', () => void mountProviderList(app));
route('/settings/api/:kind', ({ params }) => void mountApiType(app, params.kind ?? ''));
// ⚠️ 'new' 必须注册在 ':id' 前面 —— 路由匹配按注册顺序走
route('/settings/providers/new', ({ query }) =>
  void mountProviderEdit(app, 'new', (query.get('kind') as ModelKind | null) ?? 'text'),
);
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
// 服务商 → 站点（设计文档 v1.1）。同样不 await，且老 providers 表原样留着，
// 所以这一步失败也不影响用户继续用老界面。
void migrateProvidersToSites().catch(() => {});
// 请求日志按文档 §8.3 只留 30 天，启动时顺手清一次，不用定时器
void pruneLogs().catch(() => {});
// 偏好读进内存，桌面才知道顶部状态栏该不该显示
void loadPrefs();
// 内置世界 + 内置角色（wuli）。幂等；失败不挡桌面，
// 角色页会再试一次并显示提示（不在这里打日志，见 AGENTS §5）
void ensureDefaults().catch(() => {});

if (!location.hash) navigate(HOME);
startRouter();

// 顺序很重要：先把桌面渲染好（此时它被锁屏盖住），再盖上锁屏。
// 反过来的话，上滑解锁的那一瞬间底下还是空的，会闪一下白。
// 将来「要不要锁屏」的开关只影响这一行。
mountLockscreen();
