import { assertEquals } from '@std/assert';
import { adminVerdict, normalizeAdminEmail } from './adminAuth.ts';

Deno.test('没有有效身份 → 401,前端该跳登录页', () => {
  assertEquals(adminVerdict({ jwtEmail: null, inAllowlist: false }), {
    ok: false,
    status: 401,
    reason: 'no valid session',
  });
  // JWT 无效时 inAllowlist 无意义,不能因为它是 true 就放行
  assertEquals(adminVerdict({ jwtEmail: null, inAllowlist: true }).ok, false);
  assertEquals(
    (adminVerdict({ jwtEmail: null, inAllowlist: true }) as { status: number }).status,
    401,
  );
});

Deno.test('身份有效但不在名单 → 403,不是 401', () => {
  const v = adminVerdict({ jwtEmail: 'someone@example.com', inAllowlist: false });
  assertEquals(v.ok, false);
  assertEquals((v as { status: number }).status, 403);
  // 合成一个状态码会让不在名单的人被无限弹回登录页:每次登录都成功、每次又被弹回。
  // 那种循环极难自查,所以这一条单独立
});

Deno.test('身份有效且在名单 → 放行,并带回邮箱', () => {
  assertEquals(adminVerdict({ jwtEmail: 'admin@example.com', inAllowlist: true }), {
    ok: true,
    email: 'admin@example.com',
  });
});

Deno.test('邮箱归一化:大小写与空白', () => {
  // Supabase Auth 返回的大小写取决于用户注册时怎么打,而 admin_users 是手动 insert 的。
  // 一边 Foo@Bar.com 一边 foo@bar.com 就会永远 403,而那看起来像「我明明插了记录」
  assertEquals(normalizeAdminEmail('  JiaNan1196@Gmail.COM '), 'jianan1196@gmail.com');
  assertEquals(normalizeAdminEmail('already@lower.com'), 'already@lower.com');
  assertEquals(normalizeAdminEmail('   '), null);
  assertEquals(normalizeAdminEmail(''), null);
  assertEquals(normalizeAdminEmail(null), null);
  assertEquals(normalizeAdminEmail(undefined), null);
});
