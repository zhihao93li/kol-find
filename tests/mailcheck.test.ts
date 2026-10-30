import { expect, it } from "vitest";
import { checkEmails, dnsCheck, publicMx, readDoh, type MailCheck } from "../src/mailcheck.js";

it("checks each domain once and doesn't ask about well-known mail providers", async () => {
  const asked: string[] = [];
  const result = await checkEmails(["a@shop.tw", "b@SHOP.tw", "c@gmail.com", "d@gmial.com"], async (d) => {
    asked.push(d);
    return d === "gmial.com" ? "no_mail_server" : "ok";
  });
  expect(asked.sort()).toEqual(["gmial.com", "shop.tw"]);
  expect([...result]).toEqual([["a@shop.tw", "ok"], ["b@SHOP.tw", "ok"], ["c@gmail.com", "ok"], ["d@gmial.com", "no_mail_server"]]);
});

it("calls a domain dead only when public DNS agrees with the local resolver", async () => {
  const fixed = (answer: MailCheck) => async () => answer;
  const confirmed: string[] = [];
  const confirm = (answer: MailCheck) => async (d: string) => (confirmed.push(d), answer);
  expect(await dnsCheck(fixed("ok"), confirm("no_mail_server"))("shop.tw")).toBe("ok");
  expect(confirmed).toEqual([]);
  // A proxy hiding the MX record of a real mail domain.
  expect(await dnsCheck(fixed("no_mail_server"), confirm("ok"))("cw.com.tw")).toBe("ok");
  expect(await dnsCheck(fixed("no_mail_server"), confirm("no_mail_server"))("gmial.com")).toBe("no_mail_server");
  expect(await dnsCheck(fixed("no_mail_server"), confirm("unknown"))("shop.tw")).toBe("unknown");
  expect(await dnsCheck(fixed("unknown"), confirm("ok"))("shop.tw")).toBe("ok");
});

it("reads DNS-over-HTTPS answers", () => {
  expect(readDoh({ Status: 0, Answer: [{ type: 15, data: "1 aspmx.l.google.com." }] })).toBe("ok");
  expect(readDoh({ Status: 0, Answer: [{ type: 5, data: "mail.example.com." }, { type: 15, data: "10 mx.example.com." }] })).toBe("ok");
  expect(readDoh({ Status: 0, Answer: [{ type: 15, data: "0 ." }] })).toBe("no_mail_server");
  expect(readDoh({ Status: 0 })).toBe("no_mail_server");
  expect(readDoh({ Status: 3 })).toBe("no_mail_server");
  expect(readDoh({ Status: 2 })).toBe("unknown");
});

it("falls back to the second public resolver, and gives up as unknown", async () => {
  const urls: string[] = [];
  const firstDown = (async (url: string) => {
    urls.push(url);
    if (url.startsWith("https://dns.google")) throw new Error("blocked");
    return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: "1 mx.shop.tw." }] }));
  }) as typeof fetch;
  expect(await publicMx(firstDown)("shop.tw")).toBe("ok");
  expect(urls).toHaveLength(2);
  const allDown = (async () => new Response("", { status: 503 })) as typeof fetch;
  expect(await publicMx(allDown)("shop.tw")).toBe("unknown");
});
