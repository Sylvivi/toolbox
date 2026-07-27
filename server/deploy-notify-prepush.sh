#!/usr/bin/env bash
# 自动部署通知：每次 push main 时，后台拉起 deploy_autoheal.sh 盯这次提交，
# 部署成功/失败都发 Telegram（详见记忆 toolbox-deploy-notify）。用户 2026-07-10 明确授权。
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
