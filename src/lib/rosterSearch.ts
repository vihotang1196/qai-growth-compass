/**
 * 名单搜索(Viho 2026-10-14):按姓名、电话、邮箱查,部分匹配、不分大小写。
 *
 * 【在浏览器里过滤,不在查询时过滤】名单页本来就一次取全量、在前端筛(批次、状态、分数区间都是)——
 * 搜索是同一类筛选,放在同一处。另外两条理由:
 *   - **搜索词不进日志**:它从不离开浏览器 —— 不发请求、不进 URL、不进 localStorage。
 *     放到服务端的话,PostgREST 的 `ilike` 过滤写在请求 URL 里,Supabase 的 API 日志会原样记下来
 *     (而搜索词常常就是一个人的电话或邮箱)。
 *   - 每敲一个字都不用等网络;190 行(2026-10-14)过滤一次是微秒级。
 * 【什么时候要改】瓶颈不在搜索,在「一次取全量」:每行约 0.6 KB,几千行时名单本身就有几 MB。
 * 到那时名单要改成服务端分页,搜索随之挪到服务端 —— 走 POST body(RPC),不走 URL,函数里也不打印搜索词。
 * 见 assessment-admin 的 roster() 注释。
 *
 * 【怎么算匹配】
 *   - 文字:NFKC(全角折成半角)+ 小写 + 合并空白之后,姓名 / 邮箱 / 原始号码 / E.164 号码里**包含**搜索词
 *   - 号码:搜索词**只由数字和号码里常见的符号组成**时(`+ - ( ) . 空格`),再按「只留数字」比一次 ——
 *     于是 `012-345 6789`、`0123456789`、`+60 12 345 6789` 都能找到 `+60123456789`
 *     (马来西亚的本地 0 正好是国家码 60 的结尾)。混着字母的搜索词(`ann2024`)不按数字比,
 *     免得「2024」碰巧命中某个号码的结尾。
 */
export interface SearchableRow {
  name: string | null;
  phone_e164: string | null;
  phone_raw: string | null;
  email_lower: string | null;
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const digitsOnly = (s: string) => s.replace(/\D/g, '');
const PHONE_LIKE = /^[\d\s+\-().]+$/;

export function rosterMatches(row: SearchableRow, query: string): boolean {
  const q = fold(query);
  if (q === '') return true;
  const texts = [row.name, row.email_lower, row.phone_raw, row.phone_e164];
  if (texts.some((t) => t !== null && fold(t).includes(q))) return true;
  if (PHONE_LIKE.test(q)) {
    const qd = digitsOnly(q);
    if (qd !== '') return [row.phone_e164, row.phone_raw].some((p) => p !== null && digitsOnly(p).includes(qd));
  }
  return false;
}
