import { useEffect, useState } from 'react';

export type AudioPriority = 'mp3' | 'flac' | 'wav' | 'opus' | 'm4a' | 'aac';
export type HomeGrid = 'standard' | 'four' | 'three';

export interface Preferences {
  smartPath: boolean;
  preferEffectSound: boolean;
  audioPriority: AudioPriority;
  onlineAudioPriority: AudioPriority;
  localHomeGrid: HomeGrid;
  onlineHomeGrid: HomeGrid;
}

export const AUDIO_PRIORITY_OPTIONS: Array<{ value: AudioPriority; label: string }> = [
  { value: 'mp3', label: 'MP3' },
  { value: 'flac', label: 'FLAC' },
  { value: 'wav', label: 'WAV' },
  { value: 'opus', label: 'OPUS' },
  { value: 'm4a', label: 'M4A' },
  { value: 'aac', label: 'AAC' },
];

export const HOME_GRID_OPTIONS: Array<{ value: HomeGrid; label: string }> = [
  { value: 'standard', label: '标准' },
  { value: 'four', label: '每行 4 个' },
  { value: 'three', label: '每行 3 个' },
];

const PREFERENCES_KEY = 'kikoeru.preferences';
const AUDIO_ORDER: AudioPriority[] = ['mp3', 'flac', 'wav', 'opus', 'm4a', 'aac'];

export const DEFAULT_PREFERENCES: Preferences = {
  smartPath: true,
  preferEffectSound: true,
  audioPriority: 'mp3',
  onlineAudioPriority: 'mp3',
  localHomeGrid: 'four',
  onlineHomeGrid: 'four',
};

export function audioPriorityOrder(first: AudioPriority): AudioPriority[] {
  return [first, ...AUDIO_ORDER.filter((item) => item !== first)];
}

export function readPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') {
      return DEFAULT_PREFERENCES;
    }
    const record = value as Record<string, unknown>;
    const legacyGrid = HOME_GRID_OPTIONS.some((item) => item.value === record.homeGrid)
      ? (record.homeGrid as HomeGrid)
      : null;
    return {
      smartPath:
        typeof record.smartPath === 'boolean' ? record.smartPath : DEFAULT_PREFERENCES.smartPath,
      preferEffectSound:
        typeof record.preferEffectSound === 'boolean'
          ? record.preferEffectSound
          : DEFAULT_PREFERENCES.preferEffectSound,
      audioPriority: AUDIO_PRIORITY_OPTIONS.some((item) => item.value === record.audioPriority)
        ? (record.audioPriority as AudioPriority)
        : DEFAULT_PREFERENCES.audioPriority,
      onlineAudioPriority: AUDIO_PRIORITY_OPTIONS.some(
        (item) => item.value === record.onlineAudioPriority,
      )
        ? (record.onlineAudioPriority as AudioPriority)
        : DEFAULT_PREFERENCES.onlineAudioPriority,
      localHomeGrid: HOME_GRID_OPTIONS.some((item) => item.value === record.localHomeGrid)
        ? (record.localHomeGrid as HomeGrid)
        : (legacyGrid ?? DEFAULT_PREFERENCES.localHomeGrid),
      onlineHomeGrid: HOME_GRID_OPTIONS.some((item) => item.value === record.onlineHomeGrid)
        ? (record.onlineHomeGrid as HomeGrid)
        : (legacyGrid ?? DEFAULT_PREFERENCES.onlineHomeGrid),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function updatePreferences(patch: Partial<Preferences>): Preferences {
  const next = { ...readPreferences(), ...patch };
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式下只对当前会话生效。
  }
  window.dispatchEvent(new CustomEvent<Preferences>('kikoeru:preferences', { detail: next }));
  return next;
}

export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => Preferences] {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);

  useEffect(() => {
    const handler = (event: Event) => {
      setPreferences((event as CustomEvent<Preferences>).detail ?? readPreferences());
    };
    window.addEventListener('kikoeru:preferences', handler);
    return () => window.removeEventListener('kikoeru:preferences', handler);
  }, []);

  return [preferences, updatePreferences];
}
