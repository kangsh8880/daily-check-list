// ============================================================================
// 로그인 화면 로직
// ============================================================================
document.addEventListener("DOMContentLoaded", async function(){
  DCL.initTheme();
  DCL.registerSW();

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
    sel.innerHTML = '<option value="">등록된 점검자가 없습니다</option>';
  } else {
    inspectors.forEach(function(i){
      const opt = document.createElement("option");
      opt.value = i.id;
      const roleLabel = {admin:"관리자", action_owner:"조치담당자", inspector:"점검자"}[i.role] || i.role;
      opt.textContent = i.name + (i.emp_no ? " ("+i.emp_no+")" : "") + " · " + roleLabel;
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
    if (!opt || !opt.value) { DCL.toast("점검자를 선택하세요", "err"); return; }
    const inspector = JSON.parse(opt.dataset.payload);
    if (opt.dataset.pin) {
      const pin = document.getElementById("pinInput").value.trim();
      if (pin !== opt.dataset.pin) { DCL.toast("PIN이 일치하지 않습니다", "err"); return; }
    }
    DCL.setCurrentInspector(inspector);
    location.href = "dashboard.html";
  });
});
