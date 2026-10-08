import { Button } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import ReportFileActions from './ReportFileActions';
import ReportSection from './ReportSection';

type ActionsProps = React.ComponentProps<typeof ReportFileActions>;

/**
 * 报告页「带走这份报告」—— 每种语言的下载 / 生成,外加打印按钮。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【PDF 渲染与打印时整节不出现】(Viho 2026-10-08 定)
 * 2026-10-08 在 X 的中文 PDF 里看到这一节截下来的是:「正在生成中文版…」(PDF 截到了自己生成中的那一刻)、
 * 一个转到一半的转圈方块(菱形)、一个「生成英文版」按钮。全是网页上的交互或这份 PDF 自己的状态,
 * 放进 PDF 没有意义。这一节**没有静态内容**,所以整节去掉,而不是只藏按钮留一个空标题:
 *   - 渲染模式(PDF 渲染器带 `?rt=` 打开)→ 不渲染
 *   - 学员自己打印 → 外层带 `no-print`,index.css 的打印规则整节隐藏
 * 【不能有带 token 的链接】PDF 会被转发;链接里带 token 的话,拿到 PDF 的人就能打开他的报告。
 * 这一节的按钮都是点击事件、没有链接;整节去掉之后,这条路也不存在了。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ReportTakeaway({
  renderMode,
  onPrint,
  ...actions
}: ActionsProps & {
  /** PDF 渲染器打开的报告页(`?rt=`) */
  renderMode: boolean;
  onPrint: () => void;
}) {
  const { tk } = useT();
  if (renderMode) return null;
  return (
    <ReportSection title={tk('report.section.share')} className="no-print">
      <ReportFileActions {...actions} />
      {/* 打印保底(print.css)—— 自动 PDF 失败时这条路仍然可用,所以永远保留(屏幕上) */}
      <div className="mt-3">
        <Button variant="outline" onClick={onPrint}>
          {tk('report.pdf.print')}
        </Button>
      </div>
    </ReportSection>
  );
}
