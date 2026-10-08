/* 한맥아이피에스 홈페이지 영문 표시기 — 자동 생성 파일입니다.
   사전(번역 글)은 이 파일이 아니라 index.html 의 window.HANMEC_EN 에 있습니다.
   번역을 고치실 때는 관리자 > 영문 관리 를 쓰세요. */
/* ============================================================
   en.js — 홈페이지 영문 표시

   한글이 원본이다. 이 파일은 화면에 그려진 한글을 영문으로
   바꿔 보여줄 뿐, 한글 데이터를 고치지 않는다.
   관리자에서 새 글을 올리면 사전에 없는 동안 한글로 나온다.

   · 사전에 없는 문구는 손대지 않는다 (한글 그대로)
   · 국문으로 돌아오면 원래 글자를 되돌린다
   · 주소(?lang=en)와 브라우저에 선택을 기억한다
   ============================================================ */
(function (w, d) {
  'use strict';

  var DICT = w.HANMEC_EN || {};
  var KEY = 'hanmec-lang';
  var KO = /[가-힣]/;

  /* 번역할 속성 — 화면에 글자로 보이거나 읽히는 것만 */
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  /* 건드리면 안 되는 곳 */
  function skip(node) {
    var p = node.parentNode;
    while (p && p.nodeType === 1) {
      var t = p.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA') return true;
      if (p.getAttribute && p.getAttribute('data-no-i18n') !== null) return true;
      p = p.parentNode;
    }
    return false;
  }

  /* 자바스크립트가 이어 붙여 만드는 문구.
     예) "특허증 크게 보기", "12개 실적", "/ 차량인식기"
     → 가운데 알맹이만 사전에서 찾고 나머지는 규칙대로 붙인다. */
  var RULES = [
    // 앞에 구분기호가 붙은 것:  "/ 차량인식기"
    { re: /^(\s*[/·|]\s*)(.+)$/, out: function (m, core) { return m[1] + core; } },
    // "○○ 크게 보기"
    { re: /^(.+?)\s*크게 보기$/, out: function (m, core) { return core + ' — enlarge'; } },
    // "12개 실적"
    { re: /^(\d+)개 실적$/, out: function (m) { return m[1] + (m[1] === '1' ? ' reference' : ' references'); } },
    // "12건", "12개"
    { re: /^(\d+)\s*건$/, out: function (m) { return m[1]; } },
    { re: /^(\d+)\s*개$/, out: function (m) { return m[1]; } }
  ];

  function plain(v) {
    var hit = DICT[v];
    if (hit !== undefined) return hit;
    hit = DICT[v.replace(/\s+/g, ' ').trim()];
    return hit === undefined ? null : hit;
  }

  function lookup(s) {
    var v = String(s);

    // 1) 그대로 찾기
    var hit = plain(v);
    if (hit !== null) {
      if (DICT[v] !== undefined) return hit;
      var head = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0];
      return head + hit + tail;
    }

    // 2) 조합형 규칙
    var t = v.replace(/\s+/g, ' ').trim();
    for (var i = 0; i < RULES.length; i++) {
      var m = t.match(RULES[i].re);
      if (!m) continue;
      var coreKo = m[2] !== undefined ? m[2] : m[1];
      var core = plain(coreKo);
      if (core === null && KO.test(coreKo)) continue;   // 알맹이를 모르면 손대지 않는다
      var res = RULES[i].out(m, core === null ? coreKo : core);
      if (res !== null && res !== undefined) {
        var h2 = v.match(/^\s*/)[0], t2 = v.match(/\s*$/)[0];
        return h2 + res + t2;
      }
    }
    return null;
  }

  /* ---------- 글자 바꾸기 ---------- */

  function toEn(root) {
    var walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var n, jobs = [];
    while ((n = walker.nextNode())) {
      if (!KO.test(n.nodeValue)) continue;
      if (skip(n)) continue;
      var en = lookup(n.nodeValue);
      if (en === null) continue;                 // 사전에 없으면 한글 그대로
      jobs.push([n, en]);
    }
    jobs.forEach(function (j) {
      var node = j[0];
      if (node.__ko === undefined) node.__ko = node.nodeValue;
      node.nodeValue = j[1];
      node.__en = j[1];
    });

    // 속성
    var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
    Array.prototype.forEach.call(els, function (el) {
      ATTRS.forEach(function (a) {
        var v = el.getAttribute && el.getAttribute(a);
        if (!v || !KO.test(v)) return;
        var en = lookup(v);
        if (en === null) return;
        if (el['__ko_' + a] === undefined) el['__ko_' + a] = v;
        el.setAttribute(a, en);
      });
    });
  }

  function toKo(root) {
    var walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var n, jobs = [];
    while ((n = walker.nextNode())) {
      if (n.__ko === undefined) continue;
      jobs.push(n);
    }
    jobs.forEach(function (node) { node.nodeValue = node.__ko; node.__en = undefined; });

    var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
    Array.prototype.forEach.call(els, function (el) {
      ATTRS.forEach(function (a) {
        var k = '__ko_' + a;
        if (el[k] === undefined) return;
        el.setAttribute(a, el[k]);
      });
    });
  }

  /* ---------- 현재 언어 ---------- */

  function isEn() { return d.body.classList.contains('en'); }

  function paint() {
    var root = d.body;
    if (isEn()) toEn(root); else toKo(root);
    d.documentElement.setAttribute('lang', isEn() ? 'en' : 'ko');
  }

  /* 화면이 새로 그려진 뒤에도 영문을 유지한다.
     (제품·실적·게시판처럼 자바스크립트가 나중에 찍는 글도 잡힌다) */
  var pending = null;
  function schedule() {
    if (!isEn()) return;
    if (pending) return;
    pending = w.setTimeout(function () { pending = null; toEn(d.body); }, 0);
  }

  function watch() {
    if (!w.MutationObserver) return;
    new MutationObserver(function (list) {
      if (!isEn()) return;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'characterData') {
          if (KO.test(m.target.nodeValue || '')) { schedule(); return; }
        } else if (m.addedNodes && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var nd = m.addedNodes[j];
            var txt = nd.nodeType === 3 ? nd.nodeValue : (nd.textContent || '');
            if (KO.test(txt)) { schedule(); return; }
          }
        }
      }
    }).observe(d.body, { childList: true, subtree: true, characterData: true });
  }

  /* ---------- 주소 · 기억 ---------- */

  function urlLang() {
    var m = w.location.search.match(/[?&]lang=(ko|en)\b/);
    return m ? m[1] : null;
  }

  function writeUrl(en) {
    if (!w.history || !w.history.replaceState) return;
    var u = w.location.pathname + w.location.search + w.location.hash;
    var s = w.location.search.replace(/([?&])lang=(ko|en)\b&?/, '$1').replace(/[?&]$/, '');
    if (en) s = (s ? s + '&' : '?') + 'lang=en';
    var next = w.location.pathname + s + w.location.hash;
    if (next !== u) w.history.replaceState(null, '', next);
  }

  function setLang(en, remember) {
    d.body.classList.toggle('en', !!en);
    d.querySelectorAll('.lang span[data-lang]').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-lang') === (en ? 'en' : 'ko'));
    });
    paint();
    writeUrl(en);
    if (remember !== false) {
      try { w.localStorage.setItem(KEY, en ? 'en' : 'ko'); } catch (e) {}
    }
  }

  /* ---------- 시작 ---------- */

  function boot() {
    var want = urlLang();
    if (!want) {
      try { want = w.localStorage.getItem(KEY); } catch (e) {}
    }
    // 공유용 사본처럼 기본 언어를 정해 둔 경우
    if (!want) want = w.HANMEC_DEFAULT || 'ko';
    // 주소로 들어온 선택도 기억해 둔다 (다음에 그냥 들어와도 같은 언어로 보이게)
    setLang(want === 'en', true);
    watch();
  }

  /* 홈페이지의 기존 언어 버튼이 부르는 자리.
     index.html 의 applyLang() 에서 이 함수를 불러 준다. */
  w.hanmecApplyLang = function () { paint(); writeUrl(isEn());
    try { w.localStorage.setItem(KEY, isEn() ? 'en' : 'ko'); } catch (e) {} };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* 사전 상태를 확인할 수 있게 열어 둔다 (검수용) */
  w.hanmecI18n = { dict: DICT, toEn: toEn, toKo: toKo, repaint: paint };

})(window, document);
