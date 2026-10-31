import { ACTORS, BudgetExceeded, chargeCap, estimate, type ActorKey, type ActorRunner } from "./apify.js";
import { keep, prefilter, type FilterOptions } from "./filters.js";
import { channelKey, Creator, normalizeHandle, type Platform } from "./models.js";
import * as pipeline from "./pipeline.js";

export interface DiscoveryParams extends FilterOptions {
  platform: Platform;
  keywords: string[];
  seeds: string[]; // Instagram only: accounts to expand via similar accounts
  handles: string[]; // look these up directly
  perSeed: number;
  perKeyword: number;
  linkPages: boolean; // crawl link-in-bio pages for creators still missing an email
  youtubeHidden: boolean; // YouTube hidden business email, ~$0.12 per email found
  country: string; // YouTube search country
  language: string; // YouTube page language
  maxSpend: number; // USD; stop starting new actor runs past this
}

export const DEFAULT_PARAMS: Omit<DiscoveryParams, "platform"> = {
  keywords: [], seeds: [], handles: [], perSeed: 150, perKeyword: 50,
  minFollowers: null, maxFollowers: null, chineseOnly: false, script: null,
  linkPages: true, youtubeHidden: false, country: "TW", language: "zh", maxSpend: 10,
};

export type ResultStatus = "has_email" | "no_email" | `filtered:${string}`;

export interface DiscoveryResult {
  creators: { creator: Creator; status: ResultStatus }[];
  /** Set when the budget ran out part way; what was found so far is still returned. */
  stoppedEarly: string;
}

/**
 * Run discovery and email lookup for one platform. `skip` holds handles (or YouTube channelKey()s) not worth paying to look up
 * again (the caller already has them); they are dropped before any lookup step.
 */
export async function discover(api: ActorRunner, p: DiscoveryParams, skip: Set<string> = new Set()): Promise<DiscoveryResult> {
  const given = p.handles.filter(Boolean).map((h) => new Creator(p.platform, h, { discoveredBy: "input" }));
  const skipped = (c: Creator) => skip.has(normalizeHandle(c.handle)) || skip.has(channelKey(c.profileUrl));
  const drop = (cs: Creator[]) => pipeline.dedupe(cs).filter((c) => !skipped(c));
  const kept = (cs: Creator[]) => cs.filter((c) => keep(c, p)[0]);
  // Before an account's own lookup, drop who the search results already rule out (out of the follower
  // range, private), so their lookups aren't paid for. They still come back as filtered.
  const worth = (cs: Creator[]) => cs.filter((c) => prefilter(c, p));

  const found = new Map<string, Creator>();
  let creators: Creator[] = [];
  let stoppedEarly = "";
  try {
    if (p.platform === "instagram") {
      creators = drop([...given, ...(await pipeline.igDiscover(api, p.seeds, p.keywords, p.perSeed, p.perKeyword, found))]);
      await pipeline.igLookup(api, worth(creators));
      if (p.linkPages) await pipeline.linkPagesLookup(api, kept(creators));
    } else if (p.platform === "youtube") {
      creators = drop([...given, ...(await pipeline.ytDiscover(api, p.keywords, p.perKeyword, p.minFollowers ?? null,
                                                                p.maxFollowers ?? null, p.country, p.language))]);
      await pipeline.ytLookup(api, worth(creators));
      if (p.linkPages) await pipeline.linkPagesLookup(api, kept(creators));
      if (p.youtubeHidden) await pipeline.ytHiddenLookup(api, kept(creators));
    } else {
      creators = drop([...given, ...(await pipeline.ttDiscover(api, p.keywords, p.perKeyword))]);
      await pipeline.ttLookup(api, worth(creators));
      if (p.linkPages) await pipeline.linkPagesLookup(api, kept(creators));
    }
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    stoppedEarly = err.message;
    // Stopped during the searches: the accounts given and those already paid for still come back.
    if (!creators.length) creators = drop([...given, ...found.values()]);
  }

  const results = creators.map((creator) => {
    const [ok, reason] = keep(creator, p);
    const status: ResultStatus = !ok ? `filtered:${reason}` : creator.email ? "has_email" : "no_email";
    return { creator, status };
  });
  return { creators: results, stoppedEarly };
}

export interface PlannedStep {
  step: ActorKey;
  actor: string;
  /** At most this many accounts go through the step. */
  accounts: number;
  /** USD for that many, from the price table. */
  costUsd: number;
  /** "ok"; "cut": the budget left covers only part of it; "not_started": too little left to start it. */
  budget: "ok" | "cut" | "not_started";
}

/**
 * What discover() would at most pay for, step by step in the same order, before anything runs. Each step is
 * counted as if every account found so far went through it; really fewer do (handles skipped, people filtered
 * out, emails found by an earlier step), so the total is a ceiling. The budget is walked the way ApifyRunner
 * spends it, so a step the budget won't reach shows up here.
 */
export function plan(p: DiscoveryParams): { maxAccounts: number; steps: PlannedStep[]; maxCostUsd: number } {
  const found = p.handles.length + p.keywords.length * p.perKeyword + p.seeds.length * p.perSeed;
  const searched = (key: ActorKey, n: number): [ActorKey, number][] => (n ? [[key, n]] : []);
  // Accounts from a search already have their profile; only the ones given by handle need one looked up.
  const byHandle = p.handles.length;
  const order: [ActorKey, number][] =
    p.platform === "instagram"
      ? [...searched("ig_related", p.seeds.length * p.perSeed), ...searched("ig_search", p.keywords.length * p.perKeyword),
         ["ig_email", found], ...(p.linkPages ? [["link_pages", found] as [ActorKey, number]] : [])]
      : p.platform === "youtube"
      ? [...searched("yt_search", p.keywords.length * p.perKeyword), ...searched("yt_profile", byHandle),
         ...(p.linkPages ? [["link_pages", found] as [ActorKey, number]] : []),
         ...(p.youtubeHidden ? [["yt_hidden", found] as [ActorKey, number]] : [])]
      : [...searched("tt_search", p.keywords.length * p.perKeyword), ...searched("tt_profile", byHandle),
         ...(p.linkPages ? [["link_pages", found] as [ActorKey, number]] : [])];
  let spent = 0;
  const steps = order.filter(([, n]) => n > 0).map(([step, accounts]): PlannedStep => {
    const costUsd = estimate(step, step === "tt_profile" ? accounts * pipeline.TT_POSTS_PER_PROFILE : accounts);
    const left = p.maxSpend - spent;
    const cap = chargeCap(costUsd, left);
    const budget = cap == null ? "not_started" : cap < costUsd ? "cut" : "ok";
    spent += cap == null ? 0 : Math.min(costUsd, cap);
    return { step, actor: ACTORS[step].id, accounts, costUsd: round(costUsd), budget };
  });
  return { maxAccounts: found, steps, maxCostUsd: round(steps.reduce((sum, s) => sum + s.costUsd, 0)) };
}

function round(usd: number): number {
  return Math.round(usd * 100) / 100;
}
