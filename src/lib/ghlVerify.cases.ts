/**
 * GHL 判据用例 —— Node 与 Deno 共用。
 */
export const FIELD_MAP = {
  qai_assessment_total: 'RjLthowcJvQPP6zSyeEN',
  qai_assessment_tier: 'CgO6Jzy2o6uIizRGNiol',
  qai_assessment_weakest_1: 'gwV3oUv28CSgn0j7mGHX',
};

/** 模拟 GET /locations/{id}/customFields 的响应(按文档形状:fieldKey 带 contact. 前缀) */
export const RAW_FIELD_RESPONSE = {
  customFields: [
    { id: 'RjLthowcJvQPP6zSyeEN', fieldKey: 'contact.qai_assessment_total', dataType: 'NUMERICAL' },
    { id: 'CgO6Jzy2o6uIizRGNiol', fieldKey: 'contact.qai_assessment_tier', dataType: 'TEXT' },
    { id: 'gwV3oUv28CSgn0j7mGHX', fieldKey: 'contact.qai_assessment_weakest_1', dataType: 'TEXT' },
    { id: 'ignore-me', name: 'some unrelated field' }, // 无 fieldKey → 跳过
  ],
};

export interface ClassifyCase {
  status: number;
  expect: 'TRANSIENT' | 'CONFIG' | 'AUTH';
}

export const CLASSIFY_CASES: ClassifyCase[] = [
  { status: 401, expect: 'AUTH' },
  { status: 403, expect: 'AUTH' },
  { status: 429, expect: 'TRANSIENT' },
  { status: 500, expect: 'TRANSIENT' },
  { status: 503, expect: 'TRANSIENT' },
  { status: 400, expect: 'CONFIG' },
  { status: 404, expect: 'CONFIG' },
  { status: 422, expect: 'CONFIG' },
];
