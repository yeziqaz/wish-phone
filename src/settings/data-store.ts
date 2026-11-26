import { clearAll, createBackup, restoreBackup, stats } from '../core/db';
import { backupFileName, backupSummary, parseBackup } from '../core/backup';
import type { BackupFile } from '../core/backup';
import { formatBytes, must, setText } from '../core/dom';
import { line } from '../ui/icons';
import './settings.css';

/* ==========================================================================
   数据储存

   这一页回答三个问题：
     1. 现在存了多少东西
     2. 数据到底在哪（很多人以为是存在「我们服务器」上）
     3. 怎么把它带走 / 怎么清掉

   导出 = 把 12 张表全读出来，写成一个 .json 文件交给浏览器下载。
   导入 = 读文件、校验、二次确认，然后在一个事务里覆盖整个库。
   ========================================================================== */

function card(id: string, value: string, label: string): string {
  return `
    <div class="data-card">
      <div class="data-card__value tabular" id="${id}">${value}</div>
      <div class="data-card__label">${label}</div>
    </div>`;
}

/** 把一段文字存成文件，交给浏览器下载 */
function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 有些浏览器会把下载掐断，挪到下一轮事件循环
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        ${card('stat-characters', String(s.characters), '角色')}
        ${card('stat-conversations', String(s.conversations), '会话')}
        ${card('stat-messages', String(s.messages), '消息')}
        ${card('stat-providers', String(s.providers), '服务商')}
      </div>

      <p class="data-page__note">
        占用 <strong>${formatBytes(s.usageBytes)}</strong>。
        所有数据都存在<strong>这台设备的浏览器里</strong>，没有上传到任何服务器。
        换一台设备、或换一个浏览器，都看不到这里的数据。
      </p>

      <div class="row-actions row-actions--main">
        <button class="btn btn--primary jelly" type="button" id="export-btn">
          ${line('data', 18)} 导出备份
        </button>
        <button class="btn btn--secondary jelly" type="button" id="import-btn">
          ${line('import', 18)} 导入备份
        </button>
      </div>
      <input type="file" id="import-file" accept=".json,application/json" hidden>

      <p class="data-page__note">
        备份文件里<strong>包含你的 API Key</strong>（不然换设备后不能用）。
        自己留着可以，<strong>别发给别人</strong>。
      </p>

      <div class="confirm-row" id="import-confirm" hidden>
        <p class="data-page__note" id="import-summary"></p>
      </div>
      <div class="confirm-row" id="import-confirm-actions" hidden>
        <button class="btn jelly" type="button" id="import-cancel">取消</button>
        <button class="btn btn--danger jelly" type="button" id="import-do">覆盖导入</button>
      </div>

      <p class="data-page__result" id="backup-result"></p>

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

  const exportButton = must<HTMLButtonElement>(root, '#export-btn');
  const importButton = must<HTMLButtonElement>(root, '#import-btn');
  const fileInput = must<HTMLInputElement>(root, '#import-file');
  const confirmBox = must<HTMLElement>(root, '#import-confirm');
  const confirmActions = must<HTMLElement>(root, '#import-confirm-actions');
  const summary = must<HTMLElement>(root, '#import-summary');
  const cancelButton = must<HTMLButtonElement>(root, '#import-cancel');
  const doButton = must<HTMLButtonElement>(root, '#import-do');
  const backupResult = must<HTMLElement>(root, '#backup-result');

  const word = must<HTMLInputElement>(root, '#wipe-word');
  const wipeButton = must<HTMLButtonElement>(root, '#wipe-btn');
  const wipeResult = must<HTMLElement>(root, '#wipe-result');

  /** 一次待确认的导入 */
  let pending: BackupFile | null = null;

  const showResult = (text: string, ok: boolean): void => {
    backupResult.textContent = text;
    backupResult.className = `data-page__result ${ok ? 'is-ok' : 'is-bad'}`;
  };

  const hideConfirm = (): void => {
    pending = null;
    confirmBox.hidden = true;
    confirmActions.hidden = true;
    summary.textContent = '';
  };

  /** 导入完刷新上面四张卡，不重绘整页 */
  const refreshCards = async (): Promise<void> => {
    const next = await stats();
    setText(must<HTMLElement>(root, '#stat-characters'), String(next.characters));
    setText(must<HTMLElement>(root, '#stat-conversations'), String(next.conversations));
    setText(must<HTMLElement>(root, '#stat-messages'), String(next.messages));
    setText(must<HTMLElement>(root, '#stat-providers'), String(next.providers));
  };

  exportButton.addEventListener('click', () => {
    void (async () => {
      exportButton.disabled = true;
      try {
        const file = await createBackup();
        downloadText(backupFileName(), JSON.stringify(file, null, 2));
        showResult(`已导出：${backupSummary(file)}`, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showResult(`导出出错：${message}`, false);
      } finally {
        exportButton.disabled = false;
      }
    })();
  });

  importButton.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    void (async () => {
      const picked = fileInput.files?.[0];
      // 清空 value，这样同一个文件连选两次也会触发 change
      fileInput.value = '';
      if (!picked) return;
      try {
        const text = await picked.text();
        const file = parseBackup(text);
        pending = file;
        summary.textContent = `这份备份里有：${backupSummary(file)}。导入会覆盖现有全部数据，确定？`;
        confirmBox.hidden = false;
        confirmActions.hidden = false;
        backupResult.textContent = '';
        backupResult.className = 'data-page__result';
      } catch (error) {
        hideConfirm();
        const message = error instanceof Error ? error.message : String(error);
        showResult(message, false);
      }
    })();
  });

  cancelButton.addEventListener('click', () => {
    hideConfirm();
    showResult('已取消导入。', false);
  });

  doButton.addEventListener('click', () => {
    void (async () => {
      const file = pending;
      if (!file) return;
      doButton.disabled = true;
      cancelButton.disabled = true;
      try {
        await restoreBackup(file);
        hideConfirm();
        await refreshCards();
        showResult(`已导入：${backupSummary(file)}`, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showResult(`导入出错：${message}`, false);
      } finally {
        doButton.disabled = false;
        cancelButton.disabled = false;
      }
    })();
  });

  // 二次确认：必须手打「清空」，避免误触把数据全抹了
  word.addEventListener('input', () => {
    wipeButton.disabled = word.value.trim() !== '清空';
  });

  wipeButton.addEventListener('click', () => {
    void (async () => {
      try {
        await clearAll();
        word.value = '';
        wipeButton.disabled = true;
        await refreshCards();
        wipeResult.textContent = '已清空。';
        wipeResult.className = 'data-page__result is-ok';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        wipeResult.textContent = `出错：${message}`;
        wipeResult.className = 'data-page__result is-bad';
      }
    })();
  });
}
