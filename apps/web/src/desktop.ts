import { useEffect, useState } from 'react';

interface DesktopBridge {
  readonly platform: string;
  setPlaybackActive(active: boolean): void;
}

declare global {
  interface Window {
    kikoeruDesktop?: DesktopBridge;
  }
}

const PREVENT_SLEEP_KEY = 'kikoeru.desktop.preventSleep';
const PREFERENCES_EVENT = 'kikoeru:desktop-preferences';

export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && Boolean(window.kikoeruDesktop);
}

export function readPreventSleep(): boolean {
  try {
    return window.localStorage.getItem(PREVENT_SLEEP_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writePreventSleep(value: boolean): void {
  try {
    window.localStorage.setItem(PREVENT_SLEEP_KEY, value ? '1' : '0');
  } catch {
    // 存储不可用时保持默认开启。
  }
  window.dispatchEvent(new Event(PREFERENCES_EVENT));
}

export function useDesktopPlayback(playing: boolean): void {
  const [preventSleep, setPreventSleep] = useState(readPreventSleep);

  useEffect(() => {
    const sync = () => setPreventSleep(readPreventSleep());
    window.addEventListener(PREFERENCES_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    const bridge = window.kikoeruDesktop;
    if (!bridge) {
      return;
    }
    bridge.setPlaybackActive(playing && preventSleep);
    return () => bridge.setPlaybackActive(false);
  }, [playing, preventSleep]);
}
