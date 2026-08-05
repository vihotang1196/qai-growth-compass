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
  'common.langSwitch': { zh: '切换语言', en: 'Switch language' },

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

  // ── 魔法链接入口 / 失效页 ──────────────────────────────
  'landing.verifying': { zh: '正在验证链接…', en: 'Verifying your link…' },
  'expired.title': { zh: '链接已失效', en: 'Link no longer valid' },
  'expired.hint': {
    zh: '如果你还留着我们发的那条消息,请直接点里面的链接。找不到的话联系我们重发。',
    en: 'If you still have the message we sent, open the link inside it. Otherwise contact us for a new one.',
  },
  'placeholder.notImplemented': {
    zh: '这个页面还没做,会在标注的阶段实现。',
    en: 'This page is not built yet — it lands in the stage shown above.',
  },

  // ── Quiz ────────────────────────────────────────────────
  'quiz.profileSection': { zh: '先了解一下你的情况', en: 'A bit about you' },
  'quiz.questionSection': { zh: '增长罗盘测评', en: 'Growth Compass' },
  'quiz.saving': { zh: '正在保存…', en: 'Saving…' },
  'quiz.saveFailed': {
    zh: '这一题没保存成功,所以停在这里 —— 点重试,别往下走,否则这一题会缺。',
    en: "This answer didn't save, so we stopped here. Retry — skipping would leave a gap.",
  },
  'quiz.loadFailed': { zh: '载入答题进度失败。', en: 'Could not load your progress.' },
  'quiz.intro': { zh: '花大约 3 分钟,凭直觉选最接近的一项。答完立刻出你的增长罗盘分数。', en: 'About 3 minutes. Pick what fits best — your Compass score comes right after.' },
  'quiz.profileSectionTitle': { zh: '先了解一下你的生意', en: 'First, about your business' },
  'quiz.saved': { zh: '已保存', en: 'Saved' },
  'quiz.savingOne': { zh: '保存中', en: 'Saving' },
  'quiz.saveOneFailed': { zh: '这一题没存上,点一下重选即可重试', en: "This one didn't save — pick again to retry" },
  'quiz.submit': { zh: '提交,查看我的分数', en: 'Submit and see my score' },
  'quiz.unanswered': {
    zh: '还有 {n} 题没答,已帮你定位到第一题。',
    en: '{n} question(s) left — jumped you to the first.',
  },
  'quiz.stillSaving': {
    zh: '还有答案在保存,稍等一两秒再提交。',
    en: 'Some answers are still saving — try again in a second.',
  },
  'quiz.someFailed': {
    zh: '有 {n} 题没保存成功,已定位到第一题,重选一下就会重试。',
    en: '{n} answer(s) failed to save — jumped you to the first; re-pick to retry.',
  },
  'quiz.autosaveNote': {
    zh: '每答一题即自动保存。中途关掉,下次点链接回来会从这一题继续。',
    en: 'Saved after every answer. Close it and your link brings you back to this question.',
  },

  // ── Survey ──────────────────────────────────────────────
  'survey.title': { zh: '最后 7 个问题', en: 'Last 7 questions' },
  'survey.hint': {
    zh: '这几题不计分,但决定了报告里给你的建议有多贴合你的实际情况。',
    en: 'These are not scored, but they decide how well the report fits your actual situation.',
  },
  'survey.progress': { zh: '第 {current} / {total} 题', en: 'Question {current} of {total}' },
  'survey.optional': { zh: '选填', en: 'Optional' },
  'survey.multiHint': { zh: '可多选', en: 'Select all that apply' },
  'survey.submit': { zh: '提交并查看报告', en: 'Submit and see my report' },
  'survey.submitting': { zh: '正在生成你的报告…', en: 'Building your report…' },
  'survey.required': { zh: '这一题需要填写。', en: 'This one is required.' },
  'survey.tooLong': { zh: '最多 {max} 字。', en: 'Max {max} characters.' },
  'survey.saveFailed': {
    zh: '提交没成功,所以停在这里 —— 点重试,你填的内容还在。',
    en: "Submission didn't go through, so we stopped here. Retry — your answers are still here.",
  },
  'survey.incomplete': {
    zh: '测评题还没答完,先回去补齐才能出报告。',
    en: 'Some assessment questions are still unanswered — finish those first.',
  },
  'survey.charCount': { zh: '{n} / {max}', en: '{n} / {max}' },

  // ── Admin ───────────────────────────────────────────────
  'admin.title': { zh: '学员名单', en: 'Roster' },
  'admin.login.title': { zh: '后台登录', en: 'Admin sign-in' },
  'admin.login.hint': {
    zh: '输入你的邮箱,我们会发一条登录链接。只有在允许名单里的邮箱能进后台。',
    en: 'Enter your email and we will send a sign-in link. Only allow-listed emails can enter.',
  },
  'admin.login.sent': { zh: '登录链接已发出,请查收邮箱。', en: 'Sign-in link sent — check your inbox.' },
  'admin.login.action': { zh: '发送登录链接', en: 'Send sign-in link' },
  'admin.forbidden': {
    zh: '这个账号不在后台允许名单里。换个账号,或者联系管理员把你加进名单。',
    en: 'This account is not on the admin allowlist. Use another account or ask to be added.',
  },
  'admin.signOut': { zh: '退出', en: 'Sign out' },
  'admin.refresh': { zh: '刷新', en: 'Refresh' },
  'admin.empty': { zh: '还没有任何准入记录。', en: 'No entitlements yet.' },
  'admin.phoneBad': { zh: '号码格式异常', en: 'Unparseable phone' },
  'admin.phoneRatio': {
    zh: '号码解析失败:{bad} / {total}({pct})',
    en: 'Unparseable phones: {bad} / {total} ({pct})',
  },
  'admin.phoneRatioOver': {
    zh: '超过 2% 阈值 —— GHL 里的号码质量比预期差,该回头看要不要加预处理了。',
    en: 'Above the 2% threshold — phone quality in GHL is worse than expected.',
  },
  'admin.filter.cohort': { zh: '全部批次', en: 'All cohorts' },
  'admin.filter.status': { zh: '全部状态', en: 'All statuses' },
  'admin.filter.minScore': { zh: '最低分', en: 'Min score' },
  'admin.filter.maxScore': { zh: '最高分', en: 'Max score' },
  'admin.filter.badPhoneOnly': { zh: '只看号码异常', en: 'Unparseable phones only' },
  'admin.col.name': { zh: '姓名', en: 'Name' },
  'admin.col.phone': { zh: '手机', en: 'Phone' },
  'admin.col.email': { zh: '邮箱', en: 'Email' },
  'admin.col.cohort': { zh: '批次', en: 'Cohort' },
  'admin.col.status': { zh: '状态', en: 'Status' },
  'admin.col.firstLogin': { zh: '登录时间', en: 'First login' },
  'admin.col.completed': { zh: '完成时间', en: 'Completed' },
  'admin.col.total': { zh: '总分', en: 'Score' },
  'admin.col.tier': { zh: '档位', en: 'Tier' },
  'admin.col.weakest': { zh: '最弱维度', en: 'Weakest' },
  'admin.col.actions': { zh: '操作', en: 'Actions' },
  'admin.action.resend': { zh: '重发链接', en: 'Resend link' },
  'admin.action.rotate': { zh: '换新链接', en: 'New link' },
  'admin.action.revoke': { zh: '停用', en: 'Revoke' },
  'admin.action.report': { zh: '查看报告', en: 'View report' },
  'admin.revoked': { zh: '已停用', en: 'Revoked' },
  'admin.confirmRotate': {
    zh: '换新链接会让旧链接立刻失效,并给这个人重发一条新的。继续?',
    en: 'This kills the old link immediately and sends a new one. Continue?',
  },
  'admin.confirmRevoke': {
    zh: '停用会让这个人的链接立刻失效,而且【不会】发新的。继续?',
    en: 'This kills their link immediately and does NOT send a new one. Continue?',
  },
  'admin.notQueued': {
    zh: '已发出,但 GHL 没有把它放进执行队列 —— 先确认那条 workflow 是否已 Publish。',
    en: 'Sent, but GHL did not queue it — check whether the workflow is published.',
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
  'showcase.marks': { zh: '子模块标记(纯 CSS,不用字符)', en: 'Submodule marks (pure CSS, no glyphs)' },
  'showcase.markFull': { zh: '已具备', en: 'In place' },
  'showcase.markHalf': { zh: '部分具备', en: 'Partial' },
  'showcase.markEmpty': { zh: '缺失', en: 'Missing' },
  'showcase.dimColors': { zh: '六维分类色(仅作带墨边框的填充)', en: 'Dimension colours (bordered fills only)' },
  'showcase.fontNote': {
    zh: '生僻字若显示为方块,说明兜底字体未生效。PDF 渲染会出同样的问题。',
    en: 'Tofu boxes here mean the fallback font is not active. PDF rendering will fail the same way.',
  },
} as const satisfies Record<string, UiString>;

export type UiKey = keyof typeof UI_STRINGS;
