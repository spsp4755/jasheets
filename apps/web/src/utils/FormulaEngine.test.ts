import { evaluateFormula } from './FormulaEngine';
import { SheetData } from '@/types/spreadsheet';

// A1:B4 = 이름/점수 표
function makeSheet(): SheetData {
  const rows: [string, number][] = [['Alice', 10], ['Bob', 20], ['Carol', 30], ['Dave', 40]];
  const data: SheetData = {};
  rows.forEach(([name, score], r) => {
    data[r] = { 0: { value: name }, 1: { value: score } };
  });
  return data;
}

describe('evaluateFormula', () => {
  const data = makeSheet();

  it('keeps existing SUM/AVERAGE behavior', () => {
    expect(evaluateFormula('=SUM(B1:B4)', data)).toBe(100);
    expect(evaluateFormula('=AVERAGE(B1:B4)', data)).toBe(25);
  });

  it('evaluates IF with a comparison condition', () => {
    expect(evaluateFormula('=IF(B2>15,"high","low")', data)).toBe('high');
    expect(evaluateFormula('=IF(B1>15,"high","low")', data)).toBe('low');
  });

  it('SUMIF sums the paired range where criteria matches', () => {
    expect(evaluateFormula('=SUMIF(A1:A4,"Bob",B1:B4)', data)).toBe(20);
  });

  it('COUNTIF counts matches by comparison criteria', () => {
    expect(evaluateFormula('=COUNTIF(B1:B4,">15")', data)).toBe(3);
  });

  it('VLOOKUP exact match returns the requested column', () => {
    expect(evaluateFormula('=VLOOKUP("Carol",A1:B4,2,FALSE)', data)).toBe(30);
  });

  it('VLOOKUP with no match returns #N/A', () => {
    expect(evaluateFormula('=VLOOKUP("Zed",A1:B4,2,FALSE)', data)).toBe('#N/A');
  });
});
