// ============================================================================
// 로그인 화면 로직
// ============================================================================
document.addEventListener("DOMContentLoaded", async function(){
  DCL.initTheme();
  DCL.registerSW();
  DCL.applyI18n();
  DCL.initLangSwitcher();
  DCL.initUserManualButton();
  if (DCL.loadI18nOverrides) DCL.loadI18nOverrides();

  if (!DCL.isConfigured()) {
    document.getElementById("setupWarning").style.display = "block";
  }

  // 이미 로그인 되어 있으면 바로 대시보드로
  const existing = DCL.getCurrentInspector();
  if (existing) { location.href = "dashboard.html"; return; }

  const inspectors = await DCL.select("inspectors", q => q.eq("is_active", true).order("name"));
  const sel = document.getElementById("inspectorSelect");
  sel.innerHTML = "";
  if (!inspectors.length) {
    sel.innerHTML = '<option value="">' + DCL.t("page.index.noInspectorsOption") + '</option>';
  } else {
    inspectors.forEach(function(i){
      const opt = document.createElement("option");
      opt.value = i.id;
      opt.textContent = i.name + (i.emp_no ? " ("+i.emp_no+")" : "") + " · " + DCL.roleLabel(i.role);
      opt.dataset.pin = i.pin || "";
      opt.dataset.payload = JSON.stringify(i);
      sel.appendChild(opt);
    });
  }
  DCL.autoSelectFirst(sel);

  function togglePinRow(){
    const opt = sel.options[sel.selectedIndex];
    const needsPin = opt && opt.dataset.pin;
    document.getElementById("pinRow").style.display = needsPin ? "block" : "none";
  }
  sel.addEventListener("change", togglePinRow);
  togglePinRow();

  document.getElementById("loginBtn").addEventListener("click", function(){
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) { DCL.toast(DCL.t("page.index.selectInspectorToast"), "err"); return; }
    const inspector = JSON.parse(opt.dataset.payload);
    if (opt.dataset.pin) {
      const pin = document.getElementById("pinInput").value.trim();
      if (pin !== opt.dataset.pin) { DCL.toast(DCL.t("page.index.pinMismatchToast"), "err"); return; }
    }
    DCL.setCurrentInspector(inspector);
    location.href = "dashboard.html";
  });
});
