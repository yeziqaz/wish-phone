import { onPrefsChanged, statusBarVisible } from '../core/prefs';
import './statusbar.css';

/* ==========================================================================
   小手机自己的状态栏（灵动岛那条带子）

   —— 为什么它现在在 shell 里、而且是全局唯一的一条

   以前它藏在 desktop.ts 里：只有桌面那一屏有，一进聊天 APP 就没了，
   那条带子变成了各页面顶部自己的一点内边距，看着就不像「手机的一部分」。

   现在的做法：
     · 它是**盖在所有页面之上**的一层（position: fixed），永远在最上面，
       弹层、抽屉、美化面板都盖不住它 —— 它是外壳，不是页面内容
     · 高度由 design/tokens.css 的 --statusbar-h 统一给出，
       页面顶部也从这个值往下开始，两边对得上，不会出现「真状态栏下面
       又叠一条假状态栏」的两套时钟
     · 背景透明：底下是什么颜色（桌面灰、聊天 APP 蓝、聊天室白），
       它就显什么颜色，所以整块屏是一体的
     · 文字颜色跟着底下的亮度自动反色，浅底走墨色、深底走反白

   PWA 全屏（display: fullscreen）时，系统的状态栏整条被隐藏，
   这条带子就只属于小手机自己 —— 时钟和电量落在真机原来的位置上，
   看起来就是同一套状态栏。
   ========================================================================== */

/* 信号是装饰（网页拿不到真实信号强度）；
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
  '<rect class="osbar__level" x="2.2" y="2.2" width="18.6" height="7.6" rx="1.8" fill="currentColor"/></svg>';

interface BatteryLike extends EventTarget {
  level: number;
}

/** 只在文字真的变了才写 DOM —— 每秒写一次 textContent 会白白触发排版 */
function paint(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

/**
 * 挂上全局状态栏。只调用一次（main.ts）。
 * 返回的文件里不再需要清理函数 —— 它是外壳的一部分，活到页面关闭。
 */
export function mountStatusBar(): void {
  const el = document.createElement('div');
  el.className = 'osbar';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <span class="osbar__clock tabular" id="osbar-clock">--:--</span>
    <span class="osbar__icons">
      <span class="osbar__signal">${SIGNAL}</span>
      <span class="osbar__wifi" id="osbar-wifi">${WIFI}</span>
      <span class="osbar__battery" id="osbar-battery">${BATTERY}</span>
    </span>`;
  document.body.appendChild(el);

  const clock = el.querySelector<HTMLElement>('#osbar-clock');
  const wifi = el.querySelector<HTMLElement>('#osbar-wifi');
  const level = el.querySelector<SVGRectElement>('.osbar__level');

  const tick = (): void => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    paint(clock, `${hh}:${mm}`);
  };

  /* 顶栏被关掉时连时钟一起停 —— 没必要为一个看不见的东西每秒跑一次。
     同时把 --statusbar-h 收回到「只有安全区」，让页面能往上多吃一点。 */
  let timer = 0;
  const syncVisible = (): void => {
    const on = statusBarVisible();
    el.hidden = !on;
    document.documentElement.classList.toggle('no-osbar', !on);
    if (on && timer === 0) {
      tick();
      timer = window.setInterval(tick, 1000);
    } else if (!on && timer !== 0) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
  syncVisible();
  onPrefsChanged(syncVisible);

  const syncOnline = (): void => {
    wifi?.classList.toggle('is-off', !navigator.onLine);
  };
  syncOnline();
  addEventListener('online', syncOnline);
  addEventListener('offline', syncOnline);

  // Battery API 只有部分浏览器支持（Chrome 系有，Safari / Firefox 没有），不支持就保持满格
  const syncBattery = (battery: BatteryLike | null): void => {
    if (battery && level) {
      level.setAttribute('width', String(Math.max(1.5, 18.6 * battery.level)));
    }
  };
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  nav
    .getBattery?.()
    .then((battery) => {
      syncBattery(battery);
      battery.addEventListener('levelchange', () => syncBattery(battery));
    })
    .catch(() => {});
}
