import { clearAll, stats } from '../../core/db';
import { formatBytes, must } from '../../core/dom';
import { line } from '../../ui/icons';
import './settings.css';

/* ==========================================================================
   数据储存

   这一页回答三个问题：
     1. 现在存了多少东西
     2. 数据到底在哪（很多人以为是存在「我们服务器」上）
     3. 怎么把它清掉

   导出 / 导入排在任务单 T7，这一版先如实说明还没做。
   ========================================================================== */

function card(value: string, label: string): string {
  return `
    <div class="data-card">
      <div class="data-card__value">${value}</div>
      <div class="data-card__label">${label}</div>
    </div>`;
}

export async function mountDataStore(root: HTMLElement): Promise<void> {
  const s = await stats();

  root.innerHTML = `
    <div class="data-page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">数据储存</h1>
      </header>

      <div class="data-page__grid">
        ${card(String(s.characters), '角色')}
        ${card(String(s.conversations), '会话')}
        ${card(String(s.messages), '消息')}
        ${card(String(s.providers), '服务商')}
      </div>

      <p class="data-page__note">
        占用 <strong>${formatBytes(s.usageBytes)}</strong>。
        所有数据都存在<strong>这台设备的浏览器里</strong>，没有上传到任何服务器。
        换一台设备、或换一个浏览器，都看不到这里的数据。
      </p>

      <p class="data-page__note">
        <strong>导出与导入还没做</strong>，排在任务单 T7。
        那一步会把数据导出成文件存进你自己的手机，用来备份或换设备。
      </p>

      <div class="danger-zone">
        <h2 class="danger-zone__title">清空全部数据</h2>
        <p class="danger-zone__hint">
          会删掉所有角色、会话、消息和 API 配置。<strong>删了不能恢复。</strong>
          在下面输入「清空」两个字才能按下按钮。
        </p>
        <div class="confirm-row">
          <input class="input" id="wipe-word" type="text" autocomplete="off"
                 spellcheck="false" placeholder="清空">
          <button class="btn btn--danger jelly" type="button" id="wipe-btn" disabled>清空</button>
        </div>
        <p class="data-page__result" id="wipe-result"></p>
      </div>
    </div>`;

  const word = must<HTMLInputElement>(root, '#wipe-word');
  const button = must<HTMLButtonElement>(root, '#wipe-btn');
  const result = must<HTMLElement>(root, '#wipe-result');

  // 二次确认：必须手打「清空」，避免误触把数据全抹了
  word.addEventListener('input', () => {
    button.disabled = word.value.trim() !== '清空';
  });

  button.addEventListener('click', () => {
    void (async () => {
      try {
        await clearAll();
        word.value = '';
        button.disabled = true;
        result.textContent = '已清空。';
        result.className = 'data-page__result is-ok';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.textContent = `出错：${message}`;
        result.className = 'data-page__result is-bad';
      }
    })();
  });
}
