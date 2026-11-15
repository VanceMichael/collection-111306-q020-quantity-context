// 公告采集运行器：从资料源取公告文档，提取数量表达，追加写入接收文件。
// 每次采集生成一条 quantity-extraction 记录，携带规则版本与来源版本。

import { extractQuantities, summarizeExtraction } from './quantity/extract.mjs';

export async function collectDocuments({ sourceUrl, store, ruleVersion } = {}) {
  const snapshot = await (await fetch(`${sourceUrl}/api/snapshot`)).json();
  const collected = [];
  for (const page of snapshot.pages ?? []) {
    const response = await fetch(`${sourceUrl}/api/document/${page.id}`);
    if (!response.ok) throw new Error(`公告 ${page.id} 获取失败：${response.status}`);
    const version = response.headers.get('etag') ?? snapshot.version ?? null;
    const html = await response.text();
    const extraction = extractQuantities(html, { documentId: page.id, sourceVersion: version, ruleVersion });
    const record = {
      kind: 'quantity-extraction',
      at: new Date().toISOString(),
      source: { url: sourceUrl, documentId: page.id, version },
      ...extraction,
      summary: summarizeExtraction(extraction),
    };
    const receipt = await store.append(record);
    collected.push({ record, revision: receipt.revision });
  }
  return collected;
}
