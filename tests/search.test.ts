import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorKey, ActorRunner, Item } from "../src/discovery/apify.js";
import { DEFAULT_PARAMS } from "../src/discovery/run.js";
import { FileLedger, handleOf, params, search, toCsv, type SearchOpts } from "../src/search.js";

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
