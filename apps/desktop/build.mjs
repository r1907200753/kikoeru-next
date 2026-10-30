import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(desktopDir, '../..');
const distDir = path.join(desktopDir, 'dist');
const webDist = path.join(rootDir, 'apps', 'web', 'dist');
const iconSource = path.join(desktopDir, 'build', 'icon.png');

if (!existsSync(path.join(webDist, 'index.html'))) {
  console.error('缺少 apps/web/dist，请先运行 npm run build:web。');
  process.exit(1);
}
if (!existsSync(iconSource)) {
  console.error('缺少 apps/desktop/build/icon.png。');
  process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(webDist, path.join(distDir, 'web'), { recursive: true });
copyFileSync(iconSource, path.join(distDir, 'icon.png'));

await build({
  entryPoints: {
    main: path.join(desktopDir, 'src', 'main.ts'),
    preload: path.join(desktopDir, 'src', 'preload.ts'),
  },
  outdir: distDir,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

console.log('桌面端构建完成：dist/main.cjs、dist/preload.cjs、dist/web');
