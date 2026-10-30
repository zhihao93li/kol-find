/**
 * A free check that an email's domain can take mail at all: it has an MX record. It says nothing about the
 * mailbox itself, only rules out typos and dead domains. There is no fallback to the domain's address
 * record, which hardly any real mail domain relies on, and which local proxies in fake-IP mode answer for any name.
 * Such proxies also answer "no MX" for real mail domains, so a "no" from the local resolver is confirmed over
 * DNS-over-HTTPS before a domain is called dead.
 */
import { Resolver } from "node:dns/promises";

export type MailCheck = "ok" | "no_mail_server" | "unknown";

// Domains everyone knows take mail; no need to ask DNS.
const KNOWN = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.tw", "hotmail.com", "hotmail.com.tw", "outlook.com",
  "live.com", "icloud.com", "me.com", "qq.com", "163.com", "126.com", "naver.com", "protonmail.com", "proton.me",
]);

export type DomainCheck = (domain: string) => Promise<MailCheck>;

/**
 * Asks the local resolver, and when it doesn't say "ok", asks `confirm` (public DNS over HTTPS), whose answer stands.
 * So a domain is "no_mail_server" only when public DNS agrees, and "unknown" when public DNS can't be reached.
 */
export function dnsCheck(local: DomainCheck = localMx(), confirm: DomainCheck = publicMx()): DomainCheck {
  return async (domain) => ((await local(domain)) === "ok" ? "ok" : confirm(domain));
}

/** The system resolver. No such domain, or no MX record (or only a null one), is "no_mail_server"; timeouts and other errors are "unknown". */
export function localMx(): DomainCheck {
  const dns = new Resolver({ timeout: 3000, tries: 2 });
  return async (domain) => {
    try {
      const mx = await dns.resolveMx(domain);
      return hasExchange(mx.map((r) => r.exchange)) ? "ok" : "no_mail_server";
    } catch (err: any) {
      return err?.code === "ENOTFOUND" || err?.code === "ENODATA" ? "no_mail_server" : "unknown";
    }
  };
}

const DOH = ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"];

/** Google's DNS over HTTPS, then Cloudflare's if Google can't be reached; "unknown" if neither answers. */
export function publicMx(get: typeof fetch = fetch): DomainCheck {
  return async (domain) => {
    for (const url of DOH) {
      try {
        const res = await get(`${url}?name=${encodeURIComponent(domain)}&type=MX`, {
          headers: { accept: "application/dns-json" },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) return readDoh(await res.json());
      } catch {
        // try the next one
      }
    }
    return "unknown";
  };
}

/** A DNS-over-HTTPS JSON answer: NXDOMAIN or no usable MX is "no_mail_server"; other failures are "unknown". */
export function readDoh(answer: any): MailCheck {
  if (answer?.Status === 3) return "no_mail_server";
  if (answer?.Status !== 0) return "unknown";
  // MX answers read "10 mx.example.com."; CNAMEs on the way are left out.
  const exchanges = (answer.Answer ?? []).filter((a: any) => a?.type === 15).map((a: any) => String(a.data).split(/\s+/)[1] ?? "");
  return hasExchange(exchanges) ? "ok" : "no_mail_server";
}

// A lone "." record (null MX) is a domain saying it takes no mail.
const hasExchange = (exchanges: string[]) => exchanges.some((x) => x && x !== ".");

/** Checks each distinct domain once, a few at a time. */
export async function checkEmails(emails: string[], check: DomainCheck, concurrency = 16): Promise<Map<string, MailCheck>> {
  const domainOf = (e: string) => e.split("@").pop()!.toLowerCase();
  const domains = [...new Set(emails.map(domainOf))];
  const byDomain = new Map<string, MailCheck>();
  let next = 0;
  const worker = async () => {
    while (next < domains.length) {
      const d = domains[next++];
      byDomain.set(d, KNOWN.has(d) ? "ok" : await check(d));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, domains.length) }, worker));
  return new Map(emails.map((e) => [e, byDomain.get(domainOf(e))!]));
}
