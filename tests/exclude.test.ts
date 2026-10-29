import { describe, expect, it } from "vitest";
import { readExclude, rows } from "../src/exclude.js";
import { handleOf } from "../src/search.js";

const handles = (text: string) => readExclude(text).map(handleOf);

describe("readExclude", () => {
  it("reads a plain list, keeping lines it can't read so they can be reported", () => {
    expect(readExclude("@a\nb_b\n\n[https://www.instagram.com/c/](https://www.instagram.com/c/)\nhttps://shop.tw/x\n"))
      .toEqual(["@a", "b_b", "https://www.instagram.com/c/", "https://shop.tw/x"]);
  });

  it("finds accounts in any column of an exported table and leaves the other columns alone", () => {
    const csv = [
      "﻿名称,账号,主页链接,邮箱,备注",
      '小美,@mei,https://www.instagram.com/mei.tw/,mei@x.tw,"合作過，\n很好"',
      '阿明,,"https://www.youtube.com/@阿明, https://www.tiktok.com/@ming",,不要再聯絡',
    ].join("\r\n");
    expect(handles(csv)).toEqual(["mei", "mei.tw", "阿明", "ming"]);
  });

  it("takes bare names in an account column, found by its header or by most cells being accounts", () => {
    expect(handles("名称,链接\nAmy,@amy\nBob,bob_tw\nCat,@cat\n")).toEqual(["amy", "bob_tw", "cat"]);
    expect(handles("账号名称,帳號,备注\nAmy,amy,ok\nBob,bob_tw,@cat\n")).toEqual(["amy", "bob_tw", "cat"]);
    expect(handles("Name,Username,Note\nAmy,amy,hi\n")).toEqual(["amy"]);
  });

  it("reads bare YouTube channel ids, and doesn't take a sentence for an account", () => {
    expect(handles("频道 ID：UCEd91BQ08PoQvAXSHLWdLdQ\nUC9L9d8SexuYr2tk9-1nCmNA\n主頁 待確認\n"))
      .toEqual(["channel/uced91bq08poqvaxshlwdldq", "channel/uc9l9d8sexuyr2tk9-1ncmna", ""]);
  });

  it("reads TSV and quoted cells", () => {
    expect(rows('a\tb\n"x\ty"\t"say ""hi"""\n')).toEqual([["a", "b"], ["x\ty", 'say "hi"']]);
    expect(handles("名称\t账号\n小美\t@mei\n")).toEqual(["mei"]);
  });

  it("reads a JSON list, or searches any other JSON for accounts", () => {
    expect(handles('["@a", "https://www.tiktok.com/@b"]')).toEqual(["a", "b"]);
    const apiResponse = { ok: true, data: { fields: ["账号", "主页链接"],
      data: [["@a", "[https://www.instagram.com/a/](https://www.instagram.com/a/)"], [null, "https://www.youtube.com/channel/UCx"]] } };
    expect(handles(JSON.stringify(apiResponse))).toEqual(["a", "a", "channel/ucx"]);
  });
});
