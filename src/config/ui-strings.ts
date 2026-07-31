/**
 * 壳文案字典 —— 题库/档位/报告正文之外的所有界面文字。
 *
 * 这是除 assessment-config.json 之外【唯一】允许出现中文字符的地方。
 * 其他 .ts / .tsx 文件里出现中日韩字符会被 `npm run lint:cjk` 拦下,构建失败。
 * 见 PROGRESS.md D5。
 *
 * Stage 1–11 只填 zh;en 留空即可(缺失时自动回落 zh 并在 dev 控制台告警)。
 * Stage 12 一次性补齐 en。
 */

export interface UiString {
  zh: string;
  en?: string;
}

export const UI_STRINGS = {
  // ── 通用 ────────────────────────────────────────────────
  'common.next': { zh: '下一题', en: 'Next' },
  'common.prev': { zh: '上一题', en: 'Back' },
  'common.submit': { zh: '提交', en: 'Submit' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.confirm': { zh: '确认', en: 'Confirm' },
  'common.loading': { zh: '加载中', en: 'Loading' },
  'common.retry': { zh: '重试', en: 'Retry' },
  'common.close': { zh: '关闭', en: 'Close' },
  'common.download': { zh: '下载', en: 'Download' },
  'common.search': { zh: '搜索', en: 'Search' },
  'common.export': { zh: '导出 CSV', en: 'Export CSV' },
  'common.lang': { zh: 'EN', en: '中文' },

  // ── 进度 ────────────────────────────────────────────────
  'progress.of': { zh: '第 {current} / {total} 题', en: 'Question {current} of {total}' },

  // ── 登录 / 重发链接 ────────────────────────────────────
  'login.title': { zh: '找回你的诊断链接', en: 'Resend your assessment link' },
  'login.placeholder': { zh: '手机号或邮箱', en: 'Phone number or email' },
  'login.action': { zh: '发送链接', en: 'Send link' },
  // 匹配成功与失败必须返回完全相同的文案,不能泄露名单信息
  'login.sent': {
    zh: '如果这个号码或邮箱在我们的名单里,链接已经发出,请查收 WhatsApp 与邮箱。',
    en: 'If this number or email is on our list, the link has been sent. Please check WhatsApp and your inbox.',
  },
  'login.throttled': {
    zh: '刚刚已经发送过一次,请稍等一分钟再试。',
    en: 'A link was just sent. Please wait a minute before trying again.',
  },
  'login.locked': {
    zh: '尝试次数过多,请一小时后再试。',
    en: 'Too many attempts. Please try again in an hour.',
  },
  'login.expired': {
    zh: '这个链接已失效,请重新获取。',
    en: 'This link is no longer valid. Please request a new one.',
  },

  // ── PDF ─────────────────────────────────────────────────
  'pdf.generating': { zh: 'PDF 生成中', en: 'Generating PDF' },
  'pdf.ready': { zh: '下载 PDF 报告', en: 'Download PDF report' },
  'pdf.failed': { zh: '自动生成失败,可用浏览器打印保存', en: 'Auto-generation failed — use browser print instead' },
  'pdf.print': { zh: '用浏览器打印', en: 'Print with browser' },

  // ── 组件展示页(Stage 1 用,后续可删)──────────────────
  'showcase.title': { zh: 'Brutalist 组件层', en: 'Brutalist components' },
  'showcase.subtitle': {
    zh: 'Stage 1 地基。后面所有页面只用这里的组件,不再逐页新增。',
    en: 'Stage 1 foundation. All later pages compose from these — no per-page additions.',
  },
  'showcase.fontCheck': { zh: '字体渲染自检', en: 'Font rendering check' },
  'showcase.fontCommon': { zh: '常用字:盈利增长罗盘诊断报告', en: 'Common glyphs' },
  'showcase.fontRare': { zh: '生僻字:䶮 龘 靐 齉 麤', en: 'Rare glyphs' },
  'showcase.fontNote': {
    zh: '生僻字若显示为方块,说明兜底字体未生效。PDF 渲染会出同样的问题。',
    en: 'Tofu boxes here mean the fallback font is not active. PDF rendering will fail the same way.',
  },
} as const satisfies Record<string, UiString>;

export type UiKey = keyof typeof UI_STRINGS;
