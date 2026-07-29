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
      images: 0, text: 0, perf: 0, board: 0, info: 0, seo: 0
    },
    curImgTab: 'about',
    curPerfTab: null,
    curPage: null
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
      S.changed = { images: 0, text: 0, perf: 0, board: 0, info: 0, seo: 0 };
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
    buildBoard();
    buildInfo();
    buildSeo();
  }

  /* ===================== 변경 상태 ===================== */

  function hasChanges() {
    return S.doc && (S.doc.hasChanges() || Object.keys(S.imgChanges).length > 0);
  }

  function updateChangeUI() {
    var n = S.changed.images + S.changed.text + S.changed.perf + S.changed.board + S.changed.info + S.changed.seo;
    var lb = $('#chgLabel');
    if (n) { lb.textContent = '변경사항 ' + n + '건'; lb.className = 'chg'; }
    else { lb.textContent = '변경사항 없음'; lb.className = 'chg none'; }
    $('#publishBtn').disabled = !n;
    $('#discardBtn').disabled = !n;

    var map = { nImg: 'images', nTxt: 'text', nPerf: 'perf', nBoard: 'board', nInfo: 'info', nSeo: 'seo' };
    Object.keys(map).forEach(function (id) {
      var e = document.getElementById(id);
      var v = S.changed[map[id]];
      if (!e) return;
      e.textContent = v;
      e.hidden = !v;
    });
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
      return loadSite().then(function () { busy(false); });
    }).catch(function (e) {
      busy(false);
      toast(e.message, 'err', 7000);
    });
  }

  /* ===================== 내비게이션 ===================== */

  var TITLES = {
    dash: '대시보드', images: '이미지 관리', text: '텍스트 관리', perf: '주요실적 관리',
    board: '공지사항 · 자료실', info: '회사정보 · 푸터', seo: 'SEO 설정', history: '발행 이력',
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

    $('#publishBtn').addEventListener('click', publish);
    $('#discardBtn').addEventListener('click', function () {
      if (!window.confirm('저장하지 않은 변경사항을 모두 취소할까요?')) return;
      busy(true, '되돌리는 중…');
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
