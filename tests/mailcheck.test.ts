import { expect, it } from "vitest";
import { checkEmails } from "../src/mailcheck.js";

it("checks each domain once and doesn't ask about well-known mail providers", async () => {
  const asked: string[] = [];
  const result = await checkEmails(["a@shop.tw", "b@SHOP.tw", "c@gmail.com", "d@gmial.com"], async (d) => {
    asked.push(d);
    return d === "gmial.com" ? "no_mail_server" : "ok";
  });
  expect(asked.sort()).toEqual(["gmial.com", "shop.tw"]);
  expect([...result]).toEqual([["a@shop.tw", "ok"], ["b@SHOP.tw", "ok"], ["c@gmail.com", "ok"], ["d@gmial.com", "no_mail_server"]]);
});
