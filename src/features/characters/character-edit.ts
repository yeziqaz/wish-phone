import { getCharacter, putCharacter } from '../../core/db';
import type { Character } from '../../core/types';
import { esc, find, must } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { blankCharacter } from './shared';
import './characters.css';

/* ==========================================================================
   角色编辑

   一页四个折叠卡片，高频在前：
     基本信息（名称、描述） → 人设（性格、场景） → 对话（开场白、示例） → 备注
   ========================================================================== */

export async function mountCharacterEdit(root: HTMLElement, id: string): Promise<void> {
  let character: Character;

  if (id === 'new') {
    character = blankCharacter();
  } else {
    const found = await getCharacter(id);
    if (!found) {
      root.innerHTML = `
        <div class="page">
          <header class="topbar">
            <button class="topbar__back jelly" type="button" data-go="/character" aria-label="返回">${line('back', 22)}</button>
            <h1 class="topbar__title">找不到</h1>
          </header>
          <p class="field__note">这个角色已经不在了，可能刚被删掉。</p>
        </div>`;
      return;
    }
    character = found;
  }

  const isNew = id === 'new';

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/character" aria-label="返回">${line('back', 22)}</button>
        <span id="c-avatar">${avatarHTML(character.name || '未命名', 34)}</span>
        <h1 class="topbar__title" id="c-title">${esc(character.name || '新角色')}</h1>
      </header>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="true">
          基本信息<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body">
          <label class="field">
            <span class="field__label">名字</span>
            <input class="input" id="c-name" type="text" autocomplete="off"
                   spellcheck="false" value="${esc(character.name)}" placeholder="角色的名字">
          </label>

          <label class="field">
            <span class="field__label">描述</span>
            <textarea class="input textarea" id="c-description" rows="5"
                      spellcheck="false"
                      placeholder="这个角色是谁。长相、身份、说话方式，写得越具体越像">${esc(character.description)}</textarea>
            <span class="field__hint">这一段会进提示词，是角色最重要的部分。</span>
          </label>
        </div>
      </section>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="false">
          人设<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body" hidden>
          <label class="field">
            <span class="field__label">性格</span>
            <textarea class="input textarea" id="c-personality" rows="4"
                      spellcheck="false"
                      placeholder="几个词或几句话概括">${esc(character.personality)}</textarea>
          </label>

          <label class="field">
            <span class="field__label">场景</span>
            <textarea class="input textarea" id="c-scenario" rows="3"
                      spellcheck="false"
                      placeholder="你们在哪儿、什么情况下遇见的">${esc(character.scenario)}</textarea>
          </label>
        </div>
      </section>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="false">
          对话<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body" hidden>
          <label class="field">
            <span class="field__label">开场白</span>
            <textarea class="input textarea" id="c-firstmes" rows="5"
                      spellcheck="false"
                      placeholder="第一次打开聊天时，角色说的第一句话">${esc(character.firstMes)}</textarea>
          </label>

          <label class="field">
            <span class="field__label">示例对话</span>
            <textarea class="input textarea" id="c-mesexample" rows="6"
                      spellcheck="false"
                      placeholder="给模型看的说话风格示范。不同例子之间用 &lt;START&gt; 隔开">${esc(character.mesExample)}</textarea>
            <span class="field__hint">可选。写几轮示范能明显改善说话口气。</span>
          </label>
        </div>
      </section>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="false">
          备注（不会发给模型）<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body" hidden>
          <label class="field">
            <span class="field__label">写给自己看的</span>
            <textarea class="input textarea" id="c-notes" rows="3"
                      spellcheck="false"
                      placeholder="比如这张卡哪来的、想怎么用">${esc(character.creatorNotes)}</textarea>
          </label>
        </div>
      </section>

      <div class="row-actions row-actions--main">
        <button class="btn btn--primary jelly" type="button" id="c-save">
          ${isNew ? '创建' : '保存'}
        </button>
      </div>
      <p class="field__note" id="c-save-result"></p>

      ${isNew ? '' : '<p class="page-foot">列表处左滑可删除角色</p>'}
    </div>`;

  /* ---------- 实时同步标题和头像 ---------- */
  const nameInput = must<HTMLInputElement>(root, '#c-name');
  const title = must<HTMLElement>(root, '#c-title');
  const avatarSlot = must<HTMLElement>(root, '#c-avatar');

  nameInput.addEventListener('input', () => {
    const value = nameInput.value.trim() || '未命名';
    title.textContent = value;
    avatarSlot.innerHTML = avatarHTML(value, 34);
  });

  /* ---------- 折叠卡片 ---------- */
  root.querySelectorAll<HTMLElement>('[data-fold]').forEach((head) => {
    head.addEventListener('click', () => {
      const expanded = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!expanded));
      const body = head.nextElementSibling;
      if (body instanceof HTMLElement) body.hidden = expanded;
    });
  });

  /* ---------- 保存 ---------- */
  const read = (selector: string): string =>
    find<HTMLTextAreaElement | HTMLInputElement>(root, selector)?.value ?? '';

  must(root, '#c-save').addEventListener('click', () => {
    void (async () => {
      const result = must<HTMLElement>(root, '#c-save-result');

      character.name = nameInput.value.trim();
      character.description = read('#c-description');
      character.personality = read('#c-personality');
      character.scenario = read('#c-scenario');
      character.firstMes = read('#c-firstmes');
      character.mesExample = read('#c-mesexample');
      character.creatorNotes = read('#c-notes');
      character.updatedAt = Date.now();

      if (!character.name) {
        result.textContent = '名字不能空着。';
        result.className = 'field__note is-bad';
        return;
      }

      try {
        await putCharacter(character);
        // 新建完直接进详情，免得用户以为没保存
        if (isNew) {
          location.hash = `/character/${character.id}`;
          return;
        }
        result.textContent = '已保存。';
        result.className = 'field__note is-ok';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.textContent = `保存失败：${message}`;
        result.className = 'field__note is-bad';
      }
    })();
  });
}
