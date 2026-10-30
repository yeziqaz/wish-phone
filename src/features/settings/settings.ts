import { listProviders, stats } from '../../core/db';
import type { StorageStats } from '../../core/db';
import { formatBytes, must } from '../../core/dom';
import { setStatusBarVisible, statusBarVisible } from '../../core/prefs';
import { line } from '../../ui/icons';
import './settings.css';

/* ==========================================================================
   设置 —— 这是「目录」，不是表单堆。

   见 AGENTS.md §3.7：以后每加一个功能，先问它属于哪一类：
     重（要多步操作）→ 进子页面
     轻（就一个开关）→ 就地一行

   所以这个文件永远只应该长成一张清单的样子。
   ========================================================================== */

/** 顶部状态栏的开关存在 core/prefs.ts 里，桌面和这里共用同一个来源 */

function providerSummary(count: number): string {
  if (count === 0) return '还没有添加';
  return `${count} 个服务商`;
}

function dataSummary(storage: StorageStats): string {
  const total = storage.characters + storage.conversations + storage.messages;
  if (total === 0) return '还没有数据';
  return `${total} 条记录 · 占用 ${formatBytes(storage.usageBytes)}`;
}

export async function mountSettings(root: HTMLElement): Promise<void> {
  const [providers, storage] = await Promise.all([listProviders(), stats()]);
  const barOn = statusBarVisible();

  root.innerHTML = `
    <div class="settings">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/desktop" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">设置</h1>
      </header>

      <div class="nav-group">
        <button class="nav-item" type="button" data-go="/settings/providers">
          <span class="nav-item__icon">${line('provider')}</span>
          <span class="nav-item__text">
            <span class="nav-item__title">API 服务商</span>
            <span class="nav-item__sub">${providerSummary(providers.length)}</span>
          </span>
          <span class="nav-item__tail">${line('chevron', 18)}</span>
        </button>

        <button class="nav-item" type="button" data-go="/settings/data">
          <span class="nav-item__icon">${line('data')}</span>
          <span class="nav-item__text">
            <span class="nav-item__title">数据储存</span>
            <span class="nav-item__sub">${dataSummary(storage)}</span>
          </span>
          <span class="nav-item__tail">${line('chevron', 18)}</span>
        </button>
      </div>

      <div class="nav-group">
        <label class="nav-item">
          <span class="nav-item__icon">${line('statusbar')}</span>
          <span class="nav-item__text">
            <span class="nav-item__title">顶部状态栏</span>
            <span class="nav-item__sub">桌面顶部显示时间、信号与电量</span>
          </span>
          <span class="nav-item__tail">
            <span class="switch">
              <input type="checkbox" id="set-statusbar" ${barOn ? 'checked' : ''}>
              <span class="switch__track"></span>
            </span>
          </span>
        </label>
      </div>

      <p class="settings__foot">愿望机 · 纯前端，没有服务器，数据只存在这台设备上</p>
    </div>`;

  must<HTMLInputElement>(root, '#set-statusbar').addEventListener('change', (e) => {
    // 存下来并广播 —— 如果桌面正开着，它会立刻跟着变
    setStatusBarVisible((e.target as HTMLInputElement).checked);
  });
}
