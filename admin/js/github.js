/* ============================================================
   github.js — 브라우저에서 GitHub 리포지토리를 직접 읽고 커밋하는 클라이언트
   여러 파일을 한 번의 커밋으로 묶기 위해 Git Data API(blob/tree/commit/ref)를 사용한다.
   ============================================================ */
(function (global) {
  'use strict';

  var API = 'https://api.github.com';

  /* ---------- base64 ↔ UTF-8 (한글 안전) ---------- */
  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function bufferToBase64(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  /* ---------- 클라이언트 ---------- */
  function GitHub(opts) {
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.branch = opts.branch || 'main';
    this.token = opts.token || '';
  }

  GitHub.prototype.setToken = function (t) { this.token = (t || '').trim(); };

  GitHub.prototype._req = function (path, options) {
    options = options || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (options.body) headers['Content-Type'] = 'application/json';

    return fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (json) {
        if (!res.ok) {
          var msg = (json && json.message) || ('HTTP ' + res.status);
          if (res.status === 401) msg = '토큰이 유효하지 않습니다. 다시 로그인해 주세요.';
          if (res.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
          if (res.status === 404) msg = '대상을 찾을 수 없습니다. (' + path + ')';
          if (res.status === 409) msg = '다른 곳에서 먼저 수정되었습니다. 새로고침 후 다시 시도해 주세요.';
          var err = new Error(msg);
          err.status = res.status;
          err.detail = json;
          throw err;
        }
        return json;
      });
    });
  };

  var base = function (gh) { return '/repos/' + gh.owner + '/' + gh.repo; };

  /* 토큰 검증 + 쓰기 권한 확인 */
  GitHub.prototype.verify = function () {
    var self = this;
    return this._req(base(this)).then(function (repo) {
      return {
        name: repo.full_name,
        canPush: !!(repo.permissions && repo.permissions.push),
        defaultBranch: repo.default_branch,
        htmlUrl: repo.html_url
      };
    });
  };

  /* 브랜치 HEAD 커밋 sha */
  GitHub.prototype.headSha = function () {
    return this._req(base(this) + '/git/ref/heads/' + this.branch)
      .then(function (r) { return r.object.sha; });
  };

  /* 커밋 이력 */
  GitHub.prototype.commits = function (limit) {
    return this._req(base(this) + '/commits?sha=' + this.branch + '&per_page=' + (limit || 20));
  };

  /* 특정 커밋 시점의 파일 원문 */
  GitHub.prototype.getFileAt = function (path, ref) {
    return this._req(base(this) + '/contents/' + encodeURI(path) + '?ref=' + encodeURIComponent(ref))
      .then(function (r) { return base64ToUtf8(r.content); });
  };

  /* 디렉터리 목록 (재귀 트리) */
  GitHub.prototype.tree = function (ref) {
    return this._req(base(this) + '/git/trees/' + encodeURIComponent(ref) + '?recursive=1');
  };

  /**
   * 여러 파일을 한 번의 커밋으로 반영한다.
   * files: [{ path, text }]  또는  [{ path, base64 }]  또는  [{ path, remove:true }]
   * 반환: { sha, url }
   */
  GitHub.prototype.commit = function (files, message, onProgress) {
    var self = this;
    var parentSha, baseTreeSha;
    var report = onProgress || function () {};

    return this.headSha()
      .then(function (sha) {
        parentSha = sha;
        report('기준 버전 확인 완료');
        return self._req(base(self) + '/git/commits/' + sha);
      })
      .then(function (c) {
        baseTreeSha = c.tree.sha;
        report('파일 업로드 준비 (' + files.length + '개)');
        // blob 생성 (삭제 항목 제외)
        var uploads = files.filter(function (f) { return !f.remove; });
        var done = 0;
        return sequential(uploads, function (f) {
          var body = ('base64' in f)
            ? { content: f.base64, encoding: 'base64' }
            : { content: f.text, encoding: 'utf-8' };
          return self._req(base(self) + '/git/blobs', { method: 'POST', body: body })
            .then(function (blob) {
              done++;
              report('업로드 ' + done + '/' + uploads.length + ' — ' + f.path);
              return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
            });
        });
      })
      .then(function (treeItems) {
        files.filter(function (f) { return f.remove; }).forEach(function (f) {
          treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
        });
        report('변경 목록 구성');
        return self._req(base(self) + '/git/trees', {
          method: 'POST',
          body: { base_tree: baseTreeSha, tree: treeItems }
        });
      })
      .then(function (tree) {
        report('커밋 생성');
        return self._req(base(self) + '/git/commits', {
          method: 'POST',
          body: { message: message, tree: tree.sha, parents: [parentSha] }
        });
      })
      .then(function (commit) {
        report('발행 반영');
        return self._req(base(self) + '/git/refs/heads/' + self.branch, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false }
        }).then(function () { return { sha: commit.sha, url: commit.html_url }; });
      });
  };

  /* 순차 실행 (동시 요청 폭주 방지) */
  function sequential(items, fn) {
    var out = [];
    return items.reduce(function (p, item) {
      return p.then(function () {
        return fn(item).then(function (r) { out.push(r); });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  GitHub.utf8ToBase64 = utf8ToBase64;
  GitHub.base64ToUtf8 = base64ToUtf8;
  GitHub.bufferToBase64 = bufferToBase64;

  global.GitHub = GitHub;
})(window);
