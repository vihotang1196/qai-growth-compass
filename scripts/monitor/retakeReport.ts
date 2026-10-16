/**
 * `npm run monitor:retake` 的纯函数那一半(查询在 `scripts/monitor-retake.ts`):行 → 计数、什么算「需要看一眼」、怎么印。
 * 重填第 5 步(对真实学员开放)前后要看的数,2026-10-16 加。测试在 `src/lib/monitorRetake.test.ts`。
 *
 * 【只有计数与时间】输入里本来就没有个人信息(查询里就没取);这里也不印任何 id、错误原文 ——
 * GHL 的错误只印它的类别(写回代码自己加的前缀,`TRANSIENT` / `AUTH` / `CONFIG` …)与个数。
 * 开关的「谁」只印「记了 / 没记」,不印邮箱。
 */

export interface SwitchChangeRow {
  open: boolean;
  changed_at: string;
  /** changed_by 不是空白(邮箱本身不取) */
  who_recorded: boolean;
}

export interface RetakeCounts {
  at: string;
  /** 第 2 份及以后、还在库里的(放弃 = 删掉,不在这里) */
  retakes_in_db: number;
  retakes_completed: number;
  retakes_open: number;
  /** 没做完、开始超过 24 小时 */
  stuck_24h: number;
  oldest_open_started: string | null;
  /** 至少完成过一次重填的人 */
  people_retaken: number;
  last_started: string | null;
  last_completed: string | null;
  /** 最近一次「开」的时间;从没开过 = null */
  opened_at: string | null;
  started_since_open: number;
  completed_since_open: number;
  /** 第 2 份及以后的结果 */
  results: number;
  /** 最新那一份(没被更新的完成份取代)的字段没同步 */
  fields_unsynced: number;
  /** …而且出分超过 30 分钟(重试每 15 分钟一次,30 分钟还没好就不是「还在路上」)*/
  fields_unsynced_30m: number;
  /** …而且不再自动重试(next_retry_at 为空、有错误)*/
  fields_gave_up: number;
  tags_unsynced: number;
  tags_unsynced_30m: number;
  tags_gave_up: number;
  /** 被同一个人更新的一份取代、照设计不再同步的 */
  unsynced_superseded: number;
  last_result: string | null;
  /** 第 2 份及以后的报告文件(每份每种语言一个)*/
  files: number;
  pdf_ready: number;
  pdf_failed: number;
  /** 没好、重试次数用完(3 次)*/
  pdf_exhausted: number;
  /** 排队 / 渲染中超过 30 分钟(扫描每 10 分钟一次)*/
  pdf_stuck_30m: number;
  card_errors: number;
  /** 参照:这个范围里完成了第 1 份的人 */
  first_completed: number;
  /** 参照:另一个范围(真实 ↔ 测试)库里的重填份数,不算在上面 */
  other_scope_retakes: number;
}

const COUNT_KEYS = [
  'retakes_in_db', 'retakes_completed', 'retakes_open', 'stuck_24h', 'people_retaken', 'started_since_open', 'completed_since_open',
  'results', 'fields_unsynced', 'fields_unsynced_30m', 'fields_gave_up', 'tags_unsynced', 'tags_unsynced_30m', 'tags_gave_up',
  'unsynced_superseded', 'files', 'pdf_ready', 'pdf_failed', 'pdf_exhausted', 'pdf_stuck_30m', 'card_errors', 'first_completed',
  'other_scope_retakes',
] as const;
const TIME_KEYS = ['at', 'oldest_open_started', 'last_started', 'last_completed', 'opened_at', 'last_result'] as const;

/** CLI 回的一行 → 计数。缺一个、或不是数字 → 抛(绝不悄悄当成 0) */
export function parseCounts(row: Record<string, unknown>): RetakeCounts {
  const out: Record<string, unknown> = {};
  for (const k of COUNT_KEYS) {
    const v = row[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN;
    if (!Number.isInteger(n)) throw new Error(`监控查询少了「${k}」或它不是数字(${JSON.stringify(v)})`);
    out[k] = n;
  }
  for (const k of TIME_KEYS) {
    const v = row[k];
    out[k] = typeof v === 'string' ? v : null;
  }
  return out as unknown as RetakeCounts;
}

export type AttentionId =
  | 'stuck_24h'
  | 'fields_unsynced_30m'
  | 'tags_unsynced_30m'
  | 'fields_gave_up'
  | 'tags_gave_up'
  | 'pdf_failed'
  | 'pdf_exhausted'
  | 'pdf_stuck_30m'
  | 'card_errors';

const ATTENTION: readonly AttentionId[] = [
  'stuck_24h',
  'fields_unsynced_30m',
  'tags_unsynced_30m',
  'fields_gave_up',
  'tags_gave_up',
  'pdf_failed',
  'pdf_exhausted',
  'pdf_stuck_30m',
  'card_errors',
];

/**
 * 什么算「需要看一眼」(退出码 1)。还在路上的不算:做到一半的重填、出分不到 30 分钟还没同步的、
 * 被同一个人更新的一份取代而照设计不再同步的。
 */
export function attentionItems(c: RetakeCounts): { id: AttentionId; n: number }[] {
  return ATTENTION.filter((id) => c[id] > 0).map((id) => ({ id, n: c[id] }));
}

/** `2026-10-16 08:34:56.044825+00`(CLI 的样子)或 ISO → `2026-10-16 16:34 MYT (08:34Z)`;空的、读不懂的 → `—` */
export function toMyt(ts: string | null): string {
  if (!ts) return '—';
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const myt = new Date(ms + 8 * 3_600_000).toISOString();
  const utc = new Date(ms).toISOString();
  return `${myt.slice(0, 10)} ${myt.slice(11, 16)} MYT (${utc.slice(11, 16)}Z)`;
}

const ABANDON_NOTE =
  '放弃:数据库不留记录(放弃 = 删掉那一份)。次数看 Supabase → Edge Functions → assessment-quiz → Logs,搜 "retake abandoned"';

export function renderMonitor(input: {
  scope: 'real' | 'test';
  switchRows: SwitchChangeRow[];
  counts: RetakeCounts;
  ghlClasses: { kind: 'fields' | 'tags'; klass: string; n: number }[];
}): string {
  const { scope, switchRows, counts: c, ghlClasses } = input;
  const who = scope === 'real' ? '真实学员(所有不是测试批次的,含批次已删除的)' : '只有测试批次';
  const other = scope === 'real' ? '测试批次' : '真实学员';
  const classes = (kind: 'fields' | 'tags') => {
    const list = ghlClasses.filter((g) => g.kind === kind);
    return list.length ? `;错误类别:${list.map((g) => `${g.klass} ${g.n}`).join('、')}` : '';
  };
  const latest = switchRows[0];
  const lines = [
    `重填监控(只读;只有计数与时间,没有个人信息)—— ${toMyt(c.at)}`,
    `范围:${who};第 2 份及以后`,
    '',
    '开关',
    latest
      ? `  现在:${latest.open ? '开放' : '关闭'}(最近一次切换 ${toMyt(latest.changed_at)})`
      : '  现在:关闭(一条记录都没有 = 关闭)',
    ...(switchRows.length
      ? switchRows.map((r) => `  · ${toMyt(r.changed_at)} ${r.open ? '开放' : '关闭'}  记录了谁:${r.who_recorded ? '是' : '否 ⚠️'}`)
      : ['  切换记录:没有']),
    '',
    '重填',
    `  库里现有 ${c.retakes_in_db} 份:完成 ${c.retakes_completed}、没做完 ${c.retakes_open};完成过重填的人 ${c.people_retaken}`,
    `  最近一次开始 ${toMyt(c.last_started)};最近一次完成 ${toMyt(c.last_completed)}`,
    ...(c.opened_at
      ? [`  开放以来(${toMyt(c.opened_at)} 起):开始 ${c.started_since_open} 份(还在库里的)、完成 ${c.completed_since_open} 份`]
      : ['  开放以来:还没开放过']),
    `  ${ABANDON_NOTE}`,
    `  卡住没做完(开始超过 24 小时):${c.stuck_24h}${c.retakes_open ? `;最早一份没做完的开始于 ${toMyt(c.oldest_open_started)}` : ''}`,
    '',
    `GHL(第 2 份及以后的结果 ${c.results} 份;最近一次出分 ${toMyt(c.last_result)})`,
    `  字段没同步(最新那一份):${c.fields_unsynced} —— 其中出分超过 30 分钟 ${c.fields_unsynced_30m}、不再自动重试 ${c.fields_gave_up}${classes('fields')}`,
    `  标签没同步(最新那一份):${c.tags_unsynced} —— 其中出分超过 30 分钟 ${c.tags_unsynced_30m}、不再自动重试 ${c.tags_gave_up}${classes('tags')}`,
    `  被同一个人更新的一份取代、照设计不再同步的:${c.unsynced_superseded}`,
    '',
    `PDF(第 2 份及以后的文件 ${c.files} 个)`,
    `  好了 ${c.pdf_ready};失败 ${c.pdf_failed};重试用完 ${c.pdf_exhausted};排队 / 渲染超过 30 分钟 ${c.pdf_stuck_30m};分享卡出错 ${c.card_errors}`,
    '',
    `参照:这个范围里完成了第 1 份的 ${c.first_completed} 人;${other}库里的重填 ${c.other_scope_retakes} 份(不算在上面)`,
    '',
  ];
  const flagged = attentionItems(c);
  lines.push(
    flagged.length
      ? `需要看一眼(exit 1):${flagged.map((f) => `${f.id} ${f.n}`).join('、')}`
      : '需要看一眼:没有(exit 0)',
  );
  return lines.join('\n');
}
