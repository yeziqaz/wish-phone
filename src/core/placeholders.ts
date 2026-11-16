/* ==========================================================================
   角色卡占位符替换

   角色卡规范（Character Card V3，MIT）约定两个占位符：
     {{user}} —— 用户的名字
     {{char}} —— 角色的名字

   示例对话里写的是「{{user}}: 你好」这种。不替换的话，
   模型会看到字面的花括号，而且演示里对方永远叫「{{user}}」—— 口气会跑偏。

   放 core/ 的原因：它是纯字符串处理，和界面无关，要能被单测直接 import。
   （chat.ts 依赖 DOM，在 node 里 import 不进来）
   ========================================================================== */

/**
 * 替换全部出现。
 *
 * 关键：**必须一次扫描完成**。
 * 如果先换 {{user}} 再换 {{char}}，那么当用户名本身写着「{{char}}」时，
 * 第二步会把刚填进去的文字又换掉 —— 用户看到的名字就错了。
 * 用 split 串起来做就会踩这个坑（有单测钉着）。
 */
export function fillPlaceholders(text: string, userName: string, charName: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith('{{user}}', cursor)) {
      result += userName;
      cursor += '{{user}}'.length;
    } else if (text.startsWith('{{char}}', cursor)) {
      result += charName;
      cursor += '{{char}}'.length;
    } else {
      result += text[cursor];
      cursor += 1;
    }
  }
  return result;
}
