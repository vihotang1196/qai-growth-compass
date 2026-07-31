/**
 * 号码归一化 —— 前端、Edge Function、webhook 入库、登录查询共用这一份。
 *
 * 【为什么必须是同一份】webhook 入库用一套逻辑、登录查询用另一套,号码存进去
 * 和查出来对不上,而两边代码看起来都对。这类 bug 极难查,所以从源头上不给它
 * 存在的机会:supabase/functions/_shared/phone.ts 是本文件的 re-export,
 * 不是拷贝。
 *
 * 【import specifier】这里只写裸标识符 'libphonenumber-js/max'。
 * Vite 走 node_modules 解析;Deno 走 supabase/functions/deno.json 的 import map
 * 映射到 npm:libphonenumber-js@<pinned>/max。同一份文件不可能两个都写,
 * 所以裸标识符 + import map 是唯一能让两边都解析的写法。
 *
 * 【版本必须两边一致】libphonenumber 的号码元数据随版本变化,同一个输入在不同
 * 版本可能得到不同的 E.164。package.json 与 import map 的版本号由
 * `npm run check:dep-sync` 强制比对,不一致即构建失败。
 *
 * 用 /max 而不是默认元数据:默认集不含完整的 isValid 判定,而我们靠 isValid
 * 拒绝无效号码 —— 宁可让客户改用邮箱,也不能匹配错人把别人的报告给他看。
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

const DEFAULT_COUNTRY = 'MY';

/** 全角数字 / 加号 / 空格 → 半角。中文输入法真的会产出 ０１２ */
function toHalfWidth(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/＋/g, '+')
    .replace(/　/g, ' ');
}

/** 只留数字与开头的一个 +;中间的 + 一律丢掉 */
function clean(input: string): string {
  const half = toHalfWidth(input);
  const plus = half.trimStart().startsWith('+');
  const digits = half.replace(/\D/g, '');
  return plus ? `+${digits}` : digits;
}

/**
 * 归一化为 E.164。无法确定为有效号码时返回 null —— 绝不猜。
 *
 * 解析顺序:
 *   1. 有 + → 按国际号解析
 *   2. 无 + → 按默认国家 MY 解析
 *   3. 仍无效 → 补 + 再试(处理 '60124361382' / '6591234567' 这种带国码没 + 的)
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = clean(raw);
  if (c.replace(/\D/g, '').length < 7) return null; // 比任何国家的最短号码都短

  if (c.startsWith('+')) {
    const p = parsePhoneNumberFromString(c);
    return p?.isValid() ? p.number : null;
  }

  const national = parsePhoneNumberFromString(c, DEFAULT_COUNTRY);
  if (national?.isValid()) return national.number;

  const intl = parsePhoneNumberFromString(`+${c}`);
  return intl?.isValid() ? intl.number : null;
}

/** E.164 去 + 后最后 8 位。容错匹配键,只在 phone_e164 精确匹配失败时用 */
export function phoneTail(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const d = e164.replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
}

/**
 * 用户任意输入 → 用于 tail 回退查询的 8 位。
 *
 * 少于 8 位数字直接判无效,不进 tail 匹配 —— 防碰撞。
 * 宁可让他改用邮箱,也不能把别人的诊断报告给他看。
 */
export function tailFromInput(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = clean(raw).replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v ? v : null;
}
