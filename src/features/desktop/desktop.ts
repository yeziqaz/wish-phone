import { onPrefsChanged, statusBarVisible } from '../../core/prefs';
import { icon } from '../../ui/icons';
import type { IconName } from '../../ui/icons';
import './desktop.css';

/* ==========================================================================
   桌面：顶部状态栏 + 图标网格 + Dock

   大时钟搬去锁屏了（features/lockscreen），这一屏只留一行很淡的小字，
   像真手机的状态栏那样尽量不抢注意力。
   第一版桌面固定，不做拖拽、不做多页 —— 那些属于后面的版本。
   ========================================================================== */

interface AppDef {
  id: string;
  label: string;
  icon: IconName;
  route: string;
}

/** 每个 App 只出现一次：要么在网格，要么在 Dock */
const GRID: AppDef[] = [
  { id: 'chat', label: '聊天', icon: 'chat', route: '/chat' },
  { id: 'character', label: '角色', icon: 'character', route: '/character' },
  { id: 'help', label: '帮助', icon: 'help', route: '/help' },
];

const DOCK: AppDef[] = [
  { id: 'settings', label: '设置', icon: 'settings', route: '/settings' },
];

/* 状态栏右侧的线性小图标。信号是装饰（网页拿不到真实信号强度）；
   WiFi 跟随 navigator.onLine；电量在支持 Battery API 的浏览器里显示真实值 */
const SIGNAL =
  '<svg viewBox="0 0 18 12" width="17" height="11" fill="currentColor" aria-hidden="true">' +
  '<rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/>' +
  '<rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>';

const WIFI =
  '<svg viewBox="0 0 16 12" width="15" height="11" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M1.2 4.3a10 10 0 0 1 13.6 0"/><path d="M3.8 7a6.2 6.2 0 0 1 8.4 0"/>' +
  '<circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/></svg>';

const BATTERY =
  '<svg viewBox="0 0 26 12" width="25" height="12" aria-hidden="true">' +
  '<rect x="0.6" y="0.6" width="21.8" height="10.8" rx="3" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5"/>' +
  '<rect x="24" y="4" width="1.6" height="4" rx=".8" fill="currentColor" opacity=".5"/>' +
  '<rect class="battery__level" x="2.2" y="2.2" width="18.6" height="7.6" rx="1.8" fill="currentColor"/></svg>';

interface BatteryLike extends EventTarget {
  level: number;
}

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
      <header class="statusbar" aria-hidden="true"${statusBarVisible() ? '' : ' hidden'}>
        <span class="statusbar__clock" id="clock">--:--</span>
        <span class="statusbar__icons">
          <span class="statusbar__signal">${SIGNAL}</span>
          <span class="statusbar__wifi" id="wifi">${WIFI}</span>
          <span class="statusbar__battery" id="battery">${BATTERY}</span>
        </span>
      </header>

      <main class="desktop__grid">
        ${GRID.map((a) => appButton(a)).join('')}
      </main>

      <footer class="desktop__dock">
        ${DOCK.map((a) => appButton(a, 'app--dock')).join('')}
      </footer>
    </div>`;

  const bar = root.querySelector<HTMLElement>('.statusbar');
  const clock = root.querySelector<HTMLElement>('#clock');
  const wifi = root.querySelector<HTMLElement>('#wifi');
  const level = root.querySelector<SVGRectElement>('.battery__level');

  const tick = (): void => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    paint(clock, `${hh}:${mm}`);
  };

  // 顶栏被关掉时连时钟一起停 —— 没必要为一个看不见的东西每秒跑一次
  let timer = 0;
  const syncBar = (): void => {
    const on = statusBarVisible();
    if (bar) bar.hidden = !on;
    if (on && timer === 0) {
      tick();
      timer = window.setInterval(tick, 1000);
    } else if (!on && timer !== 0) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
  syncBar();
  const offPrefs = onPrefsChanged(syncBar);

  const syncOnline = (): void => {
    wifi?.classList.toggle('is-off', !navigator.onLine);
  };
  syncOnline();
  addEventListener('online', syncOnline);
  addEventListener('offline', syncOnline);

  // Battery API 只有部分浏览器支持（Chrome 系有，Safari / Firefox 没有），不支持就保持满格
  let battery: BatteryLike | null = null;
  let disposed = false;
  const syncBattery = (): void => {
    if (battery && level) level.setAttribute('width', String(Math.max(1.5, 18.6 * battery.level)));
  };
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  nav.getBattery?.()
    .then((b) => {
      if (disposed) return;
      battery = b;
      syncBattery();
      b.addEventListener('levelchange', syncBattery);
    })
    .catch(() => {});

  // 切走时由 router 调用，把定时器和监听都收掉
  return () => {
    disposed = true;
    window.clearInterval(timer);
    offPrefs();
    removeEventListener('online', syncOnline);
    removeEventListener('offline', syncOnline);
    battery?.removeEventListener('levelchange', syncBattery);
  };
}
