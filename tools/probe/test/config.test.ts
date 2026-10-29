import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

test('loadConfig 规范化番号并补齐默认值', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kikoeru-config-'));
  try {
    const configPath = path.join(directory, 'probe.config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        proxy: '127.0.0.1:7890',
        dlsite: { workno: 'rj01426915' },
        webdav: { baseUrl: 'http://127.0.0.1:1900', child: 'keep' },
      }),
      'utf8',
    );

    const loaded = await loadConfig(configPath);
    assert.equal(loaded.config.dlsite.workno, 'RJ01426915');
    assert.equal(loaded.config.webdav.writeTest, true);
    assert.equal(loaded.config.local.ffprobePath, 'ffprobe');
    assert.equal(loaded.config.dlsite.timeoutMs, 25000);
    assert.equal(loaded.config.proxy, 'http://127.0.0.1:7890');
    assert.equal(loaded.source, configPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('loadConfig 找不到文件时回退到示例配置', async () => {
  const missing = path.join(tmpdir(), `kikoeru-missing-${Date.now()}.json`);
  const loaded = await loadConfig(missing);
  assert.match(loaded.source, /probe\.config\.example\.json$/);
  assert.ok(loaded.warnings.some((warning) => warning.includes('回退到示例配置')));
});
