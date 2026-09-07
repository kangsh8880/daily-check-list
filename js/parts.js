// ============================================================================
// 부품 마스터 관리
// ============================================================================
let ALL_TYPES=[], ALL_PARTS=[], ALL_INSPECTORS=[], ALL_ASSIGNMENTS=[];
let CURRENT_PART_ASSIGNS = [];

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("parts.html", { roles:["admin"] });
  if (!insp) return;

  document.getElementById("addPartBtn").addEventListener("click", ()=> openPartModal(null));
  document.getElementById("savePartBtn").addEventListener("click", savePart);
  document.getElementById("addAssignBtn").addEventListener("click", addAssignment);
  document.getElementById("filterType").addEventListener("change", renderTable);
  document.getElementById("filterStatus").addEventListener("change", renderTable);
  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("partCycleType").addEventListener("change", updateCycleBoxVisibility);

  await loadAll();
});

async function loadAll(){
  [ALL_TYPES, ALL_PARTS, ALL_INSPECTORS, ALL_ASSIGNMENTS] = await Promise.all([
    DCL.select("part_types", q => q.eq("is_active", true).order("type_name")),
    DCL.select("parts", q => q.eq("is_deleted", false).order("created_at", {ascending:false})),
    DCL.select("inspectors", q => q.eq("is_active", true).order("name")),
    DCL.select("assignments", q => q.eq("is_active", true))
  ]);

  const ft = document.getElementById("filterType");
  ft.innerHTML = `<option value="">${DCL.t("common.allTypes")}</option>` + ALL_TYPES.map(t=>`<option value="${t.id}">${esc(t.type_name)}</option>`).join("");

  const modalType = document.getElementById("partType");
  modalType.innerHTML = ALL_TYPES.map(t=>`<option value="${t.id}">${esc(t.type_name)} (${t.code_prefix})</option>`).join("");

  renderTable();
}

function renderTable(){
  const typeId = document.getElementById("filterType").value;
  const status = document.getElementById("filterStatus").value;
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();

  let list = ALL_PARTS.slice();
  if (typeId) list = list.filter(p=>p.part_type_id === typeId);
  if (status) list = list.filter(p=>p.status === status);
  if (kw) list = list.filter(p => p.part_name.toLowerCase().includes(kw) || p.part_code.toLowerCase().includes(kw));

  const typeMap = Object.fromEntries(ALL_TYPES.map(t=>[t.id,t]));
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const assignByPart = {};
  ALL_ASSIGNMENTS.forEach(a => { (assignByPart[a.part_id] = assignByPart[a.part_id]||[]).push(a.inspector_id); });

  const statusBadge = { IN_USE:`<span class="badge badge-blue">${DCL.t("common.status.inUse")}</span>`, STORAGE:`<span class="badge badge-gray">${DCL.t("common.status.storage")}</span>`, DISPOSED:`<span class="badge badge-red">${DCL.t("common.status.disposed")}</span>` };

  // 담당자 미배정 경고: 점검율 집계 대상인 "사용중" 부품 중 배정된 담당자가 없는 건수 (전체 기준, 필터와 무관)
  const unassignedInUseCnt = ALL_PARTS.filter(p => p.status === "IN_USE" && !(assignByPart[p.id]||[]).length).length;
  const hintEl = document.getElementById("unassignedHint");
  if (hintEl) hintEl.innerHTML = unassignedInUseCnt > 0
    ? `<span class="text-red fw-700">${DCL.t("page.parts.unassignedWarning", {n: unassignedInUseCnt})}</span>` : "";

  const body = document.getElementById("partsBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="10" class="empty-state">${DCL.t("page.parts.emptyList")}</td></tr>`; return; }

  body.innerHTML = list.map(p => {
    const t = typeMap[p.part_type_id];
    const names = (assignByPart[p.id]||[]).map(id => inspMap[id]?.name).filter(Boolean);
    const qrBadge = p.qr_issued_at ? `<span class="badge badge-green">v${p.qr_version}</span>` : `<span class="badge badge-yellow">${DCL.t("common.notIssued")}</span>`;
    // 사용중인데 담당자가 없으면 점검율 미이행 위험 -> 빨간 경고 배지. 보관중/폐기는 배정이 필요없으므로 회색 유지.
    const assignCell = names.length ? esc(names.join(", "))
      : (p.status === "IN_USE" ? `<span class="badge badge-red">${DCL.t("common.unassignedBadge")}</span>` : `<span class="badge badge-gray">${DCL.t("common.unassigned")}</span>`);
    return `<tr>
      <td class="mono"><b>${esc(p.part_code)}</b></td>
      <td>${esc(p.part_name)}</td>
      <td>${t ? esc(t.type_name) : "-"}</td>
      <td class="text-mute">${esc(p.location||"-")}</td>
      <td class="text-mute">${esc(p.department||"-")}</td>
      <td><span class="badge badge-blue">${esc(DCL.cycleLabel(p))}</span></td>
      <td>${statusBadge[p.status]||p.status}</td>
      <td class="text-mute" style="max-width:140px;">${assignCell}</td>
      <td>${qrBadge}</td>
      <td class="row-actions">
        <button class="btn btn-sm" onclick="openPartModalById('${p.id}')">${DCL.t("page.parts.editBtn")}</button>
        <a class="btn btn-sm" href="qr.html?part=${p.id}">QR</a>
        <button class="btn btn-sm btn-danger" onclick="deletePart('${p.id}','${escAttr(p.part_name)}')">${DCL.t("page.parts.deleteBtn")}</button>
      </td>
    </tr>`;
  }).join("");
}

function openPartModalById(id){ openPartModal(ALL_PARTS.find(p=>p.id===id)); }

function openPartModal(p){
  document.getElementById("partModalTitle").textContent = p ? DCL.t("page.parts.modalTitleEdit") : DCL.t("page.parts.modalTitleNew");
  document.getElementById("partId").value = p ? p.id : "";
  document.getElementById("partType").value = p ? p.part_type_id : (ALL_TYPES[0]?.id||"");
  document.getElementById("partType").disabled = !!p; // 유형은 등록 후 변경 불가(코드체계 유지)
  document.getElementById("partCodeView").value = p ? p.part_code : DCL.t("page.parts.codeViewPlaceholder");
  document.getElementById("partName").value = p ? p.part_name : "";
  document.getElementById("partSpec").value = p ? (p.spec||"") : "";
  document.getElementById("partLocation").value = p ? (p.location||"") : "";
  document.getElementById("partDept").value = p ? (p.department||"") : "";
  document.getElementById("partStatus").value = p ? p.status : "IN_USE";
  document.getElementById("partPurchaseDate").value = p ? (p.purchase_date||"") : "";

  document.getElementById("partCycleType").value = p ? (p.cycle_type||"DAILY") : "DAILY";
  const wdSet = new Set(p && Array.isArray(p.cycle_weekdays) ? p.cycle_weekdays : []);
  document.querySelectorAll(".cycle-wd").forEach(c => { c.checked = wdSet.has(Number(c.value)); });
  document.getElementById("partCycleDom").value = p ? (p.cycle_day_of_month || 1) : 1;
  updateCycleBoxVisibility();

  const box = document.getElementById("assignBox");
  const selInsp = document.getElementById("assignInspectorSelect");
  selInsp.innerHTML = ALL_INSPECTORS.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join("");

  if (p) {
    box.style.opacity = "1"; document.getElementById("addAssignBtn").disabled = false;
    CURRENT_PART_ASSIGNS = ALL_ASSIGNMENTS.filter(a=>a.part_id===p.id).map(a=>a.inspector_id);
  } else {
    box.style.opacity = ".5"; document.getElementById("addAssignBtn").disabled = true;
    CURRENT_PART_ASSIGNS = [];
  }
  renderAssignedChips(p ? p.id : null);
  DCL.openModal("partModalOverlay");
}

function updateCycleBoxVisibility(){
  const type = document.getElementById("partCycleType").value;
  document.getElementById("cycleWeeklyBox").style.display = (type === "WEEKLY") ? "" : "none";
  document.getElementById("cycleMonthlyBox").style.display = (type === "MONTHLY") ? "" : "none";
}

function readCycleFields(){
  const type = document.getElementById("partCycleType").value;
  const weekdays = type === "WEEKLY"
    ? Array.from(document.querySelectorAll(".cycle-wd:checked")).map(c=>Number(c.value))
    : null;
  const dom = type === "MONTHLY" ? Number(document.getElementById("partCycleDom").value || 1) : null;
  return { cycle_type: type, cycle_weekdays: weekdays, cycle_day_of_month: dom };
}

function renderAssignedChips(partId){
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const mount = document.getElementById("assignedList");
  if (!partId) { mount.innerHTML = `<span class="text-mute fs-xs">${DCL.t("page.parts.assignSaveHint")}</span>`; return; }
  if (!CURRENT_PART_ASSIGNS.length) { mount.innerHTML = `<span class="text-mute fs-xs">${DCL.t("page.parts.noAssignedYet")}</span>`; return; }
  mount.innerHTML = CURRENT_PART_ASSIGNS.map(id => {
    const name = inspMap[id]?.name || "?";
    return `<span class="badge badge-blue">${esc(name)} <span style="cursor:pointer; margin-left:4px;" onclick="removeAssignment('${partId}','${id}')">✕</span></span>`;
  }).join("");
}

async function addAssignment(){
  const partId = document.getElementById("partId").value;
  const inspectorId = document.getElementById("assignInspectorSelect").value;
  if (!partId || !inspectorId) return;
  if (CURRENT_PART_ASSIGNS.includes(inspectorId)) { DCL.toast(DCL.t("page.parts.alreadyAssignedToast"), "err"); return; }
  try{
    await DCL.rpc("fn_set_assignment", { p_part_id:partId, p_inspector_id:inspectorId, p_active:true });
    CURRENT_PART_ASSIGNS.push(inspectorId);
    renderAssignedChips(partId);
    ALL_ASSIGNMENTS.push({part_id:partId, inspector_id:inspectorId, is_active:true});
    renderTable();
    DCL.toast(DCL.t("page.parts.assignedToast"));
  }catch(e){}
}
async function removeAssignment(partId, inspectorId){
  try{
    await DCL.rpc("fn_set_assignment", { p_part_id:partId, p_inspector_id:inspectorId, p_active:false });
    CURRENT_PART_ASSIGNS = CURRENT_PART_ASSIGNS.filter(id=>id!==inspectorId);
    renderAssignedChips(partId);
    ALL_ASSIGNMENTS = ALL_ASSIGNMENTS.filter(a=>!(a.part_id===partId && a.inspector_id===inspectorId));
    renderTable();
    DCL.toast(DCL.t("page.parts.unassignedToast"));
  }catch(e){}
}

async function savePart(){
  const name = document.getElementById("partName").value.trim();
  const typeId = document.getElementById("partType").value;
  if (!name || !typeId) { DCL.toast(DCL.t("page.parts.requiredNameType"), "err"); return; }
  const id = document.getElementById("partId").value;
  const spec = document.getElementById("partSpec").value.trim();
  const location = document.getElementById("partLocation").value.trim();
  const dept = document.getElementById("partDept").value.trim();
  const status = document.getElementById("partStatus").value;
  const purchaseDate = document.getElementById("partPurchaseDate").value || null;
  if (!purchaseDate) { DCL.toast(DCL.t("page.parts.requiredPurchaseDate"), "err"); return; }
  const cycle = readCycleFields();
  if (cycle.cycle_type === "WEEKLY" && (!cycle.cycle_weekdays || !cycle.cycle_weekdays.length)) {
    DCL.toast(DCL.t("page.parts.weeklyDaysRequired"), "err"); return;
  }
  if (cycle.cycle_type === "MONTHLY" && (!cycle.cycle_day_of_month || cycle.cycle_day_of_month < 1 || cycle.cycle_day_of_month > 31)) {
    DCL.toast(DCL.t("page.parts.monthlyDayRequired"), "err"); return;
  }

  try{
    if (id) {
      await DCL.rpc("fn_update_part", { p_id:id, p_part_name:name, p_spec:spec, p_location:location, p_department:dept, p_status:status, p_purchase_date:purchaseDate,
        p_cycle_type: cycle.cycle_type, p_cycle_weekdays: cycle.cycle_weekdays, p_cycle_day_of_month: cycle.cycle_day_of_month });
      DCL.toast(DCL.t("page.parts.updatedToast"));
      DCL.closeModal("partModalOverlay");
      await loadAll();
    } else {
      const res = await DCL.rpc("fn_create_part", { p_part_name:name, p_part_type_id:typeId, p_spec:spec, p_location:location, p_department:dept, p_purchase_date:purchaseDate,
        p_cycle_type: cycle.cycle_type, p_cycle_weekdays: cycle.cycle_weekdays, p_cycle_day_of_month: cycle.cycle_day_of_month });
      const created = Array.isArray(res) ? res[0] : res;
      DCL.toast(DCL.t("page.parts.registeredToast", {code: created?.part_code || ""}));
      await loadAll();
      // 담당자 배정을 이어서 할 수 있도록 방금 등록한 부품으로 모달 재오픈
      const newPart = ALL_PARTS.find(p=>p.part_code === created?.part_code);
      if (newPart) openPartModal(newPart); else DCL.closeModal("partModalOverlay");
    }
  }catch(e){}
}

async function deletePart(id, name){
  if (!confirm(DCL.t("page.parts.confirmDelete", {name}))) return;
  try{
    await DCL.rpc("fn_delete_part", { p_id:id });
    DCL.toast(DCL.t("common.toast.deleted"));
    await loadAll();
  }catch(e){}
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escAttr(s){ return esc(s).replace(/"/g,"&quot;"); }
