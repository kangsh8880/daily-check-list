// ============================================================================
// 다국어 관리 (문장키/화면/언어별 번역문 조회 · 수정 · 기본값 초기화)
// SEED(하드코딩 기본값) + Supabase i18n_strings 테이블(override) 병합 표시
// ============================================================================
let OVERRIDES_BY_KEY = {};
let ROWS = [];

const CATEGORY_LABEL_KEY = {
  dashboard: "nav.dashboard",
  inspect: "nav.inspect",
  actions: "nav.actions",
  parts: "nav.parts",
  qr: "nav.qr",
  types: "nav.types",
  inspectors: "nav.inspectors",
  history: "nav.history",
  inquiries: "nav.inquiries",
  i18nAdmin: "nav.i18n",
  ai: "ai.title"
};

document.addEventListener("DOMContentLoaded", async function(){
  const insp = DCL.initPage("i18n-admin.html", { roles:["admin"] });
  if (!insp) return;

  buildLangFilterOptions();
  buildCategoryFilterOptions();

  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("filterLang").addEventListener("change", renderTable);
  document.getElementById("filterCategory").addEventListener("change", renderTable);

  await loadOverrides();
  buildRows();
  renderTable();
});

function buildLangFilterOptions(){
  const sel = document.getElementById("filterLang");
  sel.innerHTML = [
    `<option value="">${DCL.t("page.i18nAdmin.langFilterAll")}</option>`,
    `<option value="en">English</option>`,
    `<option value="vi">Tiếng Việt</option>`
  ].join("");
}

function buildCategoryFilterOptions(){
  const sel = document.getElementById("filterCategory");
  const cats = Array.from(new Set(Object.values(DCL.I18N_SEED.category))).sort();
  sel.innerHTML = [`<option value="">${DCL.t("page.i18nAdmin.categoryFilterAll")}</option>`]
    .concat(cats.map(c => `<option value="${c}">${esc(categoryLabel(c))}</option>`)).join("");
}

function categoryLabel(cat){
  if (cat === "common") return DCL.t("page.i18nAdmin.categoryCommon");
  if (cat === "index") return DCL.t("page.i18nAdmin.categoryIndex");
  const key = CATEGORY_LABEL_KEY[cat];
  return key ? DCL.t(key) : cat;
}

async function loadOverrides(){
  const rows = await DCL.select("i18n_strings");
  OVERRIDES_BY_KEY = {};
  (rows||[]).forEach(r => { OVERRIDES_BY_KEY[r.str_key] = r; });
}

function buildRows(){
  const koSeed = DCL.I18N_SEED.ko;
  const enSeed = DCL.I18N_SEED.en;
  const viSeed = DCL.I18N_SEED.vi;
  const catMap = DCL.I18N_SEED.category;
  const keys = Object.keys(koSeed).sort();
  ROWS = [];
  keys.forEach(key => {
    const cat = catMap[key] || "common";
    const base = koSeed[key];
    const ov = OVERRIDES_BY_KEY[key];
    [["en", enSeed[key]], ["vi", viSeed[key]]].forEach(([lang, seedVal]) => {
      const translated = (ov && ov[lang]) ? ov[lang] : seedVal;
      const isOverridden = !!(ov && ov[lang] && ov[lang] !== seedVal);
      ROWS.push({ key, category: cat, base, lang, seedVal, translated, isOverridden });
    });
  });
}

function renderTable(){
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  const langFilter = document.getElementById("filterLang").value;
  const catFilter = document.getElementById("filterCategory").value;

  let list = ROWS.slice();
  if (langFilter) list = list.filter(r => r.lang === langFilter);
  if (catFilter) list = list.filter(r => r.category === catFilter);
  if (kw) list = list.filter(r => r.key.toLowerCase().includes(kw) || r.base.toLowerCase().includes(kw) || (r.translated||"").toLowerCase().includes(kw));

  document.getElementById("summaryHint").textContent = DCL.t("page.i18nAdmin.summary", { n: DCL.fmtCount(list.length) });

  const body = document.getElementById("rowsBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="empty-state">${DCL.t("page.i18nAdmin.emptyList")}</td></tr>`; return; }

  body.innerHTML = list.map((r, idx) => `
    <tr>
      <td class="mono text-mute fs-xs">${esc(r.key)}</td>
      <td>${esc(r.base)}</td>
      <td><span class="badge badge-blue">${r.lang === "en" ? "EN" : "VI"}</span></td>
      <td><input type="text" class="i18n-edit-input" data-key="${escAttr(r.key)}" data-lang="${r.lang}" value="${escAttr(r.translated)}" style="width:100%; ${r.isOverridden ? 'border-color:var(--text);' : ''}"/></td>
      <td class="text-mute fs-xs">${esc(categoryLabel(r.category))}</td>
      <td class="row-actions">
        <button class="btn btn-sm" onclick="saveRow(this)">${DCL.t("page.i18nAdmin.saveBtn")}</button>
        <button class="btn btn-sm" onclick="resetRow(this,'${escAttr(r.key)}','${r.lang}')">${DCL.t("page.i18nAdmin.resetBtn")}</button>
      </td>
    </tr>`).join("");
}

async function saveRow(btnEl){
  const row = btnEl.closest("tr");
  const input = row.querySelector(".i18n-edit-input");
  const key = input.dataset.key;
  const lang = input.dataset.lang;
  const text = input.value;
  try{
    await DCL.rpc("fn_update_i18n_lang", { p_key: key, p_lang: lang, p_text: text });
    OVERRIDES_BY_KEY[key] = OVERRIDES_BY_KEY[key] || { str_key: key };
    OVERRIDES_BY_KEY[key][lang] = text;
    DCL.toast(DCL.t("page.i18nAdmin.savedToast"));
    buildRows();
    renderTable();
  }catch(e){}
}

async function resetRow(btnEl, key, lang){
  const seedVal = lang === "en" ? DCL.I18N_SEED.en[key] : DCL.I18N_SEED.vi[key];
  try{
    await DCL.rpc("fn_update_i18n_lang", { p_key: key, p_lang: lang, p_text: seedVal });
    OVERRIDES_BY_KEY[key] = OVERRIDES_BY_KEY[key] || { str_key: key };
    OVERRIDES_BY_KEY[key][lang] = seedVal;
    DCL.toast(DCL.t("page.i18nAdmin.resetToast"));
    buildRows();
    renderTable();
  }catch(e){}
}

function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escAttr(s){ return esc(s).replace(/"/g,"&quot;"); }
