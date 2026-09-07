// ============================================================================
// 부품유형 / 점검항목 템플릿 관리
// ============================================================================
let ALL_TYPES = [];

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("types.html", { roles:["admin"] });
  if (!insp) return;

  document.querySelectorAll(".tab").forEach(function(tab){
    tab.addEventListener("click", function(){
      document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.dataset.tab;
      document.getElementById("tabTypes").style.display = which === "types" ? "block" : "none";
      document.getElementById("tabTemplates").style.display = which === "templates" ? "block" : "none";
      if (which === "templates") loadTypesIntoTemplateSelect();
    });
  });

  document.getElementById("addTypeBtn").addEventListener("click", ()=> openTypeModal(null));
  document.getElementById("saveTypeBtn").addEventListener("click", saveType);
  document.getElementById("addItemBtn").addEventListener("click", ()=> openItemModal(null));
  document.getElementById("saveItemBtn").addEventListener("click", saveItem);
  document.getElementById("itemJudgeType").addEventListener("change", toggleJudgeFields);
  document.getElementById("templateTypeSelect").addEventListener("change", loadItemsForSelectedType);

  await loadTypes();
});

async function loadTypes(){
  ALL_TYPES = await DCL.select("part_types", q => q.eq("is_active", true).order("type_name"));
  const items = await DCL.select("checklist_templates", q => q.eq("is_active", true));
  const countByType = {};
  items.forEach(i => countByType[i.part_type_id] = (countByType[i.part_type_id]||0) + 1);

  const body = document.getElementById("typesBody");
  if (!ALL_TYPES.length) { body.innerHTML = `<tr><td colspan="5" class="empty-state">${DCL.t("page.types.emptyTypes")}</td></tr>`; return; }
  body.innerHTML = ALL_TYPES.map(t => `
    <tr>
      <td><span class="badge badge-blue mono">${t.code_prefix}</span></td>
      <td><b>${esc(t.type_name)}</b></td>
      <td class="text-mute">${esc(t.description||"-")}</td>
      <td>${DCL.fmtCount(countByType[t.id]||0)}</td>
      <td class="row-actions">
        <button class="btn btn-sm" onclick='openTypeModal(${JSON.stringify(t).replace(/'/g,"&apos;")})'>${DCL.t("common.edit")}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteType('${t.id}','${escAttr(t.type_name)}')">${DCL.t("common.delete")}</button>
      </td>
    </tr>`).join("");
}

function openTypeModal(t){
  document.getElementById("typeModalTitle").textContent = t ? DCL.t("page.types.typeModalTitleEdit") : DCL.t("page.types.typeModalTitleNew");
  document.getElementById("typeId").value = t ? t.id : "";
  document.getElementById("typeName").value = t ? t.type_name : "";
  document.getElementById("typeCodePrefix").value = t ? t.code_prefix : "";
  document.getElementById("typeDesc").value = t ? (t.description||"") : "";
  DCL.openModal("typeModalOverlay");
}

async function saveType(){
  const name = document.getElementById("typeName").value.trim();
  const prefix = document.getElementById("typeCodePrefix").value.trim().toUpperCase();
  if (!name || !prefix) { DCL.toast(DCL.t("page.types.requiredNamePrefix"), "err"); return; }
  const id = document.getElementById("typeId").value || null;
  try{
    await DCL.rpc("fn_upsert_part_type", { p_id:id, p_type_name:name, p_code_prefix:prefix, p_description: document.getElementById("typeDesc").value.trim() });
    DCL.toast(DCL.t("common.toast.saved"));
    DCL.closeModal("typeModalOverlay");
    await loadTypes();
  }catch(e){}
}

async function deleteType(id, name){
  if (!confirm(DCL.t("page.types.confirmDeleteType", {name}))) return;
  try{
    await DCL.rpc("fn_delete_part_type", { p_id:id });
    DCL.toast(DCL.t("common.toast.deleted"));
    await loadTypes();
  }catch(e){}
}

// ---- 점검항목 템플릿 -------------------------------------------------------
function loadTypesIntoTemplateSelect(){
  const sel = document.getElementById("templateTypeSelect");
  sel.innerHTML = ALL_TYPES.map(t => `<option value="${t.id}">${esc(t.type_name)} (${t.code_prefix})</option>`).join("");
  DCL.autoSelectFirst(sel);
  loadItemsForSelectedType();
}

let CURRENT_ITEMS = [];
async function loadItemsForSelectedType(){
  const typeId = document.getElementById("templateTypeSelect").value;
  const body = document.getElementById("itemsBody");
  if (!typeId) { body.innerHTML = `<tr><td colspan="6" class="empty-state">${DCL.t("page.types.selectTypeFirst")}</td></tr>`; return; }
  CURRENT_ITEMS = await DCL.select("checklist_templates", q => q.eq("part_type_id", typeId).eq("is_active", true).order("item_order"));
  if (!CURRENT_ITEMS.length) { body.innerHTML = `<tr><td colspan="6" class="empty-state">${DCL.t("page.types.emptyItems")}</td></tr>`; return; }
  const judgeLabel = {OX: DCL.t("judge.short.OX"), NUMERIC: DCL.t("judge.short.NUMERIC"), SELECT: DCL.t("judge.short.SELECT")};
  body.innerHTML = CURRENT_ITEMS.map(it => `
    <tr>
      <td>${it.item_order}</td>
      <td><b>${esc(it.item_name)}</b></td>
      <td><span class="badge badge-gray">${judgeLabel[it.judge_type]}</span></td>
      <td class="text-mute">${judgeDesc(it)}</td>
      <td>${it.photo_required ? `<span class="badge badge-yellow">${DCL.t("common.required")}</span>` : '<span class="text-mute">-</span>'}</td>
      <td class="row-actions">
        <button class="btn btn-sm" onclick='openItemModal(${JSON.stringify(it).replace(/'/g,"&apos;")})'>${DCL.t("common.edit")}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteItem('${it.id}')">${DCL.t("common.delete")}</button>
      </td>
    </tr>`).join("");
}
function judgeDesc(it){
  if (it.judge_type === "NUMERIC") return `${it.lower_limit ?? "-"} ~ ${it.upper_limit ?? "-"} ${it.unit||""}`;
  if (it.judge_type === "SELECT") return esc(it.select_options||"-");
  return DCL.t("common.normalSlashAbnormal");
}

function toggleJudgeFields(){
  const jt = document.getElementById("itemJudgeType").value;
  document.getElementById("numericFields").style.display = jt === "NUMERIC" ? "grid" : "none";
  document.getElementById("selectFields").style.display = jt === "SELECT" ? "block" : "none";
}

function openItemModal(it){
  document.getElementById("itemModalTitle").textContent = it ? DCL.t("page.types.itemModalTitleEdit") : DCL.t("page.types.itemModalTitleNew");
  document.getElementById("itemId").value = it ? it.id : "";
  document.getElementById("itemOrder").value = it ? it.item_order : (CURRENT_ITEMS.length+1);
  document.getElementById("itemName").value = it ? it.item_name : "";
  document.getElementById("itemJudgeType").value = it ? it.judge_type : "OX";
  document.getElementById("itemUnit").value = it ? (it.unit||"") : "";
  document.getElementById("itemLower").value = it ? (it.lower_limit ?? "") : "";
  document.getElementById("itemUpper").value = it ? (it.upper_limit ?? "") : "";
  document.getElementById("itemSelectOptions").value = it ? (it.select_options||"") : "";
  document.getElementById("itemPhotoRequired").checked = it ? !!it.photo_required : false;
  toggleJudgeFields();
  DCL.openModal("itemModalOverlay");
}

async function saveItem(){
  const typeId = document.getElementById("templateTypeSelect").value;
  if (!typeId) { DCL.toast(DCL.t("page.types.selectTypeFirstToast"), "err"); return; }
  const name = document.getElementById("itemName").value.trim();
  if (!name) { DCL.toast(DCL.t("page.types.itemNameRequired"), "err"); return; }
  const id = document.getElementById("itemId").value || null;
  const jt = document.getElementById("itemJudgeType").value;
  try{
    await DCL.rpc("fn_upsert_checklist_item", {
      p_id:id, p_part_type_id: typeId,
      p_item_order: Number(document.getElementById("itemOrder").value)||1,
      p_item_name: name, p_judge_type: jt,
      p_unit: document.getElementById("itemUnit").value.trim() || null,
      p_lower: document.getElementById("itemLower").value === "" ? null : Number(document.getElementById("itemLower").value),
      p_upper: document.getElementById("itemUpper").value === "" ? null : Number(document.getElementById("itemUpper").value),
      p_select_options: document.getElementById("itemSelectOptions").value.trim() || null,
      p_photo_required: document.getElementById("itemPhotoRequired").checked
    });
    DCL.toast(DCL.t("common.toast.saved"));
    DCL.closeModal("itemModalOverlay");
    await loadItemsForSelectedType();
  }catch(e){}
}

async function deleteItem(id){
  if (!confirm(DCL.t("page.types.confirmDeleteItem"))) return;
  try{
    await DCL.rpc("fn_delete_checklist_item", { p_id:id });
    DCL.toast(DCL.t("common.toast.deleted"));
    await loadItemsForSelectedType();
  }catch(e){}
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escAttr(s){ return esc(s).replace(/"/g,"&quot;"); }
