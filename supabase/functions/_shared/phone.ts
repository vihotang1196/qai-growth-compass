/**
 * 号码归一化 —— Edge Function 侧的入口。
 *
 * 【这不是拷贝,是 re-export。】实现只有一份:src/lib/phone.ts。
 * webhook 入库与登录查询必须走同一个函数,否则号码存进去和查出来对不上,
 * 而两边代码看起来都对 —— 那种 bug 极难查,所以从源头上不给它存在的机会。
 *
 * Deno 需要显式的 .ts 扩展名;Vite 那边由 tsconfig 的
 * allowImportingTsExtensions 允许同样的写法,所以一行能同时满足两个运行时。
 *
 * libphonenumber-js 的版本由 ../deno.json 的 import map 锁定,
 * 与 package.json 由 `npm run check:dep-sync` 强制一致。
 */
export {
  normalizeEmail,
  normalizePhone,
  phoneTail,
  tailFromInput,
} from '../../../src/lib/phone.ts';
