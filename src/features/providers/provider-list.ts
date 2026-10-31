import { deleteProviderRecord, listProviders, putProvider } from '../../core/db';
import type { Provider } from '../../core/types';
import { esc, must } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { PROTOCOL_LABEL, fromParsed, setPendingParse } from './shared';
import { parseProvidersText } from './smart-parse';
import type { ParsedProvider } from './smart-parse';
import './providers.css';

/* ==========================================================================
   服务商列表

   顶部那个「智能添加」是这个页面的核心 —— 用户把站子给的一整段信息
   粘进来，我们自动认出地址、密钥和模型，省掉手动对着抄。
   ========================================================================== */

function itemHTML(provider: Provider): string {
  const count = provider.models.length;
  const sub = `${PROTOCOL_LABEL[provider.protocol]} · ${
    count > 0 ? `${count} 个模型` : '还没有模型'
  }`;
  return `
    <div class="swipe" data-row="${esc(provider.id)}">
      <div class="swipe__actions">
        <button class="swipe__delete" type="button" data-delete="${esc(provider.id)}">删除</button>
      </div>
      <button class="nav-item${provider.enabled ? '' : ' is-off'}" type="button"
              data-go="/settings/providers/${esc(provider.id)}">
        ${avatarHTML(provider.name, 40)}
        <span class="nav-item__text">
          <span class="nav-item__title">${esc(provider.name)}</span>
          <span class="nav-item__sub">${esc(sub)}</span>
        </span>
        <span class="nav-item__tail">${line('chevron', 18)}</span>
      </button>
    </div>`;
}

const EMPTY = `
  <div class="empty">
    <p class="empty__title">还没有服务商</p>
    <p class="empty__hint">点右上角的「+」手动添加，<br>或者用上面的「智能添加」粘贴一段信息。</p>
  </div>`;

export async function mountProviderList(root: HTMLElement): Promise<void> {
  const providers = await listProviders();

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">API 服务商</h1>
        <button class="topbar__action jelly" type="button" data-go="/settings/providers/new"
                aria-label="手动新建">${line('plus', 22)}</button>
      </header>

      <button class="smart-add jelly" type="button" id="smart-toggle">
        <span class="smart-add__wand">${line('wand', 20)}</span>
        <span class="smart-add__text">
          <span class="smart-add__title">智能添加</span>
          <span class="smart-add__sub">粘贴站子给的一整段信息，自动认出地址、密钥和模型</span>
        </span>
      </button>

      <div class="smart-panel" id="smart-panel" hidden>
        <textarea class="input smart-panel__area" id="smart-text" rows="7"
                  spellcheck="false" autocomplete="off"
                  placeholder="站名&#10;https://api.example.com/v1&#10;key1:sk-xxxxxxxxxxxx&#10;&#10;（空一行可以接着写下一个站子）"></textarea>
        <div class="smart-panel__actions">
          <button class="btn jelly" type="button" id="smart-cancel">取消</button>
          <button class="btn btn--primary jelly" type="button" id="smart-run">识别</button>
        </div>
        <div class="smart-result" id="smart-result" hidden></div>
        <p class="smart-panel__note" id="smart-note">
          识别全程在本地完成，粘进来的内容不会发到任何地方。
        </p>
      </div>

      <div class="nav-group">
        ${providers.length === 0 ? EMPTY : providers.map(itemHTML).join('')}
      </div>
    </div>`;

  const panel = must<HTMLElement>(root, '#smart-panel');
  const textarea = must<HTMLTextAreaElement>(root, '#smart-text');
  const note = must<HTMLElement>(root, '#smart-note');
  const result = must<HTMLElement>(root, '#smart-result');


  /* ========================================================================
     侧滑删除

     手指在列表项上向左滑，右侧露出「删除」。点一下删除键不会马上删，
     按钮会变成「确认」——再点一次才真的删掉（不可逆操作必须二次确认）。
     同一时间只允许一行是打开的。
     ======================================================================== */

  const SWIPE_W = 88;
  const group = must<HTMLElement>(root, '.nav-group');
  let openRow: HTMLElement | null = null;
  let armed: HTMLElement | null = null; // 已经点过一次「确认」的那一行
  let armedTimer = 0;

  /** 把「确认」状态退回「删除」 */
  const disarm = (): void => {
    window.clearTimeout(armedTimer);
    if (armed) {
      const button = armed.querySelector<HTMLElement>('[data-delete]');
      if (button) button.textContent = '删除';
    }
    armed = null;
  };

  const contentOf = (row: HTMLElement | null): HTMLElement | null =>
    row?.querySelector<HTMLElement>('.nav-item') ?? null;

  const setShift = (row: HTMLElement, px: number, animate: boolean): void => {
    const content = contentOf(row);
    if (!content) return;
    content.style.transition = animate ? '' : 'none';
    content.style.transform = px === 0 ? '' : `translateX(${px}px)`;
  };

  const closeRow = (): void => {
    if (openRow) {
      setShift(openRow, 0, true);
      openRow = null;
    }
    disarm();
  };

  const openRowNow = (row: HTMLElement): void => {
    if (openRow && openRow !== row) closeRow();
    openRow = row;
    setShift(row, -SWIPE_W, true);
  };

  let startX = 0;
  let startY = 0;
  let tracking: HTMLElement | null = null;
  let horizontal = false;
  let baseX = 0;
  // 手指按在「已经滑开的那一行」上，抬手后那一下 click 不该导航
  let suppressNav = false;

  group.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-delete]')) return;
    const nav = target.closest<HTMLElement>('.nav-item');
    const row = nav?.closest<HTMLElement>('.swipe');
    if (!row || !nav) return;

    suppressNav = openRow === row;
    tracking = row;
    startX = e.clientX;
    startY = e.clientY;
    baseX = openRow === row ? -SWIPE_W : 0;
    horizontal = false;
  });

  group.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!horizontal) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // 以竖向为主：交给页面滚动，不抢手势
      if (Math.abs(dy) > Math.abs(dx)) {
        tracking = null;
        return;
      }
      horizontal = true;
    }

    setShift(tracking, Math.min(0, Math.max(-SWIPE_W, baseX + dx)), false);
  });

  const endSwipe = (e: PointerEvent): void => {
    if (!tracking) return;
    const row = tracking;
    tracking = null;

    if (!horizontal) {
      // 没滑动就是普通点击：如果这一行正开着，点一下关掉
      if (openRow === row) {
        closeRow();
        return;
      }
      suppressNav = false;
      return;
    }

    const dx = e.clientX - startX;
    const wasOpen = baseX < 0;
    // 滑过半程就翻面，否则回到原样
    const shouldOpen = wasOpen ? dx < SWIPE_W / 2 : dx < -SWIPE_W / 2;
    if (shouldOpen) openRowNow(row);
    else closeRow();
  };

  group.addEventListener('pointerup', endSwipe);
  group.addEventListener('pointercancel', () => {
    if (!tracking) return;
    const row = tracking;
    tracking = null;
    horizontal = false;
    if (openRow === row) openRowNow(row);
    else closeRow();
  });

  group.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement;

      const del = target.closest<HTMLElement>('[data-delete]');
      if (del) {
        const row = del.closest<HTMLElement>('.swipe');
        const id = del.dataset.delete ?? '';
        if (!row || !id) return;
        if (armed !== row) {
          // 第一次点：换成「确认」，3 秒不作数就变回去
          disarm();
          armed = row;
          del.textContent = '确认';
          armedTimer = window.setTimeout(disarm, 3000);
          return;
        }
        void (async () => {
          disarm();
          closeRow();
          await deleteProviderRecord(id);
          await refreshList();
        })();
        return;
      }

      if (!target.closest('.nav-item')) return;
      // 刚才那一下是滑动，或者是点「开着的行 / 别的行」想收起来 —— 都不该导航
      if (horizontal || suppressNav || openRow) {
        if (openRow) closeRow();
        horizontal = false;
        suppressNav = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  // 点页面别处收起
  root.addEventListener('pointerdown', (e) => {
    if (!openRow) return;
    if ((e.target as HTMLElement).closest('.swipe')) return;
    closeRow();
  });

  must(root, '#smart-toggle').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) textarea.focus();
  });

  /** 重新渲染下面的列表。不靠 location.hash —— 已经在列表页时同一个 hash 不会触发跳转 */
  const refreshList = async (): Promise<void> => {
    const providers = await listProviders();
    const group = root.querySelector<HTMLElement>('.nav-group');
    if (group) {
      group.innerHTML = providers.length === 0 ? EMPTY : providers.map(itemHTML).join('');
    }
  };

  const resetNote = (): void => {
    note.textContent = '识别全程在本地完成，粘进来的内容不会发到任何地方。';
    note.className = 'smart-panel__note';
  };

  must(root, '#smart-cancel').addEventListener('click', () => {
    panel.hidden = true;
    textarea.value = '';
    result.hidden = true;
    result.innerHTML = '';
    resetNote();
  });

  /** 把认出来的东西按「站名 / 地址 / 密钥」摆出来，让用户先看一眼 */
  const showResult = (list: ParsedProvider[]): void => {
    const row = (label: string, value: string): string =>
      `<div class="smart-result__row">
         <span class="smart-result__label">${label}</span>
         <span class="smart-result__value">${esc(value)}</span>
       </div>`;

    const keyText = (count: number): string =>
      count === 0 ? '没认出来' : count === 1 ? '1 个' : `${count} 个`;

    if (list.length === 1 && list[0]) {
      const one = list[0];
      result.innerHTML = `
        ${row('站名', one.name || '没认出来')}
        ${row('地址', one.baseUrl || '没认出来')}
        ${row('密钥', keyText(one.apiKeys.length))}
        <button class="btn btn--primary jelly smart-result__go" type="button" id="smart-go">
          用这些信息新建
        </button>`;
    } else {
      // 一次认出好几个站子：逐个列出来，一起导入
      result.innerHTML = `
        <p class="smart-result__title">认出 ${list.length} 个站子</p>
        ${list
          .map(
            (one, index) => `
          <div class="smart-result__card">
            <span class="smart-result__index">${index + 1}</span>
            <div class="smart-result__lines">
              <span class="smart-result__name">${esc(one.name || '未命名')}</span>
              <span class="smart-result__url">${esc(one.baseUrl || '没有地址')}</span>
              <span class="smart-result__keys">${keyText(one.apiKeys.length)}密钥</span>
            </div>
          </div>`,
          )
          .join('')}
        <button class="btn btn--primary jelly smart-result__go" type="button" id="smart-go">
          全部导入（${list.length} 个）
        </button>`;
    }

    result.hidden = false;

    // 结果出来之后，导入按钮才是唯一的主行动
    root.querySelector('#smart-run')?.classList.remove('btn--primary');

    must(root, '#smart-go').addEventListener('click', () => {
      void (async () => {
        if (list.length === 1) {
          setPendingParse(list);
          location.hash = '/settings/providers/new';
          return;
        }
        // 多个站子：直接一起建好，不用一个个进详情页
        const button = root.querySelector<HTMLButtonElement>('#smart-go');
        if (button) button.disabled = true;
        try {
          for (const one of list) {
            await putProvider(fromParsed(one));
          }
          await refreshList();

          // 收工：收起面板、清空输入，别让用户以为还能再点一次
          textarea.value = '';
          result.hidden = true;
          result.innerHTML = '';
          panel.hidden = true;
          resetNote();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          note.textContent = `导入失败：${message}`;
          note.className = 'smart-panel__note is-bad';
          if (button) button.disabled = false;
        }
      })();
    });
  };

  must(root, '#smart-run').addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) {
      note.textContent = '先把内容粘进来。';
      note.className = 'smart-panel__note is-bad';
      return;
    }

    const list = parseProvidersText(text);

    // 一个字段都没认出来就别往下了，省得用户白跑一趟
    const first = list[0];
    if (!first || (!first.baseUrl && first.apiKeys.length === 0)) {
      result.hidden = true;
      root.querySelector('#smart-run')?.classList.add('btn--primary');
      note.textContent = '没能认出地址或密钥，请点右上角「+」手动填写。';
      note.className = 'smart-panel__note is-bad';
      return;
    }


    resetNote();
    showResult(list);
  });
}
