/**
 * Reads who to skip from whatever file the caller has: a list, a CSV/TSV exported from any spreadsheet,
 * or JSON of any shape. Every cell is looked at; only what is plainly an account counts, so the other
 * columns of an exported table (names, emails, notes) are left alone.
 */
import { handleOf } from "./search.js";

const PROFILE_LINK = /^(?:https?:\/\/)?(?:[\w-]+\.)*(?:instagram\.com|youtube\.com|tiktok\.com)\//i;
const BARE_HANDLE = /^[\p{L}\p{N}._-]+$/u;

/** "[text](url)" (how some tables export links) → url. */
function unlink(s: string): string {
  const m = s.match(/^\[[^\]]*\]\(([^)]*)\)$/);
  return m ? m[1] : s;
}

const CHANNEL_ID = /^UC[\w-]{22}$/;
// Headers that name an account column, and ones that only look like it ("账号名称" is a display name).
const ACCOUNT_HEADER = /账号|帳號|账户|帳戶|handle|user ?name|account|instagram|youtube|tiktok|^ig$|^yt$|频道|頻道/i;
const NOT_ACCOUNT_HEADER = /名称|名稱|昵称|暱稱|显示|顯示|display/i;

/** An @handle, a profile link or a bare YouTube channel id, or "" for anything else. */
function account(token: string): string {
  token = unlink(token.trim());
  if (CHANNEL_ID.test(token)) return `https://www.youtube.com/channel/${token}`;
  if (token.startsWith("@") || PROFILE_LINK.test(token)) return handleOf(token) ? token : "";
  return "";
}

/**
 * The accounts in one cell. A cell may hold several ("@a, @b") or sit in a sentence, so it is split into
 * words. `bare`: a name without "@" counts (a plain list, or an account column). `keep`: a cell that can't
 * be read is kept as is, so the caller can report it (only for a plain list, where every line should be one).
 */
function cell(text: string, bare: boolean, keep: boolean): string[] {
  text = text.trim();
  if (!text) return [];
  if (bare && BARE_HANDLE.test(text) && !CHANNEL_ID.test(text)) return [text];
  const found = text.split(/[\s,，、;；：|]+/).map(account).filter(Boolean);
  return found.length || !keep ? found : [text];
}

/** CSV or TSV rows, with quoted cells that may hold delimiters, quotes and newlines. */
export function rows(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") + 1 || undefined);
  const delim = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') cur += text[++i];
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      out.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur || row.length) out.push([...row, cur]);
  return out;
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

export function readExclude(text: string): string[] {
  text = text.replace(/^﻿/, "").trim();
  if (text.startsWith("[") || text.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined; // a list whose first line is "[text](url)"
    }
    if (json !== undefined) {
      // A plain array of strings is a list; anything else (an API response, say) is searched cell by cell.
      if (Array.isArray(json) && json.every((x) => typeof x === "string")) return json.flatMap((s) => cell(s, true, true));
      return strings(json).flatMap((s) => cell(s, false, false));
    }
  }
  const table = rows(text);
  // In an account column a bare name counts too, since tables often leave the "@" off. A column is one when
  // its header says so, or when most of its cells are plainly accounts. The first row is taken as the header:
  // it is left out of the count and its bare names don't count.
  const body = table.slice(1);
  const accountColumn = (i: number) => {
    const header = (table[0]?.[i] ?? "").trim();
    if (ACCOUNT_HEADER.test(header) && !NOT_ACCOUNT_HEADER.test(header)) return true;
    const filled = body.map((r) => (r[i] ?? "").trim()).filter(Boolean);
    return filled.filter((c) => cell(c, false, false).length).length * 2 > filled.length;
  };
  const accountColumns = new Set([...Array(Math.max(0, ...table.map((r) => r.length))).keys()].filter(accountColumn));
  return table.flatMap((r) => r.flatMap((c, i) => cell(c, r.length === 1 || (r !== table[0] && accountColumns.has(i)), r.length === 1)));
}
