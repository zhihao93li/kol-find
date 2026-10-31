import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApifyRunner, type ActorKey, type ActorRunner, type Item } from "../src/discovery/apify.js";
import { DEFAULT_PARAMS } from "../src/discovery/run.js";
import type { DomainCheck } from "../src/mailcheck.js";
import { checkJob, FileLedger, handleOf, params, search, toCsv, type SearchOpts } from "../src/search.js";

class FakeApify implements ActorRunner {
  calls: [ActorKey, Item][] = [];
  spent = 0.42;
  constructor(private items: Partial<Record<ActorKey, Item[]>>) {}
  async run(key: ActorKey, input: Item): Promise<Item[]> {
    this.calls.push([key, input]);
    return this.items[key] ?? [];
  }
}

/** Every domain takes mail, except ones named "dead". */
const okMail: DomainCheck = async (d) => (d.startsWith("dead") ? "no_mail_server" : "ok");

const base: SearchOpts = {
  platform: "instagram", keywords: [], seeds: [], handles: [], exclude: [], target: null,
  minFollowers: null, maxFollowers: null, chineseOnly: false, script: null, linkPages: false, youtubeHidden: false,
  country: DEFAULT_PARAMS.country, language: DEFAULT_PARAMS.language, budget: 2,
};

describe("kol-find", () => {
  it("returns people with emails, skips excluded handles before paying for them, counts what was filtered", async () => {
    const api = new FakeApify({
      ig_search: [
        { username: "mama_a", fullName: "A 媽", searchTerm: "親子" },
        { username: "Known_One", fullName: "已有", searchTerm: "親子" },
        { username: "tiny", fullName: "小號", searchTerm: "親子" },
      ],
      ig_email: [
        { username: "mama_a", public_email: "a@mama.tw", follower_count: 20000, is_business: true, biography: "合作 b@mama.tw" },
        { username: "tiny", public_email: "t@x.tw", follower_count: 300 },
      ],
    });
    const r = await search(api, { ...base, keywords: ["親子"], minFollowers: 1000, exclude: ["https://www.instagram.com/known_one/"] }, okMail);
    expect(api.calls.find(([k]) => k === "ig_email")![1].instagram_ids).toEqual(["mama_a", "tiny"]);
    expect(r.people).toEqual([expect.objectContaining({
      handle: "mama_a", email: "a@mama.tw", emailSource: "platform_field", otherEmails: ["b@mama.tw"], followers: 20000, foundBy: "search:親子",
    })]);
    expect(r).toMatchObject({ found: 1, withEmail: 1, filtered: { below_min_followers: 1 }, spentUsd: 0.42, costPerEmailUsd: 0.42 });
  });

  it("leads with an email whose domain takes mail, and marks emails several accounts share", async () => {
    const api = new FakeApify({
      ig_search: [{ username: "a" }, { username: "b" }, { username: "c" }],
      ig_email: [
        { username: "a", public_email: "a@dead.tw", biography: "或 a@live.tw" },
        { username: "b", public_email: "team@agency.tw" },
        { username: "c", public_email: "TEAM@agency.tw", biography: "only c@dead.tw too" },
      ],
    });
    const r = await search(api, { ...base, keywords: ["x"] }, okMail);
    expect(r.people.map((p) => [p.handle, p.email, p.emailCheck, p.otherEmails, p.sharedWith])).toEqual([
      ["a", "a@live.tw", "ok", ["a@dead.tw"], []],
      ["b", "team@agency.tw", "ok", [], ["c"]],
      ["c", "TEAM@agency.tw", "ok", ["c@dead.tw"], ["b"]],
    ]);
    expect(r).toMatchObject({ withEmail: 3, sharedEmails: 1, emailNoMailServer: undefined, costPerEmailUsd: 0.14 });
  });

  it("shares a target over keywords and seeds, and refuses what can't run", () => {
    expect(params({ ...base, keywords: ["a", "b"], seeds: ["c"], target: 90 })).toMatchObject({ perKeyword: 30, perSeed: 30, maxSpend: 2 });
    expect(() => params(base)).toThrow("至少给一种找法");
    expect(() => params({ ...base, platform: "tiktok", seeds: ["x"] })).toThrow("只有 Instagram");
    expect(() => params({ ...base, platform: "x" as any, keywords: ["a"] })).toThrow("--platform");
    expect(() => params({ ...base, keywords: ["a"], budget: 0 })).toThrow("--budget");
  });

  it("reads handles from links and @names", () => {
    expect(["@Mama_A", "https://www.tiktok.com/@abc.def?lang=zh", "https://www.youtube.com/@Chan", "https://shop.tw/x"].map(handleOf))
      .toEqual(["mama_a", "abc.def", "chan", ""]);
    expect(["https://www.youtube.com/channel/UCabc-12_x", "https://youtube.com/c/OldName/videos", "youtube.com/user/Legacy"].map(handleOf))
      .toEqual(["channel/ucabc-12_x", "oldname", "legacy"]);
    expect(["https://www.youtube.com/@%E6%87%B6%E6%95%A3%E6%97%A5%E8%A8%98", "https://www.youtube.com/@โรงละครช้าง",
      "[https://www.instagram.com/yo790707/](https://www.instagram.com/yo790707/)", "https://www.youtube.com/@"].map(handleOf))
      .toEqual(["懶散日記", "โรงละครช้าง", "yo790707", ""]);
  });

  it("skips YouTube channels excluded by their /channel/ link, and reports exclude entries it can't read", async () => {
    const api = new FakeApify({
      yt_search: [
        { channel: { handle: "@keep", url: "https://www.youtube.com/@keep", title: "K", description: "k@k.tw" } },
        { channel: { handle: "@gone", url: "https://www.youtube.com/channel/UCgone1", title: "G", description: "g@g.tw" } },
      ],
    });
    const r = await search(api, { ...base, platform: "youtube", keywords: ["x"],
      exclude: ["https://www.youtube.com/channel/UCgone1", "https://shop.tw/x"] }, okMail);
    expect(r.people.map((p) => p.handle)).toEqual(["@keep"]);
    expect(r.excludeUnread).toEqual({ count: 1, examples: ["https://shop.tw/x"] });
  });

  it("refuses to resume a job with different search settings, but lets the budget change", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kolfind-")), "job");
    const p = params({ ...base, keywords: ["親子"] });
    checkJob(dir, p, false);
    checkJob(dir, { ...p, keywords: ["別的"] }, false); // a dry run saves nothing
    checkJob(dir, p, true);
    checkJob(dir, { ...p, maxSpend: 9 }, true);
    expect(() => checkJob(dir, { ...p, keywords: ["育兒"], minFollowers: 1000 }, false)).toThrow("变了：keywords、minFollowers");
  });

  it("writes CSV that quotes commas and newlines", () => {
    const csv = toCsv([{ platform: "instagram", handle: "a", name: "A, B", url: "u", followers: null, isBusiness: true, email: "a@b.tw",
      emailSource: "bio", emailCheck: "ok", sharedWith: ["x", "y"], otherEmails: ["c@d.tw", "e@f.tw"], postsCount: 120, lastPostAt: "2026-10-01T08:00:00.000Z", avgLikes: 300, avgComments: 12, avgViews: null,
      engagementRate: 0.0312, externalUrl: "", bio: "第一行\n第二行", script: "traditional", foundBy: "input" }]);
    expect(csv.startsWith("﻿平台,账号,名称")).toBe(true);
    expect(csv).toContain('instagram,a,"A, B",u,,a@b.tw,"c@d.tw, e@f.tw",bio,ok,"x, y",是,120,2026-10-01,300,12,,3.12%,,繁体,input,"第一行\n第二行"');
  });

  it("remembers Apify runs on disk for a re-run of the same job", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kolfind-")), "job");
    await new FileLedger(dir).started("ig_search", "actor", { runId: "r1", datasetId: "d1" });
    expect(await new FileLedger(dir).find("ig_search")).toEqual({ runId: "r1", datasetId: "d1" });
  });

  it("starts a failed step again on a re-run, and keeps a run that stopped with results", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kolfind-")), "job");
    const runs: { status: string; items: Item[] }[] = [
      { status: "FAILED", items: [] },
      { status: "SUCCEEDED", items: [{ username: "a" }] },
      { status: "ABORTED", items: [{ username: "b" }] },
    ];
    let started = 0;
    const client = {
      actor: () => ({ start: async () => ({ id: String(started), defaultDatasetId: String(started++) }) }),
      run: (id: string) => ({ waitForFinish: async () => ({ status: runs[Number(id)].status }) }),
      dataset: (id: string) => ({ listItems: async () => ({ items: runs[Number(id)].items }) }),
    };
    const rerun = () => Object.assign(new ApifyRunner("token", 2, new FileLedger(dir)), { client });

    await expect(rerun().run("ig_search", {}, 1)).rejects.toThrow("运行失败");
    expect(await rerun().run("ig_search", {}, 1)).toEqual([{ username: "a" }]);
    expect(await rerun().run("ig_search", {}, 1)).toEqual([{ username: "a" }]);
    expect(started).toBe(2);

    expect(await rerun().run("ig_email", {}, 1)).toEqual([{ username: "b" }]);
    expect(await rerun().run("ig_email", {}, 1)).toEqual([{ username: "b" }]);
    expect(started).toBe(3);
  });
});
