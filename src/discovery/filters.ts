import type { Creator } from "./models.js";
import { script, type Script } from "./script.js";

const HAN_RE = /[一-鿿]/;
const KANA_RE = /[぀-ヿ]/;

/** Han characters and no Japanese kana: drops the Japanese results TikTok search mixes in. */
export function looksChinese(text: string): boolean {
  return HAN_RE.test(text) && !KANA_RE.test(text);
}

export interface FilterOptions {
  minFollowers?: number | null;
  maxFollowers?: number | null;
  chineseOnly?: boolean;
  /** Only Chinese in this script; implies chineseOnly. Text that doesn't show its script is kept. */
  script?: Script | null;
}

/**
 * Returns [keep, reason]; reason is empty when kept. With a follower range set, someone whose follower count
 * is still unknown after every lookup is left out: the range is a promise about the list.
 */
export function keep(c: Creator, opts: FilterOptions): [boolean, string] {
  const [ok, reason] = settled(c, opts);
  if (!ok) return [ok, reason];
  if (c.followers === null && (opts.minFollowers != null || opts.maxFollowers != null)) return [false, "unknown_followers"];
  return language(c, opts);
}

function language(c: Creator, opts: FilterOptions): [boolean, string] {
  const text = `${c.name}\n${c.bio}`;
  if ((opts.chineseOnly || opts.script) && !looksChinese(text)) return [false, "not_chinese"];
  const found = opts.script ? script(text) : "";
  if (found && found !== opts.script) return [false, `not_${opts.script}`];
  return [true, ""];
}

/**
 * What already rules someone out before paying to look them up: a private account, a follower count out of
 * range, or a bio (when there is one yet) not in the language asked for. Unknowns pass; the lookup may fill them in.
 */
export function prefilter(c: Creator, opts: FilterOptions): boolean {
  if (!settled(c, opts)[0]) return false;
  return !c.bio || language(c, opts)[0];
}

function settled(c: Creator, opts: FilterOptions): [boolean, string] {
  if (c.isPrivate) return [false, "private"];
  if (c.followers !== null) {
    if (opts.minFollowers != null && c.followers < opts.minFollowers) return [false, "below_min_followers"];
    if (opts.maxFollowers != null && c.followers > opts.maxFollowers) return [false, "above_max_followers"];
  }
  return [true, ""];
}
