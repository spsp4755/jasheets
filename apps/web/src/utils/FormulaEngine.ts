import { SheetData, CellValue } from '@/types/spreadsheet';

/**
 * Formula Engine for JaSheets
 * Supports:
 * - Arithmetic: +, -, *, /, (, )
 * - Comparison: =, <>, <, >, <=, >=      Concatenation: &
 * - Literals: numbers, "strings", TRUE/FALSE
 * - References: A1, B2, A1:B2 (ranges)
 * - Functions: SUM, AVERAGE, MIN, MAX, COUNT, IF,
 *   SUMIF, COUNTIF, AVERAGEIF, SUMIFS, COUNTIFS, VLOOKUP
 */

export type TokenType = 'NUMBER' | 'STRING' | 'BOOLEAN' | 'REF' | 'RANGE' | 'FUNCTION' | 'OPERATOR' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
}

const FUNCTIONS = [
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'IF',
  'SUMIF', 'COUNTIF', 'AVERAGEIF', 'SUMIFS', 'COUNTIFS', 'VLOOKUP',
];

export function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  // Remove leading =
  if (formula.startsWith('=')) i++;

  while (i < formula.length) {
    const char = formula[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (/[0-9]/.test(char)) {
      let num = '';
      while (i < formula.length && /[0-9.]/.test(formula[i])) {
        num += formula[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      i++;
      let str = '';
      while (i < formula.length && formula[i] !== quote) {
        str += formula[i];
        i++;
      }
      i++; // closing quote
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    if ('+-*/'.includes(char)) {
      tokens.push({ type: 'OPERATOR', value: char });
      i++;
      continue;
    }

    // Comparison / concat operators (some two-character)
    if ('=<>&'.includes(char)) {
      let op = char;
      i++;
      if ((char === '<' || char === '>') && (formula[i] === '=' || (char === '<' && formula[i] === '>'))) {
        op += formula[i];
        i++;
      }
      tokens.push({ type: 'OPERATOR', value: op });
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'COMMA', value: ',' });
      i++;
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      let word = '';
      while (i < formula.length && /[A-Za-z0-9:]/.test(formula[i])) { // Include : for ranges
        word += formula[i];
        i++;
      }

      const upper = word.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({ type: 'BOOLEAN', value: upper });
      } else if (FUNCTIONS.includes(upper)) {
        tokens.push({ type: 'FUNCTION', value: upper });
      } else if (word.includes(':')) {
        tokens.push({ type: 'RANGE', value: upper }); // A1:B2
      } else {
        tokens.push({ type: 'REF', value: upper }); // A1
      }
      continue;
    }

    // Fallback?
    i++;
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

// Convert A1 to row/col
function parseCellRef(ref: string): { row: number, col: number } | null {
  const match = ref.match(/^([A-Z]+)([0-9]+)$/);
  if (!match) return null;
  const colStr = match[1];
  const rowStr = match[2];

  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  return { row: parseInt(rowStr) - 1, col: col - 1 };
}

// range "A1:B4" -> 2D grid of raw cell values, row-major (rows then cols)
function getRange2D(range: string, data: SheetData): CellValue[][] {
  const parts = range.split(':');
  if (parts.length !== 2) return [];

  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1]);
  if (!start || !end) return [];

  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);

  const grid: CellValue[][] = [];
  for (let r = minRow; r <= maxRow; r++) {
    const row: CellValue[] = [];
    for (let c = minCol; c <= maxCol; c++) {
      row.push(data[r]?.[c]?.value ?? null);
    }
    grid.push(row);
  }
  return grid;
}

function flatten(v: CellValue | CellValue[][]): CellValue[] {
  return Array.isArray(v) ? (v as CellValue[][]).flat() : [v];
}

function flattenNumbers(v: CellValue | CellValue[][]): number[] {
  return flatten(v)
    .map((x) => (typeof x === 'number' ? x : parseFloat(String(x))))
    .filter((n) => !isNaN(n));
}

// SUMIF/COUNTIF-style criteria: ">10", "<=5", "<>0", 와일드카드(*,?), 또는 정확히 일치
function matchesCriteria(value: CellValue, criteria: CellValue): boolean {
  const c = String(criteria ?? '');
  const m = c.match(/^(>=|<=|<>|>|<|=)(.*)$/);
  if (m) {
    const [, op, rest] = m;
    const num = parseFloat(rest);
    const a = typeof value === 'number' ? value : parseFloat(String(value));
    if (!isNaN(num) && !isNaN(a)) {
      switch (op) {
        case '>': return a > num;
        case '<': return a < num;
        case '>=': return a >= num;
        case '<=': return a <= num;
        case '<>': return a !== num;
        case '=': return a === num;
      }
    }
    if (op === '<>') return String(value ?? '').toLowerCase() !== rest.toLowerCase();
    if (op === '=') return String(value ?? '').toLowerCase() === rest.toLowerCase();
    return false;
  }
  if (c.includes('*') || c.includes('?')) {
    const pattern = '^' + c.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    return new RegExp(pattern, 'i').test(String(value ?? ''));
  }
  const num = parseFloat(c);
  if (!isNaN(num) && typeof value === 'number') return value === num;
  return String(value ?? '').toLowerCase() === c.toLowerCase();
}

// (range, criteria) 쌍을 모두 만족하는 행 인덱스 (SUMIFS/COUNTIFS 공용)
function matchingIndices(pairs: Array<[CellValue | CellValue[][], CellValue]>): number[] {
  if (pairs.length === 0) return [];
  const flatRanges = pairs.map(([range]) => flatten(range));
  const len = flatRanges[0].length;
  const indices: number[] = [];
  for (let i = 0; i < len; i++) {
    if (pairs.every(([, criteria], j) => matchesCriteria(flatRanges[j][i], criteria))) indices.push(i);
  }
  return indices;
}

function toNum(v: CellValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? 0 : n;
}

function isNumericLike(v: CellValue): boolean {
  return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(parseFloat(v)));
}

function compareValues(left: CellValue, right: CellValue): number {
  if (isNumericLike(left) && isNumericLike(right)) {
    const a = toNum(left);
    const b = toNum(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = String(left ?? '').toLowerCase();
  const b = String(right ?? '').toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

export function evaluateFormula(formula: string, data: SheetData): CellValue {
  try {
    if (!formula.startsWith('=')) return formula;

    const tokens = tokenize(formula);
    let pos = 0;

    function peek(): Token {
      return tokens[pos];
    }

    function consume(): Token {
      return tokens[pos++];
    }

    // Precedence (low -> high): comparison, concat(&), arithmetic(+ -), term(* /), factor
    function parseExpression(): CellValue {
      let left = parseConcat();
      while (peek().type === 'OPERATOR' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().value)) {
        const op = consume().value;
        const right = parseConcat();
        const cmp = compareValues(left, right);
        switch (op) {
          case '=': left = cmp === 0; break;
          case '<>': left = cmp !== 0; break;
          case '<': left = cmp < 0; break;
          case '>': left = cmp > 0; break;
          case '<=': left = cmp <= 0; break;
          case '>=': left = cmp >= 0; break;
        }
      }
      return left;
    }

    function parseConcat(): CellValue {
      let left = parseArith();
      while (peek().type === 'OPERATOR' && peek().value === '&') {
        consume();
        const right = parseArith();
        left = String(left ?? '') + String(right ?? '');
      }
      return left;
    }

    function parseArith(): CellValue {
      let left = parseTerm();
      while (peek().type === 'OPERATOR' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        const right = parseTerm();
        left = op === '+' ? toNum(left) + toNum(right) : toNum(left) - toNum(right);
      }
      return left;
    }

    function parseTerm(): CellValue {
      let left = parseFactor();
      while (peek().type === 'OPERATOR' && (peek().value === '*' || peek().value === '/')) {
        const op = consume().value;
        const right = parseFactor();
        left = op === '*' ? toNum(left) * toNum(right) : toNum(left) / toNum(right);
      }
      return left;
    }

    function parseFactor(): CellValue {
      const token = peek();

      if (token.type === 'OPERATOR' && token.value === '-') {
        consume();
        return -toNum(parseFactor());
      }

      if (token.type === 'NUMBER') {
        consume();
        return parseFloat(token.value);
      }

      if (token.type === 'STRING') {
        consume();
        return token.value;
      }

      if (token.type === 'BOOLEAN') {
        consume();
        return token.value === 'TRUE';
      }

      if (token.type === 'REF') {
        consume();
        const coords = parseCellRef(token.value);
        if (!coords) return null;
        return data[coords.row]?.[coords.col]?.value ?? null;
      }

      if (token.type === 'LPAREN') {
        consume();
        const val = parseExpression();
        if (peek().type === 'RPAREN') consume();
        return val;
      }

      if (token.type === 'FUNCTION') {
        return parseFunction();
      }

      // Unexpected
      consume();
      return null;
    }

    // 함수 인자: RANGE 토큰은 2D 그리드로, 그 외는 표현식으로 평가
    function parseFunctionArgs(): Array<CellValue | CellValue[][]> {
      const args: Array<CellValue | CellValue[][]> = [];
      while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
        if (peek().type === 'RANGE') {
          args.push(getRange2D(consume().value, data));
        } else {
          args.push(parseExpression());
        }
        if (peek().type === 'COMMA') consume();
      }
      return args;
    }

    function parseFunction(): CellValue {
      const funcName = consume().value;
      if (peek().type !== 'LPAREN') return null;
      consume(); // (
      const args = parseFunctionArgs();
      if (peek().type === 'RPAREN') consume();

      switch (funcName) {
        case 'SUM': {
          const nums = args.flatMap(flattenNumbers);
          return nums.reduce((a, b) => a + b, 0);
        }
        case 'AVERAGE': {
          const nums = args.flatMap(flattenNumbers);
          return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        }
        case 'MIN': {
          const nums = args.flatMap(flattenNumbers);
          return nums.length ? Math.min(...nums) : 0;
        }
        case 'MAX': {
          const nums = args.flatMap(flattenNumbers);
          return nums.length ? Math.max(...nums) : 0;
        }
        case 'COUNT': {
          return args.flatMap(flattenNumbers).length;
        }
        case 'IF': {
          const [condition, trueVal, falseVal] = args as CellValue[];
          return condition ? trueVal : (falseVal ?? false);
        }
        case 'SUMIF': {
          const [range, criteria, sumRange] = args;
          const target = flatten(sumRange ?? range);
          const idx = matchingIndices([[range, criteria as CellValue]]);
          return idx.reduce((s, i) => s + toNum(target[i]), 0);
        }
        case 'COUNTIF': {
          const [range, criteria] = args;
          return matchingIndices([[range, criteria as CellValue]]).length;
        }
        case 'AVERAGEIF': {
          const [range, criteria, avgRange] = args;
          const target = flatten(avgRange ?? range);
          const idx = matchingIndices([[range, criteria as CellValue]]);
          return idx.length ? idx.reduce((s, i) => s + toNum(target[i]), 0) / idx.length : 0;
        }
        case 'SUMIFS': {
          const [sumRange, ...rest] = args;
          const target = flatten(sumRange);
          const pairs: Array<[CellValue | CellValue[][], CellValue]> = [];
          for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i], rest[i + 1] as CellValue]);
          return matchingIndices(pairs).reduce((s, i) => s + toNum(target[i]), 0);
        }
        case 'COUNTIFS': {
          const pairs: Array<[CellValue | CellValue[][], CellValue]> = [];
          for (let i = 0; i < args.length; i += 2) pairs.push([args[i], args[i + 1] as CellValue]);
          return matchingIndices(pairs).length;
        }
        case 'VLOOKUP': {
          const [lookupValue, table, colIndex, rangeLookup] = args as [CellValue, CellValue[][], CellValue, CellValue];
          if (!Array.isArray(table)) return '#N/A';
          const col = Math.max(1, toNum(colIndex) || 1) - 1;
          const approximate = rangeLookup === undefined || rangeLookup === true;

          if (!approximate) {
            const row = table.find((r) => compareValues(r[0], lookupValue) === 0);
            return row ? (row[col] ?? '#N/A') : '#N/A';
          }
          // 근사 일치: 첫 열이 오름차순 정렬되어 있다고 가정, lookupValue 이하 중 가장 큰 행
          let best: CellValue[] | null = null;
          for (const r of table) {
            if (compareValues(r[0], lookupValue) <= 0) best = r;
            else break;
          }
          return best ? (best[col] ?? '#N/A') : '#N/A';
        }
        default:
          return null;
      }
    }

    const result = parseExpression();
    return result === null ? '#REF!' : result;

  } catch (e) {
    console.error('Formula Error', e);
    return '#ERROR';
  }
}
