import { assertEquals } from '@std/assert';
import { rosterCsv, type RosterAttempt, type RosterRow } from './rosterCsv.ts';

/**
 * 名单 CSV(重填第 4 步加两列:「重填次数」「最新一次完成时间」)。
 *
 * 【加在最后,原来的列一格不动】这份 CSV 拿去做分群和人工排查 —— 按位置读它的表格 / 导入映射不该因为加了两列而错位。
 * 所以第一条用例把「今天的每一格」逐格钉住,与新加的两格分开断言。
 */
const OLD_HEADER = [
  '姓名', '手机', '手机原值', '邮箱', '批次', '状态', '登录时间', '完成时间', '总分', '档位', '最弱维度', '已停用',
  'PDF 状态(zh)', 'PDF 错误(zh)', 'PDF 状态(en)', 'PDF 错误(en)', '分享卡错误',
];

const parse = (csv: string) => {
  assertEquals(csv.startsWith('﻿'), true);
  return csv.slice(1).replace(/\r\n$/, '').split('\r\n').map((l) => l.split(','));
};

const attempt = (no: number, status: string, completedAt: string | null, total: number | null): RosterAttempt => ({
  id: `ses-${no}`,
  status,
  attempt_no: no,
  completed_at: completedAt,
  created_at: '2026-10-14T05:55:48+00:00',
  result: total === null ? null : { total, tier: total >= 4 ? 'flywheel' : 'spot', weakest: ['traffic', 'value'] },
  files: total === null ? [] : [{ lang: 'zh', pdf_status: 'ready', pdf_path: `ses-${no}-zh.pdf`, pdf_attempts: 1, pdf_last_error: null, share_card_error: null }],
});

const person = (attempts: RosterAttempt[], session: RosterAttempt | null, over: Partial<RosterRow> = {}): RosterRow => ({
  id: 'ent-1',
  name: 'Test Person',
  phone_e164: '+60123456789',
  phone_raw: '+60123456789',
  email_lower: 'a@example.test',
  status: session ? (attempts.some((x) => x.status === 'completed') ? 'completed' : 'started') : 'link_sent',
  first_login_at: session ? '2026-10-14T05:55:40+00:00' : null,
  // entitlement 上的完成时间 = 第一次完成的那一刻(与第 1 份的 completed_at 差几毫秒:两条 update 各取各的 now)
  completed_at: attempts.some((x) => x.status === 'completed') ? '2026-10-14T05:56:03.100+00:00' : null,
  link_sent_at: '2026-10-14T05:50:00+00:00',
  access_revoked_at: null,
  cohort: { id: 'c1', name: 'Batch 1', is_test: false },
  session,
  attempts,
  ...over,
});

const FIRST = attempt(1, 'completed', '2026-10-14T05:56:02.978+00:00', 2.5);

Deno.test('表头:原来的 17 列原样、原序,两列新的加在最后', () => {
  const [header] = parse(rosterCsv([]));
  assertEquals(header, [...OLD_HEADER, '重填次数', '最新一次完成时间']);
});

Deno.test('今天的数据(每人一份):原来的每一格不变;重填次数 0,最新一次完成时间 = 那一份的完成时间', () => {
  const [, row] = parse(rosterCsv([person([FIRST], FIRST)]));
  assertEquals(row.slice(0, OLD_HEADER.length), [
    // 号码以 + 开头:toCsv 前面加单引号防公式注入(今天就是这样)
    'Test Person', "'+60123456789", '', 'a@example.test', 'Batch 1', 'completed',
    '2026-10-14T05:55:40+00:00', '2026-10-14T05:56:03.100+00:00', '2.5', 'spot', 'traffic / value', '',
    'ready', '', 'absent', '', '',
  ]);
  assertEquals(row.slice(OLD_HEADER.length), ['0', '2026-10-14T05:56:02.978+00:00']);
});

Deno.test('重填过、还有一份没做完:分数是最新完成的那份;重填次数只数完成的;「完成时间」仍是第一次的', () => {
  const second = attempt(2, 'completed', '2026-10-15T06:32:29.472+00:00', 5);
  const open = attempt(3, 'in_progress', null, null);
  const [, row] = parse(rosterCsv([person([open, second, FIRST], second)]));
  const col = (name: string) => row[[...OLD_HEADER, '重填次数', '最新一次完成时间'].indexOf(name)];
  assertEquals(col('总分'), '5');
  assertEquals(col('档位'), 'flywheel');
  assertEquals(col('完成时间'), '2026-10-14T05:56:03.100+00:00');
  assertEquals(col('重填次数'), '1');
  assertEquals(col('最新一次完成时间'), '2026-10-15T06:32:29.472+00:00');
});

Deno.test('完成过两次重填:重填次数 2', () => {
  const second = attempt(2, 'completed', '2026-10-15T06:32:29.472+00:00', 5);
  const third = attempt(3, 'completed', '2026-10-16T06:41:45.892+00:00', 2.3);
  const [, row] = parse(rosterCsv([person([third, second, FIRST], third)]));
  assertEquals(row.slice(OLD_HEADER.length), ['2', '2026-10-16T06:41:45.892+00:00']);
});

Deno.test('还没完成过任何一份:两格都空(不是 0 —— 他还谈不上重填)', () => {
  const [, noSession, inProgress] = parse(rosterCsv([
    person([], null),
    person([attempt(1, 'in_progress', null, null)], attempt(1, 'in_progress', null, null)),
  ]));
  assertEquals(noSession.slice(OLD_HEADER.length), ['', '']);
  assertEquals(inProgress.slice(OLD_HEADER.length), ['', '']);
});
