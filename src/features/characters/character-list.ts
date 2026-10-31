import { listCharacters, putCharacter } from '../../core/db';
import type { Character } from '../../core/types';
import { esc, must } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { characterFromFile } from './card-import';
import { characterSummary, hasGreeting } from './shared';
import './characters.css';

/* ==========================================================================
   角色列表

   点一张卡进编辑页。以后导入角色卡（PNG / JSON）也从这个页面的「+」进。
   ========================================================================== */

function cardHTML(character: Character): string {
  const meta: string[] = [];
  if (hasGreeting(character)) meta.push('有开场白');
  if (character.spec !== 'manual') meta.push('导入的卡');

  return `
    <button class="char-card jelly" type="button" data-go="/character/${esc(character.id)}">
      ${avatarHTML(character.name || '未命名', 52)}
      <span class="char-card__text">
        <span class="char-card__name">${esc(character.name || '未命名')}</span>
        <span class="char-card__desc">${esc(characterSummary(character))}</span>
        ${meta.length > 0 ? `<span class="char-card__meta">${esc(meta.join(' · '))}</span>` : ''}
      </span>
      <span class="char-card__tail">${line('chevron', 18)}</span>
    </button>`;
}

const EMPTY = `
  <div class="empty">
    <p class="empty__title">还没有角色</p>
    <p class="empty__hint">点右上角的「+」手动创建，<br>或者等做完角色卡导入再直接把卡拖进来。</p>
  </div>`;

export async function mountCharacterList(root: HTMLElement): Promise<void> {
  const characters = await listCharacters();

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/desktop" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">角色</h1>
        <button class="topbar__action jelly" type="button" data-go="/character/new"
                aria-label="新建角色">${line('plus', 22)}</button>
      </header>

      <button class="card-import jelly" type="button" id="import-toggle">
        <span class="card-import__icon">${line('plus', 18)}</span>
        <span class="card-import__text">
          <span class="card-import__title">导入角色卡</span>
          <span class="card-import__sub">支持 PNG 卡和 JSON 卡，别人的卡直接能用</span>
        </span>
      </button>
      <input type="file" id="import-file" accept=".png,.json,image/png,application/json" hidden>
      <p class="field__note" id="import-note"></p>

      <div class="char-list">
        ${characters.length === 0 ? EMPTY : characters.map(cardHTML).join('')}
      </div>
    </div>`;

  /* ---------- 导入角色卡 ---------- */
  const fileInput = must<HTMLInputElement>(root, '#import-file');
  const note = must<HTMLElement>(root, '#import-note');

  must(root, '#import-toggle').addEventListener('click', () => {
    note.textContent = '';
    note.className = 'field__note';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void (async () => {
      note.textContent = '正在读取角色卡…';
      note.className = 'field__note';
      try {
        const character = await characterFromFile(file);
        await putCharacter(character);
        // 直接进编辑页，让用户先看一眼认出来的内容再决定要不要改
        location.hash = `/character/${character.id}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        note.textContent = `导入失败：${message}`;
        note.className = 'field__note is-bad';
      } finally {
        // 同一个文件再选一次也要能触发 change
        fileInput.value = '';
      }
    })();
  });

  // 从编辑页返回时路由会重新挂载这个页面，所以这里不需要额外监听
}
