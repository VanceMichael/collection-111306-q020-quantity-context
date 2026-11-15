// 业务查询入口：解释某条数量表达为什么这样接收。
// 用法：npm run explain            列出最近一次接收的全部编号
//       npm run explain -- <编号>  查看该编号原文、依据、语义、标准化值与历史解释

import { resolve } from 'node:path';
import { CaptureStore } from './store.mjs';
import { explainCapture, findInterpretations, renderStandard, KIND_CN } from './quantity/explain.mjs';

const path = resolve(process.env.CAPTURE_PATH ?? 'var/captures.json');
const state = await new CaptureStore(path).read();
const records = state.records.filter((record) => record.kind === 'quantity-extraction');
const query = process.argv[2];

if (records.length === 0) {
  console.log('接收文件中还没有数量接收记录，请先运行 npm run demo。');
  process.exit(0);
}

if (!query) {
  const latest = records.at(-1);
  console.log(`最近一次接收：公告 ${latest.source.documentId}@${latest.source.version}，规则 ${latest.ruleVersion}，采集于 ${latest.at}`);
  for (const capture of latest.captures) {
    console.log(`${capture.key} [${capture.status}] ${KIND_CN[capture.expression.kind]} 「${capture.span}」 ${capture.subject.measure ?? '未指明'} → ${capture.standard ? renderStandard(capture) : '无标准化值'}`);
  }
  if (latest.nonQuantities?.length) {
    console.log('未接收为数量：');
    for (const item of latest.nonQuantities) console.log(`　${item.text}（${item.reason}）`);
  }
  console.log('查询解释：npm run explain -- <编号>');
} else {
  const hits = findInterpretations(records, query);
  if (hits.length === 0) {
    console.log(`未找到 ${query}，运行 npm run explain 查看可用编号。`);
    process.exit(1);
  }
  [...hits].reverse().forEach((hit, index) => {
    console.log(index === 0 ? '—— 当前解释 ——' : `—— 历史解释 ${index}（较早记录，保留未改写）——`);
    console.log(explainCapture(hit.capture, hit.record).join('\n'));
  });
  if (hits.length > 1) console.log('说明：接收文件只追加不改写，较早解释仍可核对。');
}
