# AGENTS.md · 愿望机 项目宪法

> 本文件是本仓库的**最高约束**。每次改代码前先读。
> 与用户当次指令冲突时，以用户指令为准，但**必须当场指出冲突**并说明后果。

---

## 0. 这个项目是什么

**愿望机（WishPhone）** 是一个免费开源、**纯前端零后端**的 AI 小手机。

- 用户自己填自己的 OpenAI 兼容 API（地址 / Key / 模型）—— **我们没有服务器**
- 所有数据存在用户设备的 IndexedDB 里
- 一份 Vite 静态产物，同时支撑三条发布线：静态站点（Vercel / Netlify / GitHub Pages）、PWA、Capacitor 套壳 APK
- 视觉基调：**黑白灰 + 描边线框**

---

## 1. 技术栈（不许擅自更换）

| 层 | 选型 | 备注 |
|---|---|---|
| 构建 | Vite + TypeScript | 产物必须是纯静态 |
| UI | **原生 DOM / CSS** | 不引框架 |
| 存储 | IndexedDB，封装用 `idb` | ~3.4KB gzip，换取类型安全 |
| 状态 | 手写 store（约 40 行） | 见宪法 §2 |
| 路由 | **hash 路由** | GitHub Pages 零配置；Capacitor 自定义 scheme 改不了 URL 路径 |
| 打包 | Capacitor 8（Android） | `server.androidScheme` 保持默认 `https` |
| 图标 | **内联 SVG**（Lucide，ISC） | 按需复制进 `src/ui/icons/` |

**明确禁止引入**（除非用户明确要求并说明理由）：
React / Vue / Svelte / Angular、Tailwind、Dexie、axios、任何 UI 组件库、任何**字体图标包**、任何分析/统计 SDK、任何远程字体 CDN、任何第三方运行时依赖。

> 理由：包越小、依赖越少，零基础用户越改得动，低端安卓越不掉帧。

---

## 2. 目录与边界铁律

```
src/
├─ main.ts                 # 唯一入口
├─ app.css                 # 全局样式（引用设计令牌）
├─ core/                   # 地基：谁都能依赖它，它不依赖任何人
│  ├─ store.ts  db.ts  router.ts  dom.ts
├─ ai/                     # 最危险的地方，必须独立
│  ├─ types.ts  client.ts  errors.ts
├─ features/               # 一屏一目录
│  ├─ desktop/  chat/  character/  settings/
└─ ui/                     # 跨屏复用原子
   ├─ button.ts  sheet.ts  icons/
```

### 三条铁律

1. **`core/` 和 `ai/` 不许 import 任何 UI 代码** —— 它们必须能在没有 DOM 的环境里测试。
2. **`src/ai/client.ts` 是全项目唯一能发 HTTP 的地方。** 将来加代理、兼容模式、Keystore，只改这一个文件。任何在别处冒出来的 `fetch(` 都是违规。
3. **`features/*` 之间不许互相 import。** 共享的东西下沉到 `core/` 或 `ui/`。用 ESLint `import/no-restricted-paths` 强制，不靠口头约定。

---

## 3. 设计系统（视觉类改动一律先读这里）

**唯一真源：[`design/STYLE.md`](design/STYLE.md) 与 [`design/tokens.css`](design/tokens.css)。**

1. **组件里禁止出现裸色值**（`#111`、`rgb(...)` 一律不许）。全部引用 `tokens.css` 的语义变量。
2. **果冻反馈只碰 `transform` / `box-shadow`**。反馈层与美化层**不许抢同一个 CSS 属性**（详见 STYLE.md §5）。
3. **反色块红线**：每页最多一个主行动按钮，不许大面积用于正文。
4. **纹理白名单**：只有 4 个位置能用（桌面壁纸 / 空状态 / 角色卡封面 / 反色块装饰），一屏最多一处。
5. **灰阶四段法**：同一组件用四种底面灰度表达状态，不新增颜色。
6. 触控区不小于 **44×44px**；不用 12px 以下字号做正文。
7. **复杂功能一律分级 —— 设置页是「目录」，不是「表单堆」。**

   这是**全项目的前提**，任何新功能进来先问「它属于哪一类」，再决定放哪一层：

   ```
   设置（目录）
   ├─ API 服务商   → 子页面（重，要一整套控制台）
   ├─ 数据储存     → 子页面（重，导出/导入/清空）
   ├─ 顶部栏       → 就地一行开关（轻，不值得进子页面）
   └─ 以后新增的…
   ```

   规则：

   - **能一行开关解决的不进子页面**；需要多步操作的才进。
   - 子页面用统一的「返回 + 标题」顶栏，和设置首页同一套结构，不许各写各的。
   - 目录里每一项都要能**一句话说清它是什么**，说不清就说明该合并。
   - 新增功能**不许**直接往设置首页塞表单 —— 那是它变成垃圾堆的起点。
   - 同一条规则适用于**服务商详情页**：也是目录式折叠卡片，高频在前、低频在后。

---

## 4. 数据铁律

第一版四张表：`characters` / `conversations` / `messages` / `settings`。

1. **导入的角色卡必须原样保留原始 JSON**（字段名 `raw`）。导出时以 `raw` 为基准回写，**不许销毁未知字段** —— 这是 Character Card 规范的明文要求（`MUST NOT destroy unknown keys`）。
2. **每条消息即时落库**，不许依赖 `beforeunload` 之类不可靠时机。
3. **数据库结构变更必须带迁移**，任何情况下不许直接清空用户数据。
4. **导出 / 导入 JSON 是第一版的一等功能**，不是"以后再加"。理由：iPhone 未安装到主屏时，7 天不用会被系统清空全部数据（含 Key）。
5. 字段命名对齐 Character Card V3（MIT 许可），第一版就要能吃现成角色卡。字段映射见 [`docs/research/角色卡格式调研.md`](docs/research/角色卡格式调研.md)。

---

## 5. 安全铁律：API Key 四不许

1. **不许硬编码**进任何源文件。
2. **不许放进 URL query**（会进浏览器历史、Referer、CDN 日志）。
3. **不许写进日志** —— `console.log(headers)` 会把 Key 留存在用户手机日志里。
4. **不许进构建产物** —— `.env` 里的 `VITE_*` 会被**内联进 bundle**，等于公开。

Key 只从本地存储读、只放 `Authorization` 头。网络请求必须带 `credentials: 'omit'`。

另外：**不许用任何公共 CORS 代理** —— 那等于把用户的 Key 白送给第三方。

---

## 6. 许可证红线（我们是 MIT，别人是 AGPL）

本仓库使用 **MIT**。下列项目的**代码一行都不能拷**，只能"读公开源码、理解设计、自己重写"：

| 类别 | 项目 |
|---|---|
| AGPL-3.0 | SillyTavern、ai-virtual-phone、freeapp（玄鲸）、fuyue（赴约）、ChatterUI、rikkahub、agnai、kelivo |
| GPL-3.0 | RisuAI、Chatbox |
| 比 GPL 更坑 | KakaChat（AGPL + **Commons Clause 禁止售卖**）、lobehub（已非开源）、SullyOS（源码可见≠开源） |
| **无 LICENSE = 保留所有权利** | 新版 TavernAI、Aery、柚月小手机、**character-card-spec-v2**（实现请照 MIT 的 spec-v3） |
| ✅ 可参考 | NextChat、LibreChat、the-house、**character-card-spec-v3**（MIT）、**BetterChatGPT**（CC0）、Lucide（ISC） |

⚠️ **另有一条特别约束**：[ai-virtual-phone](https://github.com/xiaolongbao0709/ai-virtual-phone) 作者在 README 开头写了**给 AI 的声明**，明确禁止把它的代码与灵感挪用到其他小手机项目。**我们只借鉴公开可见的产品思路与数据结构，README 里做致谢。**

发布前必须：MIT `LICENSE` + `THIRD_PARTY_NOTICES.md`（列出角色卡规范等）+ README 致谢。

---

## 7. 开发流程

1. **一小步一验收**：每次只做一个**能在手机上肉眼验证**的目标。不许一口气推十个功能。
2. **先读后改**：改任何文件前先读它。不确定就直说"我需要先看 X"，不许凭印象改。
3. **改完必须编译通过**（`npm run build`），并把**真实结果**贴出来，不许说"应该没问题"。
4. **必须给出验证方法**：用户怎么在手机上确认这件事成了。
5. **不许范围外重构**：发现问题可以**列出来**，但不许顺手改。
6. **不许整页 `innerHTML` 重渲染** —— 会毁掉果冻动画、输入框焦点和滚动位置。输入框永远不许被重建。
7. **不许 `transition: all`**，不许给所有元素常开 `will-change`（会爆显存，低端机直接卡死）。

---

## 8. 需要用户明确批准才能做的事

- 推送远端 / 创建 Release / 发布任何东西
- 删除文件或清空数据
- 改动数据表结构
- 引入 AGENTS.md §1 禁止列表里的依赖
- 任何花钱的操作

---

## 9. 遇到问题时的表述要求

- 说**现象**，不说"应该好了"
- 说**实际执行的命令和真实输出**
- 不确定就写"**未核实**"，**绝不许编造** API 行为、字段名、许可证或版本号
- 报错要**翻译成人话**再给用户看（见 `ai/errors.ts` 的设计要求）
