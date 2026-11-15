// 数量表达提取：从公告 HTML 中接收有来源依据的数量表达。
// 输出只含 JSON 安全值（数量一律为十进制字符串），可直接进入接收文件。

import { createHash } from 'node:crypto';
import { parseHtml } from './html.mjs';
import { buildBlocks } from './context.mjs';
import { Decimal, parseArabicWithScale, parseChineseNumeral } from './number.mjs';
import { UNITS, matchUnitAt } from './units.mjs';
import { RULE_VERSION } from './rules.mjs';

const MEASURE_CORES = ['产能', '产量', '投资', '销量', '库存', '采购量'];
const CORE_CLASS = { 产能: '产能', 产量: '产能', 投资: '投资' };
const MODIFIER_LABELS = new Set(['实际', '设计', '计划', '预计', '达产', '现']);
const MEASURE_AT_END = /(产能|产量|投资|销量|库存|采购量)$/;

const DATE_RE = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日?/g;
const IDENT_RE = /[A-Za-z][A-Za-z0-9-]*\d[A-Za-z0-9-]*|\d+[A-Za-z][A-Za-z0-9-]*/g;
const ARABIC_RE = /\d+(?:\.\d+)?[万亿]?/g;
const CHINESE_RE = /[零〇一二三四五六七八九十百千万亿两]+/g;
const UNKNOWN_RE = /([一-龥A-Za-z0-9]{1,12}?)(待定|待核实|未知|暂无)/g;
const RANGE_JOIN = /^\s*(?:[～~—–-]|至)\s*$/;
const PREFIX_MODIFIERS = /(不少于|不低于|至少|最低|不多于|不超过|至多|最高|约|近)\s*$/;
const SUFFIX_MODIFIERS = /^(以上|以下|以内|左右|上下)/;
const LOWER_WORDS = new Set(['不少于', '不低于', '至少', '最低']);
const UPPER_WORDS = new Set(['不多于', '不超过', '至多', '最高']);
const APPROX_WORDS = new Set(['约', '近']);
const LABEL_HINTS = ['设备型号', '投产日', '竣工日', '有效期', '型号', '编号', '批号', '代号', '日期'];

function splitSentences(text) {
  return text.split(/(?<=[。！？；])/).map((sentence) => sentence.trim()).filter(Boolean);
}

function labelHint(sentence, start) {
  const before = sentence.slice(Math.max(0, start - 8), start);
  const found = LABEL_HINTS.filter((hint) => before.includes(hint)).sort((a, b) => b.length - a.length);
  return found.length ? `；紧邻标签「${found[0]}」` : '';
}

// 型号、编号、日期先登记为非数量并排除，避免其中的数字被误认。
function findExclusions(sentence) {
  const exclusions = [];
  for (const match of sentence.matchAll(DATE_RE)) {
    exclusions.push({ start: match.index, end: match.index + match[0].length, text: match[0], kind: 'date', reason: `符合日期格式${labelHint(sentence, match.index)}` });
  }
  for (const match of sentence.matchAll(IDENT_RE)) {
    exclusions.push({ start: match.index, end: match.index + match[0].length, text: match[0], kind: 'identifier', reason: `字母与数字组合，按型号/编号处理${labelHint(sentence, match.index)}` });
  }
  return exclusions;
}

// 在句中找出数量词（阿拉伯、中文、区间），跳过已排除的型号/日期片段。
function findExpressions(sentence, exclusions) {
  const excluded = (start, end) => exclusions.some((item) => start < item.end && end > item.start);
  const raw = [];
  for (const match of sentence.matchAll(ARABIC_RE)) {
    if (excluded(match.index, match.index + match[0].length)) continue;
    raw.push({ start: match.index, end: match.index + match[0].length, text: match[0], value: parseArabicWithScale(match[0]) });
  }
  for (const match of sentence.matchAll(CHINESE_RE)) {
    if (excluded(match.index, match.index + match[0].length)) continue;
    let text = match[0];
    let end = match.index + match[0].length;
    // 「三百万千克」：单位字首的「千」不属于数字
    if (text.endsWith('千') && text.length > 1 && /^(克|吨|米|升|瓦)/.test(sentence.slice(end))) {
      text = text.slice(0, -1);
      end -= 1;
    }
    // 单字中文数字只有紧邻已登记单位时才接收（避免「一致」「一号」误认）
    if (text.length === 1 && !matchUnitAt(sentence, end)) continue;
    const parsed = parseChineseNumeral(text);
    if (parsed === null) continue;
    raw.push({ start: match.index, end, text, value: Decimal.fromBigInt(parsed) });
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const tokens = [];
  for (const token of raw) {
    if (tokens.some((kept) => token.start < kept.end && token.end > kept.start)) continue;
    tokens.push(token);
  }
  // 区间合并：1.2～1.5、三万～四万
  const merged = [];
  for (const token of tokens) {
    const previous = merged.at(-1);
    if (previous && RANGE_JOIN.test(sentence.slice(previous.end, token.start))) {
      previous.lower = previous.lower ?? previous.value;
      previous.upper = token.value;
      previous.end = token.end;
      previous.text = sentence.slice(previous.start, token.end);
      previous.isRange = true;
      delete previous.value;
    } else {
      merged.push({ ...token });
    }
  }
  return merged;
}

// 识别修饰词（上下界、约数）、紧邻单位与句内标签。
function analyzeToken(sentence, token) {
  const before = sentence.slice(0, token.start);
  const clauseStart = Math.max(
    before.lastIndexOf('，'), before.lastIndexOf('。'), before.lastIndexOf('；'),
    before.lastIndexOf('、'), before.lastIndexOf('：'), before.lastIndexOf('！'), before.lastIndexOf('？'),
  ) + 1;
  const clauseBefore = before.slice(clauseStart);
  let kind = token.isRange ? 'range' : 'exact';
  const markers = [];
  let labelText = clauseBefore;
  const prefix = PREFIX_MODIFIERS.exec(clauseBefore);
  if (prefix) {
    markers.push(prefix[1]);
    if (!token.isRange) {
      if (LOWER_WORDS.has(prefix[1])) kind = 'lower-bound';
      else if (UPPER_WORDS.has(prefix[1])) kind = 'upper-bound';
      else if (APPROX_WORDS.has(prefix[1])) kind = 'approx';
    }
    labelText = clauseBefore.slice(0, prefix.index);
  }
  let unit = null;
  let unitEnd = token.end;
  const localUnit = matchUnitAt(sentence, token.end);
  if (localUnit) {
    unit = localUnit;
    unitEnd = token.end + localUnit.length;
  }
  const suffix = SUFFIX_MODIFIERS.exec(sentence.slice(unitEnd));
  if (suffix) {
    markers.push(suffix[1]);
    if (kind === 'exact') {
      if (suffix[1] === '以上') kind = 'lower-bound';
      else if (suffix[1] === '以下' || suffix[1] === '以内') kind = 'upper-bound';
      else kind = 'approx';
    }
  }
  return { kind, markers, label: labelText.trim() || null, unit };
}

// 脚注内容拆成口径方面；「未说明」类是明确的未知，不编造。
function parseCaliberAspects(content) {
  return content.split(/[，、；。]/).map((part) => part.trim()).filter(Boolean).map((part) => {
    let match = /^(含|不含|仅)(.+)$/.exec(part);
    if (match) return { aspect: '统计范围', value: part, include: match[1] !== '不含' };
    match = /^(.+?)(未说明|待核实|待定|未知|不详)$/.exec(part);
    if (match) return { aspect: match[1], value: null, unknown: true, note: `原文明示「${part}」` };
    return { aspect: '说明', value: part };
  });
}

function makeKey(parts) {
  return `q-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 10)}`;
}

export function extractQuantities(html, { documentId = 'unknown', sourceVersion = null, ruleVersion = RULE_VERSION } = {}) {
  const root = parseHtml(html);
  const blocks = buildBlocks(root);
  const declarations = [];
  const footnotes = [];
  const captures = [];
  const nonQuantities = [];

  // 第一遍：单位声明与脚注定义
  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    const declaration = /^单位[：:]\s*(.+)$/.exec(block.text);
    if (declaration) {
      block.type = 'unit-declaration';
      declarations.push({
        id: `d-${declarations.length + 1}`,
        unit: declaration[1].trim(),
        path: block.path,
        scope: block.containers.at(-1) ?? '(全文)',
        headings: block.headings,
      });
    }
  }
  const referencedIds = new Set();
  for (const block of blocks) {
    if (block.type !== 'table') continue;
    for (const row of block.table) for (const cell of row) for (const ref of cell.refs) referencedIds.add(ref.href);
  }
  for (const block of blocks) {
    if (block.type === 'paragraph' && block.id && referencedIds.has(block.id)) {
      block.type = 'footnote-def';
      const match = /^([^\s：:]{1,4})[：:]\s*(.*)$/.exec(block.text);
      footnotes.push({ id: block.id, label: match?.[1] ?? block.id, text: match?.[2] ?? block.text, path: block.path });
    }
  }

  const resolveSubject = ({ label, previousCore, forcedMeasure, object, objectBasis, evidence }) => {
    const measure = forcedMeasure ?? label ?? null;
    if (forcedMeasure) evidence.push({ type: '表头', detail: `统计指标取自表头「${forcedMeasure}」` });
    else if (label) evidence.push({ type: '句内标签', detail: `统计指标取自数量前标签「${label}」` });
    let measureCore = measure ? MEASURE_CORES.find((word) => measure.includes(word)) ?? null : null;
    if (!measureCore && measure && MODIFIER_LABELS.has(measure) && previousCore) {
      measureCore = previousCore;
      evidence.push({ type: '并列结构', detail: `「${measure}」为修饰词，承前一并列指标的核心词「${previousCore}」` });
    }
    const measureClass = measureCore ? CORE_CLASS[measureCore] ?? '其他' : measure ? '未分类' : '未指明';
    if (object && objectBasis) evidence.push({ type: objectBasis, detail: `统计对象取自${objectBasis}「${object}」` });
    return { measure, measureCore, measureClass, object };
  };

  // 单位解析：局部单位优先，其次最近的声明；冲突或缺失保留待核，不猜测。
  const resolveUnit = (localUnit, block, evidence, reviewReasons, candidates) => {
    const applicable = declarations.filter((item) => block.containers.includes(item.scope));
    const depth = (item) => block.containers.indexOf(item.scope);
    const maxDepth = applicable.length ? Math.max(...applicable.map(depth)) : -1;
    const nearestAll = applicable.filter((item) => depth(item) === maxDepth);
    const overridden = applicable.filter((item) => depth(item) < maxDepth);
    if (localUnit) {
      evidence.push({ type: '局部单位', detail: `数量自带局部单位「${localUnit}」` });
      const unit = { value: localUnit, source: 'local', note: null, declaration: null, overridden: [] };
      for (const item of applicable) {
        if (item.unit === localUnit) continue;
        unit.overridden.push({ unit: item.unit, path: item.path });
        evidence.push({ type: '单位覆盖', detail: `局部单位「${localUnit}」优先于声明「单位：${item.unit}」（${item.path}）` });
      }
      return unit;
    }
    if (!applicable.length) {
      reviewReasons.push('单位缺失：原文未给局部单位，也没有可用的章节/全文单位声明；未按行业常识猜测');
      return { value: null, source: 'missing', note: '原文未给出单位，也无可用声明', declaration: null, overridden: [] };
    }
    const nearestUnits = [...new Set(nearestAll.map((item) => item.unit))];
    if (nearestUnits.length > 1) {
      reviewReasons.push(`同一范围存在 ${nearestUnits.length} 个单位声明（${nearestUnits.join('、')}），两种解释同样合理，保留候选待核`);
      for (const item of nearestAll) candidates.push({ description: `单位：${item.unit}`, basis: `声明「单位：${item.unit}」（${item.path}）` });
      return { value: null, source: 'ambiguous', note: '同一范围存在多个单位声明', declaration: null, overridden: [] };
    }
    const nearest = nearestAll[0];
    evidence.push({ type: '单位声明', detail: `采用声明「单位：${nearest.unit}」（${nearest.path}，声明范围 ${nearest.scope}）` });
    for (const item of overridden) {
      evidence.push({ type: '单位覆盖', detail: `声明「单位：${nearest.unit}」（${nearest.path}）优先于外层声明「单位：${item.unit}」（${item.path}）` });
    }
    return {
      value: nearest.unit,
      source: 'declaration',
      note: null,
      declaration: { id: nearest.id, path: nearest.path, scope: nearest.scope },
      overridden: overridden.map((item) => ({ unit: item.unit, path: item.path })),
    };
  };

  const buildCaliber = (refs, object, evidence, reviewReasons, candidates) => {
    const aspects = [];
    for (const ref of refs ?? []) {
      const note = footnotes.find((item) => item.id === ref.href) ?? footnotes.find((item) => item.label === ref.label);
      if (!note) continue;
      evidence.push({ type: '脚注', detail: `脚注${note.label}「${note.text}」（${note.path}）` });
      for (const aspect of parseCaliberAspects(note.text)) aspects.push({ ...aspect, basis: `脚注${note.label}` });
    }
    const range = aspects.find((aspect) => aspect.aspect === '统计范围' && aspect.value);
    if (object && range) {
      const conflict =
        (/主产品/.test(object) && /副产品/.test(range.value)) ||
        (range.value.startsWith('不含') && object.includes(range.value.slice(2)));
      if (conflict) {
        reviewReasons.push(`行标签「${object}」与${range.basis}「${range.value}」对统计范围的表述冲突：两种解释均有原文依据，保留候选待核，未按行业常识取舍`);
        candidates.push({ description: `统计范围仅「${object}」`, basis: `行标签「${object}」` });
        candidates.push({ description: `统计范围「${range.value}」`, basis: `${range.basis}「${range.value}」` });
      }
    }
    return { aspects };
  };

  const buildStandard = (kind, token, unitValue) => {
    if (!unitValue) return null;
    const info = UNITS.get(unitValue) ?? null;
    const canonical = info ? info.canonical : unitValue;
    const convert = (decimal) => (info ? decimal.shift10(info.shift) : decimal).toString();
    const conversion = !info
      ? '未登记单位，保留原单位未换算'
      : info.shift === 0
        ? '单位无需换算'
        : `${unitValue}→${info.canonical}（×10^${info.shift}）`;
    const original = { display: token.text, unit: unitValue };
    if (kind === 'range') return { kind, lower: convert(token.lower), upper: convert(token.upper), unit: canonical, original, conversion };
    if (kind === 'lower-bound') return { kind, lower: convert(token.value), upper: null, unit: canonical, original, conversion };
    if (kind === 'upper-bound') return { kind, lower: null, upper: convert(token.value), unit: canonical, original, conversion };
    if (kind === 'approx') return { kind, value: convert(token.value), approx: true, unit: canonical, original, conversion };
    return { kind: 'exact', value: convert(token.value), unit: canonical, original, conversion };
  };

  const buildQuantityCapture = ({ block, sentence, fragment, path, token, info, previousCore = null, tableInfo = null }) => {
    const evidence = [{ type: '原文', detail: fragment, path }];
    if (block.headings.length) evidence.push({ type: '章节标题', detail: `所在章节：${block.headings.join(' / ')}` });
    const reviewReasons = [];
    const candidates = [];
    const subject = tableInfo
      ? resolveSubject({ forcedMeasure: tableInfo.measure, object: tableInfo.object, objectBasis: '行标签', evidence })
      : resolveSubject({ label: info.label, previousCore, object: block.headings.at(-1) ?? null, objectBasis: '章节标题', evidence });
    const unit = resolveUnit(info.unit, block, evidence, reviewReasons, candidates);
    const caliber = tableInfo ? buildCaliber(tableInfo.refs, subject.object, evidence, reviewReasons, candidates) : { aspects: [] };
    const standard = buildStandard(info.kind, token, unit.value);
    return {
      key: makeKey([documentId, path, token.text, fragment, String(token.start)]),
      span: token.text,
      fragment,
      path,
      headings: block.headings,
      subject,
      expression: { kind: info.kind, markers: info.markers, text: token.text },
      unit,
      caliber,
      standard,
      status: reviewReasons.length ? '待核' : '确定',
      reviewReasons,
      candidates,
      evidence,
    };
  };

  const buildUnknownCapture = ({ block, path, fragment, span, marker, measure, object, extraEvidence = [] }) => {
    const evidence = [{ type: '原文', detail: fragment, path }, ...extraEvidence];
    if (block.headings.length) evidence.push({ type: '章节标题', detail: `所在章节：${block.headings.join(' / ')}` });
    evidence.push({ type: '缺失标记', detail: `原文以「${marker}」明示数量未知；缺失值不记为 0` });
    const measureCore = measure ? MEASURE_CORES.find((word) => measure.includes(word)) ?? null : null;
    return {
      key: makeKey([documentId, path, span, fragment]),
      span,
      fragment,
      path,
      headings: block.headings,
      subject: { measure, measureCore, measureClass: measureCore ? CORE_CLASS[measureCore] ?? '其他' : measure ? '未分类' : '未指明', object },
      expression: { kind: 'unknown', marker, asZero: false },
      unit: { value: null, source: 'missing', note: `原文标注「${marker}」，数量未给出，单位不预填`, declaration: null, overridden: [] },
      caliber: { aspects: [] },
      standard: null,
      status: '确定',
      reviewReasons: [],
      candidates: [],
      evidence,
    };
  };

  const processParagraph = (block) => {
    for (const sentence of splitSentences(block.text)) {
      const exclusions = findExclusions(sentence);
      for (const item of exclusions) {
        nonQuantities.push({ text: item.text, kind: item.kind, reason: item.reason, path: block.path, fragment: sentence, headings: block.headings });
      }
      const tokens = findExpressions(sentence, exclusions);
      let previousCore = null;
      for (const token of tokens) {
        const info = analyzeToken(sentence, token);
        const capture = buildQuantityCapture({ block, sentence, fragment: sentence, path: block.path, token, info, previousCore });
        if (capture.subject.measureCore) previousCore = capture.subject.measureCore;
        captures.push(capture);
      }
      for (const match of sentence.matchAll(UNKNOWN_RE)) {
        const start = match.index;
        const end = match.index + match[0].length;
        if (tokens.some((token) => start < token.end && end > token.start)) continue;
        if (exclusions.some((item) => start < item.end && end > item.start)) continue;
        const subjectText = match[1];
        const marker = match[2];
        const measureMatch = MEASURE_AT_END.exec(subjectText);
        const measure = measureMatch ? measureMatch[1] : null;
        const object = measureMatch ? subjectText.slice(0, -measureMatch[1].length) : subjectText;
        captures.push(buildUnknownCapture({
          block,
          path: block.path,
          fragment: sentence,
          span: match[0],
          marker,
          measure,
          object: object || block.headings.at(-1) || null,
          extraEvidence: [{ type: '句内标签', detail: `未知标记前标签「${subjectText}」` }],
        }));
      }
    }
  };

  const processTable = (block) => {
    const rows = block.table;
    if (!rows.length) return;
    const hasHeader = rows[0].some((cell) => cell.header);
    const headers = hasHeader ? rows[0].map((cell) => cell.text) : [];
    const dataRows = hasHeader ? rows.slice(1) : rows;
    dataRows.forEach((row, rowIndex) => {
      const rowLabel = row[0]?.text ?? '';
      row.forEach((cell, columnIndex) => {
        if (hasHeader && columnIndex === 0) return;
        if (!cell.text) return;
        const measure = hasHeader ? headers[columnIndex] ?? null : null;
        const path = `${block.path}#行${rowIndex + 1}列${columnIndex + 1}`;
        const refText = cell.refs.length ? `（脚注${cell.refs.map((ref) => ref.label).join('、')}）` : '';
        const fragment = `表[${headers.join('|')}] 行「${rowLabel}」${measure ?? ''}：${cell.text}${refText}`;
        if (/^(待定|待核实|未知|暂无)$/.test(cell.text)) {
          captures.push(buildUnknownCapture({
            block,
            path,
            fragment,
            span: cell.text,
            marker: cell.text,
            measure,
            object: rowLabel || null,
            extraEvidence: [{ type: '表头', detail: `统计指标取自表头「${measure}」` }],
          }));
          return;
        }
        const exclusions = findExclusions(cell.text);
        for (const item of exclusions) {
          nonQuantities.push({ text: item.text, kind: item.kind, reason: item.reason, path, fragment, headings: block.headings });
        }
        for (const token of findExpressions(cell.text, exclusions)) {
          const info = analyzeToken(cell.text, token);
          captures.push(buildQuantityCapture({
            block,
            sentence: cell.text,
            fragment,
            path,
            token,
            info,
            tableInfo: { measure, object: rowLabel || null, refs: cell.refs },
          }));
        }
      });
    });
  };

  for (const block of blocks) {
    if (block.type === 'paragraph') processParagraph(block);
    else if (block.type === 'table') processTable(block);
  }

  return { ruleVersion, sourceVersion, declarations, footnotes, captures, nonQuantities };
}

export function summarizeExtraction(extraction) {
  const byKind = {};
  for (const capture of extraction.captures) {
    byKind[capture.expression.kind] = (byKind[capture.expression.kind] ?? 0) + 1;
  }
  return {
    captures: extraction.captures.length,
    byKind,
    pending: extraction.captures.filter((capture) => capture.status === '待核').map((capture) => ({ key: capture.key, reasons: capture.reviewReasons })),
    unknowns: extraction.captures.filter((capture) => capture.expression.kind === 'unknown').map((capture) => ({ key: capture.key, note: '缺失值未记为 0' })),
    nonQuantities: extraction.nonQuantities.map((item) => ({ text: item.text, kind: item.kind })),
  };
}
