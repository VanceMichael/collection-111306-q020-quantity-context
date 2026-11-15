// 已登记单位及其到规范单位的十进制换算关系。
// 未登记的单位不做换算、不按经验猜测，原样保留并标注。

export const UNITS = new Map([
  ['吨/年', { dimension: '质量流量', canonical: '吨/年', shift: 0 }],
  ['千吨/年', { dimension: '质量流量', canonical: '吨/年', shift: 3 }],
  ['万吨/年', { dimension: '质量流量', canonical: '吨/年', shift: 4 }],
  ['千克/年', { dimension: '质量流量', canonical: '吨/年', shift: -3 }],
  ['吨', { dimension: '质量', canonical: '吨', shift: 0 }],
  ['千吨', { dimension: '质量', canonical: '吨', shift: 3 }],
  ['万吨', { dimension: '质量', canonical: '吨', shift: 4 }],
  ['千克', { dimension: '质量', canonical: '吨', shift: -3 }],
  ['元', { dimension: '金额', canonical: '元', shift: 0 }],
]);

const BY_LENGTH_DESC = [...UNITS.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));

// 在 text 的 index 处匹配已登记单位，最长者优先（万吨/年 先于 万吨）。
export function matchUnitAt(text, index) {
  for (const unit of BY_LENGTH_DESC) {
    if (text.startsWith(unit, index)) return unit;
  }
  return null;
}
