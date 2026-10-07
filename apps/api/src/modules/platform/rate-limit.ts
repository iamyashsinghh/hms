import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/errors/errors';

/** Small in-memory fixed-window limiter for public endpoints (signup, admin login). Per API instance. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string): void {
    const now = Date.now();
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    cur.count++;
    if (cur.count > this.limit) {
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many attempts. Please try again later.');
    }
  }

  reset(): void {
    this.hits.clear();
  }
}
