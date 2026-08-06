import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  Table,
  TableWrap,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { adminPost } from '@/lib/adminApi';

interface RosterRow {
  id: string;
  name: string | null;
  phone_e164: string | null;
  phone_raw: string | null;
  email_lower: string | null;
  status: string;
  first_login_at: string | null;
  completed_at: string | null;
  access_revoked_at: string | null;
  cohort: { id: string; name: string } | null;
  session: {
    id: string;
    status: string;
    result: {
      total: number;
      tier: string;
      weakest: string[];
      pdf_status: string;
      pdf_last_error: string | null;
    } | null;
  } | null;
}

interface RosterResponse {
  rows: RosterRow[];
  stats: { total: number; unparseablePhones: number; unparseableRatio: number; thresholdExceeded: boolean };
}

const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

/**
 * 名单管理页。
 *
 * 【筛选在前端做】后端一次返回全量。当前批次规模是几十到一两百人,够用,而且省一张
 * SQL 视图(视图要走 migration)。**批次上到几千人时要把筛选推回 SQL** ——
 * 这条限制写在 assessment-admin 的 roster() 注释里,不是随口一提。
 */
export default function Roster({ onAuthLost }: { onAuthLost: (forbidden: boolean) => void }) {
  const { tk, locale } = useT();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [cohort, setCohort] = useState('');
  const [status, setStatus] = useState('');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [badPhoneOnly, setBadPhoneOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminPost<RosterResponse>('roster'));
    } catch (err) {
      // 401 / 403 交给外层处理 —— 那不是这个页面该决定的事
      if (err instanceof Error && (err.message === 'unauthorized' || err.message === 'forbidden')) {
        onAuthLost(err.message === 'forbidden');
        return;
      }
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onAuthLost]);

  useEffect(() => {
    void load();
  }, [load]);

  const cohorts = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of data?.rows ?? []) if (r.cohort) map.set(r.cohort.id, r.cohort.name);
    return [...map.entries()];
  }, [data]);

  const rows = useMemo(() => {
    const min = minScore === '' ? null : Number(minScore);
    const max = maxScore === '' ? null : Number(maxScore);
    return (data?.rows ?? []).filter((r) => {
      if (cohort && r.cohort?.id !== cohort) return false;
      if (status && r.status !== status) return false;
      if (badPhoneOnly && r.phone_e164 !== null) return false;
      const total = r.session?.result?.total ?? null;
      // 设了分数区间就意味着「只看已完成的」—— 没分数的人无法参与比较
      if (min !== null && (total === null || total < min)) return false;
      if (max !== null && (total === null || total > max)) return false;
      return true;
    });
  }, [data, cohort, status, minScore, maxScore, badPhoneOnly]);

  /**
   * 重新生成 PDF —— 不加确认框(重置只是重渲一次,误点成本很低;确认框会让人形成
   * 「点确认」的肌肉记忆,而那个习惯会在真正危险的操作上害人)。
   * Admin 这边【等】结果,与 finalize 那边异步不同:那边客户在等分数不该被拖住,
   * 这边是人主动点的,要的就是结果。
   */
  async function renderPdf(row: RosterRow) {
    const sessionId = row.session?.id;
    if (!sessionId || busyId === row.id) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      const res = await adminPost<{ ok: boolean; detail?: string }>('render_pdf', { session_id: sessionId });
      if (!res.ok) setNotice(res.detail ?? 'render failed');
      await load();
    } catch (err) {
      if (err instanceof Error && (err.message === 'unauthorized' || err.message === 'forbidden')) {
        onAuthLost(err.message === 'forbidden');
        return;
      }
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function act(action: 'resend' | 'rotate' | 'revoke', row: RosterRow) {
    if (action === 'rotate' && !window.confirm(tk('admin.confirmRotate'))) return;
    if (action === 'revoke' && !window.confirm(tk('admin.confirmRevoke'))) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      const res = await adminPost<{ ok: boolean; queued: boolean }>(action, {
        entitlement_id: row.id,
        lang: locale,
      });
      // queued=false 意味着 GHL 收下了但没进执行队列(多半是 workflow 还是 Draft)。
      // 不说出来的话它就是一次静默的「以为发了」
      if (action !== 'revoke' && res.ok && !res.queued) setNotice(tk('admin.notQueued'));
      await load();
    } catch (err) {
      if (err instanceof Error && (err.message === 'unauthorized' || err.message === 'forbidden')) {
        onAuthLost(err.message === 'forbidden');
        return;
      }
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function exportCsv() {
    try {
      const res = await adminPost<{ filename: string; csv: string }>('export');
      const url = URL.createObjectURL(new Blob([res.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  const stats = data?.stats;
  const pct = stats ? `${(stats.unparseableRatio * 100).toFixed(1)}%` : '';

  return (
    <div className="space-y-4">
      {stats && (
        <Card tone={stats.thresholdExceeded ? 'accent' : 'paper'} padding="sm">
          <CardBody className="font-body text-sm">
            {tk('admin.phoneRatio')
              .replace('{bad}', String(stats.unparseablePhones))
              .replace('{total}', String(stats.total))
              .replace('{pct}', pct)}
            {stats.thresholdExceeded && (
              <span className="ml-2 font-bold">{tk('admin.phoneRatioOver')}</span>
            )}
          </CardBody>
        </Card>
      )}

      <Card padding="sm">
        <CardBody className="flex flex-wrap items-end gap-3">
          <select
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
            className="h-12 border-brutal border-line bg-paper px-3 font-body text-sm"
          >
            <option value="">{tk('admin.filter.cohort')}</option>
            {cohorts.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-12 border-brutal border-line bg-paper px-3 font-body text-sm"
          >
            <option value="">{tk('admin.filter.status')}</option>
            {['pending', 'link_sent', 'started', 'completed'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="w-28">
            <Input
              type="number"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder={tk('admin.filter.minScore')}
            />
          </div>
          <div className="w-28">
            <Input
              type="number"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              placeholder={tk('admin.filter.maxScore')}
            />
          </div>
          <label className="flex items-center gap-2 font-body text-sm">
            <input
              type="checkbox"
              checked={badPhoneOnly}
              onChange={(e) => setBadPhoneOnly(e.target.checked)}
              className="h-5 w-5 border-brutal border-line"
            />
            {tk('admin.filter.badPhoneOnly')}
          </label>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {tk('admin.refresh')}
          </Button>
          <Button size="sm" variant="solid" onClick={() => void exportCsv()}>
            {tk('common.export')}
          </Button>
        </CardBody>
      </Card>

      {notice && (
        <Card tone="ink" padding="sm">
          <CardBody className="font-body text-sm">{notice}</CardBody>
        </Card>
      )}

      {loading ? (
        <Card padding="md">
          <CardBody>{tk('common.loading')}</CardBody>
        </Card>
      ) : rows.length === 0 ? (
        <Card padding="md">
          <CardBody>{tk('admin.empty')}</CardBody>
        </Card>
      ) : (
        <TableWrap>
          <Table>
            <Thead>
              <Tr>
                {[
                  'admin.col.name',
                  'admin.col.phone',
                  'admin.col.email',
                  'admin.col.cohort',
                  'admin.col.status',
                  'admin.col.firstLogin',
                  'admin.col.completed',
                  'admin.col.total',
                  'admin.col.tier',
                  'admin.col.weakest',
                  'admin.col.pdf',
                  'admin.col.actions',
                ].map((k) => (
                  <Th key={k}>{tk(k as Parameters<typeof tk>[0])}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                /* 号码解析失败的行标红 —— flagged 用黄底,不引入新色相 */
                <Tr key={r.id} flagged={r.phone_e164 === null}>
                  <Td>{r.name ?? '—'}</Td>
                  <Td>
                    {r.phone_e164 ?? (
                      <span className="font-bold">
                        {r.phone_raw ?? '—'} · {tk('admin.phoneBad')}
                      </span>
                    )}
                  </Td>
                  <Td>{r.email_lower ?? '—'}</Td>
                  <Td>{r.cohort?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={r.status === 'completed' ? 'ink' : 'muted'}>{r.status}</Badge>
                    {r.access_revoked_at && (
                      <Badge tone="accent" className="ml-1">
                        {tk('admin.revoked')}
                      </Badge>
                    )}
                  </Td>
                  <Td>{fmt(r.first_login_at)}</Td>
                  <Td>{fmt(r.completed_at)}</Td>
                  <Td>{r.session?.result?.total ?? '—'}</Td>
                  <Td>{r.session?.result?.tier ?? '—'}</Td>
                  <Td>{r.session?.result?.weakest?.join(' / ') ?? '—'}</Td>
                  <Td>
                    {r.session?.result ? (
                      <div className="flex flex-col gap-1">
                        <Badge tone={r.session.result.pdf_status === 'ready' ? 'ink' : 'muted'}>
                          {r.session.result.pdf_status}
                        </Badge>
                        {/* 失败原因原样展示 —— 「生成失败」那种话没法照着行动 */}
                        {r.session.result.pdf_last_error && (
                          <span className="max-w-[16rem] break-words text-xs opacity-60">
                            {r.session.result.pdf_last_error}
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      {/* 查看报告要等 Stage 8 —— 现在禁用而不是隐藏,让人知道它会有 */}
                      <Button size="sm" variant="ghost" disabled title="Stage 8">
                        {tk('admin.action.report')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === r.id || r.access_revoked_at !== null}
                        onClick={() => void act('resend', r)}
                      >
                        {tk('admin.action.resend')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busyId === r.id}
                        onClick={() => void act('rotate', r)}
                      >
                        {tk('admin.action.rotate')}
                      </Button>
                      <Button
                        size="sm"
                        variant="solid"
                        disabled={busyId === r.id || r.access_revoked_at !== null}
                        onClick={() => void act('revoke', r)}
                      >
                        {tk('admin.action.revoke')}
                      </Button>
                      {/* 对任何非 ready 状态都给 —— finalize 那次触发可能丢,卡住的 pending
                          否则没有出路(见 assessment-admin 的 render_pdf) */}
                      {r.session?.result && r.session.result.pdf_status !== 'ready' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === r.id}
                          onClick={() => void renderPdf(r)}
                        >
                          {busyId === r.id ? tk('admin.pdf.rendering') : tk('admin.action.renderPdf')}
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
