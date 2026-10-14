/**
 * config 的版本与指纹(PROGRESS ⑩)。
 *
 *   npm run config:fingerprint                 # 当前 config 的版本、指纹,以及它在登记表里的状态
 *   npm run config:fingerprint -- --register   # 把当前版本登记进 src/config/config-fingerprints.json
 *   npm run config:fingerprint -- --history    # git 历史里每一版 config:日期、提交、版本、指纹
 *
 * 【登记的规则】一个版本只对应一个指纹。当前版本已经登记了另一个指纹 = config 改了而版本没升 →
 * 拒绝登记,要先升 `meta.version`。不覆盖已有的登记:那等于让两份不同的 config 共用一个版本号。
 *
 * 【--history 用来做什么】库里一行结果的 `config_sha256` → 在这里找到同一个指纹 → 那一版 config 的提交。
 * 指纹按**那一版文件自己的内容**算(与出分函数同一个函数),所以和库里写的可以直接比。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFingerprint } from '../src/lib/configFingerprint.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'src/config/assessment-config.json';
const REGISTRY = join(ROOT, 'src/config/config-fingerprints.json');

const readRegistry = (): Record<string, string> => JSON.parse(readFileSync(REGISTRY, 'utf8'));

async function current(): Promise<void> {
  const config = JSON.parse(readFileSync(join(ROOT, CONFIG), 'utf8'));
  const version: string = config.meta.version;
  const fp = await configFingerprint(config);
  const reg = readRegistry();
  console.log(`config ${version}  指纹 ${fp}`);
  if (reg[version] === fp) console.log('登记表:已登记,一致');
  else if (reg[version]) console.log(`登记表:${version} 登记的是 ${reg[version]} —— config 改了而版本没升,先升 meta.version 再 --register`);
  else console.log(`登记表:${version} 还没登记 —— npm run config:fingerprint -- --register`);
}

async function register(): Promise<void> {
  const config = JSON.parse(readFileSync(join(ROOT, CONFIG), 'utf8'));
  const version: string = config.meta.version;
  const fp = await configFingerprint(config);
  const reg = readRegistry();
  if (reg[version] === fp) {
    console.log(`${version} 已登记,一致,不用改`);
    return;
  }
  if (reg[version]) {
    console.error(`拒绝:${version} 已经登记了另一个指纹(${reg[version]})。config 改了就升 meta.version,不要改已有的登记`);
    process.exit(1);
  }
  const other = Object.entries(reg).find(([, v]) => v === fp);
  if (other) {
    console.error(`拒绝:同一个指纹已经登记在 ${other[0]} 下 —— 内容没变却升了版本号?`);
    process.exit(1);
  }
  writeFileSync(REGISTRY, JSON.stringify({ ...reg, [version]: fp }, null, 2) + '\n');
  console.log(`已登记 ${version} → ${fp}`);
}

async function history(): Promise<void> {
  const log = execFileSync('git', ['log', '--format=%H%x09%cs%x09%s', '--', CONFIG], { cwd: ROOT, encoding: 'utf8' });
  console.log('日期        提交     版本     指纹(前 16 位)    提交说明');
  for (const line of log.trim().split('\n')) {
    const [hash, date, subject] = line.split('\t');
    let version = '?';
    let fp = '(读不出)';
    try {
      const config = JSON.parse(execFileSync('git', ['show', `${hash}:${CONFIG}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
      version = config?.meta?.version ?? '(无)';
      fp = (await configFingerprint(config)).slice(0, 16);
    } catch {
      // 那一版文件不是合法 JSON(早期草稿)—— 照列出来,不中断
    }
    console.log(`${date}  ${hash.slice(0, 7)}  ${version.padEnd(7)}  ${fp.padEnd(16)}  ${subject}`);
  }
}

const arg = process.argv[2];
if (arg === undefined) await current();
else if (arg === '--register') await register();
else if (arg === '--history') await history();
else {
  console.error(`不认识的参数 ${JSON.stringify(arg)}。用法见文件头`);
  process.exit(1);
}
