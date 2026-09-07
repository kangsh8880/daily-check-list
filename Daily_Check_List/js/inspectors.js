// ============================================================================
// 점검자 관리
// ============================================================================
let ALL_INSPECTORS=[], ALL_ASSIGNMENTS=[];

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("inspectors.html", { roles:["admin"] });
  if (!insp) return;

  document.getElementById("addInspectorBtn").addEventListener("click", ()=>openModal(null));
  document.getElementById("saveInspBtn").addEventListener("click", save);

  await load();
});

async function load(){
  [ALL_INSPECTORS, ALL_ASSIGNMENTS] = await Promise.all([
    DCL.select("inspectors", q => q.eq("is_active", true).order("name")),
    DCL.select("assignments", q => q.eq("is_active", true))
  ]);
  const cntByInsp = {};
  ALL_ASSIGNMENTS.forEach(a => cntByInsp[a.inspector_id] = (cntByInsp[a.inspector_id]||0)+1);

  const roleLabel = { admin:'<span class="badge badge-blue">관리자</span>', action_owner:'<span class="badge badge-yellow">조치담당자</span>', inspector:'<span class="badge badge-gray">점검자</span>' };
  const body = document.getElementById("inspBody");
  if (!ALL_INSPECTORS.length) { body.innerHTML = '<tr><td colspan="7" class="empty-state">등록된 점검자가 없습니다</td></tr>'; return; }
  body.innerHTML = ALL_INSPECTORS.map(i => `
    <tr>
      <td><b>${esc(i.name)}</b></td>
      <td class="mono text-mute">${esc(i.emp_no||"-")}</td>
      <td class="text-mute">${esc(i.department||"-")}</td>
      <td>${roleLabel[i.role]||i.role}</td>
      <td>${i.pin ? '<span class="badge badge-gray">설정됨</span>' : '<span class="text-mute">-</span>'}</td>
      <td>${DCL.fmtCount(cntByInsp[i.id]||0)}건</td>
      <td class="row-actions">
        <button class="btn btn-sm" onclick='openModalById("${i.id}")'>수정</button>
        <button class="btn btn-sm btn-danger" onclick="del('${i.id}','${escAttr(i.name)}')">삭제</button>
      </td>
    </tr>`).join("");
}

function openModalById(id){ openModal(ALL_INSPECTORS.find(i=>i.id===id)); }
function openModal(i){
  document.getElementById("inspModalTitle").textContent = i ? "점검자 수정" : "점검자 등록";
  document.getElementById("inspId").value = i ? i.id : "";
  document.getElementById("inspName").value = i ? i.name : "";
  document.getElementById("inspEmpNo").value = i ? (i.emp_no||"") : "";
  document.getElementById("inspDept").value = i ? (i.department||"") : "";
  document.getElementById("inspRole").value = i ? i.role : "inspector";
  document.getElementById("inspPin").value = "";
  document.getElementById("inspPin").placeholder = i && i.pin ? "변경하려면 새 PIN 입력 (현재 설정됨)" : "미설정시 PIN없이 로그인";
  DCL.openModal("inspModalOverlay");
}

async function save(){
  const name = document.getElementById("inspName").value.trim();
  if (!name) { DCL.toast("이름은 필수입니다", "err"); return; }
  const id = document.getElementById("inspId").value || null;
  try{
    await DCL.rpc("fn_upsert_inspector", {
      p_id:id, p_emp_no: document.getElementById("inspEmpNo").value.trim() || null,
      p_name:name, p_department: document.getElementById("inspDept").value.trim() || null,
      p_role: document.getElementById("inspRole").value,
      p_pin: document.getElementById("inspPin").value.trim() || null
    });
    DCL.toast("저장되었습니다");
    DCL.closeModal("inspModalOverlay");
    await load();
  }catch(e){}
}

async function del(id, name){
  if (!confirm(`'${name}' 점검자를 삭제하시겠습니까?`)) return;
  try{
    await DCL.rpc("fn_delete_inspector", { p_id:id });
    DCL.toast("삭제되었습니다");
    await load();
  }catch(e){}
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escAttr(s){ return esc(s).replace(/"/g,"&quot;"); }
