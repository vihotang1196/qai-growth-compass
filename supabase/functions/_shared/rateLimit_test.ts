import { assertEquals } from '@std/assert';
import { DEFAULT_RATE_LIMIT, evaluateRateLimit, lookbackMs } from './rateLimit.ts';

const MIN = 60_000;
const NOW = 1_800_000_000_000;
/** 相对 NOW 往前 n 分钟 */
const ago = (n: number) => NOW - n * MIN;

Deno.test('没有尝试记录 → 不锁', () => {
  assertEquals(evaluateRateLimit([], NOW), { locked: false, lockedUntil: null });
});

Deno.test('窗口内 4 次 → 不锁(第 5 次才触发)', () => {
  const attempts = [ago(10), ago(8), ago(6), ago(4)];
  assertEquals(evaluateRateLimit(attempts, NOW).locked, false);
});

Deno.test('15 分钟内 5 次 → 锁,且锁到第 5 次 + 1 小时', () => {
  const attempts = [ago(14), ago(12), ago(10), ago(8), ago(6)];
  const v = evaluateRateLimit(attempts, NOW);
  assertEquals(v.locked, true);
  assertEquals(v.lockedUntil, ago(6) + 60 * MIN);
});

Deno.test('5 次分散在 50 分钟里 → 不锁', () => {
  // 这条是关键:如果实现成「最近 1 小时 >= 5 次就锁」,一个手滑输错 5 次号码的
  // 正常客户会被锁一小时,而规则本来允许他这么做
  const attempts = [ago(50), ago(40), ago(30), ago(20), ago(10)];
  assertEquals(evaluateRateLimit(attempts, NOW).locked, false);
});

Deno.test('锁定期满 → 解锁', () => {
  // 5 次都在 2 小时前的一个 15 分钟窗口里,第 5 次距今 105 分钟 > 60 分钟
  const attempts = [ago(120), ago(118), ago(112), ago(108), ago(105)];
  assertEquals(evaluateRateLimit(attempts, NOW), { locked: false, lockedUntil: null });
});

Deno.test('锁定期内继续试 → 锁被刷新到更晚', () => {
  // burst 的第 5 次在 42 分钟前 —— 5 次落在 8 分钟内,且距今 < 60 分钟,所以此刻是锁着的
  const burst = [ago(50), ago(48), ago(46), ago(44), ago(42)];
  const first = evaluateRateLimit(burst, NOW);
  assertEquals(first.locked, true);
  assertEquals(first.lockedUntil, ago(42) + 60 * MIN);

  // 锁定期内又猛试 5 次,构成一个新的 15 分钟窗口 → 锁被推到新的第 5 次 + 1 小时
  const more = [...burst, ago(12), ago(10), ago(8), ago(6), ago(4)];
  const v = evaluateRateLimit(more, NOW);
  assertEquals(v.locked, true);
  assertEquals(v.lockedUntil, ago(4) + 60 * MIN, '应取最晚的那个第 5 次');
});

Deno.test('补几次但凑不满新窗口 → 锁不被刷新,仍按原来那次算', () => {
  // 这条是上一条写错时暴露出来的:补 4 次凑不出新的 5-in-15 窗口,
  // 所以 lockedUntil 应该还是老的那个,不该跟着最后一次尝试往后跑
  const burst = [ago(50), ago(48), ago(46), ago(44), ago(42)];
  const v = evaluateRateLimit([...burst, ago(10), ago(8), ago(6), ago(4)], NOW);
  assertEquals(v.locked, true);
  assertEquals(v.lockedUntil, ago(42) + 60 * MIN);
});

Deno.test('时间戳乱序传入也能正确判定', () => {
  const shuffled = [ago(6), ago(14), ago(10), ago(8), ago(12)];
  const v = evaluateRateLimit(shuffled, NOW);
  assertEquals(v.locked, true);
  assertEquals(v.lockedUntil, ago(6) + 60 * MIN);
});

Deno.test('恰好落在窗口边界上的第 5 次算触发', () => {
  const attempts = [ago(15), ago(14), ago(13), ago(12), NOW - DEFAULT_RATE_LIMIT.windowMs];
  // 第一个与最后一个相差恰好 15 分钟 → <= windowMs,算触发
  assertEquals(evaluateRateLimit(attempts, NOW).locked, true);
});

Deno.test('maxAttempts <= 0 一律锁死(防配置写错时变成不限流)', () => {
  const v = evaluateRateLimit([], NOW, { ...DEFAULT_RATE_LIMIT, maxAttempts: 0 });
  assertEquals(v.locked, true);
});

Deno.test('lookbackMs = 窗口 + 锁定时长', () => {
  assertEquals(lookbackMs(), 75 * MIN);
});
