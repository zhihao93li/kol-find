import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ApifyRunner } from "./discovery/apify.js";
import { DEFAULT_PARAMS } from "./discovery/run.js";
import { readExclude } from "./exclude.js";
import type { Platform } from "./discovery/models.js";
import { apifyToken, checkJob, FileLedger, jobDir, params, search, toCsv, unreadable, type SearchOpts } from "./search.js";

const HELP = `kol-find search --platform instagram|youtube|tiktok [找法] [条件] [--budget 美元] [--job 名字] [--dry-run]

  在 Instagram、YouTube、TikTok 上找人和公开邮箱（用 Apify，花钱），只返回名单，不写任何库。

  找法（至少一种）：
    --keywords a,b          关键词搜账号
    --seeds a,b             Instagram：这些账号的相似账号
    --handles a,b           直接查这些账号的邮箱
  条件：
    --target N              大约搜多少个账号，平分给各关键词和相似账号（不给就每个关键词 ${DEFAULT_PARAMS.perKeyword}、每个相似账号 ${DEFAULT_PARAMS.perSeed}）
    --min-followers N --max-followers N
    --chinese-only          只要名称或简介里有中文（且没有日文假名）的
    --exclude a,b           跳过这些账号（账号或主页链接），不再花钱查
    --exclude-file 文件      同上，从文件读：一行一个的名单、任何表格导出的 CSV / TSV、或 JSON 都行；
                            每一格里的 @账号 和平台主页链接都会被认出来，其他列不管
    --youtube-hidden        YouTube：前面都没查到邮箱的，再查隐藏商务邮箱（找到一个约 12 美分）
    --no-link-pages         不跟简介外链找邮箱
    --country TW --language zh
                            YouTube 搜索偏向的国家和语言（默认 ${DEFAULT_PARAMS.country} / ${DEFAULT_PARAMS.language}，给空字符串就不偏）
  --budget 美元             花费上限，到了就停，已找到的照样返回（默认 2）
  --job 名字                这次的名字；中途断了用同一个名字重跑，已完成的 Apify 步骤不再花钱
  --dry-run                 只检查参数，不花钱

  结果在 ~/.kol-find/jobs/<名字>/：people.json（完整名单）和 people.csv。
  Apify token：环境变量 APIFY_TOKEN，或 ~/.kol-find/apify-token。`;

function list(v: unknown): string[] {
  return typeof v === "string" ? v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
}

function num(v: unknown): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`不是数字：${v}`);
  return n;
}

function excludeFile(file: string): string[] {
  if (!existsSync(file)) throw new Error(`找不到 --exclude-file：${file}`);
  const bytes = readFileSync(file);
  // .xlsx and .numbers files are zip archives.
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new Error("--exclude-file 读不了 Excel / Numbers 文件，请先导出成 CSV");
  }
  return readExclude(bytes.toString("utf8"));
}

async function main(argv: string[]) {
  const { values: v, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      platform: { type: "string" }, keywords: { type: "string" }, seeds: { type: "string" }, handles: { type: "string" },
      target: { type: "string" }, "min-followers": { type: "string" }, "max-followers": { type: "string" },
      "chinese-only": { type: "boolean" }, exclude: { type: "string" }, "exclude-file": { type: "string" },
      "youtube-hidden": { type: "boolean" }, "no-link-pages": { type: "boolean" },
      country: { type: "string" }, language: { type: "string" }, budget: { type: "string" }, job: { type: "string" },
      "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
  if (v.help || positionals[0] !== "search") {
    console.log(HELP);
    return;
  }
  const o: SearchOpts = {
    platform: v.platform as Platform, keywords: list(v.keywords), seeds: list(v.seeds), handles: list(v.handles),
    exclude: [...list(v.exclude), ...(v["exclude-file"] ? excludeFile(v["exclude-file"]) : [])],
    target: num(v.target), minFollowers: num(v["min-followers"]), maxFollowers: num(v["max-followers"]),
    chineseOnly: !!v["chinese-only"], linkPages: !v["no-link-pages"], youtubeHidden: !!v["youtube-hidden"],
    country: v.country ?? DEFAULT_PARAMS.country, language: v.language ?? DEFAULT_PARAMS.language, budget: num(v.budget) ?? 2,
  };
  const p = params(o);
  const job = v.job || `${o.platform}-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}`;
  const dir = jobDir(job);
  checkJob(dir, p, !v["dry-run"]);
  if (v["dry-run"]) {
    const { maxSpend, ...rest } = p;
    console.log(JSON.stringify({ 试跑: true, job, 参数: rest, 跳过账号: o.exclude.length,
      认不出的跳过项: unreadable(o.exclude),
      说明: `正式运行最多花 $${maxSpend}，到上限就停，已找到的照样返回；结果写到 ${dir}` }, null, 2));
    return;
  }
  const runner = new ApifyRunner(apifyToken(), o.budget, new FileLedger(dir));
  const { people, ...summary } = await search(runner, o);
  writeFileSync(join(dir, "people.json"), JSON.stringify(people, null, 2));
  writeFileSync(join(dir, "people.csv"), toCsv(people));
  console.log(JSON.stringify({ job, ...summary, 名单: join(dir, "people.json"), csv: join(dir, "people.csv") }, null, 2));
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
