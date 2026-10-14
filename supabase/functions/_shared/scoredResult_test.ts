import { assert, assertEquals } from '@std/assert';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };
import registry from '../../../src/config/config-fingerprints.json' with { type: 'json' };
import { configFingerprint, configStamp } from './configFingerprint.ts';
import { scoredResultRow } from './scoredResult.ts';

const RESULT = {
  dimensions: { goal: 1.7, traffic: 2, capture: 0.8, convert: 1.3, value: 2.5 },
  total: 1.7,
  tier: 'manual',
  weakest: ['capture', 'convert'] as [string, string],
  strongest: ['value', 'traffic'] as [string, string],
};

Deno.test('出分写进 assessment_results 的那一行带着 config 的版本与指纹(⑩)', () => {
  const stamp = { config_version: '3.2.0', config_sha256: 'a'.repeat(64) };
  assertEquals(scoredResultRow('sess-1', RESULT, stamp, '2026-10-14T05:00:00.000Z'), {
    session_id: 'sess-1',
    dim_scores: RESULT.dimensions,
    total: 1.7,
    tier: 'manual',
    weakest: ['capture', 'convert'],
    strongest: ['value', 'traffic'],
    computed_at: '2026-10-14T05:00:00.000Z',
    config_version: '3.2.0',
    config_sha256: 'a'.repeat(64),
  });
});

Deno.test('指纹算不出来时两列写空,分数照常写', () => {
  const row = scoredResultRow('sess-1', RESULT, { config_version: null, config_sha256: null }, '2026-10-14T05:00:00.000Z');
  assertEquals(row.config_version, null);
  assertEquals(row.config_sha256, null);
  assertEquals(row.total, 1.7);
});

/**
 * 【跨运行时】出分函数在 Deno 里算指纹,登记表由 Node 的脚本写、由 vitest 核对。
 * 两边算出不同的值的话,库里每一行的指纹都对不上登记表 —— 而那不会报任何错。这一条让它在 Deno 这边也必须等于登记的那个。
 */
Deno.test('Deno 里算出的当前 config 指纹 = 登记表里这个版本的那个(与 Node 一致)', async () => {
  const reg = registry as Record<string, string>;
  assert(reg[config.meta.version], `meta.version ${config.meta.version} 没有登记`);
  assertEquals(await configFingerprint(config), reg[config.meta.version]);
  assertEquals(await configStamp(config), { config_version: config.meta.version, config_sha256: reg[config.meta.version] });
});
