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
      document.getElementById("tabRecommend").style.display = which === "recommend" ? "block" : "none";
      if (which === "templates") loadTypesIntoTemplateSelect();
      if (which === "recommend") loadTypesIntoRecommendSelect();
    });
  });

  document.getElementById("addTypeBtn").addEventListener("click", ()=> openTypeModal(null));
  document.getElementById("saveTypeBtn").addEventListener("click", saveType);
  document.getElementById("addItemBtn").addEventListener("click", ()=> openItemModal(null));
  document.getElementById("saveItemBtn").addEventListener("click", saveItem);
  document.getElementById("itemJudgeType").addEventListener("change", toggleJudgeFields);
  document.getElementById("templateTypeSelect").addEventListener("change", loadItemsForSelectedType);
  document.getElementById("recommendTypeSelect").addEventListener("change", renderRecommendations);
  document.getElementById("recommendRefreshBtn").addEventListener("click", renderRecommendations);
  document.getElementById("recommendAddAllBtn").addEventListener("click", addAllRecommendations);

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
  const wasNew = !id; // 신규 등록인지(수정이 아닌지) - 등록 완료 직후 "점검항목 추천" 탭 자동 전환 여부 판단용
  try{
    const newId = await DCL.rpc("fn_upsert_part_type", { p_id:id, p_type_name:name, p_code_prefix:prefix, p_description: document.getElementById("typeDesc").value.trim() });
    DCL.toast(DCL.t("common.toast.saved"));
    DCL.closeModal("typeModalOverlay");
    await loadTypes();
    if (wasNew && newId) switchToRecommendTab(newId, name);
  }catch(e){}
}

// 신규 부품유형 등록 완료 직후, "점검항목 추천" 탭으로 자동 전환하고 방금 등록한 유형을
// 미리 선택해둔 뒤 배너로 안내한다 (사용자가 바로 추천 TOP5를 확인/추가할 수 있도록).
function switchToRecommendTab(typeId, typeName){
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  const recTab = document.querySelector('.tab[data-tab="recommend"]');
  if (recTab) recTab.classList.add("active");
  document.getElementById("tabTypes").style.display = "none";
  document.getElementById("tabTemplates").style.display = "none";
  document.getElementById("tabRecommend").style.display = "block";

  const banner = document.getElementById("recommendBanner");
  banner.textContent = DCL.t("page.types.recommendBannerText", { name: typeName });
  banner.style.display = "block";

  loadTypesIntoRecommendSelect(typeId);
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

// ---- 점검항목 추천 ----------------------------------------------------------
// DCL.TypeRecommend(js/type-recommend.js)가 실제 매칭/AI 호출을 담당하고, 이 파일은
// 화면 렌더링과 "추가" 동작(기존 fn_upsert_checklist_item RPC 재사용)만 담당한다.
let RECOMMEND_CURRENT_ITEMS = [];
let RECOMMEND_LAST_TYPE_ID = null;
let RECOMMEND_LAST_RESULT = null;

function loadTypesIntoRecommendSelect(preselectId){
  const sel = document.getElementById("recommendTypeSelect");
  sel.innerHTML = ALL_TYPES.map(t => `<option value="${t.id}">${esc(t.type_name)} (${t.code_prefix})</option>`).join("");
  if (preselectId) sel.value = preselectId;
  else DCL.autoSelectFirst(sel);
  renderRecommendations();
}

async function renderRecommendations(){
  const typeId = document.getElementById("recommendTypeSelect").value;
  const body = document.getElementById("recommendBody");
  const meta = document.getElementById("recommendMeta");
  if (!typeId) { body.innerHTML = `<tr><td colspan="7" class="empty-state">${DCL.t("page.types.recommendSelectFirst")}</td></tr>`; meta.innerHTML = ""; return; }
  const t = ALL_TYPES.find(x => x.id === typeId);
  if (!t) return;

  body.innerHTML = `<tr><td colspan="7" class="empty-state">${DCL.t("common.loading")}</td></tr>`;
  meta.innerHTML = "";

  RECOMMEND_CURRENT_ITEMS = await DCL.select("checklist_templates", q => q.eq("part_type_id", typeId).eq("is_active", true));
  const existingNames = new Set(RECOMMEND_CURRENT_ITEMS.map(i => i.item_name));

  const result = await DCL.TypeRecommend.get(t.type_name, t.code_prefix, t.description);
  RECOMMEND_LAST_TYPE_ID = typeId;
  RECOMMEND_LAST_RESULT = result;

  meta.innerHTML = renderRecommendMeta(result);

  if (result.source === "ai_failed") {
    body.innerHTML = `<tr><td colspan="7"><div class="fs-sm" style="color:var(--accent-red); padding:10px 0;">
      ${DCL.t("page.types.recommendAIFailed")}
      <button class="btn btn-sm" onclick="renderRecommendations()">${DCL.t("page.types.recommendAIRetryBtn")}</button>
    </div></td></tr>`;
    return;
  }

  const judgeLabel = {OX: DCL.t("judge.short.OX"), NUMERIC: DCL.t("judge.short.NUMERIC"), SELECT: DCL.t("judge.short.SELECT")};
  body.innerHTML = result.items.map((it, idx) => {
    const already = existingNames.has(it.item_name);
    return `<tr>
      <td>${idx+1}</td>
      <td><b>${esc(it.item_name)}</b></td>
      <td><span class="badge badge-gray">${judgeLabel[it.judge_type]}</span></td>
      <td class="text-mute">${recommendJudgeDesc(it)}</td>
      <td>${it.photo_required ? `<span class="badge badge-yellow">${DCL.t("common.required")}</span>` : '<span class="text-mute">-</span>'}</td>
      <td class="text-mute fs-xs" style="max-width:260px;">${esc(it.reason||"-")}</td>
      <td class="row-actions">${already
        ? `<span class="badge badge-green">${DCL.t("page.types.recommendAddedBadge")}</span>`
        : `<button class="btn btn-sm btn-primary" onclick="addRecommendedItem(${idx})">${DCL.t("page.types.recommendAddBtn")}</button>`}</td>
    </tr>`;
  }).join("");
}

function renderRecommendMeta(result){
  if (result.source === "library") {
    return `<span class="badge badge-blue">${DCL.t("page.types.recommendSourceLibrary")}</span> `
      + `<span class="text-mute fs-xs">${DCL.t("page.types.recommendCategoryLabel")}: ${esc(result.category)}</span>`;
  }
  if (result.source === "ai") {
    return `<span class="badge badge-green">${DCL.t("page.types.recommendSourceAI")}</span>`;
  }
  if (result.source === "fallback") {
    return `<span class="badge badge-gray">${DCL.t("page.types.recommendSourceFallback")}</span> `
      + `<span class="text-mute fs-xs">${DCL.t("page.types.recommendAINotConfigured")}</span>`;
  }
  return "";
}

function recommendJudgeDesc(it){
  if (it.judge_type === "NUMERIC") return `${it.lower_limit ?? "-"} ~ ${it.upper_limit ?? "-"} ${it.unit||""}`;
  if (it.judge_type === "SELECT") return esc(it.select_options||"-");
  return DCL.t("common.normalSlashAbnormal");
}

async function addRecommendedItem(idx){
  if (!RECOMMEND_LAST_RESULT || !RECOMMEND_LAST_TYPE_ID) return;
  const it = RECOMMEND_LAST_RESULT.items[idx];
  if (!it) return;
  const nextOrder = RECOMMEND_CURRENT_ITEMS.length + 1;
  try{
    await DCL.rpc("fn_upsert_checklist_item", {
      p_id: null, p_part_type_id: RECOMMEND_LAST_TYPE_ID, p_item_order: nextOrder,
      p_item_name: it.item_name, p_judge_type: it.judge_type,
      p_unit: it.unit || null, p_lower: it.lower_limit ?? null, p_upper: it.upper_limit ?? null,
      p_select_options: it.select_options || null, p_photo_required: !!it.photo_required
    });
    DCL.toast(DCL.t("page.types.recommendAddedToast"));
    await renderRecommendations();
  }catch(e){}
}

async function addAllRecommendations(){
  if (!RECOMMEND_LAST_RESULT || !RECOMMEND_LAST_TYPE_ID) return;
  const existingNames = new Set(RECOMMEND_CURRENT_ITEMS.map(i => i.item_name));
  const toAdd = RECOMMEND_LAST_RESULT.items.filter(it => !existingNames.has(it.item_name));
  if (!toAdd.length) { DCL.toast(DCL.t("page.types.recommendAllAdded")); return; }
  if (!confirm(DCL.t("page.types.recommendAddAllConfirm"))) return;
  let order = RECOMMEND_CURRENT_ITEMS.length + 1;
  try{
    for (const it of toAdd) {
      await DCL.rpc("fn_upsert_checklist_item", {
        p_id: null, p_part_type_id: RECOMMEND_LAST_TYPE_ID, p_item_order: order++,
        p_item_name: it.item_name, p_judge_type: it.judge_type,
        p_unit: it.unit || null, p_lower: it.lower_limit ?? null, p_upper: it.upper_limit ?? null,
        p_select_options: it.select_options || null, p_photo_required: !!it.photo_required
      });
    }
    DCL.toast(DCL.t("common.toast.saved"));
    await renderRecommendations();
  }catch(e){}
}
