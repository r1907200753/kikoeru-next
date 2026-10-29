import { useState } from 'react';
import type { Health } from '../api';
import {
  ClockIcon,
  DownloadIcon,
  GlobeIcon,
  HeartIcon,
  HomeIcon,
  ListIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  ShuffleIcon,
  SunIcon,
  TimerIcon,
} from '../icons';
import type { Theme } from '../theme';
import { BrandMark } from './BrandMark';

export type NavKey =
  | 'library'
  | 'search'
  | 'favorites'
  | 'recent'
  | 'exports'
  | 'work'
  | 'online-library'
  | 'online-favorites'
  | 'online-playlists';

const NAV_ITEMS: Array<{
  key: NavKey;
  href: string;
  label: string;
  icon: typeof HomeIcon;
}> = [
  { key: 'library', href: '#/', label: '主页', icon: HomeIcon },
  { key: 'search', href: '#/search', label: '搜索', icon: SearchIcon },
  { key: 'favorites', href: '#/favorites', label: '收藏', icon: HeartIcon },
  { key: 'recent', href: '#/recent', label: '最近收听', icon: ClockIcon },
  { key: 'exports', href: '#/exports', label: '导出', icon: DownloadIcon },
];

const SLEEP_OPTIONS = [15, 30, 45, 60, 90];

const THEME_LABEL: Record<Theme, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') {
    return <SunIcon />;
  }
  if (theme === 'dark') {
    return <MoonIcon />;
  }
  return <MonitorIcon />;
}

export function AppSidebar({
  active,
  health,
  onlineConnected,
  onlineUsername,
  theme,
  onThemeCycle,
  onShuffle,
  shuffleBusy,
  shuffleNote,
  sleepRemainingMs,
  onSleep,
  onOpenSettings,
}: {
  active: NavKey;
  health: Health | null;
  onlineConnected: boolean;
  onlineUsername: string;
  theme: Theme;
  onThemeCycle: () => void;
  onShuffle: () => void;
  shuffleBusy: boolean;
  shuffleNote: string;
  sleepRemainingMs: number | null;
  onSleep: (minutes: number | null) => void;
  onOpenSettings: () => void;
}) {
  const [sleepOpen, setSleepOpen] = useState(false);

  return (
    <aside className="sidebar">
      <a className="sidebar-brand" href="#/" aria-label="Kikoeru Next 首页">
        <span className="brand-mark">
          <BrandMark />
        </span>
        <span className="brand-text">
          <span className="brand-title">
            Kikoeru <em>Next</em>
          </span>
        </span>
      </a>

      <nav className="sidebar-nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.key}
              href={item.href}
              className={`sidebar-link${active === item.key ? ' is-active' : ''}`}
            >
              <Icon />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      <p className="sidebar-label">在线</p>
      <nav className="sidebar-online" aria-label="在线功能">
        <a
          href="#/online"
          className={`sidebar-link sidebar-link--online${active === 'online-library' ? ' is-active' : ''}`}
        >
          <GlobeIcon />
          <span>媒体库</span>
          <em className={`online-dot${onlineConnected ? ' is-on' : ''}`} />
        </a>
        <a
          href="#/online/favorites"
          className={`sidebar-link sidebar-link--online${active === 'online-favorites' ? ' is-active' : ''}`}
        >
          <HeartIcon />
          <span>我的收藏</span>
        </a>
        <a
          href="#/online/playlists"
          className={`sidebar-link sidebar-link--online${active === 'online-playlists' ? ' is-active' : ''}`}
        >
          <ListIcon />
          <span>播放列表</span>
        </a>
      </nav>

      <p className="sidebar-label">快捷</p>
      <div className="sidebar-quick">
        <button
          type="button"
          className="sidebar-link sidebar-quick-btn"
          onClick={onShuffle}
          disabled={shuffleBusy}
          title="随机挑一部作品开始播放"
        >
          <ShuffleIcon className={shuffleBusy ? 'spin' : ''} />
          <span>随心听</span>
          <em className="sidebar-quick-value">{shuffleBusy ? '…' : '随机'}</em>
        </button>

        <div className="sidebar-quick-item">
          <button
            type="button"
            className={`sidebar-link sidebar-quick-btn${sleepRemainingMs !== null ? ' is-active' : ''}`}
            onClick={() => setSleepOpen((value) => !value)}
            aria-expanded={sleepOpen}
            title="定时停止播放"
          >
            <TimerIcon />
            <span>睡眠</span>
            <em className="sidebar-quick-value">
              {sleepRemainingMs !== null ? formatRemaining(sleepRemainingMs) : '关'}
            </em>
          </button>
          {sleepOpen ? (
            <>
              <div className="popover-scrim" onClick={() => setSleepOpen(false)} />
              <div className="sidebar-popover" role="menu" aria-label="睡眠定时">
                <p className="sidebar-popover-title">睡眠定时</p>
                <div className="sidebar-popover-options">
                  {SLEEP_OPTIONS.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      className="sidebar-popover-option"
                      onClick={() => {
                        onSleep(minutes);
                        setSleepOpen(false);
                      }}
                    >
                      {minutes} 分钟
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="sidebar-popover-cancel"
                  onClick={() => {
                    onSleep(null);
                    setSleepOpen(false);
                  }}
                  disabled={sleepRemainingMs === null}
                >
                  关闭定时
                </button>
              </div>
            </>
          ) : null}
        </div>

        <button
          type="button"
          className="sidebar-link sidebar-quick-btn"
          onClick={onThemeCycle}
          title="切换浅色 / 深色 / 跟随系统"
        >
          <ThemeIcon theme={theme} />
          <span>外观</span>
          <em className="sidebar-quick-value">{THEME_LABEL[theme]}</em>
        </button>
      </div>
      {shuffleNote ? (
        <p className="sidebar-quick-note" role="status">
          {shuffleNote}
        </p>
      ) : null}

      <div className="sidebar-spacer" />

      <div className="sidebar-status">
        <span className={`status-dot${health ? '' : ' status-dot--warn'}`} />
        <div>
          <strong>{health ? `${health.workCount} 部作品` : '服务未连接'}</strong>
          <small title={health?.libraryPath ?? ''}>
            {health?.libraryPath || '尚未配置曲库'}
          </small>
        </div>
      </div>

      <button type="button" className="sidebar-settings" onClick={onOpenSettings}>
        <SettingsIcon />
        <span>设置</span>
      </button>

      <p className="sidebar-foot">
        {onlineConnected ? `已连接 ${onlineUsername || 'asmr.one'}` : 'asmr.one 未登录'} · v
        {health?.version ?? '—'}
      </p>
    </aside>
  );
}
