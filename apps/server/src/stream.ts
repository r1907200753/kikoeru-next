import { createReadStream } from 'node:fs';
import type { FastifyReply } from 'fastify';

export interface ByteRange {
  start: number;
  end: number;
}

export type ParsedRange = ByteRange | null | 'invalid';

export function parseRange(header: string | undefined, size: number): ParsedRange {
  if (!header) {
    return null;
  }
  if (size <= 0) {
    return 'invalid';
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return 'invalid';
  }
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) {
    return 'invalid';
  }
  if (!startText) {
    const suffix = Number.parseInt(endText, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return 'invalid';
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number.parseInt(startText, 10);
  let end = endText ? Number.parseInt(endText, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size) {
    return 'invalid';
  }
  if (end < start) {
    return 'invalid';
  }
  end = Math.min(end, size - 1);
  return { start, end };
}

export interface FileStreamOptions {
  filePath: string;
  size: number;
  mimeType: string;
  rangeHeader: string | undefined;
  headOnly: boolean;
}

export function sendFileStream(reply: FastifyReply, options: FileStreamOptions) {
  const range = parseRange(options.rangeHeader, options.size);
  const baseHeaders: Record<string, string> = {
    'accept-ranges': 'bytes',
    'content-type': options.mimeType,
    'cache-control': 'private, max-age=0, must-revalidate',
  };

  if (range === 'invalid') {
    return reply
      .code(416)
      .headers({ ...baseHeaders, 'content-range': `bytes */${options.size}` })
      .send();
  }

  if (range) {
    const length = range.end - range.start + 1;
    reply
      .code(206)
      .headers({
        ...baseHeaders,
        'content-range': `bytes ${range.start}-${range.end}/${options.size}`,
        'content-length': String(length),
      });
    if (options.headOnly) {
      return reply.send();
    }
    return reply.send(createReadStream(options.filePath, { start: range.start, end: range.end }));
  }

  reply.code(200).headers({ ...baseHeaders, 'content-length': String(options.size) });
  if (options.headOnly) {
    return reply.send();
  }
  return reply.send(createReadStream(options.filePath));
}
