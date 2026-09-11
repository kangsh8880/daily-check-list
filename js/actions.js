// ============================================================================
// 조치 관리 (2단계 승인형: 완료등록 -> 승인/반려)
// ============================================================================
let ALL_ACTIONS=[], ALL_PARTS=[], ALL_INSPECTORS=[];

// 심각도/상태 배지는 목록 테이블과 KPI 클릭 팝업 양쪽에서 공통으로 쓰므로 모듈 스코프로 뺀다.
const SEV_BADGE = { MINOR:()=>`<span class="badge badge-gray">${DCL.t("sev.MINOR")}</span>`, MAJOR:()=>`<span class="badge badge-yellow">${DCL.t("sev.MAJOR")}</span>`, CRITICAL:()=>`<span class="badge badge-red">${DCL.t("sev.CRITICAL")}</span>` };
const STATUS_BADGE = { OPEN:()=>`<span class="badge badge-red">${DCL.t("status.OPEN")}</span>`, IN_PROGRESS:()=>`<span class="badge badge-yellow">${DCL.t("status.IN_PROGRESS")}</span>`, DONE:()=>`<span class="badge badge-blue">${DCL.t("status.DONE")}</span>`, APPROVED:()=>`<span class="badge badge-green">${DCL.t("status.APPROVED")}</span>`, REJECTED:()=>`<span class="badge badge-red">${DCL.t("status.REJECTED")}</span>` };

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("actions.html", null);
  if (!insp) return;

  document.getElementById("filterStatus").addEventListener("change", renderTable);
  document.getElementById("confirmAssignBtn").addEventListener("click", confirmAssign);
  document.getElementById("confirmCompleteBtn").addEventListener("click", confirmComplete);
  document.getElementById("completePhoto").addEventListener("change", async function(){
    if (!this.files[0]) return;
    const url = await compressImage(this.files[0], 480, 0.6);
    document.getElementById("completePhoto").dataset.url = url;
    document.getElementById("completePhotoPreview").innerHTML = `<img src="${url}" style="max-width:120px;border-radius:8px;margin-top:6px;border:1px solid var(--border);"/>`;
  });
  wireKpiTileClicks();

  await loadAll();
});

async function loadAll(){
  [ALL_ACTIONS, ALL_PARTS, ALL_INSPECTORS] = await Promise.all([
    DCL.select("actions", q => q.order("created_at", {ascending:false})),
    DCL.select("parts", q => q.eq("is_deleted", false)),
    DCL.select("inspectors", q => q.eq("is_active", true).order("name"))
  ]);
  renderKpis();
  renderTable();
}

function renderKpis(){
  const today = DCL.today();
  const open = ALL_ACTIONS.filter(a=>a.status==="OPEN").length;
  const prog = ALL_ACTIONS.filter(a=>a.status==="IN_PROGRESS").length;
  const done = ALL_ACTIONS.filter(a=>a.status==="DONE").length;
  const rejected = ALL_ACTIONS.filter(a=>a.status==="REJECTED").length;
  const overdue = ALL_ACTIONS.filter(a=>["OPEN","IN_PROGRESS"].includes(a.status) && a.due_date && a.due_date < today).length;
  document.getElementById("kpiOpen").textContent = DCL.fmtCount(open);
  document.getElementById("kpiProgress").textContent = DCL.fmtCount(prog);
  document.getElementById("kpiDone").textContent = DCL.fmtCount(done);
  document.getElementById("kpiRejected").textContent = DCL.fmtCount(rejected);
  document.getElementById("kpiOverdue").textContent = DCL.fmtCount(overdue);
}

// 조치가 "기한초과"인지 여부: 아직 승인/반려로 끝나지 않은(OPEN/IN_PROGRESS) 건 중 기한이 지난 것.
// DONE(완료대기)은 이미 현장 조치는 끝난 상태라 기한초과 집계에서 제외한다(대시보드 KPI 계산과 동일 기준).
function isOverdue(a, today){
  return ["OPEN","IN_PROGRESS"].includes(a.status) && a.due_date && a.due_date < today;
}

function renderTable(){
  const status = document.getElementById("filterStatus").value;
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const today = DCL.today();

  let list = ALL_ACTIONS.slice();
  // "기한초과"는 실제 status 컬럼 값이 아니라 계산된 값이므로 별도로 필터링한다.
  // "ACTIVE"(기본값)는 승인완료(APPROVED) 건만 제외한 처리 필요 목록 - 승인완료 이력은
  // 점검 이력 조회 화면에서 확인 가능하므로 여기서는 기본적으로 숨긴다. 반려(REJECTED)는
  // 재조치가 필요한 미해결 상태이므로 계속 포함한다.
  if (status === "OVERDUE") list = list.filter(a=>isOverdue(a, today));
  else if (status === "ACTIVE") list = list.filter(a=>a.status !== "APPROVED");
  else if (status) list = list.filter(a=>a.status===status);

  const body = document.getElementById("actionsBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="7" class="empty-state">${DCL.t("page.actions.emptyList")}</td></tr>`; return; }

  body.innerHTML = list.map(a => {
    const p = partMap[a.part_id];
    const overdue = isOverdue(a, today);
    let actionsHtml = "";
    if (a.status === "OPEN") actionsHtml = `<button class="btn btn-sm btn-primary" onclick="openAssign('${a.id}')">${DCL.t("page.actions.btnAssign")}</button>`;
    else if (a.status === "IN_PROGRESS") actionsHtml = `<button class="btn btn-sm btn-success" onclick="openComplete('${a.id}')">${DCL.t("page.actions.btnComplete")}</button> <button class="btn btn-sm" onclick="openAssign('${a.id}')">${DCL.t("page.actions.btnReassign")}</button>`;
    else if (a.status === "DONE") actionsHtml = `<button class="btn btn-sm btn-primary" onclick="openReview('${a.id}')">${DCL.t("page.actions.btnReview")}</button>`;
    else if (a.status === "REJECTED") actionsHtml = `<button class="btn btn-sm" onclick="openAssign('${a.id}')">${DCL.t("page.actions.btnReassignAfterReject")}</button>`;
    else actionsHtml = `<span class="text-mute fs-xs">${DCL.t("page.actions.doneStatic")}</span>`;
    // 반려 후 재배정처럼 현재 상태만으로는 보이지 않는 지난 처리 이력(누가 언제 배정/완료/
    // 승인/반려했는지)을 언제든 확인할 수 있도록, 상태와 무관하게 "이력" 버튼을 항상 노출한다.
    actionsHtml += ` <button class="btn btn-sm" onclick="openHistory('${a.id}')" title="${DCL.t('page.actions.historyModalTitle')}">${DCL.t("page.actions.historyBtn")}</button>`;

    return `<tr id="actionRow-${a.id}">
      <td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td>
      <td style="max-width:220px;">${esc(a.issue_desc)}</td>
      <td>${SEV_BADGE[a.severity]?SEV_BADGE[a.severity]():a.severity}</td>
      <td class="text-mute">${a.assignee_id ? esc(inspMap[a.assignee_id]?.name||"-") : "-"}</td>
      <td class="${overdue?'text-red':'text-mute'}">${a.due_date ? DCL.fmtDate(a.due_date) : "-"}${overdue?' '+DCL.t("page.actions.overdueTag"):''}</td>
      <td>${STATUS_BADGE[a.status]?STATUS_BADGE[a.status]():a.status}</td>
      <td class="row-actions">${actionsHtml}</td>
    </tr>`;
  }).join("");

  focusRowFromUrl();
}

// ---- KPI 타일 클릭 → 해당 리스트 팝업 (대시보드 구축 원칙: 각 KPI는 클릭 가능해야 하며,
// 클릭 시 해당되는 리스트가 팝업으로 표시되어야 함) --------------------------------------
function wireKpiTileClicks(){
  document.querySelectorAll(".kpi-tile[data-kpi]").forEach(function(tile){
    tile.addEventListener("click", function(){ openKpiListModal(tile.dataset.kpi); });
  });
}

function openKpiListModal(kind){
  const today = DCL.today();
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));

  const titleKey = {
    OPEN: "page.actions.kpiOpen",
    IN_PROGRESS: "page.actions.kpiProgress",
    DONE: "page.actions.kpiDone",
    REJECTED: "page.actions.kpiRejected",
    OVERDUE: "page.actions.kpiOverdue"
  }[kind];

  const list = kind === "OVERDUE"
    ? ALL_ACTIONS.filter(a=>isOverdue(a, today))
    : ALL_ACTIONS.filter(a=>a.status===kind);

  const head = `<tr><th>${DCL.t("common.col.part")}</th><th>${DCL.t("page.actions.colIssue")}</th><th>${DCL.t("page.actions.colSeverity")}</th><th>${DCL.t("common.col.assignee")}</th><th>${DCL.t("common.col.dueDate")}</th><th>${DCL.t("common.col.status")}</th></tr>`;
  const rows = list.map(a => {
    const p = partMap[a.part_id];
    const overdue = isOverdue(a, today);
    return `<tr><td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td>
      <td style="max-width:220px;">${esc(a.issue_desc)}</td>
      <td>${SEV_BADGE[a.severity]?SEV_BADGE[a.severity]():a.severity}</td>
      <td class="text-mute">${a.assignee_id ? esc(inspMap[a.assignee_id]?.name||"-") : "-"}</td>
      <td class="${overdue?'text-red':'text-mute'}">${a.due_date ? DCL.fmtDate(a.due_date) : "-"}${overdue?' '+DCL.t("page.actions.overdueTag"):''}</td>
      <td>${STATUS_BADGE[a.status]?STATUS_BADGE[a.status]():a.status}</td>
    </tr>`;
  }).join("");

  document.getElementById("kpiListModalTitle").textContent = DCL.t(titleKey);
  document.getElementById("kpiListModalHead").innerHTML = head;
  document.getElementById("kpiListModalBody").innerHTML = rows || `<tr><td colspan="6" class="empty-state">${DCL.t("page.actions.emptyList")}</td></tr>`;
  DCL.openModal("kpiListModalOverlay");
}

// 대시보드 "오늘 내 할 일"의 조치/승인 카드에서 넘어온 경우(actions.html?focus=<action_id>),
// 해당 행으로 스크롤 + 하이라이트해 어떤 항목을 처리해야 하는지 바로 알 수 있게 한다.
function focusRowFromUrl(){
  const id = new URLSearchParams(location.search).get("focus");
  if (!id) return;
  const row = document.getElementById("actionRow-" + id);
  if (!row) return;
  row.scrollIntoView({ behavior:"smooth", block:"center" });
  row.classList.add("row-focus-highlight");
  setTimeout(() => row.classList.remove("row-focus-highlight"), 3000);
}

// ---- 담당자 지정 -------------------------------------------------------------
let TARGET_ACTION_ID = null;
function openAssign(id){
  TARGET_ACTION_ID = id;
  const a = ALL_ACTIONS.find(x=>x.id===id);
  document.getElementById("assignActionId").value = id;
  document.getElementById("assignAssignee").innerHTML = ALL_INSPECTORS.map(i=>`<option value="${i.id}" ${a.assignee_id===i.id?'selected':''}>${esc(i.name)}</option>`).join("");
  document.getElementById("assignSeverity").value = a.severity;
  document.getElementById("assignDue").value = a.due_date || "";
  DCL.openModal("assignModalOverlay");
}
async function confirmAssign(){
  const id = document.getElementById("assignActionId").value;
  const assignee = document.getElementById("assignAssignee").value;
  const severity = document.getElementById("assignSeverity").value;
  const due = document.getElementById("assignDue").value || null;
  const insp = DCL.getCurrentInspector();
  try{
    // p_by: 배정을 실행한 사람(migration_007) - action_history에 "누가 배정했는지" 남기기 위함
    await DCL.rpc("fn_assign_action", { p_action_id:id, p_assignee_id:assignee, p_due_date:due, p_severity:severity, p_by: insp.id });
    DCL.toast(DCL.t("page.actions.assignedToast"));
    DCL.closeModal("assignModalOverlay");
    await loadAll();
  }catch(e){}
}

// ---- 완료 등록 --------------------------------------------------------------
function openComplete(id){
  document.getElementById("completeActionId").value = id;
  document.getElementById("completeTaken").value = "";
  document.getElementById("completePhoto").value = "";
  document.getElementById("completePhoto").dataset.url = "";
  document.getElementById("completePhotoPreview").innerHTML = "";
  DCL.openModal("completeModalOverlay");
}
async function confirmComplete(){
  const id = document.getElementById("completeActionId").value;
  const taken = document.getElementById("completeTaken").value.trim();
  if (!taken) { DCL.toast(DCL.t("page.actions.enterActionTaken"), "err"); return; }
  const photoUrl = document.getElementById("completePhoto").dataset.url || null;
  const insp = DCL.getCurrentInspector();
  try{
    await DCL.rpc("fn_complete_action", { p_action_id:id, p_action_taken:taken, p_photo_url:photoUrl, p_by: insp.id });
    DCL.toast(DCL.t("page.actions.completedRegistered"));
    DCL.closeModal("completeModalOverlay");
    await loadAll();
  }catch(e){}
}

// ---- 승인/반려 --------------------------------------------------------------
function openReview(id){
  const a = ALL_ACTIONS.find(x=>x.id===id);
  const body = document.getElementById("reviewBody");
  body.innerHTML = `
    <div class="form-row"><label>${DCL.t("page.actions.issueLabel")}</label><div>${esc(a.issue_desc)}</div></div>
    <div class="form-row"><label>${DCL.t("page.actions.actionTakenViewLabel")}</label><div>${esc(a.action_taken||"-")}</div></div>
    ${a.action_photo_url ? `<div class="form-row"><label>${DCL.t("page.actions.photoViewLabel")}</label><img src="${a.action_photo_url}" style="max-width:220px;border-radius:8px;border:1px solid var(--border);"/></div>` : ""}
    <div class="form-row"><label>${DCL.t("page.actions.rejectReasonLabel")}</label><textarea id="reviewRejectReason" rows="2" placeholder="${DCL.t("page.actions.rejectReasonPlaceholder")}"></textarea></div>
    <div class="form-actions">
      <button class="btn btn-danger" id="rejectBtn">${DCL.t("common.reject")}</button>
      <button class="btn btn-success" id="approveBtn">${DCL.t("common.approve")}</button>
    </div>`;
  document.getElementById("approveBtn").addEventListener("click", ()=> review(id, true));
  document.getElementById("rejectBtn").addEventListener("click", ()=> review(id, false));
  DCL.openModal("reviewModalOverlay");
}
async function review(id, approve){
  const reason = document.getElementById("reviewRejectReason").value.trim();
  if (!approve && !reason) { DCL.toast(DCL.t("page.actions.enterRejectReason"), "err"); return; }
  const insp = DCL.getCurrentInspector();
  try{
    await DCL.rpc("fn_review_action", { p_action_id:id, p_approve:approve, p_by:insp.id, p_reject_reason: approve?null:reason });
    DCL.toast(approve ? DCL.t("page.actions.approvedToast") : DCL.t("page.actions.rejectedToast"));
    DCL.closeModal("reviewModalOverlay");
    await loadAll();
  }catch(e){}
}

// ---- 조치 처리 이력(배정/완료/승인/반려) 타임라인 -----------------------------------
async function openHistory(id){
  const body = document.getElementById("actionHistoryBody");
  body.innerHTML = `<div class="empty-state">${DCL.t("common.loading")}</div>`;
  DCL.openModal("historyModalOverlay");
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const rows = await DCL.select("action_history", q => q.eq("action_id", id));
  body.innerHTML = DCL.renderActionTimeline(rows, inspMap);
}

function compressImage(file, maxWidth, quality){
  return new Promise(function(resolve){
    const img = new Image(); const reader = new FileReader();
    reader.onload = function(e){
      img.onload = function(){
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width*scale; canvas.height = img.height*scale;
        canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
