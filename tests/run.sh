#!/usr/bin/env bash
# 跑 toolbox 的回归测试。用法：bash tests/run.sh
# 不联网、不发真请求、不花额度——所有模型调用都是假的。
set -u
cd "$(dirname "$0")/.."

# playwright 装在仓库外（18M，不该进公开仓）。按顺序找几个可能的位置。
for d in "$HOME/.toolbox-test/node_modules" "./node_modules" "$HOME/node_modules"; do
    if [ -d "$d/playwright" ]; then export NODE_PATH="$d"; break; fi
done

if [ -z "${NODE_PATH:-}" ]; then
    echo "❌ 找不到 playwright（测试用的"假浏览器"）。装一次就行："
    echo "     mkdir -p ~/.toolbox-test && cd ~/.toolbox-test && npm i playwright && npx playwright install chromium"
    exit 2
fi

fail=0
for t in tests/*.test.js; do
    echo "── $t"
    node "$t" || fail=1
done
exit $fail
