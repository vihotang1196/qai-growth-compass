/**
 * 出分写进 `assessment_results` 的那一行 —— 纯函数,好让「带上 config 的版本与指纹」这件事有测试看着(PROGRESS ⑩)。
 *
 * 【为什么单独拆出来】出分函数的入口是 `Deno.serve`,本地难测;
 * 而这一行少了那两列不会报任何错 —— 只是以后再也追溯不出这份分数是按哪一版 config 算的。
 */
import type { ScoreResult } from './scoring.ts';
import type { ConfigStamp } from './configFingerprint.ts';

export function scoredResultRow(
  sessionId: string,
  result: ScoreResult,
  stamp: ConfigStamp,
  computedAt: string,
) {
  return {
    session_id: sessionId,
    dim_scores: result.dimensions,
    total: result.total,
    tier: result.tier,
    weakest: result.weakest,
    strongest: result.strongest,
    computed_at: computedAt,
    config_version: stamp.config_version,
    config_sha256: stamp.config_sha256,
  };
}
