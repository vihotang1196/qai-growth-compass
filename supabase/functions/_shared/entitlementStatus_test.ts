import { assertEquals } from '@std/assert';
import {
  canAdvance,
  ENTITLEMENT_STATUS_ORDER,
  type EntitlementStatus,
  statusesBefore,
} from './entitlementStatus.ts';

Deno.test('statusesBefore 只给出严格更早的状态,不含自己', () => {
  assertEquals(statusesBefore('pending'), []);
  assertEquals(statusesBefore('link_sent'), ['pending']);
  assertEquals(statusesBefore('started'), ['pending', 'link_sent']);
  assertEquals(statusesBefore('completed'), ['pending', 'link_sent', 'started']);
});

Deno.test('completed 的人再登录不能被打回 started', () => {
  // assessment-auth 的既有约定。这条单独立,因为它是这套阶梯存在的理由
  assertEquals(canAdvance('completed', 'started'), false);
});

Deno.test('答完之后 started → completed 必须能推得动', () => {
  // 这条正是「Admin 名单永远显示 started」那个 bug 的直接断言
  assertEquals(canAdvance('started', 'completed'), true);
});

Deno.test('原地不动不算前进 —— 不重复盖 completed_at', () => {
  for (const s of ENTITLEMENT_STATUS_ORDER) {
    assertEquals(canAdvance(s, s), false, `${s} → ${s}`);
  }
});

Deno.test('阶梯上每一对的方向都对', () => {
  const order = ENTITLEMENT_STATUS_ORDER;
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      assertEquals(canAdvance(order[i], order[j]), i < j, `${order[i]} → ${order[j]}`);
    }
  }
});

Deno.test('认不出来的 current 一律不写 —— 数据已经坏了,猜方向更糟', () => {
  for (const bogus of ['', 'COMPLETED', 'expired', 'abandoned']) {
    assertEquals(canAdvance(bogus, 'completed'), false, bogus);
  }
});

Deno.test('阶梯与 migration 的 check 约束同一套值', () => {
  // 表上是 check (status in ('pending','link_sent','started','completed'))。
  // 两边任何一边改了值而另一边没改,这条会红
  assertEquals(
    [...ENTITLEMENT_STATUS_ORDER].sort(),
    (['completed', 'link_sent', 'pending', 'started'] as EntitlementStatus[]).sort(),
  );
});
