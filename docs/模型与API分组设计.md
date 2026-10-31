# API 与模型（已落地版）

> 2026-11-01 · 第三次改版，按用户最终定的「四个模块 + 全局/角色」重写
>
> **一句话：顶层只有四个模块，服务商藏在模块里；主模型分「全局」和「角色」两层。**

---

## 0. 页面结构

### 设置 → API 与模型

```
[← API 与模型]

[文本 API]     0 个服务商 · 未设置      ›
[生图 API]     1 个服务商 · 假生图站 · dall-e-3  ›
[语音 API]     0 个服务商 · 未设置      ›
[生视频 API]   0 个服务商 · 未设置      ›

主模型
[全局] [角色]

文字模型 · 必须        未设置        ›
生图模型               假生图站 · dall-e-3  ›
语音模型               未设置        ›
视频模型               未设置        ›
```

切到「角色」侧：

```
[角色头像] 陈默            ›
  下面的模型只对这个角色生效

文字模型    跟随全局（gpt-4o）   ›
生图模型    跟随全局（dall-e-3） ›
语音模型    跟随全局（未设置）   ›
视频模型    跟随全局（未设置）   ›
```

- 不选 = 跟随全局；选了 = 只对这个角色生效
- 全局里**只有文字模型是必须的**，其余可以不设
- 角色侧选「跟随全局」会清掉覆盖

### 点进「生图 API」

```
[← 生图 API]                    [+]

只拉取输出图片的模型。主模型去上一页选。

当前生图主模型
假生图站 · dall-e-3            [去选]

[智能添加] 粘贴站子信息，自动认地址和 Key
（展开后：textarea + 识别并添加）

已有服务商
  [假] 假生图站   OpenAI 兼容 · 3 个模型   [↓] ›
  [织] 织云       OpenAI 兼容 · 0 个模型   [↓] ›

生图模块支持 OpenAI 兼容；NovelAI 的原生接口还没适配。
```

- 每行一个站子：点主体进详情，右边的下载图标**只拉这一类模型**
- 拉回来是**多选**：勾中的进模型列表；选主模型去上一页
- 新站子：右上角「+」，会带着 `kind` 进入新建页
- 智能添加会按模块自动设置默认接口路径（文本 `/chat/completions`、生图 `/images/generations`、语音 `/audio/speech`）

---

## 1. 协议按模块分

| 模块 | 可用协议 | 真正能拉模型的 |
|---|---|---|
| 文本 | OpenAI 兼容 / Gemini / Claude / 自定义 | OpenAI 兼容、自定义 |
| 生图 | OpenAI 兼容 / NovelAI / 自定义 | OpenAI 兼容、自定义 |
| 语音 | OpenAI 兼容 / ElevenLabs / MiniMax / FishAudio / 自定义 | OpenAI 兼容、自定义 |
| 视频 | OpenAI 兼容 / 自定义 | OpenAI 兼容、自定义 |

没适配的协议**可以建站、可以存 Key**，但拉取会明确提示「还没适配」，不假装能用。

### 文本和生图的表单不一样

- 接口路径默认值不同（见上）
- 非文本服务商不显示「上下文窗口 / 最大输出」、能力标签、测试模型
- 非文本服务商不显示「生成设置」（temperature / Top P / 流式）

---

## 2. 数据

```
Provider
  kind: 'text' | 'image' | 'voice' | 'video'   ← 新字段，老数据默认 text

ProviderModel
  kind: 'text' | 'image' | 'voice' | 'video'

Bindings（settings 表）
  byKind: {
    text?:  { providerId, modelId }
    image?: { providerId, modelId }
    voice?: { providerId, modelId }
    video?: { providerId, modelId }
  }
  characters: {
    [角色id]: { text?, image?, voice?, video? }
  }
```

- 同一个站子既做文本又做生图：分别在两个模块里各加一次，各自拉各自的模型。
- 旧数据（没有 kind）全部按文本处理。
- 角色覆盖只存差异，没存就是跟随全局。

---

## 3. 模型分拣

拉 `GET /models` 后按 ID 猜类型，**只保留当前模块的类型**：

| 关键词 | 类型 |
|---|---|
| sora / veo / kling / runway / pika / hailuo / seedance / luma / video / wan2 | 视频 |
| tts / speech / whisper / audio / voice / eleven / cosyvoice / sovits / fish | 语音 |
| dall-e / dalle / gpt-image / flux / stable-diffusion / sdxl / sd / midjourney / seedream / kolors / wanx / imagen / ideogram / image | 生图 |
| 其他 | 文本 |

猜不出来就筛掉，不会硬塞进错的模块。

---

## 4. 还没做的

| 事项 | 说明 |
|---|---|
| NovelAI 原生 | 没有 `/models`，鉴权和生图端点另一套 |
| ElevenLabs / MiniMax / FishAudio 原生 | 各自鉴权和模型列表格式 |
| Sora / Veo / Kling 原生 | 同上 |
| 真正生成 | 现在只到「选模型」，还没调用生图/语音/视频 |
| 聊天 | 聊天还没做；做了之后全局/角色绑定才会真正生效 |

---

## 5. 下一步建议

1. 接 **NovelAI**（生图最特别）
2. 接 **ElevenLabs**（语音最常用）
3. 做聊天，把全局/角色绑定接进请求
4. 最后才是生图/语音/视频的调用
