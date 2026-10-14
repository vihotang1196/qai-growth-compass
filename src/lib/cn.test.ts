import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';
import { cn } from './cn';

/**
 * PROGRESS ⑦:设计系统的 2px 墨边框从来没渲出来。`cn()` 是没配置过的 twMerge,它不认识自定义的 `border-brutal`(宽度),
 * 当成边框颜色 —— 后面跟着 `border-line`(颜色)时就把它删掉。
 */
describe('cn keeps the design-system border width', () => {
  it('border-brutal survives next to a border colour', () => {
    expect(cn('border-brutal border-line').split(' ')).toEqual(['border-brutal', 'border-line']);
    expect(cn('border-brutal', 'border-ink')).toBe('border-brutal border-ink');
  });

  it('the one-side widths survive too (tabs, table cells)', () => {
    for (const side of ['t', 'r', 'b', 'l', 'x', 'y']) {
      expect(cn(`border-${side}-brutal border-line`)).toBe(`border-${side}-brutal border-line`);
    }
  });

  it('real conflicts still resolve: the later width or colour wins', () => {
    expect(cn('border-brutal', 'border-0')).toBe('border-0');
    expect(cn('border-2', 'border-brutal')).toBe('border-brutal');
    expect(cn('border-line', 'border-ink')).toBe('border-ink');
    expect(cn('border-brutal border-line', 'border-ink')).toBe('border-brutal border-ink');
  });
});

/**
 * `bg-accent/40` 这种写法:颜色是 CSS 变量(`var(--qai-accent)`)时,Tailwind 没法给它加透明度,**那个类根本不生成** —— 元素是透明的。
 * 2026-10-14 之前有三处:Dialog 的遮罩(已修)、报告「影响:中」的浅黄标签、名单错误详情那一行的浅灰底。
 */
describe('no Tailwind opacity modifier on a CSS-variable colour', () => {
  const colors = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, unknown>;
  const varColors = Object.entries(colors)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('var('))
    .map(([k]) => k);

  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.(tsx?|css)$/.test(p) && !p.endsWith('.test.ts')) out.push(p);
    }
    return out;
  }

  it('the config still defines its colours as CSS variables (otherwise this check means nothing)', () => {
    expect(varColors).toEqual(expect.arrayContaining(['ink', 'accent', 'paper', 'line', 'line-soft']));
  });

  /** 注释里提到这种写法(说明为什么不能写)不算 —— 去掉注释、保留行号 */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('src has none', () => {
    const names = varColors.map((c) => c.replace(/[-]/g, '\\-')).sort((a, b) => b.length - a.length).join('|');
    const re = new RegExp(`\\b(?:bg|text|border(?:-[trblxy])?|ring|outline|fill|stroke|from|via|to|divide|decoration|shadow|accent|caret|placeholder)-(?:${names})\\/\\d+\\b`, 'g');
    const hits: string[] = [];
    for (const f of files(fileURLToPath(new URL('..', import.meta.url)))) {
      stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        for (const m of line.matchAll(re)) hits.push(`${f.split('/src/')[1]}:${i + 1} ${m[0]}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
