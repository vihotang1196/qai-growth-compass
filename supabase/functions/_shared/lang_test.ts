import { assertEquals } from '@std/assert';
import {
  DEFAULT_LANG,
  effectiveLang,
  isLang,
  LANGS,
  parseLang,
  shouldPersistLang,
} from './lang.ts';

Deno.test('默认语言只在一处定义,而且是 zh', () => {
  // 散在各处的 'zh' 字面量迟早有一处漏改 —— 这条钉住「只有一个来源」
  assertEquals(DEFAULT_LANG, 'zh');
  assertEquals(LANGS[0], DEFAULT_LANG);
});

Deno.test('「没给」与「给了个拼错的」是两件不同的事', () => {
  /**
   * 这是这个模块存在的核心理由。合并成一个「回落到 zh」会让后者变成静默,
   * 而它的症状是「英文客户收到中文链接」—— 要等客户投诉才知道。
   * 所以判定给出三态,处置留给各个入口(它们的代价不一样)。
   */
  assertEquals(parseLang(undefined), { kind: 'absent' });
  assertEquals(parseLang(null), { kind: 'absent' });
  assertEquals(parseLang(''), { kind: 'absent' });
  assertEquals(parseLang('   '), { kind: 'absent' });
  assertEquals(parseLang('en'), { kind: 'set', lang: 'en' });
  assertEquals(parseLang('zh'), { kind: 'set', lang: 'zh' });
  assertEquals(parseLang('EN'), { kind: 'invalid', received: 'EN' });
  assertEquals(parseLang('en-US'), { kind: 'invalid', received: 'en-US' });
  assertEquals(parseLang('english'), { kind: 'invalid', received: 'english' });
  assertEquals(parseLang(2), { kind: 'invalid', received: '2' });
});

Deno.test('大小写不做兼容 —— 值域就是值域', () => {
  /**
   * 考虑过把 `EN` 归一化成 `en`。**没做**:那会让「上游配错了」这件事消失,
   * 而 config 的取值域是 `zh` / `en` 两个小写字面量,GHL 那边照着填就行。
   * 兼容一个大小写,下一次就要兼容 `en_US`、`English`、`eng` ——
   * 而每兼容一样,「配错了」这个信号就弱一分。
   */
  assertEquals(isLang('EN'), false);
  assertEquals(isLang('Zh'), false);
  assertEquals(isLang('en'), true);
});

Deno.test('effectiveLang:?lang= 合法时它赢,否则用库里的', () => {
  assertEquals(effectiveLang('en'), 'en'); // 只有库里的值
  assertEquals(effectiveLang('zh', { kind: 'set', lang: 'en' }), 'en'); // 这次带了
  assertEquals(effectiveLang('en', { kind: 'absent' }), 'en');
});

Deno.test('effectiveLang:库里是脏值 / null 时回落默认,不抛', () => {
  // 历史行、手工改过的行都可能是 null 或别的东西。语言判定不该让页面打不开
  for (const stored of [null, undefined, '', 'de', 42, {}]) {
    assertEquals(effectiveLang(stored), DEFAULT_LANG, JSON.stringify(stored));
  }
});

Deno.test('【拼错的 ?lang= 不改库、也不让页面打不开】', () => {
  /**
   * 一个拼错的语言码不该把这个人的语言改成别的东西(那会让错误**持久化**),
   * 也不该 500。所以 invalid 在渲染上按 absent 处理、在写库上一律不写。
   *
   * ⚠️ 但**调用方必须把 invalid 记出来** —— 否则它就是静默的,
   * 而这个模块管不了那件事(它没有 IO)。判据在各入口自己的用例里。
   */
  const invalid = parseLang('en-GB');
  assertEquals(effectiveLang('en', invalid), 'en'); // 库里是 en,保持 en
  assertEquals(effectiveLang(null, invalid), DEFAULT_LANG);
  assertEquals(shouldPersistLang('en', invalid), null);
  assertEquals(shouldPersistLang(null, invalid), null);
});

Deno.test('渲染器传来的 ?lang= 必须赢过库里那一列 —— 英文 PDF 嵌中文卡就是这么来的', () => {
  /**
   * PDF 渲染器打开 `/report?rt=…&lang=en`,它渲的是**那一份文件**;
   * 而 `entitlement.lang` 是**这个人偏好什么**。两者可以不同,最常见的一种是
   * 运营在 Admin 点「重新生成 en」而学员自己还是 zh。
   *
   * 报告端点上一版只读那一列,于是正文英文、而 `cardUrl` 取的是 zh 那一行的分享卡 ——
   * **英文 PDF 里嵌着一张中文卡**,而那张卡是给客户发朋友圈用的。
   *
   * 这一条钉的就是「incoming 赢」这件事:它是那个 bug 的判定,
   * 而不是一句「记得让 query 优先」。
   */
  assertEquals(effectiveLang('zh', parseLang('en')), 'en');
  assertEquals(effectiveLang('en', parseLang('zh')), 'zh');
  // 而没带 / 带了脏值时仍然用库里那一列 —— 不能反过来把人的语言弄丢
  assertEquals(effectiveLang('en', parseLang(null)), 'en');
  assertEquals(effectiveLang('en', parseLang('EN')), 'en');
});

Deno.test('shouldPersistLang:只有「合法且与库里不同」才写', () => {
  /**
   * 每次页面打开都写一次的话,`updated_at` 那个 trigger 会把
   * 「有人打开了页面」记成「这行数据变了」—— 而那一列以后可能被当成
   * 「这个人最近有动作」来读。
   */
  assertEquals(shouldPersistLang('zh', { kind: 'set', lang: 'en' }), 'en');
  assertEquals(shouldPersistLang('en', { kind: 'set', lang: 'en' }), null);
  assertEquals(shouldPersistLang('zh', { kind: 'absent' }), null);
  // 库里是脏值时,一个合法的 ?lang= 要能把它修正过来
  assertEquals(shouldPersistLang(null, { kind: 'set', lang: 'zh' }), 'zh');
  assertEquals(shouldPersistLang('de', { kind: 'set', lang: 'zh' }), 'zh');
});

Deno.test('「设置」而不是「覆盖」:同一个人两次不同的 ?lang= 会改库,不是各自渲染一次', () => {
  /**
   * 这条钉的是语义差别。「覆盖」的话语言就又跟着链接走了 ——
   * 而 PDF 是异步渲染的,渲染那一刻没有「他当时点的是哪条链接」这个信息。
   *
   * 判据:带 `?lang=en` 时 shouldPersistLang 必须给出要写的值(而不是 null),
   * 否则下一次异步渲染仍然拿不到依据。
   */
  const stored = 'zh';
  const first = parseLang('en');
  assertEquals(effectiveLang(stored, first), 'en');
  assertEquals(shouldPersistLang(stored, first), 'en'); // ← 会写库,所以异步渲染读得到

  // 写完之后再来一次同样的链接:不该再写一次
  assertEquals(shouldPersistLang('en', first), null);
});
