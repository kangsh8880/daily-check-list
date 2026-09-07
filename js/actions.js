// ============================================================================
// 조치 관리 (2단계 승인형: 완료등록 -> 승인/반려)
// ============================================================================
let ALL_ACTIONS=[], ALL_PARTS=[], ALL_INSPECTORS=[];

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
  const overdue = ALL_ACTIONS.filter(a=>["OPEN","IN_PROGRESS"].includes(a.status) && a.due_date && a.due_date < today).length;
  document.getElementById("kpiOpen").textContent = DCL.fmtCount(open);
  document.getElementById("kpiProgress").textContent = DCL.fmtCount(prog);
  document.getElementById("kpiDone").textContent = DCL.fmtCount(done);
  document.getElementById("kpiOverdue").textContent = DCL.fmtCount(overdue);
}

function renderTable(){
  const status = document.getElementById("filterStatus").value;
  const partMap = Object.fromEntries(ALL_PARTS.map(p=>[p.id,p]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const today = DCL.today();

  let list = ALL_ACTIONS.slice();
  if (status) list = list.filter(a=>a.status===status);

  const sevBadge = { MINOR:`<span class="badge badge-gray">${DCL.t("sev.MINOR")}</span>`, MAJOR:`<span class="badge badge-yellow">${DCL.t("sev.MAJOR")}</span>`, CRITICAL:`<span class="badge badge-red">${DCL.t("sev.CRITICAL")}</span>` };
  const statusBadge = { OPEN:`<span class="badge badge-red">${DCL.t("status.OPEN")}</span>`, IN_PROGRESS:`<span class="badge badge-yellow">${DCL.t("status.IN_PROGRESS")}</span>`, DONE:`<span class="badge badge-blue">${DCL.t("status.DONE")}</span>`, APPROVED:`<span class="badge badge-green">${DCL.t("status.APPROVED")}</span>`, REJECTED:`<span class="badge badge-red">${DCL.t("status.REJECTED")}</span>` };

  const body = document.getElementById("actionsBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="7" class="empty-state">${DCL.t("page.actions.emptyList")}</td></tr>`; return; }

  body.innerHTML = list.map(a => {
    const p = partMap[a.part_id];
    const overdue = ["OPEN","IN_PROGRESS"].includes(a.status) && a.due_date && a.due_date < today;
    let actionsHtml = "";
    if (a.status === "OPEN") actionsHtml = `<button class="btn btn-sm btn-primary" onclick="openAssign('${a.id}')">${DCL.t("page.actions.btnAssign")}</button>`;
    else if (a.status === "IN_PROGRESS") actionsHtml = `<button class="btn btn-sm btn-success" onclick="openComplete('${a.id}')">${DCL.t("page.actions.btnComplete")}</button> <button class="btn btn-sm" onclick="openAssign('${a.id}')">${DCL.t("page.actions.btnReassign")}</button>`;
    else if (a.status === "DONE") actionsHtml = `<button class="btn btn-sm btn-primary" onclick="openReview('${a.id}')">${DCL.t("page.actions.btnReview")}</button>`;
    else if (a.status === "REJECTED") actionsHtml = `<button class="btn btn-sm" onclick="openAssign('${a.id}')">${DCL.t("page.actions.btnReassignAfterReject")}</button>`;
    else actionsHtml = `<span class="text-mute fs-xs">${DCL.t("page.actions.doneStatic")}</span>`;

    return `<tr>
      <td><b>${p?esc(p.part_name):"-"}</b><div class="text-mute mono fs-xs">${p?esc(p.part_code):""}</div></td>
      <td style="max-width:220px;">${esc(a.issue_desc)}</td>
      <td>${sevBadge[a.severity]||a.severity}</td>
      <td class="text-mute">${a.assignee_id ? esc(inspMap[a.assignee_id]?.name||"-") : "-"}</td>
      <td class="${overdue?'text-red':'text-mute'}">${a.due_date ? DCL.fmtDate(a.due_date) : "-"}${overdue?' '+DCL.t("page.actions.overdueTag"):''}</td>
      <td>${statusBadge[a.status]}</td>
      <td class="row-actions">${actionsHtml}</td>
    </tr>`;
  }).join("");
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
  try{
    await DCL.rpc("fn_assign_action", { p_action_id:id, p_assignee_id:assignee, p_due_date:due, p_severity:severity });
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
