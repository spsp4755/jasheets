import { shiftFormulaRefs, computeFillUpdates } from './fillHandle';
import { SheetData } from '@/types/spreadsheet';

describe('shiftFormulaRefs', () => {
  it('shifts relative refs by delta and keeps absolute refs fixed', () => {
    expect(shiftFormulaRefs('=A1+B1', 1, 0)).toBe('=A2+B2');
    expect(shiftFormulaRefs('=$A$1+B1', 1, 1)).toBe('=$A$1+C2');
    expect(shiftFormulaRefs('=SUM(A1:A3)', 2, 0)).toBe('=SUM(A3:A5)');
  });
});

describe('computeFillUpdates', () => {
  it('extends a linear numeric series downward', () => {
    const data: SheetData = { 0: { 0: { value: 10 } }, 1: { 0: { value: 20 } } };
    const updates = computeFillUpdates(
      data,
      { start: { row: 0, col: 0 }, end: { row: 1, col: 0 } },
      { start: { row: 0, col: 0 }, end: { row: 3, col: 0 } },
      'down'
    );
    expect(updates).toEqual([
      { row: 2, col: 0, value: '30' },
      { row: 3, col: 0, value: '40' },
    ]);
  });

  it('copies a single non-numeric value downward', () => {
    const data: SheetData = { 0: { 0: { value: 'Alice' } } };
    const updates = computeFillUpdates(
      data,
      { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      { start: { row: 0, col: 0 }, end: { row: 2, col: 0 } },
      'down'
    );
    expect(updates).toEqual([
      { row: 1, col: 0, value: 'Alice' },
      { row: 2, col: 0, value: 'Alice' },
    ]);
  });

  it('shifts a single-cell formula when filled to the right', () => {
    const data: SheetData = { 0: { 0: { value: 30, formula: '=A1+B1' } } };
    const updates = computeFillUpdates(
      data,
      { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      { start: { row: 0, col: 0 }, end: { row: 0, col: 2 } },
      'right'
    );
    expect(updates).toEqual([
      { row: 0, col: 1, value: '=B1+C1' },
      { row: 0, col: 2, value: '=C1+D1' },
    ]);
  });

  it('cyclically repeats a non-numeric multi-cell pattern', () => {
    const data: SheetData = { 0: { 0: { value: 'Mon' }, 1: { value: 'Tue' } } };
    const updates = computeFillUpdates(
      data,
      { start: { row: 0, col: 0 }, end: { row: 0, col: 1 } },
      { start: { row: 0, col: 0 }, end: { row: 0, col: 3 } },
      'right'
    );
    expect(updates).toEqual([
      { row: 0, col: 2, value: 'Mon' },
      { row: 0, col: 3, value: 'Tue' },
    ]);
  });
});
