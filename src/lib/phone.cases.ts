/**
 * 号码用例 —— 纯数据,不 import 任何测试框架。
 *
 * 【为什么单独一个文件】这组用例要在两个运行时各跑一遍:Vitest(Node)与
 * Deno(Edge Function 的运行时)。「同一份源码」只保证源码一致,不保证行为
 * 一致 —— 只有两边跑同一组用例并断言输出逐字相同,才算真的验过了。
 *
 * 所以这里不能有 describe / it / assert,只有数据。两边各自的 runner 去消费它。
 *
 * 说明文字一律英文:本目录受 `npm run lint:cjk` 管辖,src/config/** 之外
 * 不允许出现中日韩字符。中文写在注释里,注释不受管辖。
 */

export interface NormalizeCase {
  input: string | null | undefined;
  expected: string | null;
  why: string;
}

/** 归一化用例。前 9 条是需求里点名的,其余是我补的边界 */
export const NORMALIZE_CASES: NormalizeCase[] = [
  // ── 需求点名的 9 条 ──────────────────────────────────────
  { input: '012-436 1382', expected: '+60124361382', why: 'MY mobile with dash and space' },
  { input: '+60124361382', expected: '+60124361382', why: 'already E.164' },
  { input: '0124361382', expected: '+60124361382', why: 'MY national with leading zero' },
  { input: '60124361382', expected: '+60124361382', why: 'country code without plus, falls to pass 3' },
  { input: '012 436 1382', expected: '+60124361382', why: 'spaces only' },
  { input: '(012) 4361382', expected: '+60124361382', why: 'parentheses' },
  { input: '０１２４３６１３８２', expected: '+60124361382', why: 'full-width digits from a CJK IME' },
  { input: '+6591234567', expected: '+6591234567', why: 'SG must not be read as MY' },
  { input: '12345', expected: null, why: 'too short to be any number' },

  // ── 区域覆盖 ────────────────────────────────────────────
  { input: '6591234567', expected: '+6591234567', why: 'SG country code without plus' },
  { input: '+6281234567890', expected: '+6281234567890', why: 'Indonesia' },
  { input: '+886912345678', expected: '+886912345678', why: 'Taiwan' },
  { input: '+8613800138000', expected: '+8613800138000', why: 'China mainland' },

  // ── 脏输入 ──────────────────────────────────────────────
  { input: '  012 436 1382  ', expected: '+60124361382', why: 'leading and trailing whitespace' },
  // 实测修正:我原本期望这条得到 +60124361382,错了。
  // config 的 phone_normalization 规定的顺序是【先去掉所有非数字非加号字符,
  // 再 parse】,所以 'ext 5' 的那个 5 会被并进号码本体,变成 11 位的
  // 01243613825 —— 对 MY 手机号无效,于是返回 null。
  // 这不是缺陷,是设计要的降级:拿不准就返回 null,记录仍然入库、
  // phone_raw 保留原值、Admin 名单页标红「号码格式异常」,由人来修。
  // 若改成先用 libphonenumber 原生解析(它认得 ext),就违背了 config 定的顺序,
  // 而 config 是真相源。所以改期望值,不改函数。
  { input: '012-436-1382 ext 5', expected: null, why: 'extension digits merge into the number and invalidate it; we refuse to guess' },
  { input: '+60-12-436 1382', expected: '+60124361382', why: 'plus with separators' },
  { input: '', expected: null, why: 'empty string' },
  { input: null, expected: null, why: 'null' },
  { input: undefined, expected: null, why: 'undefined' },
  { input: 'abcdefgh', expected: null, why: 'no digits at all' },
  { input: '0000000000', expected: null, why: 'structurally digit-shaped but not a real number' },
  // 这条是 isValid 与 isPossible 的分界线:号段不存在,但位数像。
  // 期望值不靠我猜,由实测确定 —— 见 PROGRESS.md Stage 2 记录。
  { input: '+60999999999', expected: null, why: 'MY prefix 99 is not an assigned range; isValid must reject it' },
];

export interface TailCase {
  input: string | null | undefined;
  expected: string | null;
  why: string;
}

/** phoneTail:从已归一化的 E.164 取容错匹配键 */
export const PHONE_TAIL_CASES: TailCase[] = [
  { input: '+60124361382', expected: '24361382', why: 'last 8 digits of the E.164' },
  { input: '+6591234567', expected: '91234567', why: 'SG number is exactly 8 after the country code' },
  { input: null, expected: null, why: 'null in, null out' },
  { input: '', expected: null, why: 'empty in, null out' },
];

/** tailFromInput:从用户任意输入取 tail。< 8 位一律 null,防碰撞 */
export const TAIL_FROM_INPUT_CASES: TailCase[] = [
  { input: '12345678', expected: '12345678', why: 'exactly 8 digits is allowed' },
  { input: '4361382', expected: null, why: '7 digits must not enter tail matching' },
  { input: '012-436 1382', expected: '24361382', why: 'separators stripped before slicing' },
  { input: '０１２４３６１３８２', expected: '24361382', why: 'full-width normalised before slicing' },
  { input: '', expected: null, why: 'empty' },
  { input: null, expected: null, why: 'null' },
];

export interface EmailCase {
  input: string | null | undefined;
  expected: string | null;
  why: string;
}

export const EMAIL_CASES: EmailCase[] = [
  { input: '  Foo@Bar.COM ', expected: 'foo@bar.com', why: 'trimmed and lowercased' },
  { input: 'already@lower.com', expected: 'already@lower.com', why: 'unchanged' },
  { input: '   ', expected: null, why: 'whitespace only becomes null, not empty string' },
  { input: null, expected: null, why: 'null' },
];
