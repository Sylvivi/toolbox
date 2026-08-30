#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TMDB 抓取小工具（2026-08-30 汐写的，给「首页座右铭＝随机电影台词」用）。

⚠️**key 不在这个文件里**，读 `/home/ubuntu/.relays/tmdb.txt`
   （这个仓库是 public 的，密钥进去就等于作废——见 CLAUDE.md 那条）。

用法：
    python3 tools/tmdb.py taglines            # 重抓一遍 tagline 池 → tools/tmdb_raw.json
    python3 tools/tmdb.py taglines --pages 30 # 多抓几页
    python3 tools/tmdb.py 筛                   # 从 tmdb_raw.json 筛出可用的，打印成 JS 数组
    python3 tools/tmdb.py get /movie/238      # 随便打一个接口看看返回什么（探路用）

⚠️**以后要抓别的东西（海报、评分、类型、剧集台词…）就在这儿加个子命令**，
   `get()` 已经把 key、重试、超时都包好了，别再另起一份。
"""
import json, sys, time, urllib.parse, urllib.request, os, re

KEY_FILE = '/home/ubuntu/.relays/tmdb.txt'
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tmdb_raw.json')


def key():
    return open(KEY_FILE).read().strip()


def get(path, **q):
    """打一个 TMDB 接口。失败重试三次，返回 dict（彻底失败返回 {}）。"""
    q['api_key'] = key()
    url = 'https://api.themoviedb.org/3' + path + '?' + urllib.parse.urlencode(q)
    for _ in range(3):
        try:
            return json.loads(urllib.request.urlopen(url, timeout=20).read())
        except Exception:
            time.sleep(0.8)
    return {}


def 抓tagline(pages=20, 也抓热门=5):
    """top_rated 前 pages 页 ＋ popular 前几页，逐部取 tagline。⚠️一部一次请求，300 部约 2 分钟。"""
    ids, seen = [], set()
    for kind, n in (('top_rated', pages), ('popular', 也抓热门)):
        for p in range(1, n + 1):
            for m in get('/movie/' + kind, language='en-US', page=p).get('results', []):
                if m['id'] not in seen:
                    seen.add(m['id'])
                    ids.append((m['id'], m.get('title'), (m.get('release_date') or '')[:4]))
    print('候选 %d 部' % len(ids))
    out = []
    for i, (mid, title, year) in enumerate(ids, 1):
        t = (get('/movie/%d' % mid, language='en-US').get('tagline') or '').strip()
        if t:
            out.append({'t': t, 'm': title, 'y': year})
        if i % 80 == 0:
            print('  ...%d/%d，已拿到 %d' % (i, len(ids), len(out)))
    json.dump(out, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('有 tagline 的 %d 部 → %s' % (len(out), RAW))


def 筛(最短=12, 最长=62):
    """⚠️筛选口径就是这几条，改这里就等于改她首页看到的那批句子。"""
    d = json.load(open(RAW, encoding='utf-8'))
    def ok(x):
        t = x['t']
        if not (最短 <= len(t) <= 最长):
            return False
        if (x['y'] or '9999') >= '2026':        # 还没上映的，标语多是占位
            return False
        if t.isupper():
            return False
        if re.search(r'\b(coming soon|in theat|this (summer|christmas)|rated)\b', t, re.I):
            return False
        return True
    seen, out = set(), []
    for x in filter(ok, d):
        k = re.sub(r'[^a-z0-9]', '', x['t'].lower())
        if k in seen:
            continue
        seen.add(k)
        out.append([x['t'], x['m']])
    out.sort(key=lambda p: p[1] or '')
    print('// 筛出 %d 条，粘进 index.html 的 MOTTO_TAGLINES' % len(out))
    line = '        '
    for p in out:
        s = json.dumps(p, ensure_ascii=False, separators=(',', ':')) + ','
        if len(line) + len(s) > 150:
            print(line); line = '        '
        line += s
    print(line.rstrip(','))


if __name__ == '__main__':
    a = sys.argv[1:] or ['筛']
    if a[0] == 'taglines':
        n = int(a[a.index('--pages') + 1]) if '--pages' in a else 20
        抓tagline(pages=n)
    elif a[0] == 'get':
        print(json.dumps(get(a[1]), ensure_ascii=False, indent=1)[:3000])
    else:
        筛()
