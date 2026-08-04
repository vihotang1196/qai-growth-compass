/**
 * 环境变量读取 + 缺失报告。
 *
 * 【为什么要这个小工具】原来的写法是:
 *
 *   if (!a || !b || !c) console.error('missing A / B / C')
 *
 * 三个变量一起列,不指明缺的是哪个。实际排查时(Stage 4 端到端)这条日志出现了两次,
 * 两次都得靠人逐个去 `supabase secrets list` 里比对 —— 而信息本来就在函数手上。
 *
 * 用这个函数之后,日志里只出现真正缺的那些名字。
 */
export interface EnvResult<K extends string> {
  values: Record<K, string>;
  missing: K[];
}

export function readEnv<K extends string>(names: readonly K[]): EnvResult<K> {
  const values = {} as Record<K, string>;
  const missing: K[] = [];
  for (const name of names) {
    const v = Deno.env.get(name);
    if (v) values[name] = v;
    else missing.push(name);
  }
  return { values, missing };
}
