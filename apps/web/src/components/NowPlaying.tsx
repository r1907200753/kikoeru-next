import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrackSummary, WorkDetail, WorkFileEntry } from '../api';
import { getOnlineWork, getWork, listWorkFiles, workFileUrl } from '../api';
import { coverPalette, formatBytes, formatTime } from '../format';
import {
  ChevronDownIcon,
  CloseIcon,
  EqualizerIcon,
  ExpandIcon,
  FileIcon,
  Forward10Icon,
  ImageIcon,
  ListIcon,
  MusicIcon,
  NextIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  PrevIcon,
  Rewind10Icon,
  SubtitleIcon,
  VideoIcon,
  VolumeIcon,
} from '../icons';
import type { PlayerApi } from '../player';
import {
  fetchSubtitle,
  findActiveCueIndex,
  formatCueTime,
  latestCueText,
  subtitleFormatLabel,
  type ParsedSubtitle,
} from '../subtitles';
import { folderQueueFor } from '../track-tree';
import {
  audioRelativePath,
  dirnameOf,
  filesInFolder,
  folderSubtitles,
  subtitlesForAudio,
} from '../work-files';
import { MediaViewer, type MediaViewerState } from './MediaViewer';
import { buildOnlinePlayerData } from '../online-player';
import { isDesktopShell } from '../desktop';
import { WorkCover } from './WorkCard';

const FILE_KIND_LABEL: Record<WorkFileEntry['kind'], string> = {
  audio: '音频',
  video: '视频',
  image: '图片',
  subtitle: '字幕',
  other: '文件',
};

function fileKindIcon(kind: WorkFileEntry['kind']) {
  switch (kind) {
    case 'audio':
      return <MusicIcon />;
    case 'video':
      return <VideoIcon />;
    case 'image':
      return <ImageIcon />;
    case 'subtitle':
      return <SubtitleIcon />;
    default:
      return <FileIcon />;
  }
}

function fileMeta(entry: WorkFileEntry): string {
  const parts = [FILE_KIND_LABEL[entry.kind]];
  if (entry.durationMs) {
    parts.push(formatTime(entry.durationMs));
  }
  parts.push(formatBytes(entry.size));
  return parts.join(' · ');
}

interface DocumentPictureInPictureApi {
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
  }): Promise<Window>;
}

function getDocumentPictureInPicture(): DocumentPictureInPictureApi | null {
  return (
    (
      window as typeof window & {
        documentPictureInPicture?: DocumentPictureInPictureApi;
      }
    ).documentPictureInPicture ?? null
  );
}

function updateDocPipText(pipWindow: Window, text: string): void {
  const line = pipWindow.document.querySelector<HTMLElement>('#np-doc-lyric');
  const target = line?.querySelector<HTMLElement>('span');
  if (!line || !target) {
    return;
  }
  const content = text.trim();
  const nextText = content || '♪';
  if (line.dataset.text === nextText) {
    return;
  }
  line.dataset.text = nextText;
  target.textContent = nextText;
  line.dataset.empty = content ? '0' : '1';
  line.style.fontSize = '';
  if (content) {
    const max = Math.max(15, Math.round((line.clientHeight || 110) * 0.22));
    const min = 12;
    for (let size = max; size >= min; size -= 1) {
      line.style.fontSize = `${size}px`;
      if (target.scrollHeight <= target.clientHeight + 1) {
        break;
      }
    }
  }
}

const DOC_PIP_ICONS = {
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
};

interface DocPipState {
  text: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  hasPrev: boolean;
  hasNext: boolean;
}

function syncDocPipWindow(pipWindow: Window, state: DocPipState): void {
  const doc = pipWindow.document;
  updateDocPipText(pipWindow, state.text);
  const toggle = doc.querySelector<HTMLButtonElement>('[data-action="toggle"]');
  if (toggle) {
    toggle.innerHTML = state.playing ? DOC_PIP_ICONS.pause : DOC_PIP_ICONS.play;
  }
  const prev = doc.querySelector<HTMLButtonElement>('[data-action="prev"]');
  if (prev) {
    prev.disabled = !state.hasPrev;
  }
  const next = doc.querySelector<HTMLButtonElement>('[data-action="next"]');
  if (next) {
    next.disabled = !state.hasNext;
  }
  const progress = doc.querySelector<HTMLInputElement>('#np-doc-progress');
  const max = Math.max(1, state.durationMs);
  if (progress) {
    progress.max = String(max);
    if (progress.dataset.dragging !== '1') {
      progress.value = String(Math.min(state.positionMs, max));
    }
  }
  const time = doc.querySelector<HTMLElement>('#np-doc-time');
  if (time) {
    time.textContent = `${formatTime(state.positionMs)} / ${formatTime(state.durationMs)}`;
  }
}

function fillStyle(percent: number): CSSProperties {
  return { '--fill': `${Math.min(100, Math.max(0, percent))}%` } as CSSProperties;
}

const LYRIC_FONT_FAMILY = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

function wrapLyricLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; overflow: boolean } {
  const lines: string[] = [];
  let line = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    const candidate = line + char;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      if (lines.length >= maxLines) {
        return { lines, overflow: true };
      }
      line = char;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return { lines, overflow: false };
}

const PIP_CANVAS_WIDTH = 840;
const PIP_CANVAS_HEIGHT = 360;
const PIP_ASPECT = PIP_CANVAS_WIDTH / PIP_CANVAS_HEIGHT;

function drawLyric(canvas: HTMLCanvasElement, text: string): void {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  const width = canvas.width;
  const height = canvas.height;
  const padding = Math.round(width * 0.04);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0d1418';
  context.fillRect(0, 0, width, height);

  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--primary')
    .trim();
  context.fillStyle = accent || '#2dd4bf';
  context.fillRect(padding, height - Math.round(height * 0.1), width - padding * 2, 4);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const content = text.replace(/\s+/g, ' ').trim();
  if (!content) {
    const placeholderSize = Math.max(12, Math.round(height * 0.15));
    context.font = `600 ${placeholderSize}px ${LYRIC_FONT_FAMILY}`;
    context.fillStyle = 'rgba(226, 240, 242, 0.38)';
    context.fillText('♪', width / 2, height / 2 - height * 0.02);
    return;
  }

  const maxWidth = width - padding * 2;
  const maxFontSize = Math.max(13, Math.round(height * 0.18));
  const minFontSize = Math.max(11, Math.round(height * 0.08));
  let fontSize = maxFontSize;
  let lines: string[] = [];
  let overflow = false;
  while (fontSize >= minFontSize) {
    context.font = `700 ${fontSize}px ${LYRIC_FONT_FAMILY}`;
    const wrapped = wrapLyricLines(context, content, maxWidth, 2);
    lines = wrapped.lines;
    overflow = wrapped.overflow;
    if (!overflow) {
      break;
    }
    fontSize -= 1;
  }
  if (overflow) {
    if (lines.length === 0) {
      lines = [content];
    }
    const lastIndex = Math.min(lines.length, 2) - 1;
    let last = lines[lastIndex] ?? '';
    const ellipsis = '…';
    while (last && context.measureText(last + ellipsis).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lastIndex] = `${last}${ellipsis}`;
  }
  if (lines.length === 0) {
    lines = [content];
  }

  const lineHeight = Math.round(fontSize * 1.26);
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2 - height * 0.02;
  lines.forEach((value, index) => {
    context.fillStyle = index === 0 && lines.length > 1 ? 'rgba(226, 240, 242, 0.78)' : '#f8fafc';
    context.fillText(value, width / 2, startY + index * lineHeight);
  });
}

export function NowPlaying({
  player,
  open,
  onClose,
}: {
  player: PlayerApi;
  open: boolean;
  onClose: () => void;
}) {
  const { current } = player;
  const [files, setFiles] = useState<WorkFileEntry[]>([]);
  const [filesError, setFilesError] = useState('');
  const [subtitlePath, setSubtitlePath] = useState('');
  const [subtitle, setSubtitle] = useState<ParsedSubtitle | null>(null);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [subtitleError, setSubtitleError] = useState('');
  const [sideMode, setSideMode] = useState<'subtitle' | 'playlist'>('subtitle');
  const [equalizerOpen, setEqualizerOpen] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [trackSwitching, setTrackSwitching] = useState(false);
  const [pipError, setPipError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [workDetail, setWorkDetail] = useState<WorkDetail | null>(null);
  const [viewer, setViewer] = useState<MediaViewerState | null>(null);
  const activeCueRef = useRef<HTMLButtonElement | null>(null);
  const lyricCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const docPipWindowRef = useRef<Window | null>(null);
  const activeTextRef = useRef('');
  const pipActiveRef = useRef(false);
  const trackSwitchGuardRef = useRef(false);
  const trackSwitchTimerRef = useRef<number | null>(null);
  const videoCommandRef = useRef<'play' | 'pause' | null>(null);
  const lastTrackIdRef = useRef(current?.track.id ?? null);

  const markPipActive = useCallback((value: boolean) => {
    pipActiveRef.current = value;
    setPipActive(value);
  }, []);

  const armTrackSwitch = useCallback(() => {
    trackSwitchGuardRef.current = true;
    setTrackSwitching(true);
    if (trackSwitchTimerRef.current !== null) {
      window.clearTimeout(trackSwitchTimerRef.current);
    }
    trackSwitchTimerRef.current = window.setTimeout(() => {
      trackSwitchGuardRef.current = false;
      setTrackSwitching(false);
      trackSwitchTimerRef.current = null;
    }, 3000);
  }, []);

  const releaseTrackSwitch = useCallback(() => {
    if (!trackSwitchGuardRef.current) {
      return;
    }
    if (trackSwitchTimerRef.current !== null) {
      window.clearTimeout(trackSwitchTimerRef.current);
    }
    trackSwitchTimerRef.current = window.setTimeout(() => {
      trackSwitchGuardRef.current = false;
      setTrackSwitching(false);
      trackSwitchTimerRef.current = null;
    }, 250);
  }, []);

  const markVideoCommand = useCallback((command: 'play' | 'pause') => {
    videoCommandRef.current = command;
    window.setTimeout(() => {
      if (videoCommandRef.current === command) {
        videoCommandRef.current = null;
      }
    }, 800);
  }, []);

  const workCode = current?.workCode ?? '';
  const workPath = current?.workPath ?? '';
  const detailTrack = current
    ? workDetail?.tracks.find((track) => track.id === current.track.id)
    : undefined;
  const activeTrack = detailTrack ?? current?.track;
  const effectiveWorkPath = workDetail?.relativePath ?? workPath;
  const audioPath = activeTrack ? audioRelativePath(activeTrack, effectiveWorkPath) : '';

  useEffect(() => {
    setWorkDetail(null);
    if (!workCode) {
      return;
    }
    let cancelled = false;
    if (current?.source === 'online') {
      setFiles([]);
      setFilesError('');
      getOnlineWork(workCode)
        .then((data) => {
          if (cancelled) {
            return;
          }
          const built = buildOnlinePlayerData(data);
          setWorkDetail(built.work);
          setFiles(built.files);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setFilesError(err instanceof Error ? err.message : String(err));
          }
        });
      return () => {
        cancelled = true;
      };
    }
    getWork(workCode)
      .then((detail) => {
        if (!cancelled) {
          setWorkDetail(detail);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workCode, current?.source]);

  useEffect(() => {
    if (!workCode || current?.source === 'online') {
      return;
    }
    setFiles([]);
    setFilesError('');
    let cancelled = false;
    listWorkFiles(workCode)
      .then((result) => {
        if (!cancelled) {
          setFiles(result.files);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFilesError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workCode, current?.source]);

  useEffect(() => {
    setSubtitlePath('');
    setSubtitle(null);
    setSubtitleError('');
  }, [workCode, current?.source]);

  useEffect(() => {
    if (!current || files.length === 0) {
      return;
    }
    const matches = subtitlesForAudio(files, audioPath);
    setSubtitlePath(matches[0]?.path ?? '');
  }, [files, audioPath, current]);

  const subtitleEntry = subtitlePath
    ? files.find((file) => file.path === subtitlePath)
    : undefined;
  const subtitleUrl =
    subtitleEntry?.url ??
    (subtitlePath && workCode ? workFileUrl(workCode, subtitlePath) : '');

  useEffect(() => {
    setSubtitle(null);
    setSubtitleError('');
    if (!subtitleUrl) {
      setSubtitleLoading(false);
      return;
    }
    let cancelled = false;
    setSubtitleLoading(true);
    const name = subtitlePath.split('/').pop() ?? subtitlePath;
    fetchSubtitle(subtitleUrl, name)
      .then((parsed) => {
        if (!cancelled) {
          setSubtitle(parsed);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSubtitleError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSubtitleLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [subtitleUrl, subtitlePath]);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    const video = pipVideoRef.current;
    if (!video) {
      return;
    }
    const onLeave = () => {
      markPipActive(false);
      video.pause();
    };
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => video.removeEventListener('leavepictureinpicture', onLeave);
  }, [markPipActive]);

  useEffect(() => {
    const id = current?.track.id ?? null;
    if (lastTrackIdRef.current === id) {
      return;
    }
    lastTrackIdRef.current = id;
    armTrackSwitch();
  }, [current?.track.id, current?.workCode, armTrackSwitch]);

  useEffect(() => {
    const audio = player.audioElement;
    if (!audio) {
      return;
    }
    const onLoadStart = () => armTrackSwitch();
    const onPlaying = () => releaseTrackSwitch();
    audio.addEventListener('loadstart', onLoadStart);
    audio.addEventListener('emptied', onLoadStart);
    audio.addEventListener('playing', onPlaying);
    return () => {
      audio.removeEventListener('loadstart', onLoadStart);
      audio.removeEventListener('emptied', onLoadStart);
      audio.removeEventListener('playing', onPlaying);
    };
  }, [player.audioElement, armTrackSwitch, releaseTrackSwitch]);

  useEffect(() => {
    const video = pipVideoRef.current;
    if (!video) {
      return;
    }
    // 视频画中画的原生控件只控制隐藏视频，这里把播放/暂停同步回主音频。
    const onPlay = () => {
      if (videoCommandRef.current === 'play') {
        videoCommandRef.current = null;
        return;
      }
      if (trackSwitchGuardRef.current) {
        return;
      }
      if (!pipActiveRef.current || document.pictureInPictureElement !== video) {
        return;
      }
      const audio = player.audioElement;
      if (audio?.paused) {
        player.toggle();
      }
    };
    const onPause = () => {
      if (videoCommandRef.current === 'pause') {
        videoCommandRef.current = null;
        return;
      }
      if (trackSwitchGuardRef.current) {
        return;
      }
      if (!pipActiveRef.current || document.pictureInPictureElement !== video) {
        return;
      }
      const audio = player.audioElement;
      if (audio && !audio.paused) {
        player.pause();
      }
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [player.audioElement, player.pause, player.toggle]);

  useEffect(() => {
    if (!pipActive || trackSwitching) {
      return;
    }
    const video = pipVideoRef.current;
    if (!video || document.pictureInPictureElement !== video) {
      return;
    }
    if (player.playing && video.paused) {
      markVideoCommand('play');
      void video.play().catch(() => {
        if (videoCommandRef.current === 'play') {
          videoCommandRef.current = null;
        }
      });
    } else if (!player.playing && !video.paused) {
      markVideoCommand('pause');
      video.pause();
    }
  }, [pipActive, player.playing, trackSwitching, markVideoCommand]);

  useEffect(() => {
    return () => {
      pipActiveRef.current = false;
      trackSwitchGuardRef.current = false;
      if (trackSwitchTimerRef.current !== null) {
        window.clearTimeout(trackSwitchTimerRef.current);
        trackSwitchTimerRef.current = null;
      }
      const docWindow = docPipWindowRef.current;
      docPipWindowRef.current = null;
      if (docWindow && !docWindow.closed) {
        docWindow.close();
      }
      const video = pipVideoRef.current;
      if (!video) {
        return;
      }
      if (document.pictureInPictureElement === video) {
        void document.exitPictureInPicture().catch(() => undefined);
      }
      video.pause();
      video.srcObject = null;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setViewer(null);
    }
  }, [open]);

  const folderTracks = useMemo(() => {
    if (!current || !activeTrack) {
      return [];
    }
    const directoryTracks =
      workDetail?.tracks ??
      (current.workTracks && current.workTracks.length > 0 ? current.workTracks : player.queue);
    return folderQueueFor(directoryTracks, effectiveWorkPath, activeTrack);
  }, [current, activeTrack, effectiveWorkPath, workDetail, player.queue]);

  const folderSubs = useMemo(
    () => (audioPath ? folderSubtitles(files, audioPath) : []),
    [files, audioPath],
  );

  const folderFiles = useMemo(() => {
    if (!audioPath) {
      return [];
    }
    return filesInFolder(files, dirnameOf(audioPath));
  }, [files, audioPath]);

  const trackById = useMemo(() => {
    const tracks = workDetail?.tracks ?? folderTracks;
    return new Map(tracks.map((track) => [track.id, track] as const));
  }, [workDetail, folderTracks]);

  const activeIndex = subtitle ? findActiveCueIndex(subtitle.cues, player.positionMs) : -1;
  const lyricText = subtitle ? latestCueText(subtitle.cues, player.positionMs) : '';
  activeTextRef.current = lyricText;

  useEffect(() => {
    const docWindow = docPipWindowRef.current;
    if (!docWindow || docWindow.closed) {
      return;
    }
    syncDocPipWindow(docWindow, {
      text: lyricText,
      playing: player.playing,
      positionMs: player.positionMs,
      durationMs: player.durationMs,
      hasPrev: player.hasPrev,
      hasNext: player.hasNext,
    });
  }, [
    lyricText,
    player.playing,
    player.positionMs,
    player.durationMs,
    player.hasPrev,
    player.hasNext,
  ]);

  useEffect(() => {
    if (activeIndex < 0 || !player.playing) {
      return;
    }
    activeCueRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex, player.playing]);

  useEffect(() => {
    if (!pipActive) {
      return;
    }
    const canvas = lyricCanvasRef.current;
    if (canvas) {
      drawLyric(canvas, lyricText);
    }
  }, [lyricText, pipActive]);

  if (!current) {
    return null;
  }

  const palette = coverPalette(current.workCode);
  const progress = player.durationMs > 0 ? (player.positionMs / player.durationMs) * 100 : 0;
  const trackIndex = folderTracks.findIndex((track) => track.id === current.track.id);

  const playFromFolder = (track: TrackSummary) => {
    if (track.id === current.track.id) {
      player.toggle();
      return;
    }
    player.play(track, {
      workId: current.workId,
      workCode: current.workCode,
      workTitle: current.workTitle,
      coverAssetId: current.coverAssetId ?? null,
      coverUrl: current.coverUrl ?? null,
      workPath: effectiveWorkPath || current.workPath || null,
      tracks: folderTracks,
      workTracks:
        workDetail?.tracks ??
        current.workTracks ??
        folderTracks,
      source: current.source,
    });
  };

  const openPlaylistFile = (entry: WorkFileEntry) => {
    if (entry.kind === 'audio') {
      const track = entry.trackId !== null ? trackById.get(entry.trackId) : undefined;
      if (track) {
        playFromFolder(track);
      }
      return;
    }
    if (entry.kind === 'video') {
      player.pause();
      setViewer({ kind: 'video', code: current.workCode, entry });
      return;
    }
    if (entry.kind === 'image') {
      const images = folderFiles.filter((file) => file.kind === 'image');
      const index = images.findIndex((file) => file.path === entry.path);
      setViewer({
        kind: 'image',
        code: current.workCode,
        items: images,
        index: Math.max(0, index),
      });
      return;
    }
    if (entry.kind === 'subtitle') {
      setSubtitlePath(entry.path);
      setSideMode('subtitle');
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // 浏览器可能因为权限或用户手势限制拒绝全屏。
    }
  };

  const stopPip = async () => {
    markPipActive(false);
    const docWindow = docPipWindowRef.current;
    docPipWindowRef.current = null;
    if (docWindow && !docWindow.closed) {
      docWindow.close();
    }
    const video = pipVideoRef.current;
    if (video && document.pictureInPictureElement === video) {
      await document.exitPictureInPicture().catch(() => undefined);
    }
  };

  const startVideoPip = async () => {
    const desktop = isDesktopShell();
    const video = pipVideoRef.current;
    const canvas = lyricCanvasRef.current;
    if (!video || !canvas) {
      return;
    }
    if (!document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== 'function') {
      setPipError(
        desktop
          ? '当前桌面端无法打开桌面歌词窗口，请重启应用后重试。'
          : '当前浏览器不支持桌面歌词窗口，请使用 Chrome 或 Edge。',
      );
      return;
    }
    drawLyric(canvas, lyricText);
    try {
      if (!video.srcObject) {
        video.srcObject = canvas.captureStream(12);
        video.muted = true;
        await video.play().catch(() => undefined);
      } else if (video.paused) {
        await video.play().catch(() => undefined);
      }
      const pipWindow = await video.requestPictureInPicture();
      markPipActive(true);
      pipWindow.addEventListener('resize', () => {
        const nextWidth = Math.max(320, Math.round(pipWindow.width * window.devicePixelRatio));
        canvas.width = nextWidth;
        canvas.height = Math.max(100, Math.round(nextWidth / PIP_ASPECT));
        drawLyric(canvas, activeTextRef.current);
      });
      drawLyric(canvas, activeTextRef.current);
    } catch {
      video.pause();
      setPipError(
        desktop
          ? '无法打开桌面歌词窗口，请稍后重试；若持续失败请重启应用。'
          : '无法打开桌面歌词窗口，请确认浏览器允许画中画。',
      );
    }
  };

  const startDocPip = async (api: DocumentPictureInPictureApi) => {
    const pipWindow = await api.requestWindow({
      width: 420,
      height: 180,
      disallowReturnToOpener: true,
    });
    if (pipWindow.closed) {
      throw new Error('Document PiP window is not available');
    }
    docPipWindowRef.current = pipWindow;
    const doc = pipWindow.document;
    doc.title = '桌面歌词';
    const style = doc.createElement('style');
    style.textContent = `
      html, body { margin: 0; height: 100%; overflow: hidden; background: #0d1418; color: #f8fafc; }
      #np-doc-root { position: relative; height: 100vh; overflow: hidden; }
      #np-doc-lyric {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        padding: 6px 10px; box-sizing: border-box; text-align: center; overflow: hidden;
        font: 700 clamp(15px, 12vh, 22px)/1.25 "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
        transition: transform 0.16s ease;
      }
      #np-doc-lyric span {
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        max-height: 100%; overflow: hidden; white-space: pre-wrap; word-break: break-word;
      }
      #np-doc-lyric[data-empty="1"] span { font-size: 0.6em; opacity: 0.42; }
      #np-doc-controls {
        position: absolute; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; gap: 2px;
        padding: 14px 10px 7px; background: linear-gradient(180deg, transparent 0%, rgba(13, 20, 24, 0.94) 34%);
        opacity: 0; transform: translateY(6px); pointer-events: none;
        transition: opacity 0.16s ease, transform 0.16s ease;
      }
      #np-doc-root:hover #np-doc-controls,
      #np-doc-controls:focus-within { opacity: 1; transform: none; pointer-events: auto; }
      #np-doc-root:hover #np-doc-lyric { transform: translateY(-20px); }
      #np-doc-progress-row { display: flex; align-items: center; gap: 8px; }
      #np-doc-progress { flex: 1; height: 12px; accent-color: #2dd4bf; cursor: pointer; }
      #np-doc-time { white-space: nowrap; color: #a6bac0; font: 10px ui-monospace, Consolas, monospace; }
      #np-doc-buttons { display: flex; align-items: center; justify-content: center; gap: 10px; }
      #np-doc-buttons button {
        display: grid; place-items: center; width: 28px; height: 28px; padding: 0;
        border: 0; border-radius: 50%; background: rgba(255, 255, 255, 0.08);
        color: #e8f2f4; font: 700 10px "Segoe UI", sans-serif; cursor: pointer;
      }
      #np-doc-buttons button.primary { width: 34px; height: 34px; background: #2dd4bf; color: #04262d; }
      #np-doc-buttons button:disabled { opacity: 0.3; cursor: default; }
      #np-doc-buttons svg { width: 14px; height: 14px; }
      @media (hover: none) {
        #np-doc-controls { opacity: 1; transform: none; pointer-events: auto; }
        #np-doc-lyric { transform: translateY(-20px); }
      }
    `;
    doc.head.appendChild(style);
    doc.body.innerHTML = `
      <div id="np-doc-root">
        <div id="np-doc-lyric"><span></span></div>
        <div id="np-doc-controls">
          <div id="np-doc-progress-row">
            <input id="np-doc-progress" type="range" min="0" max="1" step="100" value="0" aria-label="播放进度" />
            <span id="np-doc-time">0:00 / 0:00</span>
          </div>
          <div id="np-doc-buttons">
            <button type="button" data-action="prev" aria-label="上一首">${DOC_PIP_ICONS.prev}</button>
            <button type="button" data-action="rewind" aria-label="后退 10 秒">−10</button>
            <button type="button" data-action="toggle" class="primary" aria-label="播放 / 暂停">${DOC_PIP_ICONS.play}</button>
            <button type="button" data-action="forward" aria-label="前进 10 秒">+10</button>
            <button type="button" data-action="next" aria-label="下一首">${DOC_PIP_ICONS.next}</button>
          </div>
        </div>
      </div>
    `;
    doc.querySelector('[data-action="prev"]')?.addEventListener('click', () => player.prev());
    doc.querySelector('[data-action="rewind"]')?.addEventListener('click', () => player.seekBy(-10_000));
    doc.querySelector('[data-action="toggle"]')?.addEventListener('click', () => player.toggle());
    doc.querySelector('[data-action="forward"]')?.addEventListener('click', () => player.seekBy(10_000));
    doc.querySelector('[data-action="next"]')?.addEventListener('click', () => player.next());
    const progress = doc.querySelector<HTMLInputElement>('#np-doc-progress');
    progress?.addEventListener('input', () => {
      progress.dataset.dragging = '1';
      player.seek(Number(progress.value));
    });
    progress?.addEventListener('change', () => {
      progress.dataset.dragging = '';
    });
    pipWindow.addEventListener('pagehide', () => {
      if (docPipWindowRef.current === pipWindow) {
        docPipWindowRef.current = null;
      }
      markPipActive(false);
    });
    syncDocPipWindow(pipWindow, {
      text: lyricText,
      playing: player.playing,
      positionMs: player.positionMs,
      durationMs: player.durationMs,
      hasPrev: player.hasPrev,
      hasNext: player.hasNext,
    });
    markPipActive(true);
  };

  const togglePip = async () => {
    if (pipActive) {
      await stopPip();
      return;
    }
    setPipError('');
    if (!isDesktopShell()) {
      const docApi = getDocumentPictureInPicture();
      if (docApi) {
        try {
          await startDocPip(docApi);
          return;
        } catch {
          // 独立窗口不可用时回退到视频画中画。
        }
      }
    }
    await startVideoPip();
  };

  return (
    <>
      {open ? (
      <div
        className="now-playing"
        role="dialog"
        aria-modal="true"
        aria-label="正在播放"
        style={{ '--np-tint': palette.to } as CSSProperties}
      >
      <header className="np-topbar">
        <button type="button" className="np-close" onClick={onClose} aria-label="收起播放器">
          <ChevronDownIcon />
        </button>
        <h2>正在播放</h2>
        <a
          className="np-code"
          href={
            current.source === 'online'
              ? `#/online/${encodeURIComponent(current.workCode)}`
              : `#/work/${encodeURIComponent(current.workCode)}`
          }
          title="打开作品详情"
        >
          {current.workCode}
        </a>
      </header>

      <div className="np-layout">
        <section className="np-now">
          <div className="np-cover">
            <WorkCover
              code={current.workCode}
              coverAssetId={current.coverAssetId}
              size="player"
              {...(current.coverUrl ? { src: current.coverUrl } : {})}
            />
          </div>

          <div className="np-text">
            <div className="np-chips">
              {current.track.disc > 1 ? (
                <span className="mini-chip mini-chip--muted">Disc {current.track.disc}</span>
              ) : null}
              {current.track.variants.map((variant) => (
                <span className="mini-chip mini-chip--muted" key={variant}>
                  {variant}
                </span>
              ))}
              {trackIndex >= 0 ? (
                <span className="mini-chip">
                  第 {trackIndex + 1} / {folderTracks.length} 轨
                </span>
              ) : null}
            </div>
            <h1>{current.track.title}</h1>
            <p>{current.workTitle}</p>
          </div>

          <div className="np-progress">
            <input
              className="range range--lg"
              type="range"
              min={0}
              max={Math.max(1, player.durationMs)}
              step={100}
              value={Math.min(player.positionMs, Math.max(1, player.durationMs))}
              onChange={(event) => player.seek(Number(event.target.value))}
              style={fillStyle(progress)}
              aria-label="播放进度"
            />
            <div className="np-times">
              <span>{formatTime(player.positionMs)}</span>
              <span>{formatTime(player.durationMs)}</span>
            </div>
          </div>

          <div className="np-controls">
            <button
              type="button"
              className="np-skip np-skip--seek"
              onClick={() => player.seekBy(-10_000)}
              aria-label="后退 10 秒"
              title="后退 10 秒"
            >
              <Rewind10Icon />
            </button>
            <button
              type="button"
              className="np-skip"
              onClick={player.prev}
              disabled={!player.hasPrev}
              aria-label="上一首"
            >
              <PrevIcon />
            </button>
            <button
              type="button"
              className="np-play"
              onClick={player.toggle}
              aria-label={player.playing ? '暂停' : '播放'}
            >
              {player.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              className="np-skip"
              onClick={player.next}
              disabled={!player.hasNext}
              aria-label="下一首"
            >
              <NextIcon />
            </button>
            <button
              type="button"
              className="np-skip np-skip--seek"
              onClick={() => player.seekBy(10_000)}
              aria-label="前进 10 秒"
              title="前进 10 秒"
            >
              <Forward10Icon />
            </button>
          </div>

          <div className="np-extra">
            <div className="np-volume">
              <VolumeIcon />
              <input
                className="range range--sm"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={player.volume}
                onChange={(event) => player.setVolume(Number(event.target.value))}
                style={fillStyle(player.volume * 100)}
                aria-label="音量"
              />
            </div>
            <span className="np-queue-hint">
              <MusicIcon /> 当前文件夹 {folderFiles.length} 个文件 · {folderTracks.length} 轨 ·{' '}
              {current.workCode}
            </span>
          </div>
        </section>

        <aside className="np-side-panel">
          {sideMode === 'subtitle' ? (
            <>
              <div className="np-side-head">
                <div className="np-side-title">
                  <h3>
                    <SubtitleIcon /> 字幕
                  </h3>
                  <p>{current.track.title}</p>
                </div>
                <span className="mini-chip">
                  {subtitle ? `${subtitle.cues.length} 条` : '—'}
                </span>
              </div>

              <div className="np-subtitle-tools">
                <select
                  value={subtitlePath}
                  onChange={(event) => setSubtitlePath(event.target.value)}
                  disabled={folderSubs.length === 0}
                  aria-label="选择字幕"
                >
                  <option value="">不显示字幕</option>
                  {folderSubs.map((file) => (
                    <option key={file.path} value={file.path}>
                      {file.path}
                    </option>
                  ))}
                </select>
                {subtitle ? <span>{subtitleFormatLabel(subtitle.format)}</span> : null}
              </div>

              <div className="np-subtitle-body">
                {subtitleLoading ? <p className="np-empty">正在读取字幕…</p> : null}
                {subtitleError ? (
                  <div className="notice notice--error notice--inline" role="alert">
                    <span>{subtitleError}</span>
                  </div>
                ) : null}
                {filesError ? (
                  <div className="notice notice--error notice--inline" role="alert">
                    <span>{filesError}</span>
                  </div>
                ) : null}
                {!subtitleLoading && !subtitle && !subtitleError ? (
                  <div className="np-empty">
                    <SubtitleIcon />
                    <p>
                      {folderSubs.length > 0
                        ? '没有找到与当前音轨同名的字幕，可从上方下拉框手动选择。'
                        : '当前音轨没有字幕。把同名 .vtt / .srt / .lrc 文件放在音频旁边即可自动加载。'}
                    </p>
                  </div>
                ) : null}
                {subtitle && subtitle.cues.length > 0 ? (
                  <ol className="np-subtitle-list">
                    {subtitle.cues.map((cue, index) => (
                      <li key={`${cue.startMs}-${index}`}>
                        <button
                          type="button"
                          ref={index === activeIndex ? activeCueRef : undefined}
                          className={`np-subtitle-cue${index === activeIndex ? ' is-active' : ''}`}
                          onClick={() => player.seek(cue.startMs)}
                        >
                          <time>{formatCueTime(cue.startMs)}</time>
                          <span>{cue.text || '…'}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {subtitle && subtitle.cues.length === 0 ? (
                  <pre className="np-subtitle-plain">{subtitle.plain || '文件是空的。'}</pre>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="np-side-head">
                <div className="np-side-title">
                  <h3>
                    <ListIcon /> 播放列表
                  </h3>
                  <p>当前文件夹 · 音轨 {folderTracks.length} 轨</p>
                </div>
                <span className="mini-chip">{folderFiles.length} 个文件</span>
              </div>
              <div className="np-playlist-body">
                {filesError ? (
                  <div className="notice notice--error notice--inline" role="alert">
                    <span>{filesError}</span>
                  </div>
                ) : null}
                {!filesError && folderFiles.length === 0 ? (
                  <p className="np-empty">正在读取文件夹…</p>
                ) : null}
                {folderFiles.map((entry) => {
                  const track =
                    entry.trackId !== null ? trackById.get(entry.trackId) : undefined;
                  const active = track?.id === current.track.id;
                  const clickable =
                    Boolean(track) ||
                    entry.kind === 'video' ||
                    entry.kind === 'image' ||
                    entry.kind === 'subtitle';
                  return (
                    <button
                      type="button"
                      key={entry.path}
                      className={`np-playlist-item${active ? ' is-active' : ''}`}
                      onClick={() => openPlaylistFile(entry)}
                      disabled={!clickable}
                      title={
                        clickable ? entry.name : '此文件暂不支持在播放器内预览'
                      }
                    >
                      <span className="np-playlist-play">
                        {active && player.playing ? (
                          <PauseIcon />
                        ) : (
                          fileKindIcon(entry.kind)
                        )}
                      </span>
                      <span className="np-playlist-text">
                        <strong>{entry.name}</strong>
                        <span>{fileMeta(entry)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {pipError ? (
            <p className="np-pip-note" role="status">
              {pipError}
            </p>
          ) : null}

          <div className="np-side-toolbar">
            <button
              type="button"
              className={sideMode === 'subtitle' ? 'is-active' : ''}
              onClick={() => setSideMode('subtitle')}
              title="字幕"
            >
              <SubtitleIcon />
              <span>字幕</span>
            </button>
            <button
              type="button"
              className={sideMode === 'playlist' ? 'is-active' : ''}
              onClick={() => setSideMode('playlist')}
              title="播放列表"
            >
              <ListIcon />
              <span>播放列表</span>
            </button>
            <button
              type="button"
              className={pipActive ? 'is-active' : ''}
              onClick={() => void togglePip()}
              title="桌面歌词"
            >
              <PipIcon />
              <span>桌面歌词</span>
            </button>
            <button
              type="button"
              className={equalizerOpen ? 'is-active' : ''}
              onClick={() => setEqualizerOpen((value) => !value)}
              title="均衡器"
            >
              <EqualizerIcon />
              <span>均衡器</span>
            </button>
            <button type="button" onClick={() => void toggleFullscreen()} title="网页全屏">
              <ExpandIcon />
              <span>{isFullscreen ? '退出全屏' : '网页全屏'}</span>
            </button>
          </div>
        </aside>
      </div>

      {equalizerOpen ? (
        <div className="np-equalizer-panel" role="dialog" aria-label="均衡器">
          <div className="np-panel-head">
            <strong>均衡器</strong>
            <button
              type="button"
              onClick={() => setEqualizerOpen(false)}
              aria-label="关闭均衡器"
            >
              <CloseIcon />
            </button>
          </div>
          <label className="np-switch">
            <input
              type="checkbox"
              checked={player.channelSwap}
              onChange={(event) => player.setChannelSwap(event.target.checked)}
            />
            <span className="np-switch-track" aria-hidden="true">
              <span />
            </span>
            <span>左右声道交换</span>
          </label>
          <p>通过 Web Audio 实时交换左右声道。部分移动端浏览器可能不支持，建议使用桌面端。</p>
        </div>
      ) : null}

      </div>
      ) : null}

      <canvas
        ref={lyricCanvasRef}
        width={PIP_CANVAS_WIDTH}
        height={PIP_CANVAS_HEIGHT}
        className="np-pip-canvas"
        aria-hidden="true"
      />
      <video
        ref={pipVideoRef}
        className="np-pip-video"
        muted
        playsInline
        aria-hidden="true"
      />

      {open && viewer ? (
        <div className="np-media-layer">
          <MediaViewer
            state={viewer}
            player={player}
            onClose={() => setViewer(null)}
            onNavigate={(index) => {
              setViewer((current) => {
                if (!current || current.kind !== 'image') {
                  return current;
                }
                const next = Math.max(0, Math.min(current.items.length - 1, index));
                return { ...current, index: next };
              });
            }}
          />
        </div>
      ) : null}
    </>
  );
}
