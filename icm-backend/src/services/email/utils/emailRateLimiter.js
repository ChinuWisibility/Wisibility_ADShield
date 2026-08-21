/**
 * Token-bucket rate limiter for outbound email (default 50/min).
 */
class EmailRateLimiter {
  constructor(maxPerMinute = 50) {
    this.maxPerMinute = maxPerMinute;
    this.timestamps = [];
  }

  async acquire() {
    const now = Date.now();
    const windowMs = 60_000;
    this.timestamps = this.timestamps.filter((t) => now - t < windowMs);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0];
      const waitMs = windowMs - (now - oldest) + 50;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.acquire();
    }

    this.timestamps.push(Date.now());
  }
}

const limitPerMin = Number(process.env.EMAIL_RATE_LIMIT_PER_MIN || 50);
export const emailRateLimiter = new EmailRateLimiter(limitPerMin);

export default emailRateLimiter;
