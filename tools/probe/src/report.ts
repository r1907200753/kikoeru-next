import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ProbeReport, ProbeResult } from './types.js';

export const DEFAULT_REPORTS_DIR = fileURLToPath(new URL('../../../reports/', import.meta.url));

const STATUS_LABEL: Record<ProbeResult['status'], string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
};

export function formatReport(report: ProbeReport, verbose = false): string {
  const lines: string[] = [];
  lines.push('kikoeru-next M0 链路探针');
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push(
    `环境：Node ${report.environment.node}｜${report.environment.platform}/${report.environment.arch}｜ffprobe：${report.environment.ffprobe || '未检测到'}`,
  );
  lines.push(
    `配置：代理 ${report.config.proxyConfigured ? '已配置' : '未配置'}｜DLsite ${report.config.dlsiteWorkno}｜ASMR.one ${report.config.asmrBaseUrl || '自动发现'}（登录 ${report.config.asmrLoginConfigured ? '已配置' : '未配置'}）｜WebDAV ${report.config.webdavBaseUrl || '未配置'}｜本地库 ${report.config.localLibraryPath || '未配置'}`,
  );
  lines.push('');

  for (const result of report.results) {
    lines.push(
      `[${STATUS_LABEL[result.status]}] ${result.name} (${result.ms}ms) — ${result.summary}`,
    );
    if (verbose || (result.status === 'fail' && result.error)) {
      const details = JSON.stringify(result.details, null, 2);
      if (details && details !== '{}') {
        lines.push(indent(details, '    '));
      }
      if (result.error && !result.summary.includes(result.error)) {
        lines.push(`    错误：${result.error}`);
      }
    }
  }

  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const result of report.results) {
    counts[result.status] += 1;
  }
  lines.push('');
  lines.push(`汇总：通过 ${counts.pass}｜失败 ${counts.fail}｜跳过 ${counts.skip}`);
  const failures = report.results.filter((result) => result.status === 'fail');
  if (failures.length > 0) {
    lines.push(`失败项：${failures.map((result) => result.name).join('、')}`);
  }
  return lines.join('\n');
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

export async function writeReport(
  report: ProbeReport,
  reportsDir = DEFAULT_REPORTS_DIR,
): Promise<string> {
  await mkdir(reportsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const filePath = path.join(reportsDir, `probe-${stamp}.json`);
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
}

export function scrubSecrets(report: ProbeReport, secrets: string[]): ProbeReport {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (secret.length < 3) {
      continue;
    }
    variants.add(secret);
    variants.add(JSON.stringify(secret).slice(1, -1));
  }
  if (variants.size === 0) {
    return report;
  }

  let serialized = JSON.stringify(report);
  for (const variant of variants) {
    serialized = serialized.split(variant).join('***');
  }
  return JSON.parse(serialized) as ProbeReport;
}
