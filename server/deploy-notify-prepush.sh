#!/usr/bin/env bash
# ⚠️⚠️【2026-08-06 起已停用，.git/hooks/pre-push 已卸载。别顺手装回去。】
#   停用原因：线上已从 GitHub Pages 搬到本机 Caddy 伺服（tool.masterofmydomain.top →
#   43.172.64.111，见 CLAUDE.md「部署」一节 / 记忆 toolbox-self-hosted）。
#   这个钩子盯的是 **Pages**，而 Pages 已经不是线上了，于是它只会发假消息：
#     · Pages 发布成功 → 告诉用户「刷新页面即可」，可线上根本没变；
#     · Pages 又抽风   → 告诉用户「部署失败需人工」，可线上好好的。
#   用户 2026-08-06 问「以后我还需要 tg 那边的部署提示吗」，据此拆掉。
#   线上现在的可用性由 /home/ubuntu/cc-bridge/healthcheck.sh 每 10 分钟盯着（打不开才报警）。
#   ⚠️只有当「重新把线上切回 GitHub Pages」时才谈得上装回来——那时先确认 Pages 真是线上。
#
# 自动部署通知：每次 push main 时，后台拉起 deploy_autoheal.sh 盯这次提交，
# 部署成功/失败都发 Telegram。用户 2026-07-10 明确授权。
# 安装为 .git/hooks/pre-push。git 把待推的 ref 从 stdin 传进来:
#   <local ref> <local sha> <remote ref> <remote sha>
set -u
HEAL=/home/ubuntu/deploy_autoheal.sh
LOG=/home/ubuntu/deploy_autoheal.log

# 从 stdin 找出正在推的 main 分支及其本地 SHA
SHA=""
saw=0
while read -r lref lsha rref rsha; do
  saw=1
  case "$rref$lref" in
    *refs/heads/main*) [ "$lsha" != "0000000000000000000000000000000000000000" ] && SHA="$lsha" ;;
  esac
done
# 只在 stdin 完全为空(极少见)才兜底到 HEAD；有输入但没 main => 不是发布 main，不通知
[ -z "$SHA" ] && [ "$saw" = "0" ] && SHA=$(git rev-parse HEAD 2>/dev/null)
[ -z "$SHA" ] && exit 0   # 非 main 或拿不到：安静放行，绝不挡 push

# DRY_RUN=1 时只打印不真跑（供自测）
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "[pre-push dry-run] 会后台盯部署: $HEAL ${SHA:0:7}"
  exit 0
fi

# 去重：干掉上一次还在盯的守护，避免多份并跑
pkill -f "deploy_autoheal.sh" 2>/dev/null

# 完全脱离 git 进程后台运行（push 结束也不受影响）
setsid nohup "$HEAL" "$SHA" >"$LOG" 2>&1 < /dev/null &
echo "🔔 已自动盯 Pages 部署（${SHA:0:7}），成功后 Telegram 通知你"
exit 0   # 永远放行 push，通知只是副作用
