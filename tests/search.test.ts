import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorKey, ActorRunner, Item } from "../src/discovery/apify.js";
import { DEFAULT_PARAMS } from "../src/discovery/run.js";
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

const base: SearchOpts = {
  platform: "instagram", keywords: [], seeds: [], handles: [], exclude: [], target: null,
  minFollowers: null, maxFollowers: null, chineseOnly: false, linkPages: false, youtubeHidden: false,
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
    const r = await search(api, { ...base, keywords: ["親子"], minFollowers: 1000, exclude: ["https://www.instagram.com/known_one/"] });
    expect(api.calls.find(([k]) => k === "ig_email")![1].instagram_ids).toEqual(["mama_a", "tiny"]);
    expect(r.people).toEqual([expect.objectContaining({
      handle: "mama_a", email: "a@mama.tw", emailSource: "platform_field", otherEmails: ["b@mama.tw"], followers: 20000, foundBy: "search:親子",
    })]);
    expect(r).toMatchObject({ found: 1, withEmail: 1, filtered: { below_min_followers: 1 }, spentUsd: 0.42 });
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
      exclude: ["https://www.youtube.com/channel/UCgone1", "https://shop.tw/x"] });
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
      emailSource: "bio", otherEmails: ["c@d.tw", "e@f.tw"], externalUrl: "", bio: "第一行\n第二行", foundBy: "input" }]);
    expect(csv.startsWith("﻿平台,账号,名称")).toBe(true);
    expect(csv).toContain('instagram,a,"A, B",u,,a@b.tw,"c@d.tw, e@f.tw",bio,是,,input,"第一行\n第二行"');
  });

  it("remembers Apify runs on disk for a re-run of the same job", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kolfind-")), "job");
    await new FileLedger(dir).started("ig_search", "actor", { runId: "r1", datasetId: "d1" });
    expect(await new FileLedger(dir).find("ig_search")).toEqual({ runId: "r1", datasetId: "d1" });
  });
});
