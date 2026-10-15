import config from '@/config/assessment-config.json';
import { Button, Card, CardBody } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { formatMalaysiaTime, waitUntil, type HistoryItem, type RetakeAction } from '@/lib/retakeView';
import ReportSection from './ReportSection';

/**
 * 报告页上重填的四块(重填第 3 步,docs/retake-design.md 第 2 节)。都是「拿到算好的结果照着画」——
 * 该不该出现、出现成哪一种,由 `lib/retakeView.ts` 判定(PDF 渲染模式、没对这个批次开放 → 那边给 hidden / null,这里什么都不渲)。
 * 抽成单独的组件是为了能被 `renderToStaticMarkup` 直接渲、断言落在最终的 HTML 上(与 ReportFileActions 同一个先例)。
 *
 * 【都不进纸】四块全带 `no-print`:打印 / 存 PDF 的是报告本身,这些是网页上的操作。
 * PDF 渲染器那条(`?rt=`)根本不渲它们(上面那一层判);`no-print` 管的是学员自己按「打印」。
 */

const TIER_BY_KEY = new Map(config.tiers.map((t) => [t.key, t]));

/**
 * 顶上那两块(没做完的重填、以前的一份)是页面上的第一块,正好在右上角那个固定的语言按钮(LanguageToggle)底下。
 * 手机上标题右边让出 40px,长标题在按钮之前折行,不被它盖住(本地 390 宽截图里看到「…10月」压在「EN」下面)。
 * md 以上内容居中、离右边够远,不用让。
 */
const TOP_TITLE = 'pr-10 font-head text-base font-bold md:pr-0';

/** 报告最下方:「重填测评」,或者不能重填的原因(写在按钮的位置),或者「继续重填」 */
export function ReportRetakeSection({
  action,
  nowMs,
  busy,
  failed,
  onStart,
  onContinue,
}: {
  action: RetakeAction;
  /** 「还要等多久」按这一刻算(页面渲染时的 Date.now();测试里固定) */
  nowMs: number;
  /** 请求在路上(开始 / 继续):按钮压下去,150ms 后转圈 */
  busy: boolean;
  /** 上一次点击没办成 */
  failed: boolean;
  onStart: () => void;
  onContinue: () => void;
}) {
  const { tk, locale } = useT();
  if (action.kind === 'hidden') return null;

  if (action.kind === 'continue') {
    return (
      <ReportSection title={tk('report.retake.title')} className="no-print">
        <p className="mb-4 font-body">{tk('report.retake.openBottom').replace('{n}', String(action.attemptNo))}</p>
        <Button variant="primary" block onClick={onContinue} busy={busy} busyLabel={tk('report.retake.opening')}>
          {tk('report.retake.continueLong')}
        </Button>
        {failed && <Failed text={tk('report.retake.actionFailed')} />}
      </ReportSection>
    );
  }

  /** 不能重填时按钮的位置写原因 —— 按钮仍在(灰的),人知道这件事存在、只是现在不行 */
  let reason: string | null = null;
  if (action.kind === 'too_soon') {
    const time = formatMalaysiaTime(action.nextAllowedAt, locale);
    const wait = waitUntil(action.nextAllowedAt, nowMs);
    const hours = String(action.minHours);
    if (wait) {
      const waitText =
        wait.hours > 0
          ? tk('report.retake.waitHm').replace('{h}', String(wait.hours)).replace('{m}', String(wait.minutes))
          : tk('report.retake.waitM').replace('{m}', String(wait.minutes));
      reason = tk('report.retake.tooSoon').replace('{hours}', hours).replace('{wait}', waitText).replace('{time}', time);
    } else {
      // 页面开着的时候时间过了(服务端那一刻说的还是「太快」):不写负数,让人刷新
      reason = tk('report.retake.tooSoonAt').replace('{hours}', hours).replace('{time}', time);
    }
  } else if (action.kind === 'limit_reached') {
    reason = tk('report.retake.limitReached').replace('{max}', String(action.max)).replace('{retakes}', String(action.max - 1));
  } else if (action.kind === 'revoked') {
    reason = tk('report.retake.revoked');
  }

  return (
    <ReportSection title={tk('report.retake.title')} className="no-print">
      {/* 「可以再做一次」只写在现在或以后能重填的时候 —— 满了 / 作废了,上面再邀请一次就和下面的原因自相矛盾 */}
      {(action.kind === 'start' || action.kind === 'too_soon') && <p className="mb-4 font-body">{tk('report.retake.body')}</p>}
      <Button
        variant="primary"
        block
        onClick={onStart}
        disabled={reason !== null}
        busy={busy}
        busyLabel={tk('report.retake.starting')}
        aria-describedby={reason ? 'retake-reason' : undefined}
      >
        {tk('report.retake.button')}
      </Button>
      {reason !== null ? (
        <p id="retake-reason" className="mt-3 border-brutal border-line bg-muted p-3 font-body text-sm">
          {reason}
        </p>
      ) : (
        action.kind === 'start' && (
          <p className="mt-2 font-body text-xs opacity-60">
            {tk('report.retake.used').replace('{used}', String(action.used)).replace('{max}', String(action.max))}
          </p>
        )
      )}
      {failed && <Failed text={tk('report.retake.failed')} />}
    </ReportSection>
  );
}

/** 报告顶部:有一份重填没做完 —— 继续 / 放弃 */
export function ReportRetakeBanner({
  banner,
  busy,
  failed,
  onContinue,
  onAbandon,
}: {
  banner: { attemptNo: number } | null;
  /** 哪一个按钮的请求在路上;另一个这时不可点 */
  busy: 'continue' | 'abandon' | null;
  failed: boolean;
  onContinue: () => void;
  onAbandon: () => void;
}) {
  const { tk } = useT();
  if (!banner) return null;
  return (
    <section className="no-print" aria-live="polite">
      <Card tone="accent" shadow="base" padding="md">
        <CardBody className="space-y-3">
          <p className={TOP_TITLE}>{tk('report.retake.openTitle').replace('{n}', String(banner.attemptNo))}</p>
          <p>{tk('report.retake.openBody')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="solid"
              className="w-full sm:w-auto"
              onClick={onContinue}
              busy={busy === 'continue'}
              busyLabel={tk('report.retake.opening')}
              disabled={busy === 'abandon'}
            >
              {tk('report.retake.continue')}
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={onAbandon}
              busy={busy === 'abandon'}
              busyLabel={tk('report.retake.abandoning')}
              disabled={busy === 'continue'}
            >
              {tk('report.retake.abandon')}
            </Button>
          </div>
          {failed && <p className="font-body text-sm font-bold">{tk('report.retake.actionFailed')}</p>}
        </CardBody>
      </Card>
    </section>
  );
}

/** 历次结果(两份以上才有):第 n 次 · 完成时间(马来西亚时间)· 总分 · 档位;点一份看那一份的报告 */
export function ReportHistory({ items, onOpen }: { items: HistoryItem[] | null; onOpen: (no: number) => void }) {
  const { tk, locale } = useT();
  if (!items) return null;
  return (
    <ReportSection title={tk('report.history.title')} className="no-print">
      <p className="mb-3 font-body text-sm opacity-70">{tk('report.history.hint')}</p>
      <ol className="space-y-2">
        {items.map((a) => {
          const tier = TIER_BY_KEY.get(a.tier);
          const body = (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-head font-bold">{tk('report.history.attempt').replace('{n}', String(a.no))}</span>
                {a.latest && <Tag tone="ink">{tk('report.history.latest')}</Tag>}
                {a.viewing && <Tag tone="accent">{tk('report.history.viewing')}</Tag>}
              </span>
              <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-body text-sm">
                <span className="opacity-70">{formatMalaysiaTime(a.completedAt, locale)}</span>
                <span className="font-head font-bold">{a.total.toFixed(1)}</span>
                <span>{tier ? (locale === 'en' ? tier.en : tier.zh) : a.tier}</span>
              </span>
            </>
          );
          return (
            <li key={a.no}>
              {a.viewing ? (
                // 正在看的这一份:标出来,不是链接
                <div aria-current="page" className="block w-full border-brutal border-line bg-muted p-3">
                  {body}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(a.no)}
                  className="qai-lift block w-full border-brutal border-line bg-paper p-3 text-left"
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </ReportSection>
  );
}

/** 看的是以前的一份:顶上说清是哪一次、什么时候,以及「与全体平均比」按今天的数算;回到最新的一份 */
export function ReportHistoryNote({ note, onBack }: { note: { no: number; completedAt: string | null } | null; onBack: () => void }) {
  const { tk, locale } = useT();
  if (!note) return null;
  return (
    <section className="no-print">
      <Card tone="paper" shadow="base" padding="md">
        <CardBody className="space-y-3">
          <p className={TOP_TITLE}>
            {tk('report.history.viewingOld').replace('{n}', String(note.no)).replace('{time}', formatMalaysiaTime(note.completedAt, locale))}
          </p>
          <p className="opacity-70">{tk('report.history.baselineNote')}</p>
          <Button variant="outline" className="w-full sm:w-auto" onClick={onBack}>
            {tk('report.history.backToLatest')}
          </Button>
        </CardBody>
      </Card>
    </section>
  );
}

function Tag({ tone, children }: { tone: 'ink' | 'accent'; children: React.ReactNode }) {
  const cls = tone === 'ink' ? 'bg-ink text-paper' : 'bg-accent text-accent-fg';
  return <span className={`border-brutal border-line px-1.5 py-0.5 font-head text-xs font-bold ${cls}`}>{children}</span>;
}

function Failed({ text }: { text: string }) {
  return <p className="mt-3 border-brutal border-line bg-accent p-3 font-body text-sm">{text}</p>;
}
