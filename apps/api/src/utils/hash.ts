import { createHash } from 'crypto';

export function contentHash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
