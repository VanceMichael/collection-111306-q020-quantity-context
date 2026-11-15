import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractQuantities, summarizeExtraction } from '../src/quantity/extract.mjs';
import { parseChineseNumeral, parseArabicWithScale, Decimal } from '../src/quantity/number.mjs';
import { explainCapture, findInterpretations, renderStandard } from '../src/quantity/explain.mjs';
import { RULE_VERSION } from '../src/quantity/rules.mjs';
import { CaptureStore } from '../src/store.mjs';
import { startSource } from '../src/source.mjs';
import { collectDocuments } from '../src/collect.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url)));
const html = fixture.data.pages.find((page) => page.id === 'capacity').html;
const result = extractQuantities(html, { documentId: 'capacity', sourceVersion: 'v1' });
const bySpan = (span) => result.captures.find((capture) => capture.span === span);
const recordMeta = { ruleVersion: result.ruleVersion, source: { documentId: 'capacity', version: 'v1' }, at: '2026-11-15T00:00:00.000Z' };

test('中文大数与混合记数按精确十进制解析', () => {
  assert.equal(parseChineseNumeral('三百万'), 3000000n);
  assert.equal(parseChineseNumeral('一万二'), 12000n);
  assert.equal(parseChineseNumeral('十二'), 12n);
  assert.equal(parseChineseNumeral('一百零五'), 105n);
  assert.equal(parseArabicWithScale('1.2亿').toString(), '120000000');
  assert.equal(parseArabicWithScale('1.5万').toString(), '15000');
  assert.equal(new Decimal(12n, -1).shift10(4).toString(), '12000');
});

test('区间保留上下界，不当确数', () => {
  const range = bySpan('1.2～1.5');
  assert.equal(range.expression.kind, 'range');
  assert.equal(range.standard.lower, '12000');
  assert.equal(range.standard.upper, '15000');
  assert.equal(range.standard.unit, '吨/年');
  assert.equal(range.unit.value, '万吨/年');
  assert.equal(range.unit.source, 'declaration');
  assert.equal(range.subject.measure, '设计产能');
  assert.equal(range.subject.measureClass, '产能');
});

test('下限与中文大数：局部单位覆盖章节声明并留证', () => {
  const lower = bySpan('三百万');
  assert.equal(lower.expression.kind, 'lower-bound');
  assert.deepEqual(lower.expression.markers, ['不少于']);
  assert.equal(lower.unit.value, '千克/年');
  assert.equal(lower.unit.source, 'local');
  assert.ok(lower.unit.overridden.some((item) => item.unit === '万吨/年'));
  assert.ok(lower.evidence.some((item) => item.type === '单位覆盖'));
  assert.equal(lower.standard.lower, '3000');
  assert.equal(lower.standard.unit, '吨/年');
  assert.equal(lower.standard.original.display, '三百万');
  assert.equal(lower.subject.measureCore, '产能');
  assert.ok(lower.evidence.some((item) => item.type === '并列结构'));
});

test('约数与统计对象：投资金额不被当成年产量', () => {
  const invest = bySpan('1.2亿');
  const range = bySpan('1.2～1.5');
  assert.equal(invest.expression.kind, 'approx');
  assert.equal(invest.subject.measureClass, '投资');
  assert.equal(invest.standard.value, '120000000');
  assert.equal(invest.standard.unit, '元');
  // 两个看起来相同的 1.2 衡量不同对象
  assert.notEqual(invest.subject.measureClass, range.subject.measureClass);
  const capacityKeys = result.captures.filter((capture) => capture.subject.measureClass === '产能').map((capture) => capture.key);
  assert.ok(!capacityKeys.includes(invest.key));
});

test('章节单位声明覆盖全文声明，覆盖关系可解释', () => {
  const cell = bySpan('20');
  assert.equal(cell.unit.value, '千吨/年');
  assert.equal(cell.unit.source, 'declaration');
  assert.ok(cell.unit.overridden.some((item) => item.unit === '万吨/年'));
  assert.ok(cell.evidence.some((item) => item.type === '单位覆盖' && item.detail.includes('千吨/年')));
  assert.equal(cell.standard.value, '20000');
  assert.equal(cell.subject.measure, '产能');
  assert.equal(cell.subject.object, '主产品');
});

test('跨栏脚注与冲突口径：保留候选待核，统计期未知不编造', () => {
  const cell = bySpan('20');
  assert.equal(cell.status, '待核');
  assert.equal(cell.candidates.length, 2);
  assert.ok(cell.reviewReasons[0].includes('主产品'));
  assert.ok(cell.reviewReasons[0].includes('含副产品'));
  assert.ok(cell.candidates.some((candidate) => candidate.basis.includes('行标签')));
  assert.ok(cell.candidates.some((candidate) => candidate.basis.includes('脚注')));
  const period = cell.caliber.aspects.find((aspect) => aspect.aspect === '统计期');
  assert.equal(period.unknown, true);
  assert.equal(period.value, null);
});

test('明确的未知不写成零', () => {
  const unknown = result.captures.find((capture) => capture.expression.kind === 'unknown');
  assert.equal(unknown.subject.object, '备用线');
  assert.equal(unknown.subject.measure, '产能');
  assert.equal(unknown.expression.marker, '待定');
  assert.equal(unknown.expression.asZero, false);
  assert.equal(unknown.standard, null);
  for (const capture of result.captures) {
    assert.notEqual(capture.standard?.value, '0');
    assert.notEqual(capture.standard?.lower, '0');
  }
});

test('型号与日期中的数字不接收为数量，并登记原因', () => {
  const texts = result.nonQuantities.map((item) => item.text);
  assert.ok(texts.includes('A1200'));
  assert.ok(texts.includes('2026-11-13'));
  const identifier = result.nonQuantities.find((item) => item.text === 'A1200');
  assert.equal(identifier.kind, 'identifier');
  assert.ok(identifier.reason.includes('型号'));
  const date = result.nonQuantities.find((item) => item.text === '2026-11-13');
  assert.equal(date.kind, 'date');
  assert.ok(result.captures.every((capture) => !capture.span.includes('1200') && !capture.span.includes('2026')));
});

test('同一范围多个单位声明：两种解释同样合理时保留候选，不猜测', () => {
  const ambiguous = extractQuantities('<article><p>单位：万吨/年</p><p>单位：千吨/年</p><p>产能20。</p></article>', { documentId: 'dup' });
  const capture = ambiguous.captures.find((item) => item.span === '20');
  assert.equal(capture.status, '待核');
  assert.equal(capture.unit.value, null);
  assert.equal(capture.standard, null);
  assert.equal(capture.candidates.length, 2);
});

test('无局部单位也无声明时不猜测单位', () => {
  const missing = extractQuantities('<article><p>产能20。</p></article>', { documentId: 'nou' });
  const capture = missing.captures[0];
  assert.equal(capture.unit.value, null);
  assert.equal(capture.standard, null);
  assert.equal(capture.status, '待核');
  assert.ok(capture.reviewReasons[0].includes('单位缺失'));
});

test('汇总区分表达类别、待核与排除项', () => {
  const summary = summarizeExtraction(result);
  assert.equal(summary.byKind.range, 1);
  assert.equal(summary.byKind['lower-bound'], 1);
  assert.equal(summary.byKind.approx, 1);
  assert.equal(summary.byKind.exact, 1);
  assert.equal(summary.byKind.unknown, 1);
  assert.equal(summary.pending.length, 1);
  assert.equal(summary.unknowns.length, 1);
  assert.equal(summary.nonQuantities.length, 2);
});

test('解释链回答「这个产能下限为什么这样解释」', () => {
  const lower = bySpan('三百万');
  const text = explainCapture(lower, recordMeta).join('\n');
  assert.ok(text.includes('下限'));
  assert.ok(text.includes('不少于'));
  assert.ok(text.includes('三百万'));
  assert.ok(text.includes('千克/年'));
  assert.ok(text.includes('万吨/年'));
  assert.ok(text.includes('≥ 3000 吨/年'));
  const unknown = result.captures.find((capture) => capture.expression.kind === 'unknown');
  assert.ok(explainCapture(unknown, recordMeta).join('\n').includes('未记为 0'));
  const pending = explainCapture(bySpan('20'), recordMeta).join('\n');
  assert.ok(pending.includes('待核'));
  assert.ok(pending.includes('含副产品'));
  assert.ok(renderStandard(bySpan('1.2亿')).startsWith('≈ 120000000 元'));
});

test('换规则后重新接收只追加记录，原解释不静默改写', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quantity-'));
  try {
    const store = new CaptureStore(join(root, 'captures.json'));
    const first = extractQuantities(html, { documentId: 'capacity', sourceVersion: 'v1', ruleVersion: 'quantity-rules/1' });
    await store.append({ kind: 'quantity-extraction', at: '2026-11-15T00:00:00.000Z', source: { documentId: 'capacity', version: 'v1' }, ...first });
    const before = await store.read();
    const second = extractQuantities(html, { documentId: 'capacity', sourceVersion: 'v1', ruleVersion: 'quantity-rules/2' });
    await store.append({ kind: 'quantity-extraction', at: '2026-11-16T00:00:00.000Z', source: { documentId: 'capacity', version: 'v1' }, ...second });
    const after = await store.read();
    assert.equal(after.records.length, 2);
    assert.deepEqual(after.records[0], before.records[0]);
    assert.equal(after.records[0].ruleVersion, 'quantity-rules/1');
    assert.equal(after.records[1].ruleVersion, 'quantity-rules/2');
    const hits = findInterpretations(after.records, after.records[0].captures[0].key);
    assert.equal(hits.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('采集运行器从本地源接收公告并写入接收文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quantity-'));
  const source = await startSource();
  try {
    const store = new CaptureStore(join(root, 'captures.json'));
    const collected = await collectDocuments({ sourceUrl: source.url, store });
    assert.equal(collected.length, 1);
    const state = await store.read();
    const record = state.records[0];
    assert.equal(record.kind, 'quantity-extraction');
    assert.equal(record.source.documentId, 'capacity');
    assert.equal(record.source.version, 'v1');
    assert.equal(record.ruleVersion, RULE_VERSION);
    assert.equal(record.captures.length, 5);
    assert.equal(record.summary.pending.length, 1);
    assert.ok(record.declarations.some((item) => item.unit === '万吨/年'));
    assert.ok(record.declarations.some((item) => item.unit === '千吨/年'));
    assert.ok(record.footnotes.some((item) => item.label === 'a'));
  } finally {
    await source.close();
    await rm(root, { recursive: true, force: true });
  }
});
