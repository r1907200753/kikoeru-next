import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runLocalProbes } from '../src/local.js';

test('本地库探针识别 RJ 目录、音频并跳过 ffprobe', async () => {
  const library = await mkdtemp(path.join(tmpdir(), 'kikoeru-library-'));
  try {
    const workDir = path.join(library, 'RJ01426915 测试作品');
    await mkdir(path.join(workDir, '音声'), { recursive: true });
    await writeFile(path.join(workDir, '音声', '01.mp3'), Buffer.from('ID3\u0000\u0000\u0000', 'utf8'));
    await writeFile(path.join(workDir, 'cover.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const results = await runLocalProbes({
      libraryPath: library,
      probeFfprobe: false,
      ffprobePath: 'ffprobe',
    });

    assert.deepEqual(
      results.map((result) => result.name),
      ['local.library', 'local.ffprobe'],
    );
    assert.equal(results[0]?.status, 'pass', results[0]?.summary);
    assert.equal(results[0]?.details.workCount, 1);
    assert.equal(results[0]?.details.scannedWorkCount, 1);
    assert.match(results[0]?.summary ?? '', /共发现 1 个作品目录/);
    assert.equal(results[1]?.status, 'skip');
  } finally {
    await rm(library, { recursive: true, force: true });
  }
});
