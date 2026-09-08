// ============================================================================
// 문의사항(Q&A) - 역할 제한 없이 누구나 등록/답변 가능
// ============================================================================
let ALL_INQUIRIES=[], ALL_REPLIES=[], ALL_INSPECTORS=[];

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("inquiries.html", null);
  if (!insp) return;

  document.getElementById("newInquiryBtn").addEventListener("click", openNew);
  document.getElementById("submitNewBtn").addEventListener("click", submitNew);
  document.getElementById("filterStatus").addEventListener("change", renderTable);
  document.getElementById("filterCategory").addEventListener("change", renderTable);
  document.getElementById("searchInput").addEventListener("input", renderTable);

  await loadAll();
});

async function loadAll(){
  [ALL_INQUIRIES, ALL_REPLIES, ALL_INSPECTORS] = await Promise.all([
    DCL.select("inquiries", q => q.order("created_at", {ascending:false})),
    DCL.select("inquiry_replies", q => q.order("created_at", {ascending:true})),
    DCL.select("inspectors", q => q.eq("is_active", true).order("name"))
  ]);
  renderTable();
}

function categoryBadge(cat){
  const label = DCL.t("inquiry.category."+cat) || cat;
  return `<span class="badge badge-gray">${esc(label)}</span>`;
}
function statusBadge(st){
  const cls = { OPEN:"badge-red", ANSWERED:"badge-blue", CLOSED:"badge-green" }[st] || "badge-gray";
  return `<span class="badge ${cls}">${esc(DCL.t("inquiry.status."+st) || st)}</span>`;
}

function renderTable(){
  const status = document.getElementById("filterStatus").value;
  const category = document.getElementById("filterCategory").value;
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const replyCountMap = {};
  ALL_REPLIES.forEach(r => { replyCountMap[r.inquiry_id] = (replyCountMap[r.inquiry_id]||0) + 1; });

  let list = ALL_INQUIRIES.slice();
  if (status) list = list.filter(q=>q.status===status);
  if (category) list = list.filter(q=>q.category===category);
  if (kw) list = list.filter(q => String(q.title||"").toLowerCase().includes(kw) || String(q.content||"").toLowerCase().includes(kw));

  document.getElementById("resultSummary").textContent = DCL.t("page.inquiries.summary", {total: DCL.fmtCount(list.length)});

  const body = document.getElementById("inquiriesBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="7" class="empty-state">${DCL.t("page.inquiries.emptyList")}</td></tr>`; return; }

  body.innerHTML = list.map(q=>{
    const author = inspMap[q.author_id];
    return `<tr>
      <td>${statusBadge(q.status)}</td>
      <td>${categoryBadge(q.category)}</td>
      <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(q.title)}</td>
      <td class="text-mute">${esc(author?author.name:"-")}</td>
      <td class="text-mute">${DCL.fmtDateTime(q.created_at)}</td>
      <td class="text-mute">${DCL.fmtCount(replyCountMap[q.id]||0)}</td>
      <td><button class="btn btn-sm" onclick="showDetail('${q.id}')">${DCL.t("page.history.viewBtn")}</button></td>
    </tr>`;
  }).join("");
}

// ---- 새 문의 등록 -----------------------------------------------------------
function openNew(){
  document.getElementById("newCategory").value = "ETC";
  document.getElementById("newTitle").value = "";
  document.getElementById("newContent").value = "";
  DCL.openModal("newModalOverlay");
}
async function submitNew(){
  const title = document.getElementById("newTitle").value.trim();
  const content = document.getElementById("newContent").value.trim();
  const category = document.getElementById("newCategory").value;
  if (!title || !content) { DCL.toast(DCL.t("page.inquiries.enterTitleContent"), "err"); return; }
  const insp = DCL.getCurrentInspector();
  try{
    await DCL.rpc("fn_create_inquiry", { p_title:title, p_content:content, p_category:category, p_author_id:insp.id });
    DCL.toast(DCL.t("page.inquiries.registeredToast"));
    DCL.closeModal("newModalOverlay");
    await loadAll();
  }catch(e){}
}

// ---- 상세 / 답변 -------------------------------------------------------------
function showDetail(id){
  const q = ALL_INQUIRIES.find(x=>x.id===id);
  if (!q) return;
  const inspMap = Object.fromEntries(ALL_INSPECTORS.map(i=>[i.id,i]));
  const author = inspMap[q.author_id];
  const replies = ALL_REPLIES.filter(r=>r.inquiry_id===id);

  const replyRows = replies.map(r=>{
    const replier = inspMap[r.replier_id];
    return `<div class="inquiry-reply">
      <div class="flex-between"><b class="fs-xs">${esc(replier?replier.name:"-")}</b><span class="text-mute fs-xs">${DCL.fmtDateTime(r.created_at)}</span></div>
      <div class="fs-sm" style="margin-top:4px; white-space:pre-wrap;">${esc(r.content)}</div>
    </div>`;
  }).join("");

  const body = document.getElementById("detailBody");
  body.innerHTML = `
    <div class="flex-between" style="margin-bottom:8px;">
      <div>
        ${categoryBadge(q.category)} ${statusBadge(q.status)}
        <div class="fw-800 fs-md" style="margin-top:6px;">${esc(q.title)}</div>
      </div>
      <div class="text-mute fs-xs" style="text-align:right;">
        <div>${esc(author?author.name:"-")}</div>
        <div>${DCL.fmtDateTime(q.created_at)}</div>
      </div>
    </div>
    <div class="fs-sm" style="white-space:pre-wrap; padding:10px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border);">${esc(q.content)}</div>

    <div class="hint fs-xs fw-700" style="margin:12px 0 4px;">${DCL.t("page.inquiries.repliesTitle")} (${DCL.fmtCount(replies.length)})</div>
    <div id="replyList">${replyRows || `<div class="empty-state" style="padding:10px 0;">${DCL.t("page.inquiries.noReplyYet")}</div>`}</div>

    <div class="form-row mt-14 mb-0">
      <label>${DCL.t("page.inquiries.replyInputLabel")}</label>
      <textarea id="replyContent" rows="3" placeholder="${DCL.t("page.inquiries.replyPlaceholder")}"></textarea>
    </div>
    <div class="form-actions">
      ${q.status !== "CLOSED"
        ? `<button class="btn btn-sm" id="closeInquiryBtn">${DCL.t("page.inquiries.closeBtn")}</button>`
        : `<button class="btn btn-sm" id="reopenInquiryBtn">${DCL.t("page.inquiries.reopenBtn")}</button>`}
      <button class="btn btn-primary" id="submitReplyBtn">${DCL.t("page.inquiries.replyBtn")}</button>
    </div>
  `;
  document.getElementById("submitReplyBtn").addEventListener("click", ()=> submitReply(id));
  const closeBtn = document.getElementById("closeInquiryBtn");
  if (closeBtn) closeBtn.addEventListener("click", ()=> setStatus(id, "CLOSED"));
  const reopenBtn = document.getElementById("reopenInquiryBtn");
  if (reopenBtn) reopenBtn.addEventListener("click", ()=> setStatus(id, "OPEN"));

  DCL.openModal("detailModalOverlay");
}

async function submitReply(id){
  const content = document.getElementById("replyContent").value.trim();
  if (!content) { DCL.toast(DCL.t("page.inquiries.enterReplyContent"), "err"); return; }
  const insp = DCL.getCurrentInspector();
  try{
    await DCL.rpc("fn_reply_inquiry", { p_inquiry_id:id, p_content:content, p_replier_id:insp.id });
    DCL.toast(DCL.t("page.inquiries.replyRegisteredToast"));
    await loadAll();
    showDetail(id);
  }catch(e){}
}

async function setStatus(id, status){
  try{
    await DCL.rpc("fn_set_inquiry_status", { p_inquiry_id:id, p_status:status });
    DCL.toast(DCL.t("common.toast.saved"));
    await loadAll();
    showDetail(id);
  }catch(e){}
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
