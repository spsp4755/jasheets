'use client';

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import {
  CellPosition,
  CellRange,
  CellData,
  SheetData,
  ColumnDef,
  RowDef,
  ViewportState,
  SpreadsheetConfig,
  DEFAULT_CONFIG,
  colIndexToLetter,
  parseSelection,
} from '@/types/spreadsheet';
import { ConditionalRule } from './ConditionalFormattingDialog';
import styles from './SpreadsheetCanvas.module.css';

interface SpreadsheetCanvasProps {
  data: SheetData;
  columns: ColumnDef[];
  rows: RowDef[];
  config?: Partial<SpreadsheetConfig>;
  selectedCell: CellPosition | null;
  selection: CellRange | null;
  onCellSelect: (pos: CellPosition) => void;
  onSelectionChange: (range: CellRange) => void;
  onCellEdit: (pos: CellPosition) => void;
  conditionalRules?: ConditionalRule[];
  onColumnResize?: (index: number, width: number) => void;
  onRowResize?: (index: number, height: number) => void;
  onHeaderContextMenu?: (x: number, y: number, type: 'row' | 'col', index: number) => void;
  onCellContextMenu?: (x: number, y: number) => void;
  onFillRange?: (source: CellRange, target: CellRange) => void;
  showGridlines?: boolean;
  isEditing?: boolean;
}

const FILL_HANDLE_SIZE = 6;
const FILL_HANDLE_HIT_PADDING = 3; // 실제 클릭 판정 영역은 핸들보다 조금 더 넓게

export default function SpreadsheetCanvas({
  data,
  columns,
  rows,
  config: configOverride,
  selectedCell,
  selection,
  onCellSelect,
  onSelectionChange,
  onCellEdit,
  conditionalRules = [],
  onColumnResize,
  onRowResize,
  onHeaderContextMenu,
  onCellContextMenu,
  onFillRange,
  showGridlines = true,
  isEditing = false,
}: SpreadsheetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ViewportState>({
    scrollX: 0,
    scrollY: 0,
    startRow: 0,
    endRow: 50,
    startCol: 0,
    endCol: 20,
  });
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<CellPosition | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [fillDrag, setFillDrag] = useState<{ source: CellRange; current: CellPosition } | null>(null);

  // Resize State
  const resizingRef = useRef<{ type: 'col' | 'row', index: number, start: number, initialSize: number } | null>(null);

  const config = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...configOverride }),
    [configOverride]
  );

  // 병합 셀이 덮고 있는 (row,col) → anchor(좌상단) 위치 조회용 맵. 병합 개수가 적으므로 매번 스캔해도 무방.
  const mergeCoverage = useMemo(() => {
    const map = new Map<string, CellPosition>();
    for (const rowKey of Object.keys(data)) {
      const row = Number(rowKey);
      for (const colKey of Object.keys(data[row])) {
        const col = Number(colKey);
        const style = data[row][col]?.style;
        const rowSpan = style?.mergeRows ?? 1;
        const colSpan = style?.mergeCols ?? 1;
        if (rowSpan <= 1 && colSpan <= 1) continue;
        for (let r = row; r < row + rowSpan; r++) {
          for (let c = col; c < col + colSpan; c++) {
            if (r === row && c === col) continue;
            map.set(`${r}:${c}`, { row, col });
          }
        }
      }
    }
    return map;
  }, [data]);

  const resolveMergeAnchor = useCallback(
    (pos: CellPosition): CellPosition => mergeCoverage.get(`${pos.row}:${pos.col}`) ?? pos,
    [mergeCoverage]
  );

  // Calculate column positions
  const getColX = useCallback(
    (colIndex: number): number => {
      let x = config.headerWidth;
      for (let i = 0; i < colIndex; i++) {
        if (columns[i]?.hidden) continue;
        x += columns[i]?.width ?? config.defaultColWidth;
      }
      return x;
    },
    [columns, config]
  );

  // Calculate row positions
  const getRowY = useCallback(
    (rowIndex: number): number => {
      let y = config.headerHeight;
      for (let i = 0; i < rowIndex; i++) {
        if (rows[i]?.hidden) continue;
        y += rows[i]?.height ?? config.defaultRowHeight;
      }
      return y;
    },
    [rows, config]
  );

  // 채우기 핸들 위치 계산에 쓰이는, 현재 활성 범위(다중 선택 or 단일 셀)의 화면 좌표 사각형
  const getActiveRangeRect = useCallback(
    (range: CellRange) => {
      const x = getColX(range.start.col) - viewport.scrollX;
      const y = getRowY(range.start.row) - viewport.scrollY;
      let width = 0;
      let height = 0;
      for (let c = range.start.col; c <= range.end.col; c++) width += columns[c]?.width ?? config.defaultColWidth;
      for (let r = range.start.row; r <= range.end.row; r++) height += rows[r]?.height ?? config.defaultRowHeight;
      return { x, y, width, height };
    },
    [getColX, getRowY, viewport, columns, rows, config]
  );

  const getEffectiveRange = useCallback((): CellRange | null => {
    if (selection) return selection;
    if (selectedCell) return { start: selectedCell, end: selectedCell };
    return null;
  }, [selection, selectedCell]);

  // Get cell position from mouse coordinates
  const getCellFromPoint = useCallback(
    (x: number, y: number): CellPosition | null => {
      const scrollX = viewport.scrollX;
      const scrollY = viewport.scrollY;

      // Check if in header area
      if (x < config.headerWidth || y < config.headerHeight) {
        return null;
      }

      // Find column
      let col = -1;
      let currentX = config.headerWidth - scrollX;
      for (let i = 0; i < config.totalCols; i++) {
        if (columns[i]?.hidden) continue;
        const colWidth = columns[i]?.width ?? config.defaultColWidth;
        if (x >= currentX && x < currentX + colWidth) {
          col = i;
          break;
        }
        currentX += colWidth;
      }

      // Find row
      let row = -1;
      let currentY = config.headerHeight - scrollY;
      for (let i = 0; i < config.totalRows; i++) {
        if (rows[i]?.hidden) continue;
        const rowHeight = rows[i]?.height ?? config.defaultRowHeight;
        if (y >= currentY && y < currentY + rowHeight) {
          row = i;
          break;
        }
        currentY += rowHeight;
      }

      if (col >= 0 && row >= 0) {
        return resolveMergeAnchor({ row, col });
      }
      return null;
    },
    [viewport, columns, rows, config, resolveMergeAnchor]
  );

  // Draw the canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { width, height } = canvasSize;
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size with device pixel ratio
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    const { scrollX, scrollY } = viewport;

    // Calculate visible range
    let startCol = 0;
    let endCol = 0;
    let x = config.headerWidth - scrollX;
    for (let i = 0; i < config.totalCols; i++) {
      if (columns[i]?.hidden) continue;
      const colWidth = columns[i]?.width ?? config.defaultColWidth;
      if (x + colWidth > config.headerWidth) {
        if (startCol === 0 && x < config.headerWidth) startCol = i;
        endCol = i;
      }
      x += colWidth;
      if (x > width) break;
    }

    let startRow = 0;
    let endRow = 0;
    let y = config.headerHeight - scrollY;
    for (let i = 0; i < config.totalRows; i++) {
      if (rows[i]?.hidden) continue;
      const rowHeight = rows[i]?.height ?? config.defaultRowHeight;
      if (y + rowHeight > config.headerHeight) {
        if (startRow === 0 && y < config.headerHeight) startRow = i;
        endRow = i;
      }
      y += rowHeight;
      if (y > height) break;
    }

    // Draw grid lines and cells
    ctx.save();
    ctx.beginPath();
    ctx.rect(config.headerWidth, config.headerHeight, width - config.headerWidth, height - config.headerHeight);
    ctx.clip();

    // Draw cells
    let currentY = getRowY(startRow) - scrollY;
    for (let row = startRow; row <= endRow; row++) {
      if (rows[row]?.hidden) continue;
      const rowHeight = rows[row]?.height ?? config.defaultRowHeight;

      let currentX = getColX(startCol) - scrollX;
      for (let col = startCol; col <= endCol; col++) {
        if (columns[col]?.hidden) continue;
        const colWidth = columns[col]?.width ?? config.defaultColWidth;

        // 병합된 셀 중 좌상단(anchor)이 아닌 칸은 그리지 않고 다음 칸으로 (칸 폭만 더해 위치는 계속 추적)
        if (mergeCoverage.has(`${row}:${col}`)) {
          currentX += colWidth;
          continue;
        }

        const cellData = data[row]?.[col];
        const rowSpan = cellData?.style?.mergeRows ?? 1;
        const colSpan = cellData?.style?.mergeCols ?? 1;
        let effectiveWidth = colWidth;
        let effectiveHeight = rowHeight;
        if (colSpan > 1) {
          effectiveWidth = 0;
          for (let c = col; c < col + colSpan; c++) effectiveWidth += columns[c]?.width ?? config.defaultColWidth;
        }
        if (rowSpan > 1) {
          effectiveHeight = 0;
          for (let r = row; r < row + rowSpan; r++) effectiveHeight += rows[r]?.height ?? config.defaultRowHeight;
        }

        // Check if cell is in selection
        const isInSelection =
          selection &&
          row >= selection.start.row &&
          row <= selection.end.row &&
          col >= selection.start.col &&
          col <= selection.end.col;

        const isSelected =
          selectedCell && selectedCell.row === row && selectedCell.col === col;

        // Draw cell background
        if (isInSelection && !isSelected) {
          ctx.fillStyle = 'rgba(26, 115, 232, 0.1)';
          ctx.fillRect(currentX, currentY, effectiveWidth, effectiveHeight);
        }

        // Apply cell style background
        if (cellData?.style?.backgroundColor) {
          ctx.fillStyle = cellData.style.backgroundColor;
          ctx.fillRect(currentX, currentY, effectiveWidth, effectiveHeight);
        }

        // Apply conditional formatting
        let conditionalStyle = {};
        for (const rule of conditionalRules) {
          const isInRuleRange =
            row >= rule.range.startRow &&
            row <= rule.range.endRow &&
            col >= rule.range.startCol &&
            col <= rule.range.endCol;

          if (isInRuleRange) {
            const value = cellData?.value;
            const cellValue = typeof value === 'number' ? value : String(value ?? '');
            const ruleValue = parseFloat(rule.value);
            const ruleValue2 = parseFloat(rule.value2 || '0');

            let match = false;

            if (rule.type === 'greaterThan' && typeof cellValue === 'number') {
              match = cellValue > ruleValue;
            } else if (rule.type === 'lessThan' && typeof cellValue === 'number') {
              match = cellValue < ruleValue;
            } else if (rule.type === 'equalTo') {
              // eslint-disable-next-line eqeqeq
              match = cellValue == rule.value;
            } else if (rule.type === 'contains') {
              match = String(cellValue).includes(rule.value);
            } else if (rule.type === 'between' && typeof cellValue === 'number') {
              match = cellValue >= ruleValue && cellValue <= ruleValue2;
            }

            if (match) {
              conditionalStyle = { ...conditionalStyle, ...rule.style };
            }
          }
        }

        // Apply conditional background if present
        // @ts-ignore
        if (conditionalStyle.backgroundColor) {
          // @ts-ignore
          ctx.fillStyle = conditionalStyle.backgroundColor;
          ctx.fillRect(currentX, currentY, effectiveWidth, effectiveHeight);
        }

        // Draw cell border
        if (showGridlines) {
          ctx.strokeStyle = '#e2e2e2';
          ctx.lineWidth = 1;
          ctx.strokeRect(currentX + 0.5, currentY + 0.5, effectiveWidth, effectiveHeight);
        }

        // 셀별 지정 테두리 (각 변 독립 지정, 격자선보다 위에 그려짐)
        const border = cellData?.style;
        if (border?.borderTop) {
          ctx.strokeStyle = border.borderTop.color;
          ctx.lineWidth = border.borderTop.width;
          ctx.beginPath();
          ctx.moveTo(currentX, currentY);
          ctx.lineTo(currentX + effectiveWidth, currentY);
          ctx.stroke();
        }
        if (border?.borderLeft) {
          ctx.strokeStyle = border.borderLeft.color;
          ctx.lineWidth = border.borderLeft.width;
          ctx.beginPath();
          ctx.moveTo(currentX, currentY);
          ctx.lineTo(currentX, currentY + effectiveHeight);
          ctx.stroke();
        }
        if (border?.borderRight) {
          ctx.strokeStyle = border.borderRight.color;
          ctx.lineWidth = border.borderRight.width;
          ctx.beginPath();
          ctx.moveTo(currentX + effectiveWidth, currentY);
          ctx.lineTo(currentX + effectiveWidth, currentY + effectiveHeight);
          ctx.stroke();
        }
        if (border?.borderBottom) {
          ctx.strokeStyle = border.borderBottom.color;
          ctx.lineWidth = border.borderBottom.width;
          ctx.beginPath();
          ctx.moveTo(currentX, currentY + effectiveHeight);
          ctx.lineTo(currentX + effectiveWidth, currentY + effectiveHeight);
          ctx.stroke();
        }

        // Draw cell content
        if (cellData) {
          const displayValue = cellData.error || cellData.displayValue || String(cellData.value ?? '');

          // @ts-ignore
          ctx.fillStyle = conditionalStyle.color || (cellData.error ? '#ea4335' : (cellData.style?.color || '#202124'));

          // @ts-ignore
          const fontWeight = conditionalStyle.fontWeight || cellData.style?.fontWeight;
          // @ts-ignore
          const fontStyle = conditionalStyle.fontStyle || cellData.style?.fontStyle;

          ctx.font = `${fontWeight === 'bold' ? 'bold ' : ''}${fontStyle === 'italic' ? 'italic ' : ''}${cellData.style?.fontSize || 13}px ${cellData.style?.fontFamily || 'Arial'}`;

          const textX = cellData.style?.textAlign === 'center'
            ? currentX + effectiveWidth / 2
            : cellData.style?.textAlign === 'right'
              ? currentX + effectiveWidth - 4
              : currentX + 4;

          ctx.textAlign = (cellData.style?.textAlign as CanvasTextAlign) || 'left';
          ctx.textBaseline = 'middle';

          // Clip text to cell bounds
          ctx.save();
          ctx.beginPath();
          ctx.rect(currentX + 2, currentY + 2, effectiveWidth - 4, effectiveHeight - 4);
          ctx.clip();
          ctx.fillText(displayValue, textX, currentY + effectiveHeight / 2);
          ctx.restore();
        }

        currentX += colWidth;
      }
      currentY += rowHeight;
    }

    // Draw selected cell border (skip when editing - CellEditor shows its own border)
    if (!isEditing && selectedCell && selectedCell.row >= startRow && selectedCell.row <= endRow && selectedCell.col >= startCol && selectedCell.col <= endCol) {
      const cellX = getColX(selectedCell.col) - scrollX;
      const cellY = getRowY(selectedCell.row) - scrollY;
      const selectedStyle = data[selectedCell.row]?.[selectedCell.col]?.style;
      const selRowSpan = selectedStyle?.mergeRows ?? 1;
      const selColSpan = selectedStyle?.mergeCols ?? 1;
      let cellWidth = columns[selectedCell.col]?.width ?? config.defaultColWidth;
      let cellHeight = rows[selectedCell.row]?.height ?? config.defaultRowHeight;
      if (selColSpan > 1) {
        cellWidth = 0;
        for (let c = selectedCell.col; c < selectedCell.col + selColSpan; c++) cellWidth += columns[c]?.width ?? config.defaultColWidth;
      }
      if (selRowSpan > 1) {
        cellHeight = 0;
        for (let r = selectedCell.row; r < selectedCell.row + selRowSpan; r++) cellHeight += rows[r]?.height ?? config.defaultRowHeight;
      }

      ctx.strokeStyle = '#1a73e8';
      ctx.lineWidth = 2;
      ctx.strokeRect(cellX + 1, cellY + 1, cellWidth - 2, cellHeight - 2);

      // Draw selection handle
      ctx.fillStyle = '#1a73e8';
      ctx.fillRect(cellX + cellWidth - 5, cellY + cellHeight - 5, 6, 6);
    }

    // Draw selection border
    if (selection && !(selection.start.row === selection.end.row && selection.start.col === selection.end.col)) {
      const selStartX = getColX(selection.start.col) - scrollX;
      const selStartY = getRowY(selection.start.row) - scrollY;
      let selWidth = 0;
      let selHeight = 0;

      for (let c = selection.start.col; c <= selection.end.col; c++) {
        selWidth += columns[c]?.width ?? config.defaultColWidth;
      }
      for (let r = selection.start.row; r <= selection.end.row; r++) {
        selHeight += rows[r]?.height ?? config.defaultRowHeight;
      }

      ctx.strokeStyle = '#1a73e8';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(selStartX + 0.5, selStartY + 0.5, selWidth, selHeight);

      // 다중 셀 선택의 채우기 핸들 (단일 셀은 위쪽 selectedCell 블록에서 이미 그림)
      ctx.fillStyle = '#1a73e8';
      ctx.fillRect(selStartX + selWidth - FILL_HANDLE_SIZE / 2, selStartY + selHeight - FILL_HANDLE_SIZE / 2, FILL_HANDLE_SIZE, FILL_HANDLE_SIZE);
    }

    // 채우기 핸들 드래그 중 미리보기 (점선 사각형)
    if (fillDrag) {
      const target =
        fillDrag.current.row > fillDrag.source.end.row
          ? { start: fillDrag.source.start, end: { row: fillDrag.current.row, col: fillDrag.source.end.col } }
          : fillDrag.current.col > fillDrag.source.end.col
            ? { start: fillDrag.source.start, end: { row: fillDrag.source.end.row, col: fillDrag.current.col } }
            : null;
      if (target) {
        const px = getColX(target.start.col) - scrollX;
        const py = getRowY(target.start.row) - scrollY;
        let pw = 0;
        let ph = 0;
        for (let c = target.start.col; c <= target.end.col; c++) pw += columns[c]?.width ?? config.defaultColWidth;
        for (let r = target.start.row; r <= target.end.row; r++) ph += rows[r]?.height ?? config.defaultRowHeight;

        ctx.strokeStyle = '#1a73e8';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
        ctx.setLineDash([]);
      }
    }

    ctx.restore();

    // Draw column headers
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(config.headerWidth, 0, width - config.headerWidth, config.headerHeight);
    ctx.fillRect(0, 0, config.headerWidth, height);

    // Column labels
    for (let col = startCol; col <= endCol; col++) {
      if (columns[col]?.hidden) continue;
      const colX = getColX(col) - scrollX;
      const colWidth = columns[col]?.width ?? config.defaultColWidth;

      const isColSelected = selection && col >= selection.start.col && col <= selection.end.col;

      if (isColSelected) {
        ctx.fillStyle = '#e8f0fe';
        ctx.fillRect(colX, 0, colWidth, config.headerHeight);
      }

      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.strokeRect(colX + 0.5, 0.5, colWidth, config.headerHeight);

      ctx.fillStyle = isColSelected ? '#1a73e8' : '#5f6368';
      ctx.font = '500 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(colIndexToLetter(col), colX + colWidth / 2, config.headerHeight / 2);
    }

    // Row labels
    for (let row = startRow; row <= endRow; row++) {
      if (rows[row]?.hidden) continue;
      const rowY = getRowY(row) - scrollY;
      const rowHeight = rows[row]?.height ?? config.defaultRowHeight;

      const isRowSelected = selection && row >= selection.start.row && row <= selection.end.row;

      if (isRowSelected) {
        ctx.fillStyle = '#e8f0fe';
        ctx.fillRect(0, rowY, config.headerWidth, rowHeight);
      }

      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, rowY + 0.5, config.headerWidth, rowHeight);

      ctx.fillStyle = isRowSelected ? '#1a73e8' : '#5f6368';
      ctx.font = '500 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(row + 1), config.headerWidth / 2, rowY + rowHeight / 2);
    }

    // Top-left corner
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, config.headerWidth, config.headerHeight);
    ctx.strokeStyle = '#e0e0e0';
    ctx.strokeRect(0.5, 0.5, config.headerWidth, config.headerHeight);
  }, [
    canvasSize,
    viewport,
    data,
    columns,
    rows,
    config,
    selectedCell,
    selection,
    conditionalRules,
    getColX,
    getRowY,
    showGridlines,
    isEditing,
    fillDrag,
    mergeCoverage,
  ]);

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setCanvasSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Redraw on state change
  useEffect(() => {
    draw();
  }, [draw]);

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    setViewport((prev) => ({
      ...prev,
      scrollX: target.scrollLeft,
      scrollY: target.scrollTop,
    }));
  }, []);

  // Handle mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 채우기 핸들 드래그 시작 판정 (활성 범위 우하단 모서리 근처 클릭)
      const activeRange = getEffectiveRange();
      if (activeRange) {
        const r = getActiveRangeRect(activeRange);
        const hx = r.x + r.width;
        const hy = r.y + r.height;
        if (Math.abs(x - hx) <= FILL_HANDLE_SIZE + FILL_HANDLE_HIT_PADDING && Math.abs(y - hy) <= FILL_HANDLE_SIZE + FILL_HANDLE_HIT_PADDING) {
          setFillDrag({ source: activeRange, current: activeRange.end });
          return;
        }
      }

      // Check for structural resize (Headers)
      if (y < config.headerHeight && x > config.headerWidth) {
        // Check Col Resize
        let currentX = config.headerWidth - viewport.scrollX;
        for (let i = 0; i < config.totalCols; i++) {
          const width = columns[i]?.width ?? config.defaultColWidth;
          if (Math.abs(x - (currentX + width)) < 5) {
            resizingRef.current = { type: 'col', index: i, start: e.clientX, initialSize: width };
            return;
          }
          currentX += width;
          if (currentX > canvasSize.width) break;
        }
      } else if (x < config.headerWidth && y < config.headerHeight) {
        // Corner - do nothing for now
      } else if (x < config.headerWidth && y > config.headerHeight) {
        // Check Row Resize
        let currentY = config.headerHeight - viewport.scrollY;
        for (let i = 0; i < config.totalRows; i++) {
          const height = rows[i]?.height ?? config.defaultRowHeight;
          if (Math.abs(y - (currentY + height)) < 5) {
            resizingRef.current = { type: 'row', index: i, start: e.clientY, initialSize: height };
            return;
          }
          currentY += height;
          if (currentY > canvasSize.height) break;
        }
      }

      const cell = getCellFromPoint(x, y);
      if (cell) {
        // Right-click: preserve selection if clicked cell is within current selection
        if (e.button === 2 && selection) {
          const isWithinSelection =
            cell.row >= selection.start.row &&
            cell.row <= selection.end.row &&
            cell.col >= selection.start.col &&
            cell.col <= selection.end.col;
          if (isWithinSelection) {
            // Don't change selection, just return to let context menu handle it
            return;
          }
        }

        // Left-click or right-click outside selection: start new selection
        setIsSelecting(true);
        setSelectionStart(cell);
        onCellSelect(cell);
        onSelectionChange({ start: cell, end: cell });
      } else if (y < config.headerHeight && x > config.headerWidth) {
        // Click on Col Header -> Select Col
        let col = -1;
        let currentX = config.headerWidth - viewport.scrollX;
        for (let i = 0; i < config.totalCols; i++) {
          const width = columns[i]?.width ?? config.defaultColWidth;
          if (x >= currentX && x < currentX + width) {
            col = i;
            break;
          }
          currentX += width;
        }
        if (col >= 0) {
          // Select whole column logic? For now selecting first 1000 rows
          const range = { start: { row: 0, col }, end: { row: config.totalRows - 1, col } };
          onSelectionChange(range);
          onCellSelect({ row: 0, col });
        }
      } else if (x < config.headerWidth && y > config.headerHeight) {
        // Click on Row Header -> Select Row
        let row = -1;
        let currentY = config.headerHeight - viewport.scrollY;
        for (let i = 0; i < config.totalRows; i++) {
          const height = rows[i]?.height ?? config.defaultRowHeight;
          if (y >= currentY && y < currentY + height) {
            row = i;
            break;
          }
          currentY += height;
        }
        if (row >= 0) {
          const range = { start: { row, col: 0 }, end: { row, col: config.totalCols - 1 } };
          onSelectionChange(range);
          onCellSelect({ row, col: 0 });
        }
      }
    },
    [getCellFromPoint, onCellSelect, onSelectionChange, config, columns, rows, viewport, canvasSize, getEffectiveRange, getActiveRangeRect]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 채우기 핸들 드래그 중이면 미리보기 범위만 갱신
      if (fillDrag) {
        const cell = getCellFromPoint(x, y);
        if (cell) setFillDrag((prev) => (prev ? { ...prev, current: cell } : prev));
        return;
      }

      // Handle Resize
      if (resizingRef.current) {
        const { type, index, start, initialSize } = resizingRef.current;
        if (type === 'col') {
          const diff = e.clientX - start;
          const newWidth = Math.max(config.minColWidth, initialSize + diff);
          onColumnResize?.(index, newWidth);
        } else {
          const diff = e.clientY - start;
          const newHeight = Math.max(config.minRowHeight, initialSize + diff);
          onRowResize?.(index, newHeight);
        }
        return;
      }

      // Cursor logic
      let cursor = 'default';
      if (y < config.headerHeight && x > config.headerWidth) {
        let currentX = config.headerWidth - viewport.scrollX;
        for (let i = 0; i < config.totalCols; i++) {
          const width = columns[i]?.width ?? config.defaultColWidth;
          if (Math.abs(x - (currentX + width)) < 5) {
            cursor = 'col-resize';
            break;
          }
          currentX += width;
          if (currentX > canvasSize.width) break;
        }
        if (cursor === 'default') cursor = 's-resize'; // Click to select column pointer? 's-resize' looks weird. 'pointer' or 's-resize' is for row resize... 'chevron-down'?
        // Actually standard is down arrow for selection, or col-resize for edge.
        // Let's use 'pointer' for header selection for now
        if (cursor === 'default') cursor = 'pointer';
      } else if (x < config.headerWidth && y > config.headerHeight) {
        let currentY = config.headerHeight - viewport.scrollY;
        for (let i = 0; i < config.totalRows; i++) {
          const height = rows[i]?.height ?? config.defaultRowHeight;
          if (Math.abs(y - (currentY + height)) < 5) {
            cursor = 'row-resize';
            break;
          }
          currentY += height;
          if (currentY > canvasSize.height) break;
        }
        if (cursor === 'default') cursor = 'pointer';
      } else if (x > config.headerWidth && y > config.headerHeight) {
        cursor = 'cell';
      }
      canvas.style.cursor = cursor;

      if (!isSelecting || !selectionStart) return;

      const cell = getCellFromPoint(x, y);
      if (cell) {
        onSelectionChange({ start: selectionStart, end: cell });
      }
    },
    [
      canvasSize,
      columns,
      config,
      getCellFromPoint,
      isSelecting,
      onColumnResize,
      onRowResize,
      onSelectionChange,
      rows,
      selectionStart,
      viewport,
      fillDrag,
    ]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (fillDrag) {
      const { source, current } = fillDrag;
      // v1: 아래로 또는 오른쪽으로만 확장 지원 (위/왼쪽 확장은 스킵)
      if (current.row > source.end.row) {
        onFillRange?.(source, { start: source.start, end: { row: current.row, col: source.end.col } });
      } else if (current.col > source.end.col) {
        onFillRange?.(source, { start: source.start, end: { row: source.end.row, col: current.col } });
      }
      setFillDrag(null);
    }
    setIsSelecting(false);
    setSelectionStart(null);
    resizingRef.current = null;
  }, [fillDrag, onFillRange]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (y < config.headerHeight && x > config.headerWidth) {
      // Col Header
      if (!onHeaderContextMenu) return;
      let currentX = config.headerWidth - viewport.scrollX;
      for (let i = 0; i < config.totalCols; i++) {
        const width = columns[i]?.width ?? config.defaultColWidth;
        if (x >= currentX && x < currentX + width) {
          onHeaderContextMenu(e.clientX, e.clientY, 'col', i);
          return;
        }
        currentX += width;
      }
    } else if (x < config.headerWidth && y > config.headerHeight) {
      // Row Header
      if (!onHeaderContextMenu) return;
      let currentY = config.headerHeight - viewport.scrollY;
      for (let i = 0; i < config.totalRows; i++) {
        const height = rows[i]?.height ?? config.defaultRowHeight;
        if (y >= currentY && y < currentY + height) {
          onHeaderContextMenu(e.clientX, e.clientY, 'row', i);
          return;
        }
        currentY += height;
      }
    } else if (x > config.headerWidth && y > config.headerHeight) {
      // Cell area - trigger cell context menu
      onCellContextMenu?.(e.clientX, e.clientY);
    }
  }, [config, viewport, onHeaderContextMenu, onCellContextMenu, columns, rows]);

  // Handle double click for editing
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const cell = getCellFromPoint(x, y);
      if (cell) {
        onCellEdit(cell);
      }
    },
    [getCellFromPoint, onCellEdit]
  );

  // Calculate total content size for scrolling
  const totalWidth = useMemo(() => {
    let width = config.headerWidth;
    for (let i = 0; i < config.totalCols; i++) {
      if (columns[i]?.hidden) continue;
      width += columns[i]?.width ?? config.defaultColWidth;
    }
    return width;
  }, [columns, config]);

  const totalHeight = useMemo(() => {
    let height = config.headerHeight;
    for (let i = 0; i < config.totalRows; i++) {
      if (rows[i]?.hidden) continue;
      height += rows[i]?.height ?? config.defaultRowHeight;
    }
    return height;
  }, [rows, config]);

  return (
    <div ref={containerRef} className={styles.container}>
      <div
        className={styles.scrollContainer}
        onScroll={handleScroll}
      >
        <div
          className={styles.scrollContent}
          style={{ width: totalWidth, height: totalHeight }}
        />
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
        />
      </div>
    </div>
  );
}
