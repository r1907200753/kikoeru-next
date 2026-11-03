import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, ClockIcon } from '../icons';

export interface WorkProgressOption<T extends string> {
  value: T;
  label: string;
}

export function WorkProgressMenu<T extends string>({
  options,
  value,
  currentLabel,
  busy = false,
  allowClear = false,
  clearLabel = '清除标记',
  variant = 'chip',
  onSelect,
}: {
  options: ReadonlyArray<WorkProgressOption<T>>;
  value: T | '';
  currentLabel: string;
  busy?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  variant?: 'chip' | 'button';
  onSelect: (value: T | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (busy) {
      setOpen(false);
    }
  }, [busy]);

  return (
    <div
      className={`work-progress${variant === 'button' ? ' work-progress--button' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={
          variant === 'button'
            ? 'btn btn-tonal btn-compact'
            : `work-progress-trigger${value ? ' is-set' : ''}`
        }
        onClick={() => setOpen((current) => !current)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={value ? `当前进度：${currentLabel}，点击修改` : '标记进度'}
      >
        <ClockIcon />
        <span>{value ? currentLabel : '标记进度'}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div className="work-progress-menu" role="menu">
          <span className="work-progress-head">标记进度</span>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              className={`work-progress-option${
                value === option.value ? ' is-active' : ''
              }`}
              onClick={() => {
                setOpen(false);
                onSelect(option.value);
              }}
            >
              <span>{option.label}</span>
              {value === option.value ? <CheckIcon /> : null}
            </button>
          ))}
          {allowClear && value ? (
            <button
              type="button"
              role="menuitem"
              className="work-progress-option work-progress-clear"
              onClick={() => {
                setOpen(false);
                onSelect(null);
              }}
            >
              {clearLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
