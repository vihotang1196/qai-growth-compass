import { useState } from 'react';
import config from '@/config/assessment-config.json';
import { Button } from '@/components/brutalist';
import { useT } from '@/lib/i18n';

const Q_BY_ID = new Map(config.questions.map((q) => [q.id, q]));

/**
 * 默认展开几题。
 *
 * 【为什么是折叠而不是全展开】这块的用途是**扫**,不是精读:课前想快速找出
 * 「哪几题最一边倒」。而题目已经按集中度降序排过,所以最有用的本来就在最前面 ——
 * 一屏能看到前几题,比 15 题都在但要滚很久有用。
 */
const TOP_N = 5;

export interface QuestionDistribution {
  id: string;
  counts: number[];
  answered: number;
  topShare: number | null;
  topIndex: number;
}

/**
 * 每题选项分布。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【三处布局都是为「一眼看出全场卡在哪一档」服务的,不是审美】
 *
 * ① **选项文本完整显示,放在条形上方而不是左侧。**
 *    上一版用 `w-40 truncate`,于是「有内容在成交前就讲清…」这种标签被截断 ——
 *    而**截掉的恰恰是区分相邻两档的那部分**(C2 的第 3、4 档差别全在后半句)。
 *    看不清选项文本,这块就完全失去用途。选项是整句话,不是短标签,所以放上方整行铺开。
 *
 * ② **人数用定宽的右列 + `whitespace-nowrap`。**
 *    上一版「6 人」被拆成两行(「6」一行「人」一行)—— 数字与单位分开就不是一个数了。
 *
 * ③ **默认只展开前 5 题。** 见 TOP_N。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function QuestionSpread({
  questions,
  defaultExpanded = false,
}: {
  questions: QuestionDistribution[];
  /** 测试与「展开全部」共用这个入口 —— 两个状态都要可渲染 */
  defaultExpanded?: boolean;
}) {
  const { tk, locale } = useT();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const L = <T,>(zh: T, en: T): T => (locale === 'en' ? en : zh);

  const shown = expanded ? questions : questions.slice(0, TOP_N);
  const hidden = questions.length - shown.length;

  return (
    <div className="space-y-3">
      <p className="font-body text-xs opacity-60">{tk('dash.questionsHint')}</p>

      {shown.map((q) => {
        const spec = Q_BY_ID.get(q.id);
        const options = spec ? L(spec.zh.options, spec.en.options) : [];
        const max = Math.max(0, ...q.counts);
        return (
          <div key={q.id} className="border-brutal border-line px-3 py-2">
            <div className="mb-1 font-head text-xs font-bold">
              {q.id} · {spec ? L(spec.zh.q, spec.en.q) : q.id}
            </div>
            <div className="space-y-1.5">
              {q.counts.map((count, i) => (
                <div key={i}>
                  {/*
                    选项文本整行铺开、可换行 —— 【绝不截断】。
                    `break-words` 配 `whitespace-normal`:Td 那次的教训是
                    继承来的 nowrap 会让 break-words 无从换行,这里没有那个继承源,
                    但显式写出来免得以后被外层的 nowrap 静默架空。
                  */}
                  <div className="whitespace-normal break-words font-body text-xs leading-snug">
                    {options[i] ?? `#${i}`}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 bg-accent"
                      style={{
                        width: `${max === 0 ? 0 : (count / max) * 100}%`,
                        // 0 人时不留 1px 的假条形 —— 那会让空档看起来像「有一点」
                        minWidth: count ? 3 : 0,
                      }}
                    />
                    {/* 定宽 + nowrap:数字与单位不许分行 */}
                    <span className="w-14 shrink-0 whitespace-nowrap text-right font-head text-xs font-bold">
                      {tk('dash.people').replace('{n}', String(count))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {hidden > 0 && (
        <Button size="sm" variant="outline" onClick={() => setExpanded(true)}>
          {tk('dash.showAllQuestions').replace('{n}', String(hidden))}
        </Button>
      )}
      {expanded && questions.length > TOP_N && (
        <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
          {tk('dash.collapseQuestions')}
        </Button>
      )}
    </div>
  );
}
