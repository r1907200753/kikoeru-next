import os from 'node:os';

export function normalizeClientIp(address: string): string {
  return address.replace(/^::ffff:/i, '').trim();
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeClientIp(address);
  if (normalized === '::1') {
    return true;
  }
  const parts = normalized.split('.');
  return parts.length === 4 && parts[0] === '127';
}

export interface LanAddress {
  name: string;
  address: string;
  url: string;
}

export interface LanInterface {
  name: string;
  address: string;
  mac: string;
}

const ZERO_MAC = '00:00:00:00:00:00';

export function listLanInterfaces(): LanInterface[] {
  const result: LanInterface[] = [];
  const seen = new Set<string>();
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue;
      }
      if (entry.address.startsWith('169.254.') || seen.has(entry.address)) {
        continue;
      }
      const mac = (entry.mac ?? '').toUpperCase();
      if (!mac || mac === ZERO_MAC) {
        continue;
      }
      seen.add(entry.address);
      result.push({ name, address: entry.address, mac });
    }
  }
  result.sort((left, right) => {
    const leftTailscale = /tailscale/i.test(left.name) ? 1 : 0;
    const rightTailscale = /tailscale/i.test(right.name) ? 1 : 0;
    return leftTailscale - rightTailscale || left.name.localeCompare(right.name);
  });
  return result;
}

export function listLanAddresses(port: number): LanAddress[] {
  const result: LanAddress[] = [];
  const seen = new Set<string>();
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue;
      }
      if (entry.address.startsWith('169.254.') || seen.has(entry.address)) {
        continue;
      }
      seen.add(entry.address);
      result.push({
        name,
        address: entry.address,
        url: `http://${entry.address}:${port}`,
      });
    }
  }
  result.sort((left, right) => {
    const leftTailscale = /tailscale/i.test(left.name) ? 1 : 0;
    const rightTailscale = /tailscale/i.test(right.name) ? 1 : 0;
    return leftTailscale - rightTailscale || left.name.localeCompare(right.name);
  });
  return result;
}

export function isSameOrigin(origin: string, hostHeader: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  if (!hostHeader) {
    return false;
  }
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === hostHeader.toLowerCase();
  } catch {
    return false;
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface LoginRateLimiter {
  check(ip: string): RateLimitDecision;
  recordFailure(ip: string): void;
  recordSuccess(ip: string): void;
  reset(): void;
}

interface RateEntry {
  failures: number[];
  lockedUntil: number;
}

export interface RateLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  lockMs?: number;
  maxEntries?: number;
}

export function createLoginRateLimiter(options: RateLimiterOptions = {}): LoginRateLimiter {
  const maxFailures = options.maxFailures ?? 5;
  const windowMs = options.windowMs ?? 60_000;
  const lockMs = options.lockMs ?? 5 * 60_000;
  const maxEntries = options.maxEntries ?? 1024;
  const entries = new Map<string, RateEntry>();

  const prune = (entry: RateEntry, now: number): void => {
    if (entry.lockedUntil <= now) {
      entry.lockedUntil = 0;
    }
    entry.failures = entry.failures.filter((time) => now - time < windowMs);
  };

  const getEntry = (ip: string, now: number): RateEntry => {
    let entry = entries.get(ip);
    if (!entry) {
      entry = { failures: [], lockedUntil: 0 };
      entries.set(ip, entry);
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined && oldest !== ip) {
          entries.delete(oldest);
        }
      }
    }
    prune(entry, now);
    return entry;
  };

  return {
    check(ip: string): RateLimitDecision {
      const now = Date.now();
      const entry = getEntry(ip, now);
      if (entry.lockedUntil > now) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
        };
      }
      if (entry.failures.length >= maxFailures) {
        entry.lockedUntil = now + lockMs;
        return { allowed: false, retryAfterSeconds: Math.ceil(lockMs / 1000) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    recordFailure(ip: string): void {
      const now = Date.now();
      const entry = getEntry(ip, now);
      entry.failures.push(now);
      if (entry.failures.length >= maxFailures) {
        entry.lockedUntil = now + lockMs;
      }
    },
    recordSuccess(ip: string): void {
      entries.delete(ip);
    },
    reset(): void {
      entries.clear();
    },
  };
}
