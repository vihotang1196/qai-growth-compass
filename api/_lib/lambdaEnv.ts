/**
 * 在 `@sparticuz/chromium` 被导入【之前】,补上 Vercel 没有提供的 Lambda 运行时声明。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【它对应包里的哪个函数 —— 149.0.0,2026-10-08 升级时重读过】
 *
 * `@sparticuz/chromium@149` 的 `build/index.js` 在【模块顶层】就做环境探测:
 *
 *     if (isRunningInAmazonLinux2023(nodeMajorVersion)) setupLambdaEnvironment('/tmp/al2023/lib');
 *
 * `isRunningInAmazonLinux2023`(`build/helper.js`)按顺序看:
 *   1. `AWS_EXECUTION_ENV` / `AWS_LAMBDA_JS_RUNTIME` 含 `20.x` / `22.x` / `24.x`,
 *      或 `CODEBUILD_BUILD_IMAGE` 含 `nodejs20/22/24` → true
 *   2. 否则 `process.env.VERCEL` 有值且 Node 主版本 ≥ 20 → true(149 新加的 Vercel 分支)
 * `setupLambdaEnvironment()` 把 `/tmp/al2023/lib` 加进 `LD_LIBRARY_PATH`;
 * `executablePath()` 在同一个判断为 true 时解压 `al2023.tar.br`(**libnss3.so 就在里面**)。
 * 131 那一版的 al2 分支(`isRunningInAwsLambda` + `al2.tar.br`)在 149 里已经不存在。
 *
 * 【为什么 Vercel 上要自己补 —— 131 时代的实测】
 *
 * Vercel 的 Node runtime 跑在 Lambda 上,但**不按 AWS 的格式声明** ——
 * `AWS_EXECUTION_ENV` 不含 `AWS_Lambda_nodejs22.x` 这类值。131 的探测因此一支都不进:
 *
 *   swiftshader.tar.br  无条件解压 → /tmp 里有 libEGL / libvulkan(实测确实有)
 *   al2023.tar.br       有条件     → 没解压 ⇒ **libnss3.so 根本不存在**
 *   LD_LIBRARY_PATH     有条件     → 没加 /tmp ⇒ 即便库在也找不到
 *
 * 症状:`/tmp/chromium: error while loading shared libraries: libnss3.so`。
 * 实测 facts 里 `LD_LIBRARY_PATH` 是 Lambda 原始默认值、一个 `/tmp` 都没有 ——
 * 那是「探测没进」的直接证据。
 *
 * 所以这不是绕过一个 bug,是**补上一个平台没提供的事实**:我们确实在 Lambda 上。
 *
 * 【149 的决定:保留,值不变】(PROGRESS「chromium 149」那一节)
 *
 *   - **无害**:值含 `22.x` ⇒ 第 1 条为 true ⇒ al2023 —— 与第 2 条(Vercel 分支)选的是同一个目录;
 *     149 没有别的分支可选,所以这个值不可能把它带到一个错的库目录
 *   - **还不能删**:删掉之后就要靠第 2 条,而第 2 条要求函数运行时里有 `VERCEL` 这个变量 ——
 *     那取决于项目设置「Automatically expose System Environment Variables」,仓库里看不到,
 *     本轮也没有在运行时观测过。冻结前不把一个没观测过的前提引进渲染链路
 *   - 想删的话:先在运行时确认 `VERCEL` 有值(比如 font-probe 打印出来),再删这一行,
 *     `assertChromiumEnvReady()` 会在探测没进时直接说出来
 *
 * 【⚠️ 再升级 @sparticuz/chromium 时必须重新确认这里】
 * 这个常量的存在理由是「149 的探测逻辑长这样」。先读新版的 `helper.js` 探测函数,
 * 再决定保留 / 改值 / 删掉。别把它当成一个「一直都在所以一直对」的东西。
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
 * 字体相关报错都要带的那几条环境事实 —— **一份实现,两个抛点共用**。
 *
 * 【为什么抽出来】下载失败与落地失败是两条不同的路径,但「排查时需要知道什么」是同一套。
 * 分别写两遍的话,以后往其中一处加字段,另一处会悄悄落后 —— 而落后的那条恰好是
 * 你没预料到的那次失败走的路。
 */
function fontEnvFacts(dirBefore: string[], dirAfter?: string[]): string {
  return (
    `FONTCONFIG_PATH=${process.env.FONTCONFIG_PATH ?? '(unset)'}, ` +
    `HOME=${process.env.HOME ?? '(unset)'}, ` +
    `dirBefore=${JSON.stringify(dirBefore)}` +
    (dirAfter ? `, dirAfter=${JSON.stringify(dirAfter)}` : '')
  );
}

/**
 * 把一个 URL 下载到本地文件 —— render-pdf 与 font-probe 交给 installFallbackFont 的下载器。
 *
 * 【为什么自己写】`@sparticuz/chromium@149` 删掉了 `font()`(131 用它下载并注册兜底字体)。
 * 149 的 `build/helper.js` 里有个 `downloadFile`,但包的入口没有导出它;从 `build/` 深导入
 * 等于依赖一个内部路径 —— 下次升级它挪了,失败要到运行时才出现。
 *
 * 非 200 一律抛 Error(带状态码),不抛裸字符串 —— 131 那个裸字符串的教训见 installFallbackFont。
 * 失败时删掉写了一半的目标文件:调用方写的是临时名,但这里也不留残渣。
 */
export async function fetchToFile(url: string, dest: string): Promise<void> {
  const { createWriteStream, rmSync } = await import('node:fs');
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}${res.body ? '' : ' (empty body)'}`.trim());
  }
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(dest));
  } catch (err) {
    rmSync(dest, { force: true });
    throw err;
  }
}

/**
 * 把中文兜底字体装进 **fontconfig 真的会扫的目录**,并校验落地。
 *
 * ⚠️⚠️ 【必须在 `chromium.executablePath()` 之后调用 —— 顺序是这个函数的正确性前提】
 *
 * `lambdafs.inflate()` 解压 `fonts.tar.br` 时的第一件事是:
 *     if (existsSync('/tmp/fonts')) return resolve();   // 目录已存在 ⇒ 整个跳过
 * 而 `fonts.tar.br` 里装着 **`fonts.conf` 本身**(以及 Open_Sans 那套拉丁字形)。149 仍是这样(已重读)。
 *
 * 更早的一版在下载字体时就 `mkdirSync('/tmp/fonts')`,而那**早于**
 * `executablePath()` 的解压 —— 于是 `fonts.conf` 永远不会落地,`FONTCONFIG_PATH`
 * 指向一个没有配置文件的目录,fontconfig 因此**一个字体目录都没有**。
 * 实测症状:**四块全空**,连拉丁字母和 ASCII 标题都不见了(那些原本由 fonts.tar.br 里的
 * Open_Sans 提供)。比修之前严重得多 —— 原来只是中文兜底层缺,后来是整个字体子系统没了。
 *
 * 【149 起直接下到 fontconfig 的目录】131 的 `font()` 下到 `$HOME/.fonts/`,而 fonts.conf 只扫
 * /var/task/.fonts、/var/task/fonts、/opt/fonts、/tmp/fonts —— 所以那时要再复制一份过去。
 * 149 没有 `font()` 了,下载器由调用方注入(生产用 `fetchToFile`),直接写进 `fontDir`。
 *
 * 【先写临时名,再改名】写到一半断了的话,最终路径上不能留下一个截断的文件:
 * 下一次调用会看到「文件在、而且够大」(截断在 1MB 之后也满足大小检查),把坏字体当成好的。
 * 同一目录内的 rename 是原子的,fontconfig 也就不会扫到半个文件。
 *
 * 【热实例不重下】文件已在且够大就直接用 —— 131 的 `font()` 也是见文件在就返回;
 * 换成自己下载之后这一条要自己守,否则每一份 PDF 都多付一次 8.3MB 的下载。
 * 但**不够大的残留不算数**:131 的 `font()` 正是在这里出过事(见文件在就 resolve,不看大小)。
 *
 * 【为什么不清 fontconfig 缓存】更早的一版还 `rmSync('/tmp/fonts-cache')`。不需要:
 * fontconfig 发现目录 mtime 变化时会自己重建索引;而删掉 cachedir 只增加一个
 * 「重建失败就全盘降级」的风险面。少做一件事。
 *
 * @param download 下载器:把 url 写到 dest(生产用 `fetchToFile`;测试注入假的)
 * @param fontUrl CDN 上的完整 otf URL
 * @param minBytes 最小可接受体积(那个 otf 是 8.3MB;明显偏小说明下载被截断或写了空文件)
 */
export async function installFallbackFont(
  download: (url: string, dest: string) => Promise<unknown>,
  fontUrl: string,
  minBytes = 1_000_000,
  /**
   * fonts.conf 里唯一可写的 /tmp 目录。**做成参数只是为了能测** ——
   * 生产永远用默认值,而在测试里往真实的 `/tmp/fonts` 里造文件恰好是当年
   * 弄坏整个字体子系统的那个动作(见上面 mkdirSync 那段),不能为了测一个函数去重演它。
   */
  fontDir = '/tmp/fonts',
): Promise<{ path: string; bytes: number; dirBefore: string[]; dirAfter: string[] }> {
  const { existsSync, readdirSync, renameSync, rmSync, statSync } = await import('node:fs');

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

  const fileName = fontUrl.split('/').pop() ?? 'fallback.otf';
  const fontPath = `${fontDir}/${fileName}`;
  const sizeOf = (p: string) => (existsSync(p) ? statSync(p).size : -1);

  if (sizeOf(fontPath) < minBytes) {
    const partPath = `${fontPath}.part`;
    /**
     * 【下载失败必须自己包一层 —— 否则最可能发生的失败给出信息量最低的错误】
     *
     * `@sparticuz/chromium@131` 的 `font()` 在非 200 时 reject 的是一个**裸字符串**
     * (`reject(\`Unexpected status code: ${response.statusCode}.\`)`),不是 Error。
     * 而调用侧统一按 `err instanceof Error ? err.message : String(err)` 降级,
     * 于是 `pdf_last_error` 会变成完整的一句:
     *
     *     Unexpected status code: 404.
     *
     * 没有 URL、没说这是字体、没有任何环境事实。而 **CDN 改错 / 文件被移走 / 403 恰恰是线上
     * 最可能的那种字体失败** —— 最可能发生的失败模式,给出的是最没法照着行动的那条错误。
     * 149 起下载器是我们自己的 `fetchToFile`(抛 Error),但下载器是注入的,这层归一化不随它变。
     *
     * 更麻烦的是它**会以「看起来像通过」的方式骗过失败路径的验证**:状态确实变成了 failed,
     * `pdf_last_error` 确实非空,于是「错误信息有了」这一条被勾掉 —— 而那句话没有信息量。
     * 见 PROGRESS.md 判断标准 9。
     */
    try {
      await download(fontUrl, partPath);
    } catch (err) {
      rmSync(partPath, { force: true });
      // 裸字符串 / 裸对象都在这里被归一化成带上下文的 Error
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `CJK fallback font download failed: ${cause} — url=${fontUrl}, ` +
          `${fontEnvFacts(dirBefore)}。` +
          `非 200 最常见的三种原因:CDN_FONT_BASE 指错、CDN 上该对象被改名/删除、` +
          `或该对象的访问权限变了(Bunny 的 token auth / 防盗链)。` +
          `注意浏览器侧用的是 *.subset.woff2,与这个 otf 是不同的文件 —— ` +
          `网站字体正常【不能】推出这个 URL 也正常。`,
      );
    }
    if (existsSync(partPath)) renameSync(partPath, fontPath);
  }

  const bytes = sizeOf(fontPath);
  const dirAfter = existsSync(fontDir) ? readdirSync(fontDir) : [];
  if (bytes < minBytes) {
    throw new Error(
      `CJK fallback font not usable at ${fontPath}: ` +
        `${bytes >= 0 ? `size ${bytes} bytes (expected >= ${minBytes})` : 'file does not exist'}. ` +
        `${fontEnvFacts(dirBefore, dirAfter)}, url=${fontUrl}。` +
        `下载器返回了成功,但 fontconfig 扫的目录里没有一个够大的文件 —— 下载被截断,或 CDN 回了一个很小的错误页。` +
        `兜底层不可用时生僻字会渲染成纯空白,宁可在这里失败,也不要出一份姓名看不见的报告。`,
    );
  }
  return { path: fontPath, bytes, dirBefore, dirAfter };
}
