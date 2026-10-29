import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getAuthStatus,
  getHealth,
  getOnlineAccount,
  getRandomWork,
  getRandomOnlineWork,
  getWork,
  pingServer,
  setAuthRequiredListener,
  setWorkFavorite,
  type AuthStatus,
  type Health,
  type OnlineAccount,
  type WorkSort,
} from './api';
import { AppSidebar, type NavKey } from './components/AppSidebar';
import { BrandMark } from './components/BrandMark';
import { ConnectionScreen } from './components/ConnectionScreen';
import { ExportPage } from './components/ExportPage';
import { FavoritesPage } from './components/FavoritesPage';
import { LibraryPage } from './components/LibraryPage';
import { LoginScreen } from './components/LoginScreen';
import { LogWindow } from './components/LogWindow';
import { ScrapeProgressToast } from './components/ScrapeProgressToast';
import { LookupDialog } from './components/LookupDialog';
import { NowPlaying } from './components/NowPlaying';
import { OnlineFavoritesPage } from './components/OnlineFavoritesPage';
import { OnlineHomePage } from './components/OnlineHomePage';
import { OnlinePlaylistPage } from './components/OnlinePlaylistPage';
import { OnlinePlaylistsPage } from './components/OnlinePlaylistsPage';
import { OnlineWorkPage } from './components/OnlineWorkPage';
import { PlayerBar } from './components/PlayerBar';
import { RecentPage } from './components/RecentPage';
import { SearchPage } from './components/SearchPage';
import { SettingsDialog } from './components/SettingsDialog';
import { TagPage } from './components/TagPage';
import { Topbar } from './components/Topbar';
import { WorkPage } from './components/WorkPage';
import { DownloadIcon, HeartIcon, HomeIcon, SearchIcon, SettingsIcon } from './icons';
import { useDesktopPlayback } from './desktop';
import { useMediaSession } from './mediaSession';
import { usePlayer } from './player';
import {
  applyPalette,
  applyTheme,
  readPalette,
  readTheme,
  resolveTheme,
  type Palette,
  type Theme,
} from './theme';

type Route =
  | { page: 'library' }
  | { page: 'search' }
  | { page: 'favorites' }
  | { page: 'recent' }
  | { page: 'exports' }
  | { page: 'work'; code: string }
  | { page: 'online-home' }
  | { page: 'online-favorites' }
  | { page: 'online-playlists' }
  | { page: 'online-playlist'; id: string }
  | { page: 'online'; code: string }
  | { page: 'tag'; tag: string }
  | { page: 'circle'; name: string }
  | { page: 'va'; name: string };

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('work/')) {
    const code = decodeURIComponent(hash.slice('work/'.length)).trim();
    if (code) {
      return { page: 'work', code };
    }
  }
  if (hash === 'online/favorites') {
    return { page: 'online-favorites' };
  }
  if (hash === 'online/playlists') {
    return { page: 'online-playlists' };
  }
  if (hash.startsWith('online/playlists/')) {
    const id = decodeURIComponent(hash.slice('online/playlists/'.length)).trim();
    if (id) {
      return { page: 'online-playlist', id };
    }
  }
  if (hash.startsWith('online/')) {
    const code = decodeURIComponent(hash.slice('online/'.length)).trim();
    if (code) {
      return { page: 'online', code };
    }
  }
  if (hash === 'online') {
    return { page: 'online-home' };
  }
  if (hash.startsWith('tag/')) {
    const tag = decodeURIComponent(hash.slice('tag/'.length)).trim();
    if (tag) {
      return { page: 'tag', tag };
    }
  }
  if (hash.startsWith('circle/')) {
    const name = decodeURIComponent(hash.slice('circle/'.length)).trim();
    if (name) {
      return { page: 'circle', name };
    }
  }
  if (hash.startsWith('va/')) {
    const name = decodeURIComponent(hash.slice('va/'.length)).trim();
    if (name) {
      return { page: 'va', name };
    }
  }
  if (hash === 'search') {
    return { page: 'search' };
  }
  if (hash === 'favorites') {
    return { page: 'favorites' };
  }
  if (hash === 'recent') {
    return { page: 'recent' };
  }
  if (hash === 'exports') {
    return { page: 'exports' };
  }
  return { page: 'library' };
}

function isOnlineRoute(route: Route): boolean {
  return (
    route.page === 'online' ||
    route.page === 'online-home' ||
    route.page === 'online-favorites' ||
    route.page === 'online-playlists' ||
    route.page === 'online-playlist'
  );
}

function navKeyFor(route: Route): NavKey {
  switch (route.page) {
    case 'search':
      return 'search';
    case 'favorites':
      return 'favorites';
    case 'recent':
      return 'recent';
    case 'exports':
      return 'exports';
    case 'work':
    case 'tag':
    case 'circle':
    case 'va':
      return 'library';
    case 'online-favorites':
      return 'online-favorites';
    case 'online-playlists':
    case 'online-playlist':
      return 'online-playlists';
    case 'online':
    case 'online-home':
      return 'online-library';
    default:
      return 'library';
  }
}

export function App() {
  const player = usePlayer();
  useMediaSession(player);
  useDesktopPlayback(player.playing);
  const [route, setRoute] = useState<Route>(readRoute);
  const navDepthRef = useRef(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking');
  const [retrying, setRetrying] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [onlineAccount, setOnlineAccount] = useState<OnlineAccount | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [palette, setPalette] = useState<Palette>(readPalette);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [sort, setSort] = useState<WorkSort>('updated');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shuffleBusy, setShuffleBusy] = useState(false);
  const [shuffleNote, setShuffleNote] = useState('');
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  useEffect(() => {
    let cancelled = false;
    pingServer()
      .then(() => {
        if (!cancelled) {
          setConnection('online');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setConnection(error instanceof ApiError && error.status === 0 ? 'offline' : 'online');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (connection !== 'online') {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      pingServer().catch((error) => {
        if (!cancelled && error instanceof ApiError && error.status === 0) {
          setConnection('offline');
        }
      });
    }, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection]);

  useEffect(() => {
    let cancelled = false;
    getAuthStatus()
      .then((data) => {
        if (!cancelled) {
          setAuthStatus(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthStatus(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authEpoch]);

  useEffect(() => {
    setAuthRequiredListener(() => setAuthEpoch((value) => value + 1));
    return () => setAuthRequiredListener(null);
  }, []);

  const loginRequired = authStatus?.required === true && !authStatus.authenticated;

  useEffect(() => {
    if (loginRequired) {
      player.reset();
    } else if (connection === 'offline') {
      player.pause();
    }
  }, [loginRequired, connection, player.pause, player.reset]);

  const handleLoginSuccess = useCallback(() => {
    setAuthStatus((current) =>
      current ? { ...current, authenticated: true } : current,
    );
    setAuthEpoch((value) => value + 1);
    setReloadKey((value) => value + 1);
  }, []);

  const refreshAuth = useCallback(() => {
    setAuthEpoch((value) => value + 1);
  }, []);

  const retryConnection = useCallback(async () => {
    if (retrying) {
      return;
    }
    setRetrying(true);
    try {
      await pingServer();
      setAuthChecked(false);
      setConnection('online');
      setAuthEpoch((value) => value + 1);
      setReloadKey((value) => value + 1);
    } catch {
      setConnection('offline');
    } finally {
      setRetrying(false);
    }
  }, [retrying]);

  useEffect(() => {
    if (theme !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    const onHashChange = () => {
      navDepthRef.current += 1;
      setRoute(readRoute());
      setSettingsOpen(false);
      setNowPlayingOpen(false);
      setLookupOpen(false);
      setFilterOpen(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((data) => {
        if (!cancelled) {
          setHealth(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refreshAccount = useCallback(() => {
    getOnlineAccount()
      .then(setOnlineAccount)
      .catch(() => setOnlineAccount(null));
  }, []);

  useEffect(() => {
    refreshAccount();
  }, [refreshAccount]);

  useEffect(() => {
    if (!nowPlayingOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNowPlayingOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [nowPlayingOpen]);

  useEffect(() => {
    if (!player.current && nowPlayingOpen) {
      setNowPlayingOpen(false);
    }
  }, [player.current, nowPlayingOpen]);

  const libraryChanged = useCallback(() => setReloadKey((value) => value + 1), []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((value) => value + 1);
    window.setTimeout(() => setRefreshing(false), 700);
  }, []);

  const toggleFavorite = useCallback((code: string, favorite: boolean) => {
    setWorkFavorite(code, favorite)
      .then(() => setReloadKey((value) => value + 1))
      .catch(() => undefined);
  }, []);

  const showFilter =
    route.page === 'library' ||
    route.page === 'favorites' ||
    route.page === 'tag' ||
    route.page === 'circle' ||
    route.page === 'va';
  const filterFavoriteOnly = route.page === 'library' ? favoriteOnly : false;
  const filterActive =
    route.page === 'library'
      ? favoriteOnly || sort === 'released' || sort === 'title'
      : sort === 'released' || sort === 'title';

  const topbarTitle =
    route.page === 'search'
      ? '搜索'
      : route.page === 'favorites'
        ? '收藏'
        : route.page === 'recent'
          ? '最近收听'
          : route.page === 'exports'
            ? '导出队列'
            : route.page === 'work'
              ? '本地作品'
              : route.page === 'online'
                ? 'asmr.one'
                : route.page === 'online-home'
                  ? 'asmr.one'
                  : route.page === 'online-favorites'
                    ? '我的收藏'
                    : route.page === 'online-playlists' || route.page === 'online-playlist'
                      ? '播放列表'
                      : route.page === 'tag'
                        ? `#${route.tag}`
                        : route.page === 'circle'
                          ? `社团：${route.name}`
                          : route.page === 'va'
                            ? `声优：${route.name}`
                            : undefined;

  const backHref =
    route.page === 'work'
      ? '#/'
      : route.page === 'online'
        ? '#/online'
        : route.page === 'online-favorites' || route.page === 'online-playlists'
          ? '#/online'
          : route.page === 'online-playlist'
            ? '#/online/playlists'
            : route.page === 'tag'
              ? '#/'
              : route.page === 'circle' || route.page === 'va'
                ? '#/'
                : undefined;

  const toggleTheme = () => {
    setTheme(resolveTheme(theme) === 'dark' ? 'light' : 'dark');
  };

  const cycleTheme = () => {
    setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system');
  };

  const shufflePlay = async () => {
    if (shuffleBusy) {
      return;
    }
    setShuffleBusy(true);
    setShuffleNote('');
    try {
      if (isOnlineRoute(route)) {
        player.pause();
        const { work } = await getRandomOnlineWork();
        sessionStorage.setItem('kikoeru.onlineAutoplay', work.code);
        window.location.hash = `#/online/${encodeURIComponent(work.code)}`;
        return;
      }
      const random = await getRandomWork();
      const detail = await getWork(random.code);
      const first = detail.tracks[0];
      if (!first) {
        setShuffleNote('这部作品没有可播放的音轨，再试一次吧');
        return;
      }
      player.play(first, {
        workId: detail.id,
        workCode: detail.code,
        workTitle: detail.title,
        coverAssetId: detail.coverAssetId,
        workPath: detail.relativePath,
        tracks: detail.tracks,
        workTracks: detail.tracks,
      });
      window.location.hash = `#/work/${encodeURIComponent(detail.code)}`;
    } catch (err) {
      setShuffleNote(err instanceof Error ? err.message : String(err));
    } finally {
      setShuffleBusy(false);
    }
  };

  const setSleepTimer = (minutes: number | null) => {
    if (minutes === null) {
      setSleepEndsAt(null);
      setSleepRemainingMs(null);
      return;
    }
    setSleepEndsAt(Date.now() + minutes * 60_000);
  };

  const pausePlayback = player.pause;
  useEffect(() => {
    if (sleepEndsAt === null) {
      return;
    }
    const tick = () => {
      const remaining = sleepEndsAt - Date.now();
      if (remaining <= 0) {
        pausePlayback();
        setSleepEndsAt(null);
        setSleepRemainingMs(null);
      } else {
        setSleepRemainingMs(remaining);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [sleepEndsAt, pausePlayback]);

  useEffect(() => {
    if (!shuffleNote) {
      return;
    }
    const timer = window.setTimeout(() => setShuffleNote(''), 6000);
    return () => window.clearTimeout(timer);
  }, [shuffleNote]);

  if (connection === 'offline') {
    return <ConnectionScreen onRetry={() => void retryConnection()} retrying={retrying} />;
  }

  if (connection === 'checking' || !authChecked) {
    return (
      <div className="boot-screen" role="status">
        <span className="boot-mark">
          <BrandMark />
        </span>
        <p>正在连接 Kikoeru Next…</p>
      </div>
    );
  }

  if (loginRequired) {
    return (
      <LoginScreen hasPassword={authStatus?.hasPassword ?? true} onSuccess={handleLoginSuccess} />
    );
  }

  return (
    <div className="app app--shell">
      <AppSidebar
        active={navKeyFor(route)}
        health={health}
        onlineConnected={onlineAccount?.connected ?? false}
        onlineUsername={onlineAccount?.username ?? ''}
        theme={theme}
        onThemeCycle={cycleTheme}
        onShuffle={() => void shufflePlay()}
        shuffleBusy={shuffleBusy}
        shuffleNote={shuffleNote}
        sleepRemainingMs={sleepRemainingMs}
        onSleep={setSleepTimer}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="workspace">
        <a className="mobile-brand" href="#/" aria-label="Kikoeru Next 首页">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span className="brand-title">
            Kikoeru <em>Next</em>
          </span>
        </a>

        <Topbar
          title={topbarTitle}
          backHref={backHref}
          onBack={navDepthRef.current > 0 ? () => window.history.back() : undefined}
          onLookup={() => setLookupOpen(true)}
          onOpenLogs={() => setLogsOpen(true)}
          onRefresh={
            route.page === 'search' ||
            route.page === 'work' ||
            route.page === 'online' ||
            route.page === 'online-home' ||
            route.page === 'online-favorites' ||
            route.page === 'online-playlists' ||
            route.page === 'online-playlist'
              ? undefined
              : refresh
          }
          refreshing={refreshing}
          filter={
            showFilter
              ? {
                  open: filterOpen,
                  active: filterActive,
                  sort,
                  favoriteOnly: filterFavoriteOnly,
                  showFavoriteToggle: route.page === 'library',
                  onToggle: () => setFilterOpen((value) => !value),
                  onClose: () => setFilterOpen(false),
                  onSortChange: setSort,
                  onFavoriteOnlyChange: setFavoriteOnly,
                }
              : undefined
          }
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <main className="main">
          {route.page === 'work' ? (
            <WorkPage code={route.code} player={player} onFavoriteChanged={libraryChanged} />
          ) : route.page === 'online' ? (
            <OnlineWorkPage code={route.code} onLibraryChanged={libraryChanged} />
          ) : route.page === 'online-favorites' ? (
            <OnlineFavoritesPage
              accountKey={onlineAccount?.updatedAt ?? ''}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : route.page === 'online-playlists' ? (
            <OnlinePlaylistsPage
              accountKey={onlineAccount?.updatedAt ?? ''}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : route.page === 'online-playlist' ? (
            <OnlinePlaylistPage
              id={route.id}
              accountKey={onlineAccount?.updatedAt ?? ''}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : route.page === 'online-home' ? (
            <OnlineHomePage />
          ) : route.page === 'tag' || route.page === 'circle' || route.page === 'va' ? (
            <TagPage
              tag={route.page === 'tag' ? route.tag : route.name}
              kind={route.page === 'tag' ? 'tag' : route.page === 'circle' ? 'circle' : 'va'}
              sort={sort}
              reloadKey={reloadKey}
              onToggleFavorite={toggleFavorite}
            />
          ) : route.page === 'search' ? (
            <SearchPage reloadKey={reloadKey} onToggleFavorite={toggleFavorite} />
          ) : route.page === 'favorites' ? (
            <FavoritesPage
              reloadKey={reloadKey}
              sort={sort}
              onToggleFavorite={toggleFavorite}
            />
          ) : route.page === 'recent' ? (
            <RecentPage player={player} reloadKey={reloadKey} />
          ) : route.page === 'exports' ? (
            <ExportPage reloadKey={reloadKey} onLibraryChanged={libraryChanged} />
          ) : (
            <LibraryPage
              player={player}
              reloadKey={reloadKey}
              sort={sort}
              favoriteOnly={favoriteOnly}
              libraryPath={health?.libraryPath ?? ''}
              onOpenSettings={() => setSettingsOpen(true)}
              onToggleFavorite={toggleFavorite}
            />
          )}
        </main>

        <PlayerBar player={player} onExpand={() => setNowPlayingOpen(true)} />
      </div>

      {nowPlayingOpen ? (
        <NowPlaying player={player} onClose={() => setNowPlayingOpen(false)} />
      ) : null}

      <LogWindow open={logsOpen} onClose={() => setLogsOpen(false)} />
      <ScrapeProgressToast onOpenLogs={() => setLogsOpen(true)} />

      <nav className="bottom-nav" aria-label="底部导航">
        <a className={`nav-item${navKeyFor(route) === 'library' ? ' is-active' : ''}`} href="#/">
          <span className="nav-icon">
            <HomeIcon />
          </span>
          <span>主页</span>
        </a>
        <a
          className={`nav-item${navKeyFor(route) === 'search' ? ' is-active' : ''}`}
          href="#/search"
        >
          <span className="nav-icon">
            <SearchIcon />
          </span>
          <span>搜索</span>
        </a>
        <a
          className={`nav-item${navKeyFor(route) === 'favorites' ? ' is-active' : ''}`}
          href="#/favorites"
        >
          <span className="nav-icon">
            <HeartIcon />
          </span>
          <span>收藏</span>
        </a>
        <a
          className={`nav-item${navKeyFor(route) === 'exports' ? ' is-active' : ''}`}
          href="#/exports"
        >
          <span className="nav-icon">
            <DownloadIcon />
          </span>
          <span>导出</span>
        </a>
        <button
          type="button"
          className={`nav-item${settingsOpen ? ' is-active' : ''}`}
          onClick={() => setSettingsOpen(true)}
        >
          <span className="nav-icon">
            <SettingsIcon />
          </span>
          <span>设置</span>
        </button>
      </nav>

      <LookupDialog open={lookupOpen} onClose={() => setLookupOpen(false)} />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        health={health}
        theme={theme}
        onThemeChange={setTheme}
        palette={palette}
        onPaletteChange={setPalette}
        onLibraryChanged={libraryChanged}
        onAccountChanged={refreshAccount}
        onAccessChanged={refreshAuth}
        onLoggedOut={refreshAuth}
      />

      <audio ref={player.audioRef} preload="metadata" className="audio-engine" />
    </div>
  );
}
