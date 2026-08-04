/**
 * 缺失环境变量的报告。
 *
 * 【为什么不是 readEnv(['A','B']) 那种写法】上一版是那样的,而它让刚做好的
 * `check:env` 瞎了三个变量 —— 那个守卫扫的是 `Deno.env.get('字面量')`,
 * 而名字被包进数组参数之后,静态扫描看不见。
 *
 * 修法不是让守卫去认 `readEnv([...])` —— 那是让守卫追代码的写法,
 * 下次有人写出第四种读法它又瞎了。修法是让读取点回到语言原生写法:
 *
 *   const env = {
 *     SESSION_SECRET: Deno.env.get('SESSION_SECRET'),
 *     APP_BASE_URL:   Deno.env.get('APP_BASE_URL'),
 *   };
 *   const missing = missingKeys(env);
 *
 * 每个变量名仍然以字面量形式出现在 `Deno.env.get()` 里,守卫看得见;
 * 而 `missing` 从对象的键推导,所以日志里仍然只列真正缺的那些。
 * 名字在同一行出现两次是有意的代价 —— 写歪了肉眼就能看出来。
 */
export function missingKeys(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}
