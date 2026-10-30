---
name: kol-find
description: 要「找一批 KOL / 博主 / 达人」「按关键词或对标账号找人和邮箱」「查这几个账号的邮箱」时使用：用 Apify 在 Instagram、YouTube、TikTok 上找人和公开邮箱，返回名单（JSON / CSV），不写任何库。
---

# 找 KOL

命令是这个 skill 目录下的 `scripts/kol-find.mjs`（下面写成 `kol-find`，实际用 `node <本目录>/scripts/kol-find.mjs`，需要 Node 20 以上）。`kol-find --help` 有全部选项。

会花 Apify 的钱。token 只存在这台电脑上：环境变量 `APIFY_TOKEN`或 `~/.kol-find/apify-token`。都没有就请用户自己存进 `~/.kol-find/apify-token`，不要把 token 贴进对话。

1. 和用户确认：
   - 平台：instagram / youtube / tiktok，一次一个。
   - 找法：关键词 `--keywords`；对标账号的相似账号 `--seeds`（只有 Instagram）；已知账号只查邮箱 `--handles`。TikTok 按关键词找人效果差，主要用来查已知账号。
   - 粉丝范围、大约搜多少个账号 `--target`（有公开邮箱的通常三到五成）、预算 `--budget`（美元，默认 2）。
   - 要跳过的人：用户已有的名单导成文件传给 `--exclude-file`，免得重复花钱。一行一个的名单、任何表格导出的 CSV / TSV、JSON 都能读，每一格里的 `@账号` 和主页链接都会被认出来，不用挑列。名单在别的系统里（表格、数据库、在线文档），就用你手上能读那个系统的工具导出成文件，或者请用户自己导出 CSV；Excel 文件要先导出成 CSV。
   - 只要中文博主加 `--chinese-only`，只要繁体或简体的加 `--script 繁体` / `--script 简体`（看不出繁简的会保留）；YouTube 要再查隐藏商务邮箱加 `--youtube-hidden`（找到一个约 12 美分）。
   - 参考成本：每 1000 个 KOL 约 8–15 美元，YouTube 隐藏邮箱另算。
2. 先试跑，加 `--dry-run` 和 `--job <这次的名字>`：

   ```bash
   kol-find search --platform instagram --keywords 親子,育兒 --min-followers 5000 --max-followers 200000 \
     --target 100 --budget 3 --job 亲子-ig-1 --dry-run
   ```

3. 讲清楚参数、花费上限、`预计`（最多搜到多少账号、跑完最多花多少；`预算` 说不够时，告诉用户哪一步会被截断或不启动，这些人就查不到邮箱，问要不要加预算或减少 `--target`）和读到几个要跳过的账号（`跳过账号`；`认不出的跳过项` 是名单里没读出账号、不会被跳过的行，有的话也说），用户同意后去掉 `--dry-run` 再跑。要跑几分钟，跑之前说一声。
4. 汇报：找到几人、其中有能收信的邮箱几人（`withEmail`）、每个邮箱花了多少（`costPerEmailUsd`）、被筛掉多少（按原因；`unknown_followers` 是给了粉丝范围但查不到粉丝数的人）、花了多少钱、是否因为预算提前停，以及名单文件的位置。有 `emailNoMailServer`（邮箱域名收不了信）或 `sharedEmails`（几个人共用一个邮箱，多半是经纪公司）时也说一句。名单里有帖子数、最近发帖、平均互动这些活跃度数据，各平台能给的不一样（见仓库 README「名单里有什么」），用户要挑人时可以用。名单在输出里的 `名单`（JSON）和 `csv`。
5. 中途断了，用同一个 `--job` 名字和同样的条件重跑，已经完成的 Apify 步骤不会再花钱；可以调高 `--budget`，别的条件变了脚本会拒绝，那就换个名字。

拿到名单后怎么用（筛人、写进哪里、发邀约）由用户决定；这个工具本身不写任何库。

给台湾、欧美的人发商业邮件涉及個資法、GDPR、CAN-SPAM：只用对方公开的邮箱，信里写清发件人，不要买别人整理的邮箱列表。
