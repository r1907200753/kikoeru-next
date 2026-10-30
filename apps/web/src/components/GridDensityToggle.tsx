import { HOME_GRID_OPTIONS, usePreferences, type HomeGrid } from '../preferences';

export function GridDensityToggle({ scope }: { scope: 'local' | 'online' }) {
  const [preferences, updatePreferences] = usePreferences();
  const current = scope === 'local' ? preferences.localHomeGrid : preferences.onlineHomeGrid;
  const onChange = (homeGrid: HomeGrid) => {
    if (scope === 'local') {
      updatePreferences({ localHomeGrid: homeGrid });
    } else {
      updatePreferences({ onlineHomeGrid: homeGrid });
    }
  };
  return (
    <div className="density-toggle" role="group" aria-label="首页卡片密度">
      {HOME_GRID_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={current === option.value ? 'is-active' : ''}
          aria-pressed={current === option.value}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          {option.value === 'standard' ? '标准' : option.value === 'four' ? '4 个' : '3 个'}
        </button>
      ))}
    </div>
  );
}
