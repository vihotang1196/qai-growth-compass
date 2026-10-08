import { Card, CardBody, CardHeader, CardTitle } from '@/components/brutalist';
import { cn } from '@/lib/cn';

/**
 * 报告页的一个板块(标题 + 卡片)。从 Report.tsx 抽出来,是为了让「带走这份报告」那一节
 * (ReportTakeaway.tsx)能单独渲染、单独测,而不复制一份同样的外框。
 */
export default function ReportSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('report-section', className)}>
      <Card shadow="base" padding="md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardBody>{children}</CardBody>
      </Card>
    </section>
  );
}
