import type { WorkProgressFilter } from '../api';
import { ChevronDownIcon, ClockIcon } from '../icons';
import { WORK_PROGRESS_OPTIONS } from '../online';

const PROGRESS_FILTER_OPTIONS: Array<{ value: WorkProgressFilter | ''; label: string }> = [
  { value: '', label: '全部进度' },
  ...WORK_PROGRESS_OPTIONS,
  { value: 'none', label: '未标记' },
];

export function ProgressFilterSelect({
  value,
  onChange,
}: {
  value: WorkProgressFilter | '';
  onChange: (value: WorkProgressFilter | '') => void;
}) {
  return (
    <label className={`progress-filter${value ? ' is-active' : ''}`}>
      <ClockIcon />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as WorkProgressFilter | '')}
        aria-label="按进度筛选"
      >
        {PROGRESS_FILTER_OPTIONS.map((option) => (
          <option key={option.value || 'all'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon />
    </label>
  );
}
