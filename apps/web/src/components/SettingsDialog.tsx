import { useEffect, useRef, useState } from 'react';
import {
  getAccessInfo,
  getJob,
  getLibraryRoots,
  getNetworkInfo,
  getOnlineAccount,
  getSettings,
  listJobs,
  loginOnline,
  logoutOnline,
  logoutSession,
  scanLibrary,
  startScrape,
  updateSettings,
  type AccessInfo,
  type AppSettings,
  type Health,
  type Job,
  type NetworkInfo,
  type OnlineAccount,
  type ScanResult,
  type ScrapeJobResult,
  type SettingsUpdate,
} from '../api';
import {
  CheckIcon,
  CloseIcon,
  FolderIcon,
  GlobeIcon,
  LanIcon,
  MonitorIcon,
  MoonIcon,
  MusicIcon,
  ScanIcon,
  SunIcon,
  TimerIcon,
} from '../icons';
import {
  isDesktopShell,
  readPreventSleep,
  writePreventSleep,
} from '../desktop';
import { PALETTE_OPTIONS, type Palette, type Theme } from '../theme';
import {
  AUDIO_PRIORITY_OPTIONS,
  HOME_GRID_OPTIONS,
  usePreferences,
} from '../preferences';
import { BrandMark } from './BrandMark';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  health: Health | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  palette: Palette;
  onPaletteChange: (palette: Palette) => void;
  onLibraryChanged: () => void;
  onAccountChanged: () => void;
  onAccessChanged: () => void;
  onLoggedOut: () => void;
}

function scanSummary(result: ScanResult): string {
  const parts = [
    `扫描完成：${result.worksFound} 部作品 / ${result.tracksFound} 条音轨`,
    `用时 ${(result.durationMs / 1000).toFixed(1)} 秒`,
  ];
  if (result.worksAdded > 0) {
    parts.push(`新增 ${result.worksAdded} 部`);
  }
  if (result.worksUpdated > 0) {
    parts.push(`更新 ${result.worksUpdated} 部`);
  }
  if (result.skippedDuplicates > 0) {
    parts.push(`跳过重复 ${result.skippedDuplicates} 部`);
  }
  return parts.join('，');
}

function scrapeSummary(result: ScrapeJobResult): string {
  const ok = result.results.filter(
    (item) => item.status === 'ok' || item.status === 'partial',
  ).length;
  const coverFailed = result.results.filter((item) => item.cover === 'failed').length;
  const parts = [`刮削完成：成功 ${ok} 部`];
  if (result.cached > 0) {
    parts.push(`负缓存跳过 ${result.cached} 部`);
  }
  if (result.failed > 0) {
    parts.push(`失败 ${result.failed} 部`);
  }
  if (coverFailed > 0) {
    parts.push(`封面失败 ${coverFailed} 部`);
  }
  return parts.join('，');
}

const MAX_LIBRARY_ROOTS = 8;

function rootKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function SettingsDialog({
  open,
  onClose,
  health,
  theme,
  onThemeChange,
  palette,
  onPaletteChange,
  onLibraryChanged,
  onAccountChanged,
  onAccessChanged,
  onLoggedOut,
}: SettingsDialogProps) {
  const [, setSettings] = useState<AppSettings | null>(null);
  const [preferences, updatePreferences] = usePreferences();
  const [roots, setRoots] = useState<string[]>([]);
  const [rootStats, setRootStats] = useState<Record<string, number>>({});
  const [rootsBusy, setRootsBusy] = useState(false);
  const [rootsNote, setRootsNote] = useState('');
  const [proxyInput, setProxyInput] = useState('');
  const [ffprobeInput, setFfprobeInput] = useState('');
  const [ffmpegInput, setFfmpegInput] = useState('');
  const [baseInput, setBaseInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [scanError, setScanError] = useState('');
  const [savingParams, setSavingParams] = useState(false);
  const [paramsNote, setParamsNote] = useState('');
  const [scrapeJob, setScrapeJob] = useState<Job<ScrapeJobResult> | null>(null);
  const [scrapeJobId, setScrapeJobId] = useState<number | null>(null);
  const [scrapingRoot, setScrapingRoot] = useState('');
  const [scrapeForce, setScrapeForce] = useState(false);
  const [scrapeError, setScrapeError] = useState('');
  const [account, setAccount] = useState<OnlineAccount | null>(null);
  const [onlineUser, setOnlineUser] = useState('');
  const [onlinePass, setOnlinePass] = useState('');
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineNote, setOnlineNote] = useState('');
  const [onlineError, setOnlineError] = useState('');
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [preventSleepInput, setPreventSleepInput] = useState(true);
  const desktopShell = isDesktopShell();
  const [lanInput, setLanInput] = useState(false);
  const [lanPassword, setLanPassword] = useState('');
  const [lanCurrentPassword, setLanCurrentPassword] = useState('');
  const [lanBusy, setLanBusy] = useState(false);
  const [lanNote, setLanNote] = useState('');
  const [lanError, setLanError] = useState('');
  const [copiedValue, setCopiedValue] = useState('');
  const onLibraryChangedRef = useRef(onLibraryChanged);
  onLibraryChangedRef.current = onLibraryChanged;

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setOnlinePass('');
    setOnlineNote('');
    setOnlineError('');
    setLanPassword('');
    setLanCurrentPassword('');
    setLanNote('');
    setLanError('');
    setCopiedValue('');
    setPreventSleepInput(readPreventSleep());
    getSettings()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setSettings(data);
        setRoots(
          data.libraryPaths.length > 0
            ? data.libraryPaths
            : data.libraryPath
              ? [data.libraryPath]
              : [],
        );
        setProxyInput(data.proxyUrl);
        setFfprobeInput(data.ffprobePath);
        setFfmpegInput(data.ffmpegPath);
        setBaseInput(data.asmroneBaseUrl);
      })
      .catch(() => undefined);
    getLibraryRoots()
      .then(({ roots: items }) => {
        if (!cancelled) {
          setRootStats(
            Object.fromEntries(items.map((item) => [rootKey(item.path), item.workCount])),
          );
        }
      })
      .catch(() => undefined);
    getOnlineAccount()
      .then((data) => {
        if (!cancelled) {
          setAccount(data);
        }
      })
      .catch(() => undefined);
    getAccessInfo()
      .then((data) => {
        if (!cancelled) {
          setAccess(data);
          setLanInput(data.lanEnabled);
        }
      })
      .catch(() => undefined);
    getNetworkInfo()
      .then((data) => {
        if (!cancelled) {
          setNetwork(data);
        }
      })
      .catch(() => undefined);
    listJobs<ScrapeJobResult>({ type: 'scrape', limit: 1 })
      .then(({ items }) => {
        if (cancelled) {
          return;
        }
        const latest = items[0];
        if (!latest) {
          return;
        }
        setScrapeJob(latest);
        if (latest.status === 'running' || latest.status === 'queued') {
          setScrapeJobId(latest.id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (scrapeJobId === null) {
      return;
    }
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const job = await getJob<ScrapeJobResult>(scrapeJobId);
        if (cancelled) {
          return;
        }
        setScrapeJob(job);
        if (job.status === 'done' || job.status === 'failed') {
          setScrapeJobId(null);
          setScrapingRoot('');
          onLibraryChangedRef.current();
          return;
        }
        timer = window.setTimeout(() => void tick(), 1500);
      } catch (error) {
        if (!cancelled) {
          setScrapeError(error instanceof Error ? error.message : String(error));
          setScrapeJobId(null);
        }
      }
    };
    timer = window.setTimeout(() => void tick(), 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scrapeJobId]);

  if (!open) {
    return null;
  }

  const runningScrape =
    scrapingRoot !== '' ||
    (scrapeJobId !== null &&
      (scrapeJob === null || scrapeJob.status === 'queued' || scrapeJob.status === 'running'));

  const loadRootStats = async () => {
    try {
      const { roots: items } = await getLibraryRoots();
      setRootStats(
        Object.fromEntries(items.map((item) => [rootKey(item.path), item.workCount])),
      );
    } catch {
      // 统计失败不影响扫描与设置保存，保持旧值即可。
    }
  };

  const cleanRoots = (): string[] => roots.map((root) => root.trim()).filter(Boolean);

  const saveRoots = async (): Promise<AppSettings | null> => {
    setRootsBusy(true);
    setRootsNote('');
    setScanError('');
    try {
      const next = await updateSettings({ libraryPaths: cleanRoots() });
      setSettings(next);
      setRoots(next.libraryPaths);
      setRootsNote('库根已保存');
      await loadRootStats();
      onLibraryChanged();
      return next;
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setRootsBusy(false);
    }
  };

  const runScan = async (target: string) => {
    const rootPath = target.trim();
    if (!rootPath || scanning) {
      return;
    }
    setScanning(true);
    setScanError('');
    setScanNote('');
    setRootsNote('');
    try {
      await updateSettings({ libraryPaths: cleanRoots() });
      const result = await scanLibrary(rootPath);
      const next = await getSettings();
      setSettings(next);
      setRoots(next.libraryPaths);
      setScanNote(`${result.rootPath}：${scanSummary(result)}`);
      await loadRootStats();
      onLibraryChanged();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const saveParams = async () => {
    setSavingParams(true);
    setParamsNote('');
    setScanError('');
    try {
      const next = await updateSettings({
        proxyUrl: proxyInput,
        ffprobePath: ffprobeInput,
        ffmpegPath: ffmpegInput,
        asmroneBaseUrl: baseInput,
      });
      setSettings(next);
      setParamsNote('设置已保存');
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingParams(false);
    }
  };

  const runScrape = async (
    options: { rootPath?: string; codes?: string[]; force?: boolean } = {},
  ) => {
    const { rootPath, codes, force } = options;
    setScrapingRoot(rootPath ?? 'all');
    setScrapeForce(force === true);
    setScrapeError('');
    setScrapeJob(null);
    try {
      if (rootPath) {
        await updateSettings({ libraryPaths: cleanRoots() });
      }
      const payload: { rootPath?: string; codes?: string[]; force?: boolean } = {};
      if (rootPath) {
        payload.rootPath = rootPath;
      }
      if (codes && codes.length > 0) {
        payload.codes = codes;
      }
      if (force) {
        payload.force = true;
      }
      const { jobId } = await startScrape(payload);
      setScrapeJobId(jobId);
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : String(err));
      setScrapingRoot('');
    }
  };

  const login = async () => {
    if (onlineBusy) {
      return;
    }
    setOnlineBusy(true);
    setOnlineError('');
    setOnlineNote('');
    try {
      const result = await loginOnline(onlineUser.trim(), onlinePass);
      setAccount({
        connected: true,
        username: result.username,
        updatedAt: new Date().toISOString(),
      });
      setOnlineUser(result.username);
      setOnlinePass('');
      setOnlineNote(`已连接 asmr.one：${result.username}`);
      onAccountChanged();
    } catch (err) {
      setOnlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setOnlineBusy(false);
    }
  };

  const logout = async () => {
    if (onlineBusy) {
      return;
    }
    setOnlineBusy(true);
    setOnlineError('');
    setOnlineNote('');
    try {
      await logoutOnline();
      setAccount({ connected: false, username: '', updatedAt: '' });
      setOnlineNote('已退出 asmr.one');
      onAccountChanged();
    } catch (err) {
      setOnlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setOnlineBusy(false);
    }
  };

  const waitForAccess = async (): Promise<AccessInfo | null> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const info = await getAccessInfo();
        setAccess(info);
        if (!info.restartRequired) {
          return info;
        }
      } catch {
        // 服务正在关闭旧监听并重新绑定，稍后重试。
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
    return null;
  };

  const copyText = async (value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedValue(value);
      window.setTimeout(() => setCopiedValue(''), 2000);
    } catch {
      setLanError('复制失败，请手动选择文本复制');
    }
  };

  const saveLan = async () => {
    if (lanBusy) {
      return;
    }
    setLanBusy(true);
    setLanError('');
    setLanNote('');
    try {
      const payload: SettingsUpdate = { lanEnabled: lanInput };
      if (lanPassword) {
        payload.password = lanPassword;
        payload.currentPassword = lanCurrentPassword;
      }
      const next = await updateSettings(payload);
      setSettings(next);
      setLanInput(next.lanEnabled);
      setLanPassword('');
      setLanCurrentPassword('');
      onAccessChanged();
      setLanNote(next.restartRequired ? '正在切换监听地址…' : '设置已保存');
      const info = await waitForAccess();
      if (info) {
        setLanNote(info.lanEnabled ? '局域网访问已就绪' : '已切换为仅本机访问');
      } else {
        setLanNote('监听地址切换超时，请重启应用后重试');
      }
    } catch (err) {
      setLanError(err instanceof Error ? err.message : String(err));
    } finally {
      setLanBusy(false);
    }
  };

  const logoutAccess = async () => {
    if (lanBusy) {
      return;
    }
    setLanBusy(true);
    setLanError('');
    try {
      await logoutSession();
      onLoggedOut();
      onClose();
    } catch (err) {
      setLanError(err instanceof Error ? err.message : String(err));
    } finally {
      setLanBusy(false);
    }
  };

  const scrapeResult =
    scrapeJob?.result && Array.isArray(scrapeJob.result.results) ? scrapeJob.result : null;
  const retryCodes = scrapeResult
    ? [
        ...new Set(
          scrapeResult.results
            .filter((item) => item.status !== 'ok' || item.cover === 'failed')
            .map((item) => item.code),
        ),
      ]
    : [];
  const progress = Math.round((scrapeJob?.progress ?? 0) * 100);

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-head">
          <h2 id="settings-title">设置</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭设置">
            <CloseIcon />
          </button>
        </header>

        <p className="settings-label">本地曲库</p>
        <section className="settings-card">
          <p className="settings-path">
            {roots.length > 0
              ? `已配置 ${roots.length} 个库根 · 合并显示 ${health?.workCount ?? 0} 部作品`
              : '尚未配置曲库目录'}
          </p>
          <div className="settings-stats">
            <span className="stat-pill">{health ? `${health.workCount} 部作品` : '服务未连接'}</span>
            <span className="stat-pill">SQLite 索引</span>
            {health ? <span className="stat-pill">v{health.version}</span> : null}
          </div>
          <div className="settings-roots">
            {roots.length === 0 ? (
              <p className="settings-hint settings-roots-empty">还没有库根，先添加一个目录。</p>
            ) : null}
            {roots.map((root, index) => {
              const count = rootStats[rootKey(root)];
              return (
                <div className="settings-root-row" key={index}>
                  <input
                    value={root}
                    onChange={(event) =>
                      setRoots((previous) =>
                        previous.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      )
                    }
                    placeholder="例如 K:/音频 或 X:/ASMR"
                    aria-label={`库根 ${index + 1}`}
                  />
                  <span className="settings-root-count">
                    {count === undefined ? '未扫描' : `${count} 部`}
                  </span>
                  <div className="settings-root-actions">
                    <button
                      type="button"
                      className="btn btn-tonal btn-compact"
                      onClick={() => void runScan(root)}
                      disabled={scanning || rootsBusy || !root.trim()}
                    >
                      <ScanIcon className={scanning ? 'spin' : ''} />
                      扫描
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      onClick={() => void runScrape({ rootPath: root })}
                      disabled={runningScrape || rootsBusy || !root.trim()}
                    >
                      刮削
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      onClick={() =>
                        setRoots((previous) =>
                          previous.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      disabled={rootsBusy || scanning}
                      aria-label={`移除库根 ${index + 1}`}
                    >
                      移除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="settings-roots-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setRoots((previous) => [...previous, ''])}
              disabled={roots.length >= MAX_LIBRARY_ROOTS || rootsBusy || scanning}
            >
              添加库根
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void saveRoots()}
              disabled={rootsBusy || scanning}
            >
              {rootsBusy ? '保存中…' : '保存库根'}
            </button>
          </div>
          <p className="settings-hint">
            每个库根单独扫描、单独刮削，主界面合并展示；同一RJ号只保留先入库的库根。
            目录名带 RJ / BJ / VJ 即可识别，不会移动或重命名文件。最多 {MAX_LIBRARY_ROOTS} 个库根。
          </p>
          {rootsNote ? (
            <div className="notice notice--inline" role="status">
              <CheckIcon />
              <span>{rootsNote}</span>
            </div>
          ) : null}
          {scanNote ? (
            <div className="notice notice--inline" role="status">
              <CheckIcon />
              <span>{scanNote}</span>
            </div>
          ) : null}
          {scanError ? (
            <div className="notice notice--error notice--inline" role="alert">
              <span>{scanError}</span>
            </div>
          ) : null}
        </section>

        <p className="settings-label">本地库偏好</p>
        <section className="settings-card">
          <label className="settings-toggle">
            <span className="settings-toggle-text">
              <span className="settings-toggle-title">
                <FolderIcon />
                智能路径
              </span>
              <small>打开作品后，自动进入包含音频的文件夹。</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.smartPath}
              onChange={(event) =>
                updatePreferences({ smartPath: event.target.checked })
              }
              aria-label="智能路径"
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </label>
          <label className="settings-toggle">
            <span className="settings-toggle-text">
              <span className="settings-toggle-title">效果音偏好</span>
              <small>有多个差分目录时，优先进入包含效果音的文件夹。</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.preferEffectSound}
              onChange={(event) =>
                updatePreferences({ preferEffectSound: event.target.checked })
              }
              aria-label="效果音偏好"
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </label>
          <div className="settings-preference-grid">
            <label className="settings-field">
              <span className="settings-field-title">
                <MusicIcon />
                音频类型偏好
              </span>
              <select
                value={preferences.audioPriority}
                onChange={(event) =>
                  updatePreferences({
                    audioPriority: event.target.value as typeof preferences.audioPriority,
                  })
                }
              >
                {AUDIO_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>智能路径优先选择该类型音频所在的文件夹。</small>
            </label>
            <label className="settings-field">
              <span>本地首页卡片密度</span>
              <select
                value={preferences.localHomeGrid}
                onChange={(event) =>
                  updatePreferences({
                    localHomeGrid: event.target.value as typeof preferences.localHomeGrid,
                  })
                }
              >
                {HOME_GRID_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>仅作用于本地首页的作品网格。</small>
            </label>
          </div>
        </section>

        <p className="settings-label">在线偏好</p>
        <section className="settings-card">
          <div className="settings-preference-grid">
            <label className="settings-field">
              <span className="settings-field-title">
                <MusicIcon />
                在线音频类型偏好
              </span>
              <select
                value={preferences.onlineAudioPriority}
                onChange={(event) =>
                  updatePreferences({
                    onlineAudioPriority:
                      event.target.value as typeof preferences.onlineAudioPriority,
                  })
                }
              >
                {AUDIO_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>在线试听优先从该格式的音轨开始；没有该格式时使用第一条。</small>
            </label>
            <label className="settings-field">
              <span>在线首页卡片密度</span>
              <select
                value={preferences.onlineHomeGrid}
                onChange={(event) =>
                  updatePreferences({
                    onlineHomeGrid: event.target.value as typeof preferences.onlineHomeGrid,
                  })
                }
              >
                {HOME_GRID_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>仅作用于 asmr.one 首页；本地首页在上方单独设置。</small>
            </label>
          </div>
        </section>

        <p className="settings-label">元数据刮削</p>
        <section className="settings-card">
          <p className="settings-hint">
            从 DLsite 拉取标题、社团、发售日、标签与封面。首次扫描后会请求一次 50 部作品大约需要 1～3
            分钟；失败会进入负缓存（网络类约 10 分钟），期间普通刮削会跳过这些作品，可稍后用「强制重试」立即重新请求。也可以在上方对单个库根点「刮削」。
          </p>
          <div className="scrape-status">
            <span className="stat-pill">
              {runningScrape
                ? `进行中 ${progress}%${
                    scrapingRoot && scrapingRoot !== 'all'
                      ? ` · ${scrapingRoot}`
                      : scrapeForce
                        ? ' · 强制重试'
                        : ''
                  }`
                : scrapeJob?.status === 'failed'
                  ? '上次任务失败'
                  : scrapeJob?.status === 'done'
                    ? '上次任务完成'
                    : '尚未运行'}
            </span>
            {scrapeResult ? <span className="stat-pill">{scrapeResult.total} 部已处理</span> : null}
          </div>
          {runningScrape ? (
            <div className="scrape-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          ) : null}
          {scrapeResult ? (
            <p className="settings-hint">{scrapeSummary(scrapeResult)}</p>
          ) : null}
          {scrapeJob?.lastError ? (
            <div className="notice notice--error notice--inline" role="alert">
              <span>{scrapeJob.lastError}</span>
            </div>
          ) : null}
          {scrapeError ? (
            <div className="notice notice--error notice--inline" role="alert">
              <span>{scrapeError}</span>
            </div>
          ) : null}
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-tonal settings-scan"
              onClick={() => void runScrape()}
              disabled={runningScrape || !health}
            >
              <ScanIcon className={runningScrape ? 'spin' : ''} />
              {runningScrape ? '刮削中…' : '刮削全部作品'}
            </button>
            {retryCodes.length > 0 ? (
              <button
                type="button"
                className="btn btn-ghost settings-scan"
                onClick={() => void runScrape({ codes: retryCodes, force: true })}
                disabled={runningScrape}
                title="忽略负缓存，重新请求未成功的作品"
              >
                <ScanIcon className={runningScrape && scrapeForce ? 'spin' : ''} />
                强制重试未完成 {retryCodes.length} 部
              </button>
            ) : null}
          </div>
        </section>

        <p className="settings-label">asmr.one 在线账号</p>
        <section className="settings-card">
          <div className="scrape-status">
            <span className="stat-pill">
              <GlobeIcon />
              {account?.connected ? `已连接 ${account.username}` : '未登录（可浏览公开作品）'}
            </span>
          </div>
          <p className="settings-hint">
            未登录也可以搜索和试听公开作品；登录后可以访问需要账号的内容。token
            加密保存在本机数据库，密码不会写入，也不会出现在浏览器里。
          </p>
          {account?.connected ? (
            <button
              type="button"
              className="btn btn-tonal settings-scan"
              onClick={() => void logout()}
              disabled={onlineBusy}
            >
              <GlobeIcon />
              {onlineBusy ? '退出中…' : '退出 asmr.one 登录'}
            </button>
          ) : (
            <>
              <label className="settings-field">
                <span>用户名</span>
                <input
                  value={onlineUser}
                  onChange={(event) => setOnlineUser(event.target.value)}
                  placeholder="asmr.one 用户名"
                  autoComplete="username"
                  aria-label="asmr.one 用户名"
                />
              </label>
              <label className="settings-field">
                <span>密码</span>
                <input
                  type="password"
                  value={onlinePass}
                  onChange={(event) => setOnlinePass(event.target.value)}
                  placeholder="只用于换取 token，不会保存"
                  autoComplete="current-password"
                  aria-label="asmr.one 密码"
                />
              </label>
              <button
                type="button"
                className="btn btn-primary settings-scan"
                onClick={() => void login()}
                disabled={onlineBusy || !onlineUser.trim() || !onlinePass}
              >
                <GlobeIcon className={onlineBusy ? 'spin' : ''} />
                {onlineBusy ? '连接中…' : '登录 asmr.one'}
              </button>
              <p className="settings-hint">
                首次登录可能会在 asmr.one 自动注册账号；请确认你有权使用该账号后再继续。
              </p>
            </>
          )}
          {onlineNote ? (
            <div className="notice notice--inline" role="status">
              <CheckIcon />
              <span>{onlineNote}</span>
            </div>
          ) : null}
          {onlineError ? (
            <div className="notice notice--error notice--inline" role="alert">
              <span>{onlineError}</span>
            </div>
          ) : null}
        </section>

        <p className="settings-label">网络与工具</p>
        <section className="settings-card">
          <label className="settings-field">
            <span>HTTP 代理（可选）</span>
            <input
              value={proxyInput}
              onChange={(event) => setProxyInput(event.target.value)}
              placeholder="http://127.0.0.1:7890"
              aria-label="HTTP 代理"
            />
          </label>
          <label className="settings-field">
            <span>asmr.one API 地址（可选）</span>
            <input
              value={baseInput}
              onChange={(event) => setBaseInput(event.target.value)}
              placeholder="留空自动发现，例如 https://api.asmr-200.com"
              aria-label="asmr.one API 地址"
            />
          </label>
          <label className="settings-field">
            <span>ffprobe 路径</span>
            <input
              value={ffprobeInput}
              onChange={(event) => setFfprobeInput(event.target.value)}
              placeholder="ffprobe 或 D:/ffmpeg/bin/ffprobe.exe"
              aria-label="ffprobe 路径"
            />
          </label>
          <label className="settings-field">
            <span>ffmpeg 路径</span>
            <input
              value={ffmpegInput}
              onChange={(event) => setFfmpegInput(event.target.value)}
              placeholder="ffmpeg 或 D:/ffmpeg/bin/ffmpeg.exe"
              aria-label="ffmpeg 路径"
            />
          </label>
          <button
            type="button"
            className="btn btn-tonal settings-scan"
            onClick={() => void saveParams()}
            disabled={savingParams}
          >
            {savingParams ? '保存中…' : '保存网络与工具设置'}
          </button>
          <p className="settings-hint">
            代理用于访问 DLsite 与 asmr.one；ffprobe 读取音轨时长，ffmpeg 生成 240 / 600
            像素封面缩略图。asmr.one API 地址留空时会自动发现当前可用域名。
          </p>
          {paramsNote ? (
            <div className="notice notice--inline" role="status">
              <CheckIcon />
              <span>{paramsNote}</span>
            </div>
          ) : null}
        </section>

        <p className="settings-label">局域网访问</p>
        <section className="settings-card">
          <label className="settings-toggle">
            <span className="settings-toggle-text">
              <span className="settings-toggle-title">
                <LanIcon />
                允许局域网内设备访问
              </span>
              <small>手机、平板与同一 Wi-Fi 下的电脑可在浏览器中打开曲库。</small>
            </span>
            <input
              type="checkbox"
              checked={lanInput}
              onChange={(event) => setLanInput(event.target.checked)}
              disabled={lanBusy}
              aria-label="允许局域网内设备访问"
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </label>
          <label className="settings-field">
            <span>{access?.hasPassword ? '修改访问密码（留空保持不变）' : '设置访问密码'}</span>
            <input
              type="password"
              value={lanPassword}
              onChange={(event) => setLanPassword(event.target.value)}
              placeholder={access?.hasPassword ? '留空则不修改' : '至少 8 个字符'}
              autoComplete="new-password"
              aria-label="访问密码"
              disabled={lanBusy}
            />
          </label>
          {access?.hasPassword && access.lanEnabled ? (
            <label className="settings-field">
              <span>当前密码（修改密码时必填）</span>
              <input
                type="password"
                value={lanCurrentPassword}
                onChange={(event) => setLanCurrentPassword(event.target.value)}
                placeholder="修改访问密码时填写"
                autoComplete="current-password"
                aria-label="当前访问密码"
                disabled={lanBusy}
              />
            </label>
          ) : null}
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void saveLan()}
              disabled={lanBusy}
            >
              {lanBusy ? '保存中…' : lanInput ? '保存并开启' : '保存局域网设置'}
            </button>
            {access?.lanEnabled ? (
              <button
                type="button"
                className="btn btn-tonal"
                onClick={() => void logoutAccess()}
                disabled={lanBusy}
              >
                退出登录
              </button>
            ) : null}
          </div>
          {lanNote ? (
            <div className="notice notice--inline" role="status">
              <CheckIcon />
              <span>{lanNote}</span>
            </div>
          ) : null}
          {lanError ? (
            <div className="notice notice--error notice--inline" role="alert">
              <span>{lanError}</span>
            </div>
          ) : null}
          {lanInput ? (
            <div className="lan-urls">
              <p className="settings-hint">
                {access?.lanEnabled
                  ? '手机连接同一 Wi-Fi 或 Tailscale 后打开：'
                  : '保存并开启后，手机连接同一 Wi-Fi 或 Tailscale 打开：'}
              </p>
              {access && access.addresses.length > 0 ? (
                access.addresses.map((item) => (
                  <div className="lan-url-row" key={item.address}>
                    <code>{item.url}</code>
                    <span className="lan-url-name">{item.name}</span>
                    <button
                      type="button"
                      className="btn btn-tonal lan-copy"
                      onClick={() => void copyText(item.url)}
                    >
                      {copiedValue === item.url ? '已复制' : '复制'}
                    </button>
                  </div>
                ))
              ) : (
                <p className="settings-hint">
                  未检测到局域网地址，请确认电脑已连接路由器或 Wi-Fi。
                </p>
              )}
              <details className="lan-install">
                <summary>添加到手机主屏幕</summary>
                <p>iPhone / iPad（Safari）：分享按钮 → 添加到主屏幕。</p>
                <p>Android（Chrome）：右上角菜单 → 添加到主屏幕。</p>
                <p>局域网 HTTP 地址可能不显示“安装应用”，添加快捷方式同样可用。</p>
              </details>
            </div>
          ) : null}
          <p className="settings-hint">
            开启后所有设备都需要登录；本机浏览器会自动保持登录，其他设备首次访问需输入密码。密码在本机使用
            scrypt 加盐保存。局域网内是 HTTP
            明文传输，建议只在可信家庭网络使用，远程访问请配合 Tailscale
            等组网工具。电脑关机或休眠后手机无法连接，本应用不代发远程唤醒包。
          </p>
        </section>

        <p className="settings-label">唤醒与电源</p>
        <section className="settings-card">
          {desktopShell ? (
            <>
              <label className="settings-toggle">
                <span className="settings-toggle-text">
                  <span className="settings-toggle-title">
                    <TimerIcon />
                    播放时阻止系统睡眠
                  </span>
                  <small>仅影响当前桌面端；暂停或结束后恢复系统电源计划。</small>
                </span>
                <input
                  type="checkbox"
                  checked={preventSleepInput}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setPreventSleepInput(next);
                    writePreventSleep(next);
                  }}
                  aria-label="播放时阻止系统睡眠"
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
              </label>
              <p className="settings-hint">
                桌面端在音频播放期间会请求 Windows 保持运行，避免笔记本或台式机在长时间播放时休眠；关闭后完全遵循系统电源计划。手机与普通浏览器标签页受各自系统策略限制，无法保证后台持续播放。
              </p>
            </>
          ) : (
            <p className="settings-hint">
              桌面版在音频播放期间会自动阻止系统睡眠；当前通过浏览器访问，无法控制电脑电源策略。手机锁屏后是否继续播放由系统与浏览器决定。
            </p>
          )}
          <details className="lan-install wol-install">
            <summary>远程唤醒（WOL）设置说明</summary>
            <p>
              电脑关机或睡眠后，本应用与手机页面都不在线，因此应用不提供“一键远程唤醒”按钮。需要在路由器、NAS
              或其他常开设备上发送魔术包。
            </p>
            <p>
              1. 优先使用有线网卡；在主板 / BIOS 中开启 Wake on LAN、PCIe Wake 或 Power On by PCI-E。
            </p>
            <p>
              2. Windows 设备管理器 → 网络适配器 → 属性 → 电源管理，勾选“允许此设备唤醒计算机”；在电源选项里关闭“快速启动”。
            </p>
            <p>
              3. 用支持 WOL 的路由器页面，或在常开设备执行 <code>wakeonlan MAC地址</code> 发送魔术包。
            </p>
            <p>
              4. 跨网段或公网唤醒需要路由器广播转发、静态 ARP 或 VPN，成功率取决于硬件与网络，应用不承诺可用；Tailscale
              只能在电脑唤醒后建立连接，不能代替 WOL。魔术包本身不鉴权，请只在可信网络中开启。
            </p>
          </details>
          {network && network.interfaces.length > 0 ? (
            <div className="lan-urls">
              <p className="settings-hint">
                这台电脑的网卡 MAC（用于在路由器或常开设备上配置唤醒）：
              </p>
              {network.interfaces.map((item) => {
                const command = `wakeonlan ${item.mac}`;
                return (
                  <div className="lan-url-row" key={item.address}>
                    <code>{item.mac}</code>
                    <span className="lan-url-name">
                      {item.name} · {item.address}
                    </span>
                    <button
                      type="button"
                      className="btn btn-tonal lan-copy"
                      onClick={() => void copyText(command)}
                    >
                      {copiedValue === command ? '已复制' : '复制唤醒命令'}
                    </button>
                  </div>
                );
              })}
              <p className="settings-hint">
                命令格式为 <code>wakeonlan MAC地址</code>，适用于支持该命令的路由器、NAS 或 Linux
                设备；Windows 可使用第三方 WOL 工具发送同样格式的魔术包。
              </p>
            </div>
          ) : null}
        </section>

        <p className="settings-label">外观</p>
        <div className="theme-options">
          <button
            type="button"
            className={`theme-option${theme === 'light' ? ' is-active' : ''}`}
            onClick={() => onThemeChange('light')}
          >
            <span className="theme-swatch theme-swatch--light">
              <SunIcon />
            </span>
            <span className="theme-option-text">
              <strong>浅色</strong>
              <small>明亮清爽</small>
            </span>
            {theme === 'light' ? <CheckIcon className="theme-check" /> : null}
          </button>
          <button
            type="button"
            className={`theme-option${theme === 'dark' ? ' is-active' : ''}`}
            onClick={() => onThemeChange('dark')}
          >
            <span className="theme-swatch theme-swatch--dark">
              <MoonIcon />
            </span>
            <span className="theme-option-text">
              <strong>深色</strong>
              <small>夜间聆听</small>
            </span>
            {theme === 'dark' ? <CheckIcon className="theme-check" /> : null}
          </button>
          <button
            type="button"
            className={`theme-option${theme === 'system' ? ' is-active' : ''}`}
            onClick={() => onThemeChange('system')}
          >
            <span className="theme-swatch theme-swatch--system">
              <MonitorIcon />
            </span>
            <span className="theme-option-text">
              <strong>跟随系统</strong>
              <small>随系统自动切换</small>
            </span>
            {theme === 'system' ? <CheckIcon className="theme-check" /> : null}
          </button>
        </div>

        <p className="settings-label">主题色</p>
        <div className="palette-options">
          {PALETTE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`theme-option palette-option${palette === option.key ? ' is-active' : ''}`}
              onClick={() => onPaletteChange(option.key)}
            >
              <span
                className="palette-swatch"
                style={{ background: option.swatch }}
                aria-hidden="true"
              />
              <span className="theme-option-text">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {palette === option.key ? <CheckIcon className="theme-check" /> : null}
            </button>
          ))}
        </div>

        <p className="settings-label">关于</p>
        <section className="settings-card about-card">
          <div className="about-head">
            <span className="about-mark">
              <BrandMark />
            </span>
            <div>
              <strong>Kikoeru Next</strong>
              <p>本地优先的同人音声库</p>
            </div>
          </div>
          <p className="settings-hint">
            扫描、播放与续播都在本机完成。当前版本 {health?.version ?? '—'}，独立实现，MIT 许可。
          </p>
        </section>
      </div>
    </div>
  );
}
