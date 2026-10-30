import './app.css';
import { createStore } from './core/store';
import { HOME, navigate, route, startRouter } from './core/router';

/* ==========================================================================
   T1 · 骨架验证页
   只验证三件事，三样都通了才算 T1 完成：
     1. 设计令牌生效 —— 颜色全部来自 design/tokens.css，没有一处裸色值
     2. hash 路由生效 —— 点下面的按钮能换页面
     3. store 生效，并且是「只改文本、不重建 DOM」
   T2 会把这一页整个换成真正的桌面。
   ========================================================================== */

const PAGES = [
  ['/desktop', '桌面'],
  ['/character', '角色'],
  ['/chat', '聊天'],
  ['/settings', '设置'],
  ['/help', '帮助'],
] as const;

const probe = createStore({ clicks: 0 });

const found = document.querySelector<HTMLDivElement>('#app');
if (!found) throw new Error('index.html 里缺少 #app 挂载点');
const app: HTMLDivElement = found;

/** 上一页留下的订阅。重建界面前必须先撤销，否则订阅越积越多 */
let unsubscribe: (() => void) | null = null;

function mount(path: string): void {
  unsubscribe?.();
  unsubscribe = null;

  const label = PAGES.find(([p]) => p === path)?.[1] ?? path;

  app.innerHTML = `
    <header class="bar">
      <span class="bar__title">愿望机</span>
      <span class="bar__page">${label}</span>
    </header>
    <main class="body">
      <p class="body__hint">T1 · 骨架验证</p>
      <p class="body__meta">设计令牌 / hash 路由 / store —— 三样都通了才算 T1 完成</p>
      <button class="btn jelly" id="probe" type="button"></button>
      <nav class="nav">
        ${PAGES.map(([p, l]) => `<button class="nav__item jelly" type="button" data-go="${p}">${l}</button>`).join('')}
        <button class="nav__item jelly" type="button" id="theme">切换深色</button>
      </nav>
    </main>`;

  // 关键：只改按钮的文字，绝不重建按钮本身。
  // 重建会打断果冻动画、让输入框失焦（AGENTS.md §7）
  const btn = app.querySelector<HTMLButtonElement>('#probe');
  if (btn) {
    const paint = (n: number): void => {
      btn.textContent = `点了 ${n} 次`;
    };
    paint(probe.get().clicks);
    unsubscribe = probe.subscribe((s) => paint(s.clicks));
    btn.addEventListener('click', () => probe.set({ clicks: probe.get().clicks + 1 }));
  }

  // 事件委托：绑一次，管所有导航按钮
  app.querySelector('.nav')?.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    const go = el?.dataset.go;
    if (go) navigate(go);
  });

  // T1 临时按钮：用来验证设计令牌确实是「一套变量、两套值」。
  // T8 会有正式的深色模式开关，届时删掉这个。
  app.querySelector('#theme')?.addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  });
}

for (const [path] of PAGES) route(path, () => mount(path));

if (!location.hash) navigate(HOME);
startRouter();
