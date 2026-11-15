// 把标签树整理成文档块序列：标题、段落、表格。
// 每个块携带路径、章节标题链与容器链（用于单位声明的作用域匹配）。

import { textOf } from './html.mjs';

const HEADING = /^h[1-6]$/;
const SCOPE_TAGS = new Set(['article', 'section', 'div', 'body', 'main']);

function parseTable(tableElement) {
  const rows = [];
  for (const tr of (tableElement.children ?? []).filter((child) => child.tag === 'tr')) {
    const cells = [];
    for (const cell of (tr.children ?? []).filter((child) => child.tag === 'th' || child.tag === 'td')) {
      const refs = [];
      const collectRefs = (node) => {
        for (const item of node.children ?? []) {
          if (item.tag === 'sup') {
            const anchor = (item.children ?? []).find((child) => child.tag === 'a' && child.attrs.href?.startsWith('#'));
            if (anchor) refs.push({ label: textOf(anchor).trim(), href: anchor.attrs.href.slice(1) });
          } else {
            collectRefs(item);
          }
        }
      };
      collectRefs(cell);
      cells.push({ header: cell.tag === 'th', text: textOf(cell, 'sup').replace(/\s+/g, ''), refs });
    }
    rows.push(cells);
  }
  return rows;
}

export function buildBlocks(root) {
  const blocks = [];
  const walk = (element, parentPath, headings, containers) => {
    const localHeadings = [...headings];
    const indexByTag = new Map();
    for (const child of element.children ?? []) {
      if (child.tag === '#text') continue;
      const index = (indexByTag.get(child.tag) ?? 0) + 1;
      indexByTag.set(child.tag, index);
      const idPart = child.attrs?.id ? `#${child.attrs.id}` : '';
      const self = `${child.tag}${idPart}[${index}]`;
      const path = parentPath ? `${parentPath}>${self}` : self;
      if (HEADING.test(child.tag)) {
        const level = Number(child.tag[1]);
        const text = textOf(child).trim();
        localHeadings[level - 1] = text;
        localHeadings.length = level;
        blocks.push({ type: 'heading', level, text, path, headings: [...localHeadings], containers: [...containers] });
      } else if (child.tag === 'p') {
        blocks.push({ type: 'paragraph', text: textOf(child).trim(), path, id: child.attrs.id ?? null, headings: [...localHeadings], containers: [...containers] });
      } else if (child.tag === 'table') {
        blocks.push({ type: 'table', path, headings: [...localHeadings], containers: [...containers], table: parseTable(child) });
      } else {
        const nextContainers = SCOPE_TAGS.has(child.tag) ? [...containers, path] : containers;
        walk(child, path, localHeadings, nextContainers);
      }
    }
  };
  walk(root, '', [], []);
  return blocks;
}
