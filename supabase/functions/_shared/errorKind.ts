/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/dbError.ts。
 *
 * `classifyError` 这个名字保留(`assessment-admin` 用它),实现是 `describeError`。
 * 分类规则、哪些能回客户端、为什么日志要先脱敏后截断,都写在那个文件里。
 *
 * 【2026-10-07 之前这里有一份独立实现】它对 supabase-js 返回的普通对象取
 * `String(err)`,于是生产日志里 message 一直是 `[object Object]` ——
 * 测试用的 fixture 是 `new Error()`,所以从来没红过。见 PROGRESS「PostgrestError 盘点」。
 */
export {
  describeError as classifyError,
  type ClassifiedError,
  type ErrorKind,
} from '../../../api/_lib/dbError.ts';
