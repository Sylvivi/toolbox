#!/usr/bin/env bash
# 并行跑指定的几个测试，只报结论。用法：
#     bash tests/p.sh edit editraw append
#     bash tests/p.sh 切章            # 预设组，见下面 GROUPS
#
# 为什么要有这个：每个测试文件开头都写死 `waitForTimeout(6000)`，单跑一个 8 秒、
# 其中 6 秒是纯空等。串行跑 5 个＝40 秒，用户在手机上干等（她 2026-08-04 明确提过
# 「回归可以不可以尽量快速且有效，有时候跑太多我这边要等好久」）。并行之后
# 总时间≈最慢的那一个。⚠️并发别超过 4：这台机器 2 核 / 2GB 可用，一个 chromium
# 约 200MB，开太多会抢内存反而更慢。
set -u
cd "$(dirname "$0")/.."
JOBS=4

for d in "$HOME/.toolbox-test/node_modules" "./node_modules" "$HOME/node_modules"; do
    if [ -d "$d/playwright" ]; then export NODE_PATH="$d"; break; fi
done
if [ -z "${NODE_PATH:-}" ]; then echo "❌ 找不到 playwright"; exit 2; fi

# 常用组合：改哪块就跑哪组，别一股脑全跑
case "${1:-}" in
    切章)   set -- fanwai chapnospace booktitleline numtitle ;;
    改书)   set -- edit editraw append dedup ;;
    背景)   set -- bg bgparse guidemark ;;
esac
[ $# -eq 0 ] && { echo "用法: bash tests/p.sh <测试名…>   或   bash tests/p.sh 切章|改书|背景"; exit 2; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
names=(); running=0
for arg in "$@"; do
    n="${arg%.test.js}"; f="tests/$n.test.js"
    if [ ! -f "$f" ]; then echo "  ⚠️  找不到 $f，跳过"; continue; fi
    names+=("$n")
    ( node "$f" >"$tmp/$n.out" 2>&1; echo $? >"$tmp/$n.code" ) &
    running=$((running + 1))
    if [ "$running" -ge "$JOBS" ]; then wait -n 2>/dev/null || wait; running=$((running - 1)); fi
done
wait

fail=0
for n in "${names[@]}"; do
    code=$(cat "$tmp/$n.code" 2>/dev/null || echo 1)
    # ⚠️各测试文件的收尾格式不统一（有的写「✅ 71 条全过」、有的写「✅ 全过（19 条）」），
    #   所以按关键词抓最后一行，别写死格式
    tail=$(grep -E "全过|条失败" "$tmp/$n.out" | tail -1)
    if [ "$code" = 0 ]; then
        printf "  ✅ %-16s %s\n" "$n" "$tail"
    else
        printf "  ❌ %-16s %s\n" "$n" "$tail"
        grep "^❌" "$tmp/$n.out" | head -6 | sed 's/^/        /'
        fail=1
    fi
done
[ "$fail" = 0 ] && echo "  ─── 全绿 ───" || echo "  ─── 有失败，上面是具体条目 ───"
exit $fail
