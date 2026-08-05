import { assertEquals } from '@std/assert';
import { classifyGhlError, parseFieldMap, verifyWrittenFields } from './ghlVerify.ts';
import { CLASSIFY_CASES, FIELD_MAP, RAW_FIELD_RESPONSE } from '../../../src/lib/ghlVerify.cases.ts';

Deno.test('parseFieldMap: builds key→id, strips contact. prefix', () => {
  assertEquals(parseFieldMap(RAW_FIELD_RESPONSE), FIELD_MAP);
});

Deno.test('verifyWrittenFields: number total 0.6 matches whether echoed as number or string', () => {
  const map = { qai_assessment_total: 'RjLthowcJvQPP6zSyeEN' };
  assertEquals(verifyWrittenFields({ qai_assessment_total: 0.6 }, map, [{ id: 'RjLthowcJvQPP6zSyeEN', value: 0.6 }]).ok, true);
  assertEquals(verifyWrittenFields({ qai_assessment_total: 0.6 }, map, [{ id: 'RjLthowcJvQPP6zSyeEN', value: '0.6' }]).ok, true);
});

Deno.test('verifyWrittenFields: field dropped by GHL is flagged (the silent-failure case)', () => {
  const map = { qai_assessment_tier: 'CgO6Jzy2o6uIizRGNiol' };
  const r = verifyWrittenFields({ qai_assessment_tier: 'manual' }, map, []);
  assertEquals(r.ok, false);
  assertEquals(r.missing.length, 1);
});

for (const c of CLASSIFY_CASES) {
  Deno.test(`classifyGhlError ${c.status} → ${c.expect}`, () => {
    assertEquals(classifyGhlError(c.status), c.expect);
  });
}
