/**
 * CSV 生成 —— 纯函数。
 *
 * 两类问题都在这里处理,因为它们都只在「导出的文件被人用 Excel 打开」时才暴露,
 * 而那时候已经晚了。
 */

/**
 * 【公式注入】以 = + - @ 或制表符 / 回车开头的单元格,Excel 与 Google Sheets 会
 * 当成公式执行。学员姓名来自 GHL,是外部输入 —— 一个叫 `=cmd|'/c calc'!A1` 的
 * 「姓名」在导出文件被打开时就会执行。
 *
 * 防法是前面加一个单引号,Excel 会把整格当文本。这不是理论风险:
 * 名单导出的用途就是「下载下来用 Excel 看」,那正是触发条件。
 */
const RISKY_LEADING = /^[=+\-@\t\r]/;

/** 【转义】含逗号、引号、换行的值必须用双引号包起来,内部的引号翻倍 */
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (RISKY_LEADING.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  /**
   * 【BOM】不加的话 Excel 在中文 Windows 上会按本地代码页解码 UTF-8,
   * 姓名和维度名全是乱码。加 BOM 是让 Excel 认出 UTF-8 的唯一可靠办法。
   * 用 \r\n 是同样的理由 —— Excel 对纯 \n 的兼容性不稳。
   */
      /**
       * 开头那个 `\uFEFF` 是 **BOM,不是脏数据 —— 别删**。
       * Excel 打开 CSV 时靠它认出 UTF-8;没有它,中文姓名会变成乱码 ——
       * 而乱码的 CSV 拿去做 GHL 分群,错的是联系人的名字。
       *
       * 【为什么写成转义而不是那个字符本身】BOM 在编辑器里**完全不可见**,
       * 看起来就是「文件开头什么都没有」。一个 Excel 兼容的关键字符
       * 以没人看得见的形式待在代码里,本身就是个问题;转义之后它有名字了。
       */
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
