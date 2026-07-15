'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { CellPosition, cellRefToString } from '@/types/spreadsheet';
import styles from './FormulaBar.module.css';

interface FormulaBarProps {
  selectedCell: CellPosition | null;
  value: string;
  formula: string | null;
  isEditing: boolean;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onEdit: () => void;
}

export default function FormulaBar({
  selectedCell,
  value,
  formula,
  isEditing,
  onValueChange,
  onSubmit,
  onCancel,
  onEdit,
}: FormulaBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(formula || value);
  }, [value, formula]);



  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onValueChange(localValue);
      onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setLocalValue(formula || value);
      onCancel();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    onValueChange(localValue);
    onSubmit();
  };

  const cellRef = selectedCell ? cellRefToString(selectedCell.row, selectedCell.col) : '';

  return (
    <div className={styles.container}>
      <div className={styles.cellRef}>
        {cellRef}
      </div>
      <div className={styles.separator} />
      <div className={styles.functionIcon} title="함수">
        <span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: 14 }}>fx</span>
      </div>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onClick={onEdit}
        placeholder=""
        readOnly={!isEditing}
      />
    </div>
  );
}
