import { assertEquals } from '@std/assert';
import { toCsv } from './csv.ts';

/** 去掉 BOM 与末尾换行,方便按行断言 */
function body(csv: string): string[] {
      // ^\uFEFF = 剥掉 csv.ts 加的那个 BOM(见那边的注释:Excel 靠它认 UTF-8)
  return csv.replace(/^\uFEFF/, '').replace(/\r\n$/, '').split('\r\n');
}

Deno.test('基本表头与行', () => {
  assertEquals(body(toCsv(['a', 'b'], [[1, 2], [3, 4]])), ['a,b', '1,2', '3,4']);
});

Deno.test('null 与 undefined 变空单元格,不是字符串 null', () => {
  assertEquals(body(toCsv(['a', 'b'], [[null, undefined]])), ['a,b', ',']);
});

Deno.test('含逗号 / 引号 / 换行的值被正确转义', () => {
  const rows = [['Tan, Wei Ming', 'he said "hi"', 'line1\nline2']];
  assertEquals(body(toCsv(['name', 'quote', 'multi'], rows)), [
    'name,quote,multi',
    '"Tan, Wei Ming","he said ""hi""","line1\nline2"',
  ]);
});

Deno.test('公式注入被中和 —— 五种起始字符', () => {
  // 学员姓名来自 GHL,是外部输入。名单导出的用途就是用 Excel 打开,
  // 那正是公式被执行的条件
  for (const evil of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx']) {
    const line = body(toCsv(['name'], [[evil]]))[1];
    assertEquals(line.startsWith("'"), true, `未中和: ${JSON.stringify(evil)} → ${line}`);
  }
});

Deno.test('真实的公式注入载荷:既中和又转义', () => {
  const payload = '=cmd|\'/c calc\'!A1';
  const line = body(toCsv(['name'], [[payload]]))[1];
  // 前缀单引号必须在,且不能因为转义把它丢掉
  assertEquals(line.startsWith("'="), true, line);
});

Deno.test('正常的负数会被加前缀 —— 这是刻意的权衡', () => {
  // -5 会变成 '-5。代价是数字列在 Excel 里成了文本;
  // 但我们导出的数值列(总分)不会是负数,而姓名列可能以 - 开头。
  // 宁可让一个不存在的负数变文本,也不能让姓名执行公式
  assertEquals(body(toCsv(['n'], [[-5]]))[1], "'-5");
});

Deno.test('BOM 与 CRLF 都在 —— Excel 认 UTF-8 靠这两个', () => {
  const csv = toCsv(['姓名'], [['陈大文']]);
  assertEquals(csv.startsWith('\uFEFF'), true, '缺 BOM,中文在 Excel 里会乱码');
  assertEquals(csv.includes('\r\n'), true, '缺 CRLF');
  assertEquals(csv.endsWith('\r\n'), true, '末行也要有换行');
});

Deno.test('空行集合仍产出表头', () => {
  assertEquals(body(toCsv(['a', 'b'], [])), ['a,b']);
});
