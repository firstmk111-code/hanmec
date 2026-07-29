/* ============================================================
   backend.js — 저장소에 읽고 쓰는 통로 (두 가지 모드 자동 판별)

   · server 모드 : /api/* 백엔드가 있는 곳(Cloudflare)에서 동작.
                   아이디/비밀번호로 로그인하고, GitHub 토큰은 서버에만 있다.
   · token  모드 : 백엔드가 없는 곳(GitHub Pages)에서 동작.
                   사용자가 GitHub 토큰을 직접 넣어 브라우저가 커밋한다.

   두 모드 모두 아래 같은 모양으로 쓰인다.
     be.mode                                  'server' | 'token'
     be.login(creds)          → Promise
     be.verify()              → Promise<{user}>
     be.headSha()             → Promise<string>
     be.getFile(path, ref)    → Promise<string>   (UTF-8 원문)
     be.commits(limit)        → Promise<[{sha,message,date,url}]>
     be.commitFiles(files, message, baseSha, onProgress) → Promise<{sha,url}>
     be.logout()              → Promise
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- base64 ↔ UTF-8 (한글 안전) ---------- */
  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function base64ToUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function sequential(items, fn) {
    var out = [];
    return items.reduce(function (p, item, i) {
      return p.then(function () { return fn(item, i).then(function (r) { out.push(r); }); });
    }, Promise.resolve()).then(function () { return out; });
  }

  /* ============================================================
     1) 서버 모드 — /api/*
     ============================================================ */
  function ServerBackend(cfg) {
    this.mode = 'server';
    this.user = cfg.user || 'admin';
  }

  ServerBackend.prototype._req = function (path, options) {
    options = options || {};
    return fetch('/api/' + path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var e = new Error(data.error || ('오류 ' + res.status));
          e.status = res.status;
          throw e;
        }
        return data;
      });
    });
  };

  ServerBackend.prototype.login = function (creds) {
    return this._req('login', { method: 'POST', body: { user: creds.user, pass: creds.pass } });
  };
  ServerBackend.prototype.verify = function () {
    return this._req('me');
  };
  ServerBackend.prototype.logout = function () {
    return this._req('logout', { method: 'POST' }).catch(function () {});
  };
  ServerBackend.prototype.headSha = function () {
    return this._req('head').then(function (r) { return r.sha; });
  };
  ServerBackend.prototype.getFile = function (path, ref) {
    return this._req('file?path=' + encodeURIComponent(path) + '&ref=' + encodeURIComponent(ref || ''))
      .then(function (r) { return base64ToUtf8(r.content); });
  };
  ServerBackend.prototype.commits = function (limit) {
    return this._req('commits?limit=' + (limit || 20)).then(function (r) { return r.commits; });
  };
  ServerBackend.prototype.commitFiles = function (files, message, baseSha, onProgress) {
    var self = this;
    var report = onProgress || function () {};
    var done = 0;
    return sequential(files, function (f) {
      var body = ('base64' in f) ? { base64: f.base64 } : { text: f.text };
      return self._req('blob', { method: 'POST', body: body }).then(function (r) {
        done++;
        report('업로드 ' + done + '/' + files.length + ' — ' + f.path);
        return { path: f.path, sha: r.sha };
      });
    }).then(function (items) {
      report('홈페이지에 반영하는 중…');
      return self._req('publish', { method: 'POST', body: { items: items, message: message, baseSha: baseSha } });
    });
  };

  /* ============================================================
     2) 토큰 모드 — 브라우저가 GitHub API 를 직접 호출
     ============================================================ */
  var API = 'https://api.github.com';

  function TokenBackend(cfg) {
    this.mode = 'token';
    this.owner = cfg.owner;
    this.repo = cfg.repo;
    this.branch = cfg.branch;
    this.token = '';
  }

  TokenBackend.prototype._req = function (path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (options.body) headers['Content-Type'] = 'application/json';

    return fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (data) {
        if (!res.ok) {
          var msg = (data && data.message) || ('오류 ' + res.status);
          if (res.status === 401) msg = '토큰이 유효하지 않습니다. 다시 로그인해 주세요.';
          if (res.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
          if (res.status === 409) msg = '다른 곳에서 홈페이지가 먼저 수정되었습니다. 새로고침 후 다시 시도해 주세요.';
          var e = new Error(msg);
          e.status = res.status;
          throw e;
        }
        return data;
      });
    });
  };

  TokenBackend.prototype._base = function () { return '/repos/' + this.owner + '/' + this.repo; };

  TokenBackend.prototype.login = function (creds) {
    this.token = String(creds.token || '').trim();
    if (!this.token) return Promise.reject(new Error('토큰을 입력해 주세요.'));
    return this.verify();
  };
  TokenBackend.prototype.verify = function () {
    var self = this;
    return this._req(this._base()).then(function (repo) {
      if (!(repo.permissions && repo.permissions.push)) {
        throw new Error('이 토큰에는 수정 권한이 없습니다. 토큰 권한에서 Contents 를 Read and write 로 설정해 주세요.');
      }
      return { user: repo.full_name };
    });
  };
  TokenBackend.prototype.logout = function () { this.token = ''; return Promise.resolve(); };
  TokenBackend.prototype.headSha = function () {
    return this._req(this._base() + '/git/ref/heads/' + this.branch).then(function (r) { return r.object.sha; });
  };
  TokenBackend.prototype.getFile = function (path, ref) {
    return this._req(this._base() + '/contents/' + encodeURI(path) + '?ref=' + encodeURIComponent(ref || this.branch))
      .then(function (r) { return base64ToUtf8(r.content); });
  };
  TokenBackend.prototype.commits = function (limit) {
    return this._req(this._base() + '/commits?sha=' + this.branch + '&per_page=' + (limit || 20))
      .then(function (list) {
        return list.map(function (x) {
          return { sha: x.sha, message: x.commit.message, date: x.commit.author.date, author: x.commit.author.name, url: x.html_url };
        });
      });
  };
  TokenBackend.prototype.commitFiles = function (files, message, baseSha, onProgress) {
    var self = this;
    var report = onProgress || function () {};
    var parent, baseTree;

    return this.headSha().then(function (sha) {
      if (baseSha && baseSha !== sha) {
        throw new Error('다른 곳에서 홈페이지가 먼저 수정되었습니다. 새로고침 후 다시 시도해 주세요.');
      }
      parent = sha;
      return self._req(self._base() + '/git/commits/' + sha);
    }).then(function (c) {
      baseTree = c.tree.sha;
      var done = 0;
      return sequential(files, function (f) {
        var body = ('base64' in f) ? { content: f.base64, encoding: 'base64' } : { content: f.text, encoding: 'utf-8' };
        return self._req(self._base() + '/git/blobs', { method: 'POST', body: body }).then(function (blob) {
          done++;
          report('업로드 ' + done + '/' + files.length + ' — ' + f.path);
          return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
        });
      });
    }).then(function (tree) {
      report('홈페이지에 반영하는 중…');
      return self._req(self._base() + '/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: tree } });
    }).then(function (tree) {
      return self._req(self._base() + '/git/commits', { method: 'POST', body: { message: message, tree: tree.sha, parents: [parent] } });
    }).then(function (commit) {
      return self._req(self._base() + '/git/refs/heads/' + self.branch, { method: 'PATCH', body: { sha: commit.sha, force: false } })
        .then(function () { return { sha: commit.sha, url: commit.html_url }; });
    });
  };

  /* ============================================================
     모드 판별 — /api/config 가 응답하면 서버 모드
     ============================================================ */
  function detectBackend(cfg) {
    return fetch('/api/config', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('no api');
        return res.json();
      })
      .then(function (data) {
        if (!data || data.mode !== 'server') throw new Error('no api');
        return new ServerBackend(data);
      })
      .catch(function () {
        return new TokenBackend(cfg);
      });
  }

  global.Backend = {
    detect: detectBackend,
    Server: ServerBackend,
    Token: TokenBackend,
    utf8ToBase64: utf8ToBase64,
    base64ToUtf8: base64ToUtf8
  };
})(window);
