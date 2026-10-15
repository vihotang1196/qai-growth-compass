import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPdfState, fetchReport, requestReportFile } from '@/lib/reportApi';

/**
 * 看历次中的某一份:`?attempt=n` 要真的到达服务端 —— 页面、轮询、点下载那一刻的重取、
 * 请求生成文件,四条路都要带上(判断标准 1 推论九:一个修好了但调用方不传参数的分支,与没修没有区别)。
 * 不看历史时一个字都不多带,与今天的请求逐字相同。
 */
let calls: { url: string; init: RequestInit | undefined }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('window', { location: { search: '?lang=zh' }, localStorage: { getItem: () => null } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ pdfStatus: 'ready', pdfUrl: null, status: 'ready' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const query = (url: string) => Object.fromEntries(new URL(url, 'https://x.invalid').searchParams);

describe('fetchReport / fetchPdfState', () => {
  it('latest (no attempt) → exactly today\'s request', async () => {
    await fetchReport();
    expect(query(calls[0].url)).toEqual({ lang: 'zh' });
  });

  it('an older attempt → ?attempt=n alongside the language', async () => {
    await fetchReport(1);
    expect(query(calls[0].url)).toEqual({ lang: 'zh', attempt: '1' });
  });

  it('polling and the re-fetch before a download ask for the same attempt', async () => {
    await fetchPdfState(2);
    expect(query(calls[0].url)).toEqual({ lang: 'zh', attempt: '2' });
  });
});

describe('requestReportFile', () => {
  it('latest → { lang } only, as today', async () => {
    await requestReportFile('en');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ lang: 'en' });
  });

  it('an older attempt → { lang, attempt } (the server then refuses to render a new language for it)', async () => {
    await requestReportFile('zh', 1);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ lang: 'zh', attempt: 1 });
  });
});
