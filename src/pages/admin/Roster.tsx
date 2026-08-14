import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  Input,
  Table,
  TableWrap,
  Tbody,
  Th,
  Thead,
  Tr,
} from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { adminPost } from '@/lib/adminApi';
import RosterRowView, { ROSTER_COLUMNS, type RosterRowData as RosterRow } from './RosterRow';
import { parseWarnings } from '../../../api/_lib/entitlementWarnings';

interface RosterResponse {
  rows: RosterRow[];
  /** 服务端数出来的测试行条数 —— 前端隐藏它们时要能说出「藏了几条」 */
  testRows?: number;
  stats: { total: number; unparseablePhones: number; unparseableRatio: number; thresholdExceeded: boolean };
}

/**
 * 名单管理页。
 *
 * 【筛选在前端做】后端一次返回全量。当前批次规模是几十到一两百人,够用,而且省一张
 * SQL 视图(视图要走 migration)。**批次上到几千人时要把筛选推回 SQL** ——
 * 这条限制写在 assessment-admin 的 roster() 注释里,不是随口一提。
 */
export default function Roster({ onAuthLost }: { onAuthLost: (forbidden: boolean) => void }) {
  const { tk } = useT();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * 展开着错误详情的那一行。**一次只开一条** —— 同时铺开好几段千字错误
   * 会把名单本身挤没了,而排查是一条一条看的。
   */
  const [openError, setOpenError] = useState<string | null>(null);

  const [cohort, setCohort] = useState('');
  const [status, setStatus] = useState('');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [badPhoneOnly, setBadPhoneOnly] = useState(false);
  const [warnOnly, setWarnOnly] = useState(false);
  /**
   * 【默认隐藏测试数据】运营看名单时要的是真实学员。
   * 但要有开关 —— 造完数据得能看见它们,否则只能去数据库里确认,那不算能用。
   * 注意这只是**显示偏好**:CSV 导出在服务端无条件剔除测试行,不看这个开关
   * (让一个开关决定要不要给假联系人发消息,那种耦合太危险)。
   */
  const [showTest, setShowTest] = useState(false);

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
      if (!showTest && r.cohort?.is_test) return false;
      if (cohort && r.cohort?.id !== cohort) return false;
      if (status && r.status !== status) return false;
      if (badPhoneOnly && r.phone_e164 !== null) return false;
      // 「只看有告警的」—— 与「只看号码解析失败的」同一个位置、同一种语义
      if (warnOnly && parseWarnings(r.warnings).length === 0) return false;
      const total = r.session?.result?.total ?? null;
      // 设了分数区间就意味着「只看已完成的」—— 没分数的人无法参与比较
      if (min !== null && (total === null || total < min)) return false;
      if (max !== null && (total === null || total > max)) return false;
      return true;
    });
  }, [data, cohort, status, minScore, maxScore, badPhoneOnly, warnOnly, showTest]);

  /**
   * 重新生成 PDF —— 不加确认框(重置只是重渲一次,误点成本很低;确认框会让人形成
   * 「点确认」的肌肉记忆,而那个习惯会在真正危险的操作上害人)。
   * Admin 这边【等】结果,与 finalize 那边异步不同:那边客户在等分数不该被拖住,
   * 这边是人主动点的,要的就是结果。
   */
  /**
   * 重新生成某一种语言的报告文件。
   *
   * 【`lang` 是必填参数,前端也不给默认值】后端那个 action 缺 lang 会 400 ——
   * 而那是刻意的:一个 session 有两份文件,「重渲哪一份」只有点按钮的人知道。
   * 名单页那一格显示的是 `zh ✓ / en —`,所以界面上本来就是分开的,参数也该分开。
   */
  async function renderPdf(row: RosterRow, lang: 'zh' | 'en') {
    const sessionId = row.session?.id;
    if (!sessionId || busyId === row.id) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      const res = await adminPost<{ ok: boolean; detail?: string }>('render_pdf', {
        session_id: sessionId,
        lang,
      });
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

  /**
   * 打开学员报告 —— 服务端签一条 180 秒的渲染令牌并记日志,前端只负责开新标签。
   * **每次点击都现签**,不缓存 URL:那条链接三分钟就死,存下来用只会拿到失效页
   * (与报告页下载 PDF 那处同一个取向:把「会过期」变成不存在的问题)。
   */
  async function openReport(row: RosterRow) {
    const sessionId = row.session?.id;
    if (!sessionId || busyId === row.id) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      const res = await adminPost<{ url: string }>('report_link', { session_id: sessionId });
      window.open(res.url, '_blank', 'noopener');
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
      /**
       * 【不再传 `lang`】上一版传的是 `locale`,也就是**操作者界面的语言** ——
       * 而后端早就改成从 `entitlement.lang` 读收件人的语言了(那次的 bug 是
       * 「谁在后台点,决定客户收到什么语言的消息」)。留着这个参数会让下一个人
       * 以为它还有用,而它已经被忽略 —— 一个没人读的参数与一个没人读的列是同一类东西。
       */
      const res = await adminPost<{ ok: boolean; queued: boolean }>(action, {
        entitlement_id: row.id,
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

      {/*
        藏了几条必须说出来 —— 否则「这批一条都没有」和「都被开关藏起来了」
        在页面上长得一模一样,而那正是我造完数据后第一个会误判的地方。
      */}
      {!showTest && (data?.testRows ?? 0) > 0 && (
        <Card padding="sm">
          <CardBody className="font-body text-sm opacity-70">
            {tk('admin.testHidden').replace('{n}', String(data?.testRows ?? 0))}
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
          {/*
            只看有告警的 —— 与号码那个开关并列。
            【为什么放在这里而不是单独一块】告警和「号码解析失败」是同一类东西:
            都是「这一行需要人看一眼」,而运营的动作是同一个(筛出来、逐行处理)。
          */}
          <label className="flex items-center gap-2 font-body text-sm">
            <input
              type="checkbox"
              checked={warnOnly}
              onChange={(e) => setWarnOnly(e.target.checked)}
              className="h-5 w-5 border-brutal border-line"
            />
            {tk('admin.filter.warnOnly')}
          </label>
          {/*
            测试数据开关 —— 只影响这张表的显示。
            **CSV 导出不看它**(服务端无条件剔除):让一个前端开关决定要不要
            给假联系人发消息,那种耦合出错时没有任何迹象。
          */}
          <label className="flex items-center gap-2 font-body text-sm">
            <input
              type="checkbox"
              checked={showTest}
              onChange={(e) => setShowTest(e.target.checked)}
              className="h-5 w-5 border-brutal border-line"
            />
            {tk('admin.showTest')}
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
                {ROSTER_COLUMNS.map((k) => (
                  <Th key={k}>{tk(k)}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <RosterRowView
                  key={r.id}
                  row={r}
                  busy={busyId === r.id}
                  errorOpen={openError === r.id}
                  onToggleError={() => setOpenError((cur) => (cur === r.id ? null : r.id))}
                  onResend={() => void act('resend', r)}
                  onRotate={() => void act('rotate', r)}
                  onRevoke={() => void act('revoke', r)}
                  onRenderPdf={(lang) => void renderPdf(r, lang)}
                  onOpenReport={() => void openReport(r)}
                />
              ))}
            </Tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
