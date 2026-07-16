import { CellRange, CellValue, SheetData } from '@/types/spreadsheet';
import { colIndexToLetter, letterToColIndex } from '@/types/spreadsheet';

// 수식 안의 셀 참조(A1, $A1, A$1, $A$1)를 상대 이동량만큼 이동. 절대참조($)는 그대로 둔다.
export function shiftFormulaRefs(formula: string, deltaRow: number, deltaCol: number): string {
  return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (match, colAbs, colLetters, rowAbs, rowDigits) => {
    const col = colAbs ? letterToColIndex(colLetters) : Math.max(0, letterToColIndex(colLetters) + deltaCol);
    const row = rowAbs ? Number(rowDigits) - 1 : Math.max(0, Number(rowDigits) - 1 + deltaRow);
    return `${colAbs}${colIndexToLetter(col)}${rowAbs}${row + 1}`;
  });
}

// 드래그 방향(아래로/오른쪽으로)에 따라 source 범위 값을 target 범위까지 채운 업데이트 목록 생성.
// updateCells({row,col,value:string}[])에 바로 넘길 수 있는 형태로 반환 (기존 입력 파이프라인 재사용).
export function computeFillUpdates(
  data: SheetData,
  source: CellRange,
  target: CellRange,
  direction: 'down' | 'right'
): { row: number; col: number; value: string }[] {
  const updates: { row: number; col: number; value: string }[] = [];

  if (direction === 'down') {
    for (let col = source.start.col; col <= source.end.col; col++) {
      const series = [];
      for (let row = source.start.row; row <= source.end.row; row++) {
        series.push({ row, cell: data[row]?.[col] });
      }
      const step = numericStep(series.map((s) => s.cell?.value));

      for (let row = source.end.row + 1; row <= target.end.row; row++) {
        const offset = row - source.end.row; // 1, 2, 3, ...
        updates.push({ row, col, value: fillValue(series, offset, step, row - series[series.length - 1].row, 0) });
      }
    }
  } else {
    for (let row = source.start.row; row <= source.end.row; row++) {
      const series = [];
      for (let col = source.start.col; col <= source.end.col; col++) {
        series.push({ col, cell: data[row]?.[col] });
      }
      const step = numericStep(series.map((s) => s.cell?.value));

      for (let col = source.end.col + 1; col <= target.end.col; col++) {
        const offset = col - source.end.col;
        updates.push({ row, col, value: fillValue(series, offset, step, 0, col - series[series.length - 1].col) });
      }
    }
  }

  return updates;
}

// series가 전부 숫자이고 2개 이상이면 등차 간격을 반환, 아니면 null(=반복 복사 모드)
function numericStep(values: CellValue[]): number | null {
  if (values.length < 2 || values.some((v) => typeof v !== 'number')) return null;
  const nums = values as number[];
  const step = nums[1] - nums[0];
  for (let i = 2; i < nums.length; i++) {
    if (nums[i] - nums[i - 1] !== step) return null; // 등차수열이 아니면 반복 복사로 폴백
  }
  return step;
}

function fillValue(
  series: Array<{ cell?: { value: CellValue; formula?: string } }>,
  offset: number,
  step: number | null,
  deltaRow: number,
  deltaCol: number
): string {
  const last = series[series.length - 1].cell;

  // 등차수열: 마지막 값 + step * 몇 칸째인지
  if (step !== null && typeof last?.value === 'number') {
    return String(last.value + step * offset);
  }

  // 단일 셀이 수식이면 상대참조를 이동해 복사
  if (series.length === 1 && last?.formula) {
    return shiftFormulaRefs(last.formula, deltaRow, deltaCol);
  }

  // 그 외: source 패턴을 순환 반복 (예: A,B 선택 후 드래그 → A,B,A,B...)
  const source = series[(offset - 1) % series.length].cell;
  if (source?.formula) {
    // 순환 복사 시에도 각 셀은 원래 자기 위치 기준으로 한 바퀴(series.length칸)씩 이동한 상대참조를 가져야 함
    const cyclesMoved = Math.ceil(offset / series.length) * series.length;
    return shiftFormulaRefs(source.formula, deltaRow !== 0 ? cyclesMoved : 0, deltaCol !== 0 ? cyclesMoved : 0);
  }
  return String(source?.value ?? '');
}
