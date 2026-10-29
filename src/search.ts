/**
 * kol-find: find creators and their public emails with the Apify actors in src/discovery, and hand back the list.
 * No database: what to skip comes in as `exclude`, what was found goes out as JSON and CSV for the caller to use.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ActorRunner, RunLedger, RunRecord } from "./discovery/apify.js";
import { channelKey, normalizeHandle, PLATFORMS, type EmailSource, type Platform } from "./discovery/models.js";
import { DEFAULT_PARAMS, discover, type DiscoveryParams } from "./discovery/run.js";

export interface SearchOpts {
  platform: Platform;
  keywords: string[];
  /** Instagram: accounts whose similar accounts to collect. */
  seeds: string[];
  /** Look these accounts up directly (just their emails). */
  handles: string[];
  /** Handles or profile links not worth paying to look up again. */
  exclude: string[];
  /** About how many accounts to search in all, shared out over the keywords and seed accounts. */
  target: number | null;
  minFollowers: number | null;
  maxFollowers: number | null;
  chineseOnly: boolean;
  linkPages: boolean;
  youtubeHidden: boolean;
  /** YouTube search hints; empty means no bias. */
  country: string;
  language: string;
  /** USD; stops starting new actor runs past this. */
  budget: number;
}

export interface Person {
  platform: Platform;
  handle: string;
  name: string;
  url: string;
  followers: number | null;
  isBusiness: boolean | null;
  email: string;
  emailSource: EmailSource | "";
  otherEmails: string[];
  externalUrl: string;
  bio: string;
  /** How it was found, e.g. "related", "search:親子", "input". */
  foundBy: string;
}

export function home(): string {
  return process.env.KOL_FIND_HOME || join(homedir(), ".kol-find");
}

export function jobDir(job: string): string {
  return join(home(), "jobs", job.replace(/[^\w一-鿿-]/g, "_"));
}

/**
 * The ledger finds runs by step name only, so a job re-run with other search settings would quietly read the
 * old results. Each job keeps the settings it first ran with, and a re-run with different ones is refused.
 * The budget may change between runs (raising it is how a job that stopped early carries on).
 */
export function checkJob(dir: string, p: DiscoveryParams, save: boolean): void {
  const { maxSpend: _, ...settings } = p;
  const file = join(dir, "job.json");
  if (existsSync(file)) {
    const before: Record<string, unknown> = JSON.parse(readFileSync(file, "utf8"));
    const changed = Object.keys({ ...before, ...settings })
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify((settings as Record<string, unknown>)[k]));
    if (changed.length) {
      throw new Error(`这个 --job 之前用别的条件跑过（变了：${changed.join("、")}），续跑会拿回上次的结果。换一个 --job 名字，或者用原来的条件续跑`);
    }
    return;
  }
  if (!save) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
}

/** Remembers each Apify run of a job on disk, so re-running the same job reads finished runs instead of paying again. */
export class FileLedger implements RunLedger {
  private file: string;
  private data: Record<string, RunRecord & { status?: string }>;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "apify-runs.json");
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {};
  }
  async find(step: string) {
    return this.data[step] ?? null;
  }
  async started(step: string, _actor: string, run: RunRecord) {
    this.data[step] = run;
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
  async finished(step: string, r: { status: string }) {
    this.data[step] = { ...this.data[step], status: r.status };
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

/** APIFY_TOKEN, else ~/.kol-find/apify-token. */
export function apifyToken(): string {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
  const file = join(home(), "apify-token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  throw new Error(`没有 Apify token。把 token 存进 ${file}（只放在这台电脑上），或设置环境变量 APIFY_TOKEN`);
}

/**
 * "@name", "name" or a profile link → the bare lowercase handle; "" when it can't be read.
 * YouTube's older links: /channel/<id> becomes the key discover() also reads off a found channel's link,
 * and /c/<name> or /user/<name> is taken as the handle, which YouTube made the same for most of them.
 */
export function handleOf(s: string): string {
  s = s.trim();
  const yt = s.match(/youtube\.com\/(channel|c|user)\/([^/?#\s\])]+)/i);
  if (yt) return yt[1].toLowerCase() === "channel" ? channelKey(s) : normalizeHandle(decoded(yt[2]));
  // YouTube handles can be Chinese, Thai and so on, raw or percent-encoded in the link.
  const m = s.match(/(?:instagram\.com|tiktok\.com|youtube\.com)\/@?([^/?#\s\])]+)/i);
  return normalizeHandle(m ? decoded(m[1]) : /[/\s]/.test(s) ? "" : s);
}

function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Exclude entries that aren't a handle or profile link: how many, with a few to show. */
export function unreadable(exclude: string[]) {
  const bad = exclude.filter((s) => !handleOf(s));
  return bad.length ? { count: bad.length, examples: bad.slice(0, 5) } : undefined;
}

export function params(o: SearchOpts): DiscoveryParams {
  if (!PLATFORMS.includes(o.platform)) throw new Error(`--platform 只能是 ${PLATFORMS.join("、")}`);
  if (!o.keywords.length && !o.seeds.length && !o.handles.length) throw new Error("至少给一种找法：--keywords、--seeds 或 --handles");
  if (o.seeds.length && o.platform !== "instagram") throw new Error("--seeds（相似账号）只有 Instagram 能用");
  if (!(o.budget > 0)) throw new Error("--budget 要大于 0（美元）");
  // A target is shared out evenly: each keyword and each seed account brings in about the same number of accounts.
  const sources = o.keywords.length + o.seeds.length;
  const per = o.target && sources ? Math.max(10, Math.ceil(o.target / sources)) : null;
  return {
    ...DEFAULT_PARAMS, platform: o.platform, keywords: o.keywords, seeds: o.seeds, handles: o.handles,
    ...(per ? { perKeyword: per, perSeed: per } : {}),
    minFollowers: o.minFollowers, maxFollowers: o.maxFollowers, chineseOnly: o.chineseOnly,
    linkPages: o.linkPages, youtubeHidden: o.youtubeHidden, country: o.country, language: o.language, maxSpend: o.budget,
  };
}

export async function search(run: ActorRunner & { spent?: number }, o: SearchOpts) {
  const skip = new Set(o.exclude.map(handleOf).filter(Boolean));
  const result = await discover(run, params(o), skip);
  const people: Person[] = [];
  const filtered: Record<string, number> = {};
  for (const { creator: c, status } of result.creators) {
    if (status.startsWith("filtered:")) {
      const reason = status.slice("filtered:".length);
      filtered[reason] = (filtered[reason] ?? 0) + 1;
      continue;
    }
    people.push({
      platform: c.platform, handle: c.handle, name: c.name || c.handle, url: c.profileUrl, followers: c.followers,
      isBusiness: c.isBusiness, email: c.email, emailSource: c.emailSource, otherEmails: c.allEmails.slice(1),
      externalUrl: c.externalUrl, bio: c.bio, foundBy: c.discoveredBy,
    });
  }
  return {
    found: people.length,
    withEmail: people.filter((p) => p.email).length,
    filtered,
    spentUsd: Number((run.spent ?? 0).toFixed(2)),
    stoppedEarly: result.stoppedEarly || undefined,
    /** Nothing was skipped for these. */
    excludeUnread: unreadable(o.exclude),
    people,
  };
}

const COLUMNS: [string, (p: Person) => unknown][] = [
  ["平台", (p) => p.platform], ["账号", (p) => p.handle], ["名称", (p) => p.name], ["主页", (p) => p.url],
  ["粉丝数", (p) => p.followers ?? ""], ["邮箱", (p) => p.email], ["其他邮箱", (p) => p.otherEmails.join(", ")],
  ["邮箱来源", (p) => p.emailSource], ["商业号", (p) => (p.isBusiness == null ? "" : p.isBusiness ? "是" : "否")],
  ["外链", (p) => p.externalUrl], ["找到方式", (p) => p.foundBy], ["简介", (p) => p.bio],
];

/** CSV with a BOM, so Excel and Numbers read the Chinese right. */
export function toCsv(people: Person[]): string {
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [COLUMNS.map(([h]) => h).join(","), ...people.map((p) => COLUMNS.map(([, f]) => cell(f(p))).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
