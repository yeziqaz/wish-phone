/**
 * 数据模型。
 *
 * 字段命名尽量对齐 Character Card V3（MIT 许可）：
 *   - 导入现成角色卡时几乎不用转换
 *   - 导出时也不容易丢东西
 * 字段语义与全部踩坑细节见 docs/research/角色卡格式调研.md。
 *
 * ⚠️ 这些结构一旦上线就很难改（用户设备上已经有数据了）。
 *    要加字段可以；要改字段名，必须在 db.ts 里写迁移。
 */

/** 角色卡来源规范 */
export type CardSpec = 'v1' | 'v2' | 'v3' | 'manual' | 'unknown';

/* ---------- 世界书 ---------- */

export interface LorebookEntry {
  /** spec 名。从 ST 独立世界书导入时要和 `key` 做映射 */
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  /** ST 存的是 `disable`（反的），映射时要取反 */
  enabled: boolean;
  /** ST 叫 `order` */
  insertion_order: number;
  case_sensitive?: boolean;
  constant?: boolean;
  selective?: boolean;
  secondary_keys?: string[];
  /** 规范里是 'before_char' | 'after_char'；ST 用的是 0~7 的整数，映射要小心 */
  position?: 'before_char' | 'after_char';
  name?: string;
  priority?: number;
  id?: number | string;
  comment?: string;
  use_regex?: boolean;

  // 规范里没有、但实际要用到的 ST 扩展（从 extensions 里提上来做运行时字段）
  _depth?: number; // extensions.depth，默认 4
  _role?: 0 | 1 | 2; // extensions.role
  _probability?: number; // extensions.probability，默认 100
  _matchWholeWords?: boolean;
  _selectiveLogic?: 0 | 1 | 2 | 3;
}

export interface Lorebook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: LorebookEntry[];
}

/* ---------- 角色 ---------- */

export interface Character {
  id: string;
  createdAt: number;
  updatedAt: number;
  spec: CardSpec;
  source: 'json' | 'png' | 'manual';

  name: string;
  description: string;
  personality: string;
  scenario: string;
  /** 开场白。建会话时作为角色的第一条消息写入 */
  firstMes: string;
  alternateGreetings: string[];
  /** 示例对话，用 <START> 分块 */
  mesExample: string;

  /**
   * 原始卡 JSON 全文。
   * ⚠️ 导出时以它为基础回写（deepMerge），绝不能直接用我们的字段重建 ——
   *    规范明文要求 MUST NOT destroy unknown keys，
   *    直接重建会把别人卡里的 extensions 和未知字段全抹掉。
   */
  raw: unknown;

  /* 一版只存、不做逻辑，但字段先占好位 */
  systemPrompt: string;
  postHistoryInstructions: string;
  /** MUST NOT 进 prompt；只展示 */
  creatorNotes: string;
  tags: string[];
  creator: string;
  characterVersion: string;
  extensions: Record<string, unknown>;
  lorebook?: Lorebook;

  /* V3 字段，一版只透传 */
  nickname?: string;
  assets?: unknown[];
  sourceUrls?: string[];

  /** 头像在本地保存的标识（PNG 卡的原图，或用户单独设的头像） */
  avatarKey?: string;
}

/* ---------- 会话与消息 ---------- */

export interface Conversation {
  id: string;
  characterId: string;
  /** 列表里显示的名字，默认用角色名 */
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 用户在这个会话里叫什么（{{user}} 的替换值） */
  userName: string;
  /** 对应 ST 的 chat_metadata，透传 */
  metadata: Record<string, unknown>;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** ISO 字符串，和 ST 的 send_date 对齐（也保证按字符串排序就是按时间排序） */
  createdAt: string;
  /** 对应 ST swipes：可重生成的多个版本，含当前这条 */
  swipes?: string[];
  swipeId?: number;
  extra?: Record<string, unknown>;
}

/* ---------- 设置 ---------- */

/** settings 表是一个简单的键值表，具体形状由使用方决定（见 T4） */
export interface SettingRecord {
  key: string;
  value: unknown;
}
