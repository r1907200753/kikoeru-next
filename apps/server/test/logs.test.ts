import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

interface LogEntry {
  id: number;
  level: string;
  category: string;
  action: string;
  message: string;
  detail: unknown;
  clientIp: string;
  createdAt: string;
}

interface LogPage {
  items: LogEntry[];
  latestId: number;
  hasMore: boolean;
}

test('操作日志 API：记录设置与请求审计、分页和清空', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-logs-'));
  try {
    const app = createApp({ databasePath: path.join(root, 'test.sqlite') });
    await app.ready();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/logs' });
      assert.equal(initial.statusCode, 200);
      assert.match(initial.headers['cache-control'] as string, /no-store/);
      const initialPage = initial.json<LogPage>();
      const startEntry = initialPage.items.find((entry) => entry.action === 'server.start');
      assert.ok(startEntry);

      const settings = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { proxyUrl: 'http://127.0.0.1:7890' },
      });
      assert.equal(settings.statusCode, 200);

      const settingsLogs = await app.inject({
        method: 'GET',
        url: '/api/logs?category=settings&limit=10',
      });
      const settingsPage = settingsLogs.json<LogPage>();
      const update = settingsPage.items.find((entry) => entry.action === 'settings.update');
      assert.ok(update);
      assert.equal(update.category, 'settings');
      assert.deepEqual(update.detail, { proxyUrl: 'http://127.0.0.1:7890' });

      const missingWork = await app.inject({
        method: 'PUT',
        url: '/api/works/RJ000000/favorite',
        payload: { favorite: true },
      });
      assert.equal(missingWork.statusCode, 404);

      const apiLogs = await app.inject({ method: 'GET', url: '/api/logs?category=api&level=warn' });
      const apiPage = apiLogs.json<LogPage>();
      const audited = apiPage.items.find(
        (entry) => entry.action === 'put /api/works/:code/favorite',
      );
      assert.ok(audited);
      assert.equal(audited.level, 'warn');
      assert.match(audited.message, /→ 404/);
      const detail = audited.detail as { status?: number; route?: string };
      assert.equal(detail.status, 404);
      assert.equal(detail.route, '/api/works/:code/favorite');

      const cursor = await app.inject({
        method: 'GET',
        url: `/api/logs?after=${startEntry.id}&limit=1`,
      });
      const cursorPage = cursor.json<LogPage>();
      assert.equal(cursorPage.items.length, 1);
      assert.ok((cursorPage.items[0]?.id ?? 0) > startEntry.id);
      assert.equal(cursorPage.hasMore, true);

      const cleared = await app.inject({ method: 'DELETE', url: '/api/logs' });
      assert.equal(cleared.statusCode, 200);
      const clearBody = cleared.json<{ ok: boolean; entry: LogEntry }>();
      assert.equal(clearBody.ok, true);
      assert.equal(clearBody.entry.action, 'logs.clear');

      const afterClear = await app.inject({ method: 'GET', url: '/api/logs' });
      const clearedPage = afterClear.json<LogPage>();
      assert.equal(clearedPage.items.length, 1);
      assert.equal(clearedPage.items[0]?.action, 'logs.clear');
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('操作日志 SSE 先发送 ready 并实时推送新日志', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-logs-sse-'));
  const app = createApp({ databasePath: path.join(root, 'test.sqlite') });
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${origin}/api/logs/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.ok(response.body);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state = { text: '' };

    const readChunk = async (timeoutMs = 4000): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const result = await Promise.race([
          reader!.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('读取日志流超时')), timeoutMs);
          }),
        ]);
        if (result.done) {
          throw new Error('日志流提前结束');
        }
        state.text += decoder.decode(result.value, { stream: true });
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };

    const readUntil = async (needle: string): Promise<void> => {
      const deadline = Date.now() + 4000;
      while (!state.text.includes(needle)) {
        if (Date.now() > deadline) {
          throw new Error(`等待 ${needle} 超时，已收到：${state.text}`);
        }
        await readChunk();
      }
    };

    await readUntil('event: ready');
    assert.match(state.text, /retry: 3000/);

    const settings = await fetch(`${origin}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxyUrl: 'http://127.0.0.1:7891' }),
    });
    assert.equal(settings.status, 200);

    await readUntil('settings.update');
    const dataLines = state.text
      .split('\n')
      .filter((line) => line.startsWith('data: '));
    const latestData = dataLines[dataLines.length - 1];
    assert.ok(latestData);
    const entry = JSON.parse(latestData.slice('data: '.length)) as LogEntry;
    assert.ok(entry.id > 0);
    assert.equal(entry.action, 'settings.update');
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
