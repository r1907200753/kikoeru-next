import type { ReactNode } from 'react';
import type { WorkSort } from '../api';
import {
  BackIcon,
  FilterIcon,
  HashIcon,
  LogIcon,
  MoonIcon,
  RefreshIcon,
  SunIcon,
} from '../icons';
import type { Theme } from '../theme';
import { resolveTheme } from '../theme';

export const SORT_OPTIONS: Array<{ value: WorkSort; label: string }> = [
  { value: 'updated', label: '最近更新' },
  { value: 'popular', label: '最近播放' },
  { value: 'rating', label: '评分最高' },
  { value: 'released', label: '发售时间' },
  { value: 'title', label: '标题排序' },
];

export function sortLabel(sort: WorkSort): string {
  return SORT_OPTIONS.find((item) => item.value === sort)?.label ?? '最近更新';
}

export function Topbar({
  title,
  backHref,
  onBack,
  onLookup,
  onOpenLogs,
  onRefresh,
  refreshing = false,
  filter,
  theme,
  onToggleTheme,
  children,
}: {
  title?: string | undefined;
  backHref?: string | undefined;
  onBack?: (() => void) | undefined;
  onLookup: () => void;
  onOpenLogs: () => void;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean;
  filter?:
    | {
        open: boolean;
        active: boolean;
        sort: WorkSort;
        favoriteOnly: boolean;
        showFavoriteToggle?: boolean;
        onToggle: () => void;
        onClose: () => void;
        onSortChange: (sort: WorkSort) => void;
        onFavoriteOnlyChange: (value: boolean) => void;
      }
    | undefined;
  theme: Theme;
  onToggleTheme: () => void;
  children?: ReactNode;
}) {
  const resolvedTheme = resolveTheme(theme);
  return (
    <header className="topbar">
      <div className="topbar-left">
        {backHref ? (
          <a
            className="topbar-back"
            href={backHref}
            onClick={(event) => {
              if (onBack) {
                event.preventDefault();
                onBack();
              }
            }}
          >
            <BackIcon /> 返回
          </a>
        ) : null}
        {title ? (
          <h1 className="topbar-title">{title}</h1>
        ) : null}
        {children}
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-icon"
          onClick={onLookup}
          aria-label="RJ号直达"
          title="RJ号直达"
        >
          <HashIcon />
        </button>
        <button
          type="button"
          className="topbar-icon"
          onClick={onOpenLogs}
          aria-label="打开日志窗口"
          title="运行日志"
        >
          <LogIcon />
        </button>
        {onRefresh ? (
          <button
            type="button"
            className="topbar-icon"
            onClick={onRefresh}
            aria-label="刷新列表"
            title="刷新列表"
          >
            <RefreshIcon className={refreshing ? 'spin' : ''} />
          </button>
        ) : null}
        {filter ? (
          <div className="filter-wrap">
            <button
              type="button"
              className={`topbar-icon${filter.active ? ' is-active' : ''}`}
              onClick={filter.onToggle}
              aria-label="筛选与排序"
              aria-expanded={filter.open}
              title={`排序：${sortLabel(filter.sort)}${filter.favoriteOnly ? ' · 仅收藏' : ''}`}
            >
              <FilterIcon />
              {filter.active ? <span className="filter-dot" /> : null}
            </button>
            {filter.open ? (
              <>
                <div className="popover-scrim" onClick={filter.onClose} />
                <div className="filter-popover" role="menu" aria-label="筛选与排序">
                  <p className="filter-heading">排序依据</p>
                  <div className="filter-options">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`filter-option${
                          filter.sort === option.value ? ' is-active' : ''
                        }`}
                        onClick={() => filter.onSortChange(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {filter.showFavoriteToggle !== false ? (
                    <label className="filter-toggle">
                      <span>仅显示收藏</span>
                      <input
                        type="checkbox"
                        checked={filter.favoriteOnly}
                        onChange={(event) => filter.onFavoriteOnlyChange(event.target.checked)}
                      />
                    </label>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="topbar-icon"
          onClick={onToggleTheme}
          aria-label={resolvedTheme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
          title={resolvedTheme === 'light' ? '深色主题' : '浅色主题'}
        >
          {resolvedTheme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
    </header>
  );
}
