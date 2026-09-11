// ============================================================================
// 점검 수행 (QR 스캔 + 점검항목 입력) - 오프라인 큐 지원
// ============================================================================
const OFFLINE_KEY = "dcl_offline_queue";
let html5QrCode = null;
let CURRENT_PART = null;
let CURRENT_ITEMS = [];
let ITEM_STATE = {}; // item index -> {input_value, judge_result, photo_url}

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("inspect.html", null); // 전 역할 접근 가능
  if (!insp) return;

  document.getElementById("startScanBtn").addEventListener("click", startScan);
  document.getElementById("stopScanBtn").addEventListener("click", stopScan);
  document.getElementById("manualLoadBtn").addEventListener("click", function(){
    const code = document.getElementById("manualCode").value.trim().toUpperCase();
    if (code) loadPartByCode(code);
  });
  document.getElementById("backToScanBtn").addEventListener("click", showScanStep);
  document.getElementById("submitInspectionBtn").addEventListener("click", submitInspection);
  document.getElementById("scanNextBtn").addEventListener("click", showScanStep);

  window.addEventListener("online", ()=>{ updateOfflineBanner(); flushQueue(); });
  window.addEventListener("offline", updateOfflineBanner);
  updateOfflineBanner();
  flushQueue();

  await loadMyParts();

  // URL ?code= 로 직접 진입한 경우 (QR을 일반 카메라 앱으로 스캔해 브라우저로 열어 들어온 경우)
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (code) loadPartByCode(code.toUpperCase());
});

// ---- 오프라인 큐 -------------------------------------------------------------
function getQueue(){ try{ return JSON.parse(localStorage.getItem(OFFLINE_KEY)||"[]"); }catch(e){ return []; } }
function setQueue(q){ localStorage.setItem(OFFLINE_KEY, JSON.stringify(q)); updateOfflineBanner(); }
function updateOfflineBanner(){
  const banner = document.getElementById("offlineBanner");
  const q = getQueue();
  if (!navigator.onLine) {
    banner.style.display = "block";
    banner.innerHTML = `<span data-i18n="page.inspect.offlineBanner">${DCL.t("page.inspect.offlineBanner")}</span> <span id="queueCount"></span>`;
    document.getElementById("queueCount").textContent = q.length ? DCL.t("page.inspect.offlineQueueCount", {n:q.length}) : "";
  } else if (q.length) {
    banner.style.display = "block";
    banner.innerHTML = DCL.t("page.inspect.offlineSyncing", {n:q.length});
  } else {
    banner.style.display = "none";
  }
}
async function flushQueue(){
  if (!navigator.onLine) return;
  let q = getQueue();
  if (!q.length) { updateOfflineBanner(); return; }
  const client = DCL.client();
  if (!client) return;
  while (q.length) {
    const item = q[0];
    try{
      const { error } = await client.rpc("fn_submit_inspection", item.payload);
      if (error) throw error;
      q.shift();
      setQueue(q);
    }catch(e){
      console.warn("[DCL] 큐 동기화 실패, 재시도 대기", e);
      break;
    }
  }
  updateOfflineBanner();
}

// ---- 내 담당 부품 목록 --------------------------------------------------------
async function loadMyParts(){
  const insp = DCL.getCurrentInspector();
  const mount = document.getElementById("myPartsList");
  const assigns = await DCL.select("assignments", q => q.eq("inspector_id", insp.id).eq("is_active", true));
  if (!assigns.length) { mount.innerHTML = `<div class="empty-state">${DCL.t("page.inspect.noAssigned")}</div>`; return; }
  const partIds = assigns.map(a=>a.part_id);
  const allParts = await DCL.select("parts", q => q.in("id", partIds).eq("is_deleted", false));
  const today = DCL.today();
  const parts = allParts.filter(p => DCL.isDueOn(p, today)); // 오늘 점검주기상 대상인 부품만 표시
  const todays = await DCL.select("inspections", q => q.in("part_id", partIds).eq("inspect_date", today));
  const doneIds = new Set(todays.map(t=>t.part_id));

  if (!parts.length) { mount.innerHTML = `<div class="empty-state">${DCL.t("page.inspect.noneDueToday")}</div>`; return; }

  mount.innerHTML = parts.map(p => `
    <div class="flex-between" style="padding:9px 0; border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:700;">${esc(p.part_name)}</div>
        <div class="text-mute mono fs-xs">${esc(p.part_code)}</div>
      </div>
      <div>
        ${doneIds.has(p.id) ? `<span class="badge badge-green">${DCL.t("page.inspect.doneComplete")}</span>` : `<span class="badge badge-yellow">${DCL.t("page.inspect.notDoneYet")}</span>`}
        <button class="btn btn-sm mt-8" style="display:block; margin-top:6px;" onclick="loadPartByCode('${esc(p.part_code)}')">${DCL.t("page.inspect.inspectBtn")}</button>
      </div>
    </div>`).join("") || `<div class="empty-state">${DCL.t("page.inspect.noneAssignedShort")}</div>`;
}

// ---- QR 스캐너 ---------------------------------------------------------------
function startScan(){
  if (typeof Html5Qrcode === "undefined") {
    document.getElementById("scanHint").textContent = DCL.t("page.inspect.scannerLoadFail");
    DCL.toast(DCL.t("page.inspect.scannerLoadFailToast"), "err");
    return;
  }
  document.getElementById("startScanBtn").style.display = "none";
  document.getElementById("stopScanBtn").style.display = "inline-flex";
  html5QrCode = new Html5Qrcode("reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 230 },
    onScanSuccess,
    ()=>{}
  ).catch(function(err){
    document.getElementById("scanHint").textContent = DCL.t("page.inspect.cameraUnavailable");
    document.getElementById("startScanBtn").style.display = "inline-flex";
    document.getElementById("stopScanBtn").style.display = "none";
  });
}
function stopScan(){
  if (html5QrCode) { html5QrCode.stop().catch(()=>{}); }
  document.getElementById("startScanBtn").style.display = "inline-flex";
  document.getElementById("stopScanBtn").style.display = "none";
}
function onScanSuccess(text){
  stopScan();
  let code = text.trim();
  try{
    if (code.includes("code=")) {
      const u = new URL(code);
      code = u.searchParams.get("code") || code;
    }
  }catch(e){ /* URL이 아니면 원문 그대로 코드로 처리 */ }
  loadPartByCode(code.toUpperCase());
}

// ---- 부품 로드 및 점검 화면 ----------------------------------------------------
async function loadPartByCode(code){
  const parts = await DCL.select("parts", q => q.eq("part_code", code).eq("is_deleted", false).limit(1));
  if (!parts.length) { DCL.toast(DCL.t("page.inspect.partNotFound", {code}), "err"); return; }
  CURRENT_PART = parts[0];
  // 점검항목은 부품 등록 시점의 스냅샷(part_checklist_items)이 아니라 항상 최신 템플릿(checklist_templates)에서 조회한다.
  // part_checklist_items는 부품 등록 시 1회만 복사되고 이후 관리자가 템플릿의 상한/하한 등을 변경해도 갱신되지 않아,
  // 등록 이후 기준이 바뀐 부품은 과거 기준(대부분 null)으로 판정되는 문제가 있었다.
  CURRENT_ITEMS = await DCL.select("checklist_templates", q => q.eq("part_type_id", CURRENT_PART.part_type_id).eq("is_active", true).order("item_order"));
  ITEM_STATE = {};
  CURRENT_ITEMS.forEach((it,idx)=> ITEM_STATE[idx] = { input_value:null, judge_result:null, photo_url:null });

  document.getElementById("curPartCode").textContent = CURRENT_PART.part_code;
  document.getElementById("curPartName").textContent = CURRENT_PART.part_name;
  document.getElementById("curPartMeta").textContent = [CURRENT_PART.location, CURRENT_PART.department].filter(Boolean).join(" · ");

  const today = DCL.today();
  const todays = await DCL.select("inspections", q => q.eq("part_id", CURRENT_PART.id).eq("inspect_date", today));
  document.getElementById("todayBadge").innerHTML = todays.length
    ? `<span class="badge badge-green">${DCL.t("page.inspect.alreadyDoneToday")}</span>`
    : `<span class="badge badge-yellow">${DCL.t("page.inspect.notDoneToday")}</span>`;

  renderChecklist();
  document.getElementById("scanStep").style.display = "none";
  document.getElementById("doneStep").style.display = "none";
  document.getElementById("inspectStep").style.display = "block";
}

function renderChecklist(){
  const area = document.getElementById("checklistArea");
  if (!CURRENT_ITEMS.length) { area.innerHTML = `<div class="card empty-state">${DCL.t("page.inspect.noItems")}</div>`; return; }
  area.innerHTML = CURRENT_ITEMS.map((it, idx) => {
    if (it.judge_type === "OX") {
      return `<div class="checklist-item" id="ci-${idx}">
        <div class="flex-between"><b>${idx+1}. ${esc(it.item_name)}</b>${it.photo_required?`<span class="badge badge-yellow">${DCL.t("page.inspect.photoRequired")}</span>`:''}</div>
        <div class="judge-btns">
          <div class="judge-btn" id="ok-${idx}" onclick="setOX(${idx},'OK')">${DCL.t("page.inspect.judgeNormal")}</div>
          <div class="judge-btn" id="ng-${idx}" onclick="setOX(${idx},'NG')">${DCL.t("page.inspect.judgeAbnormal")}</div>
        </div>
        <div id="photo-${idx}"></div>
      </div>`;
    }
    if (it.judge_type === "NUMERIC") {
      const range = (it.lower_limit!=null||it.upper_limit!=null) ? `(기준: ${it.lower_limit??'-'} ~ ${it.upper_limit??'-'} ${it.unit||''})` : "";
      return `<div class="checklist-item" id="ci-${idx}">
        <div class="flex-between"><b>${idx+1}. ${esc(it.item_name)}</b>${it.photo_required?`<span class="badge badge-yellow">${DCL.t("page.inspect.photoRequired")}</span>`:''}</div>
        <div class="text-mute fs-xs">${range}</div>
        <input type="number" step="0.01" placeholder="${DCL.t("page.inspect.numericPlaceholder", {unit: it.unit?('('+it.unit+')'):''})}" oninput="setNumeric(${idx}, this.value)" class="mt-8"/>
        <div id="photo-${idx}"></div>
      </div>`;
    }
    // SELECT
    const opts = (it.select_options||"").split(",").map(s=>s.trim()).filter(Boolean);
    return `<div class="checklist-item" id="ci-${idx}">
      <div class="flex-between"><b>${idx+1}. ${esc(it.item_name)}</b>${it.photo_required?`<span class="badge badge-yellow">${DCL.t("page.inspect.photoRequired")}</span>`:''}</div>
      <select onchange="setSelect(${idx}, this.value, this.selectedIndex)" class="mt-8">
        <option value="">${DCL.t("page.inspect.selectPlaceholder")}</option>
        ${opts.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join("")}
      </select>
      <div id="photo-${idx}"></div>
    </div>`;
  }).join("");
}

function markAbnormalUI(idx, abnormal){
  const el = document.getElementById("ci-"+idx);
  if (el) el.classList.toggle("abnormal", !!abnormal);
  const it = CURRENT_ITEMS[idx];
  const photoMount = document.getElementById("photo-"+idx);
  if (abnormal && it.photo_required) {
    photoMount.innerHTML = `<div class="mt-8"><label class="fs-xs">${DCL.t("page.inspect.photoLabel")}</label>
      <input type="file" accept="image/*" capture="environment" onchange="attachPhoto(${idx}, this)"/>
      <div id="photoPreview-${idx}"></div></div>`;
  } else {
    photoMount.innerHTML = "";
  }
}

function setOX(idx, val){
  ITEM_STATE[idx].input_value = val;
  ITEM_STATE[idx].judge_result = val === "NG" ? "ABNORMAL" : "NORMAL";
  document.getElementById("ok-"+idx).classList.toggle("sel-ok", val==="OK");
  document.getElementById("ng-"+idx).classList.toggle("sel-ng", val==="NG");
  markAbnormalUI(idx, val === "NG");
}
function setNumeric(idx, val){
  const it = CURRENT_ITEMS[idx];
  ITEM_STATE[idx].input_value = val;
  let abnormal = false;
  const num = parseFloat(val);
  if (!isNaN(num)) {
    if (it.lower_limit != null && num < it.lower_limit) abnormal = true;
    if (it.upper_limit != null && num > it.upper_limit) abnormal = true;
  }
  ITEM_STATE[idx].judge_result = abnormal ? "ABNORMAL" : "NORMAL";
  markAbnormalUI(idx, abnormal);
}
function setSelect(idx, val, selectedIndex){
  ITEM_STATE[idx].input_value = val;
  const abnormal = selectedIndex > 1; // 0=선택하세요, 1=첫 옵션(정상)
  ITEM_STATE[idx].judge_result = abnormal ? "ABNORMAL" : "NORMAL";
  markAbnormalUI(idx, abnormal);
}

async function attachPhoto(idx, inputEl){
  const file = inputEl.files[0];
  if (!file) return;
  const dataUrl = await compressImage(file, 480, 0.6);
  ITEM_STATE[idx].photo_url = dataUrl;
  document.getElementById("photoPreview-"+idx).innerHTML = `<img src="${dataUrl}" style="max-width:120px; border-radius:8px; margin-top:6px; border:1px solid var(--border);"/>`;
}
function compressImage(file, maxWidth, quality){
  return new Promise(function(resolve){
    const img = new Image();
    const reader = new FileReader();
    reader.onload = function(e){
      img.onload = function(){
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale; canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function showScanStep(){
  document.getElementById("inspectStep").style.display = "none";
  document.getElementById("doneStep").style.display = "none";
  document.getElementById("scanStep").style.display = "block";
  document.getElementById("manualCode").value = "";
  history.replaceState(null, "", "inspect.html");
  loadMyParts();
}

async function submitInspection(){
  if (!CURRENT_ITEMS.length) { DCL.toast(DCL.t("page.inspect.noItemsToast"), "err"); return; }
  const results = [];
  for (let idx=0; idx<CURRENT_ITEMS.length; idx++){
    const it = CURRENT_ITEMS[idx];
    const st = ITEM_STATE[idx];
    if (st.input_value === null || st.input_value === "") { DCL.toast(DCL.t("page.inspect.itemRequired", {item: it.item_name}), "err"); return; }
    if (st.judge_result === "ABNORMAL" && it.photo_required && !st.photo_url) { DCL.toast(DCL.t("page.inspect.photoRequiredToast", {item: it.item_name}), "err"); return; }
    results.push({ item_name: it.item_name, judge_type: it.judge_type, input_value: String(st.input_value), judge_result: st.judge_result, photo_url: st.photo_url });
  }
  const insp = DCL.getCurrentInspector();
  const payload = { p_part_id: CURRENT_PART.id, p_inspector_id: insp.id, p_note: document.getElementById("inspectionNote").value.trim(), p_results: results };
  const hasAbnormal = results.some(r=>r.judge_result==="ABNORMAL");

  document.getElementById("submitInspectionBtn").disabled = true;
  if (!navigator.onLine) {
    queueSubmission(payload);
    showDone(hasAbnormal, true);
    document.getElementById("submitInspectionBtn").disabled = false;
    return;
  }
  const client = DCL.client();
  try{
    if (!client) throw new Error("not-configured");
    const { error } = await client.rpc("fn_submit_inspection", payload);
    if (error) throw error;
    showDone(hasAbnormal, false);
  }catch(e){
    console.warn(e);
    if (e && e.message === "not-configured") { DCL.toast(DCL.t("page.inspect.notConfiguredToast"), "err"); }
    else { queueSubmission(payload); showDone(hasAbnormal, true); }
  }
  document.getElementById("submitInspectionBtn").disabled = false;
}

function queueSubmission(payload){
  const q = getQueue();
  q.push({ payload, queued_at: new Date().toISOString(), part_code: CURRENT_PART.part_code });
  setQueue(q);
}

function showDone(hasAbnormal, offline){
  document.getElementById("inspectStep").style.display = "none";
  document.getElementById("doneStep").style.display = "block";
  document.getElementById("doneIcon").textContent = offline ? "📥" : (hasAbnormal ? "⚠️" : "✅");
  document.getElementById("doneTitle").textContent = offline ? DCL.t("page.inspect.doneOfflineTitle") : (hasAbnormal ? DCL.t("page.inspect.doneAbnormalTitle") : DCL.t("page.inspect.doneNormalTitle"));
  document.getElementById("doneDesc").textContent = offline
    ? DCL.t("page.inspect.doneOfflineDesc", {code: CURRENT_PART.part_code})
    : (hasAbnormal ? DCL.t("page.inspect.doneAbnormalDesc", {code: CURRENT_PART.part_code}) : DCL.t("page.inspect.doneNormalDesc", {code: CURRENT_PART.part_code}));
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
