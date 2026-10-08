import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchToFile, installFallbackFont } from '../../api/_lib/lambdaEnv';

/**
 * installFallbackFont 的失败路径与落地路径。
 *
 * 【为什么这组存在】`@sparticuz/chromium@131` 的 `font()` 在非 200 时 reject 的是一个
 * **裸字符串**而不是 Error。调用侧统一按 `err instanceof Error ? err.message : String(err)` 降级,
 * 于是 `pdf_last_error` 曾经会变成整整一句「Unexpected status code: 404.」——
 * 没有 URL、没说这是字体、没有任何环境事实。而 CDN 改错 / 文件被移走 / 403 正是线上最可能的那种字体失败。
 * 149 删掉了 `font()`,下载改由我们自己的 `fetchToFile` 做 —— 但「下载器抛出来的东西要被补上上下文」
 * 这条不随下载器变:下载器是注入的,换一个实现就可能又是裸字符串。
 *
 * 它的危险在于**看起来像通过**:状态确实变 failed、`pdf_last_error` 确实非空,
 * 于是失败路径的验收被勾掉,而那句话根本没法照着行动。见 PROGRESS.md 判断标准 9。
 *
 * 所以这里断言的不是「会不会抛」,是**抛出来的东西够不够用来定位**。
 */

const FONT_URL = 'https://cdn.example.test/fonts/NotoSansSC-Regular.otf';
const FONT_NAME = 'NotoSansSC-Regular.otf';
const tempRoots: string[] = [];

/** 造一个已经有 fonts.conf 的字体目录 —— 那是 installFallbackFont 的前置条件 */
function makeFontDir(withConf = true, existing?: { bytes: number }): string {
  const root = mkdtempSync(join(tmpdir(), 'compass-fontdir-'));
  tempRoots.push(root);
  if (withConf) writeFileSync(join(root, 'fonts.conf'), '<fontconfig/>');
  if (existing) writeFileSync(join(root, FONT_NAME), Buffer.alloc(existing.bytes));
  return root;
}

/** 一个按指定字节数写目标文件的下载器,并记下被调了几次、写到了哪 */
function writingDownloader(bytes: number) {
  const calls: { url: string; dest: string }[] = [];
  const fn = async (url: string, dest: string) => {
    calls.push({ url, dest });
    writeFileSync(dest, Buffer.alloc(bytes));
  };
  return { fn, calls };
}

let server: Server | null = null;

afterEach(async () => {
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

describe('installFallbackFont surfaces enough to act on when the download fails', () => {
  it('a bare-string rejection becomes an Error, not "[object Object]" or a naked sentence', async () => {
    const fontDir = makeFontDir();

    // 131 的 chromium.font() 的真实行为:reject 一个字符串,不是 Error。下载器是注入的,这种形状仍可能出现
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
     * 下载「成功」但文件没落地是另一条路径。两条路径共用 fontEnvFacts() ——
     * 这条守的是「往其中一处加字段时另一处不会悄悄落后」。
     */
    const fontDir = makeFontDir();
    const resolveWithoutWriting = () => Promise.resolve();

    const err = await installFallbackFont(resolveWithoutWriting, FONT_URL, 1_000_000, fontDir).catch(
      (e) => e as Error,
    );

    expect((err as Error).message).toContain('not usable');
    expect((err as Error).message).toContain('HOME=');
    expect((err as Error).message).toContain('FONTCONFIG_PATH=');
    expect((err as Error).message).toContain(FONT_URL);
  });

  it('a file that downloaded but is far too small is rejected, not silently accepted', async () => {
    // 截断 / 空响应 / CDN 回了一个错误页 —— 兜底层会静默失效,症状是生僻字渲染成纯空白
    const fontDir = makeFontDir();
    const { fn } = writingDownloader(12);

    const err = await installFallbackFont(fn, FONT_URL, 1_000_000, fontDir).catch((e) => e as Error);

    expect((err as Error).message).toContain('12 bytes');
  });

  it('refuses to run before fonts.conf exists — the precondition that broke everything once', async () => {
    const fontDir = makeFontDir(false); // 没有 fonts.conf
    const { fn, calls } = writingDownloader(1_200_000);

    const err = await installFallbackFont(fn, FONT_URL, 1_000_000, fontDir).catch((e) => e as Error);

    expect((err as Error).message).toContain('called too early');
    expect((err as Error).message).toContain('fonts.conf');
    // 前置条件不成立时一个字节都不该写进那个目录 —— 写了就是重演当年那次
    expect(calls).toHaveLength(0);
  });
});

describe('installFallbackFont lands the font where fontconfig actually looks', () => {
  it('the happy path downloads into the fontconfig directory itself and leaves no temp file', async () => {
    // 反向锁:上面全是失败断言,没有这条就无法排除「它总是抛」
    const fontDir = makeFontDir();
    const { fn, calls } = writingDownloader(1_200_000);

    const result = await installFallbackFont(fn, FONT_URL, 1_000_000, fontDir);

    expect(result.bytes).toBe(1_200_000);
    expect(result.path).toBe(join(fontDir, FONT_NAME));
    expect(result.dirAfter).toContain(FONT_NAME);
    // fonts.conf 只扫那四个目录;下到别处(131 时代的 $HOME/.fonts)等于没装
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(FONT_URL);
    expect(calls[0].dest.startsWith(fontDir)).toBe(true);
    // 先写临时名再改名:落地之后目录里只剩 fonts.conf 与字体本身
    expect(readdirSync(fontDir).sort()).toEqual([FONT_NAME, 'fonts.conf'].sort());
  });

  it('a warm instance with a valid font already in place does not download again', async () => {
    /**
     * 131 的 font() 见到文件已在就直接返回 —— 热实例不会每次渲染都重下 8.3MB。
     * 换成自己下载之后这一条要自己守,否则每一份 PDF 都多付一次下载。
     */
    const fontDir = makeFontDir(true, { bytes: 1_200_000 });
    const { fn, calls } = writingDownloader(1_200_000);

    const result = await installFallbackFont(fn, FONT_URL, 1_000_000, fontDir);

    expect(calls).toHaveLength(0);
    expect(result.bytes).toBe(1_200_000);
  });

  it('a leftover undersized file is replaced by a fresh download, not accepted', async () => {
    // 131 的 font() 正是在这里出过事:见到文件存在就 resolve,不看大小
    const fontDir = makeFontDir(true, { bytes: 12 });
    const { fn, calls } = writingDownloader(1_200_000);

    const result = await installFallbackFont(fn, FONT_URL, 1_000_000, fontDir);

    expect(calls).toHaveLength(1);
    expect(result.bytes).toBe(1_200_000);
  });

  it('a download that dies half-way leaves nothing at the final path', async () => {
    /**
     * 写到一半断了:最终路径上不能留下一个截断的文件 —— 否则下一次调用会看到「文件在、而且够大」
     * (截断在 1MB 之后也满足大小检查),于是把一个坏字体当成好的。
     */
    const fontDir = makeFontDir();
    const dieHalfWay = async (_url: string, dest: string) => {
      writeFileSync(dest, Buffer.alloc(5_000_000));
      throw new Error('ECONNRESET');
    };

    const err = await installFallbackFont(dieHalfWay, FONT_URL, 1_000_000, fontDir).catch((e) => e as Error);

    expect((err as Error).message).toContain('ECONNRESET');
    expect(existsSync(join(fontDir, FONT_NAME))).toBe(false);
  });
});

describe('fetchToFile is the downloader render-pdf and font-probe hand in', () => {
  async function serve(status: number, body: Buffer): Promise<string> {
    server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/octet-stream' });
      res.end(body);
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/fonts/${FONT_NAME}`;
  }

  it('writes the response body to the destination', async () => {
    const url = await serve(200, Buffer.alloc(300_000, 7));
    const dir = makeFontDir();
    const dest = join(dir, 'out.bin');

    await fetchToFile(url, dest);

    expect(statSync(dest).size).toBe(300_000);
  });

  it('a non-200 is an Error that carries the status, never a bare string', async () => {
    const url = await serve(403, Buffer.from('denied'));
    const dir = makeFontDir();

    const err = await fetchToFile(url, join(dir, 'out.bin')).catch((e) => e as unknown);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('403');
    // 失败时不留下任何东西
    expect(existsSync(join(dir, 'out.bin'))).toBe(false);
  });
});
