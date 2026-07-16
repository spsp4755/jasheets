// Spreadsheet type definitions
export interface CellPosition {
  row: number;
  col: number;
}

export interface CellRange {
  start: CellPosition;
  end: CellPosition;
}

export interface Selection {
  anchor: CellPosition;
  range: CellRange;
}

export interface ViewportState {
  scrollX: number;
  scrollY: number;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface SpreadsheetConfig {
  defaultRowHeight: number;
  defaultColWidth: number;
  headerHeight: number;
  headerWidth: number;
  minRowHeight: number;
  maxRowHeight: number;
  minColWidth: number;
  maxColWidth: number;
  totalRows: number;
  totalCols: number;
}

export const DEFAULT_CONFIG: SpreadsheetConfig = {
  defaultRowHeight: 25,
  defaultColWidth: 100,
  headerHeight: 25,
  headerWidth: 50,
  minRowHeight: 20,
  maxRowHeight: 400,
  minColWidth: 30,
  maxColWidth: 500,
  totalRows: 1000,
  totalCols: 26,
};

export interface BorderLine {
  width: number;
  color: string;
}

export interface CellStyle {
  backgroundColor?: string;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  fontSize?: number;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  // 병합: 병합 범위의 좌상단(anchor) 셀에만 설정. 나머지 셀은 렌더링에서 건너뜀
  mergeRows?: number;
  mergeCols?: number;
  // 테두리: 각 변에 독립적으로 지정
  borderTop?: BorderLine;
  borderRight?: BorderLine;
  borderBottom?: BorderLine;
  borderLeft?: BorderLine;
}

export type CellValue = string | number | boolean | null;

export interface CellData {
  value: CellValue;
  displayValue?: string;
  formula?: string;
  style?: CellStyle;
  format?: string;
  error?: string;
}

export interface RowData {
  [colIndex: number]: CellData;
}

export interface SheetData {
  [rowIndex: number]: RowData;
}

export interface ColumnDef {
  width: number;
  hidden?: boolean;
}

export interface RowDef {
  height: number;
  hidden?: boolean;
}

// Utility functions
export function colIndexToLetter(index: number): string {
  let result = '';
  let num = index + 1;
  while (num > 0) {
    const remainder = (num - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result;
}

export function letterToColIndex(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result - 1;
}

export function cellRefToString(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

export function parseSelection(start: CellPosition, end: CellPosition): CellRange {
  return {
    start: {
      row: Math.min(start.row, end.row),
      col: Math.min(start.col, end.col),
    },
    end: {
      row: Math.max(start.row, end.row),
      col: Math.max(start.col, end.col),
    },
  };
}
