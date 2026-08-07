import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFallbackFont } from '../../api/_lib/lambdaEnv';

/**
 * installFallbackFont 的失败路径。
 *
 * 【为什么这组存在】`@sparticuz/chromium` 的 `font()` 在非 200 时 reject 的是一个
 * **裸字符串**而不是 Error(`build/index.js:65`)。调用侧统一按
 * `err instanceof Error ? err.message : String(err)` 降级,于是 `pdf_last_error`
 * 曾经会变成整整一句「Unexpected status code: 404.」—— 没有 URL、没说这是字体、
 * 没有任何环境事实。而 CDN 改错 / 文件被移走 / 403 正是线上最可能的那种字体失败。
 *
 * 它的危险在于**看起来像通过**:状态确实变 failed、`pdf_last_error` 确实非空,
 * 于是失败路径的验收被勾掉,而那句话根本没法照着行动。见 PROGRESS.md 判断标准 9。
 *
 * 所以这里断言的不是「会不会抛」,是**抛出来的东西够不够用来定位**。
 */

const FONT_URL = 'https://cdn.example.test/fonts/NotoSansSC-Regular.otf';
const tempRoots: string[] = [];

/** 造一个已经有 fonts.conf 的字体目录 —— 那是 installFallbackFont 的前置条件 */
function makeFontDir(withConf = true): string {
  const root = mkdtempSync(join(tmpdir(), 'compass-fontdir-'));
  tempRoots.push(root);
  if (withConf) writeFileSync(join(root, 'fonts.conf'), '<fontconfig/>');
  return root;
}

/** 造一个假的 HOME,并可选地在 .fonts/ 里放一个指定大小的已下载文件 */
function makeHome(fileName?: string, bytes = 0): string {
  const home = mkdtempSync(join(tmpdir(), 'compass-home-'));
  tempRoots.push(home);
  mkdirSync(join(home, '.fonts'), { recursive: true });
  if (fileName) writeFileSync(join(home, '.fonts', fileName), Buffer.alloc(bytes));
  return home;
}

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('installFallbackFont surfaces enough to act on when the download fails', () => {
  it('a bare-string rejection becomes an Error, not "[object Object]" or a naked sentence', async () => {
    process.env.HOME = makeHome();
    const fontDir = makeFontDir();

    // chromium.font() 的真实行为:reject 一个字符串,不是 Error
    const rejectWithString = () => Promise.reject('Unexpected status code: 404.');

    const err = await installFallbackFont(rejectWithString, FONT_URL, 1_000_000, fontDir).catch(
      (e) => e as unknown,
    );

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;

    // 原始成因保留
    expect(message).toContain('404');
    // 但必须补上「这是哪件事、哪个 URL、什么环境」——原来这三样一个都没有
    expect(message).toContain('font');
    expect(message).toContain(FONT_URL);
    expect(message).toContain('HOME=');
    expect(message).toContain('FONTCONFIG_PATH=');
  });

  it('an Error rejection keeps its own message and still gains the context', async () => {
    process.env.HOME = makeHome();
    const fontDir = makeFontDir();
    const rejectWithError = () => Promise.reject(new Error('socket hang up'));

    const err = await installFallbackFont(rejectWithError, FONT_URL, 1_000_000, fontDir).catch(
      (e) => e as Error,
    );

    expect((err as Error).message).toContain('socket hang up');
    expect((err as Error).message).toContain(FONT_URL);
  });

  it('names the three things that actually cause a non-200 on this URL', async () => {
    /**
     * 「具体到能照着行动」不是形容词。排查这条 URL 的非 200 只有三个方向,
     * 错误里就该把它们列出来,否则下一个人得先把这三条重新想一遍。
     * 尤其最后那条 —— 网站字体是 *.subset.woff2,与这个 otf 是不同的文件,
     * 「网站字体好好的」推不出「这个 URL 好好的」,而那正是最容易走错的一步。
     */
    process.env.HOME = makeHome();
    const fontDir = makeFontDir();
    const err = await installFallbackFont(
      () => Promise.reject('Unexpected status code: 403.'),
      FONT_URL,
      1_000_000,
      fontDir,
    ).catch((e) => e as Error);

    const message = (err as Error).message;
    expect(message).toContain('CDN_FONT_BASE');
    expect(message).toContain('subset.woff2');
  });

  it('the landed-file check still carries the same environment facts', async () => {
    /**
     * 下载成功但文件没落地是另一条路径。两条路径共用 fontEnvFacts() ——
     * 这条守的是「往其中一处加字段时另一处不会悄悄落后」。
     */
    process.env.HOME = makeHome();
    const fontDir = makeFontDir();
    const resolveWithoutWriting = () => Promise.resolve('ok');

    const err = await installFallbackFont(resolveWithoutWriting, FONT_URL, 1_000_000, fontDir).catch(
      (e) => e as Error,
    );

    expect((err as Error).message).toContain('not usable');
    expect((err as Error).message).toContain('HOME=');
    expect((err as Error).message).toContain('FONTCONFIG_PATH=');
    expect((err as Error).message).toContain(FONT_URL);
  });

  it('a file that downloaded but is far too small is rejected, not silently accepted', async () => {
    /**
     * chromium.font() 见到目标文件已存在就直接 resolve,不校验大小 ——
     * 早先某次留下的 0 字节残留会让兜底层静默失效,症状是生僻字渲染成纯空白。
     */
    process.env.HOME = makeHome('NotoSansSC-Regular.otf', 12);
    const fontDir = makeFontDir();

    const err = await installFallbackFont(() => Promise.resolve('ok'), FONT_URL, 1_000_000, fontDir).catch(
      (e) => e as Error,
    );

    expect((err as Error).message).toContain('12 bytes');
  });

  it('refuses to run before fonts.conf exists — the precondition that broke everything once', async () => {
    process.env.HOME = makeHome();
    const fontDir = makeFontDir(false); // 没有 fonts.conf

    const err = await installFallbackFont(() => Promise.resolve('ok'), FONT_URL, 1_000_000, fontDir).catch(
      (e) => e as Error,
    );

    expect((err as Error).message).toContain('called too early');
    expect((err as Error).message).toContain('fonts.conf');
  });

  it('the happy path still returns the landed file, so the failure cases are not the only path', async () => {
    // 反向锁:上面全是失败断言,没有这条就无法排除「它总是抛」
    process.env.HOME = makeHome('NotoSansSC-Regular.otf', 1_200_000);
    const fontDir = makeFontDir();

    const result = await installFallbackFont(
      () => Promise.resolve('ok'),
      FONT_URL,
      1_000_000,
      fontDir,
    );

    expect(result.bytes).toBe(1_200_000);
    expect(result.path).toBe(join(fontDir, 'NotoSansSC-Regular.otf'));
    expect(result.dirAfter).toContain('NotoSansSC-Regular.otf');
  });
});
