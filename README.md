# kol-find

找 KOL 和公开邮箱的小工具：在 Instagram、YouTube、TikTok 上按关键词、对标账号的相似账号找人，或查已知账号的邮箱，用的是 Apify 商店里现成的 actor（要花 Apify 的钱）。只返回名单（JSON 和 CSV），不连任何数据库。

一个命令行加一份 skill，在 Claude Code、Codex 里让 agent 用，也能自己在终端跑。

## 安装

- **Claude Code**：

  ```
  /plugin marketplace add zhihao93li/kol-find
  /plugin install kol-find@kol-find
  ```

- **Codex**：克隆本仓库，把 skill 目录链接进 Codex 的 skills 目录：

  ```bash
  ln -s "$(pwd)/plugin/skills/kol-find" ~/.codex/skills/kol-find
  ```

- **直接用**（Node 20 以上）：`node plugin/skills/kol-find/scripts/kol-find.mjs --help`

Apify token 只存在本机：环境变量 `APIFY_TOKEN`，或 `~/.kol-find/apify-token`。

## 用法

```bash
kol-find search --platform instagram --keywords 親子,育兒 --min-followers 5000 --target 100 --budget 3 --job 亲子-ig-1 --dry-run
```

- 去掉 `--dry-run` 才真的跑；到 `--budget`（美元，默认 2）就停，已找到的照样返回。
- 结果在 `~/.kol-find/jobs/<名字>/`：`people.json`（完整名单）和 `people.csv`（`KOL_FIND_HOME` 可改位置）。
- 中途断了用同一个 `--job` 重跑，已完成的 Apify 步骤不再花钱。续跑只能改预算，条件变了会被拒绝，换个名字重新跑。
- 已有的人用 `--exclude` / `--exclude-file` 传进去，不再花钱查。

### 跳过已有的人

名单在哪都行，导成文件传给 `--exclude-file`：

- 一行一个账号（`@name` 或 `name`）或主页链接；
- 任何表格（Excel、Numbers、Google Sheets、飞书多维表格……）导出的 CSV / TSV，不用挑列；
- JSON，包括数据接口直接返回的那种。

每一格里的 `@账号`、Instagram / YouTube / TikTok 主页链接和 YouTube 频道 ID 都会被认出来，一格有几个也行；名字、邮箱、备注这些列不管。账号列不带 `@` 也行：表头写着「账号」「handle」「username」这类，或者这一列大部分是账号，就整列都当账号读。Excel、Numbers 文件要先导出成 CSV。试跑输出的「认不出的跳过项」是名单里读不出账号的行，这些不会被跳过。

全部选项见 `--help`，agent 怎么用见 [plugin/skills/kol-find/SKILL.md](plugin/skills/kol-find/SKILL.md)。

## 为什么这样找

各平台按什么顺序查邮箱见 [src/discovery/pipeline.ts](src/discovery/pipeline.ts) 开头的说明（按 2026-10-20 对 150 个 KOL 的实测定的），用哪些 actor 和单价以 [src/discovery/apify.ts](src/discovery/apify.ts) 为准。

## 开发

| 位置 | 内容 |
| --- | --- |
| `src/discovery/` | 找人和查邮箱：actor 和价格（`apify.ts`）、各平台步骤（`pipeline.ts`）、整体流程（`run.ts`） |
| `src/search.ts`、`src/cli.ts` | 命令行：参数、跳过名单、断点、JSON / CSV 输出 |
| `plugin/` | Claude Code 插件和 skill；`scripts/kol-find.mjs` 由 `npm run build` 打包，要提交 |

```bash
npm install
npm test
npm run build
```
