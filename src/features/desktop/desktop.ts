import { icon } from '../../ui/icons';
import type { IconName } from '../../ui/icons';
import './desktop.css';

/* ==========================================================================
   桌面：状态栏（时间 / 日期）+ 图标网格 + Dock
   第一版桌面是固定的，不做拖拽、不做多页 —— 那些属于后面的版本。
   ========================================================================== */

interface AppDef {
  id: string;
  label: string;
  icon: IconName;
  route: string;
}

/** 每个 App 只出现一次：要么在网格，要么在 Dock */
const GRID: AppDef[] = [
  { id: 'character', label: '角色', icon: 'character', route: '/character' },
  { id: 'help', label: '帮助', icon: 'help', route: '/help' },
];

/** Dock 放最常用的两个 */
const DOCK: AppDef[] = [
  { id: 'chat', label: '聊天', icon: 'chat', route: '/chat' },
  { id: 'settings', label: '设置', icon: 'settings', route: '/settings' },
];

const WEEK = ['日', '一', '二', '三', '四', '五', '六'] as const;

function appButton(app: AppDef, extra = ''): string {
  return `
    <button class="app jelly ${extra}" type="button" data-go="${app.route}"
            aria-label="${app.label}">
      <span class="app__icon">${icon(app.icon, 24)}</span>
      <span class="app__label">${app.label}</span>
    </button>`;
}

/** 只在文字真的变了才写 DOM —— 每秒写一次 textContent 会白白触发排版 */
function paint(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export function mountDesktop(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="desktop">
      <header class="desktop__status">
        <div class="desktop__time" id="clock">--:--</div>
        <div class="desktop__date" id="today"></div>
      </header>

      <main class="desktop__grid">
        ${GRID.map((a) => appButton(a)).join('')}
      </main>

      <footer class="desktop__dock">
        ${DOCK.map((a) => appButton(a, 'app--dock')).join('')}
      </footer>
    </div>`;

  const clock = root.querySelector<HTMLElement>('#clock');
  const today = root.querySelector<HTMLElement>('#today');

  const tick = (): void => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    paint(clock, `${hh}:${mm}`);
    paint(today, `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()] ?? ''}`);
  };

  tick();
  const timer = window.setInterval(tick, 1000);

  // 切走时由 router 调用，把定时器收掉
  return () => window.clearInterval(timer);
}
