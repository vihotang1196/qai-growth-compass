import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/brutalist';
import { useT } from '@/lib/i18n';

/**
 * 尚未实现的阶段占位页。
 *
 * 存在的唯一理由:Stage 4 的跳转要能被验证。后端把 target 推导成 /quiz、/survey
 * 或 /report,如果这三个路由不存在,登录成功之后人会落在一个空白页上 ——
 * 那就分不清「跳转错了」和「页面还没做」。
 *
 * 页面上明写是哪个 Stage 会替换它,不假装功能存在。
 * Stage 6 换掉 /quiz,Stage 7 换掉 /survey,Stage 8 换掉 /report。
 */
export default function StagePlaceholder({ route, stage }: { route: string; stage: string }) {
  const { tk } = useT();
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      <Card shadow="lg" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{route}</CardTitle>
          <Badge tone="ink">{stage}</Badge>
        </CardHeader>
        <CardBody>{tk('placeholder.notImplemented')}</CardBody>
      </Card>
    </main>
  );
}
