// ============================================================================
// 공통 유틸 / Supabase 클라이언트 / 인증 / 네비게이션 / 테마 / 토스트 / 모달
// ============================================================================
(function(){
  "use strict";

  // ---- Supabase 클라이언트 -------------------------------------------------
  const cfg = window.SUPABASE_CONFIG || {};
  let sb = null;
  function getClient(){
    if (sb) return sb;
    if (!window.supabase || !cfg.url || cfg.url.includes("YOUR-PROJECT-REF")) {
      console.warn("[DCL] Supabase 설정이 완료되지 않았습니다. js/supabase-config.js 를 확인하세요.");
      return null;
    }
    sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    return sb;
  }
  window.DCL = window.DCL || {};
  DCL.client = getClient;

  DCL.isConfigured = function(){
    return !!(cfg.url && !cfg.url.includes("YOUR-PROJECT-REF") && cfg.anonKey && !cfg.anonKey.includes("YOUR-ANON"));
  };

  // ---- RPC / 쿼리 래퍼 (공통 에러 처리) --------------------------------------
  DCL.rpc = async function(fn, args){
    const c = getClient();
    if (!c) { console.warn("[DCL] Supabase 미설정 - RPC 건너뜀:", fn); throw new Error("not-configured"); }
    const { data, error } = await c.rpc(fn, args || {});
    if (error) { console.error(fn, error); DCL.toast(error.message || "요청 처리 중 오류가 발생했습니다", "err"); throw error; }
    return data;
  };
  DCL.select = async function(table, builderFn){
    const c = getClient();
    if (!c) { console.warn("[DCL] Supabase 미설정 - 조회 건너뜀:", table); return []; }
    let q = c.from(table).select("*");
    if (builderFn) q = builderFn(q);
    const { data, error } = await q;
    if (error) { console.error(table, error); DCL.toast(error.message || "조회 중 오류가 발생했습니다", "err"); return []; }
    return data || [];
  };

  // ---- 인증 (이름/사번 선택 로그인, 세션 저장) --------------------------------
  const AUTH_KEY = "dcl_current_inspector";
  DCL.getCurrentInspector = function(){
    try { return JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null"); } catch(e){ return null; }
  };
  DCL.setCurrentInspector = function(inspector){
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(inspector));
  };
  DCL.logout = function(){
    sessionStorage.removeItem(AUTH_KEY);
    location.href = "index.html";
  };
  // allowedRoles 생략 시 로그인만 확인. admin은 모든 화면 접근 가능.
  DCL.requireAuth = function(allowedRoles){
    const insp = DCL.getCurrentInspector();
    if (!insp) { location.href = "index.html"; return null; }
    if (allowedRoles && allowedRoles.length && insp.role !== "admin" && !allowedRoles.includes(insp.role)) {
      DCL.toast("이 화면에 대한 권한이 없습니다", "err");
      setTimeout(()=>location.href = "dashboard.html", 700);
      return null;
    }
    return insp;
  };

  // ---- 테마 토글 -------------------------------------------------------------
  DCL.initTheme = function(){
    const saved = localStorage.getItem("dcl_theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.textContent = (document.documentElement.getAttribute("data-theme") === "dark") ? "☀️" : "🌙";
      btn.addEventListener("click", function(){
        const cur = document.documentElement.getAttribute("data-theme");
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("dcl_theme", next);
        btn.textContent = next === "dark" ? "☀️" : "🌙";
      });
    }
  };

  // ---- 토스트 ----------------------------------------------------------------
  function ensureToastWrap(){
    let w = document.querySelector(".toast-wrap");
    if (!w) { w = document.createElement("div"); w.className = "toast-wrap"; document.body.appendChild(w); }
    return w;
  }
  DCL.toast = function(msg, type){
    const w = ensureToastWrap();
    const t = document.createElement("div");
    t.className = "toast " + (type === "err" ? "err" : "ok");
    t.textContent = msg;
    w.appendChild(t);
    setTimeout(()=>{ t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(()=>t.remove(), 300); }, 2600);
  };

  // ---- 모달 (드래그 + 리사이즈는 CSS resize:both 사용, 헤더 드래그만 JS 처리) ----
  DCL.openModal = function(id){ const m = document.getElementById(id); if (m) m.classList.add("open"); };
  DCL.closeModal = function(id){ const m = document.getElementById(id); if (m) m.classList.remove("open"); };
  DCL.wireDraggableModal = function(overlaySelector){
    document.querySelectorAll(overlaySelector + " .modal").forEach(function(modal){
      const header = modal.querySelector(".modal-header");
      if (!header) return;
      let dragging = false, sx=0, sy=0, ox=0, oy=0;
      header.addEventListener("mousedown", function(e){
        if (e.target.closest(".modal-close")) return;
        dragging = true; sx = e.clientX; sy = e.clientY;
        const r = modal.getBoundingClientRect(); ox = r.left; oy = r.top;
        modal.style.position="fixed"; modal.style.left=ox+"px"; modal.style.top=oy+"px"; modal.style.margin="0";
        document.body.style.userSelect="none";
      });
      document.addEventListener("mousemove", function(e){
        if (!dragging) return;
        modal.style.left = (ox + (e.clientX - sx)) + "px";
        modal.style.top = (oy + (e.clientY - sy)) + "px";
      });
      document.addEventListener("mouseup", function(){ dragging=false; document.body.style.userSelect=""; });
    });
  };

  // ---- 드롭다운 자동 첫 항목 선택 --------------------------------------------
  DCL.autoSelectFirst = function(selectEl){
    if (selectEl && selectEl.options && selectEl.options.length > 0 && !selectEl.value) {
      selectEl.selectedIndex = 0;
      selectEl.dispatchEvent(new Event("change"));
    }
  };
  // 부모 select 변경 시 자식 select 옵션 채우고 첫 항목 자동선택 (계단식)
  DCL.cascadeSelect = function(childEl, options, valueKey, labelKey){
    childEl.innerHTML = "";
    options.forEach(function(o){
      const opt = document.createElement("option");
      opt.value = o[valueKey]; opt.textContent = o[labelKey];
      childEl.appendChild(opt);
    });
    DCL.autoSelectFirst(childEl);
  };

  // ---- 날짜 포맷 --------------------------------------------------------------
  DCL.today = function(){ return new Date().toLocaleDateString("sv-SE", {timeZone:"Asia/Bangkok"}); }; // YYYY-MM-DD
  DCL.fmtDate = function(s){ if(!s) return "-"; return String(s).slice(0,10); };
  DCL.fmtDateTime = function(s){
    if(!s) return "-";
    const d = new Date(s);
    return d.toLocaleString("ko-KR", {timeZone:"Asia/Bangkok", year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  };
  // KPI 표시 규칙: 인원(명)=정수, 비율(%)=소수점1자리
  DCL.fmtCount = function(n){ return (n===null||n===undefined) ? "0" : Math.round(n).toLocaleString("ko-KR"); };
  DCL.fmtPercent = function(n){ return (n===null||n===undefined||isNaN(n)) ? "0.0%" : (Math.round(n*10)/10).toFixed(1) + "%"; };

  // ---- 점검주기(cycle_type) 판정 -----------------------------------------------
  // dateStr: "YYYY-MM-DD". 요일/일자 판정은 문자열을 UTC 자정으로 고정 파싱해
  // 호출측(로컬시간대/UTC 기반) 어느쪽에서 만든 날짜문자열이든 동일하게 계산되도록 함.
  const WEEKDAY_LABEL = ["일","월","화","수","목","금","토"];
  DCL.isDueOn = function(part, dateStr){
    if (!part) return false;
    const type = part.cycle_type || "DAILY";
    if (type === "WEEKLY") {
      const wd = new Date(dateStr + "T00:00:00Z").getUTCDay();
      return Array.isArray(part.cycle_weekdays) && part.cycle_weekdays.includes(wd);
    }
    if (type === "MONTHLY") {
      const d = new Date(dateStr + "T00:00:00Z");
      const dom = d.getUTCDate();
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate();
      const target = Math.min(part.cycle_day_of_month || 1, lastDay); // 월말 보정 (예: 31일 지정 + 2월)
      return dom === target;
    }
    return true; // DAILY
  };
  DCL.cycleLabel = function(part){
    if (!part) return "매일";
    const type = part.cycle_type || "DAILY";
    if (type === "WEEKLY") {
      const days = Array.isArray(part.cycle_weekdays) ? part.cycle_weekdays.slice().sort() : [];
      return days.length ? "매주 " + days.map(d=>WEEKDAY_LABEL[d]).join(",") : "매주 (요일 미지정)";
    }
    if (type === "MONTHLY") {
      return "매월 " + (part.cycle_day_of_month || 1) + "일";
    }
    return "매일";
  };
  DCL.WEEKDAY_LABEL = WEEKDAY_LABEL;

  // ---- 사이드바 네비게이션 렌더 -------------------------------------------------
  const NAV_ITEMS = [
    { href:"dashboard.html",  ico:"📊", label:"대시보드", roles:null },
    { href:"inspect.html",    ico:"📷", label:"점검 수행(QR)", roles:null },
    { href:"actions.html",    ico:"🛠️", label:"조치 관리", roles:null },
    { href:"parts.html",      ico:"📦", label:"부품 마스터", roles:["admin"] },
    { href:"qr.html",         ico:"🏷️", label:"QR 발행/재발행", roles:["admin"] },
    { href:"types.html",      ico:"🧩", label:"부품유형/점검항목", roles:["admin"] },
    { href:"inspectors.html", ico:"👥", label:"점검자 관리", roles:["admin"] }
  ];
  DCL.renderSidebar = function(activeHref){
    const mount = document.getElementById("sidebarNav");
    if (!mount) return;
    const insp = DCL.getCurrentInspector();
    const role = insp ? insp.role : "inspector";
    let html = "";
    NAV_ITEMS.forEach(function(item){
      if (item.roles && role !== "admin" && !item.roles.includes(role)) return;
      const active = (item.href === activeHref) ? " active" : "";
      html += '<a class="nav-item'+active+'" href="'+item.href+'"><span class="ico">'+item.ico+'</span><span>'+item.label+'</span></a>';
    });
    mount.innerHTML = html;

    const who = document.getElementById("sidebarWho");
    if (who && insp) {
      const roleLabel = {admin:"관리자", action_owner:"조치담당자", inspector:"점검자"}[insp.role] || insp.role;
      who.innerHTML = '<div class="fw-700">'+insp.name+'</div><div class="text-mute fs-xs">'+roleLabel+(insp.department?(" · "+insp.department):"")+'</div>';
    }
  };

  // ---- 서비스워커 등록 (오프라인 앱쉘 캐시) -------------------------------------
  DCL.registerSW = function(){
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function(e){ console.warn("[DCL] SW 등록 실패", e); });
    }
  };

  // ---- 공통 초기화 (각 페이지 DOMContentLoaded 에서 호출) ----------------------
  DCL.initPage = function(activeHref, opts){
    opts = opts || {};
    DCL.initTheme();
    DCL.registerSW();
    if (opts.requireRoles !== false) {
      const insp = DCL.requireAuth(opts.roles);
      if (!insp) return null;
      DCL.renderSidebar(activeHref);
      const logoutBtn = document.getElementById("logoutBtn");
      if (logoutBtn) logoutBtn.addEventListener("click", DCL.logout);
      if (!DCL.isConfigured()) {
        DCL.toast("Supabase 미설정: js/supabase-config.js 를 채워주세요", "err");
      }
      return insp;
    }
    return null;
  };

})();
