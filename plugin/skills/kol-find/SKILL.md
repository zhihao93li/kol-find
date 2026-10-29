---
name: kol-find
description: 要「找一批 KOL / 博主 / 达人」「按关键词或对标账号找人和邮箱」「查这几个账号的邮箱」时使用：用 Apify 在 Instagram、YouTube、TikTok 上找人和公开邮箱，返回名单（JSON / CSV），不写任何库。
---

# 找 KOL

命令是这个 skill 目录下的 `scripts/kol-find.mjs`（下面写成 `kol-find`，实际用 `node <本目录>/scripts/kol-find.mjs`，需要 Node 20 以上）。`kol-find --help` 有全部选项。

会花 Apify 的钱。token 只存在这台电脑上：环境变量 `APIFY_TOKEN`、`~/.kol-find/apify-token`，或 kolpick 已经存的那个。都没有就请用户自己存进 `~/.kol-find/apify-token`，不要把 token 贴进对话。

1. 和用户确认：
   - 平台：instagram / youtube / tiktok，一次一个。
   - 找法：关键词 `--keywords`；对标账号的相似账号 `--seeds`（只有 Instagram）；已知账号只查邮箱 `--handles`。TikTok 按关键词找人效果差，主要用来查已知账号。
   - 粉丝范围、大约搜多少个账号 `--target`（有公开邮箱的通常三到五成）、预算 `--budget`（美元，默认 2）。
   - 要跳过的人：已经有的名单用 `--exclude-file` 传进去（一行一个账号或主页链接），免得重复花钱。
   - 只要中文博主加 `--chinese-only`；YouTube 要再查隐藏商务邮箱加 `--youtube-hidden`（找到一个约 12 美分）。
   - 参考成本：每 1000 个 KOL 约 8–15 美元，YouTube 隐藏邮箱另算。
2. 先试跑，加 `--dry-run` 和 `--job <这次的名字>`：

   ```bash
   kol-find search --platform instagram --keywords 親子,育兒 --min-followers 5000 --max-followers 200000 \
     --target 100 --budget 3 --job 亲子-ig-1 --dry-run
   ```

3. 讲清楚参数和花费上限，用户同意后去掉 `--dry-run` 再跑。要跑几分钟，跑之前说一声。
4. 汇报：找到几人、其中有邮箱几人、被筛掉多少（按原因）、花了多少钱、是否因为预算提前停，以及名单文件的位置。名单在输出里的 `名单`（JSON）和 `csv`。
5. 中途断了，用同一个 `--job` 名字重跑，已经完成的 Apify 步骤不会再花钱。

拿到名单后怎么用（筛人、写进哪里、发邀约）由用户决定；这个工具本身不写任何库。

给台湾、欧美的人发商业邮件涉及個資法、GDPR、CAN-SPAM：只用对方公开的邮箱，信里写清发件人，不要买别人整理的邮箱列表。
