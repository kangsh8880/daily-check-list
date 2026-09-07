// ============================================================================
// QR 발행 / 재발행 / 인쇄
// ============================================================================
let ALL_TYPES=[], ALL_PARTS=[];

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("qr.html", { roles:["admin"] });
  if (!insp) return;

  document.getElementById("filterType").addEventListener("change", renderTable);
  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("checkAll").addEventListener("change", function(e){
    document.querySelectorAll(".rowchk").forEach(c => c.checked = e.target.checked);
  });
  document.getElementById("selectAllBtn").addEventListener("click", function(){
    document.querySelectorAll(".rowchk").forEach(c => c.checked = true);
    document.getElementById("checkAll").checked = true;
  });
  document.getElementById("printSelectedBtn").addEventListener("click", printSelected);
  document.getElementById("confirmReissueBtn").addEventListener("click", confirmReissue);

  await loadAll();

  // parts.html 에서 QR 버튼으로 특정 부품 링크로 들어온 경우 자동 선택+인쇄영역 표시
  const params = new URLSearchParams(location.search);
  const focusId = params.get("part");
  if (focusId) {
    setTimeout(()=>{
      const chk = document.querySelector('.rowchk[data-id="'+focusId+'"]');
      if (chk) { chk.checked = true; printSelected(); }
    }, 300);
  }
});

function qrPayloadFor(code){
  const base = location.href.replace(/qr\.html.*$/, "inspect.html");
  return base + "?code=" + encodeURIComponent(code);
}

async function loadAll(){
  [ALL_TYPES, ALL_PARTS] = await Promise.all([
    DCL.select("part_types", q => q.eq("is_active", true).order("type_name")),
    DCL.select("parts", q => q.eq("is_deleted", false).order("created_at", {ascending:false}))
  ]);
  const ft = document.getElementById("filterType");
  ft.innerHTML = '<option value="">전체 유형</option>' + ALL_TYPES.map(t=>`<option value="${t.id}">${esc(t.type_name)}</option>`).join("");
  renderTable();
}

function renderTable(){
  const typeId = document.getElementById("filterType").value;
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  const typeMap = Object.fromEntries(ALL_TYPES.map(t=>[t.id,t]));

  let list = ALL_PARTS.slice();
  if (typeId) list = list.filter(p=>p.part_type_id===typeId);
  if (kw) list = list.filter(p=>p.part_name.toLowerCase().includes(kw)||p.part_code.toLowerCase().includes(kw));

  const body = document.getElementById("partsBody");
  if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="empty-state">부품이 없습니다</td></tr>'; return; }
  body.innerHTML = list.map(p => `
    <tr>
      <td><input type="checkbox" class="rowchk" data-id="${p.id}"/></td>
      <td class="mono"><b>${esc(p.part_code)}</b></td>
      <td>${esc(p.part_name)}</td>
      <td class="text-mute">${esc(typeMap[p.part_type_id]?.type_name||"-")}</td>
      <td><span class="badge ${p.qr_issued_at?'badge-green':'badge-yellow'}">v${p.qr_version}</span></td>
      <td class="text-mute">${p.qr_issued_at ? DCL.fmtDate(p.qr_issued_at) : "미발행"}</td>
      <td class="row-actions">
        <button class="btn btn-sm" onclick="previewOne('${p.id}')">미리보기</button>
        <button class="btn btn-sm btn-danger" onclick="openReissue('${p.id}')">재발행</button>
      </td>
    </tr>`).join("");
}

async function previewOne(id){
  document.querySelectorAll(".rowchk").forEach(c=>c.checked=false);
  const chk = document.querySelector('.rowchk[data-id="'+id+'"]');
  if (chk) chk.checked = true;
  await printSelected();
}

async function printSelected(){
  const ids = Array.from(document.querySelectorAll(".rowchk:checked")).map(c=>c.dataset.id);
  const area = document.getElementById("printArea");
  if (!ids.length) { area.innerHTML = '<div class="empty-state no-print">인쇄할 부품을 선택 후 다시 시도하세요</div>'; return; }
  const selected = ALL_PARTS.filter(p=>ids.includes(p.id));

  area.innerHTML = selected.map(p => `
    <div class="print-label">
      <canvas id="qrc-${p.id}"></canvas>
      <div class="code">${esc(p.part_code)}</div>
      <div class="name">${esc(p.part_name)}</div>
    </div>`).join("");

  for (const p of selected) {
    // 최초 발행 시각 기록 (이미 발행된 경우 서버측에서 무시됨)
    if (!p.qr_issued_at) { try{ await DCL.rpc("fn_issue_qr", { p_part_id: p.id }); }catch(e){} }
    const canvas = document.getElementById("qrc-"+p.id);
    if (window.QRCode && canvas) {
      QRCode.toCanvas(canvas, qrPayloadFor(p.part_code), { width:150, margin:1, color:{dark:"#000000", light:"#ffffff"} });
    }
  }
}

let REISSUE_TARGET = null;
async function openReissue(id){
  REISSUE_TARGET = ALL_PARTS.find(p=>p.id===id);
  if (!REISSUE_TARGET) return;
  document.getElementById("reissuePartId").value = id;
  document.getElementById("reissueTarget").textContent = `${REISSUE_TARGET.part_code} · ${REISSUE_TARGET.part_name} (현재 v${REISSUE_TARGET.qr_version})`;
  document.getElementById("reissueReason").value = "";
  const logs = await DCL.select("qr_reissue_log", q => q.eq("part_id", id).order("reissued_at", {ascending:false}));
  const hist = document.getElementById("reissueHistory");
  if (!logs.length) { hist.innerHTML = '<div class="empty-state" style="padding:14px;">재발행 이력이 없습니다</div>'; }
  else {
    hist.innerHTML = '<table><thead><tr><th>버전</th><th>일시</th><th>사유</th></tr></thead><tbody>' +
      logs.map(l=>`<tr><td>v${l.qr_version}</td><td class="text-mute">${DCL.fmtDateTime(l.reissued_at)}</td><td>${esc(l.reason||"-")}</td></tr>`).join("") +
      '</tbody></table>';
  }
  DCL.openModal("reissueModalOverlay");
}

async function confirmReissue(){
  const id = document.getElementById("reissuePartId").value;
  const reason = document.getElementById("reissueReason").value.trim();
  if (!reason) { DCL.toast("재발행 사유를 입력하세요", "err"); return; }
  const insp = DCL.getCurrentInspector();
  try{
    await DCL.rpc("fn_reissue_qr", { p_part_id:id, p_reason:reason, p_by: insp?.id||null });
    DCL.toast("QR이 재발행되었습니다. 새 라벨을 인쇄해 교체하세요.");
    DCL.closeModal("reissueModalOverlay");
    await loadAll();
    document.querySelector('.rowchk[data-id="'+id+'"]').checked = true;
    await printSelected();
  }catch(e){}
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
