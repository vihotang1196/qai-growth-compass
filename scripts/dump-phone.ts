/**
 * 把 phone.ts 对全部用例的实际输出打成确定性文本,供跨运行时逐字对比。
 *
 * 同一个文件在两个运行时各跑一次:
 *   node scripts/dump-phone.ts                    (Node,靠原生类型剥离直接跑 .ts)
 *   deno run --allow-read scripts/dump-phone.ts   (Deno)
 * 再 diff 两份输出。见 scripts/check-cross-runtime.mjs。
 *
 * 为什么不只看「两个测试套件都绿」:那只证明两边都等于 cases 里的 expected,
 * 逻辑上确实能推出两边相等。但 dump 是把真实值摆出来,一眼能看到差在哪一条、
 * 差成什么样,排查时比一句 assertion failed 有用得多。
 */
import {
  EMAIL_CASES,
  NORMALIZE_CASES,
  PHONE_TAIL_CASES,
  TAIL_FROM_INPUT_CASES,
} from '../src/lib/phone.cases.ts';
import {
  normalizeEmail,
  normalizePhone,
  phoneTail,
  tailFromInput,
} from '../src/lib/phone.ts';

const lines: string[] = [];

function emit(fn: string, input: unknown, output: unknown): void {
  lines.push(`${fn}\t${JSON.stringify(input) ?? 'undefined'}\t${JSON.stringify(output) ?? 'undefined'}`);
}

for (const c of NORMALIZE_CASES) emit('normalizePhone', c.input, normalizePhone(c.input));
for (const c of PHONE_TAIL_CASES) emit('phoneTail', c.input, phoneTail(c.input));
for (const c of TAIL_FROM_INPUT_CASES) emit('tailFromInput', c.input, tailFromInput(c.input));
for (const c of EMAIL_CASES) emit('normalizeEmail', c.input, normalizeEmail(c.input));

console.log(lines.join('\n'));
