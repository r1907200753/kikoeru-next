import { useCallback, useEffect, useRef, useState } from 'react';
import {
  saveOnlinePlayback,
  savePlayback,
  streamUrl,
  type TrackSummary,
} from './api';

export interface PlayerContext {
  workId: number;
  workCode: string;
  workTitle: string;
  coverAssetId?: number | null;
  coverUrl?: string | null;
  workPath?: string | null;
  tracks: TrackSummary[];
  workTracks?: TrackSummary[] | null;
  source?: 'local' | 'online';
}

export interface CurrentTrack {
  workId: number;
  workCode: string;
  workTitle: string;
  coverAssetId?: number | null;
  coverUrl?: string | null;
  workPath?: string | null;
  workTracks?: TrackSummary[] | null;
  source: 'local' | 'online';
  track: TrackSummary;
}

export function trackKey(track: TrackSummary): string {
  return track.source === 'online'
    ? `online:${track.onlineWorkId ?? track.workId}:${track.hash ?? track.id}`
    : `local:${track.id}`;
}

export interface PlayerApi {
  audioRef: (node: HTMLAudioElement | null) => void;
  audioElement: HTMLAudioElement | null;
  current: CurrentTrack | null;
  queue: TrackSummary[];
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  channelSwap: boolean;
  error: string;
  play: (track: TrackSummary, context: PlayerContext, startMs?: number) => void;
  toggle: () => void;
  pause: () => void;
  reset: () => void;
  seek: (ms: number) => void;
  seekBy: (deltaMs: number) => void;
  setVolume: (value: number) => void;
  setChannelSwap: (value: boolean) => void;
  next: () => void;
  prev: () => void;
  clearError: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

const VOLUME_KEY = 'kikoeru.volume';
const CHANNEL_SWAP_KEY = 'kikoeru.channelSwap';

interface AudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  splitter: ChannelSplitterNode;
  merger: ChannelMergerNode;
  gain: GainNode;
}

function routeChannels(graph: AudioGraph, swapped: boolean): void {
  graph.splitter.disconnect();
  graph.splitter.connect(graph.merger, 0, swapped ? 1 : 0);
  graph.splitter.connect(graph.merger, 1, swapped ? 0 : 1);
}

function readStoredChannelSwap(): boolean {
  try {
    return localStorage.getItem(CHANNEL_SWAP_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.8;
  } catch {
    return 0.8;
  }
}

export function usePlayer(): PlayerApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const attachAudio = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    setAudioElement(node);
  }, []);
  const [current, setCurrent] = useState<CurrentTrack | null>(null);
  const [queue, setQueue] = useState<TrackSummary[]>([]);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolumeState] = useState(readStoredVolume);
  const [channelSwap, setChannelSwapState] = useState(readStoredChannelSwap);
  const [error, setError] = useState('');

  const currentRef = useRef<CurrentTrack | null>(null);
  const queueRef = useRef<TrackSummary[]>([]);
  const pendingSeekRef = useRef<number | null>(null);
  const switchingRef = useRef(false);
  const lastSavedRef = useRef(0);
  const channelSwapRef = useRef(channelSwap);
  const graphRef = useRef<AudioGraph | null>(null);

  currentRef.current = current;
  queueRef.current = queue;
  channelSwapRef.current = channelSwap;

  const ensureAudioGraph = useCallback((): AudioGraph | null => {
    const audio = audioRef.current;
    if (!audio) {
      return null;
    }
    if (graphRef.current) {
      return graphRef.current;
    }
    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    try {
      const ctx = new AudioContextCtor();
      const source = ctx.createMediaElementSource(audio);
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      const gain = ctx.createGain();
      source.connect(splitter);
      splitter.connect(merger, 0, 0);
      splitter.connect(merger, 1, 1);
      merger.connect(gain);
      gain.connect(ctx.destination);
      const graph: AudioGraph = { ctx, source, splitter, merger, gain };
      graphRef.current = graph;
      routeChannels(graph, channelSwapRef.current);
      void ctx.resume().catch(() => undefined);
      return graph;
    } catch {
      return null;
    }
  }, []);

  const setChannelSwap = useCallback((value: boolean) => {
    setChannelSwapState(value);
    channelSwapRef.current = value;
    try {
      localStorage.setItem(CHANNEL_SWAP_KEY, value ? '1' : '0');
    } catch {
      // 忽略隐私模式下的写入失败。
    }
    const graph = value ? ensureAudioGraph() : graphRef.current;
    if (graph) {
      routeChannels(graph, value);
      void graph.ctx.resume().catch(() => undefined);
    }
  }, [ensureAudioGraph]);

  useEffect(() => {
    return () => {
      const graph = graphRef.current;
      graphRef.current = null;
      if (graph) {
        void graph.ctx.close().catch(() => undefined);
      }
    };
  }, []);

  const persistTrack = useCallback((track: CurrentTrack, ms: number) => {
    if (track.source === 'online') {
      const onlineTrack = track.track;
      if (onlineTrack.hash && (onlineTrack.onlineWorkId ?? track.workId) > 0) {
        void saveOnlinePlayback({
          remoteWorkId: onlineTrack.onlineWorkId ?? track.workId,
          code: track.workCode,
          trackHash: onlineTrack.hash,
          trackIndex: onlineTrack.onlineIndex ?? 0,
          positionMs: Math.max(0, Math.round(ms)),
        }).catch(() => undefined);
      }
      return;
    }
    void savePlayback({
      workId: track.workId,
      trackId: track.track.id,
      positionMs: Math.max(0, Math.round(ms)),
    }).catch(() => undefined);
  }, []);

  const persist = useCallback(
    (ms: number) => {
      const track = currentRef.current;
      if (track) {
        persistTrack(track, ms);
      }
    },
    [persistTrack],
  );

  const play = useCallback((track: TrackSummary, context: PlayerContext, startMs = 0) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const sameTrack =
      currentRef.current !== null && trackKey(currentRef.current.track) === trackKey(track);
    setQueue(context.tracks);
    setError('');
    if (!sameTrack) {
      const next: CurrentTrack = {
        workId: context.workId,
        workCode: context.workCode,
        workTitle: context.workTitle,
        coverAssetId: context.coverAssetId ?? null,
        coverUrl: context.coverUrl ?? null,
        workPath: context.workPath ?? null,
        workTracks: context.workTracks ?? context.tracks,
        source: context.source ?? 'local',
        track,
      };
      setCurrent(next);
      setPositionMs(startMs);
      setDurationMs(0);
      pendingSeekRef.current = startMs;
      switchingRef.current = true;
      lastSavedRef.current = 0;
      audio.src = track.streamUrl ?? streamUrl(track.id);
      audio.load();
    } else if (startMs > 0) {
      pendingSeekRef.current = startMs;
      if (audio.readyState >= 1) {
        audio.currentTime = startMs / 1000;
        setPositionMs(startMs);
      }
    }
    if (channelSwapRef.current) {
      const graph = ensureAudioGraph();
      if (graph) {
        void graph.ctx.resume().catch(() => undefined);
      }
    }
    void audio.play().catch(() => {
      setError('播放被浏览器拦截，请再点一次播放');
    });
  }, [ensureAudioGraph]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentRef.current) {
      return;
    }
    if (audio.paused) {
      if (channelSwapRef.current) {
        const graph = ensureAudioGraph();
        if (graph) {
          void graph.ctx.resume().catch(() => undefined);
        }
      }
      void audio.play().catch(() => setError('播放被浏览器拦截，请再点一次播放'));
    } else {
      audio.pause();
    }
  }, [ensureAudioGraph]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
  }, []);

  const reset = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    currentRef.current = null;
    queueRef.current = [];
    setCurrent(null);
    setQueue([]);
    setPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    setError('');
  }, []);

  const seek = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const target = Math.max(0, ms);
    if (audio.readyState >= 1) {
      audio.currentTime = target / 1000;
    }
    setPositionMs(target);
  }, []);

  const seekBy = useCallback((deltaMs: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY;
    const target = Math.min(duration, Math.max(0, audio.currentTime + deltaMs / 1000));
    if (audio.readyState >= 1) {
      audio.currentTime = target;
    }
    setPositionMs(target * 1000);
  }, []);

  const setVolume = useCallback((value: number) => {
    setVolumeState(Math.min(1, Math.max(0, value)));
  }, []);

  const step = useCallback(
    (delta: number) => {
      const track = currentRef.current;
      if (!track) {
        return;
      }
      const index = queueRef.current.findIndex(
        (item) => trackKey(item) === trackKey(track.track),
      );
      const target = index < 0 ? undefined : queueRef.current[index + delta];
      if (target) {
        play(
          target,
          {
            workId: track.workId,
            workCode: track.workCode,
            workTitle: track.workTitle,
            coverAssetId: track.coverAssetId ?? null,
            coverUrl: track.coverUrl ?? null,
            workPath: track.workPath ?? null,
            tracks: queueRef.current,
            workTracks: track.workTracks ?? queueRef.current,
            source: track.source,
          },
          0,
        );
      }
    },
    [play],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);
  const clearError = useCallback(() => setError(''), []);

  useEffect(() => {
    const audio = audioElement;
    if (!audio) {
      return;
    }

    const onLoadedMetadata = () => {
      setDurationMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
      const pending = pendingSeekRef.current;
      if (pending !== null && pending > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(pending / 1000, Math.max(0, audio.duration - 0.2));
        lastSavedRef.current = audio.currentTime;
      }
      pendingSeekRef.current = null;
      switchingRef.current = false;
    };

    const onTimeUpdate = () => {
      setPositionMs(audio.currentTime * 1000);
      if (!audio.paused && Math.abs(audio.currentTime - lastSavedRef.current) >= 5) {
        lastSavedRef.current = audio.currentTime;
        persist(audio.currentTime * 1000);
      }
    };

    const onPlay = () => {
      switchingRef.current = false;
      setPlaying(true);
    };

    const onPause = () => {
      setPlaying(false);
      if (!switchingRef.current && audio.currentTime > 0) {
        lastSavedRef.current = audio.currentTime;
        persist(audio.currentTime * 1000);
      }
    };

    const onEnded = () => {
      const track = currentRef.current;
      if (!track) {
        return;
      }
      const index = queueRef.current.findIndex(
        (item) => trackKey(item) === trackKey(track.track),
      );
      const target = index < 0 ? undefined : queueRef.current[index + 1];
      if (target) {
        persist(0);
        play(
          target,
          {
            workId: track.workId,
            workCode: track.workCode,
            workTitle: track.workTitle,
            coverAssetId: track.coverAssetId ?? null,
            coverUrl: track.coverUrl ?? null,
            workPath: track.workPath ?? null,
            tracks: queueRef.current,
            workTracks: track.workTracks ?? queueRef.current,
            source: track.source,
          },
          0,
        );
      } else {
        // 整部作品听完：断点重置到第一轨，便于「重新收听」从头开始。
        const first = queueRef.current[0];
        persistTrack(first ? { ...track, track: first } : track, 0);
        setPlaying(false);
      }
    };

    const onError = () => {
      switchingRef.current = false;
      setError('音轨加载失败，请检查文件是否可访问');
    };
    const onVolumeChange = () => setVolumeState(audio.volume);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('volumechange', onVolumeChange);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('volumechange', onVolumeChange);
    };
  }, [audioElement, persist, persistTrack, play]);

  useEffect(() => {
    if (audioElement) {
      audioElement.volume = volume;
    }
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // localStorage 可能被浏览器隐私设置禁用，音量仅对本次会话生效。
    }
  }, [audioElement, volume]);

  useEffect(() => {
    const saveNow = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused && audio.currentTime > 0) {
        persist(audio.currentTime * 1000);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        saveNow();
      }
    };
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', saveNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persist]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = window.setTimeout(() => setError(''), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const trackIndex = current
    ? queue.findIndex((item) => trackKey(item) === trackKey(current.track))
    : -1;

  return {
    audioRef: attachAudio,
    audioElement,
    current,
    queue,
    playing,
    positionMs,
    durationMs,
    volume,
    channelSwap,
    error,
    play,
    toggle,
    pause,
    reset,
    seek,
    seekBy,
    setVolume,
    setChannelSwap,
    next,
    prev,
    clearError,
    hasNext: trackIndex >= 0 && trackIndex < queue.length - 1,
    hasPrev: trackIndex > 0,
  };
}
