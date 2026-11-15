// 精确十进制与中文数字解析。所有数量在模块内以 Decimal 表示，
// 进入接收记录前一律转为十进制字符串，避免 1.2亿 这类换算出现浮点误差。

export class Decimal {
  constructor(coefficient, exponent) {
    this.coefficient = coefficient; // BigInt
    this.exponent = exponent; // 10 的幂次
  }
  static parse(text) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) return null;
    const fraction = match[2] ?? '';
    return new Decimal(BigInt(match[1] + fraction), -fraction.length);
  }
  static fromBigInt(value) {
    return new Decimal(value, 0);
  }
  shift10(steps) {
    return new Decimal(this.coefficient, this.exponent + steps);
  }
  toString() {
    const negative = this.coefficient < 0n;
    let digits = (negative ? -this.coefficient : this.coefficient).toString();
    let exponent = this.exponent;
    while (digits.length > 1 && digits.endsWith('0')) {
      digits = digits.slice(0, -1);
      exponent += 1;
    }
    const sign = negative ? '-' : '';
    if (exponent >= 0) return sign + digits + '0'.repeat(exponent);
    const point = digits.length + exponent;
    if (point > 0) return sign + digits.slice(0, point) + '.' + digits.slice(point);
    return sign + '0.' + '0'.repeat(-point) + digits;
  }
}

const CN_DIGITS = { 零: 0n, 〇: 0n, 一: 1n, 二: 2n, 两: 2n, 三: 3n, 四: 4n, 五: 5n, 六: 6n, 七: 7n, 八: 8n, 九: 9n };
const CN_SMALL = { 十: 10n, 百: 100n, 千: 1000n };
const CN_BIG = { 万: 10000n, 亿: 100000000n };

// 解析中文整数（含「一万二」这类末位省略）。无法解析时返回 null，绝不猜测。
export function parseChineseNumeral(text) {
  if (!text || typeof text !== 'string') return null;
  const chars = [...text];
  let total = 0n;
  let section = 0n;
  let number = null;
  let previousBig = 0n;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (char in CN_DIGITS) {
      const digit = CN_DIGITS[char];
      const next = chars[index + 1];
      if (previousBig > 0n && section === 0n && number === null && !(next in CN_SMALL)) {
        // 「一万二」：大数单位后直接跟数字，按上一单位的十分之一缩放
        number = digit * (previousBig / 10n);
      } else {
        number = digit;
      }
      previousBig = 0n;
    } else if (char in CN_SMALL) {
      section += (number ?? 1n) * CN_SMALL[char];
      number = null;
      previousBig = 0n;
    } else if (char in CN_BIG) {
      total += (section + (number ?? 0n)) * CN_BIG[char];
      section = 0n;
      number = null;
      previousBig = CN_BIG[char];
    } else {
      return null;
    }
  }
  return total + section + (number ?? 0n);
}

// 解析阿拉伯数字，可带 万/亿 倍率后缀（如 1.2亿、1.5万）。
export function parseArabicWithScale(text) {
  const match = /^(\d+(?:\.\d+)?)([万亿])?$/.exec(text);
  if (!match) return null;
  let value = Decimal.parse(match[1]);
  if (value === null) return null;
  if (match[2] === '万') value = value.shift10(4);
  if (match[2] === '亿') value = value.shift10(8);
  return value;
}
