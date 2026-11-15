// 把一条数量接收记录渲染成业务可读的解释链：
// 原文片段 → 上下文依据 → 保留的表达语义 → 标准化值 → 待核原因与候选。

export const KIND_CN = {
  exact: '确数',
  range: '区间',
  approx: '约数',
  'lower-bound': '下限',
  'upper-bound': '上限',
  unknown: '明确未知',
};

export function renderStandard(capture) {
  if (capture.expression.kind === 'unknown') {
    return `无（原文标注「${capture.expression.marker}」，缺失值未记为 0）`;
  }
  const standard = capture.standard;
  if (!standard) return '未标准化（单位未确定，未按经验猜测）';
  const origin = `原文「${standard.original.display}」，原单位 ${standard.original.unit}`;
  const conversion = standard.conversion.includes('×10') ? `，换算：${standard.conversion}` : '';
  const tail = `（${origin}${conversion}）`;
  switch (standard.kind) {
    case 'range': return `${standard.lower} ～ ${standard.upper} ${standard.unit}${tail}`;
    case 'lower-bound': return `≥ ${standard.lower} ${standard.unit}${tail}`;
    case 'upper-bound': return `≤ ${standard.upper} ${standard.unit}${tail}`;
    case 'approx': return `≈ ${standard.value} ${standard.unit}${tail}`;
    default: return `${standard.value} ${standard.unit}${tail}`;
  }
}

function unitSourceText(unit) {
  if (unit.source === 'local') return '数量自带局部单位';
  if (unit.source === 'declaration') return `章节/全文声明，声明处 ${unit.declaration.path}`;
  return '未确定';
}

const SUBJECT_EVIDENCE = new Set(['句内标签', '表头', '行标签', '并列结构']);
const UNIT_EVIDENCE = new Set(['局部单位', '单位声明', '单位覆盖']);

export function explainCapture(capture, record) {
  const lines = [];
  lines.push(`【${capture.key}】${capture.status}　规则 ${record.ruleVersion}　来源 ${record.source.documentId}@${record.source.version}　采集于 ${record.at}`);
  lines.push(`原文：「${capture.fragment}」`);
  lines.push(`位置：${capture.path}${capture.headings?.length ? `（章节：${capture.headings.join(' / ')}）` : ''}`);
  const markers = capture.expression.markers?.length ? `，修饰词 ${capture.expression.markers.map((word) => `「${word}」`).join('')}` : '';
  lines.push(`表达语义：${KIND_CN[capture.expression.kind]}（原文表达「${capture.span}」${markers}）`);
  const subject = capture.subject;
  lines.push(`统计对象：${subject.measure ?? '未指明'}（${subject.measureClass}）${subject.object ? `；对象：${subject.object}` : ''}`);
  for (const item of capture.evidence.filter((entry) => SUBJECT_EVIDENCE.has(entry.type))) {
    lines.push(`　依据[${item.type}] ${item.detail}`);
  }
  if (capture.unit?.value) lines.push(`单位：${capture.unit.value}（${unitSourceText(capture.unit)}）`);
  else lines.push(`单位：未确定（${capture.unit?.note ?? '原文未给出'}）`);
  for (const item of capture.evidence.filter((entry) => UNIT_EVIDENCE.has(entry.type))) {
    lines.push(`　依据[${item.type}] ${item.detail}`);
  }
  if (capture.caliber?.aspects?.length) {
    lines.push('统计口径：');
    for (const aspect of capture.caliber.aspects) {
      lines.push(`　${aspect.aspect}：${aspect.unknown ? `未知（${aspect.note}；依据 ${aspect.basis}）` : `${aspect.value}（依据 ${aspect.basis}）`}`);
    }
  }
  for (const item of capture.evidence.filter((entry) => entry.type === '脚注')) {
    lines.push(`　依据[脚注] ${item.detail}`);
  }
  lines.push(`标准化值：${renderStandard(capture)}`);
  if (capture.status === '待核') {
    lines.push('待核原因：');
    for (const reason of capture.reviewReasons) lines.push(`　- ${reason}`);
    if (capture.candidates?.length) {
      lines.push('保留候选（未按行业常识取舍）：');
      capture.candidates.forEach((candidate, index) => lines.push(`　${index + 1}. ${candidate.description}（依据：${candidate.basis}）`));
    }
    if (capture.standard) lines.push('注意：标准化值仅供参考，口径/单位待核，检索使用前请先确认候选。');
  }
  return lines;
}

// 在接收文件的全部记录中查找同一数量表达的历次解释（跨规则版本）。
export function findInterpretations(records, key) {
  const hits = [];
  for (const record of records) {
    if (record.kind !== 'quantity-extraction') continue;
    for (const capture of record.captures ?? []) {
      if (capture.key === key) hits.push({ record, capture });
    }
  }
  return hits;
}
