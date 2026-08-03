import { Card, CardBody, CardHeader, CardTitle } from '@/components/brutalist';
import { useT } from '@/lib/i18n';

/**
 * 链接失效落地页。
 *
 * 三种情况都落这里,而且**文案完全一样**:token 不存在、token 已被 Admin 作废、
 * 直接访问 `/` 没带 token。区分它们对客户没有意义,对试探的人反而有用 ——
 * 「这个 token 存在但被作废了」是一条不该泄露的信息。
 */
export default function Expired() {
  const { tk } = useT();
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      <Card shadow="lg" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{tk('expired.title')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p>{tk('login.expired')}</p>
          <p className="opacity-70">{tk('expired.hint')}</p>
        </CardBody>
      </Card>
    </main>
  );
}
