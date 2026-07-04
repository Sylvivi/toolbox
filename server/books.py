#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cc-books —— 工具箱「书库同步」小服务（与两个聊天桥完全独立）。
- 只存/取小说正文，书本地为主、这里当镜像。
- 用 Python 标准库，无第三方依赖。
- 鉴权复用聊天桥的同一把口令（默认读 /home/ubuntu/cc-bridge/token）。
- 每本书两个文件：<sha256(fileKey)>.meta（小清单）+ <hash>.body（整本 JSON）。
接口（Caddy 把 https://<域名>/books/* 反代到本服务，路径原样保留）：
  GET  /books/healthz              -> 200 ok（免鉴权，自检/主动健康检查用）
  GET  /books/manifest             -> {ok, items:{fileKey:{fileName,fileSize,nchap,ts,hash}}}
  GET  /books/get?key=<fileKey>    -> {ok, book:{...}}
  POST /books/put  {fileKey,ts,book} -> {ok}
  POST /books/del  {fileKey}       -> {ok}
"""
import os, json, hashlib, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('CC_BOOKS_PORT', '8790'))
STORE = os.environ.get('CC_BOOKS_STORE', '/home/ubuntu/cc-books/store')
TOKEN_FILE = os.environ.get('CC_BOOKS_TOKEN_FILE', '/home/ubuntu/cc-bridge/token')
MAX_BODY = 64 * 1024 * 1024  # 单本上限 64MB，足够任何小说
_LOCK = threading.Lock()

os.makedirs(STORE, exist_ok=True)


def load_token():
    try:
        with open(TOKEN_FILE, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except Exception:
        return ''


def h(file_key):
    return hashlib.sha256(file_key.encode('utf-8')).hexdigest()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    # ---- 公共响应工具 ----
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def _json(self, code, obj, close=False):
        # close=True 用于「还没读完请求体就出错」的分支（如 401/413）：
        # 关掉这条 keep-alive 连接，避免残留的请求体把下一个请求冲乱。
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        if close:
            self.close_connection = True
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if close:
            self.send_header('Connection', 'close')
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _text(self, code, s):
        body = s.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _authed(self):
        tok = load_token()
        if not tok:
            return False
        got = self.headers.get('Authorization', '')
        if got.startswith('Bearer '):
            got = got[7:]
        return got.strip() == tok

    def _path(self):
        p = urlparse(self.path).path
        if p.startswith('/books'):
            p = p[len('/books'):] or '/'
        return p

    def log_message(self, *a):
        pass  # 静默，交给 systemd/journal

    # ---- 路由 ----
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        p = self._path()
        if p == '/healthz':
            return self._text(200, 'ok')
        if not self._authed():
            return self._json(401, {'ok': False, 'error': 'invalid token'})
        if p == '/manifest':
            items = {}
            try:
                for fn in os.listdir(STORE):
                    if not fn.endswith('.meta'):
                        continue
                    try:
                        with open(os.path.join(STORE, fn), 'r', encoding='utf-8') as f:
                            m = json.load(f)
                        fk = m.get('fileKey')
                        if fk:
                            items[fk] = {
                                'fileName': m.get('fileName', ''),
                                'fileSize': m.get('fileSize', 0),
                                'nchap': m.get('nchap', 0),
                                'ts': m.get('ts', 0),
                                'hash': m.get('hash', ''),
                            }
                    except Exception:
                        continue
            except Exception:
                pass
            return self._json(200, {'ok': True, 'items': items})
        if p == '/get':
            qs = parse_qs(urlparse(self.path).query)
            fk = (qs.get('key') or [''])[0]
            if not fk:
                return self._json(400, {'ok': False, 'error': 'missing key'})
            bodyfile = os.path.join(STORE, h(fk) + '.body')
            if not os.path.exists(bodyfile):
                return self._json(404, {'ok': False, 'error': 'not found'})
            try:
                with open(bodyfile, 'r', encoding='utf-8') as f:
                    payload = json.load(f)
                return self._json(200, {'ok': True, 'book': payload.get('book', payload)})
            except Exception as e:
                return self._json(500, {'ok': False, 'error': str(e)})
        return self._json(404, {'ok': False, 'error': 'no such route'})

    def do_POST(self):
        p = self._path()
        # 下面两个错误都发生在「还没读请求体」之前，必须 close 连接防 keep-alive 串包
        if not self._authed():
            return self._json(401, {'ok': False, 'error': 'invalid token'}, close=True)
        try:
            n = int(self.headers.get('Content-Length', '0'))
        except Exception:
            n = 0
        if n <= 0 or n > MAX_BODY:
            return self._json(413, {'ok': False, 'error': 'bad body size'}, close=True)
        try:
            raw = self.rfile.read(n)
            data = json.loads(raw.decode('utf-8'))
        except Exception:
            return self._json(400, {'ok': False, 'error': 'bad json'})

        if p == '/put':
            fk = data.get('fileKey')
            book = data.get('book')
            if not fk or not isinstance(book, dict):
                return self._json(400, {'ok': False, 'error': 'missing fileKey/book'})
            hid = h(fk)
            meta = {
                'fileKey': fk,
                'fileName': book.get('fileName', ''),
                'fileSize': book.get('fileSize', 0),
                'nchap': len(book.get('chapters') or []),
                'ts': data.get('ts', 0),
                'hash': hid,
            }
            with _LOCK:
                try:
                    self._atomic(os.path.join(STORE, hid + '.body'),
                                 json.dumps({'fileKey': fk, 'ts': meta['ts'], 'book': book}, ensure_ascii=False))
                    self._atomic(os.path.join(STORE, hid + '.meta'),
                                 json.dumps(meta, ensure_ascii=False))
                except Exception as e:
                    return self._json(500, {'ok': False, 'error': str(e)})
            return self._json(200, {'ok': True})

        if p == '/del':
            fk = data.get('fileKey')
            if not fk:
                return self._json(400, {'ok': False, 'error': 'missing fileKey'})
            hid = h(fk)
            with _LOCK:
                for ext in ('.body', '.meta'):
                    try:
                        os.remove(os.path.join(STORE, hid + ext))
                    except Exception:
                        pass
            return self._json(200, {'ok': True})

        return self._json(404, {'ok': False, 'error': 'no such route'})

    def _atomic(self, path, text):
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(text)
        os.replace(tmp, path)


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('cc-books listening on 127.0.0.1:%d, store=%s' % (PORT, STORE), flush=True)
    srv.serve_forever()
