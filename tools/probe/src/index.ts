import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient, redactText } from './http.js';
import { loadConfig, configSummary } from './config.js';
import { runDlsiteProbes } from './dlsite.js';
import { runAsmrOneProbes } from './asmrone.js';
import { runWebDavProbes } from './webdav.js';
import { detectFfprobe, runLocalProbes } from './local.js';
import { formatReport, scrubSecrets, writeReport } from './report.js';
import type { ProbeEnvironment, ProbeReport, ProbeResult } from './types.js';

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('../probe.config.json', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GROUP_KEYS = ['dlsite', 'asmrone', 'webdav', 'local'] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

function resolveConfigPath(input: string): string {
  if (path.isAbsolute(input)) {
    return input;
  }
  const fromCwd = path.resolve(process.cwd(), input);
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  const fromProjectRoot = path.resolve(PROJECT_ROOT, input);
  return existsSync(fromProjectRoot) ? fromProjectRoot : fromCwd;
}

interface CliOptions {
  configPath: string;
  only: Set<GroupKey> | null;
  write: boolean;
  verbose: boolean;
  help: boolean;
}

const HELP = `kikoeru-next M0 链路探针

用法：
  npm run probe -- [选项]

选项：
  --config <path>   配置文件路径（默认 tools/probe/probe.config.json）
  --only <groups>   只跑指定分组，逗号分隔：dlsite,asmrone,webdav,local
  --no-write        不写 reports/probe-*.json
  --verbose         输出每一项的 details
  -h, --help        显示本帮助

说明：
  - 凭据只放在本地 probe.config.json（已 gitignore），不要发到聊天或提交到仓库。
  - webdav.writeTest=true 时会在 rootPath 下创建临时目录/文件，测试 MKCOL、PUT、MOVE、
    中文文件名、Range 读取，并在 finally 中清理。只读环境请设为 false。
  - 外部链路需要 HTTP/HTTPS 代理；undici 不支持 SOCKS5 代理地址。
`;

function parseArgs(argv: string[]): CliOptions {
  let configPath = DEFAULT_CONFIG_PATH;
  let only: Set<GroupKey> | null = null;
  let write = true;
  let verbose = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    const [flag, inlineValue] = argument.includes('=')
      ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)]
      : [argument, undefined];

    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = argv[index + 1];
      if (next === undefined) {
        throw new Error(`${flag} 需要一个值`);
      }
      index += 1;
      return next;
    };

    switch (flag) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '--config':
        configPath = takeValue();
        break;
      case '--only': {
        const requested = takeValue()
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        for (const value of requested) {
          if (!(GROUP_KEYS as readonly string[]).includes(value)) {
            throw new Error(`未知分组：${value}（可选：${GROUP_KEYS.join(',')}）`);
          }
        }
        only = new Set(requested as GroupKey[]);
        if (only.size === 0) {
          throw new Error('--only 至少需要一个分组');
        }
        break;
      }
      case '--no-write':
        write = false;
        break;
      case '--verbose':
        verbose = true;
        break;
      default:
        throw new Error(`未知参数：${argument}`);
    }
  }

  return { configPath, only, write, verbose, help };
}

function proxySecrets(proxy: string): string[] {
  try {
    const url = new URL(proxy);
    return [url.username, url.password].filter((value) => value.length >= 3);
  } catch {
    return [];
  }
}

function failureResult(name: string, error: unknown): ProbeResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    name,
    status: 'fail',
    summary: `分组执行失败：${redactText(message)}`,
    ms: 0,
    error: redactText(message),
    details: {},
  };
}

async function main(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
    console.error(HELP);
    return 2;
  }

  if (options.help) {
    console.log(HELP);
    return 0;
  }

  let loaded;
  try {
    loaded = await loadConfig(resolveConfigPath(options.configPath));
  } catch (error) {
    console.error(`读取配置失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const config = loaded.config;
  console.log('kikoeru-next M0 链路探针');
  console.log(`配置来源：${loaded.source}`);
  console.log(
    `代理：${config.proxy ? '已配置' : '未配置'}｜DLsite：${config.dlsite.workno}｜本地库：${config.local.libraryPath || '未配置'}`,
  );
  if (loaded.warnings.length > 0) {
    for (const warning of loaded.warnings) {
      console.log(`提示：${warning}`);
    }
  }
  console.log('');

  let client: HttpClient;
  try {
    client = new HttpClient({ proxy: config.proxy });
  } catch (error) {
    console.error(
      `代理配置无效：${redactText(error instanceof Error ? error.message : String(error))}`,
    );
    console.error('请填写 http://host:port 或 https://host:port（不支持 SOCKS5）。');
    return 1;
  }
  const environment: ProbeEnvironment = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    ffprobe: await detectFfprobe(config.local.ffprobePath),
  };

  const runners: Array<{ key: GroupKey; run: () => Promise<ProbeResult[]> }> = [
    { key: 'dlsite', run: () => runDlsiteProbes(client, config.dlsite) },
    { key: 'asmrone', run: () => runAsmrOneProbes(client, config.asmrone) },
    { key: 'webdav', run: () => runWebDavProbes(client, config.webdav) },
    { key: 'local', run: () => runLocalProbes(config.local) },
  ];

  const results: ProbeResult[] = [];
  try {
    for (const runner of runners) {
      if (options.only && !options.only.has(runner.key)) {
        continue;
      }
      try {
        results.push(...(await runner.run()));
      } catch (error) {
        results.push(failureResult(`${runner.key}.runner`, error));
      }
    }
  } finally {
    await client.close();
  }

  const report: ProbeReport = {
    generatedAt: new Date().toISOString(),
    environment,
    config: configSummary(config),
    results,
  };
  const secrets = [
    config.asmrone.password,
    config.webdav.password,
    ...proxySecrets(config.proxy),
  ].filter((value) => value.length >= 3);
  const safeReport = scrubSecrets(report, secrets);

  console.log(formatReport(safeReport, options.verbose));
  if (options.write) {
    try {
      const filePath = await writeReport(safeReport);
      console.log(`\n报告已写入：${filePath}`);
    } catch (error) {
      console.error(`\n报告写入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return safeReport.results.some((result) => result.status === 'fail') ? 1 : 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`探针异常退出：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
