import { describe, expect, it } from "vitest";
import type { ActorKey, ActorRunner, Item } from "../src/discovery/apify.js";
import { BudgetExceeded, chargeCap } from "../src/discovery/apify.js";
import * as emails from "../src/discovery/emails.js";
import { keep, looksChinese, prefilter } from "../src/discovery/filters.js";
import { script } from "../src/discovery/script.js";
import { Creator } from "../src/discovery/models.js";
import * as pipeline from "../src/discovery/pipeline.js";
import { DEFAULT_PARAMS, discover, plan } from "../src/discovery/run.js";

/** Returns canned items per actor key instead of calling Apify. */
class FakeApify implements ActorRunner {
  calls: [ActorKey, Item][] = [];
  constructor(private items: Partial<Record<ActorKey, Item[]>>, private failOn?: ActorKey) {}
  async run(key: ActorKey, input: Item): Promise<Item[]> {
    if (key === this.failOn) throw new BudgetExceeded("budget used up");
    this.calls.push([key, input]);
    return this.items[key] ?? [];
  }
}

describe("emails", () => {
  it("extracts from a Chinese bio", () => {
    expect(emails.extract("合作📧teresalin51320@gmail.com\n生活日常帳：@Teresa")).toEqual(["teresalin51320@gmail.com"]);
  });
  it("handles full-width @ and dedupes", () => {
    expect(emails.extract("聯絡：abc＠gmail．com / ABC@gmail.com")).toEqual(["abc@gmail.com"]);
  });
  it("drops placeholders and images", () => {
    expect(emails.extract("example@mail.com logo@2x.png real@shan.art")).toEqual(["real@shan.art"]);
  });
  it("splits string and list fields", () => {
    expect(emails.splitField("a@b.co, c@d.tw")).toEqual(["a@b.co", "c@d.tw"]);
    expect(emails.splitField(["a@b.co", ""])).toEqual(["a@b.co"]);
    expect(emails.splitField(null)).toEqual([]);
  });
});

describe("pipeline", () => {
  it("prefers the Instagram public_email field", async () => {
    const api = new FakeApify({ ig_email: [
      { username: "silviali2014", public_email: "silvialiblogger@gmail.com", ExtractedEmails: "",
        is_business: true, follower_count: 12000, biography: "合作 other@gmail.com" },
      { username: "nobody", public_email: null, ExtractedEmails: "", biography: "私訊小盒子" },
    ] });
    const a = new Creator("instagram", "silviali2014");
    const b = new Creator("instagram", "nobody");
    await pipeline.igLookup(api, [a, b]);
    expect([a.email, a.emailSource]).toEqual(["silvialiblogger@gmail.com", "platform_field"]);
    expect(a.allEmails).toEqual(["silvialiblogger@gmail.com", "other@gmail.com"]);
    expect(a.followers).toBe(12000);
    expect(b.email).toBe("");
  });

  it("skips social links and shop pages when crawling link-in-bio", async () => {
    const api = new FakeApify({ link_pages: [
      { originalStartUrl: "https://portaly.cc/huto4869", emails: ["huto4869@gmail.com"] },
      { originalStartUrl: "https://example-shop.tw/", emails: ["cs@x.com", "info@x.com", "b@x.com"] },
    ] });
    const a = new Creator("instagram", "huto4869", { externalUrl: "https://portaly.cc/huto4869" });
    const b = new Creator("instagram", "shop", { externalUrl: "https://example-shop.tw/" });
    const c = new Creator("instagram", "fb", { externalUrl: "https://www.facebook.com/foo" });
    await pipeline.linkPagesLookup(api, [a, b, c]);
    const urls = api.calls[0][1].startUrls.map((u: Item) => u.url);
    expect(urls).not.toContain("https://www.facebook.com/foo");
    expect([a.email, a.emailSource]).toEqual(["huto4869@gmail.com", "link_page"]);
    expect(b.email).toBe("");
  });

  it("reads the YouTube description email and leaves out unset subscriber bounds", async () => {
    const api = new FakeApify({ yt_search: [{
      channel: { handle: "@greenphoto2010", url: "https://www.youtube.com/@greenphoto2010",
                 title: "綠攝", description: "合作信箱：greenphoto27270867@gmail.com" },
      metrics: { subscribers: null }, discoverySource: { value: "婚禮攝影" },
    }] });
    const [c] = await pipeline.ytDiscover(api, ["婚禮攝影"], 20, null, null, "TW", "zh");
    expect(c.email).toBe("greenphoto27270867@gmail.com");
    expect(api.calls[0][1]).not.toHaveProperty("minSubscribers");
  });

  it("looks up YouTube hidden emails only for channels still missing one", async () => {
    const api = new FakeApify({ yt_hidden: [{ Query: "@moneyweeklylife", Email: "x@gmail.com", Status: "EMAIL_AVAILABLE" }] });
    const has = new Creator("youtube", "@a");
    has.addEmail("a@a.com", "bio");
    const missing = new Creator("youtube", "moneyweeklylife");
    await pipeline.ytHiddenLookup(api, [has, missing]);
    expect(api.calls[0][1].channels).toEqual(["@moneyweeklylife"]);
    expect(missing.emailSource).toBe("youtube_hidden");
  });

  it("reads the TikTok bio email", async () => {
    const api = new FakeApify({ tt_search: [
      { name: "bobbypombo", fans: 2500000, signature: "📧  teambobbyp@underscoretalent.com", searchQuery: "x" },
      { searchQuery: "x" },
    ] });
    const [c] = await pipeline.ttDiscover(api, ["x"], 10);
    expect(c.email).toBe("teambobbyp@underscoretalent.com");
    expect(c.followers).toBe(2500000);
  });

  it("reads recent activity from Instagram search results", async () => {
    const api = new FakeApify({ ig_search: [{ username: "a", followersCount: 10000, postsCount: 120, latestPosts: [
      { timestamp: "2026-09-01T00:00:00.000Z", likesCount: 200, commentsCount: 10 },
      { timestamp: "2026-10-01T00:00:00.000Z", likesCount: 400, commentsCount: 30, videoViewCount: 9000 },
      { timestamp: "2026-08-01T00:00:00.000Z", likesCount: -1, commentsCount: 5 },
    ] }] });
    const [c] = await pipeline.igDiscover(api, [], ["x"], 0, 10);
    expect([c.postsCount, c.lastPostAt, c.avgLikes, c.avgComments, c.avgViews])
      .toEqual([120, "2026-10-01T00:00:00.000Z", 300, 15, 9000]);
  });

  it("reads YouTube lifetime views per video, and TikTok's latest videos leaving pinned ones out of averages", async () => {
    const yt = new FakeApify({ yt_search: [{ channel: { handle: "@a" }, metrics: { subscribers: 1000, videos: 40, totalViews: 200000 } }] });
    const [y] = await pipeline.ytDiscover(yt, ["x"], 10, null, null, "", "");
    expect([y.postsCount, y.avgViews]).toEqual([40, 5000]);

    const tt = new FakeApify({ tt_profile: [
      { authorMeta: { name: "t", fans: 5000, video: 80 }, createTimeISO: "2025-01-01T00:00:00.000Z", playCount: 900000, diggCount: 50000, isPinned: true },
      { authorMeta: { name: "t", fans: 5000, video: 80 }, createTimeISO: "2026-10-20T00:00:00.000Z", playCount: 3000, diggCount: 120, commentCount: 4 },
    ] });
    const t = new Creator("tiktok", "t");
    await pipeline.ttLookup(tt, [t]);
    expect([t.postsCount, t.lastPostAt, t.avgViews, t.avgLikes, t.avgComments]).toEqual([80, "2026-10-20T00:00:00.000Z", 3000, 120, 4]);
  });

  it("filters", () => {
    expect(looksChinese("親子日常")).toBe(true);
    expect(looksChinese("親子の遊び方")).toBe(false);
    expect(looksChinese("hello")).toBe(false);
    const c = new Creator("tiktok", "a", { followers: 500, bio: "新秘" });
    expect(keep(c, { minFollowers: 1000 })).toEqual([false, "below_min_followers"]);
    expect(keep(c, { chineseOnly: true })).toEqual([true, ""]);
    const unknown = new Creator("instagram", "u");
    expect(keep(unknown, { minFollowers: 1000 })).toEqual([false, "unknown_followers"]);
    expect(keep(unknown, {})).toEqual([true, ""]);
  });

  it("tells traditional from simplified, and keeps text that doesn't show which", () => {
    expect(script("親子日常｜兩個寶貝的媽媽")).toBe("traditional");
    expect(script("亲子日常｜两个宝贝的妈妈")).toBe("simplified");
    expect(script("日常分享")).toBe("");
    const opts = { script: "traditional" as const };
    expect(keep(new Creator("instagram", "s", { bio: "宝妈分享育儿" }), opts)).toEqual([false, "not_traditional"]);
    expect(keep(new Creator("instagram", "t", { bio: "寶媽分享育兒" }), opts)).toEqual([true, ""]);
    expect(keep(new Creator("instagram", "u", { bio: "日常分享" }), opts)).toEqual([true, ""]);
    expect(keep(new Creator("instagram", "e", { bio: "daily life" }), opts)).toEqual([false, "not_chinese"]);
    expect(prefilter(new Creator("instagram", "s", { bio: "宝妈分享" }), opts)).toBe(false);
    expect(prefilter(new Creator("instagram", "n", { name: "Amy" }), opts)).toBe(true);
  });

  it("prefilters only on what is already known", () => {
    expect(prefilter(new Creator("instagram", "big", { followers: 3_000_000 }), { maxFollowers: 200_000 })).toBe(false);
    expect(prefilter(new Creator("instagram", "p", { isPrivate: true }), {})).toBe(false);
    expect(prefilter(new Creator("instagram", "u"), { minFollowers: 5000, chineseOnly: true })).toBe(true);
    expect(prefilter(new Creator("instagram", "en", { bio: "hello" }), { chineseOnly: true })).toBe(false);
  });
});

describe("discover", () => {
  it("skips known handles and keeps what was found when the budget runs out", async () => {
    const api = new FakeApify({ ig_search: [
      { username: "keepme", searchTerm: "新秘" },
      { username: "known", searchTerm: "新秘" },
    ] }, "ig_email");
    const result = await discover(api, { ...DEFAULT_PARAMS, platform: "instagram", keywords: ["新秘"] }, new Set(["known"]));
    expect(result.stoppedEarly).toBe("budget used up");
    expect(result.creators.map((r) => [r.creator.handle, r.status])).toEqual([["keepme", "no_email"]]);
  });

  it("doesn't pay to look up accounts the search already shows are out of range, nor crawl links of unknowns", async () => {
    const api = new FakeApify({
      ig_search: [
        { username: "fits", followersCount: 20000, searchTerm: "x" },
        { username: "huge", followersCount: 3_000_000, searchTerm: "x", externalUrl: "https://huge.tw" },
        { username: "unknown", searchTerm: "x", externalUrl: "https://unknown.tw" },
      ],
      ig_email: [{ username: "fits", follower_count: 21000, external_url: "https://fits.tw" }],
      link_pages: [{ originalStartUrl: "https://fits.tw", emails: ["f@fits.tw"] }],
    });
    const result = await discover(api, { ...DEFAULT_PARAMS, platform: "instagram", keywords: ["x"], maxFollowers: 200_000 });
    expect(api.calls.find(([k]) => k === "ig_email")![1].instagram_ids).toEqual(["fits", "unknown"]);
    expect(api.calls.find(([k]) => k === "link_pages")![1].startUrls).toEqual([{ url: "https://fits.tw" }]);
    expect(result.creators.map((r) => [r.creator.handle, r.status])).toEqual([
      ["fits", "has_email"], ["huge", "filtered:above_max_followers"], ["unknown", "filtered:unknown_followers"],
    ]);
  });
});

describe("plan", () => {
  it("counts each step's ceiling in the order discover runs them", () => {
    const r = plan({ ...DEFAULT_PARAMS, platform: "instagram", keywords: ["a", "b"], perKeyword: 50, maxSpend: 3 });
    expect(r.steps.map((s) => [s.step, s.accounts, s.costUsd, s.budget])).toEqual([
      ["ig_search", 100, 0.26, "ok"], ["ig_email", 100, 0.49, "ok"], ["link_pages", 100, 1, "ok"],
    ]);
    expect([r.maxAccounts, r.maxCostUsd]).toEqual([100, 1.75]);
  });

  it("shows which step the budget cuts short or never starts", () => {
    const r = plan({ ...DEFAULT_PARAMS, platform: "instagram", keywords: ["a"], seeds: ["s1", "s2"], perKeyword: 150, perSeed: 150, maxSpend: 2 });
    expect(r.steps.map((s) => [s.step, s.budget])).toEqual([
      ["ig_related", "ok"], ["ig_search", "ok"], ["ig_email", "cut"], ["link_pages", "not_started"],
    ]);
  });

  it("only looks up profiles for YouTube and TikTok accounts given by handle", () => {
    const yt = plan({ ...DEFAULT_PARAMS, platform: "youtube", keywords: ["a"], handles: ["@x", "@y"], linkPages: false });
    expect(yt.steps.map((s) => [s.step, s.accounts])).toEqual([["yt_search", 50], ["yt_profile", 2]]);
    const tt = plan({ ...DEFAULT_PARAMS, platform: "tiktok", handles: ["x"], linkPages: false });
    expect(tt.steps.map((s) => s.step)).toEqual(["tt_profile"]);
  });
});

it("never asks Apify for a charge cap below its $0.50 minimum, nor above what's left", () => {
  expect(chargeCap(0.13, 1)).toBe(0.5);
  expect(chargeCap(1, 5)).toBe(1.35);
  expect(chargeCap(1, 0.8)).toBe(0.8);
  expect(chargeCap(0.1, 0.4)).toBeNull();
});
