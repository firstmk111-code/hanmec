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

  /** 네 번째 값으로 true 를 주면 '취소' 없이 닫기 버튼만 (읽기 전용 창).
      객체를 주면 { readOnly, cancelLabel, okDanger } 로 더 세밀하게 지정할 수 있다. */
  function confirmBox(title, bodyNode, okLabel, opts) {
    if (opts === true) opts = { readOnly: true };
    opts = opts || {};
    return new Promise(function (resolve) {
      var box = el('div', { class: 'modal' }, [
        el('div', { class: 'modal-box' }, [
          el('header', { text: title }),
          el('div', { class: 'body' }, [bodyNode]),
          el('footer', {}, [
            opts.readOnly ? null
              : el('button', {
                  class: 'btn', text: opts.cancelLabel || '취소',
                  onclick: function () { host.innerHTML = ''; resolve(false); }
                }),
            el('button', {
              class: 'btn ' + (opts.okDanger ? 'danger-solid' : 'primary'), text: okLabel || '확인',
              onclick: function () { host.innerHTML = ''; resolve(true); }
            })
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
        // 이미 로그인된 세션이 있으면 바로 들어간다.
        // 세션이 없을 때는 조용히 로그인 화면을 두고, 그 뒤 단계에서 난 오류는 화면에 보여준다.
        be.verify()
          .then(function () {
            return enterAdmin().catch(function (e) { busy(false); loginError(e.message); });
          })
          .catch(function () { /* 세션 없음 — 로그인 화면 그대로 */ });
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
      startInqWatch();         // 새 문의 알림을 켠다
      return offerDraft();     // 발행 안 하고 남겨둔 작업이 있으면 이어서 할지 물어본다
    }).catch(function (e) {
      /* 홈페이지 내용을 못 불러와도 문의함은 홈페이지와 무관하므로 그것만은 쓸 수 있게 연다.
         (GitHub 연결이 끊기거나 토큰이 만료돼도 들어온 문의는 확인해야 하기 때문) */
      if (!S.be || S.be.mode !== 'server') throw e;
      enterInquiryOnly(e.message);
    });
  }

  function enterInquiryOnly(msg) {
    S.limited = true;
    busy(false);
    $('#login').hidden = true;
    $('#shell').classList.add('on');

    // 홈페이지 편집 기능은 감춘다 (내용을 못 불러왔으므로 쓸 수 없다)
    $$('[data-nav]').forEach(function (a) { if (a.dataset.nav !== 'inq') a.hidden = true; });
    $$('.grp').forEach(function (g) { if (g.textContent.trim() !== '문의') g.hidden = true; });
    var bar = $('#topActions');
    if (bar) bar.hidden = true;

    var b = $('#limitBar');
    if (b) {
      b.hidden = false;
      b.querySelector('.msg').textContent = msg || '홈페이지 내용을 불러오지 못했습니다.';
    }
    startInqWatch();
    go('inq');
  }

  /* 새 문의가 들어왔는지 이따금 확인한다.
     관리자를 켜 둔 채로 있어도 알 수 있게 한다. */
  var inqWatchTimer = null;
  function startInqWatch() {
    refreshInqBadge();
    clearInterval(inqWatchTimer);
    inqWatchTimer = setInterval(function () {
      if (document.hidden) return;          // 다른 탭을 보고 있으면 쉰다
      refreshInqBadge();
    }, 180000);                              // 3분마다
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshInqBadge();
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
      var days = Math.floor((Date.now() - when.getTime()) / 86400000);
      var old = days >= 2;

      /* 이 저장본을 불러오면 지금 홈페이지보다 내용이 줄어드는지 미리 확인한다.
         (오래된 저장본을 불러와 발행하는 바람에 제품이 통째로 사라진 적이 있다) */
      var lost = [];
      try {
        lost = shrinkage(censusOf(S.doc), censusOf(new SiteDoc(dr.html)));
      } catch (e) { /* 비교 실패 시 경고 없이 진행 */ }

      var risky = lost.length > 0;

      var body = el('div', {}, [
        risky ? shrinkBox(lost, '이 저장본을 불러오면 지금 홈페이지에 있는 아래 내용이 사라집니다.') : null,
        el('p', { text: '발행하지 않고 남겨둔 작업이 있습니다.' }),
        el('p', { class: 'hint', style: 'margin-top:6px',
          text: when.getFullYear() + '.' + pad(when.getMonth() + 1) + '.' + pad(when.getDate()) + ' ' +
                pad(when.getHours()) + ':' + pad(when.getMinutes()) + ' 에 마지막으로 저장됨' +
                (days >= 1 ? '  (' + days + '일 전)' : '') }),
        parts.length ? el('ul', { style: 'margin:12px 0 0 18px' }, parts.map(function (p) { return el('li', { text: p }); })) : null,
        old ? el('p', { class: 'hint', style: 'margin-top:12px;color:var(--warn)',
          text: '※ 저장한 지 ' + days + '일이 지났습니다. 그 사이 다른 곳에서 홈페이지를 고쳤다면 새로 시작하시는 편이 안전합니다.' }) : null,
        stale ? el('p', { class: 'hint', style: 'margin-top:8px;color:var(--warn)',
          text: '※ 그 사이 홈페이지가 다른 곳에서 수정되었습니다.' }) : null,
        el('p', { class: 'hint', style: 'margin-top:14px',
          text: risky
            ? '내용이 사라져도 괜찮을 때만 이어서 작업하세요. 잘 모르겠으면 “새로 시작”을 고르시면 됩니다.'
            : '이어서 작업하시겠습니까? “새로 시작”을 고르면 남겨둔 작업은 지워집니다.' })
      ]);

      return confirmBox(
        risky ? '이어서 작업하기 — 확인이 필요합니다' : '이어서 작업하기',
        body,
        risky ? '내용이 사라져도 이어서 작업' : '이어서 작업',
        { cancelLabel: risky || old ? '새로 시작 (권장)' : '새로 시작', okDanger: risky }
      ).then(function (ok) {
        if (!ok) {
          draftReady = true;
          draftClear();
          toast('최신 홈페이지 내용으로 시작합니다.', 'ok');
          return false;
        }
        var merged = mergeDraftInto(S.doc, dr.html);
        S.imgChanges = dr.imgChanges || {};
        S.changed = dr.changed || S.changed;
        S.blockCache = {};
        prodSel = {};
        draftReady = true;
        buildAll();
        updateChangeUI();
        showDraftMark(dr.savedAt);
        toast(merged ? '저장해 둔 작업을 불러왔습니다.' : '불러올 변경 내용이 없어 최신 상태로 시작합니다.', 'ok');
        return true;
      });
    }).catch(function () { draftReady = true; });
  }

  /* 임시저장본을 "통째로" 씌우면 그 사이 바뀐 홈페이지 코드까지 옛것으로 되돌아간다.
     그래서 저장본에서 내용(제품·실적·페이지 글·푸터·SEO)만 뽑아
     방금 불러온 최신 문서 위에 얹는다. */
  function mergeDraftInto(fresh, draftHtml) {
    var dd;
    try { dd = new SiteDoc(draftHtml); } catch (e) { return false; }
    var changed = false;
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };

    if (dd.hasProducts() && fresh.hasProducts() && !same(dd.productsData(), fresh.productsData())) {
      fresh.setProductsData(dd.productsData());
      changed = true;
    }
    if (!same(dd.perfData(), fresh.perfData())) {
      fresh.setPerfData(dd.perfData());
      changed = true;
    }
    dd.order.forEach(function (k) {
      if (fresh.pages[k] && dd.pageHtml(k) !== fresh.pageHtml(k)) {
        fresh.setPageHtml(k, dd.pageHtml(k));
        changed = true;
      }
    });
    if (dd.shellHtml() !== fresh.shellHtml()) { fresh.setShellHtml(dd.shellHtml()); changed = true; }
    if (dd.head !== fresh.head) { fresh.setHead(dd.head); changed = true; }
    return changed;
  }

  /* ===================== 사이트 로드 ===================== */

  function loadSite() {
    busy(true, '홈페이지 내용을 불러오는 중…');
    // 오래 걸리면 멈춘 것처럼 보이므로 시간을 끊고 안내한다
    var timer = setTimeout(function () {
      busy(true, '홈페이지 내용을 불러오는 중… (평소보다 오래 걸리고 있습니다)');
    }, 8000);
    return withTimeout(doLoadSite(), 30000, '홈페이지 내용을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.')
      .then(function (r) { clearTimeout(timer); return r; })
      .catch(function (e) { clearTimeout(timer); throw e; });
  }

  function withTimeout(promise, ms, msg) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; reject(new Error(msg)); } }, ms);
      promise.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
    });
  }

  function doLoadSite() {
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

  /* 관리자에서 발행한 내역인지 판별.
     제작사가 손본 코드 수정 내역은 담당자에게 혼란만 주므로 목록에서 뺀다.
     판단은 첫 줄(제목)로만 한다 — 본문까지 보면 제작사 커밋 설명에 같은 문구가
     들어갔을 때 걸러지지 않는다. 관리자 발행은 항상 publish() 가
     '홈페이지 수정: …' 형태로 제목을 만든다. */
  function isAdminPublish(c) {
    var first = String((c && c.message) || '').split('\n')[0].trim();
    return /^홈페이지 수정\s*:/.test(first);
  }

  function loadCommits(host, limit) {
    host.innerHTML = '<div class="empty">불러오는 중…</div>';
    var want = limit || 20;
    // 걸러낸 뒤에도 충분히 남도록 넉넉히 받아온다
    S.be.commits(Math.min(50, want * 4)).then(function (list) {
      var mine = (list || []).filter(isAdminPublish).slice(0, want);
      host.innerHTML = '';
      if (!mine.length) {
        host.innerHTML = '<div class="empty">아직 발행한 내역이 없습니다.</div>';
        return;
      }
      mine.forEach(function (c) {
        var d = new Date(c.date);
        var dt = d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        host.appendChild(el('div', { class: 'cm' }, [
          el('div', { class: 'dt', text: dt }),
          el('div', { class: 'ms', text: String(c.message).split('\n')[0] })
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

  /* ---------- 이미지 관리: 사용 위치별 영역 모델 ----------
     · 여러 장이 늘어서는 자리(갤러리)  → 추가·교체·삭제·순서 변경
     · 그 밖의 이미지                   → 교체만
     · 이미 전용 화면이 있는 자리        → 그 화면으로 안내만
     페이지 이름을 코드에 적어두지 않고 SiteDoc 이 찾아낸 구조를 그대로 쓴다. */

  // 전용 관리 화면이 따로 있는 페이지 (중복 구현 금지)
  var MANAGED_BY = {
    archive: { nav: 'board', name: '공지사항 · 자료실' },
    notice: { nav: 'board', name: '공지사항 · 자료실' }
  };

  function areaBadge(kind) {
    if (kind === 'card') return { cls: 'blue', text: '콘텐츠 추가 가능' };
    if (kind === 'single') return { cls: 'gray', text: '교체만 가능' };
    if (kind === 'managed') return { cls: 'gray', text: '전용 화면에서 관리' };
    return { cls: 'ok', text: '여러 장 추가 가능' };
  }

  /** 사람이 읽는 사용 위치: 회사소개 > 인증현황 > 특허
      "인증현황" 과 "인증 현황" 처럼 띄어쓰기만 다른 것은 한 번만 넣는다. */
  function crumbOf(parts) {
    var out = [], seen = {};
    parts.forEach(function (p) {
      if (!p) return;
      var k = String(p).replace(/\s+/g, '');
      if (seen[k]) return;
      seen[k] = 1;
      out.push(p);
    });
    return out;
  }
  function groupName(id) {
    var g = SiteDoc.GROUPS.filter(function (x) { return x.id === id; })[0];
    return g ? g.name : '';
  }

  /** 화면에 그릴 영역 목록을 만든다 */
  function buildAreas() {
    var areas = [];
    var claimed = {};

    (S.doc.listGalleries() || []).forEach(function (g) {
      g.items.forEach(function (it) { claimed[it.src] = true; });
      var managed = MANAGED_BY[g.page];
      var grp = SiteDoc.groupOfPage(g.page);
      areas.push({
        type: managed ? 'managed' : 'gallery',
        managed: managed || null,
        id: g.id,
        group: grp,
        page: g.page,
        shape: g.shape,
        pageLabel: g.pageNames.join(' · '),
        areaLabel: g.area,
        category: g.category,
        kind: managed ? 'managed' : g.kind,
        crumb: crumbOf([groupName(grp), g.pageNames.join(' · '), g.area, g.category]),
        slots: g.slots,
        items: g.items
      });
    });

    // 갤러리에 속하지 않은 나머지 = 교체만 (제품·실적은 전용 화면 안내)
    var rest = {};
    (S.allImages || []).forEach(function (im) {
      if (claimed[im.path]) return;
      var u = im.uses[0] || {};
      var grp = im.group;
      var owner = u.product ? { nav: 'detail', name: '제품상세', label: '제품소개' }
        : u.perf ? { nav: 'perf', name: '주요실적 관리', label: '주요실적' } : null;
      var label = owner ? owner.label
        : (u.pageName || (u.shell ? '헤더·푸터' : '상단 배너'));
      var key = grp + '|' + label;

      if (!rest[key]) {
        rest[key] = {
          type: 'single', kind: owner ? 'managed' : 'single', managed: owner,
          id: 'single:' + key, group: grp, page: u.page || '',
          pageLabel: label, areaLabel: '', category: '',
          crumb: crumbOf([groupName(grp), label]),
          images: []
        };
      }
      rest[key].images.push(im);
    });
    Object.keys(rest).forEach(function (k) { areas.push(rest[k]); });

    return areas;
  }

  function fillAreaFilters(areas) {
    function fill(sel, values, keep) {
      var cur = keep === undefined ? sel.value : keep;
      var first = sel.options[0];
      sel.innerHTML = '';
      sel.appendChild(first);
      uniq(values.filter(Boolean)).forEach(function (v) {
        sel.appendChild(el('option', { value: v, text: v }));
      });
      sel.value = cur;
      if (sel.value !== cur) sel.value = '';
    }
    var inTab = areas.filter(function (a) { return a.group === S.curImgTab; });
    fill($('#imgFPage'), inTab.map(function (a) { return a.pageLabel; }));
    var byPage = inTab.filter(function (a) { return !$('#imgFPage').value || a.pageLabel === $('#imgFPage').value; });
    fill($('#imgFArea'), byPage.map(function (a) { return a.areaLabel; }));
    var byArea = byPage.filter(function (a) { return !$('#imgFArea').value || a.areaLabel === $('#imgFArea').value; });
    fill($('#imgFCat'), byArea.map(function (a) { return a.category; }));
  }

  function renderImageGrid() {
    var q = ($('#imgSearch').value || '').trim().toLowerCase();
    var onlyChanged = $('#imgOnlyChanged').checked;
    var areas = buildAreas();
    fillAreaFilters(areas);

    var fPage = $('#imgFPage').value, fArea = $('#imgFArea').value, fCat = $('#imgFCat').value;
    var host = $('#imgAreas');
    host.innerHTML = '';
    var shown = 0, boxes = 0;

    areas.filter(function (a) {
      if (a.group !== S.curImgTab) return false;
      if (fPage && a.pageLabel !== fPage) return false;
      if (fArea && a.areaLabel !== fArea) return false;
      if (fCat && a.category !== fCat) return false;
      return true;
    }).forEach(function (a) {
      var node = a.type === 'single' ? renderSingleArea(a, q, onlyChanged) : renderGalleryArea(a, q, onlyChanged);
      if (!node) return;
      shown += node.__count;
      boxes++;
      host.appendChild(node);
    });

    $('#imgCount').textContent = shown + '개 표시';
    /* 이미지가 0장이어도 '빈 자리' 상자는 남겨 둬야 한다.
       그래야 다 지운 분류에 다시 넣을 수 있다. 상자까지 하나도 없을 때만 안내로 바꾼다. */
    if (!boxes) host.innerHTML = '<div class="empty">해당하는 이미지가 없습니다.</div>';
  }

  function areaHead(a, count, extra) {
    var b = areaBadge(a.kind);
    return el('div', { class: 'ia-head' }, [
      el('div', { class: 'ia-crumb' }, a.crumb.map(function (c, i) {
        return el('span', { class: i === a.crumb.length - 1 ? 'last' : '', text: c });
      })),
      el('div', { class: 'ia-meta' }, [
        el('span', { class: 'badge ' + b.cls, text: b.text }),
        el('span', { class: 'ia-n', text: '현재 이미지 ' + count + '개' })
      ]),
      extra || null
    ]);
  }

  /** 교체만 가능한 이미지 묶음 */
  function renderSingleArea(a, q, onlyChanged) {
    var list = a.images.filter(function (im) {
      if (onlyChanged && !S.imgChanges[im.path]) return false;
      if (q && (im.label + ' ' + im.path).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (!list.length) return null;

    var link = a.managed ? el('button', {
      class: 'btn sm', text: a.managed.name + ' 에서 관리 ↗',
      onclick: function () { go(a.managed.nav); }
    }) : null;

    var box = el('div', { class: 'ia' }, [areaHead(a, a.images.length, link)]);
    if (a.managed) {
      box.appendChild(el('p', { class: 'ia-note', text: '이 자리는 ‘' + a.managed.name + '’ 화면에서 추가·삭제·순서까지 관리합니다. 여기서는 이미지 교체만 하실 수 있습니다.' }));
    }
    var grid = el('div', { class: 'img-grid' });
    list.forEach(function (im) { grid.appendChild(imageCard(im, a)); });
    box.appendChild(grid);
    box.__count = list.length;
    return box;
  }

  /** 여러 장이 늘어서는 자리 */
  function renderGalleryArea(a, q, onlyChanged) {
    var hit = a.items.filter(function (it) {
      if (onlyChanged && !S.imgChanges[it.src]) return false;
      if (q && (it.text + ' ' + it.src).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    /* 텅 빈 자리도 보여 준다. 그래야 다 지운 분류에 다시 넣을 수 있다.
       (검색·필터 중일 때는 조건에 안 맞는 자리이므로 숨긴다) */
    var isEmpty = a.items.length === 0;
    if (!hit.length && !(isEmpty && !q && !onlyChanged)) return null;

    var addBtn = null;
    if (a.type === 'managed') {
      addBtn = el('button', {
        class: 'btn sm', text: a.managed.name + ' 에서 관리 ↗',
        onclick: function () { go(a.managed.nav); }
      });
    } else {
      addBtn = el('button', {
        class: 'btn sm primary ia-add', text: a.kind === 'card' ? '+ 콘텐츠 추가' : '+ 이미지 추가',
        onclick: function () { addGalleryDialog(a); }
      });
    }

    /* 체크 상자로 여러 개를 골라 한 번에 지우는 줄 */
    var tools = null;
    if (a.type === 'gallery' && a.items.length) {
      var allChk = el('input', { type: 'checkbox' });
      allChk.addEventListener('change', function () {
        galSel[a.id] = {};
        if (allChk.checked) a.items.forEach(function (_, i) { galSel[a.id][i] = 1; });
        renderImageGrid();
      });
      tools = el('div', { class: 'ia-tools' }, [
        el('label', { class: 'ia-allchk' }, [allChk, el('span', { text: '전체 선택' })]),
        el('button', {
          class: 'btn sm danger ia-delsel', text: '선택 삭제 (0)', hidden: true,
          onclick: function () { removeSelectedDialog(a); }
        })
      ]);
    }

    var box = el('div', { class: 'ia' }, [areaHead(a, a.items.length, addBtn)]);
    box.setAttribute('data-area', a.id);
    if (a.type === 'managed') {
      box.appendChild(el('p', { class: 'ia-note', text: '이 자리는 ‘' + a.managed.name + '’ 화면에서 글·이미지를 함께 관리합니다. 여기서는 이미지 교체만 하실 수 있습니다.' }));
    }
    if (tools) box.appendChild(tools);

    if (isEmpty) {
      box.appendChild(el('div', { class: 'ia-empty' }, [
        el('b', { text: '이 분류에는 아직 이미지가 없습니다.' }),
        el('span', { text: '오른쪽 위 ‘' + (a.kind === 'card' ? '+ 콘텐츠 추가' : '+ 이미지 추가') + '’ 로 넣어 주세요.' })
      ]));
      box.__count = 0;
      return box;
    }

    var grid = el('div', { class: 'img-grid' });
    a.items.forEach(function (it, idx) {
      if (hit.indexOf(it) < 0) return;
      grid.appendChild(galleryCard(a, it, idx));
    });
    box.appendChild(grid);
    box.__count = hit.length;
    if (tools) setTimeout(function () { syncGalSel(a); }, 0);
    return box;
  }

  /** 갤러리 항목 카드 (교체 / 삭제 / 순서) */
  function galleryCard(a, it, idx) {
    var ch = S.imgChanges[it.src];
    var pend = S.imgChanges['__new__' + it.src];
    var src = ch ? ch.previewUrl : (pend ? pend.previewUrl : assetUrl(it.src));
    var im = { path: it.src, label: it.text || it.alt, uses: [{ page: a.page, pageName: a.pageLabel }] };
    var canEdit = a.type === 'gallery';

    /* 글이 한 칸뿐인 자리(인증서 이름 등)는 카드에서 바로 고칠 수 있게 한다.
       여러 칸이면 '내용 수정' 창을 연다. */
    var nameBox;
    if (canEdit && a.slots.length === 1) {
      var inp = el('input', { class: 'input sm nm', value: it.text || '', placeholder: a.slots[0].slice(0, 24) });
      inp.addEventListener('change', function () {
        var v = (inp.value || '').trim();
        if (v === (it.text || '')) return;
        if (!S.doc.updateGalleryItem(a.id, idx, [v])) { toast('고치지 못했습니다.', 'err'); return; }
        afterGalleryChange('이름을 바꿨습니다. 발행하면 홈페이지에 반영됩니다.');
      });
      nameBox = inp;
    } else if (canEdit && a.slots.length > 1) {
      nameBox = el('div', { class: 'nm-row' }, [
        el('div', { class: 'lb', text: it.text || it.alt || '(설명 없음)' }),
        el('button', { class: 'nm-edit', text: '내용 수정', onclick: function () { editItemDialog(a, idx); } })
      ]);
    } else {
      nameBox = el('div', { class: 'lb', text: it.text || it.alt || '(설명 없음)' });
    }

    /* 체크해서 여러 개를 한 번에 지울 수 있게 한다 */
    var pick = null;
    if (canEdit) {
      var cb = el('input', { type: 'checkbox', title: '선택' });
      cb.checked = !!(galSel[a.id] && galSel[a.id][idx]);
      cb.addEventListener('change', function () {
        galSel[a.id] = galSel[a.id] || {};
        if (cb.checked) galSel[a.id][idx] = 1; else delete galSel[a.id][idx];
        card.classList.toggle('picked', cb.checked);
        syncGalSel(a);
      });
      pick = el('label', { class: 'ia-pick', title: '선택' }, [cb]);
    }

    var card = el('div', { class: 'img-card' + (ch ? ' changed' : '') + (pick && pick.firstChild.checked ? ' picked' : '') }, [
      el('div', { class: 'thumb' }, [
        el('img', { src: src, loading: 'lazy', decoding: 'async', alt: '' }),
        ch ? el('span', { class: 'flag', text: '교체됨' }) : null,
        el('span', { class: 'ord', text: (idx + 1) + '번째' }),
        pick
      ]),
      el('div', { class: 'img-meta' }, [
        nameBox,
        el('div', { class: 'fn', text: (ch ? ch.fileName : it.src.split('/').pop()) }),
        el('div', { class: 'use' }, a.crumb.map(function (c) { return el('span', { text: c }); }))
      ]),
      el('div', { class: 'img-act' }, [
        el('button', { class: 'btn sm primary', text: ch ? '다시 교체' : '교체', onclick: function () { pickImage(im); } }),
        canEdit ? el('button', {
          class: 'btn sm danger', text: '삭제',
          onclick: function () { removeGalleryDialog(a, idx); }
        }) : null,
        canEdit ? el('div', { class: 'ia-move' }, [
          el('button', { class: 'btn sm', text: '↑', title: '앞으로', disabled: idx === 0 ? 'disabled' : null,
            onclick: function () { moveGallery(a, idx, idx - 1); } }),
          el('button', { class: 'btn sm', text: '↓', title: '뒤로', disabled: idx === a.items.length - 1 ? 'disabled' : null,
            onclick: function () { moveGallery(a, idx, idx + 1); } })
        ]) : null
      ])
    ]);
    return card;
  }

  /* ---------- 체크해서 한 번에 지우기 ---------- */

  /** 자리별로 체크해 둔 번호. 항목이 바뀌면 비운다 (번호가 밀리기 때문) */
  var galSel = {};

  function selectedIdx(a) {
    return Object.keys(galSel[a.id] || {}).map(Number)
      .filter(function (i) { return i >= 0 && i < a.items.length; })
      .sort(function (x, y) { return x - y; });
  }

  /** 머리말의 '전체 선택' 과 '선택 삭제' 단추 상태를 맞춘다 */
  function syncGalSel(a) {
    var host = document.querySelector('[data-area="' + cssEsc(a.id) + '"]');
    if (!host) return;
    var sel = selectedIdx(a);
    var btn = host.querySelector('.ia-delsel');
    if (btn) {
      btn.hidden = sel.length === 0;
      btn.textContent = '선택 삭제 (' + sel.length + ')';
    }
    var all = host.querySelector('.ia-allchk input');
    if (all) {
      all.checked = a.items.length > 0 && sel.length === a.items.length;
      all.indeterminate = sel.length > 0 && sel.length < a.items.length;
      all.disabled = a.items.length === 0;
    }
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /** 고른 것들을 한 번에 지운다 */
  function removeSelectedDialog(a) {
    var sel = selectedIdx(a);
    if (!sel.length) return;
    var items = sel.map(function (i) { return a.items[i]; });

    var body = el('div', {}, [
      el('p', {}, [
        el('b', { text: a.crumb.join(' > ') }),
        document.createTextNode(' 에서 ' + sel.length + '개를 삭제합니다.')
      ]),
      el('div', { class: 'ia-dellist' }, items.map(function (it, k) {
        return el('div', { class: 'ia-delitem' }, [
          el('img', { src: assetUrl(it.src), alt: '' }),
          el('span', { text: (sel[k] + 1) + '번째 · ' + (it.text || it.alt || it.src.split('/').pop()) })
        ]);
      })),
      sel.length === a.items.length
        ? el('p', { class: 'hint', style: 'margin-top:12px', text: '이 분류의 이미지를 모두 지웁니다. 자리는 그대로 남아 있어서 뒤에 다시 넣으실 수 있습니다.' })
        : null,
      el('p', { class: 'hint', style: 'margin-top:10px', text: '발행 전이라면 ‘변경 취소’로 되돌릴 수 있습니다.' })
    ]);

    confirmBox('선택한 이미지 삭제', body, '삭제하기', { okDanger: true }).then(function (ok) {
      if (!ok) return;
      if (!S.doc.removeGalleryItems(a.id, sel)) { toast('삭제하지 못했습니다.', 'err'); return; }
      delete galSel[a.id];
      afterGalleryChange(sel.length + '개를 삭제했습니다. 발행하면 홈페이지에 반영됩니다.');
    });
  }

  /** 교체만 가능한 이미지 카드 (기존 동작 그대로) */
  function imageCard(im, a) {
    var ch = S.imgChanges[im.path];
    var src = ch ? ch.previewUrl : assetUrl(im.path);
    return el('div', { class: 'img-card' + (ch ? ' changed' : '') }, [
      el('div', { class: 'thumb' }, [
        el('img', { src: src, loading: 'lazy', decoding: 'async', alt: '' }),
        ch ? el('span', { class: 'flag', text: '교체됨' }) : null
      ]),
      el('div', { class: 'img-meta' }, [
        el('div', { class: 'lb', text: im.label || '(설명 없음)' }),
        el('div', { class: 'fn', text: (ch ? ch.fileName : im.path.split('/').pop()) }),
        el('div', { class: 'use' }, (a ? a.crumb : uniq(im.uses.map(useLabel))).map(function (u) { return el('span', { text: u }); }))
      ]),
      el('div', { class: 'img-act' }, [
        el('button', { class: 'btn sm primary', text: ch ? '다시 교체' : '교체', onclick: function () { pickImage(im); } }),
        ch ? el('button', { class: 'btn sm', text: '되돌리기', onclick: function () { undoImage(im.path); } })
           : el('button', { class: 'btn sm', text: '원본', onclick: function () { window.open(assetUrl(im.path), '_blank'); } })
      ])
    ]);
  }

  function afterGalleryChange(msg) {
    S.changed.images++;
    refreshBlocks && S.doc.order.forEach(function (k) { delete S.blockCache[k]; });
    S.allImages = S.doc.listImages();
    renderImageGrid();
    updateChangeUI();
    toast(msg, 'ok');
  }

  function moveGallery(a, from, to) {
    if (!S.doc.moveGalleryItem(a.id, from, to)) return;
    afterGalleryChange('순서를 바꿨습니다. 발행하면 홈페이지에 반영됩니다.');
  }

  function removeGalleryDialog(a, idx) {
    var it = a.items[idx];
    var body = el('div', {}, [
      el('div', { class: 'cmp one' }, [
        el('figure', {}, [el('figcaption', { text: '삭제할 이미지' }),
          el('div', { class: 'box' }, [el('img', { src: assetUrl(it.src) })])])
      ]),
      el('p', { style: 'margin-top:14px' }, [
        document.createTextNode('이 이미지는 '),
        el('b', { text: a.crumb.join(' > ') }),
        document.createTextNode(' 영역의 ' + (idx + 1) + '번째로 사용 중입니다.')
      ]),
      it.text ? el('p', { class: 'hint', style: 'margin-top:6px', text: '내용: ' + it.text }) : null,
      a.items.length === 1
        ? el('p', { class: 'hint', style: 'margin-top:10px', text: '이 분류의 마지막 이미지입니다. 지워도 자리는 남아 있어서 뒤에 다시 넣으실 수 있습니다.' })
        : null,
      el('p', { class: 'hint', style: 'margin-top:10px', text: '삭제하면 홈페이지에서 이 항목이 사라집니다. 발행 전이라면 ‘변경 취소’로 되돌릴 수 있습니다.' })
    ]);
    confirmBox('이미지 삭제', body, '삭제하기').then(function (ok) {
      if (!ok) return;
      if (!S.doc.removeGalleryItem(a.id, idx)) { toast('삭제하지 못했습니다.', 'err'); return; }
      delete galSel[a.id];
      afterGalleryChange('삭제되었습니다. 발행하면 홈페이지에 반영됩니다.');
    });
  }

  /** 글칸 입력 묶음을 만든다. values 를 주면 그 값으로 채운다(수정용). */
  function buildTextFields(a, values) {
    var names = slotNames(a.slots);
    var inputs = [];
    var host = el('div', { class: 'ga-fields' });
    a.slots.forEach(function (sample, i) {
      var long = sample.length > 30;
      var box = long ? el('textarea', { class: 'input', rows: 3 }) : el('input', { class: 'input', type: 'text' });
      box.placeholder = sample.slice(0, 60);
      if (values && values[i] !== undefined) box.value = values[i];
      inputs.push(box);
      host.appendChild(el('div', { class: 'ga-field' }, [
        el('label', { text: names[i] }),
        box,
        values ? null : el('span', { class: 'hint', text: '지금 있는 항목 예: “' + sample.slice(0, 40) + (sample.length > 40 ? '…' : '') + '”' })
      ]));
    });
    return { node: host, inputs: inputs };
  }

  /** 글이 여러 칸인 항목의 내용을 고치는 창 */
  function editItemDialog(a, idx) {
    var cur = S.doc.galleryItemTexts(a.id, idx);
    var f = buildTextFields(a, cur);
    var body = el('div', {}, [
      el('div', { class: 'ga-where' }, [
        el('div', { class: 'ga-where-t', text: '고치는 자리' }),
        el('div', { class: 'ga-where-v', text: a.crumb.join('  >  ') }),
        el('div', { class: 'hint', text: (idx + 1) + '번째 항목의 내용을 고칩니다. 사진은 그대로 둡니다.' })
      ]),
      f.node
    ]);
    confirmBox('내용 수정', body, '저장').then(function (ok) {
      if (!ok) return;
      var texts = f.inputs.map(function (x) { return (x.value || '').trim(); });
      if (texts.some(function (t) { return !t; })) { toast('내용을 모두 입력해 주세요.', 'err'); return; }
      if (!S.doc.updateGalleryItem(a.id, idx, texts)) { toast('고치지 못했습니다.', 'err'); return; }
      afterGalleryChange('내용을 바꿨습니다. 발행하면 홈페이지에 반영됩니다.');
    });
  }

  /** 같은 영역의 다른 분류들 (인증현황의 특허·인증서·기타 등록증처럼) */
  function siblingAreas(a) {
    if (!a.category) return [];
    return buildAreas().filter(function (x) {
      return x.type === 'gallery' && x.page === a.page &&
        x.areaLabel === a.areaLabel && x.shape === a.shape && x.category;
    });
  }

  /** 새 이미지(+글) 추가.
      입력칸은 그 자리의 기존 항목에서 자동으로 뽑아낸다 (영역마다 코드를 따로 쓰지 않는다). */
  function addGalleryDialog(a) {
    var picked = null;
    var inputs = [];

    var preview = el('div', { class: 'box ga-prev' }, [el('span', { class: 'dt-noimg', text: '이미지를 선택해 주세요' })]);
    var fileBtn = el('button', { class: 'btn primary', text: '이미지 파일 선택' });
    var fileName = el('div', { class: 'hint', style: 'margin-top:8px', text: '아직 선택하지 않았습니다.' });

    fileBtn.addEventListener('click', function () {
      var input = $('#filePicker');
      input.value = '';
      input.onchange = function () {
        var f = input.files[0];
        if (!f) return;
        busy(true, '이미지 준비 중…');
        processImage(f).then(function (r) {
          busy(false);
          picked = r;
          preview.innerHTML = '';
          preview.appendChild(el('img', { src: r.dataUrl, alt: '' }));
          fileName.textContent = r.name + ' · ' + r.w + '×' + r.h + 'px · ' + fmtSize(r.size) + (r.resized ? ' (자동 최적화됨)' : '');
        }).catch(function (e) { busy(false); toast(e.message, 'err'); });
      };
      input.click();
    });

    // 기존 항목의 글칸 → 입력칸 (견본 글은 값이 아니라 안내문구로만 넣는다)
    var f = buildTextFields(a, null);
    inputs = f.inputs;
    var fields = f.node;

    /* 같은 영역에 분류가 여러 개면 (인증현황: 특허·인증서·기타 등록증) 골라 넣을 수 있게 한다 */
    var sibs = siblingAreas(a);
    var target = a;
    var whereV = el('div', { class: 'ga-where-v', text: a.crumb.join('  >  ') });
    var catSel = null;
    if (sibs.length > 1) {
      catSel = el('select', { class: 'input' });
      sibs.forEach(function (s) {
        var o = el('option', { value: s.id, text: s.category + '  (현재 ' + s.items.length + '개)' });
        if (s.id === a.id) o.selected = true;
        catSel.appendChild(o);
      });
      catSel.addEventListener('change', function () {
        target = sibs.filter(function (s) { return s.id === catSel.value; })[0] || a;
        whereV.textContent = target.crumb.join('  >  ');
      });
    }

    var body = el('div', {}, [
      el('div', { class: 'ga-where' }, [
        el('div', { class: 'ga-where-t', text: '추가되는 위치' }),
        whereV,
        catSel ? el('div', { class: 'ga-cat' }, [
          el('label', { text: '분류 선택' }), catSel
        ]) : null,
        el('div', { class: 'hint', text: '고른 분류의 마지막에 추가됩니다. 순서는 추가 후 ↑ ↓ 로 바꾸실 수 있습니다.' })
      ]),
      el('div', { class: 'ga-pick' }, [preview, el('div', {}, [fileBtn, fileName])]),
      a.slots.length ? fields : el('p', { class: 'hint', text: '이 자리는 이미지만 들어갑니다. 입력할 글은 없습니다.' })
    ]);

    confirmBox(a.kind === 'card' ? '콘텐츠 추가' : '이미지 추가', body, '추가하기').then(function (ok) {
      if (!ok) return;
      if (!picked) { toast('이미지를 먼저 선택해 주세요.', 'err'); return; }
      var texts = inputs.map(function (x, i) { return (x.value || '').trim(); });
      var missing = a.slots.length && texts.some(function (t) { return !t; });
      if (missing) { toast('내용을 모두 입력해 주세요.', 'err'); return; }

      var newPath = CONFIG.uploadDir + 'add-' + stampNow() + '.' + picked.ext;
      S.imgChanges['__new__' + newPath] = {
        newPath: newPath, base64: picked.base64, previewUrl: picked.dataUrl,
        fileName: picked.name, isNew: true
      };
      if (!S.doc.addGalleryItem(target.id, newPath, texts)) {
        delete S.imgChanges['__new__' + newPath];
        toast('추가하지 못했습니다. 새로고침 후 다시 시도해 주세요.', 'err');
        return;
      }
      afterGalleryChange('“' + (target.category || target.areaLabel || '해당 자리') + '” 에 추가했습니다. 발행하면 반영됩니다.');
    });
  }

  /** 글칸 이름: 견본 글의 생김새로 짐작해 사람이 알아볼 이름을 붙인다 */
  function slotNames(slots) {
    if (slots.length === 1) return ['이름 · 설명'];
    var titled = false;
    return slots.map(function (s) {
      if (/^[A-Z0-9 &·\-]+$/.test(s)) return '영문 표기';
      if (s.length > 30) return '설명';
      if (!titled) { titled = true; return '제목'; }
      return '소제목';
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

  /* ---------- 첨부 파일 (PDF·한글 등) ----------
     이미지와 달리 원본 그대로 올린다. 저장소에 함께 쌓이므로 크기를 제한한다. */

  var FILE_MAX = 20 * 1024 * 1024;                 // 20MB
  var FILE_DIR = 'files/';
  var FILE_OK = /\.(pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip|txt|jpg|jpeg|png)$/i;

  /** 저장소에 넣을 이름. 주소로 쓰이므로 영문·숫자만 남긴다.
      보이는 이름과 내려받는 이름은 원본 그대로 쓰므로(아래 download 속성)
      여기서 한글이 빠지는 것은 방문자에게 드러나지 않는다. */
  function safeFileName(name, hint) {
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : 'dat';
    var clean = base.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
    return (clean || hint || 'file') + '-' + stampNow() + '.' + ext;
  }

  /** 파일명에서 확장자만 (대문자로) */
  function fileExt(name) {
    var m = String(name || '').match(/\.([A-Za-z0-9]+)$/);
    return m ? m[1].toUpperCase() : '';
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('파일을 읽지 못했습니다.')); };
      fr.onload = function () {
        var s = String(fr.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.readAsDataURL(file);
    });
  }

  /** 파일을 고르게 하고, 발행 때 함께 올라가도록 등록한다. then(info)
      sub: 'notice' | 'archive' — 게시판별로 폴더를 나눠 담는다. */
  function pickAttachment(sub) {
    var dir = FILE_DIR + (sub ? sub + '/' : '');
    return new Promise(function (resolve) {
      var input = $('#filePicker');
      input.value = '';
      // 같은 칸을 사진 고르기와 함께 쓰므로, 문서도 보이도록 잠시 바꿨다가 되돌린다
      var keep = input.getAttribute('accept');
      input.setAttribute('accept', '.pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.jpg,.jpeg,.png');
      function restore() { if (keep) input.setAttribute('accept', keep); else input.removeAttribute('accept'); }
      // 고르지 않고 창을 닫으면 onchange 가 오지 않으므로 돌아올 때도 되돌린다
      window.addEventListener('focus', function once() {
        window.removeEventListener('focus', once);
        setTimeout(restore, 300);
      });
      input.onchange = function () {
        restore();
        var f = input.files[0];
        if (!f) return resolve(null);
        if (!FILE_OK.test(f.name)) {
          toast('올릴 수 없는 형식입니다. (PDF·한글·워드·엑셀·PPT·ZIP·이미지)', 'err', 5000);
          return resolve(null);
        }
        if (f.size > FILE_MAX) {
          toast('20MB 이하 파일만 올릴 수 있습니다. (' + fmtSize(f.size) + ')', 'err', 5000);
          return resolve(null);
        }
        busy(true, '파일 준비 중…');
        readFileAsBase64(f).then(function (b64) {
          busy(false);
          var path = dir + safeFileName(f.name, sub);
          S.imgChanges['__new__' + path] = {
            newPath: path, base64: b64, previewUrl: '', fileName: f.name, isNew: true
          };
          resolve({ path: path, name: f.name, size: f.size });
        }).catch(function (e) { busy(false); toast(e.message, 'err'); resolve(null); });
      };
      input.click();
    });
  }

  /* ---------- 게시판 정렬 ----------
     1순위 상단 고정, 2순위 최신 등록일.
     날짜가 같으면 손댄 순서를 그대로 둔다(자료실 ▲▼ 가 그래서 아직 쓸모 있다). */

  function dateKey(s) {
    var m = String(s || '').match(/(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/);
    return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : -1;   // 날짜가 없으면 맨 뒤
  }

  function sortBoard(list) {
    return list.map(function (it, i) { return { it: it, i: i }; })
      .sort(function (a, b) {
        var pa = a.it.pin ? 1 : 0, pb = b.it.pin ? 1 : 0;
        if (pa !== pb) return pb - pa;                       // 고정이 먼저
        var da = dateKey(a.it.date), db = dateKey(b.it.date);
        if (da !== db) return db - da;                       // 최신이 먼저
        return a.i - b.i;                                    // 나머지는 원래 순서
      })
      .map(function (x) { return x.it; });
  }

  /** 조각 HTML 에서 사람이 읽는 글자만 뽑는다 */
  function htmlToText(frag) {
    return String(frag || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .trim();
  }

  /** 홈페이지에 넣을 첨부 링크. 원본 이름 그대로 보이고, 그 이름으로 내려받게 한다. */
  function attachLink(file, fileName, style, prefix) {
    if (!file) return '';
    var shown = fileName || file.split('/').pop();
    return '<a href="' + esc(file) + '" download="' + esc(shown) + '"' +
      ' data-name="' + esc(fileName || '') + '" style="' + style + '"' +
      ' title="' + esc(shown) + ' 내려받기">' + (prefix || '') + esc(shown) + '</a>';
  }

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
      arr.push({ id: id, cat: cat, name: '새 제품', model: '', tagline: '', title: '', subtitle: '', badge: '', img: '', detailImg: '', desc: '', specs: [], feats: [], extraImg: '', extraImgPos: 'after-features' });
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

  /* 추가 이미지(extraImg)는 따로 큰 영역으로 뺐다. renderExtraImg() 참고 */
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

  /* 추가 이미지를 상세페이지 어디에 보여줄지 — 제품마다 따로 저장된다.
     값이 없는 기존 제품은 '특징 / 기능 아래' 로 본다. */
  var EXTRA_POS = [
    { v: 'after-spec', label: '제품사양 아래', desc: '제품사양 표가 끝난 직후 이미지를 표시합니다.' },
    { v: 'after-features', label: '특징 / 기능 아래', desc: '특징 / 기능이 끝난 후 이미지를 표시합니다.' }
  ];
  function extraPosOf(p) { return p && p.extraImgPos === 'after-spec' ? 'after-spec' : 'after-features'; }
  function extraPosLabel(p) {
    var v = extraPosOf(p);
    for (var i = 0; i < EXTRA_POS.length; i++) if (EXTRA_POS[i].v === v) return EXTRA_POS[i].label;
    return '';
  }

  /* 제품 상세페이지에 들어가는 추가 이미지 (위치는 아래에서 고른다) */
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
        el('div', {
          class: 'dt-fn', style: 'margin:0 0 10px',
          text: src ? src.split('/').pop() : '이미지를 등록하면 아래에서 고른 위치에 표시됩니다.'
        }),
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn primary', text: src ? '이미지 교체' : '이미지 추가',
            onclick: function () { pickProdImage('extraImg', '추가', renderExtraImg); }
          }),
          src ? el('button', {
            class: 'btn danger', text: '이미지 삭제',
            onclick: function () {
              if (!window.confirm('추가 이미지를 삭제할까요?')) return;
              prodMutate(function (arr) { arr[prodIndex(p.id)].extraImg = ''; });
              renderExtraImg();
              toast('삭제되었습니다. 발행하면 홈페이지에 반영됩니다.');
            }
          }) : null
        ])
      ])
    ]));

    /* ---- 노출 위치 선택 ---- */
    var cur = extraPosOf(p);
    var wrap = el('div', { class: 'dt-poswrap' }, [
      el('div', { class: 'dt-poshead', text: '이미지 노출 위치' })
    ]);

    EXTRA_POS.forEach(function (opt) {
      var radio = el('input', { type: 'radio', name: 'dtExtraPos', value: opt.v });
      radio.checked = (cur === opt.v);
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        prodMutate(function (arr) { arr[prodIndex(p.id)].extraImgPos = opt.v; });
        renderExtraImg();
        toast('노출 위치를 “' + opt.label + '” 로 바꿨습니다. 발행하면 반영됩니다.', 'ok');
      });

      wrap.appendChild(el('label', { class: 'dt-pos' + (cur === opt.v ? ' on' : '') }, [
        radio,
        el('div', {}, [
          el('div', { class: 'dt-pos-t', text: opt.label }),
          el('div', { class: 'dt-pos-d', text: opt.desc })
        ])
      ]));
    });

    if (!src) {
      wrap.appendChild(el('div', {
        class: 'hint', style: 'margin-top:10px',
        text: '※ 이미지를 등록해야 실제로 표시됩니다.'
      }));
    }
    host.appendChild(wrap);
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

  /* 고정 여부는 tr 의 data-pin, 첨부는 제목 칸 링크(data-file)로 보관한다.
     사람이 읽는 표시(공지 배지·첨부 링크)는 홈페이지에 그대로 나온다. */

  var PIN_BADGE = 'display:inline-block;background:#1064A7;color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;letter-spacing:-.01em';
  var FILE_LINK = 'display:inline-flex;align-items:center;gap:3px;margin-left:8px;font-size:12px;color:#1064A7;font-weight:600;text-decoration:none;vertical-align:middle';
  var TR_PIN = 'border-bottom:1px solid #eef1f6;background:#f7fbff';

  function noticeModel() {
    var html = S.doc.pageHtml('notice');
    var tbody = findNode(html, function (n) { return n.tag === 'tbody'; });
    if (!tbody) return null;
    var rows = tbody.children.filter(function (c) { return c.tag === 'tr'; }).map(function (tr) {
      var tds = tr.children.filter(function (c) { return c.tag === 'td'; });
      var pin = SiteDoc.attrOf(tr, 'data-pin') === '1';

      // 제목 칸 = 첨부 링크를 통째로 들어낸 나머지 글자.
      // (링크 글자가 예전엔 "첨부파일", 지금은 실제 파일명이라 글자로 판별하지 않는다)
      var titleTd = tds[1];
      var tdFrag = titleTd ? html.slice(titleTd.contentStart, titleTd.contentEnd) : '';
      var link = titleTd ? findNode(tdFrag, function (n) { return n.tag === 'a'; }) : null;
      var title = htmlToText(link ? tdFrag.slice(0, link.start) + tdFrag.slice(link.end) : tdFrag);

      var v = tds.map(function (td) { return SiteDoc.textOf(td).trim(); });
      return {
        pin: pin,
        no: pin ? '' : (v[0] || ''),
        title: title,
        writer: v[2] || '', date: v[3] || '', hit: v[4] || '',
        file: link ? (SiteDoc.attrOf(link, 'href') || '') : '',
        fileName: link ? (SiteDoc.attrOf(link, 'data-name') || '') : ''
      };
    });
    return { node: tbody, rows: rows };
  }

  function noticeWrite(rows) {
    var m = noticeModel();
    if (!m) return;
    // 고정이 먼저, 그 다음 최신 등록일
    var sorted = sortBoard(rows);

    var body = sorted.map(function (r) {
      var no = r.pin
        ? '<span style="' + PIN_BADGE + '">공지</span>'
        : esc(r.no || '—');
      var file = attachLink(r.file, r.fileName, FILE_LINK, '📎 ');
      return '<tr' + (r.pin ? ' data-pin="1"' : '') + ' style="' + (r.pin ? TR_PIN : TR_S) + '">' +
        '<td style="' + TD_C + '">' + no + '</td>' +
        '<td style="' + TD_T + '">' + esc(r.title || '') + file + '</td>' +
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

      /* 상단 고정 */
      var pin = el('input', { type: 'checkbox', class: 'pin-chk' });
      pin.checked = !!r.pin;
      pin.addEventListener('change', function () {
        var rows = noticeModel().rows;
        rows[i].pin = pin.checked;
        noticeWrite(rows);
        renderNotice();
        toast(pin.checked ? '맨 위에 고정했습니다.' : '고정을 해제했습니다.', 'ok');
      });

      /* 첨부 파일 — 올리기 · 바꾸기 · 빼기 */
      function setNoticeFile(f) {
        var rows = noticeModel().rows;
        rows[i].file = f ? f.path : '';
        rows[i].fileName = f ? f.name : '';
        noticeWrite(rows); renderNotice();
        toast(f ? '“' + f.name + '” 을 붙였습니다. 발행하면 홈페이지에서 내려받을 수 있습니다.' : '첨부를 뺐습니다.',
          'ok', f ? 5000 : 2500);
      }

      var fileCell = el('div', { class: 'att' });
      if (r.file) {
        fileCell.appendChild(el('a', {
          class: 'att-name', href: assetUrl(r.file), target: '_blank', rel: 'noopener',
          text: r.fileName || r.file.split('/').pop()
        }));
        fileCell.appendChild(el('button', {
          class: 'btn sm', text: '바꾸기', title: '다른 파일로 교체',
          onclick: function () { pickAttachment('notice').then(function (f) { if (f) setNoticeFile(f); }); }
        }));
        fileCell.appendChild(el('button', {
          class: 'att-x', text: '×', title: '첨부 삭제',
          onclick: function () { setNoticeFile(null); }
        }));
      } else {
        fileCell.appendChild(el('button', {
          class: 'btn sm', text: '+ 파일',
          onclick: function () { pickAttachment('notice').then(function (f) { if (f) setNoticeFile(f); }); }
        }));
      }

      host.appendChild(el('tr', { class: r.pin ? 'is-pin' : '' }, [
        el('td', { class: 'c' }, [pin]),
        el('td', {}, [r.pin ? el('span', { class: 'pin-tag', text: '공지' }) : inp('no', '—')]),
        el('td', {}, [inp('title', '공지 제목')]),
        el('td', {}, [fileCell]),
        el('td', {}, [inp('writer', '관리자')]),
        el('td', {}, [inp('date', '2026.07.29')]),
        el('td', {}, [el('button', {
          class: 'btn sm danger', text: '삭제', onclick: function () {
            if (!window.confirm('“' + (r.title || '이 공지') + '”을(를) 삭제할까요?')) return;
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
    m.rows.unshift({
      pin: false, no: String(next), title: '새 공지사항', writer: '관리자',
      date: d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()),
      hit: '0', file: '', fileName: ''
    });
    noticeWrite(m.rows);
    renderNotice();
  });

  /* ---------- 자료실 ----------
     카드 한 장이 자료 하나다. 화면에 보이는 값(자료명·설명·유형·제품·형식·용량·등록일)은 카드 글자에서,
     보이지 않는 값(파일 경로·원래 파일명·링크·고정)은 data- 속성에서 읽는다. */

  var ARCH_TYPES = ['카탈로그', '제품 사양서', '제품 설명서', '도면', '기타'];
  var ARCH_VIEWABLE = /\.(pdf|jpe?g|png)$/i;
  /* 자료실 고정 표시 — 옆에 있는 .arch-type 칩과 같은 크기·모양, 색만 진하게 */
  var ARC_FIX = 'display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:6px;' +
    'font-size:13px;font-weight:700;white-space:nowrap;background:#1064a7;color:#fff';

  function archiveModel() {
    var html = S.doc.pageHtml('archive');
    var grid = findNode(html, function (n) { return /(^|\s)arch-grid(\s|$)/.test(SiteDoc.attrOf(n, 'class') || ''); });
    if (!grid) return null;
    var cards = grid.children.filter(function (c) {
      return c.tag !== '#text' && /(^|\s)arch-card(\s|$)/.test(SiteDoc.attrOf(c, 'class') || '');
    }).map(function (card) {
      var part = {}, img = null;
      (function walk(n) {
        n.children.forEach(function (c) {
          if (c.tag === '#text') return;
          if (c.tag === 'img' && !img) img = c;
          var m = /(^|\s)arch-(title|desc|type|prod|date|ext|size)(\s|$)/.exec(SiteDoc.attrOf(c, 'class') || '');
          if (m && part[m[2]] === undefined) part[m[2]] = SiteDoc.textOf(c).trim();
          walk(c);
        });
      })(card);
      function attr(k) { return SiteDoc.attrOf(card, k) || ''; }
      var file = attr('data-file');
      var link = attr('data-link');
      // 예전 카드는 <a href> 자체가 첨부/링크였다
      if (!link && card.tag === 'a') {
        var h = attr('href');
        if (h !== file && h !== 'javascript:void(0)') link = h;
      }
      return {
        title: part.title || '', desc: part.desc || '',
        type: part.type || attr('data-type'), product: part.prod || '',
        date: part.date || '',
        img: img ? (SiteDoc.attrOf(img, 'src') || '') : '',
        pin: attr('data-pin') === '1',
        file: file, fileName: attr('data-name'),
        ext: part.ext || '', size: part.size || '',
        href: link
      };
    });
    return { node: grid, cards: cards };
  }

  function archiveCardHtml(c) {
    var ext = String(c.ext || '').trim().toUpperCase();
    var size = String(c.size || '').trim();
    var href = String(c.href || '').trim();

    var thumb = c.img
      ? '<div class="arch-thumb"><img src="' + esc(c.img) + '" alt="' + esc(c.title) + '" loading="lazy"></div>'
      : '<div class="arch-thumb is-ph"><span class="arch-ph">' + esc(ext || 'FILE') + '</span></div>';
    // 고정한 자료임을 방문자도 알아볼 수 있게 표시한다.
    // 홈페이지 CSS 를 건드리지 않도록, 옆의 유형 칩과 같은 모양을 직접 입힌다.
    var top = (c.pin ? '<span class="arch-fix" style="' + ARC_FIX + '">고정</span>' : '') +
      (c.type ? '<span class="arch-type">' + esc(c.type) + '</span>' : '') +
      (c.product ? '<span class="arch-prod">' + esc(c.product) + '</span>' : '') +
      (c.date ? '<span class="arch-date">' + esc(c.date) + '</span>' : '');
    var meta = (ext ? '<span class="arch-ext">' + esc(ext) + '</span>' : '') +
      (size ? '<span class="arch-size">' + esc(size) + '</span>' : '');

    // 첨부 파일이 있으면 내려받기(PDF·이미지는 미리보기도), 없으면 입력한 링크로 이동
    var acts;
    if (c.file) {
      acts = (ARCH_VIEWABLE.test(c.file) ? '<a class="arch-view" href="' + esc(c.file) + '" target="_blank" rel="noopener">미리보기</a>' : '') +
        '<a class="arch-dl" href="' + esc(c.file) + '" download' + (c.fileName ? '="' + esc(c.fileName) + '"' : '') + '>다운로드</a>';
    } else if (href) {
      acts = '<a class="arch-dl is-link" href="' + esc(href) + '"' + (/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '') + '>바로가기</a>';
    } else {
      acts = '<span class="arch-dl is-off">준비 중</span>';
    }

    return '<article class="arch-card"' +
      (c.type ? ' data-type="' + esc(c.type) + '"' : '') +
      (c.pin ? ' data-pin="1"' : '') +
      (c.file ? ' data-file="' + esc(c.file) + '" data-name="' + esc(c.fileName || '') + '"' : '') +
      (href ? ' data-link="' + esc(href) + '"' : '') + '>' +
      thumb +
      '<div class="arch-body"><div class="arch-top">' + top + '</div>' +
      '<h3 class="arch-title">' + esc(c.title) + '</h3>' +
      (c.desc ? '<p class="arch-desc">' + esc(c.desc) + '</p>' : '') + '</div>' +
      '<div class="arch-foot"><div class="arch-meta">' + meta + '</div><div class="arch-acts">' + acts + '</div></div>' +
      '</article>';
  }

  function archiveWrite(cards) {
    var m = archiveModel();
    if (!m) return;
    // 고정이 먼저, 그 다음 최신 등록일 (같은 날짜면 손댄 순서 유지)
    var sorted = sortBoard(cards);
    var html = S.doc.pageHtml('archive');
    S.doc.setPageHtml('archive', html.slice(0, m.node.contentStart) + sorted.map(archiveCardHtml).join('') + html.slice(m.node.contentEnd));
    refreshBlocks('archive');
    S.changed.board++;
    updateChangeUI();
  }

  function renderArchive() {
    var m = archiveModel();
    var host = $('#archList');
    host.innerHTML = '';
    if (!m) { host.innerHTML = '<div class="empty">자료실 목록을 찾지 못했습니다.</div>'; return; }
    if (!m.cards.length) { host.innerHTML = '<div class="empty">등록된 자료가 없습니다.</div>'; return; }

    // 관련 제품 입력칸 추천 목록: 제품소개의 분류와 제품명
    var suggest = el('datalist', { id: 'archProdList' });
    var seen = {};
    S.doc.productsData().forEach(function (p) {
      [p.cat, p.name].forEach(function (v) {
        if (v && !seen[v]) { seen[v] = 1; suggest.appendChild(el('option', { value: v })); }
      });
    });
    host.appendChild(suggest);

    function save(i, patch, redraw) {
      var cards = archiveModel().cards;
      Object.keys(patch).forEach(function (k) { cards[i][k] = patch[k]; });
      archiveWrite(cards);
      if (redraw) renderArchive();
    }
    // 버튼이 든 칸은 label 로 감싸지 않는다 (글자를 눌렀을 때 버튼이 눌리는 것을 막기 위해)
    function field(label, control, cls) {
      var tag = /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? 'label' : 'div';
      return el(tag, { class: 'field' + (cls ? ' ' + cls : '') }, [el('span', { text: label }), control]);
    }

    m.cards.forEach(function (c, i) {
      function inp(key, ph) {
        var e = el('input', { class: 'input', value: c[key] || '', placeholder: ph });
        e.addEventListener('change', function () {
          var p = {};
          p[key] = e.value.trim();
          save(i, p);
        });
        return e;
      }
      var ch = S.imgChanges[c.img] || S.imgChanges['__new__' + c.img];

      /* 상단 고정 */
      var pin = el('label', { class: 'pin-box' + (c.pin ? ' on' : '') });
      var pinChk = el('input', { type: 'checkbox' });
      pinChk.checked = !!c.pin;
      pinChk.addEventListener('change', function () {
        save(i, { pin: pinChk.checked }, true);
        toast(pinChk.checked ? '맨 앞에 고정했습니다.' : '고정을 해제했습니다.', 'ok');
      });
      pin.appendChild(pinChk);
      pin.appendChild(el('span', { text: '고정' }));

      /* 자료 유형 */
      var typeSel = el('select', { class: 'input' });
      var types = [''].concat(ARCH_TYPES);
      if (c.type && types.indexOf(c.type) < 0) types.push(c.type);
      types.forEach(function (t) {
        var o = el('option', { value: t, text: t || '선택 안 함' });
        o.selected = t === (c.type || '');
        typeSel.appendChild(o);
      });
      typeSel.addEventListener('change', function () { save(i, { type: typeSel.value }); });

      /* 관련 제품 · 카테고리 */
      var prod = inp('product', '예: 주차관제, 차량인식기');
      prod.setAttribute('list', 'archProdList');

      /* 간단한 설명 */
      var desc = el('textarea', { class: 'input', rows: '2', placeholder: '자료를 한두 줄로 소개해 주세요. (선택)' });
      desc.value = c.desc || '';
      desc.addEventListener('change', function () { save(i, { desc: desc.value.replace(/\s+/g, ' ').trim() }); });

      /* 표지(썸네일) */
      var cover = el('div', { class: 'thumbs arch-cover' }, [
        c.img ? el('div', { class: 't' }, [
          el('img', { src: ch ? ch.previewUrl : assetUrl(c.img), alt: '' }),
          el('button', { text: '×', title: '표지 빼기', onclick: function () { save(i, { img: '' }, true); } })
        ]) : null,
        el('div', { class: 'add' + (c.img ? ' sm' : ''), text: c.img ? '표지 변경' : '+ 표지 이미지', onclick: function () { addArchiveImage(i); } })
      ]);

      /* 첨부 파일 — 올리면 형식·용량을 자동으로 채운다 */
      function takeArchiveFile() {
        pickAttachment('archive').then(function (f) {
          if (!f) return;
          save(i, {
            file: f.path, fileName: f.name,
            ext: fileExt(f.name),
            size: fmtSize(f.size)
          }, true);
          toast('“' + f.name + '” 을 붙였습니다. 파일 형식·용량은 자동으로 채웠고, 발행하면 내려받을 수 있습니다.', 'ok', 5000);
        });
      }

      var fileCell = el('div', { class: 'att' }, c.file ? [
        el('a', {
          class: 'att-name', href: assetUrl(c.file), target: '_blank', rel: 'noopener',
          text: c.fileName || c.file.split('/').pop()
        }),
        el('button', {
          class: 'btn sm', text: '바꾸기', title: '다른 파일로 교체',
          onclick: takeArchiveFile
        }),
        el('button', {
          class: 'att-x', text: '×', title: '첨부 삭제',
          onclick: function () {
            save(i, { file: '', fileName: '', ext: '', size: '' }, true);
            toast('첨부를 뺐습니다.');
          }
        })
      ] : [
        el('button', { class: 'btn sm', text: '+ 파일 올리기', onclick: takeArchiveFile })
      ]);

      host.appendChild(el('div', { class: 'item' + (c.pin ? ' is-pin' : '') }, [
        el('div', { class: 'ih' }, [
          el('span', { class: 'idx', text: String(i + 1) }),
          el('div', { style: 'flex:1' }, [inp('title', '자료명')]),
          pin,
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
        el('div', { class: 'arch-edit' }, [
          cover,
          el('div', { class: 'arch-fields' }, [
            field('자료 유형', typeSel),
            field('관련 제품 · 카테고리', prod),
            field('등록일', inp('date', '2026.09.17')),
            field('간단한 설명', desc, 'wide'),
            field('첨부 파일 (PDF·한글·워드·엑셀 등, 20MB 이하)', fileCell),
            field('파일 형식', inp('ext', 'PDF')),
            field('용량', inp('size', '2.4MB')),
            field(c.file ? '연결 링크 (첨부 파일이 있으면 파일이 우선)' : '연결 링크 (파일 대신 다른 주소로 연결할 때, 선택)', inp('href', 'https://…'), 'wide')
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
    m.cards.unshift({
      title: '새 자료', desc: '', type: ARCH_TYPES[0], product: '', img: '', pin: false,
      file: '', fileName: '', ext: '', size: '', href: '',
      date: d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate())
    });
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

  /* ===================== 내용이 줄어드는지 살피기 =====================
     발행하거나 임시저장본을 불러올 때, 실수로 내용이 통째로 사라지는 일을 막는다.
     (오래된 임시저장본을 불러와 발행하면 최신 내용이 옛것으로 덮어써진 적이 있다) */

  /** 문서에 무엇이 몇 개 있는지 세어 둔다 */
  function censusOf(doc) {
    var c = { items: {} };
    try {
      if (doc.hasProducts()) c.items['제품'] = doc.productsData().length;

      var perf = doc.perfData() || {};
      var pn = Object.keys(perf).reduce(function (a, k) { return a + (perf[k] || []).length; }, 0);
      if (pn) c.items['주요실적'] = pn;

      (doc.listGalleries() || []).forEach(function (g) {
        var name = crumbOf([g.pageNames.join(' · '), g.area, g.category]).join(' › ');
        c.items[name] = (c.items[name] || 0) + g.items.length;
      });

      c.items['전체 이미지'] = (doc.listImages() || []).length;
    } catch (e) { /* 셀 수 없으면 비교를 건너뛴다 */ }
    return c;
  }

  /** 줄어든 항목만 추려낸다 */
  function shrinkage(before, after) {
    var out = [];
    Object.keys(before.items).forEach(function (k) {
      var b = before.items[k];
      var a = after.items[k] === undefined ? 0 : after.items[k];
      if (a < b) out.push({ name: k, from: b, to: a });
    });
    out.sort(function (x, y) { return (y.from - y.to) - (x.from - x.to); });
    return out;
  }

  /** 줄어드는 내용을 눈에 띄게 보여 주는 상자 */
  function shrinkBox(list, lead) {
    return el('div', { class: 'warn-box' }, [
      el('div', { class: 'warn-t', text: '⚠ 내용이 줄어듭니다' }),
      el('p', { class: 'warn-lead', text: lead }),
      el('ul', { class: 'warn-list' }, list.map(function (s) {
        return el('li', {}, [
          el('b', { text: s.name }),
          document.createTextNode('  ' + s.from + '개 → '),
          el('strong', { text: s.to + '개' }),
          el('span', { class: 'warn-gap', text: ' (' + (s.from - s.to) + '개 사라짐)' })
        ]);
      })),
      el('p', { class: 'warn-foot', text: '의도한 것이 아니라면 취소하고 제작사에 문의해 주세요.' })
    ]);
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

    // 지금 올리려는 내용이 현재 홈페이지보다 줄어들지 먼저 살핀다
    var lost = [];
    try {
      lost = shrinkage(censusOf(new SiteDoc(S.doc.original)), censusOf(S.doc));
    } catch (e) { /* 비교 실패 시 그냥 진행 */ }

    var body = el('div', {}, [
      lost.length ? shrinkBox(lost, '지금 발행하면 홈페이지에서 아래 내용이 사라집니다.') : null,
      el('p', { text: '아래 내용을 홈페이지에 반영합니다.' }),
      el('ul', { style: 'margin:12px 0 0 18px' }, parts.map(function (p) { return el('li', { text: p }); })),
      el('p', { class: 'hint', style: 'margin-top:14px', text: '반영 후 홈페이지에 실제로 보이기까지 5분 정도 걸립니다. (길면 10분)' })
    ]);

    confirmBox('홈페이지에 발행', body,
      lost.length ? '그래도 발행하기' : '발행하기',
      { okDanger: lost.length > 0 }).then(function (ok) {
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

  /* ===================== 문의함 =====================
     홈페이지 문의 폼이 보낸 내용을 서버(Cloudflare)에서 받아 보여준다.
     홈페이지 파일과는 무관하므로 "발행"과 상관없이 바로 반영된다. */

  var INQ_ST = [
    { v: 'new', label: '신규', cls: 'warn' },
    { v: 'doing', label: '진행중', cls: '' },
    { v: 'done', label: '완료', cls: 'ok' }
  ];
  var inqAll = [];
  var inqTab = 'all';

  function inqApi(path, opt) {
    return fetch('/api/' + path, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    }, opt || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || ('오류 ' + r.status));
        return d;
      });
    });
  }

  function loadInquiries() {
    var host = $('#inqList');
    host.innerHTML = '<div class="empty">불러오는 중…</div>';
    if (S.be && S.be.mode === 'preview') {
      host.innerHTML = '<div class="empty">미리보기 모드에서는 문의함을 볼 수 없습니다.</div>';
      return;
    }
    inqApi('inquiries?limit=300').then(function (d) {
      inqAll = d.items || [];
      updateInqBadge(d.newCount || 0);
      renderInq();
    }).catch(function (e) {
      host.innerHTML = '<div class="empty">문의를 불러오지 못했습니다.<br><small>' + esc(e.message) + '</small></div>';
    });
    showMailStatus();
  }

  /* 알림 메일이 연결돼 있는지 보여준다 */
  var MAIL_OFF = {
    'disabled': '알림 메일은 지금 꺼져 있습니다. 문의는 이 화면에 그대로 쌓입니다.',
    'no-key': '메일 서비스 키가 아직 등록되지 않았습니다. 문의는 이 화면에 그대로 쌓입니다.',
    'no-from': '보내는 사람 주소가 아직 정해지지 않았습니다. 문의는 이 화면에 그대로 쌓입니다.'
  };

  function showMailStatus() {
    var bar = $('#mailBar'), tx = $('#mailTx'), btn = $('#mailTest');
    if (!bar) return;
    inqApi('mail').then(function (m) {
      bar.hidden = false;
      bar.classList.toggle('off', !m.on);
      if (m.on) {
        tx.textContent = '새 문의가 들어오면 ' + m.to + ' 로 알림 메일이 갑니다.' +
          (m.from ? '  (보내는 주소: ' + m.from + ')' : '');
        btn.hidden = false;
      } else {
        tx.textContent = (MAIL_OFF[m.reason] || '알림 메일을 보낼 수 없는 상태입니다.') +
          '  받을 주소: ' + m.to;
        btn.hidden = true;
      }
    }).catch(function () { bar.hidden = true; });
  }

  /** 왼쪽 메뉴 숫자 + 대시보드 알림을 함께 갱신한다 */
  function updateInqBadge(n) {
    n = n || 0;
    var b = $('#nInq');
    if (b) { b.textContent = n; b.hidden = !n; }

    var box = $('#inqAlert');
    if (box) {
      box.hidden = !n;
      var t = $('#inqAlertTitle'), s = $('#inqAlertSub');
      if (t) t.textContent = '읽지 않은 문의가 ' + n + '건 있습니다';
      if (s) s.textContent = '홈페이지 온라인 문의로 접수된 내용입니다. 확인 후 상태를 바꿔 주세요.';
    }

    // 브라우저 탭 제목에도 표시해 다른 창을 보고 있어도 알 수 있게
    document.title = (n ? '(' + n + ') ' : '') + '한맥아이피에스 홈페이지 관리자';
  }

  /** 숫자만 가볍게 받아와 알림을 갱신한다 (목록 전체를 받지 않는다) */
  function refreshInqBadge() {
    if (!S.be || S.be.mode !== 'server') return Promise.resolve();
    return inqApi('inquiries?countOnly=1')
      .then(function (d) { updateInqBadge(d.newCount || 0); })
      .catch(function () { /* 조용히 넘어간다 — 알림은 부가 기능 */ });
  }

  function renderInq() {
    var q = ($('#inqSearch').value || '').trim().toLowerCase();
    var counts = { all: inqAll.length };
    INQ_ST.forEach(function (s) { counts[s.v] = inqAll.filter(function (x) { return x.status === s.v; }).length; });

    var tabs = $('#inqTabs');
    tabs.innerHTML = '';
    [{ v: 'all', label: '전체' }].concat(INQ_ST).forEach(function (t) {
      tabs.appendChild(el('button', {
        class: inqTab === t.v ? 'on' : '',
        html: esc(t.label) + '<span class="c">' + (counts[t.v] || 0) + '</span>',
        onclick: function () { inqTab = t.v; renderInq(); }
      }));
    });

    var list = inqAll.filter(function (x) {
      if (inqTab !== 'all' && x.status !== inqTab) return false;
      if (q && (x.name + ' ' + x.company + ' ' + x.phone + ' ' + x.email + ' ' + x.solution + ' ' + x.excerpt)
        .toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    var host = $('#inqList');
    host.innerHTML = '';
    if (!list.length) {
      host.innerHTML = '<div class="empty">' + (inqAll.length ? '조건에 맞는 문의가 없습니다.' : '아직 접수된 문의가 없습니다.') + '</div>';
      return;
    }

    var tbl = el('table', { class: 'inq-tbl' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: '접수일', style: 'width:104px' }),
      el('th', { text: '회사 / 담당자', style: 'width:180px' }),
      el('th', { text: '연락처', style: 'width:180px' }),
      el('th', { text: '관심 솔루션 / 문의 내용' }),
      el('th', { text: '상태', style: 'width:104px' }),
      el('th', { text: '', style: 'width:64px' })
    ])]));

    var tb = el('tbody');
    list.forEach(function (it) { tb.appendChild(inqRow(it)); });
    tbl.appendChild(tb);
    host.appendChild(tbl);
  }

  function inqRow(it) {
    var st = INQ_ST.filter(function (s) { return s.v === it.status; })[0] || INQ_ST[0];

    var sel = el('select', { class: 'input sm' });
    INQ_ST.forEach(function (s) {
      var o = el('option', { value: s.v, text: s.label });
      if (s.v === it.status) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      inqApi('inquiries/' + encodeURIComponent(it.id), {
        method: 'PATCH', body: JSON.stringify({ status: sel.value })
      }).then(function () {
        it.status = sel.value;
        updateInqBadge(inqAll.filter(function (x) { return x.status === 'new'; }).length);
        renderInq();
        toast('상태를 “' + (INQ_ST.filter(function (s) { return s.v === sel.value; })[0] || {}).label + '” 로 바꿨습니다.', 'ok');
      }).catch(function (e) { toast(e.message, 'err'); sel.value = it.status; });
    });

    var tr = el('tr', { class: it.status === 'new' ? 'is-new' : '' }, [
      el('td', {}, [
        el('div', { class: 'inq-d', text: fmtInqDate(it.createdAt) }),
        el('div', { class: 'inq-t', text: fmtInqTime(it.createdAt) })
      ]),
      el('td', {}, [
        el('div', { class: 'inq-co', text: it.company || '(회사명 없음)' }),
        el('div', { class: 'inq-nm', text: it.name })
      ]),
      el('td', {}, [
        el('div', { class: 'inq-ph', text: it.phone }),
        el('div', { class: 'inq-em', text: it.email })
      ]),
      el('td', {}, [
        el('div', { class: 'inq-sol', text: it.solution || '(솔루션 미선택)' }),
        el('div', { class: 'inq-msg', text: it.excerpt || '(내용 없음)' }),
        el('button', { class: 'inq-more', text: '전체 내용 보기', onclick: function () { openInquiry(it); } })
      ]),
      el('td', {}, [sel]),
      el('td', {}, [
        el('button', {
          class: 'btn sm danger', text: '삭제',
          onclick: function () { removeInquiryDialog(it); }
        })
      ])
    ]);
    return tr;
  }

  /* 날짜를 크게, 시각은 아래에 작게 */
  function fmtInqDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }
  function fmtInqTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function openInquiry(it) {
    busy(true, '문의 내용을 불러오는 중…');
    inqApi('inquiries/' + encodeURIComponent(it.id)).then(function (d) {
      busy(false);
      var x = d.item || {};
      var rows = [
        ['접수일', new Date(x.createdAt).toLocaleString('ko-KR')],
        ['이름', x.name],
        ['회사 / 기관', x.company || '-'],
        ['연락처', x.phone],
        ['이메일', x.email],
        ['관심 솔루션', x.solution || '-']
      ];
      var body = el('div', {}, [
        el('div', { class: 'inq-view' }, rows.map(function (r) {
          return el('div', { class: 'inq-vrow' }, [
            el('div', { class: 'k', text: r[0] }),
            el('div', { class: 'v', text: r[1] || '-' })
          ]);
        })),
        el('div', { class: 'inq-vbody' }, [
          el('div', { class: 'k', text: '문의 내용' }),
          el('div', { class: 'v', text: x.message || '' })
        ])
      ]);
      confirmBox('문의 상세', body, '닫기', true);
    }).catch(function (e) { busy(false); toast(e.message, 'err'); });
  }

  function removeInquiryDialog(it) {
    var body = el('div', {}, [
      el('p', {}, [
        document.createTextNode('아래 문의를 삭제합니다.')
      ]),
      el('div', { class: 'inq-view', style: 'margin-top:12px' }, [
        el('div', { class: 'inq-vrow' }, [el('div', { class: 'k', text: '접수일' }), el('div', { class: 'v', text: new Date(it.createdAt).toLocaleString('ko-KR') })]),
        el('div', { class: 'inq-vrow' }, [el('div', { class: 'k', text: '담당자' }), el('div', { class: 'v', text: (it.company ? it.company + ' · ' : '') + it.name })]),
        el('div', { class: 'inq-vrow' }, [el('div', { class: 'k', text: '연락처' }), el('div', { class: 'v', text: it.phone })])
      ]),
      el('p', { class: 'hint', style: 'margin-top:14px', text: '삭제하면 되돌릴 수 없습니다.' })
    ]);
    confirmBox('문의 삭제', body, '삭제하기').then(function (ok) {
      if (!ok) return;
      inqApi('inquiries/' + encodeURIComponent(it.id), { method: 'DELETE' }).then(function () {
        inqAll = inqAll.filter(function (x) { return x.id !== it.id; });
        updateInqBadge(inqAll.filter(function (x) { return x.status === 'new'; }).length);
        renderInq();
        toast('삭제되었습니다.');
      }).catch(function (e) { toast(e.message, 'err'); });
    });
  }

  /* ===================== 내비게이션 ===================== */

  var TITLES = {
    dash: '대시보드', images: '이미지 관리', text: '텍스트 관리', perf: '주요실적 관리',
    detail: '제품상세', board: '공지사항 · 자료실', inq: '문의함',
    info: '회사정보 · 푸터', seo: 'SEO 설정', history: '발행 이력',
    account: '비밀번호 변경'
  };

  function go(name) {
    $$('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === name); });
    $$('[data-panel]').forEach(function (p) { p.classList.toggle('on', p.dataset.panel === name); });
    $('#pageTitle').textContent = TITLES[name] || name;
    $('#side').classList.remove('open');
    if (name === 'history') loadCommits($('#histList'), 30);
    if (name === 'dash') loadCommits($('#dashCommits'), 6);
    if (name === 'inq') loadInquiries();
    window.scrollTo(0, 0);
  }

  /* ===================== 이벤트 바인딩 ===================== */

  function bind() {
    $$('[data-nav]').forEach(function (a) { a.addEventListener('click', function () { go(a.dataset.nav); }); });
    $$('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.goto); }); });
    $('#menuToggle').addEventListener('click', function () { $('#side').classList.toggle('open'); });

    $('#imgSearch').addEventListener('input', renderImageGrid);
    $('#imgOnlyChanged').addEventListener('change', renderImageGrid);
    // 페이지를 바꾸면 하위 선택은 초기화한다 (없는 조합이 남지 않도록)
    $('#imgFPage').addEventListener('change', function () { $('#imgFArea').value = ''; $('#imgFCat').value = ''; renderImageGrid(); });
    $('#imgFArea').addEventListener('change', function () { $('#imgFCat').value = ''; renderImageGrid(); });
    $('#imgFCat').addEventListener('change', renderImageGrid);

    $('#inqSearch').addEventListener('input', renderInq);
    $('#inqReload').addEventListener('click', loadInquiries);
    $('#mailTest') && $('#mailTest').addEventListener('click', function () {
      busy(true, '시험 메일을 보내는 중…');
      inqApi('mail/test', { method: 'POST' }).then(function (r) {
        busy(false);
        toast('“' + r.to + '” 로 시험 메일을 보냈습니다. 받은 편지함(또는 스팸함)을 확인해 주세요.', 'ok', 7000);
      }).catch(function (e) { busy(false); toast(e.message, 'err', 7000); });
    });

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

    window.addEventListener('beforeunload', function (e) {
      if (hasChanges()) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ===================== 시작 ===================== */
  bind();
  initLogin();
})();
