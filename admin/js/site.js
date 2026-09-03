/* ============================================================
   site.js — 라이브 index.html 을 읽고/고치고/다시 쓰는 문서 모델
   ------------------------------------------------------------
   index.html 구조
     · <head> …                       ← 타이틀 / 메타
     · <style> …                      ← 서브배너 등 CSS 배경 이미지
     · <body> … <script>              ← 헤더/푸터 (셸)
     · var PAGES={ … }                ← 페이지 기본 정의(JSON)
     · PAGES.key="…"                  ← 뒤에서 덮어쓰는 최종 정의
     · window.PERF={ … }              ← 주요실적 데이터
   편집은 전부 "원본 문자열의 구간 치환"으로 처리한다.
   DOM 직렬화를 거치지 않으므로 손대지 않은 부분은 1바이트도 변하지 않는다.
   ============================================================ */
(function (global) {
  'use strict';

  /* ===================== 0. 저수준 스캐너 ===================== */

  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  var RAW = { script: 1, style: 1 };

  /** HTML 문자열을 훑어 태그 열림/닫힘 위치를 그대로 담은 트리를 만든다. */
  function parseNodes(html) {
    var root = { tag: '#root', children: [], contentStart: 0, contentEnd: html.length, parent: null, attrs: '' };
    var stack = [root];
    var i = 0;

    while (i < html.length) {
      var lt = html.indexOf('<', i);
      if (lt < 0) break;

      if (lt > i) addText(html.slice(i, lt), i, lt);

      // 주석
      if (html.substr(lt, 4) === '<!--') {
        var ce = html.indexOf('-->', lt);
        i = ce < 0 ? html.length : ce + 3;
        continue;
      }
      // 닫는 태그
      if (html[lt + 1] === '/') {
        var cgt = html.indexOf('>', lt);
        if (cgt < 0) break;
        var cname = html.slice(lt + 2, cgt).trim().toLowerCase();
        for (var s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === cname) {
            stack[s].contentEnd = lt;
            stack[s].end = cgt + 1;
            stack.length = s;
            break;
          }
        }
        i = cgt + 1;
        continue;
      }
      // 여는 태그 (속성 안의 > 를 피해 따옴표를 인식)
      var gt = findTagEnd(html, lt);
      if (gt < 0) break;
      var inner = html.slice(lt + 1, gt);
      var selfClose = /\/$/.test(inner.trim());
      var m = /^([A-Za-z][A-Za-z0-9-]*)/.exec(inner);
      if (!m) { i = gt + 1; continue; }
      var tag = m[1].toLowerCase();
      var node = {
        tag: tag,
        attrs: inner.slice(m[1].length),
        start: lt,
        contentStart: gt + 1,
        contentEnd: gt + 1,
        end: gt + 1,
        children: [],
        parent: stack[stack.length - 1]
      };
      stack[stack.length - 1].children.push(node);

      if (VOID[tag] || selfClose) { i = gt + 1; continue; }
      if (RAW[tag]) {
        var close = html.toLowerCase().indexOf('</' + tag, gt);
        node.contentEnd = close < 0 ? html.length : close;
        node.end = close < 0 ? html.length : html.indexOf('>', close) + 1;
        i = node.end;
        continue;
      }
      stack.push(node);
      i = gt + 1;
    }
    // 닫히지 않은 태그 정리
    for (var k = stack.length - 1; k > 0; k--) { stack[k].contentEnd = html.length; stack[k].end = html.length; }

    function addText(txt, a, b) {
      if (!txt.trim()) return;
      stack[stack.length - 1].children.push({ tag: '#text', text: txt, start: a, end: b, children: [] });
    }
    return root;
  }

  function findTagEnd(html, lt) {
    var q = null;
    for (var i = lt + 1; i < html.length; i++) {
      var c = html[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '>') return i;
    }
    return -1;
  }

  function attrOf(node, name) {
    if (!node.attrs) return null;
    var re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    var m = re.exec(node.attrs);
    return m ? (m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4])) : null;
  }

  function textOf(node) {
    if (node.tag === '#text') return decodeEntities(node.text);
    return node.children.map(textOf).join('');
  }

  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  /* ===================== 1. 문자열 구간 치환기 ===================== */

  function Splicer(src) { this.src = src; this.ops = []; }
  Splicer.prototype.replace = function (start, end, text) { this.ops.push({ start: start, end: end, text: text }); };
  Splicer.prototype.result = function () {
    if (!this.ops.length) return this.src;
    var ops = this.ops.slice().sort(function (a, b) { return a.start - b.start; });
    for (var i = 1; i < ops.length; i++) {
      if (ops[i].start < ops[i - 1].end) throw new Error('편집 구간이 겹칩니다. 새로고침 후 다시 시도해 주세요.');
    }
    var out = '', pos = 0;
    for (var j = 0; j < ops.length; j++) {
      out += this.src.slice(pos, ops[j].start) + ops[j].text;
      pos = ops[j].end;
    }
    return out + this.src.slice(pos);
  };

  /* ===================== 2. JS 리터럴 위치 찾기 ===================== */

  function findBalanced(src, openIdx, open, close) {
    open = open || '{';
    close = close || '}';
    var depth = 0, inStr = null, esc = false;
    for (var i = openIdx; i < src.length; i++) {
      var c = src[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") { inStr = c; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (!depth) return i; }
    }
    return -1;
  }

  function findStringEnd(src, quoteIdx) {
    var q = src[quoteIdx], esc = false;
    for (var i = quoteIdx + 1; i < src.length; i++) {
      var c = src[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === q) return i;
    }
    return -1;
  }

  /** JS 문자열 리터럴로 안전하게 직렬화 (</script> 차단 포함) */
  function jsString(str) {
    return JSON.stringify(str).replace(/<\/(script)/gi, '<\\/$1');
  }
  function jsObject(obj) {
    return JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1');
  }

  /* ===================== 3. 그룹 정의 ===================== */

  var GROUPS = [
    { id: 'about',    name: '회사소개', pages: ['company', 'history', 'organization', 'cert', 'location'] },
    { id: 'solution', name: '솔루션',   pages: ['ai', 'control', 'guidance', 'payment', 'etc'] },
    { id: 'products', name: '제품소개', pages: ['products', 'detail'] },
    { id: 'result',   name: '주요실적', pages: ['result'], perf: true },
    { id: 'main',     name: '메인·공통', pages: ['home'], shell: true, style: true },
    { id: 'support',  name: '고객지원', pages: ['notice', 'contact', 'archive'] }
  ];

  var PAGE_NAMES = {
    home: '메인(홈)', company: '대표자 인사말', history: '연혁', organization: '조직구조',
    cert: '인증현황', location: '오시는 길', ai: 'AI 영상인식', control: '스마트 통합 주차관제',
    guidance: '지능형 주차관리', payment: '주차 정산', etc: '대시민 주차포털',
    products: '제품소개', detail: '제품 상세', result: '주요실적',
    notice: '공지사항', contact: '온라인 문의', archive: '자료실'
  };

  function groupOfPage(key) {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].pages.indexOf(key) >= 0) return GROUPS[i].id;
    }
    return 'main';
  }

  /* ===================== 4. SiteDoc ===================== */

  function SiteDoc(html) {
    this.original = html;
    this.pageEdits = {};      // key → 새 HTML
    this.perfEdit = null;     // 새 PERF 객체
    this.productsEdit = null; // 새 PRODUCTS 배열
    this.shellEdit = null;    // 새 셸 HTML
    this.headEdits = [];      // {start,end,text}
    this.imageRenames = [];   // {from,to}
    this._parse();
  }

  SiteDoc.prototype._parse = function () {
    var html = this.original;

    // ---- head / style / shell 구간
    var styleStart = html.indexOf('<style>');
    var bodyStart = html.indexOf('<body');
    var scriptStart = html.indexOf('<script>', bodyStart);
    this.regions = {
      head: { start: 0, end: styleStart },
      style: { start: styleStart, end: bodyStart },
      shell: { start: bodyStart, end: scriptStart }
    };
    this.head = html.slice(0, styleStart);
    this.styleBlock = html.slice(styleStart, bodyStart);
    this.shell = html.slice(bodyStart, scriptStart);

    // ---- var PAGES={...}
    var pi = html.indexOf('var PAGES=');
    var pOpen = html.indexOf('{', pi);
    var pClose = findBalanced(html, pOpen);
    this.regions.pagesBase = { start: pOpen, end: pClose + 1 };
    var baseObj = JSON.parse(html.slice(pOpen, pClose + 1));
    this.pagesBase = baseObj;

    this.pages = {};
    this.order = [];
    var k;
    for (k in baseObj) {
      this.pages[k] = { key: k, html: baseObj[k], src: 'base' };
      this.order.push(k);
    }

    // ---- PAGES.key="..." 오버라이드 (뒤쪽이 최종)
    var re = /PAGES\.([A-Za-z0-9_]+)\s*=\s*"/g, m;
    while ((m = re.exec(html))) {
      var qs = m.index + m[0].length - 1;
      var qe = findStringEnd(html, qs);
      if (qe < 0) continue;
      var key = m[1];
      var val;
      try { val = JSON.parse(html.slice(qs, qe + 1)); } catch (e) { re.lastIndex = qe; continue; }
      if (!this.pages[key]) this.order.push(key);
      this.pages[key] = { key: key, html: val, src: 'override', start: qs, end: qe + 1 };
      re.lastIndex = qe;
    }

    // ---- window.PERF={...}
    var fi = html.indexOf('window.PERF=');
    if (fi >= 0) {
      var fOpen = html.indexOf('{', fi);
      var fClose = findBalanced(html, fOpen);
      this.regions.perf = { start: fOpen, end: fClose + 1 };
      this.perf = JSON.parse(html.slice(fOpen, fClose + 1));
    } else {
      this.perf = {};
    }

    // ---- window.PRODUCTS=[...]  (제품 목록·상세의 원본 데이터)
    var qi = html.indexOf('window.PRODUCTS=');
    if (qi >= 0) {
      var qOpen = html.indexOf('[', qi);
      var qClose = findBalanced(html, qOpen, '[', ']');
      this.regions.products = { start: qOpen, end: qClose + 1 };
      this.products = JSON.parse(html.slice(qOpen, qClose + 1));
    } else {
      this.products = null;   // 아직 데이터 방식으로 전환되지 않은 사이트
    }

    // 순서 정렬 (그룹 순서대로 보기 좋게)
    var self = this;
    var rank = {};
    var n = 0;
    GROUPS.forEach(function (g) { g.pages.forEach(function (p) { rank[p] = n++; }); });
    this.order.sort(function (a, b) {
      var ra = rank[a] === undefined ? 999 : rank[a];
      var rb = rank[b] === undefined ? 999 : rank[b];
      return ra - rb;
    });
  };

  /* ---------- 페이지 ---------- */
  SiteDoc.prototype.pageHtml = function (key) {
    return this.pageEdits[key] !== undefined ? this.pageEdits[key] : (this.pages[key] ? this.pages[key].html : '');
  };
  SiteDoc.prototype.setPageHtml = function (key, html) { this.pageEdits[key] = html; };
  SiteDoc.prototype.pageName = function (key) { return PAGE_NAMES[key] || key; };
  SiteDoc.prototype.groups = function () { return GROUPS; };

  /* ---------- 셸(헤더/푸터) ---------- */
  SiteDoc.prototype.shellHtml = function () { return this.shellEdit !== null ? this.shellEdit : this.shell; };
  SiteDoc.prototype.setShellHtml = function (h) { this.shellEdit = h; };

  /* ---------- 주요실적 ---------- */
  SiteDoc.prototype.perfData = function () { return this.perfEdit || this.perf; };
  SiteDoc.prototype.setPerfData = function (obj) { this.perfEdit = obj; };

  /* ---------- 제품 (목록 + 상세 공통 데이터) ---------- */
  SiteDoc.prototype.hasProducts = function () { return Array.isArray(this.products); };
  SiteDoc.prototype.productsData = function () { return this.productsEdit || this.products || []; };
  SiteDoc.prototype.setProductsData = function (arr) { this.productsEdit = arr; };

  /* ---------- 이미지 경로 교체 (전체 문서 전역) ---------- */
  SiteDoc.prototype.renameImage = function (from, to) {
    this.imageRenames.push({ from: from, to: to });
  };

  /* ---------- head 편집 ---------- */
  SiteDoc.prototype.getTitle = function () {
    var m = /<title>([\s\S]*?)<\/title>/i.exec(this.head);
    return m ? m[1] : '';
  };
  SiteDoc.prototype.getMeta = function (name) {
    var re = new RegExp('<meta[^>]+(?:name|property)\\s*=\\s*["\']' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i');
    var m = re.exec(this.head);
    if (!m) return null;
    var c = /content\s*=\s*"([^"]*)"/i.exec(m[0]) || /content\s*=\s*'([^']*)'/i.exec(m[0]);
    return { tag: m[0], content: c ? c[1] : '' };
  };
  /** 타이틀/메타를 반영한 새 head 문자열을 만든다 */
  SiteDoc.prototype.buildHead = function (fields) {
    var head = this.head;
    if (fields.title !== undefined) {
      if (/<title>[\s\S]*?<\/title>/i.test(head)) {
        head = head.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(fields.title) + '</title>');
      } else {
        head = head.replace(/<\/head>|<style>/i, function (x) { return '<title>' + esc(fields.title) + '</title>\n' + x; });
      }
    }
    var metas = fields.meta || {};
    Object.keys(metas).forEach(function (name) {
      var val = metas[name];
      var attr = /^og:|^twitter:/.test(name) ? 'property' : 'name';
      var re = new RegExp('<meta[^>]+(?:name|property)\\s*=\\s*["\']' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i');
      var tag = '<meta ' + attr + '="' + name + '" content="' + esc(val) + '">';
      if (!val) { head = head.replace(re, ''); return; }
      if (re.test(head)) head = head.replace(re, tag);
      else head = head.replace(/<title>/i, tag + '\n<title>');
    });
    return head;
  };
  SiteDoc.prototype.setHead = function (h) { this.headEdit = h; };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ===================== 5. 직렬화 ===================== */

  SiteDoc.prototype.hasChanges = function () {
    return Object.keys(this.pageEdits).length > 0 || this.perfEdit !== null ||
      this.productsEdit != null || this.shellEdit !== null || this.headEdit !== undefined ||
      this.imageRenames.length > 0 || !!this.baseForceDirty;
  };

  SiteDoc.prototype.serialize = function () {
    var sp = new Splicer(this.original);
    var self = this;

    // head
    if (this.headEdit !== undefined) sp.replace(this.regions.head.start, this.regions.head.end, this.headEdit);
    // shell
    if (this.shellEdit !== null) sp.replace(this.regions.shell.start, this.regions.shell.end, this.shellEdit);

    // 페이지: base 객체에 반영할 것 / 오버라이드 문자열로 반영할 것 분리
    var baseDirty = !!this.baseForceDirty;
    var baseObj = {};
    Object.keys(this.pagesBase).forEach(function (k) { baseObj[k] = self.pagesBase[k]; });

    Object.keys(this.pageEdits).forEach(function (key) {
      var p = self.pages[key];
      var html = self.pageEdits[key];
      if (p && p.src === 'override') {
        sp.replace(p.start, p.end, jsString(html));
      } else {
        baseObj[key] = html;
        baseDirty = true;
      }
    });
    if (baseDirty) sp.replace(this.regions.pagesBase.start, this.regions.pagesBase.end, jsObject(baseObj));

    // 주요실적
    if (this.perfEdit && this.regions.perf) {
      sp.replace(this.regions.perf.start, this.regions.perf.end, jsObject(this.perfEdit));
    }

    // 제품
    if (this.productsEdit && this.regions.products) {
      sp.replace(this.regions.products.start, this.regions.products.end, jsObject(this.productsEdit));
    }

    var out = sp.result();

    // 이미지 경로 전역 치환 (CSS·셸·PAGES·PERF 어디에 있든 한 번에)
    this.imageRenames.forEach(function (r) {
      var re = new RegExp(escRe(r.from) + '(?=["\'\\)\\s\\\\])', 'g');
      out = out.replace(re, r.to);
    });

    return out;
  };

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ===================== 6. 이미지 수집 ===================== */

  var IMG_RE = /images\/[A-Za-z0-9_\-\/.]+?\.(?:png|jpe?g|gif|webp|svg)/gi;

  SiteDoc.prototype.listImages = function () {
    var self = this;
    var map = {};   // path → { path, uses:[], group, label }

    function add(path, use, label, group, order) {
      if (!map[path]) map[path] = { path: path, uses: [], label: '', group: group, order: order };
      var rec = map[path];
      rec.uses.push(use);
      if (!rec.label && label) rec.label = label;
      // 그룹 우선순위: 먼저 등록된 그룹 유지 (아래 호출 순서로 제어)
    }

    // --- 페이지별
    this.order.forEach(function (key) {
      var g = groupOfPage(key);
      var html = self.pageHtml(key);
      var root = parseNodes(html);
      var sectionTitle = '';
      var idx = 0;

      (function walk(node) {
        node.children.forEach(function (ch) {
          if (ch.tag === 'h1' || ch.tag === 'h2' || ch.tag === 'h3') {
            var t = textOf(ch).trim();
            if (t) sectionTitle = t.replace(/\s+/g, ' ').slice(0, 30);
          }
          if (ch.tag === 'img') {
            var src = attrOf(ch, 'src');
            if (src && /^images\//.test(src)) {
              var alt = (attrOf(ch, 'alt') || '').trim();
              add(src, { page: key, pageName: self.pageName(key) },
                alt || sectionTitle || self.pageName(key), g, idx++);
            }
          }
          var st = attrOf(ch, 'style');
          if (st) {
            var mm = st.match(IMG_RE);
            if (mm) mm.forEach(function (p) {
              add(p, { page: key, pageName: self.pageName(key) }, sectionTitle || self.pageName(key), g, idx++);
            });
          }
          walk(ch);
        });
      })(root);
    });

    // --- 제품 데이터 (목록 사진 / 상세 사진 / 색상 견본 / 사양 이미지)
    if (this.hasProducts()) {
      this.productsData().forEach(function (p) {
        [['img', '목록 사진'], ['detailImg', '상세 사진'], ['colorImg', '색상 견본'], ['extraImg', '사양 이미지']]
          .forEach(function (f) {
            var v = p[f[0]];
            if (v && /^images\//.test(v)) {
              add(v, { product: p.id, name: p.name }, p.name + ' — ' + f[1], 'products', 800);
            }
          });
      });
    }

    // --- 주요실적 데이터
    var perf = this.perfData();
    Object.keys(perf).forEach(function (cat) {
      (perf[cat] || []).forEach(function (item) {
        (item.imgs || []).forEach(function (p, i) {
          add(p, { perf: cat, name: item.n }, item.n + ' (' + (i + 1) + ')', 'result', 900);
        });
      });
    });

    // --- 셸(헤더/푸터 로고)
    var shellRoot = parseNodes(this.shellHtml());
    (function walk(node) {
      node.children.forEach(function (ch) {
        if (ch.tag === 'img') {
          var src = attrOf(ch, 'src');
          if (src && /^images\//.test(src)) add(src, { shell: true }, attrOf(ch, 'alt') || '로고', 'main', -100);
        }
        walk(ch);
      });
    })(shellRoot);

    // --- CSS(<style>) 안의 배경 이미지
    var style = this.styleBlock;
    var re = /([^{}\n]{0,120})\{[^{}]*?(images\/[A-Za-z0-9_\-\/.]+?\.(?:png|jpe?g|gif|webp|svg))/gi, m;
    while ((m = re.exec(style))) {
      var sel = m[1].split(/[,\n]/).pop().trim();
      var label = CSS_LABELS[sel] || ('배경 ' + sel);
      add(m[2], { css: sel }, label, CSS_GROUPS[sel] || 'main', -50);
    }

    var list = Object.keys(map).map(function (p) { return map[p]; });
    list.sort(function (a, b) { return (a.order - b.order) || a.path.localeCompare(b.path); });
    return list;
  };

  // 서브페이지 상단 배너 CSS 선택자 → 사람이 읽는 이름 / 그룹
  var CSS_LABELS = {
    '.phero': '서브페이지 상단 배너(기본)',
    '#app[data-grp="about"] .phero': '회사소개 상단 배너',
    '#app[data-grp="solution"] .phero': '솔루션 상단 배너',
    '#app[data-grp="products"] .phero': '제품소개 상단 배너',
    '#app[data-grp="result"] .phero': '주요실적 상단 배너',
    '#app[data-grp="support"] .phero': '고객지원 상단 배너'
  };
  var CSS_GROUPS = {
    '#app[data-grp="about"] .phero': 'about',
    '#app[data-grp="solution"] .phero': 'solution',
    '#app[data-grp="products"] .phero': 'products',
    '#app[data-grp="result"] .phero': 'result',
    '#app[data-grp="support"] .phero': 'support'
  };

  /* ===================== 7. 텍스트 블록 수집 ===================== */

  // 편집 대상 블록 (내부에 다른 블록이 없는 잎 노드만)
  var TEXT_TAGS = { h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, p: 1, li: 1, td: 1, th: 1, dt: 1, dd: 1, figcaption: 1, blockquote: 1, strong: 1, em: 1, a: 1, span: 1, div: 1, button: 1, label: 1, summary: 1 };
  var BLOCK_TAGS = { h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, p: 1, li: 1, td: 1, th: 1, dt: 1, dd: 1, figcaption: 1, blockquote: 1, div: 1, section: 1, article: 1, ul: 1, ol: 1, table: 1, header: 1, footer: 1, nav: 1, form: 1 };

  /**
   * 페이지 HTML 에서 편집 가능한 텍스트 블록 목록을 뽑는다.
   * 각 항목은 원본 문자열의 [contentStart, contentEnd) 구간을 그대로 가리킨다.
   */
  // 메뉴·네비게이션으로 간주할 조상 클래스
  var NAV_ANCESTORS = /(^|\s)(crumb|subnav|gnb|filter|lang|tabs|rs-tabs|pcta-row|cat-list|totop)(\s|$)/;

  function collectBlocks(html) {
    var root = parseNodes(html);
    var out = [];
    var sectionTitle = '';

    (function walk(node, depth, ancestors) {
      node.children.forEach(function (ch) {
        if (ch.tag === '#text') return;

        var cls = attrOf(ch, 'class') || '';
        var chain = ancestors + ' ' + cls;
        var hasBlockChild = ch.children.some(function (c) { return c.tag !== '#text' && BLOCK_TAGS[c.tag]; });
        var raw = html.slice(ch.contentStart, ch.contentEnd);
        var plain = textOf(ch).replace(/\s+/g, ' ').trim();

        if (TEXT_TAGS[ch.tag] && !hasBlockChild && plain) {
          // 링크만 있는 껍데기 div/span 은 제외
          var onlyMarkup = /^<[^>]+>$/.test(raw.trim());
          // 기호 한 글자(▾, ☰, ↑ 등)만 있는 장식 요소 제외
          var decoration = plain.length <= 2 && !/[가-힣A-Za-z0-9]/.test(plain);

          var isNav = NAV_ANCESTORS.test(chain) ||
            (ch.tag === 'a' && /data-go/.test(ch.attrs || '')) ||
            /(^|\s)(caret|menu-btn|totop|logo)(\s|$)/.test(cls) ||
            (ch.tag === 'h5' && /ftr|foot/.test(ancestors));

          if (!onlyMarkup && !decoration) {
            out.push({
              id: out.length,
              tag: ch.tag,
              cls: cls.split(/\s+/)[0] || '',
              kind: isNav ? 'nav' : 'content',
              start: ch.contentStart,
              end: ch.contentEnd,
              raw: raw,
              text: plain,
              section: sectionTitle,
              rich: /<[a-z]/i.test(raw)
            });
          }
        }
        if (/^h[1-3]$/.test(ch.tag) && plain) sectionTitle = plain.slice(0, 30);
        walk(ch, depth + 1, chain);
      });
    })(root, 0, '');

    // 중첩 구간 제거 (바깥 블록이 안쪽 블록을 포함하면 안쪽만 남긴다)
    out.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    var kept = [];
    out.forEach(function (b) {
      var last = kept[kept.length - 1];
      if (last && b.start < last.end) {
        // 겹침 → 더 안쪽(짧은) 것 우선
        if (b.end - b.start < last.end - last.start) kept[kept.length - 1] = b;
        return;
      }
      kept.push(b);
    });
    kept.forEach(function (b, i) { b.id = i; });
    return kept;
  }

  SiteDoc.prototype.textBlocks = function (key) { return collectBlocks(this.pageHtml(key)); };
  SiteDoc.prototype.shellBlocks = function () { return collectBlocks(this.shellHtml()); };

  /** 블록 여러 개를 한 번에 반영한 새 HTML 을 만든다. edits = [{start,end,html}] */
  function applyBlocks(html, edits) {
    var sp = new Splicer(html);
    edits.forEach(function (e) { sp.replace(e.start, e.end, e.html); });
    return sp.result();
  }

  SiteDoc.prototype.applyTextEdits = function (key, edits) {
    this.setPageHtml(key, applyBlocks(this.pageHtml(key), edits));
  };
  SiteDoc.prototype.applyShellEdits = function (edits) {
    this.setShellHtml(applyBlocks(this.shellHtml(), edits));
  };

  /* ===================== 8. 회사정보(연락처) 찾기 ===================== */

  var INFO_FIELDS = [
    { id: 'tel',   name: '대표 전화',      re: /\b0\d{1,2}-\d{3,4}-\d{4}\b/g },
    { id: 'email', name: '이메일',        re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { id: 'biz',   name: '사업자등록번호', re: /\b\d{3}-\d{2}-\d{5}\b/g },
    { id: 'addr',  name: '주소',          re: /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣]*\s*[가-힣]+[시군구]\s+[가-힣A-Za-z0-9]+로\s?[0-9]*길?\s*[0-9]+[0-9-]*(?:\s*\([가-힣]+\))?/g }
  ];

  /**
   * 사이트 전체(셸 + 모든 페이지)에서 연락처류 값이 쓰인 곳을 모아 준다.
   * 반환: [{ field, value, spots:[{scope,scopeName,blockId,text}] }]
   */
  SiteDoc.prototype.findCompanyInfo = function () {
    var self = this;
    var buckets = {};   // field.id + '|' + value → 레코드

    function scan(scope, scopeName, blocks) {
      blocks.forEach(function (b) {
        INFO_FIELDS.forEach(function (f) {
          f.re.lastIndex = 0;
          var m;
          while ((m = f.re.exec(b.text))) {
            var val = m[0].trim().replace(/[,.\s]+$/, '');
            var k = f.id + '|' + val;
            if (!buckets[k]) buckets[k] = { field: f.id, fieldName: f.name, value: val, spots: [] };
            buckets[k].spots.push({ scope: scope, scopeName: scopeName, blockId: b.id, text: b.text });
          }
        });
      });
    }

    scan('__shell__', '헤더·푸터', this.shellBlocks());
    this.order.forEach(function (k) { scan(k, self.pageName(k), self.textBlocks(k)); });

    var out = Object.keys(buckets).map(function (k) { return buckets[k]; });
    var rank = { tel: 0, email: 1, biz: 2, addr: 3 };
    out.sort(function (a, b) { return (rank[a.field] - rank[b.field]) || (b.spots.length - a.spots.length); });
    return out;
  };

  /** 사이트 전체에서 특정 문자열을 다른 값으로 일괄 치환한다. */
  SiteDoc.prototype.replaceEverywhere = function (from, to) {
    var self = this;
    var count = 0;
    var re = new RegExp(escRe(from), 'g');

    var shell = this.shellHtml();
    if (re.test(shell)) {
      re.lastIndex = 0;
      count += (shell.match(re) || []).length;
      this.setShellHtml(shell.replace(re, to));
    }
    this.order.forEach(function (k) {
      var h = self.pageHtml(k);
      re.lastIndex = 0;
      if (h.indexOf(from) >= 0) {
        count += (h.match(re) || []).length;
        self.setPageHtml(k, h.replace(re, to));
      }
    });

    // 뒤쪽 PAGES.key="…" 로 덮어써져 화면에는 안 나오지만 파일에는 남아 있는
    // 구버전 페이지 정의에도 같은 값이 있으면 함께 정리한다 (옛 연락처 잔존 방지)
    Object.keys(this.pagesBase).forEach(function (k) {
      if (!self.pages[k] || self.pages[k].src !== 'override') return;
      var h = self.pagesBase[k];
      if (h.indexOf(from) < 0) return;
      self.pagesBase[k] = h.split(from).join(to);
      self.baseForceDirty = true;
    });

    return count;
  };

  SiteDoc.INFO_FIELDS = INFO_FIELDS;

  /* ===================== 9. 이미지 갤러리 =====================
     "같은 모양의 항목이 2개 이상 늘어서 있고, 항목마다 이미지가 1장씩 들어있는
     자리" 를 갤러리로 본다. 페이지 이름이나 클래스 이름을 코드에 적어두지 않고
     마크업 생김새만으로 찾아내므로, 새 페이지가 생겨도 그대로 동작한다.

     항목을 새로 만들 때는 기존 항목의 원문을 그대로 복제해서 이미지 경로와
     글자만 바꾼다. 그래서 여백·비율·반응형 등 디자인이 저절로 같아진다.
     ============================================================ */

  // 애니메이션 순번(d1,d2)·행 구분(r6)·상태(on) 처럼 "같은 종류인데 다르게 붙는" 클래스
  var VARIANT_CLASS = /^(d\d+|r\d+|on|cur|active|reveal|lazy)$/;

  function classSig(node) {
    var cls = (attrOf(node, 'class') || '').split(/\s+/).filter(function (c) {
      return c && !VARIANT_CLASS.test(c);
    }).sort();
    return node.tag + (cls.length ? '.' + cls.join('.') : '');
  }
  function elChildren(node) {
    return node.children.filter(function (c) { return c.tag !== '#text'; });
  }
  /** 노드 안의 이미지들 (img 태그 + style 배경) */
  function imagesInside(node, html) {
    var out = [];
    (function walk(n) {
      if (n.tag === 'img') {
        var s = attrOf(n, 'src');
        if (s && /^images\//.test(s)) out.push({ node: n, src: s });
      }
      elChildren(n).forEach(walk);
    })(node);
    return out;
  }
  /** 원문 구간의 순수 글자 */
  function sliceText(html, a, b) {
    return html.slice(a, b).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** 항목 안에서 "글이 들어가는 칸" 을 찾는다 (다른 글칸을 품지 않는 잎만) */
  function textSlots(item, html) {
    var slots = [];
    (function walk(n) {
      elChildren(n).forEach(function (c) {
        if (c.tag === 'img' || c.tag === 'svg') return;
        var kids = elChildren(c).filter(function (k) { return k.tag !== 'img'; });
        var own = sliceText(html, c.contentStart, c.contentEnd);
        if (own && !kids.length) {
          slots.push({ node: c, text: own, start: c.contentStart, end: c.contentEnd });
        } else {
          walk(c);
        }
      });
    })(item);
    return slots;
  }

  /** 페이지 안의 갤러리들. 컨테이너 위치는 "몇 번째 자식" 경로로 기억해 편집 후에도 찾을 수 있다. */
  function scanGalleries(html, pageKey, pageName) {
    if (!html) return [];
    var root = parseNodes(html);
    var found = [];

    (function walk(node, path) {
      var kids = elChildren(node);
      var byShape = {};
      kids.forEach(function (k, i) {
        var s = classSig(k);
        (byShape[s] = byShape[s] || []).push({ node: k, at: i });
      });

      Object.keys(byShape).forEach(function (shape) {
        var group = byShape[shape];
        if (group.length < 2) return;
        // 모든 형제가 이미지를 정확히 1장씩 가져야 갤러리로 본다
        var ok = group.every(function (g) { return imagesInside(g.node, html).length === 1; });
        if (!ok) return;
        // 붙어 있어야 한다. 사이에 다른 것이 끼어 있으면 통째로 다시 쓸 때 그것이 지워진다.
        for (var c = 1; c < group.length; c++) if (group[c].at !== group[c - 1].at + 1) return;

        var items = group.map(function (g) {
          var img = imagesInside(g.node, html)[0];
          return {
            src: img.src,
            alt: attrOf(img.node, 'alt') || '',
            text: sliceText(html, g.node.contentStart, g.node.contentEnd),
            start: g.node.start, end: g.node.end
          };
        });
        var maxLen = items.reduce(function (a, it) { return Math.max(a, it.text.length); }, 0);
        found.push({
          page: pageKey,
          pageName: pageName,
          path: path.join('-') + '|' + shape,
          shape: shape,
          area: areaLabel(node, html, root),
          category: paneLabel(node, html, root),
          kind: maxLen === 0 ? 'plain' : (maxLen <= 40 ? 'captioned' : 'card'),
          items: items,
          slots: textSlots(group[0].node, html).map(function (s) { return s.text; }),
          // 항목들이 차지한 구간만 바꾼다 (컨테이너 안의 다른 요소는 그대로 둔다)
          spanStart: items[0].start,
          spanEnd: items[items.length - 1].end
        });
      });

      kids.forEach(function (k, i) { walk(k, path.concat(i)); });
    })(root, []);

    return found;
  }

  /** 이 자리 앞쪽에서 가장 가까운 제목 */
  function areaLabel(node, html, root) {
    var best = '';
    (function scan(n) {
      elChildren(n).forEach(function (c) {
        if (c.start >= node.start) return;
        if (/^h[1-3]$/.test(c.tag)) {
          var t = sliceText(html, c.contentStart, c.contentEnd);
          if (t) best = t.slice(0, 40);
        }
        scan(c);
      });
    })(root);
    return best;
  }

  /** 탭 안이라면 그 탭 버튼의 글자를 분류 이름으로 쓴다 (내부 키가 아니라 고객이 보는 이름) */
  function paneLabel(node, html, root) {
    var pane = null, cur = node;
    while (cur) {
      var p = attrOf(cur, 'data-pane');
      if (p && /tabpane/.test(attrOf(cur, 'class') || '')) { pane = p; break; }
      cur = cur.parent;
    }
    if (!pane) return '';
    var label = '';
    (function find(n) {
      if (label) return;
      elChildren(n).forEach(function (c) {
        if (label) return;
        if (c.tag === 'button' && attrOf(c, 'data-pane') === pane) {
          label = sliceText(html, c.contentStart, c.contentEnd);
          return;
        }
        find(c);
      });
    })(root);
    return label;
  }

  /** 전체 페이지의 갤러리 목록. 여러 페이지에 똑같이 들어간 블록은 하나로 묶는다. */
  SiteDoc.prototype.listGalleries = function () {
    var self = this;
    var all = [];
    this.order.forEach(function (key) {
      scanGalleries(self.pageHtml(key), key, self.pageName(key)).forEach(function (g) { all.push(g); });
    });

    // 1단계: 항목 구성이 완전히 같은 갤러리는 "여러 페이지 공통" 으로 합친다 (거래처 로고 등)
    var byFingerprint = [];
    var seen = {};
    all.forEach(function (g) {
      var fp = g.shape + '::' + g.items.map(function (i) { return i.src; }).join(',');
      if (seen[fp] !== undefined) {
        byFingerprint[seen[fp]].places.push({ page: g.page, path: g.path });
        if (byFingerprint[seen[fp]].pageNames.indexOf(g.pageName) < 0) byFingerprint[seen[fp]].pageNames.push(g.pageName);
        return;
      }
      seen[fp] = byFingerprint.length;
      g.places = [{ page: g.page, path: g.path }];
      g.pageNames = [g.pageName];
      byFingerprint.push(g);
    });

    /* 2단계: 같은 자리를 여러 줄로 나눠 담은 경우(거래처 로고의 plogo-row 처럼)
       화면에서는 한 덩어리로 보이므로 관리자에서도 하나로 합쳐 보여준다.
       각 줄은 part 로 남겨 두고, 항목이 늘거나 줄면 마지막 줄에서 흡수한다. */
    var merged = [];
    var byArea = {};
    byFingerprint.forEach(function (g) {
      var key = g.pageNames.join('|') + '::' + g.area + '::' + g.category + '::' + g.shape;
      if (byArea[key] === undefined) {
        byArea[key] = merged.length;
        merged.push({
          page: g.page, pageName: g.pageName, pageNames: g.pageNames,
          area: g.area, category: g.category, shape: g.shape,
          kind: g.kind, slots: g.slots,
          id: g.page + '::' + g.path,
          places: g.places,
          parts: [{ places: g.places, count: g.items.length }],
          items: g.items.slice()
        });
        return;
      }
      var m = merged[byArea[key]];
      m.parts.push({ places: g.places, count: g.items.length });
      g.items.forEach(function (i) { m.items.push(i); });
    });
    return merged;
  };

  /** id 로 갤러리를 다시 찾는다 (편집 뒤에도 구조 경로가 같으므로 그대로 잡힌다) */
  SiteDoc.prototype.findGallery = function (id) {
    var list = this.listGalleries();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  /* ---------- 항목 만들기 ---------- */

  /** 견본 항목의 원문을 복제해 이미지 경로와 글자만 바꾼다.
      글칸을 먼저(뒤에서 앞으로) 바꾼 뒤 이미지 속성을 손대야 위치가 어긋나지 않는다.
      항목마다 이미지는 1장뿐이므로 src/alt 는 단순 치환으로 충분하다. */
  function buildItem(html, sampleStart, sampleEnd, src, texts) {
    var frag = html.slice(sampleStart, sampleEnd);

    var slots = textSlots(parseNodes(frag), frag);
    slots.map(function (s, i) { return { s: s, i: i }; })
      .sort(function (a, b) { return b.s.start - a.s.start; })
      .forEach(function (x) {
        if (texts && texts[x.i] !== undefined) {
          frag = frag.slice(0, x.s.start) + esc(texts[x.i]) + frag.slice(x.s.end);
        }
      });

    frag = frag.replace(/(<img\b[^>]*?\bsrc\s*=\s*)("[^"]*"|'[^']*')/i,
      function (all, head) { return head + '"' + src + '"'; });

    var altText = (texts && texts[0]) || '';
    frag = frag.replace(/(<img\b[^>]*?\balt\s*=\s*)("[^"]*"|'[^']*')/i,
      function (all, head) { return head + '"' + esc(altText) + '"'; });

    return frag;
  }

  /** 갤러리 항목 배열을 다시 써넣는다 (추가·삭제·정렬 공통 경로).
      여러 줄로 나뉜 자리는 원래 줄 길이를 지키고 남는 만큼은 마지막 줄이 받는다. */
  SiteDoc.prototype.writeGallery = function (id, nextItems) {
    var self = this;
    var g = this.findGallery(id);
    if (!g) return false;

    // 줄별로 나눠 담을 개수 정하기
    var sizes = g.parts.map(function (p) { return p.count; });
    var fixed = sizes.slice(0, -1).reduce(function (a, b) { return a + b; }, 0);
    sizes[sizes.length - 1] = Math.max(0, nextItems.length - fixed);
    if (nextItems.length < fixed) {              // 앞줄까지 줄어들면 앞에서부터 다시 채운다
      var left = nextItems.length;
      sizes = sizes.map(function (s) { var take = Math.min(s, left); left -= take; return take; });
    }

    var cursor = 0;
    var slices = sizes.map(function (n) { var s = nextItems.slice(cursor, cursor + n); cursor += n; return s; });

    // 한 페이지 안에서 여러 구간을 고칠 때 위치가 밀리지 않도록 뒤에서부터 쓴다
    var writes = [];
    g.parts.forEach(function (part, pi) {
      part.places.forEach(function (place) {
        writes.push({ place: place, body: slices[pi].map(function (it) { return it.source; }).join('') });
      });
    });

    var byPage = {};
    writes.forEach(function (w) { (byPage[w.place.page] = byPage[w.place.page] || []).push(w); });

    Object.keys(byPage).forEach(function (page) {
      var html = self.pageHtml(page);
      var list = scanGalleries(html, page, self.pageName(page));
      var jobs = [];
      byPage[page].forEach(function (w) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].path === w.place.path) { jobs.push({ start: list[i].spanStart, end: list[i].spanEnd, body: w.body }); break; }
        }
      });
      jobs.sort(function (a, b) { return b.start - a.start; });
      jobs.forEach(function (j) { html = html.slice(0, j.start) + j.body + html.slice(j.end); });
      self.setPageHtml(page, html);
    });
    return true;
  };

  /** 갤러리의 현재 항목들을 원문 조각과 함께 가져온다 (여러 줄이면 이어 붙여서) */
  SiteDoc.prototype.galleryItems = function (id) {
    var self = this;
    var g = this.findGallery(id);
    if (!g) return [];
    var out = [];
    g.parts.forEach(function (part) {
      var page = part.places[0].page;
      var html = self.pageHtml(page);
      var list = scanGalleries(html, page, self.pageName(page));
      for (var i = 0; i < list.length; i++) {
        if (list[i].path !== part.places[0].path) continue;
        list[i].items.forEach(function (it) {
          out.push({ src: it.src, alt: it.alt, text: it.text, source: html.slice(it.start, it.end) });
        });
        break;
      }
    });
    return out;
  };

  /** 새 이미지(+글)를 맨 뒤에 추가 */
  SiteDoc.prototype.addGalleryItem = function (id, src, texts) {
    var items = this.galleryItems(id);
    if (!items.length) return false;
    // 마지막 항목의 원문을 그대로 본떠서 만든다 (오프셋에 기대지 않는다)
    var sample = items[items.length - 1].source;
    items.push({ src: src, source: buildItem(sample, 0, sample.length, src, texts) });
    return this.writeGallery(id, items);
  };

  SiteDoc.prototype.removeGalleryItem = function (id, index) {
    var items = this.galleryItems(id);
    if (index < 0 || index >= items.length || items.length <= 1) return false;
    items.splice(index, 1);
    return this.writeGallery(id, items);
  };

  SiteDoc.prototype.moveGalleryItem = function (id, from, to) {
    var items = this.galleryItems(id);
    if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return false;
    var x = items.splice(from, 1)[0];
    items.splice(to, 0, x);
    return this.writeGallery(id, items);
  };

  /** 한 항목의 이미지만 교체 (같은 파일이 다른 자리에도 쓰일 때 그 자리는 건드리지 않는다) */
  SiteDoc.prototype.replaceGalleryImage = function (id, index, src) {
    var items = this.galleryItems(id);
    if (index < 0 || index >= items.length) return false;
    var old = items[index].src;
    items[index].source = items[index].source.replace(
      new RegExp('(src\\s*=\\s*["\'])' + escRe(old) + '(["\'])'), '$1' + src + '$2');
    items[index].src = src;
    return this.writeGallery(id, items);
  };

  SiteDoc.scanGalleries = scanGalleries;

  /* ===================== 내보내기 ===================== */

  SiteDoc.parseNodes = parseNodes;
  SiteDoc.attrOf = attrOf;
  SiteDoc.textOf = textOf;
  SiteDoc.collectBlocks = collectBlocks;
  SiteDoc.GROUPS = GROUPS;
  SiteDoc.PAGE_NAMES = PAGE_NAMES;
  SiteDoc.groupOfPage = groupOfPage;
  SiteDoc.escapeHtml = esc;

  global.SiteDoc = SiteDoc;
  if (typeof module !== 'undefined' && module.exports) module.exports = SiteDoc;
})(typeof window !== 'undefined' ? window : globalThis);
