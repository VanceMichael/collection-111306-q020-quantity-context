// 面向本地公告 HTML 的极简解析器：只负责构建标签树与取文本，
// 不实现完整 HTML5 规范，不处理脚本与样式。

const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g;

export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  for (const match of html.matchAll(TOKEN)) {
    if (match[5] !== undefined) {
      stack.at(-1).children.push({ tag: '#text', text: match[5] });
      continue;
    }
    const [, closing, rawTag, rawAttrs, selfClose] = match;
    const tag = rawTag.toLowerCase();
    if (closing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const attrs = {};
    for (const attr of rawAttrs.matchAll(ATTR)) attrs[attr[1]] = attr[2] ?? '';
    const element = { tag, attrs, children: [] };
    stack.at(-1).children.push(element);
    if (!selfClose) stack.push(element);
  }
  return root;
}

// 拼接节点文本；skipTag 用于跳过 <sup> 这类脚注引用标记。
export function textOf(node, skipTag = null) {
  if (node.tag === '#text') return node.text;
  if (skipTag && node.tag === skipTag) return '';
  return (node.children ?? []).map((child) => textOf(child, skipTag)).join('');
}
