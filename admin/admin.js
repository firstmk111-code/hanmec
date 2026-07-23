const $ = (s) => document.querySelector(s);

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.message) || "요청 실패");
  return data;
}

let state = { blocks: [], registry: [], defaults: [] };
let currentKey = null;

/* ---------- 인증 ---------- */
async function checkLogin() {
  try {
    const r = await api("/api/admin/me");
    if (r.isAdmin) return showApp();
  } catch {}
  $("#loginCard").classList.remove("hidden");
}
async function login() {
  $("#loginMsg").textContent = "";
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: $("#username").value, password: $("#password").value }),
    });
    showApp();
  } catch {
    $("#loginMsg").textContent = "로그인 정보가 올바르지 않습니다.";
  }
}
async function logout() {
  await api("/api/admin/logout", { method: "POST", body: "{}" });
  location.reload();
}
async function showApp() {
  $("#loginCard").classList.add("hidden");
  $("#appCard").classList.remove("hidden");
  await loadData();
}

/* ---------- 사이드바 전환 ---------- */
const PANELS = { dash: "#panelDash", text: "#panelText", content: "#panelContent", image: "#panelImage", bvideo: "#panelBvideo", footer: "#panelFooter", notice: "#panelNotice", seo: "#panelSeo", backup: "#panelBackup" };
let imagesLoaded = false;
let seoLoaded = false;
let footerLoaded = false;
let noticeLoaded = false;
let contentLoaded = false;
let bvideoLoaded = false;
document.querySelectorAll(".nav-item").forEach((el) => {
  if (el.classList.contains("disabled")) return;
  el.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    el.classList.add("active");
    const p = el.dataset.panel;
    Object.entries(PANELS).forEach(([k, sel]) => $(sel).classList.toggle("hidden", k !== p));
    if (p === "content" && !contentLoaded) loadContent();
    if (p === "image" && !imagesLoaded) loadImages();
    if (p === "bvideo" && !bvideoLoaded) loadBannerVideo();
    if (p === "seo" && !seoLoaded) loadSeo();
    if (p === "footer" && !footerLoaded) loadFooter();
    if (p === "notice" && !noticeLoaded) loadNotice();
    if (p === "backup") loadBackup();
  });
});

/* ---------- 데이터 ---------- */
async function loadData() {
  const d = await api("/api/admin/site-data");
  state.blocks = d.blocks || [];
  state.registry = d.registry || [];
  state.defaults = d.defaults || [];
  $("#statBlocks").textContent = state.blocks.length;

  // 블록 셀렉트 채우기
  const sel = $("#blockSelect");
  sel.innerHTML = "";
  state.registry.forEach((r) => {
    const o = document.createElement("option");
    o.value = r.key;
    o.textContent = r.label;
    sel.appendChild(o);
  });
  currentKey = state.registry.length ? state.registry[0].key : null;
  sel.value = currentKey;
  fillForm();
}

function regOf(key) {
  return state.registry.find((r) => r.key === key) || { type: "br", label: key };
}
function blockOf(key) {
  return state.blocks.find((b) => b.key === key);
}

/* 폼 <- 모델 */
function fillForm() {
  const b = blockOf(currentKey);
  if (!b) return;
  $("#blockLabel").textContent = regOf(currentKey).label;
  $("#tContent").value = b.content ?? "";
  $("#tSize").value = (b.fontSize ?? "") === "" ? "" : b.fontSize;
  $("#tLs").value = b.letterSpacing ?? 0;
  $("#tLh").value = b.lineHeight ?? 1.4;
  $("#tWeight").value = String(b.fontWeight ?? 400);
  $("#tAlign").value = b.textAlign ?? "left";
  renderPreview();
}

/* 모델 <- 폼 */
function readForm() {
  const b = blockOf(currentKey);
  if (!b) return;
  b.content = $("#tContent").value;
  const fs = $("#tSize").value.trim();
  b.fontSize = fs === "" ? "" : clampNum(fs, 8, 160);
  b.letterSpacing = clampNum($("#tLs").value, -0.2, 0.5, -0.01);
  b.lineHeight = clampNum($("#tLh").value, 0.8, 3, 1.4);
  b.fontWeight = parseInt($("#tWeight").value, 10) || 400;
  b.textAlign = $("#tAlign").value;
}

function clampNum(v, min, max, fallback = 0) {
  let n = parseFloat(v);
  if (isNaN(n)) n = fallback;
  return Math.min(max, Math.max(min, n));
}

/* ---------- 미리보기 ---------- */
function renderPreview() {
  const el = $("#pvText");
  const type = regOf(currentKey).type;
  const content = $("#tContent").value;
  const esc = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (type === "br") {
    el.style.whiteSpace = "normal";
    el.innerHTML = esc.replace(/\r?\n/g, "<br>");
  } else {
    el.style.whiteSpace = "pre-line";
    el.textContent = content;
  }
  const fs = $("#tSize").value.trim();
  el.style.fontSize = fs === "" ? "28px" : clampNum(fs, 8, 160) + "px";
  el.style.letterSpacing = clampNum($("#tLs").value, -0.2, 0.5, -0.01) + "em";
  el.style.lineHeight = String(clampNum($("#tLh").value, 0.8, 3, 1.4));
  el.style.fontWeight = String(parseInt($("#tWeight").value, 10) || 400);
  el.style.textAlign = $("#tAlign").value;
}

/* ---------- 저장 / 초기화 ---------- */
async function save() {
  readForm();
  const msg = $("#saveMsg");
  msg.className = "msg";
  msg.textContent = "저장 중…";
  try {
    const r = await api("/api/admin/site-data", {
      method: "PUT",
      body: JSON.stringify({ blocks: state.blocks }),
    });
    msg.className = "msg ok";
    msg.textContent = r.message || "저장되었습니다.";
  } catch (e) {
    msg.className = "msg err";
    msg.textContent = "저장 실패: " + e.message;
  }
}

function resetBlock() {
  const def = state.defaults.find((d) => d.key === currentKey);
  const b = blockOf(currentKey);
  if (!def || !b) return;
  Object.assign(b, JSON.parse(JSON.stringify(def)));
  fillForm();
  const msg = $("#saveMsg");
  msg.className = "msg";
  msg.textContent = "기본값으로 되돌렸습니다. (저장해야 반영)";
}

/* ---------- 이미지 교체 ---------- */
async function loadImages() {
  const grid = $("#imgGrid");
  grid.innerHTML = "<p class='hint'>불러오는 중…</p>";
  try {
    const d = await api("/api/admin/images");
    imagesLoaded = true;
    grid.innerHTML = "";
    (d.images || []).forEach((im) => {
      const card = document.createElement("div");
      card.className = "img-card";
      const label = im.label ? im.label : "이미지";
      card.innerHTML =
        `<div class="img-thumb"><img src="/api/admin/image?i=${im.index}&t=${Date.now()}" loading="lazy" alt=""></div>` +
        `<div class="img-meta"><b>#${im.index}</b> ${label}<br><small>${im.mime} · ${im.sizeKB}KB</small></div>` +
        `<label class="img-btn">파일 교체<input type="file" accept="image/*" data-index="${im.index}" hidden></label>`;
      grid.appendChild(card);
    });
    grid.querySelectorAll("input[type=file]").forEach((inp) => {
      inp.addEventListener("change", onImagePick);
    });
  } catch (e) {
    grid.innerHTML = "<p class='msg err'>불러오기 실패: " + e.message + "</p>";
  }
}

function onImagePick(e) {
  const file = e.target.files[0];
  const index = parseInt(e.target.dataset.index, 10);
  if (!file) return;
  const msg = $("#imgMsg");
  if (!/^image\//.test(file.type)) {
    msg.className = "msg err"; msg.textContent = "이미지 파일만 올릴 수 있습니다.";
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    msg.className = "msg"; msg.textContent = `#${index} 교체 중…`;
    try {
      const r = await api("/api/admin/image", {
        method: "PUT",
        body: JSON.stringify({ index, dataUrl: reader.result }),
      });
      msg.className = "msg ok"; msg.textContent = `#${index} ${r.message}`;
      // 썸네일 갱신
      const img = $(`.img-card input[data-index="${index}"]`)
        .closest(".img-card").querySelector(".img-thumb img");
      img.src = `/api/admin/image?i=${index}&t=${Date.now()}`;
    } catch (err) {
      msg.className = "msg err"; msg.textContent = "교체 실패: " + err.message;
    }
  };
  reader.readAsDataURL(file);
  e.target.value = "";
}

/* ================= SEO 관리 ================= */
let seo = null;
let pgIndex = 0;
const GKEYS = ["siteName","domain","canonicalBase","defaultTitle","description","keywords",
  "ogTitle","ogDescription","ogImage","twitterImage","twitterCard","robotsDefault",
  "favicon","appleTouchIcon","logo","naverVerification","googleVerification","gaId","gtmId","headCode"];
const PKEYS = ["title","description","keywords","robots","breadcrumb","ogTitle","ogDescription",
  "ogImage","priority","changefreq","lastmod","memo"];
const SDKEYS = ["name","legalName","description","logo","phone","email","region","address","hours","mapUrl","sameAs"];

async function loadSeo() {
  try {
    seo = await api("/api/admin/seo");
    seoLoaded = true;
    fillGlobal(); buildPageSelect(); fillStruct(); renderSdPreview();
    bindSeoTabs();
  } catch (e) {
    $("#seoMsg").className = "msg err";
    $("#seoMsg").textContent = "불러오기 실패: " + e.message;
  }
}

/* ---- 서브탭 ---- */
let seoTabsBound = false;
const SEO_SUBS = { global:"#seoGlobal", pages:"#seoPages", struct:"#seoStruct", alt:"#seoAlt", files:"#seoFiles", audit:"#seoAudit" };
function bindSeoTabs() {
  if (seoTabsBound) return; seoTabsBound = true;
  document.querySelectorAll(".seo-tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".seo-tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      const k = t.dataset.seo;
      Object.entries(SEO_SUBS).forEach(([kk, sel]) => $(sel).classList.toggle("hidden", kk !== k));
      if (k === "alt" && !altLoaded) loadAlts();
      if (k === "audit") loadAudit();
    });
  });
}

/* ---- 공통 설정 ---- */
function fillGlobal() {
  const g = seo.global || {};
  GKEYS.forEach((k) => { const el = $("#g_" + k); if (el) el.value = g[k] ?? ""; });
  $("#g_sitemapEnabled").checked = !!g.sitemapEnabled;
  $("#g_rssEnabled").checked = !!g.rssEnabled;
  refreshCounts();
}
function readGlobal() {
  const g = seo.global || (seo.global = {});
  GKEYS.forEach((k) => { const el = $("#g_" + k); if (el) g[k] = el.value; });
  g.sitemapEnabled = $("#g_sitemapEnabled").checked;
  g.rssEnabled = $("#g_rssEnabled").checked;
}
async function saveSeo() {
  readGlobal(); readPage(); readStruct();
  const msg = $("#seoMsg"); msg.className = "msg"; msg.textContent = "저장 중…";
  try {
    const r = await api("/api/admin/seo", { method: "PUT", body: JSON.stringify(seo) });
    msg.className = "msg ok"; msg.textContent = r.message || "저장되었습니다.";
  } catch (e) { msg.className = "msg err"; msg.textContent = "저장 실패: " + e.message; }
}

/* ---- 페이지별 메타 ---- */
function buildPageSelect() {
  const sel = $("#pgSelect"); sel.innerHTML = "";
  (seo.pages || []).forEach((p, i) => {
    const o = document.createElement("option"); o.value = i; o.textContent = p.name; sel.appendChild(o);
  });
  pgIndex = 0; sel.value = 0; fillPage();
}
function fillPage() {
  const p = (seo.pages || [])[pgIndex]; if (!p) return;
  $("#pgMenu").textContent = p.menu || "–";
  $("#pgUrl").textContent = "/" + (p.hash || "");
  PKEYS.forEach((k) => { const el = $("#pg_" + k); if (el) el.value = p[k] ?? ""; });
  refreshCounts(); renderSeoPreview();
}
function readPage() {
  const p = (seo.pages || [])[pgIndex]; if (!p) return;
  PKEYS.forEach((k) => { const el = $("#pg_" + k); if (el) p[k] = el.value; });
}
async function savePage() {
  readPage();
  const msg = $("#pgMsg"); msg.className = "msg"; msg.textContent = "저장 중…";
  try {
    readGlobal(); readStruct();
    const r = await api("/api/admin/seo", { method: "PUT", body: JSON.stringify(seo) });
    msg.className = "msg ok"; msg.textContent = r.message || "저장되었습니다.";
  } catch (e) { msg.className = "msg err"; msg.textContent = "저장 실패: " + e.message; }
}
function renderSeoPreview() {
  const p = (seo.pages || [])[pgIndex] || {};
  const g = seo.global || {};
  const host = (g.canonicalBase || g.domain || "example.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const title = p.title || g.defaultTitle || "제목";
  const desc = p.description || g.description || "설명";
  const ogT = p.ogTitle || title;
  const ogD = p.ogDescription || desc;
  $("#pvGUrl").textContent = host + (p.hash ? " › " + p.hash.replace("#", "") : "");
  $("#pvGTitle").textContent = title;
  $("#pvGDesc").textContent = desc;
  $("#pvKTitle").textContent = ogT;
  $("#pvKDesc").textContent = ogD;
  $("#pvKHost").textContent = host;
  const og = p.ogImage || g.ogImage;
  $("#pvKThumb").style.backgroundImage = og ? `url('${og}')` : "";
  $("#pvKThumb").textContent = og ? "" : "OG";
  // 경고
  const w = [];
  const tl = title.length, dl = desc.length;
  if (tl < 30 || tl > 60) w.push(`title ${tl}자(권장 30~60)`);
  if (dl < 80 || dl > 160) w.push(`description ${dl}자(권장 80~160)`);
  if (!og) w.push("OG 이미지 없음(권장 1200×630)");
  $("#pgWarn").textContent = w.length ? "⚠ " + w.join(" · ") : "✓ 권장 기준 충족";
}

/* ---- 글자 수 카운터 ---- */
function countHint(el) {
  const spec = el.dataset.count; if (!spec) return;
  const [min, max] = spec.split("-").map(Number);
  const n = (el.value || "").length;
  const s = document.querySelector('.cnt[data-for="' + el.id + '"]');
  if (s) { s.textContent = n + "자 (권장 " + min + "~" + max + ")"; s.className = "cnt" + (n < min || n > max ? " warn" : " ok"); }
}
function refreshCounts() { document.querySelectorAll("[data-count]").forEach(countHint); }

/* ---- 구조화 데이터 ---- */
function fillStruct() {
  const sd = seo.structuredData || (seo.structuredData = {});
  const o = sd.organization || (sd.organization = {});
  SDKEYS.forEach((k) => { const el = $("#sd_" + k); if (el) el.value = o[k] ?? ""; });
  $("#sd_localBusiness").checked = !!sd.localBusiness;
  renderSdList("services", ["name", "description", "area", "url"]);
  renderSdList("products", ["name", "description", "image", "category", "url"]);
  renderSdList("faqs", ["question", "answer"]);
}
function renderSdList(kind, fields) {
  const box = $("#sd" + kind.charAt(0).toUpperCase() + kind.slice(1));
  const arr = (seo.structuredData[kind] = seo.structuredData[kind] || []);
  box.innerHTML = "";
  arr.forEach((item, i) => {
    const row = document.createElement("div"); row.className = "sd-row";
    fields.forEach((f) => {
      const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = f;
      inp.value = item[f] ?? ""; inp.dataset.kind = kind; inp.dataset.idx = i; inp.dataset.field = f;
      inp.addEventListener("input", (e) => { arr[e.target.dataset.idx][f] = e.target.value; renderSdPreview(); });
      row.appendChild(inp);
    });
    const del = document.createElement("button"); del.className = "ghost sm"; del.textContent = "삭제";
    del.addEventListener("click", () => { arr.splice(i, 1); renderSdList(kind, fields); renderSdPreview(); });
    row.appendChild(del);
    box.appendChild(row);
  });
}
function readStruct() {
  const sd = seo.structuredData || (seo.structuredData = {});
  const o = sd.organization || (sd.organization = {});
  SDKEYS.forEach((k) => { const el = $("#sd_" + k); if (el) o[k] = el.value; });
  sd.localBusiness = $("#sd_localBusiness").checked;
}
function renderSdPreview() {
  readStruct();
  const sd = seo.structuredData || {}; const g = seo.global || {};
  const out = [];
  const base = g.canonicalBase || g.domain || "";
  const o = sd.organization || {};
  if (o.name) {
    const j = { "@context": "https://schema.org", "@type": sd.localBusiness ? "LocalBusiness" : "Organization", name: o.name };
    if (o.description) j.description = o.description;
    if (o.logo) j.logo = o.logo;
    if (o.phone) j.telephone = o.phone;
    if (o.email) j.email = o.email;
    if (o.address) j.address = { "@type": "PostalAddress", streetAddress: o.address, addressRegion: o.region || "", addressCountry: "KR" };
    if (o.sameAs) j.sameAs = o.sameAs.split(",").map((s) => s.trim()).filter(Boolean);
    if (base) j.url = base;
    out.push(j);
  }
  (sd.services || []).forEach((s) => { if (s.name) out.push({ "@context": "https://schema.org", "@type": "Service", name: s.name, description: s.description || undefined, areaServed: s.area || undefined, url: s.url || undefined }); });
  (sd.products || []).forEach((p) => { if (p.name) out.push({ "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description || undefined, image: p.image || undefined, category: p.category || undefined, url: p.url || undefined }); });
  const qa = (sd.faqs || []).filter((f) => f.question).map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer || "" } }));
  if (qa.length) out.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qa });
  $("#sdPreview").textContent = out.length ? JSON.stringify(out, null, 2) : "// 입력된 구조화 데이터가 없습니다.";
}
async function saveStruct() {
  readGlobal(); readPage(); readStruct();
  const msg = $("#sdMsg"); msg.className = "msg"; msg.textContent = "저장 중…";
  try {
    const r = await api("/api/admin/seo", { method: "PUT", body: JSON.stringify(seo) });
    msg.className = "msg ok"; msg.textContent = r.message || "저장되었습니다."; renderSdPreview();
  } catch (e) { msg.className = "msg err"; msg.textContent = "저장 실패: " + e.message; }
}

/* ---- 이미지 ALT ---- */
let altLoaded = false;
async function loadAlts() {
  const grid = $("#altGrid"); grid.innerHTML = "<p class='hint'>불러오는 중…</p>";
  try {
    const d = await api("/api/admin/image-alts");
    altLoaded = true; grid.innerHTML = "";
    (d.images || []).forEach((im) => {
      const card = document.createElement("div"); card.className = "img-card";
      card.innerHTML =
        `<div class="img-thumb"><img src="/api/admin/image?i=${im.index}&t=${Date.now()}" loading="lazy" alt=""></div>` +
        `<div class="img-meta"><b>#${im.index}</b> <small>${im.mime} · ${im.sizeKB}KB</small></div>` +
        `<input type="text" class="alt-input" data-index="${im.index}" value="${(im.currentAlt || "").replace(/"/g, "&quot;")}" placeholder="alt 텍스트">` +
        `<button class="img-btn alt-save" data-index="${im.index}">ALT 저장</button>`;
      grid.appendChild(card);
    });
    grid.querySelectorAll(".alt-save").forEach((b) => b.addEventListener("click", onAltSave));
  } catch (e) { grid.innerHTML = "<p class='msg err'>불러오기 실패: " + e.message + "</p>"; }
}
async function onAltSave(e) {
  const index = parseInt(e.target.dataset.index, 10);
  const inp = e.target.closest(".img-card").querySelector(".alt-input");
  const msg = $("#altMsg"); msg.className = "msg"; msg.textContent = `#${index} 저장 중…`;
  try {
    const r = await api("/api/admin/image-alt", { method: "PUT", body: JSON.stringify({ index, alt: inp.value }) });
    msg.className = "msg ok"; msg.textContent = `#${index} ${r.message}`;
  } catch (err) { msg.className = "msg err"; msg.textContent = "저장 실패: " + err.message; }
}

/* ---- 파일 생성 ---- */
async function genFiles() {
  const msg = $("#filesMsg"); msg.className = "msg"; msg.textContent = "생성 중…";
  try {
    readGlobal(); readPage(); readStruct();
    await api("/api/admin/seo", { method: "PUT", body: JSON.stringify(seo) });
    const r = await api("/api/admin/seo/files", { method: "POST", body: "{}" });
    const f = r.files || {};
    $("#fileSitemap").value = f.sitemap || "(도메인 미입력 또는 sitemap 비활성)";
    $("#fileRobots").value = f.robots || "";
    $("#fileRss").value = f.rss || "(rss 비활성)";
    msg.className = "msg ok"; msg.textContent = r.message || "생성되었습니다.";
  } catch (e) { msg.className = "msg err"; msg.textContent = "생성 실패: " + e.message; }
}

/* ---- 점검 ---- */
async function loadAudit() {
  const msg = $("#auditMsg"); msg.className = "msg"; msg.textContent = "";
  try {
    const a = await api("/api/admin/seo/audit");
    const cards = [
      ["전체 페이지", a.totalPages], ["title 누락", a.noTitle], ["description 누락", a.noDesc],
      ["OG 이미지 누락", a.noOgImage], ["noindex", a.noindexPages], ["ALT 지정", a.altSet + "/" + a.altManaged],
    ];
    $("#auditCards").innerHTML = cards.map(([l, v]) =>
      `<div class="stat"><div class="stat-label">${l}</div><div class="stat-num">${v}</div></div>`).join("");
    $("#auditRows").innerHTML = (a.rows || []).map((r) => {
      const badge = { ok: "정상", warn: "주의", missing: "누락" }[r.status] || r.status;
      return `<tr><td>${r.name}</td><td>${r.menu}</td><td>${r.hasTitle ? "✓" : "–"}</td><td>${r.hasDesc ? "✓" : "–"}</td>` +
        `<td>${r.hasOg ? "✓" : "–"}</td><td>${r.noindex ? "noindex" : "index"}</td><td><span class="badge ${r.status}">${badge}</span></td></tr>`;
    }).join("");
  } catch (e) { msg.className = "msg err"; msg.textContent = "불러오기 실패: " + e.message; }
}

/* ================= 팝업 · 공지 관리 ================= */
let notice = null;
const POP_TEXT = ["title", "content", "imageUrl", "linkUrl", "startDate", "endDate"];
const POP_BOOL = ["enabled", "newWindow", "showTodayClose"];
async function loadNotice() {
  try {
    notice = await api("/api/admin/notice");
    noticeLoaded = true;
    const p = notice.popup || (notice.popup = {});
    POP_TEXT.forEach((k) => { const el = $("#pop_" + k); if (el) el.value = p[k] ?? ""; });
    POP_BOOL.forEach((k) => { const el = $("#pop_" + k); if (el) el.checked = !!p[k]; });
    $("#pop_width").value = p.width || 380;
    renderNoticeList();
  } catch (e) {
    $("#noticeMsg").className = "msg err";
    $("#noticeMsg").textContent = "불러오기 실패: " + e.message;
  }
}
function renderNoticeList() {
  const box = $("#noticeList");
  const arr = (notice.notices = notice.notices || []);
  box.innerHTML = "";
  arr.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "sd-row";
    row.style.flexWrap = "wrap";
    row.innerHTML =
      `<input type="text" placeholder="공지 제목" value="${(it.title || "").replace(/"/g, "&quot;")}" data-ni="${i}" data-nf="title" style="flex:2;min-width:160px">` +
      `<input type="date" value="${it.date || ""}" data-ni="${i}" data-nf="date" style="flex:0 0 150px">` +
      `<label class="chk" style="flex:0 0 auto;display:flex;align-items:center;gap:5px;margin:0"><input type="checkbox" ${it.pinned ? "checked" : ""} data-ni="${i}" data-nf="pinned" style="width:auto;margin:0">고정</label>` +
      `<label class="chk" style="flex:0 0 auto;display:flex;align-items:center;gap:5px;margin:0"><input type="checkbox" ${it.visible !== false ? "checked" : ""} data-ni="${i}" data-nf="visible" style="width:auto;margin:0">노출</label>` +
      `<button class="ghost sm" data-ndel="${i}">삭제</button>` +
      `<textarea placeholder="공지 내용" rows="2" data-ni="${i}" data-nf="content" style="flex:1 0 100%;margin-top:0">${(it.content || "").replace(/</g, "&lt;")}</textarea>`;
    box.appendChild(row);
  });
  box.querySelectorAll("[data-nf]").forEach((el) => {
    el.addEventListener("input", (e) => {
      const i = +e.target.dataset.ni, f = e.target.dataset.nf;
      arr[i][f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    });
  });
  box.querySelectorAll("[data-ndel]").forEach((b) => b.addEventListener("click", (e) => {
    arr.splice(+e.target.dataset.ndel, 1); renderNoticeList();
  }));
}
function readNotice() {
  const p = notice.popup || (notice.popup = {});
  POP_TEXT.forEach((k) => { const el = $("#pop_" + k); if (el) p[k] = el.value; });
  POP_BOOL.forEach((k) => { const el = $("#pop_" + k); if (el) p[k] = el.checked; });
  p.width = parseInt($("#pop_width").value, 10) || 380;
}
async function saveNotice() {
  readNotice();
  const msg = $("#noticeMsg"); msg.className = "msg"; msg.textContent = "저장 중…";
  try {
    const r = await api("/api/admin/notice", { method: "PUT", body: JSON.stringify(notice) });
    msg.className = "msg ok"; msg.textContent = r.message || "저장되었습니다.";
  } catch (e) { msg.className = "msg err"; msg.textContent = "저장 실패: " + e.message; }
}

/* ================= 하단바(푸터) 관리 ================= */
const FKEYS = ["company", "phone", "copyLeft", "copyRight"];
async function loadFooter() {
  try {
    const f = await api("/api/admin/footer");
    footerLoaded = true;
    FKEYS.forEach((k) => { const el = $("#f_" + k); if (el) el.value = f[k] ?? ""; });
  } catch (e) {
    $("#footerMsg").className = "msg err";
    $("#footerMsg").textContent = "불러오기 실패: " + e.message;
  }
}
async function saveFooter() {
  const msg = $("#footerMsg"); msg.className = "msg"; msg.textContent = "저장 중…";
  const body = {}; FKEYS.forEach((k) => { const el = $("#f_" + k); if (el) body[k] = el.value; });
  try {
    const r = await api("/api/admin/footer", { method: "PUT", body: JSON.stringify(body) });
    msg.className = "msg ok"; msg.textContent = r.message || "저장되었습니다.";
  } catch (e) { msg.className = "msg err"; msg.textContent = "저장 실패: " + e.message; }
}

/* ================= 배너 영상 관리 ================= */
async function loadBannerVideo() {
  try {
    const v = await api("/api/admin/bannervideo");
    bvideoLoaded = true;
    $("#bv_enabled").checked = !!v.enabled;
    $("#bv_src").value = v.src ?? "";
    $("#bv_poster").value = v.poster ?? "";
    $("#bv_loop").checked = (v.loop !== false);
  } catch (e) {
    $("#bvMsg").className = "msg err";
    $("#bvMsg").textContent = "불러오기 실패: " + e.message;
  }
}
async function saveBannerVideo() {
  const msg = $("#bvMsg"); msg.className = "msg"; msg.textContent = "저장 중…";
  const body = {
    enabled: $("#bv_enabled").checked,
    src: $("#bv_src").value.trim(),
    poster: $("#bv_poster").value.trim(),
    loop: $("#bv_loop").checked,
  };
  if (body.enabled && !body.src) {
    msg.className = "msg err";
    msg.textContent = "영상 경로를 입력하세요. (예: /videos/main-banner.mp4)";
    return;
  }
  if (body.enabled && /^[a-zA-Z]:\\/.test(body.src)) {
    msg.className = "msg err";
    msg.textContent = "윈도우 파일 경로(C:\\...)는 사용할 수 없습니다. /videos/파일명 형태의 웹 경로로 입력하세요.";
    return;
  }
  try {
    const r = await api("/api/admin/bannervideo", { method: "PUT", body: JSON.stringify(body) });
    msg.className = "msg ok"; msg.textContent = r.message || "저장되었습니다.";
  } catch (e) { msg.className = "msg err"; msg.textContent = "저장 실패: " + e.message; }
}

/* ================= 백업 · 복구 ================= */
async function loadBackup() {
  try {
    const r = await api("/api/admin/backup");
    const t = r.meta || {};
    $("#backupInfo").textContent =
      "마지막 저장 — 텍스트: " + (t.siteData || "–") + " · SEO: " + (t.seo || "–") + " · 하단바: " + (t.footer || "–");
  } catch (e) {
    $("#backupInfo").textContent = "정보를 불러오지 못했습니다: " + e.message;
  }
}
async function exportBackup() {
  const msg = $("#exportMsg"); msg.className = "msg"; msg.textContent = "내보내는 중…";
  try {
    const r = await api("/api/admin/backup");
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0")
      + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hanmec-admin-backup-" + stamp + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    msg.className = "msg ok"; msg.textContent = "내보냈습니다.";
  } catch (e) { msg.className = "msg err"; msg.textContent = "내보내기 실패: " + e.message; }
}
function importBackup(e) {
  const file = e.target.files[0]; if (!file) return;
  const msg = $("#importMsg"); msg.className = "msg"; msg.textContent = "복구 중…";
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const r = await api("/api/admin/backup/restore", { method: "POST", body: JSON.stringify(data) });
      msg.className = "msg ok"; msg.textContent = (r.message || "복구되었습니다.") + " — 새로고침하면 반영됩니다.";
      footerLoaded = false; seoLoaded = false;
    } catch (err) { msg.className = "msg err"; msg.textContent = "복구 실패: " + err.message; }
  };
  reader.readAsText(file);
  e.target.value = "";
}

/* ---------- 전체 텍스트 관리 ---------- */
let content = { items: [] };
const CT_STYLE = ["fontSize", "letterSpacing", "lineHeight", "fontWeight", "textAlign", "marginTop", "marginBottom"];

async function loadContent() {
  const msg = $("#ctMsg"); msg.className = "msg"; msg.textContent = "불러오는 중…";
  try {
    const d = await api("/api/admin/content");
    content.items = d.items || [];
    contentLoaded = true;
    fillCtFilters();
    renderCtList();
    msg.textContent = "";
  } catch (e) { msg.className = "msg err"; msg.textContent = "불러오기 실패: " + e.message; }
}
function fillCtFilters() {
  const cats = ["전체", ...new Set(content.items.map((i) => i.category))];
  const catSel = $("#ct_cat");
  const cur = catSel.value || "전체";
  catSel.innerHTML = cats.map((c) => `<option>${c}</option>`).join("");
  catSel.value = cats.includes(cur) ? cur : "전체";
  fillCtPages();
}
function fillCtPages() {
  const cat = $("#ct_cat").value;
  const items = cat === "전체" ? content.items : content.items.filter((i) => i.category === cat);
  const pages = ["전체", ...new Set(items.map((i) => i.page))];
  const pageSel = $("#ct_page");
  const cur = pageSel.value || "전체";
  pageSel.innerHTML = pages.map((p) => `<option>${p}</option>`).join("");
  pageSel.value = pages.includes(cur) ? cur : "전체";
}
function ctFiltered() {
  const cat = $("#ct_cat").value, page = $("#ct_page").value;
  return content.items.filter((i) => (cat === "전체" || i.category === cat) && (page === "전체" || i.page === page));
}
function escHtml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function renderCtList() {
  const wrap = $("#ctList");
  const list = ctFiltered();
  if (!list.length) { wrap.innerHTML = "<p class='hint'>표시할 텍스트 블록이 없습니다.</p>"; return; }
  wrap.innerHTML = list.map((it) => {
    const idx = content.items.indexOf(it);
    const st = it.style || {};
    const badge = it.resolved ? "" : ` <span class="soon" style="color:#ff8a8a">미연결</span>`;
    const styleRows = it.styleable ? `
      <div class="row3">
        <label>크기(px)<input data-ci="${idx}" data-cs="fontSize" type="number" min="10" max="100" step="1" value="${st.fontSize ?? ""}" placeholder="기본"></label>
        <label>자간(px)<input data-ci="${idx}" data-cs="letterSpacing" type="number" min="-5" max="10" step="0.5" value="${st.letterSpacing ?? ""}" placeholder="기본"></label>
        <label>행간<input data-ci="${idx}" data-cs="lineHeight" type="number" min="1.0" max="2.5" step="0.05" value="${st.lineHeight ?? ""}" placeholder="기본"></label>
      </div>
      <div class="row3">
        <label>굵기<select data-ci="${idx}" data-cs="fontWeight">
          <option value="">기본</option>${[300,400,500,600,700,800,900].map((w) => `<option value="${w}" ${String(st.fontWeight) === String(w) ? "selected" : ""}>${w}</option>`).join("")}
        </select></label>
        <label>정렬<select data-ci="${idx}" data-cs="textAlign">
          ${["","left","center","right"].map((a) => `<option value="${a}" ${(st.textAlign ?? "") === a ? "selected" : ""}>${a === "" ? "기본" : a === "left" ? "왼쪽" : a === "center" ? "가운데" : "오른쪽"}</option>`).join("")}
        </select></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label>상단여백<input data-ci="${idx}" data-cs="marginTop" type="number" min="0" max="100" step="1" value="${st.marginTop ?? ""}" placeholder="기본"></label>
          <label>하단여백<input data-ci="${idx}" data-cs="marginBottom" type="number" min="0" max="100" step="1" value="${st.marginBottom ?? ""}" placeholder="기본"></label>
        </div>
      </div>` : `<p class="hint" style="margin:6px 0 0">이 블록은 다른 위치와 문구를 공유하여 서체 개별 조정은 지원하지 않고, 문구만 수정합니다.</p>`;
    return `<div class="panel" style="margin-bottom:14px">
      <div class="block-label" style="display:flex;justify-content:space-between;align-items:center">
        <span><b>${escHtml(it.page)}</b> · ${escHtml(it.section)} · ${escHtml(it.label)}${badge}</span>
        <label class="chk" style="display:flex;align-items:center;gap:6px;flex-direction:row;margin:0;font-weight:600">
          <input data-ci="${idx}" data-cen="1" type="checkbox" ${it.enabled ? "checked" : ""} style="width:auto;margin:0"> 사용
        </label>
      </div>
      <label>텍스트 <small>(비우면 기본값 유지 · 줄바꿈 = Enter → &lt;br&gt;)</small>
        <textarea data-ci="${idx}" data-ct="1" rows="2" placeholder="${escHtml(it.default)}">${escHtml(it.text)}</textarea>
      </label>
      ${styleRows}
      <div class="actions" style="margin-top:4px">
        <button class="ghost sm" data-creset="${idx}">기본값 복원</button>
        <small style="color:#7f90ab">기본: ${escHtml((it.default || "").replace(/\n/g, " ⏎ ")).slice(0, 80) || "(없음)"}</small>
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll("textarea[data-ct]").forEach((el) =>
    el.addEventListener("input", () => { content.items[+el.dataset.ci].text = el.value; }));
  wrap.querySelectorAll("input[data-cen]").forEach((el) =>
    el.addEventListener("change", () => { content.items[+el.dataset.ci].enabled = el.checked; }));
  wrap.querySelectorAll("[data-cs]").forEach((el) =>
    el.addEventListener("input", () => {
      const it = content.items[+el.dataset.ci];
      it.style = it.style || {};
      it.style[el.dataset.cs] = el.value;
    }));
  wrap.querySelectorAll("[data-creset]").forEach((el) =>
    el.addEventListener("click", () => {
      const it = content.items[+el.dataset.creset];
      it.text = ""; it.style = { fontSize: "", letterSpacing: "", lineHeight: "", fontWeight: "", textAlign: "", marginTop: "", marginBottom: "" };
      renderCtList();
    }));
}
function ctBulkApply() {
  const list = ctFiltered().filter((i) => i.styleable);
  if (!list.length) { alert("서체 조정이 가능한 블록이 없습니다."); return; }
  const map = { fontSize: $("#ctb_size").value, letterSpacing: $("#ctb_ls").value, lineHeight: $("#ctb_lh").value, marginTop: $("#ctb_mt").value, marginBottom: $("#ctb_mb").value };
  const set = Object.entries(map).filter(([, v]) => String(v).trim() !== "");
  if (!set.length) { alert("적용할 값을 하나 이상 입력하세요."); return; }
  if (!confirm(`현재 필터된 ${list.length}개 블록에 서체 값을 일괄 적용할까요? (저장 전에는 되돌릴 수 있습니다)`)) return;
  list.forEach((it) => { it.style = it.style || {}; set.forEach(([k, v]) => { it.style[k] = v; }); });
  renderCtList();
  const msg = $("#ctMsg"); msg.className = "msg ok"; msg.textContent = `${list.length}개 블록에 적용됨 (저장해야 반영)`;
}
async function saveContent() {
  const msg = $("#ctMsg"); msg.className = "msg"; msg.textContent = "저장 중…";
  try {
    const r = await api("/api/admin/content", { method: "PUT", body: JSON.stringify({ items: content.items }) });
    msg.className = "msg ok"; msg.textContent = r.message || "저장되었습니다.";
  } catch (e) { msg.className = "msg err"; msg.textContent = "저장 실패: " + e.message; }
}

/* ---------- 이벤트 ---------- */
$("#ctSaveBtn").addEventListener("click", saveContent);
$("#ctReload").addEventListener("click", () => { contentLoaded = false; loadContent(); });
$("#ct_cat").addEventListener("change", () => { fillCtPages(); renderCtList(); });
$("#ct_page").addEventListener("change", renderCtList);
$("#ctBulkApply").addEventListener("click", ctBulkApply);
$("#noticeSaveBtn").addEventListener("click", saveNotice);
$("#noticeReloadBtn").addEventListener("click", () => { noticeLoaded = false; loadNotice(); });
$("#noticeAdd").addEventListener("click", () => {
  (notice.notices = notice.notices || []).push({ title: "", content: "", pinned: false, date: "", visible: true });
  renderNoticeList();
});
$("#footerSaveBtn").addEventListener("click", saveFooter);
$("#footerReloadBtn").addEventListener("click", () => { footerLoaded = false; loadFooter(); });
$("#bvSaveBtn").addEventListener("click", saveBannerVideo);
$("#bvReloadBtn").addEventListener("click", () => { bvideoLoaded = false; loadBannerVideo(); });
$("#exportBtn").addEventListener("click", exportBackup);
$("#importFile").addEventListener("change", importBackup);
$("#imgReload").addEventListener("click", loadImages);
$("#seoSaveBtn").addEventListener("click", saveSeo);
$("#pgSaveBtn").addEventListener("click", savePage);
$("#sdSaveBtn").addEventListener("click", saveStruct);
$("#altReload").addEventListener("click", loadAlts);
$("#genFilesBtn").addEventListener("click", genFiles);
$("#auditReload").addEventListener("click", loadAudit);
$("#pgSelect").addEventListener("change", (e) => { readPage(); pgIndex = parseInt(e.target.value, 10) || 0; fillPage(); });
// 구조화 데이터 추가 버튼
document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
  const kind = b.dataset.add;
  (seo.structuredData[kind] = seo.structuredData[kind] || []).push({});
  const fields = kind === "services" ? ["name","description","area","url"]
    : kind === "products" ? ["name","description","image","category","url"] : ["question","answer"];
  renderSdList(kind, fields);
}));
// 글자 수 카운터 + 페이지 미리보기 실시간
document.querySelectorAll("[data-count]").forEach((el) => el.addEventListener("input", () => countHint(el)));
["pg_title","pg_description","pg_ogTitle","pg_ogDescription","pg_ogImage"].forEach((id) => {
  const el = $("#" + id); if (el) el.addEventListener("input", () => { readPage(); renderSeoPreview(); });
});
["sd_name","sd_localBusiness","sd_description","sd_logo","sd_phone","sd_email","sd_region","sd_address","sd_hours","sd_mapUrl","sd_sameAs"].forEach((id) => {
  const el = $("#" + id); if (el) el.addEventListener("input", renderSdPreview);
});
$("#blockSelect").addEventListener("change", (e) => {
  readForm();            // 현재 블록 값 보존
  currentKey = e.target.value;
  fillForm();
});
["tContent", "tSize", "tLs", "tLh", "tWeight", "tAlign"].forEach((id) => {
  $("#" + id).addEventListener("input", renderPreview);
  $("#" + id).addEventListener("change", renderPreview);
});
$("#loginBtn").addEventListener("click", login);
$("#password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("#logoutBtn").addEventListener("click", logout);
$("#saveBtn").addEventListener("click", save);
$("#resetBtn").addEventListener("click", resetBlock);

checkLogin();
