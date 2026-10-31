# kol-find

找 KOL 和公开邮箱的小工具：在 Instagram、YouTube、TikTok 上按关键词、对标账号的相似账号找人，或查已知账号的邮箱，用的是 Apify 商店里现成的 actor（要花 Apify 的钱）。只返回名单（JSON 和 CSV），不连任何数据库。

一个命令行加一份 skill（`SKILL.md` 加脚本，通用格式），能执行命令的 agent 都能用：Claude Code、Codex、Grok Build 等，也能自己在终端跑。需要 Node 20 以上。

## 安装

- **Claude Code**：装插件，以后用 `/plugin` 更新。

  ```
  /plugin marketplace add zhihao93li/kol-find
  /plugin install kol-find@kol-find
  ```

- **Codex、Grok Build**：装进 `~/.agents/skills/`，两个都从这里读。重跑同一条命令就是更新。

  ```bash
  curl -fsSL https://raw.githubusercontent.com/zhihao93li/kol-find/main/install.sh | sh
  ```

  Grok Build 也会读已装的 Claude Code 插件，装了插件的电脑可以不再装这份，免得出现两个 kol-find。别的 agent 的 skills 目录可以跟在后面：`... | sh -s -- ~/.别的/skills`。

  Codex 默认的沙箱不能联网，跑 kol-find 时要放行（或在配置里打开 `sandbox_workspace_write.network_access`）；结果默认写在 `~/.kol-find/`，想写进工作目录就设 `KOL_FIND_HOME=./.kol-find`。

- **别的 agent**：能执行命令就行。把 `plugin/skills/kol-find/` 整个目录给它，`SKILL.md` 当使用说明（放进它的 skills 目录、`AGENTS.md` 或系统提示词）。

- **直接用**：`node plugin/skills/kol-find/scripts/kol-find.mjs --help`

Apify token 只存在本机：环境变量 `APIFY_TOKEN`，或 `~/.kol-find/apify-token`。

## 用法

```bash
kol-find search --platform instagram --keywords 親子,育兒 --min-followers 5000 --target 100 --budget 3 --job 亲子-ig-1 --dry-run
```

- `--dry-run` 不花钱，会给出预计：最多搜到多少账号、每一步最多花多少、预算够不够跑完（哪一步会被预算截断或不启动）。这是每个账号都走完每一步的上限，实际通常少得多。
- 去掉 `--dry-run` 才真的跑；到 `--budget`（美元，默认 2）就停，已找到的照样返回。
- 粉丝数在搜索结果里已经超出范围的人，不会再花钱查邮箱；给了粉丝范围时，查完还不知道粉丝数的人也不放进名单（算在「被筛掉」里）。
- 结果在 `~/.kol-find/jobs/<名字>/`：`people.json`（完整名单）和 `people.csv`（`KOL_FIND_HOME` 可改位置）。
- 中途断了用同一个 `--job` 重跑，已完成的 Apify 步骤不再花钱，失败且没有结果的步骤会重新启动。续跑只能改预算，条件变了会被拒绝，换个名字重新跑。
- 已有的人用 `--exclude` / `--exclude-file` 传进去，不再花钱查。
- `--script 繁体` / `--script 简体` 只要这种中文的博主；名称和简介太短、看不出繁简的照样保留，名单的「文字」列标着看出来的繁简。

### 名单里有什么

- **邮箱检查**（免费，查 DNS）：邮箱的域名有没有收信服务器。`no_mail_server` 是拼错或不存在的域名（如 `gmial.com`），一个人有几个邮箱时优先给能收信的那个；`unknown` 是没查成（超时等）。本机 DNS 说没有收信服务器时，会再问 Google / Cloudflare 的公共 DNS（走 HTTPS）确认，免得开着代理的电脑把能用的邮箱误判成坏的；公共 DNS 也连不上就算 `unknown`。只能排除域名问题，不能保证邮箱本身存在。
- **共用邮箱的账号**：同一个邮箱出现在好几个人名下，通常是经纪公司的。
- **活跃度**：只用搜索时已经拿到的数据，不另外花钱，所以各平台能给的不一样：

  | 平台 | 帖子数 | 最近发帖 | 平均点赞 / 评论 | 平均播放 | 互动率 |
  | --- | --- | --- | --- | --- | --- |
  | Instagram（关键词找到的） | 有 | 有 | 最近几条帖子 | 视频帖才有 | 有 |
  | Instagram（相似账号、已知账号） | 有 | 没有 | 没有 | 没有 | 没有 |
  | YouTube | 有 | 没有 | 没有 | 频道总播放 ÷ 视频数 | 没有 |
  | TikTok（关键词找到的） | 有 | 没有 | 没有 | 没有 | 没有 |
  | TikTok（已知账号） | 有 | 有 | 最近几条视频 | 有 | 有 |

  互动率 =（平均点赞 + 平均评论）÷ 粉丝数。置顶的帖子不算。
- 汇报里的 `costPerEmailUsd` 是这次花的钱 ÷ 能收信的邮箱数。

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
| `plugin/` | Claude Code 插件和通用 skill（`skills/kol-find/` 整个目录就是 skill）；`scripts/kol-find.mjs` 由 `npm run build` 打包，要提交 |
| `install.sh` | 把 skill 装进 `~/.agents/skills`（Codex、Grok Build 都读） |

```bash
npm install
npm test
npm run build
```
