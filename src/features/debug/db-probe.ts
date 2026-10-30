import { deleteCharacter, getCharacter, listCharacters, putCharacter, stats } from '../../core/db';
import type { Character } from '../../core/types';
import './db-probe.css';

/* ==========================================================================
   存储自检（临时）

   目的只有一个：让 T3「数据能存住」这件事**能在手机上肉眼验证**。
   它只在开发模式（npm run dev）下被加载，正式构建里根本不存在这份代码。

   ⚠️ T4 做完设置页后删掉这个文件，以及 main.ts 里那三行引用。
   ========================================================================== */

/** 固定 id：反复写入不会堆垃圾，清除时也只删这一条 */
const PROBE_ID = '__probe__';

function timeText(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** 造一条结构完整的测试角色，字段和真实角色卡走同一套 */
function makeProbe(): Character {
  const now = Date.now();
  return {
    id: PROBE_ID,
    createdAt: now,
    updatedAt: now,
    spec: 'manual',
    source: 'manual',
    name: `自检角色 ${timeText(now)}`,
    description: '这条数据是用来验证「关掉页面再打开还在不在」的。',
    personality: '',
    scenario: '',
    firstMes: '你好，我是自检角色。',
    alternateGreetings: [],
    mesExample: '',
    raw: { name: '自检角色', spec: 'manual', note: '这条 raw 是用来验证原始 JSON 能被原样保留的' },
    systemPrompt: '',
    postHistoryInstructions: '',
    creatorNotes: '',
    tags: ['自检'],
    creator: 'wish-phone',
    characterVersion: '1',
    extensions: {},
  };
}

export function mountDbProbe(): () => void {
  const el = document.createElement('div');
  el.className = 'dbg';
  el.innerHTML = `
    <div class="dbg__head">
      <span class="dbg__title">存储自检</span>
      <button class="dbg__close" type="button" aria-label="收起">×</button>
    </div>
    <div class="dbg__row">
      <button class="btn dbg__btn" type="button" data-act="write">写入</button>
      <button class="btn dbg__btn" type="button" data-act="read">读取</button>
      <button class="btn dbg__btn" type="button" data-act="stats">统计</button>
      <button class="btn dbg__btn" type="button" data-act="wipe">清除</button>
    </div>
    <p class="dbg__out">点「写入」→ 刷新页面 → 点「读取」。数据还在就说明存住了。</p>`;

  document.body.appendChild(el);

  const out = el.querySelector<HTMLElement>('.dbg__out');

  const say = (text: string, ok?: boolean): void => {
    if (!out) return;
    out.textContent = text;
    out.classList.toggle('is-ok', ok === true);
    out.classList.toggle('is-bad', ok === false);
  };

  const run = async (act: string): Promise<void> => {
    try {
      if (act === 'write') {
        const character = makeProbe();
        await putCharacter(character);
        say(`已写入「${character.name}」。现在刷新页面，再点「读取」。`);
        return;
      }

      if (act === 'read') {
        const all = await listCharacters();
        const probe = await getCharacter(PROBE_ID);
        if (probe) {
          say(`共 ${all.length} 个角色。自检角色还在，写入于 ${timeText(probe.createdAt)} —— 数据存住了 ✓`, true);
        } else {
          say(`共 ${all.length} 个角色，但没找到自检角色。先点「写入」，刷新后再点「读取」。`, false);
        }
        return;
      }

      if (act === 'stats') {
        const s = await stats();
        const size =
          s.usageBytes === null ? '未知' : `${(s.usageBytes / 1024).toFixed(1)} KB`;
        say(`角色 ${s.characters} · 会话 ${s.conversations} · 消息 ${s.messages} · 设置 ${s.settings} · 占用 ${size}`);
        return;
      }

      if (act === 'wipe') {
        await deleteCharacter(PROBE_ID);
        say('自检角色已清除。');
      }
    } catch (error) {
      // 报错要看得懂，不能只丢一个 "UnknownError"
      const message = error instanceof Error ? error.message : String(error);
      say(`出错：${message}`, false);
    }
  };

  const onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest('.dbg__close')) {
      el.remove();
      return;
    }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) void run(act);
  };

  el.addEventListener('click', onClick);

  return () => el.remove();
}
