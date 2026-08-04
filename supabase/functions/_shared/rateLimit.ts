/**
 * IP 限流的判定逻辑 —— 纯函数,不查库。
 *
 * 规则(PROGRESS.md Stage 4 第 3 条):15 分钟内 5 次 → 锁 1 小时。
 *
 * 【为什么不用「最近 1 小时 >= 5 次就锁」这种一行写法】那等于把规则悄悄改成
 * 「每小时 5 次」—— 一个手滑输错 5 次号码的正常客户(五次分散在 50 分钟里)
 * 会被锁一小时,而规则本来允许他这么做。
 *
 * 所以这里按字面实现:在时间戳序列里找「任意 15 分钟窗口内的第 5 次尝试」,
 * 那一刻起锁 1 小时。取最晚的那个第 5 次 —— 连续猛试会不断刷新锁。
 */

export interface RateLimitConfig {
  /** 窗口内允许的次数 */
  maxAttempts: number;
  /** 窗口长度,毫秒 */
  windowMs: number;
  /** 触发后的锁定时长,毫秒 */
  lockoutMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 60 * 60 * 1000,
};

export interface RateLimitVerdict {
  locked: boolean;
  /** 锁到什么时候(epoch ms);未锁时为 null */
  lockedUntil: number | null;
}

/**
 * @param attemptsMs 该 IP 的历史尝试时间戳(epoch ms),顺序无所谓,内部会排序。
 *                   调用方只需取最近 windowMs + lockoutMs 之内的即可。
 * @param nowMs 当前时间
 */
export function evaluateRateLimit(
  attemptsMs: readonly number[],
  nowMs: number,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
): RateLimitVerdict {
  const { maxAttempts, windowMs, lockoutMs } = config;
  if (maxAttempts <= 0) return { locked: true, lockedUntil: nowMs + lockoutMs };

  const sorted = [...attemptsMs].sort((a, b) => a - b);
  let latestTrigger: number | null = null;

  // 第 maxAttempts 次落在某个 windowMs 窗口内 → 那一刻触发锁定
  for (let i = maxAttempts - 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - (maxAttempts - 1)] <= windowMs) {
      latestTrigger = sorted[i]; // 继续找更晚的,连续猛试会刷新锁
    }
  }

  if (latestTrigger === null) return { locked: false, lockedUntil: null };

  const lockedUntil = latestTrigger + lockoutMs;
  return lockedUntil > nowMs ? { locked: true, lockedUntil } : { locked: false, lockedUntil: null };
}

/** 查库时要往回捞多久的记录 —— 窗口 + 锁定时长,再多也没用 */
export function lookbackMs(config: RateLimitConfig = DEFAULT_RATE_LIMIT): number {
  return config.windowMs + config.lockoutMs;
}
