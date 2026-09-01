/* ============================================================
   app.js — 한맥아이피에스 홈페이지 관리자
   ============================================================ */
(function () {
  'use strict';

  var CONFIG = {
    owner: 'firstmk111-code',
    repo: 'hanmec',
    branch: 'main',
    file: 'index.html',
    site: 'https://firstmk111-code.github.io/hanmec/',
    uploadDir: 'images/up/'
  };

  var LS_TOKEN = 'hanmec.admin.token';

  /** 이미지 썸네일은 라이브 홈페이지에서 직접 불러온다 (관리자가 다른 도메인이어도 동작) */
  function assetUrl(path) { return CONFIG.site + String(path).replace(/^\/+/, ''); }

  var S = {
    be: null,
    doc: null,
    headSha: null,
    imgChanges: {},   // 원본경로 → { newPath, base64, previewUrl, fileName }
    blockCache: {},   // pageKey('__shell__' 포함) → 블록 배열
    changed: {        // 패널별 변경 표시
      images: 0, text: 0, perf: 0, detail: 0, board: 0, info: 0, seo: 0
    },
    curImgTab: 'about',
    curPerfTab: null,
    curPage: null,
    curDetail: null
  };

  /* ===================== 유틸 ===================== */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function toast(msg, kind, ms) {
    var t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    $('#toast').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(function () { t.remove(); }, 300); }, ms || 3200);
  }
  function busy(on, msg) {
    $('#busy').hidden = !on;
    if (msg) $('#busyMsg').textContent = msg;
  }
  function esc(s) { return SiteDoc.escapeHtml(s); }

  function confirmBox(title, bodyNode, okLabel) {
    return new Promise(function (resolve) {
      var box = el('div', { class: 'modal' }, [
        el('div', { class: 'modal-box' }, [
          el('header', { text: title }),
          el('div', { class: 'body' }, [bodyNode]),
          el('footer', {}, [
            el('button', { class: 'btn', text: '취소', onclick: function () { host.innerHTML = ''; resolve(false); } }),
            el('button', { class: 'btn primary', text: okLabel || '확인', onclick: function () { host.innerHTML = ''; resolve(true); } })
          ])
        ])
      ]);
      var host = $('#modalHost');
      host.innerHTML = '';
      host.appendChild(box);
      box.addEventListener('click', function (e) { if (e.target === box) { host.innerHTML = ''; resolve(false); } });
    });
  }

  /* ===================== 로그인 ===================== */

  /* 로컬(localhost)에서만 동작하는 읽기 전용 미리보기 모드.
     실제 배포 도메인에서는 hostname 조건 때문에 절대 활성화되지 않는다. */
  function isLocalPreview() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) &&
      /(\?|&)preview(=|&|$)/.test(location.search);
  }

  function startLocalPreview() {
    S.be = {
      mode: 'preview',
      headSha: function () { return Promise.resolve('local-preview'); },
      getFile: function () {
        return fetch('../' + CONFIG.file, { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('로컬'); return r.text(); })
          .catch(function () { return fetch(assetUrl(CONFIG.file), { cache: 'no-store' }).then(function (r) { return r.text(); }); });
      },
      commits: function () { return Promise.resolve([]); },
      commitFiles: function () { return Promise.reject(new Error('미리보기 모드에서는 발행할 수 없습니다.')); },
      logout: function () { return Promise.resolve(); }
    };
    window.__admin = S;   // 로컬 점검용
    busy(true, '미리보기 불러오는 중…');
    loadSite().then(function () {
      $('#login').hidden = true;
      $('#shell').classList.add('on');
      busy(false);
      toast('로컬 미리보기 모드 — 발행은 되지 않습니다.', 'warn', 5000);
      return offerDraft();
    }).catch(function (e) { busy(false); loginError(e.message); });
  }

  function initLogin() {
    if (isLocalPreview()) return startLocalPreview();

    busy(true, '연결 중…');
    Backend.detect({ owner: CONFIG.owner, repo: CONFIG.repo, branch: CONFIG.branch }).then(function (be) {
      S.be = be;
      busy(false);

      if (be.mode === 'server') {
        $('#loginServer').hidden = false;
        $('#userInput').value = be.user || 'admin';
        setTimeout(function () { $('#passInput').focus(); }, 60);
        // 이미 로그인된 세션이 있으면 바로 들어간다
        be.verify().then(function () { return enterAdmin(); }).catch(function () {});
      } else {
        $('#loginToken').hidden = false;
        $('#tokenHelp').hidden = false;
        var saved = localStorage.getItem(LS_TOKEN);
        if (saved) { $('#tokenInput').value = saved; submitLogin(true); }
      }

      $('#loginBtn').addEventListener('click', function () { submitLogin(false); });
      ['#userInput', '#passInput', '#tokenInput'].forEach(function (sel) {
        var e = $(sel);
        if (e) e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submitLogin(false); });
      });
    });

    $('#logout').addEventListener('click', function () {
      if (hasChanges() && !window.confirm('저장하지 않은 변경사항이 있습니다. 정말 로그아웃할까요?')) return;
      localStorage.removeItem(LS_TOKEN);
      Promise.resolve(S.be && S.be.logout ? S.be.logout() : null).then(function () { location.reload(); });
    });
  }

  function loginError(msg) {
    var e = $('#loginErr');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  function enterAdmin() {
    return loadSite().then(function () {
      $('#login').hidden = true;
      $('#shell').classList.add('on');
      initAccount();
      busy(false);
      return offerDraft();     // 발행 안 하고 남겨둔 작업이 있으면 이어서 할지 물어본다
    });
  }

  function submitLogin(silent) {
    var be = S.be;
    if (!be) return;
    loginError('');

    var creds;
    if (be.mode === 'server') {
      creds = { user: $('#userInput').value.trim(), pass: $('#passInput').value };
      if (!creds.pass) { loginError('비밀번호를 입력해 주세요.'); return; }
    } else {
      creds = { token: $('#tokenInput').value.trim() };
      if (!creds.token) { loginError('토큰을 입력해 주세요.'); return; }
    }

    busy(true, '로그인 중…');
    be.login(creds)
      .then(function () {
        if (be.mode === 'token' && $('#remember').checked) localStorage.setItem(LS_TOKEN, creds.token);
        return enterAdmin();
      })
      .then(function () { toast('로그인되었습니다.', 'ok'); })
      .catch(function (err) {
        busy(false);
        if (silent && be.mode === 'token') localStorage.removeItem(LS_TOKEN);
        loginError(err.message);
      });
  }

  /* ===================== 임시저장 (작업 중 내용 보관) =====================
     발행 전에 새로고침하거나 창을 닫아도 작업한 내용이 날아가지 않도록
     브라우저 안(IndexedDB)에 자동으로 보관해 둔다.
     이미지 파일까지 담기 때문에 용량이 큰 localStorage 대신 IndexedDB 를 쓴다.
     발행에 성공하거나 사용자가 "변경 취소" 를 누르면 지운다. */

  var DRAFT_DB = 'hanmec-admin', DRAFT_STORE = 'draft', DRAFT_KEY = 'current';
  var draftTimer = null;
  /* 첫 로딩이 끝나고 "이어서 작업" 여부를 물어보기 전까지는 임시저장본에 손대지 않는다.
     (로딩 중에도 변경사항 표시가 갱신되는데, 그때 저장본이 지워지면 안 되기 때문) */
  var draftReady = false;

  function withStore(mode) {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('no idb'));
      var req = indexedDB.open(DRAFT_DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DRAFT_STORE)) req.result.createObjectStore(DRAFT_STORE);
      };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction(DRAFT_STORE, mode);
          resolve({ store: tx.objectStore(DRAFT_STORE), db: db });
        } catch (e) { reject(e); }
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function draftSave() {
    if (!S.doc || !hasChanges()) return draftClear();
    var payload = {
      html: S.doc.serialize(),
      headSha: S.headSha,
      changed: S.changed,
      imgChanges: S.imgChanges,
      savedAt: new Date().toISOString()
    };
    withStore('readwrite').then(function (h) {
      var r = h.store.put(payload, DRAFT_KEY);
      r.onsuccess = function () { showDraftMark(payload.savedAt); };
      r.onerror = function () { /* 용량 초과 등 — 조용히 넘어간다 */ };
    }).catch(function () {});
  }

  function draftLoad() {
    return withStore('readonly').then(function (h) {
      return new Promise(function (resolve) {
        var r = h.store.get(DRAFT_KEY);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function draftClear() {
    showDraftMark(null);
    return withStore('readwrite').then(function (h) { h.store.delete(DRAFT_KEY); }).catch(function () {});
  }

  function draftTouch() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(draftSave, 1200);
  }

  function showDraftMark(iso) {
    var e = $('#draftMark');
    if (!e) return;
    if (!iso) { e.hidden = true; return; }
    var d = new Date(iso);
    e.hidden = false;
    e.textContent = '임시저장됨 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* 저장해 둔 작업이 있으면 이어서 할지 물어본다 */
  function offerDraft() {
    return draftLoad().then(function (dr) {
      if (!dr || !dr.html) { draftReady = true; return false; }

      var parts = [];
      var c = dr.changed || {};
      if (c.images) parts.push('이미지 ' + c.images + '건');
      if (c.text) parts.push('문구 ' + c.text + '건');
      if (c.perf) parts.push('주요실적 ' + c.perf + '건');
      if (c.detail) parts.push('제품 ' + c.detail + '건');
      if (c.board) parts.push('게시물 ' + c.board + '건');
      if (c.info) parts.push('회사정보 ' + c.info + '건');
      if (c.seo) parts.push('SEO 설정');

      var when = new Date(dr.savedAt);
      var stale = dr.headSha && S.headSha && dr.headSha !== S.headSha;

      var body = el('div', {}, [
        el('p', { text: '발행하지 않고 남겨둔 작업이 있습니다.' }),
        el('p', { class: 'hint', style: 'margin-top:6px',
          text: when.getFullYear() + '.' + pad(when.getMonth() + 1) + '.' + pad(when.getDate()) + ' ' +
                pad(when.getHours()) + ':' + pad(when.getMinutes()) + ' 에 마지막으로 저장됨' }),
        parts.length ? el('ul', { style: 'margin:12px 0 0 18px' }, parts.map(function (p) { return el('li', { text: p }); })) : null,
        stale ? el('p', { class: 'hint', style: 'margin-top:14px;color:var(--warn)',
          text: '※ 그 사이 홈페이지가 다른 곳에서 수정되었습니다. 이어서 작업하면 그 수정이 덮어써질 수 있으니, 되도록 새로 시작하시길 권합니다.' }) : null,
        el('p', { class: 'hint', style: 'margin-top:14px', text: '이어서 작업하시겠습니까? “새로 시작”을 고르면 남겨둔 작업은 지워집니다.' })
      ]);

      return confirmBox('이어서 작업하기', body, '이어서 작업').then(function (ok) {
        if (!ok) {
          draftReady = true;
          draftClear();
          return false;
        }
        S.doc = new SiteDoc(dr.html);
        S.doc.restored = true;                 // 발행 버튼이 살아 있도록
        S.imgChanges = dr.imgChanges || {};
        S.changed = dr.changed || S.changed;
        S.blockCache = {};
        prodSel = {};
        draftReady = true;
        buildAll();
        updateChangeUI();
        showDraftMark(dr.savedAt);
        toast('저장해 둔 작업을 불러왔습니다.', 'ok');
        return true;
      });
    }).catch(function () { draftReady = true; });
  }

  /* ===================== 사이트 로드 ===================== */

  function loadSite() {
    busy(true, '홈페이지 내용을 불러오는 중…');
    return S.be.headSha().then(function (sha) {
      S.headSha = sha;
      return S.be.getFile(CONFIG.file, sha);
    }).then(function (html) {
      S.doc = new SiteDoc(html);
      S.blockCache = {};
      S.imgChanges = {};
      prodSel = {};              // 제품 선택 상태도 함께 초기화
      S.changed = { images: 0, text: 0, perf: 0, detail: 0, board: 0, info: 0, seo: 0 };
      buildAll();
      updateChangeUI();
    });
  }

  function blocks(scope) {
    if (!S.blockCache[scope]) {
      S.blockCache[scope] = scope === '__shell__' ? S.doc.shellBlocks() : S.doc.textBlocks(scope);
    }
    return S.blockCache[scope];
  }
  function refreshBlocks(scope) {
    S.blockCache[scope] = scope === '__shell__' ? S.doc.shellBlocks() : S.doc.textBlocks(scope);
  }

  function buildAll() {
    buildDash();
    buildImages();
    buildText();
    buildPerf();
    buildDetail();
    buildBoard();
    buildInfo();
    buildSeo();
  }

  /* ===================== 변경 상태 ===================== */

  function hasChanges() {
    return S.doc && (S.doc.hasChanges() || Object.keys(S.imgChanges).length > 0);
  }

  function updateChangeUI() {
    var n = S.changed.images + S.changed.text + S.changed.perf + S.changed.detail + S.changed.board + S.changed.info + S.changed.seo;
    var lb = $('#chgLabel');
    if (n) { lb.textContent = '변경사항 ' + n + '건'; lb.className = 'chg'; }
    else { lb.textContent = '변경사항 없음'; lb.className = 'chg none'; }
    $('#publishBtn').disabled = !n;
    $('#discardBtn').disabled = !n;

    var map = { nImg: 'images', nTxt: 'text', nPerf: 'perf', nDetail: 'detail', nBoard: 'board', nInfo: 'info', nSeo: 'seo' };
    Object.keys(map).forEach(function (id) {
      var e = document.getElementById(id);
      var v = S.changed[map[id]];
      if (!e) return;
      e.textContent = v;
      e.hidden = !v;
    });

    // 작업 내용을 브라우저에 자동 보관 (발행 전 새로고침해도 남도록)
    if (draftReady) {
      if (n) draftTouch(); else { clearTimeout(draftTimer); draftClear(); }
    }
  }

  /* ===================== 대시보드 ===================== */

  function buildDash() {
    var imgs = S.doc.listImages();
    var pages = S.doc.order.length;
    var perf = S.doc.perfData();
    var perfN = Object.keys(perf).reduce(function (a, k) { return a + perf[k].length; }, 0);
    var txtN = S.doc.order.reduce(function (a, k) {
      return a + blocks(k).filter(function (b) { return b.kind === 'content'; }).length;
    }, 0);

    $('#stats').innerHTML = '';
    [['등록된 이미지', imgs.length, '개'], ['홈페이지 페이지', pages, '개'],
     ['수정 가능한 문구', txtN, '개'], ['등록된 주요실적', perfN, '건']]
      .forEach(function (r) {
        $('#stats').appendChild(el('div', { class: 'stat' }, [
          el('div', { class: 'k', text: r[0] }),
          el('div', { class: 'v', html: r[1] + ' <small>' + r[2] + '</small>' })
        ]));
      });

    loadCommits($('#dashCommits'), 6);
  }

  function loadCommits(host, limit) {
    host.innerHTML = '<div class="empty">불러오는 중…</div>';
    S.be.commits(limit).then(function (list) {
      host.innerHTML = '';
      if (!list.length) { host.innerHTML = '<div class="empty">이력이 없습니다.</div>'; return; }
      list.forEach(function (c) {
        var d = new Date(c.date);
        var dt = d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        host.appendChild(el('div', { class: 'cm' }, [
          el('div', { class: 'dt', text: dt }),
          el('div', { class: 'ms', text: String(c.message).split('\n')[0] }),
          el('a', { href: c.url, target: '_blank', rel: 'noopener', text: '보기 ↗' })
        ]));
      });
    }).catch(function (e) { host.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ===================== 이미지 관리 ===================== */

  function buildImages() {
    var groups = SiteDoc.GROUPS;
    var imgs = S.doc.listImages();
    S.allImages = imgs;

    var counts = {};
    imgs.forEach(function (i) { counts[i.group] = (counts[i.group] || 0) + 1; });

    var tabs = $('#imgTabs');
    tabs.innerHTML = '';
    groups.forEach(function (g) {
      if (!counts[g.id]) return;
      tabs.appendChild(el('button', {
        class: g.id === S.curImgTab ? 'on' : '',
        'data-g': g.id,
        html: esc(g.name) + '<span class="c">' + (counts[g.id] || 0) + '</span>',
        onclick: function () { S.curImgTab = g.id; buildImages(); }
      }));
    });
    if (!counts[S.curImgTab]) {
      var first = groups.filter(function (g) { return counts[g.id]; })[0];
      if (first) { S.curImgTab = first.id; return buildImages(); }
    }

    renderImageGrid();
  }

  function renderImageGrid() {
    var q = ($('#imgSearch').value || '').trim().toLowerCase();
    var onlyChanged = $('#imgOnlyChanged').checked;
    var list = S.allImages.filter(function (i) {
      if (i.group !== S.curImgTab) return false;
      if (onlyChanged && !S.imgChanges[i.path]) return false;
      if (q && (i.label + ' ' + i.path).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    $('#imgCount').textContent = list.length + '개 표시';
    var grid = $('#imgGrid');
    grid.innerHTML = '';
    if (!list.length) { grid.innerHTML = '<div class="empty">해당하는 이미지가 없습니다.</div>'; return; }

    list.forEach(function (im) {
      var ch = S.imgChanges[im.path];
      var src = ch ? ch.previewUrl : assetUrl(im.path);
      var uses = uniq(im.uses.map(useLabel));

      // 원본 이미지가 커서(전체 60MB 이상) 브라우저 기본 지연 로딩에 맡긴다
      var thumbBox = el('div', { class: 'thumb' }, [
        el('img', { src: src, loading: 'lazy', decoding: 'async', alt: '' }),
        ch ? el('span', { class: 'flag', text: '교체됨' }) : null
      ]);

      var card = el('div', { class: 'img-card' + (ch ? ' changed' : '') }, [
        thumbBox,
        el('div', { class: 'img-meta' }, [
          el('div', { class: 'lb', text: im.label || '(설명 없음)' }),
          el('div', { class: 'fn', text: (ch ? ch.fileName : im.path.split('/').pop()) }),
          el('div', { class: 'use' }, uses.map(function (u) { return el('span', { text: u }); }))
        ]),
        el('div', { class: 'img-act' }, [
          el('button', { class: 'btn sm primary', text: ch ? '다시 교체' : '교체', onclick: function () { pickImage(im); } }),
          ch ? el('button', { class: 'btn sm', text: '되돌리기', onclick: function () { undoImage(im.path); } })
             : el('button', { class: 'btn sm', text: '원본', onclick: function () { window.open(assetUrl(im.path), '_blank'); } })
        ])
      ]);
      grid.appendChild(card);
    });
  }

  function useLabel(u) {
    if (u.shell) return '헤더·푸터';
    if (u.css) return '배너';
    if (u.perf) return '실적 · ' + u.perf;
    if (u.product) return '제품 · ' + u.name;
    return u.pageName || u.page;
  }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

  function pickImage(im) {
    var input = $('#filePicker');
    input.value = '';
    input.onchange = function () {
      var f = input.files[0];
      if (!f) return;
      busy(true, '이미지 준비 중…');
      processImage(f).then(function (r) {
        busy(false);
        return previewReplace(im, r);
      }).catch(function (e) { busy(false); toast(e.message, 'err'); });
    };
    input.click();
  }

  function previewReplace(im, r) {
    var body = el('div', {}, [
      el('div', { class: 'cmp' }, [
        el('figure', {}, [el('figcaption', { text: '현재' }), el('div', { class: 'box' }, [el('img', { src: S.imgChanges[im.path] ? S.imgChanges[im.path].previewUrl : assetUrl(im.path) })])]),
        el('figure', {}, [el('figcaption', { text: '새 이미지' }), el('div', { class: 'box' }, [el('img', { src: r.dataUrl })])])
      ]),
      el('p', { class: 'hint', style: 'margin-top:14px', text: '새 이미지: ' + r.name + ' · ' + r.w + '×' + r.h + 'px · ' + fmtSize(r.size) + (r.resized ? ' (자동 최적화됨)' : '') }),
      el('p', { class: 'hint', text: '이 이미지가 쓰인 모든 위치(' + im.uses.length + '곳)가 함께 바뀝니다.' })
    ]);
    return confirmBox('이미지 교체 — ' + (im.label || im.path), body, '이 이미지로 교체').then(function (ok) {
      if (!ok) return;
      var ext = r.ext;
      var base = im.path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '');
      var stamp = stampNow();
      var newPath = CONFIG.uploadDir + (base || 'img') + '-' + stamp + '.' + ext;

      if (!S.imgChanges[im.path]) S.changed.images++;
      S.imgChanges[im.path] = { newPath: newPath, base64: r.base64, previewUrl: r.dataUrl, fileName: r.name };
      renderImageGrid();
      updateChangeUI();
      toast('교체 예약되었습니다. 발행하면 홈페이지에 반영됩니다.', 'ok');
    });
  }

  function undoImage(path) {
    if (!S.imgChanges[path]) return;
    delete S.imgChanges[path];
    S.changed.images = Math.max(0, S.changed.images - 1);
    renderImageGrid();
    updateChangeUI();
  }

  function stampNow() {
    var d = new Date();
    return String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB'; }

  /** 업로드 이미지를 필요 시 축소·압축하고 base64 로 만든다. */
  function processImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject(new Error('이미지 파일만 올릴 수 있습니다.'));
      if (file.size > 20 * 1024 * 1024) return reject(new Error('20MB 이하의 이미지만 올릴 수 있습니다.'));

      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var MAX = 1920;
        var isPng = /png/i.test(file.type);
        var isSvg = /svg/i.test(file.type);
        var needResize = img.width > MAX;
        var needCompress = !isPng && !isSvg && file.size > 600 * 1024;

        if (isSvg || (!needResize && !needCompress)) {
          URL.revokeObjectURL(url);
          return readAsBase64(file).then(function (b64) {
            resolve({
              base64: b64, dataUrl: 'data:' + file.type + ';base64,' + b64,
              ext: extOf(file), name: file.name, size: file.size,
              w: img.width, h: img.height, resized: false
            });
          }).catch(reject);
        }

        var scale = needResize ? MAX / img.width : 1;
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var cx = cv.getContext('2d');
        cx.imageSmoothingQuality = 'high';
        if (!isPng) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }
        cx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        var mime = isPng ? 'image/png' : 'image/jpeg';
        var dataUrl = cv.toDataURL(mime, isPng ? undefined : 0.88);
        var b64 = dataUrl.split(',')[1];
        resolve({
          base64: b64, dataUrl: dataUrl,
          ext: isPng ? 'png' : 'jpg',
          name: file.name, size: Math.round(b64.length * 0.75),
          w: w, h: h, resized: true
        });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다.')); };
      img.src = url;
    });
  }
  function extOf(file) {
    var m = /\.([A-Za-z0-9]+)$/.exec(file.name);
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
    return (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  }
  function readAsBase64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1]); };
      fr.onerror = function () { rej(new Error('파일을 읽을 수 없습니다.')); };
      fr.readAsDataURL(file);
    });
  }

  /* ===================== 텍스트 관리 ===================== */

  function buildText() {
    var sel = $('#txtPage');
    sel.innerHTML = '';
    SiteDoc.GROUPS.forEach(function (g) {
      var og = el('optgroup', { label: g.name });
      g.pages.forEach(function (p) {
        if (!S.doc.pages[p]) return;
        og.appendChild(el('option', { value: p, text: S.doc.pageName(p) }));
      });
      if (og.children.length) sel.appendChild(og);
    });
    if (!S.curPage) S.curPage = sel.value || S.doc.order[0];
    sel.value = S.curPage;
    renderText();
  }

  function renderText() {
    var page = S.curPage;
    var showNav = $('#txtShowNav').checked;
    var q = ($('#txtSearch').value || '').trim().toLowerCase();
    var list = blocks(page).filter(function (b) {
      if (!showNav && b.kind !== 'content') return false;
      if (q && b.text.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    $('#txtCount').textContent = list.length + '개 문구';
    var host = $('#txtList');
    host.innerHTML = '';
    if (!list.length) { host.innerHTML = '<div class="empty">표시할 문구가 없습니다.</div>'; return; }

    list.forEach(function (b) {
      host.appendChild(textBlockNode(page, b));
    });
  }

  function textBlockNode(scope, b) {
    var ta = el('textarea', { rows: Math.min(6, Math.ceil(b.raw.length / 70) || 1) });
    ta.value = b.raw;
    var orig = b.raw;

    var node = el('div', { class: 'blk' + (b.rich ? ' rich' : '') }, [
      el('div', { class: 'bh' }, [
        el('span', { class: 'tagn', text: tagLabel(b) }),
        b.section ? el('span', { class: 'sect', text: b.section }) : null,
        b.kind !== 'content' ? el('span', { class: 'badge gray', text: '메뉴' }) : null,
        b.rich ? el('span', { class: 'badge warn', text: 'HTML 포함 — 태그 유지 필요' }) : null
      ]),
      ta
    ]);

    ta.addEventListener('change', function () {
      var val = ta.value;
      if (val === orig) return;

      if (!val.trim()) {
        toast('내용을 비울 수는 없습니다. 원래대로 되돌립니다.', 'err');
        ta.value = orig;
        return;
      }
      if (/<(section|div|ul|ol|table|h[1-6]|p)\b/i.test(val) && !/<(section|div|ul|ol|table|h[1-6]|p)\b/i.test(orig)) {
        toast('구조를 바꾸는 태그는 넣을 수 없습니다. 원래대로 되돌립니다.', 'err');
        ta.value = orig;
        return;
      }

      var before = blocks(scope);
      var cur = before[b.id];
      if (!cur) { toast('항목을 찾지 못했습니다. 새로고침해 주세요.', 'err'); return; }

      var hadEdit = scope === '__shell__' ? (S.doc.shellEdit !== null) : (S.doc.pageEdits[scope] !== undefined);
      var prevHtml = scope === '__shell__' ? S.doc.shellHtml() : S.doc.pageHtml(scope);
      if (scope === '__shell__') S.doc.applyShellEdits([{ start: cur.start, end: cur.end, html: val }]);
      else S.doc.applyTextEdits(scope, [{ start: cur.start, end: cur.end, html: val }]);

      var count = before.length;
      refreshBlocks(scope);

      // 편집 결과로 문구 개수가 달라지면 이후 편집 위치가 어긋난다 → 되돌린다
      if (blocks(scope).length !== count) {
        if (!hadEdit) {
          // 원래 손대지 않은 페이지였다면 편집 기록 자체를 지운다
          if (scope === '__shell__') S.doc.shellEdit = null; else delete S.doc.pageEdits[scope];
        } else if (scope === '__shell__') {
          S.doc.setShellHtml(prevHtml);
        } else {
          S.doc.setPageHtml(scope, prevHtml);
        }
        refreshBlocks(scope);
        ta.value = orig;
        toast('이 형태로는 수정할 수 없습니다. 원래대로 되돌립니다.', 'err');
        return;
      }

      if (!node.classList.contains('changed')) {
        node.classList.add('changed');
        if (scope === '__shell__') S.changed.info++; else S.changed.text++;
      }
      orig = val;
      updateChangeUI();
    });

    return node;
  }

  function tagLabel(b) {
    var m = { h1: '대제목', h2: '제목', h3: '중제목', h4: '소제목', h5: '소제목', h6: '소제목', p: '본문', li: '목록', td: '표', th: '표머리', a: '링크', span: '문구', div: '문구', button: '버튼', label: '입력라벨', strong: '강조', blockquote: '인용', figcaption: '설명' };
    return (m[b.tag] || b.tag) + (b.cls ? ' · ' + b.cls : '');
  }

  /* ===================== 주요실적 ===================== */

  var PERF_CATS = ['공영주차장', '교육기관', '상업시설', '문화시설', '주차타워'];

  function buildPerf() {
    var perf = S.doc.perfData();
    PERF_CATS.forEach(function (c) { if (!perf[c]) perf[c] = []; });
    if (!S.curPerfTab) S.curPerfTab = PERF_CATS[0];

    var tabs = $('#perfTabs');
    tabs.innerHTML = '';
    PERF_CATS.forEach(function (c) {
      tabs.appendChild(el('button', {
        class: c === S.curPerfTab ? 'on' : '',
        html: esc(c) + '<span class="c">' + (perf[c] || []).length + '</span>',
        onclick: function () { S.curPerfTab = c; buildPerf(); }
      }));
    });
    renderPerf();
  }

  function perfMutate(fn) {
    var perf = JSON.parse(JSON.stringify(S.doc.perfData()));
    PERF_CATS.forEach(function (c) { if (!perf[c]) perf[c] = []; });
    fn(perf);
    S.doc.setPerfData(perf);
    S.changed.perf++;
    updateChangeUI();
  }

  function renderPerf() {
    var perf = S.doc.perfData();
    var cat = S.curPerfTab;
    var list = perf[cat] || [];
    $('#perfCount').textContent = list.length + '건';

    var host = $('#perfList');
    host.innerHTML = '';
    if (!list.length) { host.innerHTML = '<div class="empty">등록된 실적이 없습니다. 위의 “실적 추가”를 눌러 등록하세요.</div>'; return; }

    list.forEach(function (item, idx) {
      var nameIn = el('input', { class: 'input', value: item.n || '', placeholder: '실적(현장) 이름' });
      nameIn.addEventListener('change', function () {
        perfMutate(function (p) { p[cat][idx].n = nameIn.value; });
        toast('저장 대기 중 — 발행하면 반영됩니다.');
      });

      var thumbs = el('div', { class: 'thumbs' });
      (item.imgs || []).forEach(function (src, i) {
        var ch = S.imgChanges[src];
        thumbs.appendChild(el('div', { class: 't' }, [
          el('img', { src: ch ? ch.previewUrl : assetUrl(src), loading: 'lazy', alt: '' }),
          el('button', { title: '삭제', text: '×', onclick: function () {
            perfMutate(function (p) { p[cat][idx].imgs.splice(i, 1); });
            renderPerf();
          } })
        ]));
      });
      thumbs.appendChild(el('div', { class: 'add', text: '+ 사진', onclick: function () { addPerfImage(cat, idx); } }));

      host.appendChild(el('div', { class: 'item' }, [
        el('div', { class: 'ih' }, [
          el('span', { class: 'idx', text: String(idx + 1) }),
          el('div', { style: 'flex:1' }, [nameIn]),
          el('button', { class: 'btn sm', text: '▲', title: '위로', onclick: function () {
            if (idx === 0) return;
            perfMutate(function (p) { var a = p[cat]; var t = a[idx]; a[idx] = a[idx - 1]; a[idx - 1] = t; });
            renderPerf();
          } }),
          el('button', { class: 'btn sm', text: '▼', title: '아래로', onclick: function () {
            if (idx >= list.length - 1) return;
            perfMutate(function (p) { var a = p[cat]; var t = a[idx]; a[idx] = a[idx + 1]; a[idx + 1] = t; });
            renderPerf();
          } }),
          el('button', { class: 'btn sm danger', text: '삭제', onclick: function () {
            if (!window.confirm('“' + (item.n || '이 실적') + '”을(를) 삭제할까요?')) return;
            perfMutate(function (p) { p[cat].splice(idx, 1); });
            buildPerf();
          } })
        ]),
        thumbs
      ]));
    });
  }

  function addPerfImage(cat, idx) {
    var input = $('#filePicker');
    input.value = '';
    input.onchange = function () {
      var f = input.files[0];
      if (!f) return;
      busy(true, '이미지 준비 중…');
      processImage(f).then(function (r) {
        busy(false);
        var stamp = stampNow();
        var newPath = CONFIG.uploadDir + 'perf-' + stamp + '.' + r.ext;
        // 새 파일은 곧바로 업로드 목록에 넣는다 (원본 경로가 없으므로 키를 새 경로로)
        S.imgChanges['__new__' + newPath] = { newPath: newPath, base64: r.base64, previewUrl: r.dataUrl, fileName: r.name, isNew: true };
        S.changed.images++;
        perfMutate(function (p) {
          if (!p[cat][idx].imgs) p[cat][idx].imgs = [];
          p[cat][idx].imgs.push(newPath);
        });
        renderPerf();
        toast('사진이 추가되었습니다.', 'ok');
      }).catch(function (e) { busy(false); toast(e.message, 'err'); });
    };
    input.click();
  }

  $('#perfAdd') && $('#perfAdd').addEventListener('click', function () {
    perfMutate(function (p) { p[S.curPerfTab].push({ n: '새 실적', s: S.curPerfTab, imgs: [] }); });
    buildPerf();
  });

  /* ===================== 제품 관리 ===================== */

  /* 제품은 window.PRODUCTS 배열 하나로 관리한다.
     이 배열이 제품목록 화면과 제품상세 화면을 함께 만든다. */

  var PROD_FIELDS = ['name', 'model', 'cat', 'tagline', 'desc', 'title', 'subtitle', 'badge'];

  /* 홈페이지 제품소개의 분류 탭과 짝을 맞춘 목록.
     주의: "노상무인" 은 화면에 보이는 이름이고 실제 저장값은 "노상주차" 이다.
     (홈페이지 필터가 data-cat="노상주차" 로 걸러내므로 값을 바꾸면 안 된다) */
  var PROD_CATS = [
    { value: '주차관제', label: '주차관제' },
    { value: '주차유도', label: '주차유도' },
    { value: '노상주차', label: '노상무인' },
    { value: '배리어프리 키오스크', label: '배리어프리 키오스크' }
  ];

  function catLabel(v) {
    for (var i = 0; i < PROD_CATS.length; i++) if (PROD_CATS[i].value === v) return PROD_CATS[i].label;
    return v || '분류 없음';
  }

  /* 목록에서 체크한 제품들 (id 집합) */
  var prodSel = {};

  function prodList() { return S.doc.hasProducts() ? S.doc.productsData() : []; }

  function prodMutate(fn) {
    var arr = JSON.parse(JSON.stringify(prodList()));
    fn(arr);
    S.doc.setProductsData(arr);
    S.changed.detail = (S.changed.detail || 0) + 1;
    updateChangeUI();
  }

  function prodById(id) {
    return prodList().filter(function (p) { return p.id === id; })[0] || null;
  }

  function prodIndex(id) {
    var arr = prodList();
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
    return -1;
  }

  function newProdId() {
    var used = {};
    prodList().forEach(function (p) { used[p.id] = 1; });
    for (var i = 1; i < 1000; i++) {
      var id = 'p' + (i < 10 ? '0' : '') + i;
      if (!used[id]) return id;
    }
    return 'p' + stampNow();
  }

  /* ---------- 목록 ---------- */

  function buildDetail() {
    if (!S.doc.hasProducts()) {
      $('#dtList').innerHTML = '<div class="empty">제품 데이터를 찾지 못했습니다. 제작사에 문의해 주세요.</div>';
      $('#dtCatTabs').innerHTML = '';
      return;
    }
    if (S.curDetail && !prodById(S.curDetail)) S.curDetail = null;
    // 고르고 있던 분류가 사라졌으면 전체로 되돌린다
    if (S.curProdCat && prodCats().indexOf(S.curProdCat) < 0) S.curProdCat = null;
    if (S.curDetail) renderProdEdit(); else renderProdList();
  }

  function prodCats() {
    var seen = [];
    prodList().forEach(function (p) { if (p.cat && seen.indexOf(p.cat) < 0) seen.push(p.cat); });
    return seen;
  }

  function renderProdList() {
    $('#dtListView').hidden = false;
    $('#dtEditView').hidden = true;
    S.curDetail = null;

    var cats = prodCats();
    var counts = {};
    prodList().forEach(function (p) { counts[p.cat] = (counts[p.cat] || 0) + 1; });

    var tabs = $('#dtCatTabs');
    tabs.innerHTML = '';
    tabs.appendChild(el('button', {
      class: !S.curProdCat ? 'on' : '',
      html: '전체<span class="c">' + prodList().length + '</span>',
      onclick: function () { S.curProdCat = null; renderProdList(); }
    }));
    cats.forEach(function (c) {
      tabs.appendChild(el('button', {
        class: S.curProdCat === c ? 'on' : '',
        html: esc(catLabel(c)) + '<span class="c">' + (counts[c] || 0) + '</span>',
        onclick: function () { S.curProdCat = c; renderProdList(); }
      }));
    });

    var list = visibleProds();
    $('#dtListCount').textContent = list.length + '개';
    $('#dtOrderHint').hidden = list.length < 2;

    var host = $('#dtList');
    host.innerHTML = '';
    if (!list.length) {
      host.innerHTML = '<div class="empty">해당하는 제품이 없습니다.</div>';
      syncSelUI();
      return;
    }

    list.forEach(function (p, vi) {
      var pending = S.imgChanges['__new__' + p.img];
      var filled = (p.specs && p.specs.length) || (p.feats && p.feats.length);

      var chk = el('input', { type: 'checkbox', title: '선택' });
      chk.checked = !!prodSel[p.id];
      chk.addEventListener('change', function () {
        if (chk.checked) prodSel[p.id] = 1; else delete prodSel[p.id];
        card.classList.toggle('picked', chk.checked);
        syncSelUI();
      });

      var card = el('div', { class: 'img-card' + (prodSel[p.id] ? ' picked' : ''), 'data-pid': p.id }, [
        el('div', { class: 'dt-cardbar' }, [
          el('label', { class: 'dt-chk', title: '선택' }, [chk]),
          el('div', { class: 'sp', style: 'flex:1' }),
          el('button', {
            class: 'btn sm', text: '↑', title: '앞으로', disabled: vi === 0 || null,
            onclick: function () { moveProdBy(p.id, -1); }
          }),
          el('button', {
            class: 'btn sm', text: '↓', title: '뒤로', disabled: vi >= list.length - 1 || null,
            onclick: function () { moveProdBy(p.id, 1); }
          }),
          el('span', { class: 'dt-handle', title: '끌어서 순서 바꾸기', draggable: 'true', text: '☰' })
        ]),
        el('div', { class: 'thumb', style: 'cursor:pointer', onclick: function () { openProd(p.id); } }, [
          el('img', { src: pending ? pending.previewUrl : assetUrl(p.img), loading: 'lazy', alt: '' }),
          filled ? null : el('span', { class: 'flag', style: 'background:var(--slate2)', text: '내용 없음' })
        ]),
        el('div', { class: 'img-meta', style: 'cursor:pointer', onclick: function () { openProd(p.id); } }, [
          el('div', { class: 'lb', text: p.name || '(이름 없음)' }),
          el('div', { class: 'fn', text: p.model || p.tagline || '' }),
          el('div', { class: 'use' }, [
            el('span', { text: catLabel(p.cat) }),
            el('span', { text: '사양 ' + ((p.specs || []).length) }),
            el('span', { text: '특징 ' + ((p.feats || []).length) })
          ])
        ]),
        el('div', { class: 'img-act' }, [
          el('button', { class: 'btn sm primary', text: '수정', onclick: function () { openProd(p.id); } }),
          el('button', { class: 'btn sm', text: '복제', onclick: function () { dupProd(p.id); } }),
          el('button', { class: 'btn sm danger', text: '삭제', onclick: function () { delProd(p.id); } })
        ])
      ]);

      bindProdDrag(card, p.id);
      host.appendChild(card);
    });

    syncSelUI();
  }

  /* 현재 탭·검색이 적용된 뒤 화면에 보이는 제품들 */
  function visibleProds() {
    var q = ($('#dtSearch').value || '').trim().toLowerCase();
    return prodList().filter(function (p) {
      if (S.curProdCat && p.cat !== S.curProdCat) return false;
      if (q && (p.name + ' ' + (p.tagline || '') + ' ' + (p.model || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  /* ---------- 선택 / 일괄 삭제 ---------- */

  function selectedIds() {
    // 화면에 보이는 것 중에서만 (필터를 바꿔도 엉뚱한 게 지워지지 않도록)
    return visibleProds().map(function (p) { return p.id; }).filter(function (id) { return prodSel[id]; });
  }

  function syncSelUI() {
    var vis = visibleProds();
    var sel = selectedIds();
    var btn = $('#dtBulkDelete');
    btn.hidden = sel.length === 0;
    btn.textContent = '선택 삭제 (' + sel.length + ')';

    var all = $('#dtSelectAll');
    all.checked = vis.length > 0 && sel.length === vis.length;
    all.indeterminate = sel.length > 0 && sel.length < vis.length;
    all.disabled = vis.length === 0;
  }

  function toggleSelectAll(on) {
    visibleProds().forEach(function (p) {
      if (on) prodSel[p.id] = 1; else delete prodSel[p.id];
    });
    renderProdList();
  }

  function bulkDelete() {
    var ids = selectedIds();
    if (!ids.length) return;
    var names = ids.map(function (id) { return (prodById(id) || {}).name || id; });

    var body = el('div', {}, [
      el('p', { text: '선택한 ' + ids.length + '개의 제품을 삭제하시겠습니까?' }),
      el('ul', { style: 'margin:10px 0 0 18px;max-height:220px;overflow:auto' },
        names.map(function (n) { return el('li', { text: n }); })),
      el('p', { class: 'hint', style: 'margin-top:14px', text: '삭제 후 저장하고 발행하면 홈페이지에서도 삭제됩니다.' })
    ]);

    confirmBox('선택 제품 삭제', body, '삭제').then(function (ok) {
      if (!ok) return;
      prodMutate(function (arr) {
        for (var i = arr.length - 1; i >= 0; i--) {
          if (ids.indexOf(arr[i].id) >= 0) arr.splice(i, 1);
        }
      });
      ids.forEach(function (id) { delete prodSel[id]; });
      if (ids.indexOf(S.curDetail) >= 0) S.curDetail = null;
      renderProdList();
      toast(ids.length + '개 제품이 삭제되었습니다. 발행하면 홈페이지에 반영됩니다.', 'ok');
    });
  }

  /* ---------- 노출 순서 ---------- */

  /* 화면에 보이는 목록에서 한 칸 옮긴다.
     실제로는 전체 배열에서 "이웃한 보이는 제품"의 자리로 이동시키므로
     숨겨진 제품들끼리의 순서는 그대로 유지된다. */
  function moveProdBy(id, dir) {
    var vis = visibleProds();
    var vi = -1;
    for (var i = 0; i < vis.length; i++) if (vis[i].id === id) vi = i;
    if (vi < 0) return;
    var target = vis[vi + dir];
    if (!target) return;
    moveProdTo(id, target.id, dir > 0);
  }

  /* srcId 를 targetId 자리로 옮긴다 */
  function moveProdTo(srcId, targetId, after) {
    if (srcId === targetId) return;
    prodMutate(function (arr) {
      var from = -1, to = -1;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === srcId) from = i;
        if (arr[i].id === targetId) to = i;
      }
      if (from < 0 || to < 0) return;
      var item = arr.splice(from, 1)[0];
      var idx = -1;
      for (var j = 0; j < arr.length; j++) if (arr[j].id === targetId) idx = j;
      arr.splice(after ? idx + 1 : idx, 0, item);
    });
    renderProdList();
  }

  /* 드래그 앤 드롭 (핸들 ☰ 로만 시작) */
  var dragSrcId = null;

  function bindProdDrag(card, id) {
    var handle = card.querySelector('.dt-handle');

    handle.addEventListener('dragstart', function (e) {
      dragSrcId = id;
      card.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', id); } catch (err) {}
      }
    });
    handle.addEventListener('dragend', function () {
      dragSrcId = null;
      $$('#dtList .img-card').forEach(function (c) { c.classList.remove('dragging', 'dragover'); });
    });

    card.addEventListener('dragover', function (e) {
      if (!dragSrcId || dragSrcId === id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      card.classList.add('dragover');
    });
    card.addEventListener('dragleave', function () { card.classList.remove('dragover'); });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      card.classList.remove('dragover');
      var src = dragSrcId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      if (!src || src === id) return;
      // 원래 위치보다 뒤로 끌었으면 대상 뒤에, 앞으로 끌었으면 대상 앞에
      var vis = visibleProds().map(function (p) { return p.id; });
      moveProdTo(src, id, vis.indexOf(src) < vis.indexOf(id));
      dragSrcId = null;
    });
  }

  function openProd(id) {
    S.curDetail = id;
    S.curProdTab = 'basic';
    renderProdEdit();
    window.scrollTo(0, 0);
  }

  function dupProd(id) {
    var src = prodById(id);
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = newProdId();
    copy.name = src.name + ' (복사본)';
    prodMutate(function (arr) { arr.splice(prodIndex(id) + 1, 0, copy); });
    renderProdList();
    toast('복제되었습니다. 이름과 내용을 고쳐 주세요.', 'ok');
  }

  function delProd(id) {
    var p = prodById(id);
    if (!p) return;
    if (!window.confirm('“' + p.name + '” 제품을 목록에서 지울까요?\n제품소개 화면에서도 사라집니다.')) return;
    prodMutate(function (arr) { arr.splice(prodIndex(id), 1); });
    if (S.curDetail === id) S.curDetail = null;
    renderProdList();
    toast('삭제되었습니다.');
  }

  function addProd() {
    var id = newProdId();
    var cat = S.curProdCat || PROD_CATS[0].value;
    prodMutate(function (arr) {
      arr.push({ id: id, cat: cat, name: '새 제품', model: '', tagline: '', title: '', subtitle: '', badge: '', img: '', detailImg: '', desc: '', specs: [], feats: [] });
    });
    openProd(id);
    toast('새 제품이 만들어졌습니다. 내용을 채워 주세요.', 'ok');
  }

  /* ---------- 편집 ---------- */

  function renderProdEdit() {
    var p = prodById(S.curDetail);
    if (!p) { renderProdList(); return; }

    $('#dtListView').hidden = true;
    $('#dtEditView').hidden = false;
    $('#dtEditName').textContent = p.name || '(이름 없음)';
    $('#dtEditSub').textContent = [p.model, catLabel(p.cat)].filter(Boolean).join(' · ');
    $('#dtViewLive').href = CONFIG.site + '#detail/' + p.id;
    $('#dtSpecN').textContent = (p.specs || []).length;
    $('#dtFeatN').textContent = (p.feats || []).length;

    fillCatSelect(p.cat);

    // 기본정보 입력칸
    PROD_FIELDS.forEach(function (f) {
      var input = document.querySelector('[data-panel="detail"] [data-f="' + f + '"]');
      if (!input) return;
      if (f !== 'cat') input.value = p[f] || '';   // 분류는 fillCatSelect 가 세팅
      input.oninput = null;
      input.onchange = function () {
        var v = input.value;
        prodMutate(function (arr) { arr[prodIndex(p.id)][f] = v; });
        if (f === 'name' || f === 'model' || f === 'cat') {
          var np = prodById(p.id);
          $('#dtEditName').textContent = np.name || '(이름 없음)';
          $('#dtEditSub').textContent = [np.model, catLabel(np.cat)].filter(Boolean).join(' · ');
        }
      };
    });

    prodTab(S.curProdTab || 'basic');
    renderSpecRows();
    renderFeatRows();
    renderProdImages();
  }

  /* 분류 드롭다운.
     정해진 4개 외의 값이 저장돼 있으면 그 값을 지우지 않고 맨 위에
     "(현재 값)" 으로 함께 보여준다. 사용자가 정상 분류로 바꿀 때까지 유지된다. */
  function fillCatSelect(current) {
    var sel = $('#dtCatSelect');
    if (!sel) return;
    sel.innerHTML = '';

    var known = PROD_CATS.some(function (c) { return c.value === current; });
    if (!known) {
      sel.appendChild(el('option', {
        value: current || '',
        text: current ? '현재 값: ' + current + ' (분류를 골라 주세요)' : '분류를 골라 주세요'
      }));
    }
    PROD_CATS.forEach(function (c) {
      sel.appendChild(el('option', { value: c.value, text: c.label }));
    });
    sel.value = current || '';
    if (sel.value !== (current || '')) sel.value = PROD_CATS[0].value;
  }

  function prodTab(t) {
    S.curProdTab = t;
    $$('#dtTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    $$('[data-panel="detail"] .dt-tab').forEach(function (c) { c.hidden = c.dataset.t !== t; });
  }

  /* ---------- 표 ---------- */

  function prodRows(which) {
    var p = prodById(S.curDetail);
    if (!p) return [];
    return (which === 'spec' ? p.specs : p.feats) || [];
  }

  function writeProdRows(which, rows) {
    var id = S.curDetail;
    prodMutate(function (arr) {
      var p = arr[prodIndex(id)];
      if (which === 'spec') p.specs = rows; else p.feats = rows;
    });
    $('#dtSpecN').textContent = (prodById(id).specs || []).length;
    $('#dtFeatN').textContent = (prodById(id).feats || []).length;
  }

  function renderSpecRows() {
    var rows = prodRows('spec');
    var host = $('#dtSpecRows');
    host.innerHTML = '';
    $('#dtSpecCount').textContent = rows.length + '행';
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="6" class="empty">아직 사양이 없습니다. “행 추가”를 눌러 등록하세요.</td></tr>';
      return;
    }
    rows.forEach(function (r, i) {
      function cell(ci, ph) {
        var e = el('input', { class: 'input', value: r[ci] || '', placeholder: ph });
        e.addEventListener('change', function () {
          var cur = JSON.parse(JSON.stringify(prodRows('spec')));
          while (cur[i].length < 4) cur[i].push('');
          cur[i][ci] = e.value;
          writeProdRows('spec', cur);
        });
        return e;
      }
      host.appendChild(el('tr', {}, [
        el('td', { class: 'rn', text: String(i + 1) }),
        el('td', {}, [cell(0, '사용전원')]),
        el('td', {}, [cell(1, 'AC220V')]),
        el('td', {}, [cell(2, '조명사양')]),
        el('td', {}, [cell(3, 'IR LED')]),
        el('td', {}, [prodRowTools('spec', i, rows.length)])
      ]));
    });
  }

  function renderFeatRows() {
    var rows = prodRows('feat');
    var host = $('#dtFeatRows');
    host.innerHTML = '';
    $('#dtFeatCount').textContent = rows.length + '행';
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="4" class="empty">아직 특징이 없습니다. “행 추가”를 눌러 등록하세요.</td></tr>';
      return;
    }
    rows.forEach(function (r, i) {
      function cell(ci, ph) {
        var e = el('input', { class: 'input', value: r[ci] || '', placeholder: ph });
        e.addEventListener('change', function () {
          var cur = JSON.parse(JSON.stringify(prodRows('feat')));
          while (cur[i].length < 2) cur[i].push('');
          cur[i][ci] = e.value;
          writeProdRows('feat', cur);
        });
        return e;
      }
      host.appendChild(el('tr', {}, [
        el('td', { class: 'rn', text: String(i + 1) }),
        el('td', {}, [cell(0, '01')]),
        el('td', {}, [cell(1, '기능 설명')]),
        el('td', {}, [prodRowTools('feat', i, rows.length)])
      ]));
    });
  }

  function prodRowTools(which, idx, total) {
    var reRender = which === 'spec' ? renderSpecRows : renderFeatRows;
    function rows() { return JSON.parse(JSON.stringify(prodRows(which))); }
    return el('div', { class: 'rowtools' }, [
      el('button', {
        class: 'btn sm', title: '위로', text: '▲', disabled: idx === 0 || null,
        onclick: function () { var r = rows(); var t = r[idx]; r[idx] = r[idx - 1]; r[idx - 1] = t; writeProdRows(which, r); reRender(); }
      }),
      el('button', {
        class: 'btn sm', title: '아래로', text: '▼', disabled: idx >= total - 1 || null,
        onclick: function () { var r = rows(); var t = r[idx]; r[idx] = r[idx + 1]; r[idx + 1] = t; writeProdRows(which, r); reRender(); }
      }),
      el('button', {
        class: 'btn sm danger', title: '삭제', text: '×',
        onclick: function () {
          if (!window.confirm((idx + 1) + '번 행을 삭제할까요?')) return;
          var r = rows(); r.splice(idx, 1); writeProdRows(which, r); reRender();
        }
      })
    ]);
  }

  /* ---------- 이미지 ---------- */

  /* 사양표 아래 이미지(extraImg)는 따로 큰 영역으로 뺐다. renderExtraImg() 참고 */
  var PROD_IMG_SLOTS = [
    { f: 'img', label: '목록 사진', hint: '제품소개 목록 카드에 나옵니다' },
    { f: 'detailImg', label: '상세 대표 사진', hint: '비우면 목록 사진을 씁니다' },
    { f: 'colorImg', label: '색상 견본', hint: '넣으면 색상 안내가 함께 나옵니다' }
  ];

  function renderProdImages() {
    var p = prodById(S.curDetail);
    if (!p) return;
    var host = $('#dtImgSlots');
    host.innerHTML = '';

    PROD_IMG_SLOTS.forEach(function (slot) {
      var src = p[slot.f] || '';
      var pending = src && S.imgChanges['__new__' + src];
      var box = el('div', { class: 'dt-img' }, [
        el('div', { class: 'dt-thumb' }, [
          src ? el('img', { src: pending ? pending.previewUrl : assetUrl(src), alt: '', loading: 'lazy' })
              : el('span', { style: 'color:var(--slate2);font-size:12.5px', text: '없음' })
        ]),
        el('div', { class: 'dt-cap', text: slot.label }),
        el('div', { class: 'dt-fn', text: src ? src.split('/').pop() : slot.hint }),
        el('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:nowrap' }, [
          el('button', { class: 'btn sm', style: 'flex:1', text: src ? '변경' : '등록', onclick: function () { pickProdImage(slot.f, slot.label); } }),
          src ? el('button', {
            class: 'btn sm danger', text: '×', title: '비우기',
            onclick: function () {
              if (slot.f === 'img' && !window.confirm('목록 사진을 비우면 제품 목록에서 빈칸으로 보입니다. 계속할까요?')) return;
              prodMutate(function (arr) { arr[prodIndex(p.id)][slot.f] = ''; });
              renderProdImages();
            }
          }) : null
        ])
      ]);
      host.appendChild(box);
    });

    // 색상 안내 문구 (색상 견본이 있을 때만)
    var ct = $('#dtColorText');
    ct.innerHTML = '';
    if (p.colorImg) {
      ct.appendChild(el('h3', { style: 'font-size:14px;font-weight:800;margin-bottom:10px', text: '색상 안내 문구' }));
      [['colorTitle', '제목', '색상 변경 가능'], ['colorDesc', '설명', '설치 환경과 요청에 맞춰 제품 색상을 변경할 수 있습니다.']]
        .forEach(function (f) {
          var input = el('input', { type: 'text', class: 'input', value: p[f[0]] || '', placeholder: f[2] });
          input.addEventListener('change', function () {
            prodMutate(function (arr) { arr[prodIndex(p.id)][f[0]] = input.value; });
          });
          ct.appendChild(el('label', { class: 'field' }, [el('span', { text: f[1] }), input]));
        });
    }

    renderExtraImg();
  }

  /* 제품 상세페이지에서 "제품사양 표 바로 아래" 에 나오는 이미지 */
  function renderExtraImg() {
    var p = prodById(S.curDetail);
    var host = $('#dtExtraImg');
    if (!p || !host) return;
    host.innerHTML = '';

    var src = p.extraImg || '';
    var pending = src && S.imgChanges['__new__' + src];

    host.appendChild(el('div', { class: 'dt-extrabox' }, [
      el('div', { class: 'dt-extraprev' }, [
        src ? el('img', { src: pending ? pending.previewUrl : assetUrl(src), alt: '', loading: 'lazy' })
            : el('span', { class: 'dt-noimg', text: '등록된 이미지가 없습니다' })
      ]),
      el('div', { class: 'dt-extrainfo' }, [
        el('div', { class: 'dt-fn', style: 'margin:0 0 10px', text: src ? src.split('/').pop() : '이미지를 등록하면 사양표 바로 아래에 표시됩니다.' }),
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn primary', text: src ? '이미지 교체' : '이미지 추가',
            onclick: function () { pickProdImage('extraImg', '사양표 아래', renderExtraImg); }
          }),
          src ? el('button', {
            class: 'btn danger', text: '이미지 삭제',
            onclick: function () {
              if (!window.confirm('사양표 아래 이미지를 삭제할까요?')) return;
              prodMutate(function (arr) { arr[prodIndex(p.id)].extraImg = ''; });
              renderExtraImg();
              toast('삭제되었습니다. 발행하면 홈페이지에 반영됩니다.');
            }
          }) : null
        ])
      ])
    ]));
  }

  function pickProdImage(field, label, after) {
    var id = S.curDetail;
    var input = $('#filePicker');
    input.value = '';
    input.onchange = function () {
      var f = input.files[0];
      if (!f) return;
      busy(true, '이미지 준비 중…');
      processImage(f).then(function (r) {
        busy(false);
        var newPath = CONFIG.uploadDir + 'prod-' + stampNow() + '.' + r.ext;
        S.imgChanges['__new__' + newPath] = {
          newPath: newPath, base64: r.base64, previewUrl: r.dataUrl, fileName: r.name, isNew: true
        };
        S.changed.images++;
        prodMutate(function (arr) { arr[prodIndex(id)][field] = newPath; });
        if (after) after(); else renderProdImages();
        toast(label + ' 이미지가 등록되었습니다.', 'ok');
      }).catch(function (e) { busy(false); toast(e.message, 'err'); });
    };
    input.click();
  }

  /* ===================== 공지사항 · 자료실 ===================== */

  var TD_C = 'padding:17px 10px;text-align:center;color:#33405a';
  var TD_T = 'padding:17px 14px;color:#33405a';
  var TR_S = 'border-bottom:1px solid #eef1f6';

  function findNode(html, pred) {
    var root = SiteDoc.parseNodes(html);
    var hit = null;
    (function walk(n) {
      n.children.forEach(function (c) {
        if (hit) return;
        if (c.tag !== '#text' && pred(c)) { hit = c; return; }
        walk(c);
      });
    })(root);
    return hit;
  }

  function buildBoard() {
    renderNotice();
    renderArchive();
  }

  function noticeModel() {
    var html = S.doc.pageHtml('notice');
    var tbody = findNode(html, function (n) { return n.tag === 'tbody'; });
    if (!tbody) return null;
    var rows = tbody.children.filter(function (c) { return c.tag === 'tr'; }).map(function (tr) {
      var tds = tr.children.filter(function (c) { return c.tag === 'td'; });
      var v = tds.map(function (td) { return SiteDoc.textOf(td).trim(); });
      return { no: v[0] || '', title: v[1] || '', writer: v[2] || '', date: v[3] || '', hit: v[4] || '' };
    });
    return { node: tbody, rows: rows };
  }

  function noticeWrite(rows) {
    var m = noticeModel();
    if (!m) return;
    var body = rows.map(function (r) {
      return '<tr style="' + TR_S + '">' +
        '<td style="' + TD_C + '">' + esc(r.no || '—') + '</td>' +
        '<td style="' + TD_T + '">' + esc(r.title || '') + '</td>' +
        '<td style="' + TD_C + '">' + esc(r.writer || '—') + '</td>' +
        '<td style="' + TD_C + '">' + esc(r.date || '—') + '</td>' +
        '<td style="' + TD_C + '">' + esc(r.hit || '—') + '</td></tr>';
    }).join('');
    var html = S.doc.pageHtml('notice');
    S.doc.setPageHtml('notice', html.slice(0, m.node.contentStart) + body + html.slice(m.node.contentEnd));
    refreshBlocks('notice');
    S.changed.board++;
    updateChangeUI();
  }

  function renderNotice() {
    var m = noticeModel();
    var host = $('#noticeRows');
    host.innerHTML = '';
    if (!m) { host.innerHTML = '<tr><td colspan="6" class="empty">공지 목록을 찾지 못했습니다.</td></tr>'; return; }

    m.rows.forEach(function (r, i) {
      function inp(key, ph) {
        var e = el('input', { class: 'input', value: r[key], placeholder: ph || '' });
        e.addEventListener('change', function () {
          var rows = noticeModel().rows;
          rows[i][key] = e.value;
          noticeWrite(rows);
        });
        return e;
      }
      host.appendChild(el('tr', {}, [
        el('td', {}, [inp('no', '—')]),
        el('td', {}, [inp('title', '공지 제목')]),
        el('td', {}, [inp('writer', '관리자')]),
        el('td', {}, [inp('date', '2026.07.29')]),
        el('td', {}, [inp('hit', '0')]),
        el('td', {}, [el('button', {
          class: 'btn sm danger', text: '삭제', onclick: function () {
            var rows = noticeModel().rows;
            rows.splice(i, 1);
            noticeWrite(rows);
            renderNotice();
          }
        })])
      ]));
    });
  }

  $('#noticeAdd') && $('#noticeAdd').addEventListener('click', function () {
    var m = noticeModel();
    if (!m) return toast('공지 목록을 찾지 못했습니다.', 'err');
    var d = new Date();
    var nums = m.rows.map(function (r) { return parseInt(r.no, 10); }).filter(function (n) { return !isNaN(n); });
    var next = nums.length ? Math.max.apply(null, nums) + 1 : 1;
    m.rows.unshift({ no: String(next), title: '새 공지사항', writer: '관리자', date: d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()), hit: '0' });
    noticeWrite(m.rows);
    renderNotice();
  });

  /* ---------- 자료실 ---------- */

  function archiveModel() {
    var html = S.doc.pageHtml('archive');
    var grid = findNode(html, function (n) { return /(^|\s)arch-grid(\s|$)/.test(SiteDoc.attrOf(n, 'class') || ''); });
    if (!grid) return null;
    var cards = grid.children.filter(function (c) { return c.tag === 'a'; }).map(function (a) {
      var img = findNode(html.slice(a.start, a.end), function (n) { return n.tag === 'img'; });
      var titleN = null, dateN = null;
      (function walk(n) {
        n.children.forEach(function (c) {
          var cls = SiteDoc.attrOf(c, 'class') || '';
          if (/arch-title/.test(cls)) titleN = c;
          if (/arch-date/.test(cls)) dateN = c;
          walk(c);
        });
      })(a);
      return {
        href: SiteDoc.attrOf(a, 'href') || '',
        img: img ? SiteDoc.attrOf(img, 'src') : '',
        title: titleN ? SiteDoc.textOf(titleN).trim() : '',
        date: dateN ? SiteDoc.textOf(dateN).trim() : ''
      };
    });
    return { node: grid, cards: cards };
  }

  function archiveWrite(cards) {
    var m = archiveModel();
    if (!m) return;
    var body = cards.map(function (c) {
      return '<a href="' + esc(c.href || 'javascript:void(0)') + '"' +
        (/^https?:/.test(c.href) ? ' target="_blank" rel="noopener"' : '') + ' class="arch-card">' +
        '<div class="arch-thumb"><img src="' + esc(c.img || '') + '" alt="' + esc(c.title) + '" loading="lazy"></div>' +
        '<div class="arch-body"><div class="arch-title">' + esc(c.title) + '</div>' +
        '<div class="arch-date">' + esc(c.date) + '</div></div></a>';
    }).join('');
    var html = S.doc.pageHtml('archive');
    S.doc.setPageHtml('archive', html.slice(0, m.node.contentStart) + body + html.slice(m.node.contentEnd));
    refreshBlocks('archive');
    S.changed.board++;
    updateChangeUI();
  }

  function renderArchive() {
    var m = archiveModel();
    var host = $('#archList');
    host.innerHTML = '';
    if (!m) { host.innerHTML = '<div class="empty">자료실 목록을 찾지 못했습니다.</div>'; return; }

    m.cards.forEach(function (c, i) {
      function inp(key, ph) {
        var e = el('input', { class: 'input', value: c[key] || '', placeholder: ph });
        e.addEventListener('change', function () {
          var cards = archiveModel().cards;
          cards[i][key] = e.value;
          archiveWrite(cards);
        });
        return e;
      }
      var ch = S.imgChanges[c.img];
      host.appendChild(el('div', { class: 'item' }, [
        el('div', { class: 'ih' }, [
          el('span', { class: 'idx', text: String(i + 1) }),
          el('div', { style: 'flex:1' }, [inp('title', '자료 제목')]),
          el('button', { class: 'btn sm', text: '▲', onclick: function () {
            if (i === 0) return;
            var cards = archiveModel().cards;
            var t = cards[i]; cards[i] = cards[i - 1]; cards[i - 1] = t;
            archiveWrite(cards); renderArchive();
          } }),
          el('button', { class: 'btn sm', text: '▼', onclick: function () {
            var cards = archiveModel().cards;
            if (i >= cards.length - 1) return;
            var t = cards[i]; cards[i] = cards[i + 1]; cards[i + 1] = t;
            archiveWrite(cards); renderArchive();
          } }),
          el('button', { class: 'btn sm danger', text: '삭제', onclick: function () {
            if (!window.confirm('“' + c.title + '”을(를) 삭제할까요?')) return;
            var cards = archiveModel().cards;
            cards.splice(i, 1);
            archiveWrite(cards); renderArchive();
          } })
        ]),
        el('div', { class: 'row', style: 'align-items:flex-start' }, [
          el('div', { class: 'thumbs' }, [
            c.img ? el('div', { class: 't' }, [el('img', { src: ch ? ch.previewUrl : assetUrl(c.img), alt: '' })]) : null,
            el('div', { class: 'add', text: c.img ? '변경' : '+ 사진', onclick: function () { addArchiveImage(i); } })
          ]),
          el('div', { style: 'flex:1;min-width:240px' }, [
            el('label', { class: 'field', style: 'margin:0' }, [el('span', { text: '연결 링크 (선택)' }), inp('href', 'https://…')])
          ]),
          el('div', { style: 'width:150px' }, [
            el('label', { class: 'field', style: 'margin:0' }, [el('span', { text: '등록일' }), inp('date', '2026.07.29')])
          ])
        ])
      ]));
    });
  }

  function addArchiveImage(i) {
    var input = $('#filePicker');
    input.value = '';
    input.onchange = function () {
      var f = input.files[0];
      if (!f) return;
      busy(true, '이미지 준비 중…');
      processImage(f).then(function (r) {
        busy(false);
        var newPath = CONFIG.uploadDir + 'news-' + stampNow() + '.' + r.ext;
        S.imgChanges['__new__' + newPath] = { newPath: newPath, base64: r.base64, previewUrl: r.dataUrl, fileName: r.name, isNew: true };
        S.changed.images++;
        var cards = archiveModel().cards;
        cards[i].img = newPath;
        archiveWrite(cards);
        renderArchive();
      }).catch(function (e) { busy(false); toast(e.message, 'err'); });
    };
    input.click();
  }

  $('#archAdd') && $('#archAdd').addEventListener('click', function () {
    var m = archiveModel();
    if (!m) return toast('자료실 목록을 찾지 못했습니다.', 'err');
    var d = new Date();
    m.cards.unshift({ href: '', img: '', title: '새 자료', date: d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) });
    archiveWrite(m.cards);
    renderArchive();
  });

  /* ===================== 회사정보 ===================== */

  function buildInfo() {
    var host = $('#infoList');
    host.innerHTML = '';
    var info = S.doc.findCompanyInfo();
    if (!info.length) { host.innerHTML = '<div class="empty">연락처 정보를 찾지 못했습니다.</div>'; return; }

    info.forEach(function (r) {
      var input = el('input', { class: 'input', value: r.value });
      var spots = uniq(r.spots.map(function (s) { return s.scopeName; }));
      host.appendChild(el('div', { class: 'item' }, [
        el('div', { class: 'ih' }, [
          el('span', { class: 'badge', text: r.fieldName }),
          el('span', { class: 'sect', style: 'font-size:12px;color:var(--slate2)', text: spots.join(' · ') + ' (' + r.spots.length + '곳)' })
        ]),
        el('div', { class: 'row' }, [
          el('div', { style: 'flex:1;min-width:220px' }, [input]),
          el('button', { class: 'btn primary', text: '전체 적용', onclick: function () {
            var nv = input.value.trim();
            if (!nv || nv === r.value) return;
            var n = S.doc.replaceEverywhere(r.value, nv);
            S.blockCache = {};
            S.changed.info += n;
            updateChangeUI();
            toast(n + '곳이 변경되었습니다.', 'ok');
            buildInfo();
            buildText();
          } })
        ])
      ]));
    });

    // 푸터
    var fh = $('#footList');
    fh.innerHTML = '';
    blocks('__shell__').filter(function (b) { return b.kind === 'content'; })
      .forEach(function (b) { fh.appendChild(textBlockNode('__shell__', b)); });
  }

  /* ===================== SEO ===================== */

  function buildSeo() {
    $('#seoTitle').value = S.doc.getTitle();
    var g = function (n) { var m = S.doc.getMeta(n); return m ? m.content : ''; };
    $('#seoDesc').value = g('description');
    $('#seoKeywords').value = g('keywords');
    $('#seoOgTitle').value = g('og:title');
    $('#seoOgDesc').value = g('og:description');
  }

  $('#seoApply') && $('#seoApply').addEventListener('click', function () {
    var head = S.doc.buildHead({
      title: $('#seoTitle').value.trim(),
      meta: {
        description: $('#seoDesc').value.trim(),
        keywords: $('#seoKeywords').value.trim(),
        'og:title': $('#seoOgTitle').value.trim(),
        'og:description': $('#seoOgDesc').value.trim(),
        'og:type': 'website',
        'og:url': CONFIG.site
      }
    });
    S.doc.setHead(head);
    S.changed.seo = 1;
    updateChangeUI();
    toast('SEO 설정이 적용되었습니다. 발행하면 반영됩니다.', 'ok');
  });

  /* ===================== 비밀번호 변경 ===================== */

  var accountBound = false;
  function initAccount() {
    var can = S.be && S.be.mode === 'server' && S.be.canChangePassword;
    $('#navAccount').hidden = !can;
    if (!can || accountBound) return;
    accountBound = true;

    $('#pwSubmit').addEventListener('click', function () {
      var cur = $('#pwCur').value;
      var next = $('#pwNew').value;
      var next2 = $('#pwNew2').value;

      if (!cur) return toast('현재 비밀번호를 입력해 주세요.', 'err');
      if (next.trim().length < 4) return toast('새 비밀번호는 4자 이상이어야 합니다.', 'err');
      if (next !== next2) return toast('새 비밀번호가 서로 다릅니다.', 'err');
      if (next === cur) return toast('현재 비밀번호와 다른 값을 입력해 주세요.', 'err');

      busy(true, '비밀번호를 바꾸는 중…');
      S.be.changePassword(cur, next).then(function () {
        busy(false);
        $('#pwCur').value = $('#pwNew').value = $('#pwNew2').value = '';
        toast('비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.', 'ok', 6000);
      }).catch(function (e) {
        busy(false);
        toast(e.message, 'err', 5000);
      });
    });

    // 새 비밀번호 강도 안내
    $('#pwNew').addEventListener('input', function () {
      var v = this.value;
      var hint = $('#pwHint');
      if (!v) { hint.textContent = '4자 이상. 영문·숫자를 섞으면 더 안전합니다.'; hint.style.color = ''; return; }
      if (v.length < 4) { hint.textContent = '너무 짧습니다 (4자 이상).'; hint.style.color = 'var(--danger)'; return; }
      var kinds = (/[a-z]/.test(v) ? 1 : 0) + (/[A-Z]/.test(v) ? 1 : 0) + (/[0-9]/.test(v) ? 1 : 0) + (/[^A-Za-z0-9]/.test(v) ? 1 : 0);
      if (v.length >= 10 && kinds >= 3) { hint.textContent = '안전한 비밀번호입니다.'; hint.style.color = 'var(--ok)'; }
      else if (v.length >= 8 && kinds >= 2) { hint.textContent = '무난합니다.'; hint.style.color = 'var(--ok)'; }
      else { hint.textContent = '조금 약합니다. 8자 이상 + 영문·숫자 조합을 권합니다.'; hint.style.color = 'var(--warn)'; }
    });
  }

  /* ===================== 발행 ===================== */

  function changeSummary() {
    var parts = [];
    if (S.changed.images) parts.push('이미지 ' + S.changed.images + '건');
    if (S.changed.text) parts.push('문구 ' + S.changed.text + '건');
    if (S.changed.perf) parts.push('주요실적 ' + S.changed.perf + '건');
    if (S.changed.detail) parts.push('제품상세 ' + S.changed.detail + '건');
    if (S.changed.board) parts.push('게시물 ' + S.changed.board + '건');
    if (S.changed.info) parts.push('회사정보 ' + S.changed.info + '건');
    if (S.changed.seo) parts.push('SEO 설정');
    return parts;
  }

  function publish() {
    var parts = changeSummary();
    if (!parts.length) return;

    var body = el('div', {}, [
      el('p', { text: '아래 내용을 홈페이지에 반영합니다.' }),
      el('ul', { style: 'margin:12px 0 0 18px' }, parts.map(function (p) { return el('li', { text: p }); })),
      el('p', { class: 'hint', style: 'margin-top:14px', text: '반영 후 홈페이지에 실제로 보이기까지 1~2분 정도 걸립니다.' })
    ]);

    confirmBox('홈페이지에 발행', body, '발행하기').then(function (ok) {
      if (!ok) return;
      busy(true, '발행 준비 중…');

      // 교체한 이미지의 새 경로를 문서에 반영
      Object.keys(S.imgChanges).forEach(function (k) {
        var c = S.imgChanges[k];
        if (!c.isNew) S.doc.renameImage(k, c.newPath);
      });

      var files = Object.keys(S.imgChanges).map(function (k) {
        return { path: S.imgChanges[k].newPath, base64: S.imgChanges[k].base64 };
      });
      files.push({ path: CONFIG.file, text: S.doc.serialize() });

      var msg = '홈페이지 수정: ' + parts.join(', ') + '\n\n관리자 페이지에서 발행';
      // baseSha 를 함께 보내 다른 사람이 먼저 발행했으면 덮어쓰지 않도록 한다
      return S.be.commitFiles(files, msg, S.headSha, function (m) { busy(true, m); });
    }).then(function (res) {
      if (!res) { busy(false); return; }
      busy(false);
      toast('발행되었습니다. 1~2분 뒤 홈페이지에 반영됩니다.', 'ok', 6000);
      clearTimeout(draftTimer);
      draftClear();                       // 발행했으니 임시저장본은 지운다
      return loadSite().then(function () { busy(false); });
    }).catch(function (e) {
      busy(false);
      toast(e.message, 'err', 7000);
    });
  }

  /* ===================== 내비게이션 ===================== */

  var TITLES = {
    dash: '대시보드', images: '이미지 관리', text: '텍스트 관리', perf: '주요실적 관리',
    detail: '제품상세', board: '공지사항 · 자료실', info: '회사정보 · 푸터', seo: 'SEO 설정', history: '발행 이력',
    account: '비밀번호 변경'
  };

  function go(name) {
    $$('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === name); });
    $$('[data-panel]').forEach(function (p) { p.classList.toggle('on', p.dataset.panel === name); });
    $('#pageTitle').textContent = TITLES[name] || name;
    $('#side').classList.remove('open');
    if (name === 'history') loadCommits($('#histList'), 30);
    if (name === 'dash') loadCommits($('#dashCommits'), 6);
    window.scrollTo(0, 0);
  }

  /* ===================== 이벤트 바인딩 ===================== */

  function bind() {
    $$('[data-nav]').forEach(function (a) { a.addEventListener('click', function () { go(a.dataset.nav); }); });
    $$('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.goto); }); });
    $('#menuToggle').addEventListener('click', function () { $('#side').classList.toggle('open'); });

    $('#imgSearch').addEventListener('input', renderImageGrid);
    $('#imgOnlyChanged').addEventListener('change', renderImageGrid);

    $('#txtPage').addEventListener('change', function () { S.curPage = this.value; renderText(); });
    $('#txtShowNav').addEventListener('change', renderText);
    $('#txtSearch').addEventListener('input', renderText);

    $('#dtSearch').addEventListener('input', renderProdList);
    $('#dtAddProduct').addEventListener('click', addProd);
    $('#dtSelectAll').addEventListener('change', function () { toggleSelectAll(this.checked); });
    $('#dtBulkDelete').addEventListener('click', bulkDelete);
    $('#dtBack').addEventListener('click', renderProdList);
    $('#dtDelete').addEventListener('click', function () { delProd(S.curDetail); });
    $$('#dtTabs button').forEach(function (b) {
      b.addEventListener('click', function () { prodTab(b.dataset.t); });
    });

    $('#dtSpecAdd').addEventListener('click', function () {
      var rows = JSON.parse(JSON.stringify(prodRows('spec')));
      rows.push(['', '', '', '']);
      writeProdRows('spec', rows);
      renderSpecRows();
    });
    $('#dtFeatAdd').addEventListener('click', function () {
      var rows = JSON.parse(JSON.stringify(prodRows('feat')));
      var next = rows.length + 1;
      rows.push([(next < 10 ? '0' : '') + next, '']);
      writeProdRows('feat', rows);
      renderFeatRows();
    });
    $('#dtFeatRenum').addEventListener('click', function () {
      var rows = prodRows('feat').map(function (r, i) {
        var n = i + 1;
        return [(n < 10 ? '0' : '') + n, r[1] || ''];
      });
      writeProdRows('feat', rows);
      renderFeatRows();
      toast('번호를 01부터 다시 매겼습니다.');
    });

    $('#publishBtn').addEventListener('click', publish);
    $('#discardBtn').addEventListener('click', function () {
      if (!window.confirm('저장하지 않은 변경사항을 모두 취소할까요?\n임시저장해 둔 내용도 함께 지워집니다.')) return;
      busy(true, '되돌리는 중…');
      clearTimeout(draftTimer);
      draftClear();
      loadSite().then(function () { busy(false); toast('변경사항을 취소했습니다.'); })
        .catch(function (e) { busy(false); toast(e.message, 'err'); });
    });

    $('#histReload').addEventListener('click', function () { loadCommits($('#histList'), 30); });
    $('#histRepo').href = 'https://github.com/' + CONFIG.owner + '/' + CONFIG.repo + '/commits/' + CONFIG.branch;

    window.addEventListener('beforeunload', function (e) {
      if (hasChanges()) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ===================== 시작 ===================== */
  bind();
  initLogin();
})();
