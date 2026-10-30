/**
 * A free check that an email's domain can take mail at all: it has an MX record. It says nothing about the
 * mailbox itself, only rules out typos and dead domains. There is no fallback to the domain's address
 * record, which hardly any real mail domain relies on, and which local proxies in fake-IP mode answer for any name.
 */
import { Resolver } from "node:dns/promises";

export type MailCheck = "ok" | "no_mail_server" | "unknown";

// Domains everyone knows take mail; no need to ask DNS.
const KNOWN = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.tw", "hotmail.com", "hotmail.com.tw", "outlook.com",
  "live.com", "icloud.com", "me.com", "qq.com", "163.com", "126.com", "naver.com", "protonmail.com", "proton.me",
]);

export type DomainCheck = (domain: string) => Promise<MailCheck>;

/** Asks DNS. No such domain, or no MX record (or only a null one), is "no_mail_server"; timeouts and other errors are "unknown". */
export function dnsCheck(): DomainCheck {
  const dns = new Resolver({ timeout: 3000, tries: 2 });
  return async (domain) => {
    try {
      const mx = await dns.resolveMx(domain);
      // A lone "." record (null MX) is a domain saying it takes no mail.
      return mx.some((r) => r.exchange && r.exchange !== ".") ? "ok" : "no_mail_server";
    } catch (err: any) {
      return err?.code === "ENOTFOUND" || err?.code === "ENODATA" ? "no_mail_server" : "unknown";
    }
  };
}

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
