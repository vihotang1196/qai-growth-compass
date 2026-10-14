import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import config from '@/config/assessment-config.json';
import registry from '@/config/config-fingerprints.json';
import { canonicalJson, configFingerprint, configStamp } from '@/lib/configFingerprint';

// 独立的参照实现:node:crypto,不经过被测模块的 Web Crypto
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('canonicalJson', () => {
  it('sorts object keys at every depth, so key order in the file does not matter', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('keeps array order — reordering questions or options is a real change', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('writes primitives exactly as JSON.stringify does (unicode, numbers, null, booleans)', () => {
    for (const v of ['café — ✓ naïve', 'a"b\\c\n', 2.9, 0, -1.5, 1e21, null, true, false]) {
      expect(canonicalJson(v)).toBe(JSON.stringify(v));
    }
  });

  it('drops undefined properties like JSON.stringify, so a parsed copy has the same fingerprint', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('configFingerprint', () => {
  it('is the hex sha256 of the canonical JSON', async () => {
    const obj = { b: 1, a: [1, 'café ✓'] };
    expect(await configFingerprint(obj)).toBe(sha256('{"a":[1,"café ✓"],"b":1}'));
  });

  it('does not change with formatting: a re-serialised copy of the config has the same fingerprint', async () => {
    const reformatted = JSON.parse(JSON.stringify(config, null, 4));
    expect(await configFingerprint(reformatted)).toBe(await configFingerprint(config));
  });

  it('changes when any value changes', async () => {
    const copy = JSON.parse(JSON.stringify(config));
    copy.tiers[0].max = 2.05;
    expect(await configFingerprint(copy)).not.toBe(await configFingerprint(config));
  });
});

describe('version registry (src/config/config-fingerprints.json)', () => {
  /**
   * 【这一条红了怎么办】config 的内容变了:
   *   - 升 `meta.version`,再 `npm run config:fingerprint -- --register` 登记新版本;
   *   - 不要改登记表里已有版本的指纹 —— 那等于让两份不同的 config 共用一个版本号(PROGRESS ⑩)。
   */
  it('the current config is registered under its own meta.version with exactly this fingerprint', async () => {
    const reg = registry as Record<string, string>;
    expect(reg[config.meta.version], `meta.version ${config.meta.version} is not registered`).toBeDefined();
    expect(await configFingerprint(config)).toBe(reg[config.meta.version]);
  });

  it('never registers one fingerprint under two versions', () => {
    const fps = Object.values(registry as Record<string, string>);
    expect(new Set(fps).size).toBe(fps.length);
  });
});

describe('configStamp — what scoring writes into assessment_results', () => {
  it('carries the version label and the fingerprint', async () => {
    expect(await configStamp(config)).toEqual({
      config_version: config.meta.version,
      config_sha256: await configFingerprint(config),
    });
  });

  it('a config without a string version still gets a fingerprint, with the label left empty', async () => {
    const stamp = await configStamp({ meta: {}, x: 1 });
    expect(stamp.config_version).toBeNull();
    expect(stamp.config_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never throws: if hashing fails, both columns are empty and one line is logged', async () => {
    const log = vi.fn();
    const failing = { meta: { version: '9.9.9' }, get boom() { throw new Error('getter exploded'); } };
    await expect(configStamp(failing, log)).resolves.toEqual({ config_version: null, config_sha256: null });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('getter exploded');
  });
});
