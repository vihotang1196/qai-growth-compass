/**
 * 在 `@sparticuz/chromium` 被导入【之前】,补上 Vercel 没有提供的 Lambda 运行时声明。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【它对应包里的哪个函数】
 *
 * `@sparticuz/chromium@131` 的 `build/index.js` 在【模块顶层】就做环境探测:
 *
 *     if (isRunningInAwsLambda())        setupLambdaEnvironment('/tmp/al2/lib');
 *     else if (isRunningInAwsLambdaNode20()) setupLambdaEnvironment('/tmp/al2023/lib');
 *
 * 两个函数(`build/helper.js`)都只读环境变量 `AWS_EXECUTION_ENV` /
 * `AWS_LAMBDA_JS_RUNTIME` / `CODEBUILD_BUILD_IMAGE`,匹配 `AWS_Lambda_nodejs` 与
 * `20.x` / `22.x` 这类字符串。`setupLambdaEnvironment()` 负责两件事:
 * 解压 `al2.tar.br` / `al2023.tar.br`(**libnss3.so 就在里面**),以及把 `/tmp/…/lib`
 * 加进 `LD_LIBRARY_PATH`。
 *
 * 【为什么 Vercel 上必须自己补】
 *
 * Vercel 的 Node runtime 跑在 Lambda 上,但**不按 AWS 的格式声明** ——
 * `AWS_EXECUTION_ENV` 不含 `AWS_Lambda_nodejs22.x` 这类值。于是两个 if 都不进:
 *
 *   swiftshader.tar.br  无条件解压 → /tmp 里有 libEGL / libvulkan(实测确实有)
 *   al2023.tar.br       有条件     → 没解压 ⇒ **libnss3.so 根本不存在**
 *   LD_LIBRARY_PATH     有条件     → 没加 /tmp ⇒ 即便库在也找不到
 *
 * 症状:`/tmp/chromium: error while loading shared libraries: libnss3.so`。
 * 实测 facts 里 `LD_LIBRARY_PATH` 是 Lambda 原始默认值、一个 `/tmp` 都没有 ——
 * 那是「两个 if 都没进」的直接证据。
 *
 * 所以这不是绕过一个 bug,是**补上一个平台没提供的事实**:我们确实在 Lambda 上。
 *
 * 【为什么选 `AWS_Lambda_nodejs22.x` 这个值】
 *
 *   含 `22.x`  → `isRunningInAwsLambdaNode20()` 为 true → 解压 **al2023**
 *   含 `22.x`  → `isRunningInAwsLambda()` 里那两个 `!includes` 为 false → 不会走 al2
 *
 * 两支互斥,不会打架。选 al2023 是因为 **Node 24 的 Lambda 基础镜像是 AL2023**,
 * 而且 al2023.tar.br 带的库更全(多了 libnspr4 / libplc4 / libplds4 / libfreeblpriv3)。
 *
 * 【⚠️ 升级 @sparticuz/chromium 时必须重新确认这里】
 *
 * 这个常量的存在理由是「131 那一版的探测逻辑长这样」。149(latest)声明支持 Node 24,
 * 很可能正是因为它改了探测逻辑 —— 那时这段注入可能:
 *   变成没必要(它自己认得 Vercel),或
 *   **变成有害**(比如新版按这个值去选一个错的库目录)。
 * 升级时先读新版的 `helper.js` 探测函数,再决定保留 / 改值 / 删掉。
 * 别把它当成一个「一直都在所以一直对」的东西。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 只在真的没有声明时补 —— 若哪天 Vercel(或 AWS 原生)自己给了,以它的为准 */
const INJECTED_VALUE = 'AWS_Lambda_nodejs22.x';

if (!process.env.AWS_EXECUTION_ENV) {
  process.env.AWS_EXECUTION_ENV = INJECTED_VALUE;
}

/**
 * 事后校验:chromium 模块加载后,`LD_LIBRARY_PATH` 里应该出现 `/tmp/al2023/lib`。
 * 没出现说明注入没赶在导入之前(ESM 求值顺序被改了),或新版探测逻辑变了。
 *
 * 【为什么不在这里抛】这个文件在 chromium 之前执行,那时还没得可查。
 * 真正的校验在 assertChromiumEnvReady(),由 render-pdf 在导入之后调用。
 */
export function assertChromiumEnvReady(): void {
  const ld = process.env.LD_LIBRARY_PATH ?? '';
  if (!ld.includes('/tmp/')) {
    throw new Error(
      'chromium env not initialised: LD_LIBRARY_PATH has no /tmp lib dir. ' +
        `AWS_EXECUTION_ENV=${JSON.stringify(process.env.AWS_EXECUTION_ENV)}, LD_LIBRARY_PATH=${JSON.stringify(ld)}. ` +
        '这意味着 @sparticuz/chromium 的顶层探测没有生效 —— 要么 lambdaEnv 没有在它【之前】被导入' +
        '(检查 api/render-pdf.ts 的 import 顺序,以及 scripts/check-api-imports.mjs 那条规则),' +
        '要么升级后的探测逻辑变了(见本文件头的升级提醒)。',
    );
  }
}

/**
 * 把中文兜底字体装进 **fontconfig 真的会扫的目录**,并校验落地。
 *
 * ⚠️⚠️ 【必须在 `chromium.executablePath()` 之后调用 —— 顺序是这个函数的正确性前提】
 *
 * `lambdafs.inflate()` 解压 `fonts.tar.br` 时的第一件事是:
 *     if (existsSync('/tmp/fonts')) return resolve();   // 目录已存在 ⇒ 整个跳过
 * 而 `fonts.tar.br` 里装着 **`fonts.conf` 本身**(以及 Open_Sans 那套拉丁字形)。
 *
 * 上一版在 `chromium.font()` 阶段就 `mkdirSync('/tmp/fonts')`,而那**早于**
 * `executablePath()` 的解压 —— 于是 `fonts.conf` 永远不会落地,`FONTCONFIG_PATH`
 * 指向一个没有配置文件的目录,fontconfig 因此**一个字体目录都没有**。
 * 实测症状:**四块全空**,连拉丁字母和 ASCII 标题都不见了(那些原本由 fonts.tar.br 里的
 * Open_Sans 提供)。比修之前严重得多 —— 原来只是中文兜底层缺,后来是整个字体子系统没了。
 *
 * 【为什么不清 fontconfig 缓存】上一版还 `rmSync('/tmp/fonts-cache')`。不需要:
 * fontconfig 发现目录 mtime 变化时会自己重建索引;而删掉 cachedir 只增加一个
 * 「重建失败就全盘降级」的风险面。少做一件事。
 *
 * 【为什么复制而不是符号链接】fontconfig 扫目录时对 symlink 的处理依实现而异,复制没有歧义。
 *
 * @param fontUrl CDN 上的完整 otf URL
 * @param minBytes 最小可接受体积(那个 otf 是 8.3MB;明显偏小说明下载被截断或写了空文件)
 */
export async function installFallbackFont(
  chromiumFont: (url: string) => Promise<unknown>,
  fontUrl: string,
  minBytes = 1_000_000,
): Promise<{ path: string; bytes: number; dirBefore: string[]; dirAfter: string[] }> {
  const { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } = await import('node:fs');

  const fontDir = '/tmp/fonts'; // fonts.conf 里唯一可写的 /tmp 目录

  /**
   * 【前提校验:fonts.conf 必须已经在那里】它由 executablePath() 解压出来。
   * 不在就说明本函数被提前调用了 —— 与其静默地把整个字体子系统弄坏,不如在这里就失败。
   */
  const dirBefore = existsSync(fontDir) ? readdirSync(fontDir) : [];
  if (!existsSync(`${fontDir}/fonts.conf`)) {
    throw new Error(
      `installFallbackFont() called too early: ${fontDir}/fonts.conf is missing ` +
        `(dir contents: ${JSON.stringify(dirBefore)}). ` +
        'fonts.conf 由 chromium.executablePath() 解压 fonts.tar.br 得到,而 lambdafs 见到 ' +
        '/tmp/fonts 已存在就整个跳过解压。所以本函数【必须】在 executablePath() 之后调用。',
    );
  }

  await chromiumFont(fontUrl);

  const fileName = fontUrl.split('/').pop() ?? 'fallback.otf';
  const downloadedAt = `${process.env.HOME ?? '/tmp'}/.fonts/${fileName}`;
  const fontPath = `${fontDir}/${fileName}`;

  if (existsSync(downloadedAt) && !existsSync(fontPath)) {
    mkdirSync(fontDir, { recursive: true });
    copyFileSync(downloadedAt, fontPath);
  }

  const stat = existsSync(fontPath) ? statSync(fontPath) : null;
  const dirAfter = existsSync(fontDir) ? readdirSync(fontDir) : [];
  if (!stat || stat.size < minBytes) {
    throw new Error(
      `CJK fallback font not usable at ${fontPath}: ` +
        `${stat ? `size ${stat.size} bytes (expected >= ${minBytes})` : 'file does not exist'}. ` +
        `downloadedAt=${downloadedAt}(exists=${existsSync(downloadedAt)}), ` +
        `FONTCONFIG_PATH=${process.env.FONTCONFIG_PATH ?? '(unset)'}, HOME=${process.env.HOME ?? '(unset)'}, ` +
        `dirBefore=${JSON.stringify(dirBefore)}, dirAfter=${JSON.stringify(dirAfter)}, url=${fontUrl}。` +
        `fonts.conf 只扫 /var/task/.fonts、/var/task/fonts、/opt/fonts、/tmp/fonts —— ` +
        `不含 chromium.font() 的落点 /tmp/.fonts,所以必须复制过去。` +
        `兜底层不可用时生僻字会渲染成纯空白,宁可在这里失败,也不要出一份姓名看不见的报告。`,
    );
  }
  return { path: fontPath, bytes: stat.size, dirBefore, dirAfter };
}
