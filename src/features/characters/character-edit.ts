import { getCharacter, getWorld, listBranches, putCharacter } from '../../core/db';
import { esc, find, must } from '../../core/dom';
import { ensureWorlds, resolveBranch } from '../../core/worlds';
import type { Character } from '../../core/types';
import { avatarImage } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { blankCharacter } from './shared';
import { pickPhoto } from './photo-crop';
import './characters.css';

/* ==========================================================================
   角色档案（编辑）

   版面顺序（用户 2026-10-31 定的）：
     拍立得照片 + 名字 / 关系
     → 基本信息 + 人物信息（合成一块）
     → 世界书（下一版）
     → 记忆（下一版）
     → 开场白（可多个 = IF 线）
     → 备注

   照片裁切在 photo-crop.ts 里，这里只管入口和显示。
   ========================================================================== */

function ratioCss(character: Character): string {
  const ratio = character.photoRatio ?? '1:1';
  return ratio.replace(':', ' / ');
}

function photoBoxHTML(character: Character): string {
  const src = avatarImage(character.avatarKey);
  return `
    <span class="polaroid__frame" style="--photo-ratio:${ratioCss(character)}">
      ${
        src
          ? `<img class="polaroid__img" src="${esc(src)}" alt="">`
          : `<span class="polaroid__empty">${line('image', 22)}<span>放一张照片</span></span>`
      }
    </span>`;
}

function openingRowHTML(value: string, index: number): string {
  return `
    <div class="opening" data-opening-row>
      <div class="opening__head">
        <span class="opening__label">开场白 ${index + 1}</span>
        <button class="opening__del" type="button" data-remove-opening
                aria-label="删除这个开场白">${line('trash', 16)}</button>
      </div>
      <textarea class="input textarea" data-opening rows="4"
                placeholder="第一次聊天时，从这句话或这个场景开始">${esc(value)}</textarea>
    </div>`;
}

function collectOpenings(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLTextAreaElement>('[data-opening]')]
    .map((area) => area.value)
    .filter((value) => value.trim().length > 0);
}

export async function mountCharacterEdit(root: HTMLElement, id: string): Promise<void> {
  let character: Character;

  if (id === 'new') {
    character = blankCharacter();
    // 新角色落在当前小世界 + 当前时间线
    const world = await ensureWorlds();
    const branch = await resolveBranch(world);
    character.worldId = world.id;
    character.branchId = branch?.id;
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
  const world = character.worldId ? await getWorld(character.worldId) : undefined;
  const branches = world ? await listBranches(world.id) : [];
  const branch = branches.find((b) => b.id === character.branchId);

  const openings =
    [character.firstMes, ...character.alternateGreetings].filter((text) => text.trim().length > 0);
  const openingRows = openings.length > 0 ? openings : [''];

  const shortId = character.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  const worldLine = world
    ? `${esc(world.name)}${branch ? ` · ${esc(branch.name)}` : ''}`
    : '小世界1 · 主线';

  root.innerHTML = `
    <div class="page page--dossier">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/character"
                aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">角色档案</h1>
      </header>

      <section class="dossier">
        <div class="dossier__photo">
          <button class="polaroid" type="button" id="c-photo" aria-label="选择照片">
            ${photoBoxHTML(character)}
          </button>
          <p class="polaroid__hint">点照片换 / 裁</p>
        </div>

        <div class="dossier__info">
          <p class="dossier__id">CHAR-${shortId}</p>
          <h2 class="dossier__name" id="c-title">${esc(character.name || '未命名')}</h2>
          <p class="dossier__relation" id="c-relation-line">
            ${esc(character.relationToUser?.trim() || '还没写和你的关系')}
          </p>
          <p class="dossier__world">${worldLine}</p>
          ${world ? `<button class="dossier__link" type="button" data-go="/world/${esc(world.id)}">小世界设定</button>` : ''}
        </div>
      </section>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="true">
          基本信息<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body">
          <label class="field">
            <span class="field__label">姓名</span>
            <input class="input" id="c-name" type="text" autocomplete="off"
                   spellcheck="false" value="${esc(character.name)}" placeholder="角色叫什么">
          </label>

          <div class="field-row">
            <label class="field">
              <span class="field__label">昵称</span>
              <input class="input" id="c-nickname" type="text" autocomplete="off"
                     spellcheck="false" value="${esc(character.nickname ?? '')}" placeholder="小名 / 外号">
            </label>
            <label class="field">
              <span class="field__label">和我的关系</span>
              <input class="input" id="c-relation" type="text" autocomplete="off"
                     spellcheck="false" value="${esc(character.relationToUser ?? '')}"
                     placeholder="男朋友 / 哥哥 / 同事">
            </label>
          </div>

          <label class="field">
            <span class="field__label">人物信息</span>
            <textarea class="input textarea" id="c-description" rows="6"
                      spellcheck="false"
                      placeholder="长什么样、什么身份、经历过什么。写得越具体越像">${esc(character.description)}</textarea>
            <span class="field__hint">这段会进提示词，是角色最重要的部分。</span>
          </label>

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
        <button class="fold__head" type="button" data-fold aria-expanded="true">
          开场白<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body">
          <p class="field__hint">
            不写也行。写多个就是从不同情景开始，像 IF 线。
          </p>
          <div class="opening-list" id="c-openings">
            ${openingRows.map((text, index) => openingRowHTML(text, index)).join('')}
          </div>
          <button class="btn" type="button" id="c-add-opening">＋ 加一个开场白</button>

          <label class="field opening__example">
            <span class="field__label">示例对话</span>
            <textarea class="input textarea" id="c-mesexample" rows="5"
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
    </div>`;

  /* ---------- 照片 ---------- */
  const photoButton = must<HTMLElement>(root, '#c-photo');
  photoButton.addEventListener('click', () => {
    void (async () => {
      const result = await pickPhoto();
      if (!result) return;
      character.avatarKey = result.dataUrl;
      character.photoRatio = result.ratio;
      photoButton.innerHTML = photoBoxHTML(character);
    })();
  });

  /* ---------- 实时同步名字和关系 ---------- */
  const nameInput = must<HTMLInputElement>(root, '#c-name');
  const relationInput = must<HTMLInputElement>(root, '#c-relation');

  nameInput.addEventListener('input', () => {
    must<HTMLElement>(root, '#c-title').textContent = nameInput.value.trim() || '未命名';
  });

  relationInput.addEventListener('input', () => {
    must<HTMLElement>(root, '#c-relation-line').textContent =
      relationInput.value.trim() || '还没写和你的关系';
  });

  /* ---------- 开场白：加 / 删 / 重新编号 ---------- */
  const openingList = must<HTMLElement>(root, '#c-openings');

  const renumber = (): void => {
    openingList.querySelectorAll<HTMLElement>('[data-opening-row]').forEach((row, index) => {
      const label = row.querySelector<HTMLElement>('.opening__label');
      if (label) label.textContent = `开场白 ${index + 1}`;
    });
  };

  openingList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-opening]');
    if (!button) return;
    const row = button.closest<HTMLElement>('[data-opening-row]');
    if (!row) return;
    row.remove();
    // 全删光时留一个空行，不然界面会突然空掉
    if (openingList.querySelectorAll('[data-opening-row]').length === 0) {
      openingList.innerHTML = openingRowHTML('', 0);
    }
    renumber();
  });

  must(root, '#c-add-opening').addEventListener('click', () => {
    const count = openingList.querySelectorAll('[data-opening-row]').length;
    openingList.insertAdjacentHTML('beforeend', openingRowHTML('', count));
    const added = openingList.lastElementChild?.querySelector<HTMLTextAreaElement>('[data-opening]');
    added?.focus();
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

      const name = nameInput.value.trim();
      if (!name) {
        result.textContent = '名字不能空着。';
        result.className = 'field__note is-bad';
        return;
      }

      const openingValues = collectOpenings(root);

      character.name = name;
      character.nickname = read('#c-nickname').trim();
      character.relationToUser = relationInput.value.trim();
      character.description = read('#c-description');
      character.personality = read('#c-personality');
      character.scenario = read('#c-scenario');
      character.firstMes = openingValues[0] ?? '';
      character.alternateGreetings = openingValues.slice(1);
      character.mesExample = read('#c-mesexample');
      character.creatorNotes = read('#c-notes');
      character.updatedAt = Date.now();

      try {
        await putCharacter(character);
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
