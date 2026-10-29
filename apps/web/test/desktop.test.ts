import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDesktopShell, readPreventSleep, writePreventSleep } from '../src/desktop';

const PREFERENCES_EVENT = 'kikoeru:desktop-preferences';

class FakeWindow extends EventTarget {
  kikoeruDesktop?: { platform: string; setPlaybackActive: () => void };
  localStorage: Storage;
  received: string[] = [];

  constructor(storage: Storage) {
    super();
    this.localStorage = storage;
    this.addEventListener(PREFERENCES_EVENT, () => this.received.push(PREFERENCES_EVENT));
  }
}

function makeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function installWindow(value: FakeWindow): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value,
  });
}

function restoreWindow(): void {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow);
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
}

test('isDesktopShell 只在存在 preload 桥时返回 true', () => {
  const fake = new FakeWindow(makeStorage());
  installWindow(fake);
  try {
    assert.equal(isDesktopShell(), false);
    fake.kikoeruDesktop = { platform: 'win32', setPlaybackActive: () => undefined };
    assert.equal(isDesktopShell(), true);
  } finally {
    restoreWindow();
  }
});

test('readPreventSleep 默认开启并识别持久化的关闭状态', () => {
  installWindow(new FakeWindow(makeStorage()));
  try {
    assert.equal(readPreventSleep(), true);

    installWindow(new FakeWindow(makeStorage({ 'kikoeru.desktop.preventSleep': '0' })));
    assert.equal(readPreventSleep(), false);

    installWindow(new FakeWindow(makeStorage({ 'kikoeru.desktop.preventSleep': '1' })));
    assert.equal(readPreventSleep(), true);

    const denied = makeStorage();
    denied.getItem = () => {
      throw new Error('storage denied');
    };
    installWindow(new FakeWindow(denied));
    assert.equal(readPreventSleep(), true);
  } finally {
    restoreWindow();
  }
});

test('writePreventSleep 持久化开关并广播偏好变化', () => {
  const fake = new FakeWindow(makeStorage());
  installWindow(fake);
  try {
    writePreventSleep(false);
    assert.equal(fake.localStorage.getItem('kikoeru.desktop.preventSleep'), '0');
    assert.deepEqual(fake.received, [PREFERENCES_EVENT]);

    writePreventSleep(true);
    assert.equal(fake.localStorage.getItem('kikoeru.desktop.preventSleep'), '1');
    assert.deepEqual(fake.received, [PREFERENCES_EVENT, PREFERENCES_EVENT]);
  } finally {
    restoreWindow();
  }
});

test('存储不可写时 writePreventSleep 不抛错但仍广播', () => {
  const denied = makeStorage();
  denied.setItem = () => {
    throw new Error('quota exceeded');
  };
  const fake = new FakeWindow(denied);
  installWindow(fake);
  try {
    assert.doesNotThrow(() => writePreventSleep(false));
    assert.equal(fake.received.length, 1);
  } finally {
    restoreWindow();
  }
});
