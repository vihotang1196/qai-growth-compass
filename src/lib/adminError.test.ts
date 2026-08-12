import { describe, expect, it } from 'vitest';
import { adminErrorMessage } from './adminApi';

describe('adminErrorMessage', () => {
  it('carries kind and code so the message says where to look', () => {
    /**
     * 这次问卷洞察那个 500 的实际形状。有了这一行,界面上直接看到
     * `query_failed PGRST200` —— 不用去翻 Supabase 日志就知道去看那条查询。
     */
    expect(adminErrorMessage(500, { error: 'internal_error', kind: 'query_failed', code: 'PGRST200' })).toBe(
      'internal_error (query_failed PGRST200)',
    );
  });

  it('shows kind alone when there is no public code', () => {
    // config_missing 拿不到错误码,但「去看环境变量」这个指向本身就够了
    expect(adminErrorMessage(500, { error: 'internal_error', kind: 'config_missing', code: null })).toBe(
      'internal_error (config_missing)',
    );
  });

  it('falls back to the bare error when the body has no classification', () => {
    /**
     * 授权判定之前那一处刻意不带分类(名单外的人不该拿到内部状态探针),
     * 所以这条路径必须仍然可读 —— 反向锁:没有它,「恒定拼接」也能让上面两条绿。
     */
    expect(adminErrorMessage(500, { error: 'internal_error' })).toBe('internal_error');
    expect(adminErrorMessage(400, { error: 'unknown_action' })).toBe('unknown_action');
  });

  it('falls back to the status when the body has no error field at all', () => {
    expect(adminErrorMessage(502, null)).toBe('admin failed (502)');
    expect(adminErrorMessage(500, {})).toBe('admin failed (500)');
  });

  it('never invents a classification the server did not send', () => {
    // 猜错的分类比不分类更糟 —— 它会把人送到错误的地方,而且送得很有信心
    expect(adminErrorMessage(500, { error: 'internal_error', kind: undefined, code: undefined })).toBe(
      'internal_error',
    );
  });
});
