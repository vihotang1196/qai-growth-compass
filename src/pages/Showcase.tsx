import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
  Progress,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SubmoduleMark,
  SubmoduleMarkLegend,
  markStateFromScore,
  Table,
  TableWrap,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@/components/brutalist';
import { useT } from '@/lib/i18n';

/**
 * Stage 1 交付物:组件层自检页。
 * 所有文案走 tk(),页面里不出现任何硬编码中文 —— 这条由 `npm run lint:cjk` 强制。
 */
export default function Showcase() {
  const { tk, locale, setLocale } = useT();
  const [answer, setAnswer] = useState<string>();
  const [progress, setProgress] = useState(37);

  return (
    <div className="min-h-screen bg-muted p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-head text-3xl font-bold uppercase tracking-tight md:text-5xl">
              {tk('showcase.title')}
            </h1>
            <p className="mt-2 max-w-xl font-body text-sm opacity-70">{tk('showcase.subtitle')}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          >
            {tk('common.lang')}
          </Button>
        </header>

        {/* 字体自检 —— Stage 1 硬验收项,见 PROGRESS.md 0.14 坑 1 */}
        <Card tone="accent" shadow="lg">
          <CardHeader>
            <CardTitle>{tk('showcase.fontCheck')}</CardTitle>
            <Badge tone="ink">FONT</Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="font-head text-2xl font-bold">{tk('showcase.fontCommon')}</p>
            <p className="font-body text-2xl">{tk('showcase.fontRare')}</p>
            <p className="text-xs opacity-70">{tk('showcase.fontNote')}</p>
          </CardBody>
        </Card>

        {/* Button */}
        <Card>
          <CardHeader>
            <CardTitle>Button</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-wrap items-center gap-3">
            <Button variant="primary">{tk('common.submit')}</Button>
            <Button variant="solid">{tk('common.confirm')}</Button>
            <Button variant="outline">{tk('common.cancel')}</Button>
            <Button variant="ghost">{tk('common.retry')}</Button>
            <Button size="sm">SM</Button>
            <Button size="lg">LG</Button>
            <Button disabled>{tk('common.loading')}</Button>
          </CardBody>
        </Card>

        {/* Input + Select */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Input</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <Input label="PHONE / EMAIL" placeholder={tk('login.placeholder')} />
              <Input label="WITH ERROR" defaultValue="12345" error={tk('login.expired')} />
              <Input label="DISABLED" placeholder="—" disabled />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Select</CardTitle>
            </CardHeader>
            <CardBody>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="COHORT" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a">2026-08 KL</SelectItem>
                  <SelectItem value="b">2026-09 JB</SelectItem>
                  <SelectItem value="c">2026-10 SG</SelectItem>
                </SelectContent>
              </Select>
            </CardBody>
          </Card>
        </div>

        {/* Radio —— 答题页的核心交互 */}
        <Card>
          <CardHeader>
            <CardTitle>Radio</CardTitle>
            <Badge>QUIZ</Badge>
          </CardHeader>
          <CardBody>
            <RadioGroup value={answer} onValueChange={setAnswer}>
              {['A', 'B', 'C', 'D'].map((k, i) => (
                <RadioCard key={k} value={k} index={k} label={`Option ${k} — score ${i}`} />
              ))}
            </RadioGroup>
          </CardBody>
        </Card>

        {/* Progress */}
        <Card>
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Progress value={progress} caption="Q 9 / 24" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
                −10
              </Button>
              <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
                +10
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Tabs + Dialog */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tabs</CardTitle>
            </CardHeader>
            <CardBody>
              <Tabs defaultValue="roster">
                <TabsList>
                  <TabsTrigger value="roster">ROSTER</TabsTrigger>
                  <TabsTrigger value="funnel">FUNNEL</TabsTrigger>
                  <TabsTrigger value="sync">SYNC</TabsTrigger>
                </TabsList>
                <TabsContent value="roster">roster panel</TabsContent>
                <TabsContent value="funnel">funnel panel</TabsContent>
                <TabsContent value="sync">sync panel</TabsContent>
              </Tabs>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dialog</CardTitle>
            </CardHeader>
            <CardBody>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="solid">OPEN</Button>
                </DialogTrigger>
                <DialogContent closeLabel={tk('common.close')}>
                  <DialogTitle>{tk('showcase.fontCheck')}</DialogTitle>
                  <DialogDescription>{tk('showcase.fontNote')}</DialogDescription>
                </DialogContent>
              </Dialog>
            </CardBody>
          </Card>
        </div>

        {/* 子模块标记 + 六维分类色 */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{tk('showcase.marks')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <SubmoduleMarkLegend
                labels={{
                  full: tk('showcase.markFull'),
                  half: tk('showcase.markHalf'),
                  empty: tk('showcase.markEmpty'),
                }}
              />
              <div className="flex items-center gap-2">
                {[3, 2, 1, 0, 3, 2].map((s, i) => (
                  <SubmoduleMark
                    key={i}
                    state={markStateFromScore(s)}
                    label={String(s)}
                  />
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tk('showcase.dimColors')}</CardTitle>
            </CardHeader>
            {/* 标签在色块【外部】,白底墨字 —— 色块内不放任何正文。
                见 brutalist.css 里 --dim-* 的规则 2 */}
            <CardBody className="flex flex-wrap gap-4">
              {(
                [
                  ['goal', 'bg-dim-goal'],
                  ['traffic', 'bg-dim-traffic'],
                  ['capture', 'bg-dim-capture'],
                  ['convert', 'bg-dim-convert'],
                  ['value', 'bg-dim-value'],
                  ['measure', 'bg-dim-measure'],
                ] as const
              ).map(([key, bg]) => (
                <span key={key} className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`inline-block h-6 w-6 border-brutal border-line ${bg}`}
                  />
                  <span className="font-head text-xs font-bold uppercase">{key}</span>
                </span>
              ))}
            </CardBody>
          </Card>
        </div>

        {/* Table + Badge */}
        <Card padding="none" shadow="base">
          <TableWrap className="border-0">
            <Table>
              <Thead>
                <Tr>
                  <Th>NAME</Th>
                  <Th>PHONE</Th>
                  <Th>STATUS</Th>
                  <Th>SCORE</Th>
                  <Th>TIER</Th>
                </Tr>
              </Thead>
              <Tbody>
                <Tr>
                  <Td>Tan Wei Ming</Td>
                  <Td>+60124361382</Td>
                  <Td>
                    <Badge tone="ink">COMPLETED</Badge>
                  </Td>
                  <Td>72</Td>
                  <Td>
                    <Badge tone="accent">TIER B</Badge>
                  </Td>
                </Tr>
                <Tr>
                  <Td>Siti Nurhaliza</Td>
                  <Td>+60193334444</Td>
                  <Td>
                    <Badge tone="muted">STARTED</Badge>
                  </Td>
                  <Td>—</Td>
                  <Td>—</Td>
                </Tr>
                {/* 号码格式异常的行:标红 */}
                <Tr flagged>
                  <Td>Lim Ah Kow</Td>
                  <Td>0l2-436 l382</Td>
                  <Td>
                    <Badge tone="ink">PENDING</Badge>
                  </Td>
                  <Td>—</Td>
                  <Td>—</Td>
                </Tr>
              </Tbody>
            </Table>
          </TableWrap>
        </Card>
      </div>
    </div>
  );
}
