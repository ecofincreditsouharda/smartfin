/* ---- CONFIG ---- */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwRuT2u72CRkkpx_kR4cL6zUdY_0AA0m-HPRkqZK4OC6D-hxD_RgWbXRQvRVUQaMB0j/exec';   // ends with /exec
const IDLE_MS = 60 * 1000;   // auto-logout after inactivity (change if too aggressive)

let session = null, lastSchedule = null, lastMeta = null, lastReceipt = null, curLoanId = '';
let editing = { type:null, id:null }, lastVoucher = null, repLoans = [];
let BANK = 'ECOSMART', LOGO_URL = 'logo.png';
const $ = id => document.getElementById(id);
const val = id => ($(id) ? $(id).value : '');
const rupee = n => (n === '' || n == null || isNaN(Number(String(n).replace(/[^0-9.\-]/g,''))))
  ? (n || '') : '₹ ' + Number(String(n).replace(/[^0-9.\-]/g,'')).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const token = () => localStorage.getItem('coop_token') || '';

async function api(action, payload = {}) {
  const res = await fetch(WEB_APP_URL, { method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action, token: token() }, payload)) });
  const data = await res.json();
  if (!data.ok) { if (/sign in/i.test(data.error||'')) logout(); throw new Error(data.error || 'Request failed'); }
  return data;
}
const summaryHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join('');
const tableFrom = (rows) => {
  if (!rows || !rows.length) return '<p class="msg">Nothing to show.</p>';
  const cols = Object.keys(rows[0]); const money = /amount|emi|repayable|value|paid|balance|arrears|due|payout|instal|min/i;
  let h = '<table><tr>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';
  rows.forEach(r => h += '<tr>' + cols.map(c => `<td>${money.test(c) ? rupee(r[c]) : esc(r[c])}</td>`).join('') + '</tr>');
  return h + '</table>';
};
const schedTable = (sch) => {
  let h = '<table><tr><th>#</th><th>Date</th><th>Opening</th><th>Interest</th><th>Principal</th><th>Instalment</th><th>Closing</th></tr>';
  sch.forEach(x => h += `<tr><td>${x.period}</td><td>${x.date}</td><td>${rupee(x.opening)}</td><td>${rupee(x.interest)}</td>` +
    `<td>${rupee(x.principal)}</td><td>${rupee(x.emi)}</td><td>${rupee(x.closing)}</td></tr>`);
  return h + '</table>';
};
const fileToB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });

/* ---------------------- IDLE AUTO-LOGOUT --------------------------- */
let idleTimer = null;
function resetIdle() { if (!session) return; clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { logout(); $('loginMsg').textContent = 'Signed out after inactivity.'; }, IDLE_MS); }
['click','keydown','mousemove','touchstart','scroll'].forEach(ev => document.addEventListener(ev, resetIdle, { passive:true }));

/* ------------------------------ BOOT (splash) ---------------------- */
window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  LOGO_URL = new URL('logo.png', location.href).href;
  try { const { bankName } = await api('bank_info'); if (bankName) BANK = bankName; } catch (e) {}
  applyBranding(BANK);
  setTimeout(async () => {
    $('splash').hidden = true;
    if (token()) { try { const { user } = await api('me'); start(user); return; } catch (e) {} }
    $('gate').hidden = false;
  }, 1600);
});
function applyBranding(name) {
  document.title = name; if ($('splashName')) $('splashName').textContent = name;
  if ($('loginName')) $('loginName').textContent = name; if ($('brandName')) $('brandName').textContent = name;
}

/* ------------------------------ EVENTS ----------------------------- */
document.addEventListener('change', e => { if (e.target.id === 'r_Mode') $('r_UtrWrap').hidden = (e.target.value !== 'UPI');
  if (e.target.id === 'rep_sheet') repPeriodToggle();
  if (e.target.id === 'e_Category') $('e_ToWrap').hidden = (e.target.value !== 'External Expenses'); });
document.addEventListener('blur', async e => {
  if (e.target.id === 'l_Borrower' && val('l_Borrower').trim() && !val('l_MemberID').trim())
    await autofillMember(val('l_Borrower').trim(), null, 'l_MemberID');
  if (e.target.id === 'l_MemberID' && val('l_MemberID').trim() && !val('l_Borrower').trim())
    await autofillMember(val('l_MemberID').trim(), 'l_Borrower', null);
  if (e.target.id === 's_MemberID' && val('s_MemberID').trim())
    await autofillMember(val('s_MemberID').trim(), 's_MemberName', null);
}, true);
document.addEventListener('input', e => {
  if (e.target.id === 'r_search') filterLoanList();
  if (e.target.id === 'l_search') filterList(allLoans, val('l_search'), 'l_list', 'loan', 'loans');
  if (e.target.id === 'd_search') filterList(allDeposits, val('d_search'), 'd_list', null, 'deposits');
  if (e.target.id === 's_search') filterList(allSavings, val('s_search'), 's_list');
});
document.addEventListener('click', e => {
  const t = e.target, d = t.dataset || {};
  if (d.pwtoggle) { const f = $(d.pwtoggle), show = f.type === 'password'; f.type = show ? 'text' : 'password'; t.textContent = show ? 'Hide' : 'Show'; return; }
  if (t.id === 'hamburger') return toggleNav();
  if (t.id === 'backdrop') return toggleNav(false);
  if (t.id === 'loginBtn') return login();
  if (d.view) return showView(d.view);
  if (d.refresh) return refresh(d.refresh);
  if (d.rprint) return printPastReceipt(d.rprint);
  if (d.voucher) return printPastVoucher(d.voucher);
  if (d.photo) return showPhoto(d.photo);
  if (d.bredit) return fillBranch(d.bredit);
  if (t.id === 'modal_close' || t.id === 'modal') return closeModal();
  if (d.edit) { const i = d.edit.indexOf(':'); return startEdit(d.edit.slice(0,i), d.edit.slice(i+1)); }
  if (d.openledger) return openLedger(d.openledger);
  const map = { l_preview:previewLoan, l_add:addLoan, l_print:printSchedule, l_min:()=>{ $('l_schedCard').hidden = true; },
    d_preview:previewDeposit, d_add:addDeposit, w_go:fdWithdraw, s_open:savingsOpen, st_go:savingsTxn, pb_load:loadPassbook,
    tf_go:doTransfer, m_add:addMember, e_add:addExpense, e_print:()=>printVoucher(lastVoucher),
    r_load:()=>openLedger(val('r_LoanId').trim()), r_add:addReceipt, r_print:()=>printReceiptObj(lastReceipt),
    r_min:minimiseLedger, rep_load:loadReport, rep_print:printReport, soc_save:socSave, soc_txn:socTxn, br_save:branchSave,
    set_save:saveSettings, u_add:addUser, cp_go:changePw, reset_go:resetAll, logoutBtn:logout };
  if (map[t.id]) return map[t.id]();
  if (d.loan) return showSchedule(d.loan);
  if (d.member) return showMember(d.member);
  if (d.reset) return resetUser(d.reset);
  if (d.toggle) return toggleUser(d.toggle, d.active === 'true');
});
function toggleNav(open) { const n = $('nav'), b = $('backdrop');
  const show = open === undefined ? !n.classList.contains('open') : open;
  n.classList.toggle('open', show); b.classList.toggle('show', show); }

/* ------------------------------ AUTH ------------------------------- */
async function login() {
  $('loginMsg').textContent = 'Signing in…';
  try { const { token: tk, user } = await api('login', { userId: val('loginId').trim(), password: val('loginPw') });
    localStorage.setItem('coop_token', tk); $('loginPw').value = '';
    $('loginMsg').textContent = 'Login successful — loading…'; start(user);
  } catch (err) { $('loginMsg').textContent = err.message; }
}
function logout(){ clearTimeout(idleTimer); localStorage.removeItem('coop_token'); session = null;
  $('app').hidden = true; $('gate').hidden = false; }
function start(user) {
  session = user; if (user.bankName) { BANK = user.bankName; applyBranding(BANK); }
  $('gate').hidden = true; $('splash').hidden = true; $('app').hidden = false; resetIdle();
  const role = user.role;
  const canWrite    = ['Admin','BranchManager','Operator','Collector'].includes(role);
  const canReport   = canWrite;
  const canSettings = ['Admin','BranchManager'].includes(role);
  const canSociety  = ['Admin','BranchManager'].includes(role);
  const isAdmin     = role === 'Admin';
  const isCollector = role === 'Collector';
  // hide everything except Repayments and Dashboard for Collector
  const roleLabel = role.replace(/([a-z])([A-Z])/g, '$1 $2');
  const branchLabel = (role !== 'Admin' && role !== 'Director') ? ' · ' + esc(user.branch || '—') : '';
  $('who').innerHTML = `<span>${esc(user.name)} · <b>${esc(roleLabel)}</b>${branchLabel}</span>` +
    `<button id="logoutBtn">Sign out</button>`;
  document.querySelectorAll('.add-only').forEach(el    => el.style.display = canWrite    ? '' : 'none');
  document.querySelectorAll('.report-only').forEach(el => el.style.display = canReport   ? '' : 'none');
  document.querySelectorAll('.settings-only').forEach(el => el.style.display = canSettings ? '' : 'none');
  document.querySelectorAll('.society-only').forEach(el => el.style.display = canSociety  ? '' : 'none');
  document.querySelectorAll('.admin-only').forEach(el  => el.style.display = isAdmin     ? '' : 'none');
  // Collector: hide all nav except dashboard + repayments
  if (isCollector) document.querySelectorAll('.navbtn').forEach(b => {
    if (b.dataset.view !== 'dashboard' && b.dataset.view !== 'repayments') b.style.display = 'none'; });
  populateBranchSelects(); populateCollectorSelect();
  showView('dashboard');
}
async function populateBranchSelects() {
  let names = [];
  try { const { branches } = await api('branches_list'); names = (branches||[]).map(b => b.Branch).filter(Boolean); } catch (e) {}
  if (!names.length) names = ['Main Branch'];
  const locked = (session.role === 'BranchManager' || session.role === 'Operator');
  document.querySelectorAll('select.branch-select').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = names.map(n => `<option>${esc(n)}</option>`).join('');
    if (locked && session.branch) { if (!names.includes(session.branch)) sel.innerHTML += `<option>${esc(session.branch)}</option>`;
      sel.value = session.branch; sel.disabled = true; }
    else if (cur && names.includes(cur)) sel.value = cur;
  });
}
function showView(v) {
  document.querySelectorAll('.view').forEach(s => s.hidden = true);
  $('view-' + v).hidden = false;
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  toggleNav(false); refresh(v);
}
function refresh(v) {
  if (v === 'dashboard') loadDashboard();
  if (v === 'members') loadList('members_list', 'm_list', 'member', 'member');
  if (v === 'loans') loadList('loans_list', 'l_list', 'loan', 'loans');
  if (v === 'deposits') loadList('deposits_list', 'd_list', null, 'deposits');
  if (v === 'savings') loadList('savings_list', 's_list');
  if (v === 'expenses') loadList('expenses_list', 'e_list', null, 'expenses');
  if (v === 'repayments') loadRepaymentLoans();
  if (v === 'society' && session.role) loadSociety();
  if (v === 'reports') { ensurePeriods(); repPeriodToggle(); }
  if (v === 'users' && session.role === 'Admin') loadUsers();
  if (v === 'settings' && ['Admin','BranchManager'].includes(session.role)) { loadSettings(); loadBranches(); }
}

/* ----------------------------- DASHBOARD --------------------------- */
async function loadDashboard() {
  $('dash').innerHTML = '<p class="msg">Loading…</p>'; $('dash_overdue').innerHTML = '';
  try { const { stats, overdue } = await api('dashboard_stats');
    $('dash').innerHTML = [['Loans', stats.loanCount, ''], ['Amount Disbursed', rupee(stats.totalDisbursed), ''],
      ['Due This Month', rupee(stats.dueThisMonth), ''], ['Members in Arrears', stats.overdueCount, stats.overdueCount ? 'warn' : ''],
      ['Total Arrears', rupee(stats.totalArrears), stats.totalArrears > 0 ? 'warn' : '']]
      .map(([l, v, c]) => `<div class="stat ${c}"><span>${l}</span><b>${v}</b></div>`).join('');
    $('dash_overdue').innerHTML = overdue && overdue.length ? tableFrom(overdue) : '<p class="msg">No missed EMIs.</p>';
  } catch (err) { $('dash').innerHTML = `<p class="err">${err.message}</p>`; }
}

/* --------------------------- GENERIC LIST -------------------------- */
async function loadList(action, target, linkKind, editKey) {
  try { const { rows } = await api(action);
    if (action === 'loans_list')    allLoans    = rows;
    if (action === 'deposits_list') allDeposits = rows;
    if (action === 'savings_list')  allSavings  = rows;
    renderListHtml(rows, target, linkKind, editKey);
  } catch (err) { $(target).innerHTML = `<p class="err">${err.message}</p>`; }
}

/* ------------------------------ EDIT MODE -------------------------- */
const EDIT_BTN = { loans:'l_add', deposits:'d_add', expenses:'e_add', member:'m_add' };
const EDIT_VIEW = { loans:'loans', deposits:'deposits', expenses:'expenses', member:'members' };
const EDIT_MSG = { loans:'l_msg', deposits:'d_msg', expenses:'e_msg', member:'m_msg' };
function clearEdit() {
  editing = { type:null, id:null };
  setText('l_add','Confirm & Save'); $('l_add').hidden = true;
  setText('d_add','Confirm & Save'); $('d_add').hidden = true;
  setText('e_add','Add expense'); setText('m_add','Add member');
}
function setText(id, t){ if ($(id)) $(id).firstChild ? $(id).textContent = t : $(id).textContent = t; }
async function startEdit(key, id) {
  try {
    showView(EDIT_VIEW[key]);
    if (key === 'member') { const { member } = await api('member_get', { memberId:id }); fillMember(member); }
    else { const { fields } = await api('reg_get', { key, id }); fillReg(key, fields); }
    editing = { type:key, id };
    const btn = EDIT_BTN[key]; $(btn).hidden = false; setText(btn, 'Update');
    $(EDIT_MSG[key]).textContent = 'Editing ' + id + ' — change fields, then Update.';
  } catch (err) { alert(err.message); }
}
function fillReg(key, f) {
  if (key === 'loans') { setV('l_Borrower',f.Borrower); setV('l_MemberID',f.MemberID); setV('l_LoanType',f.LoanType);
    setV('l_Branch',f.Branch); setV('l_Amount',f.Amount); setV('l_RatePct',(Number(f.RateAnnual)||0)*100);
    setV('l_TenureMonths',f.TenureMonths); setV('l_Method',f.Method||'Flat'); setV('l_Frequency',f.Frequency||'Monthly');
    setV('l_SanctionDate',f.SanctionDate); setV('l_DisbursementDate',f.DisbursementDate); setV('l_FirstEMIDate',f.FirstEMIDate);
    setV('l_CustomEMI',f.CustomEMI); }
  if (key === 'deposits') { setV('d_Depositor',f.Depositor); setV('d_MemberID',f.MemberID); setV('d_DepositType',f.DepositType);
    setV('d_Branch',f.Branch); setV('d_Amount',f.Amount); setV('d_RatePct',(Number(f.RateAnnual)||0)*100);
    setV('d_TenureMonths',f.TenureMonths); setV('d_StartDate',f.StartDate); setV('d_PayoutMode',f.PayoutMode); setV('d_Remarks',f.Remarks); }
  if (key === 'expenses') { setV('e_Date',f.Date); setV('e_Category',f.Category); setV('e_Description',f.Description);
    setV('e_Branch',f.Branch); setV('e_Amount',f.Amount); setV('e_Remarks',f.Remarks);
    $('e_ToWrap').hidden = (f.Category !== 'External Expenses'); }
}
function fillMember(m) { setV('m_FullName',m.FullName); setV('m_DOB',m.DOB && m.DOB.length>10 ? '' : m.DOB); setV('m_Phone',m.Phone);
  setV('m_Branch',m.Branch); setV('m_Address',m.Address); setV('m_Aadhaar',''); $('m_Aadhaar').placeholder = 'unchanged ('+ (m.Aadhaar||'') +') — type to replace';
  setV('m_PAN',m.PAN); setV('m_BankName',m.BankName); setV('m_BankAccount',m.BankAccount); setV('m_IFSC',m.IFSC); }
function setV(id, v){ if ($(id)) $(id).value = (v == null ? '' : v); }

/* ------------------------ REPAYMENTS: loan list -------------------- */
async function loadRepaymentLoans() {
  try { const { rows } = await api('loans_list'); repLoans = rows; renderLoanList();
  } catch (err) { $('r_loanlist').innerHTML = `<p class="err">${err.message}</p>`; }
}
function filterLoanList(){ renderLoanList(); }
function renderLoanList() {
  const q = (val('r_search')||'').toLowerCase();
  const rows = repLoans.filter(r => !q || Object.values(r).some(v => String(v).toLowerCase().includes(q)));
  if (!rows.length) { $('r_loanlist').innerHTML = '<p class="msg">No matching loans.</p>'; return; }
  const cols = Object.keys(rows[0]);
  const money = /amount|emi|repayable/i;
  let h = '<table><tr>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '<th></th></tr>';
  rows.forEach(r => { h += '<tr>' + cols.map(c => `<td>${money.test(c) ? rupee(r[c]) : esc(r[c])}</td>`).join('') +
    `<td><button class="ghost" data-openledger="${esc(r[cols[0]])}">Collect / View</button></td></tr>`; });
  $('r_loanlist').innerHTML = h + '</table>';
}
function openLedger(id) { if (!id) return; $('r_LoanId').value = id; loadLedger(); }
function minimiseLedger() { ['r_ledgerHead','r_addCard','r_recCard','r_schedCard'].forEach(x => $(x).hidden = true); }

/* ---- Collector select (shows users with Collector role for the branch) ---- */
let collectorUsers = [];
async function populateCollectorSelect() {
  if (!$('l_Collector')) return;
  try { const { users } = await api('users_list').catch(()=>({users:[]}));
    collectorUsers = (users||[]).filter(u => u.Role === 'Collector' && (session.role === 'Admin' || u.Branch === session.branch));
    $('l_Collector').innerHTML = '<option value="">— select collector —</option>' +
      collectorUsers.map(u => `<option value="${esc(u.UserID)}">${esc(u.Name)} (${esc(u.Branch)})</option>`).join('');
  } catch(e) {}
}

/* ---- Member autofill (used by loans + savings open) ---- */
async function autofillMember(query, nameId, memberIdId) {
  if (!query) return;
  try { const { member } = await api('member_lookup', { query });
    if (nameId && $(nameId)) $(nameId).value = member.FullName;
    if (memberIdId && $(memberIdId)) $(memberIdId).value = member.MemberID;
    return member;
  } catch (e) { return null; }
}

/* ---- Client-side list search ---- */
let allLoans = [], allDeposits = [], allSavings = [];
function filterList(rows, query, target, linkKind, editKey) {
  const q = (query||'').toLowerCase().trim();
  const filtered = !q ? rows : rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
  renderListHtml(filtered, target, linkKind, editKey);
}
function renderListHtml(rows, target, linkKind, editKey) {
  if (!rows || !rows.length) { $(target).innerHTML = '<p class="msg">Nothing to show.</p>'; return; }
  const cols = Object.keys(rows[0]); const money = /amount|emi|repayable|value|paid|balance|arrears|min/i;
  const hasBtn = linkKind || editKey;
  let h = '<table><tr>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + (hasBtn ? '<th></th>' : '') + '</tr>';
  rows.forEach(r => { const id = r[cols[0]]; h += '<tr>' + cols.map(c => `<td>${money.test(c) ? rupee(r[c]) : esc(r[c])}</td>`).join('');
    if (hasBtn) { h += '<td>';
      if (linkKind === 'loan') h += `<button class="ghost" data-loan="${esc(id)}">Schedule</button> `;
      if (linkKind === 'member') h += `<button class="ghost" data-member="${esc(id)}">View</button> `;
      if (editKey === 'expenses') h += `<button class="ghost" data-voucher="${esc(id)}">Voucher</button> `;
      if (editKey) h += `<button class="ghost" data-edit="${esc(editKey)}:${esc(id)}">Edit</button>`;
      h += '</td>'; } h += '</tr>'; });
  $(target).innerHTML = h + '</table>';
}

/* ------------------------------ LOANS ------------------------------ */
function loanFromForm() { return { Borrower:val('l_Borrower'), MemberID:val('l_MemberID'), LoanType:val('l_LoanType'),
  Branch:val('l_Branch'), Amount:val('l_Amount'), RateAnnual:Number(val('l_RatePct'))/100, TenureMonths:val('l_TenureMonths'),
  Method:val('l_Method'), Frequency:val('l_Frequency'), SanctionDate:val('l_SanctionDate'),
  DisbursementDate:val('l_DisbursementDate'), FirstEMIDate:val('l_FirstEMIDate'), CustomEMI:val('l_CustomEMI'),
  Collector:val('l_Collector') }; }
async function previewLoan() {
  $('l_msg').textContent = 'Calculating…';
  try { const { result, meta } = await api('loan_preview', { loan: loanFromForm() });
    renderSchedule('PREVIEW (not yet saved)', result, meta); $('l_add').hidden = false;
    $('l_msg').textContent = 'Preview ready — review, then Confirm & Save.';
  } catch (err) { $('l_msg').textContent = ''; alert(err.message); }
}
async function addLoan() {
  $('l_msg').textContent = 'Saving…';
  try {
    if (editing.type === 'loans') { await api('reg_edit', { key:'loans', id:editing.id, fields:loanFromForm() });
      $('l_msg').textContent = 'Updated ' + editing.id; clearEdit(); return loadList('loans_list', 'l_list', 'loan', 'loans'); }
    const { id } = await api('loans_add', { loan: loanFromForm() });
    $('l_msg').textContent = 'Saved ' + id; $('l_add').hidden = true;
    await loadList('loans_list', 'l_list', 'loan', 'loans'); showSchedule(id);
  } catch (err) { $('l_msg').textContent = ''; alert(err.message); }
}
async function showSchedule(id) {
  try { const { result, meta } = await api('loan_schedule', { loanId: id }); renderSchedule(id, result, meta); }
  catch (err) { alert(err.message); }
}
function renderSchedule(title, result, meta) {
  const s = result.summary; lastSchedule = result.schedule; lastMeta = meta || {};
  $('l_schedCard').hidden = false; $('l_schedTitle').textContent = 'Schedule — ' + title;
  $('l_summary').innerHTML = summaryHtml([['Effective Instalment', rupee(s.effEMI)],
    [s.frequency === 'Daily' ? 'Days' : 'Tenure', s.effTenure + (s.frequency === 'Daily' ? ' days' : ' mo')],
    ['Total Interest', rupee(s.totalInterest)], ['Total Repayable', rupee(s.totalRepayable)],
    ['Extra-Day Interest', rupee(s.extraInterest) + ' (' + s.extraDays + ' d)']]);
  lastMeta.tenure = s.nominalTenure; lastMeta.method = s.method; lastMeta.frequency = s.frequency;
  $('l_sched').innerHTML = schedTable(result.schedule);
  $('l_schedCard').scrollIntoView({ behavior:'smooth' });
}
function printHeader(subtitle) {
  return `<div class="hd"><img src="${LOGO_URL}" class="lg" onerror="this.style.display='none'"/>` +
    `<div><h2>${esc(BANK)}</h2><h3>${esc(subtitle)}</h3></div></div>`;
}
function printSchedule() {
  if (!lastSchedule) { alert('Load or preview a schedule first.'); return; }
  const m = lastMeta || {};
  const info = `<table class="meta"><tr><td><b>Borrower:</b> ${esc(m.borrower)}</td><td><b>Member ID:</b> ${esc(m.memberId)}</td></tr>` +
    `<tr><td><b>Loan Type:</b> ${esc(m.loanType)}</td><td><b>Tenure:</b> ${esc(m.tenure)} months (${esc(m.method)} · ${esc(m.frequency)})</td></tr></table>`;
  const sign = `<div class="sign">_______________________<br>Branch Manager Signature</div>`;
  const foot = `<div class="foot">${esc(m.branch)} Branch${m.branchAddress ? ' — ' + esc(m.branchAddress) : ''}` +
    `${m.branchPhone ? ' · Phone: ' + esc(m.branchPhone) : ''}${m.email ? ' · Email: ' + esc(m.email) : ''}</div>`;
  printDoc(printHeader('Amortization Schedule') + info + schedTable(lastSchedule) + sign + foot,
    '@page{size:A4;margin:2cm 1cm}',
    'body{font-size:11px} .hd{text-align:center;display:block} .hd h2{font-size:18px} table{font-size:10pt} th,td{font-size:10pt}');
}
/* In-place printing via a hidden iframe — no new tab (PWA-safe) */
function printDoc(inner, pageCss, extraCss) {
  const base = `body{font-family:Arial,sans-serif;color:#000}
    .hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px}
    .hd .lg{width:60px;height:60px;object-fit:contain}
    .hd h2{margin:0;font-size:20px}.hd h3{margin:2px 0 0;font-weight:normal;font-size:13px;color:#444}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{border:1px solid #999;padding:4px 6px;text-align:right}
    th:nth-child(2),td:nth-child(2){text-align:left} th:first-child,td:first-child{text-align:left}
    table.meta td{border:0;text-align:left;padding:3px 6px}
    .sign{margin-top:44px;text-align:right;font-size:12px}
    .foot{margin-top:14px;border-top:1px solid #999;padding-top:6px;font-size:10px;color:#333;text-align:center}`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(`<html><head><style>@page{${''}}${pageCss}${base}${extraCss||''}</style></head><body>${inner}</body></html>`); doc.close();
  frame.contentWindow.focus();
  setTimeout(() => { try { frame.contentWindow.print(); } catch(e){} setTimeout(() => frame.remove(), 1500); }, 450);
}

/* --------------------------- REPAYMENTS ---------------------------- */
async function loadLedger() {
  const id = val('r_LoanId').trim(); if (!id) return; curLoanId = id;
  try { const { ledger } = await api('repayment_ledger', { loanId: id }); const s = ledger.summary;
    $('r_ledgerHead').hidden = false; $('r_ledgerTitle').textContent = 'Ledger — ' + id;
    $('r_summary').innerHTML = summaryHtml([['Total Payable', rupee(s.totalPayable)], ['Total Paid', rupee(s.totalPaid)],
      ['Balance Remaining', rupee(s.balanceRemaining)], ['Scheduled Due To-Date', rupee(s.scheduledDueToDate)],
      ['Arrears / (Advance)', rupee(s.arrears)], ['Next Due', s.nextDueDate + ' · ' + rupee(s.nextDueAmount)]]);
    $('r_addCard').hidden = (session.role === 'Director'); $('r_receiptBox').hidden = true;
    let rh = '<table><tr><th>Receipt</th><th>Date</th><th>Amount</th><th>Mode</th><th>Note</th><th></th></tr>';
    ledger.receipts.forEach(x => rh += `<tr><td>${esc(x.Receipt)}</td><td>${esc(x.Date)}</td><td>${rupee(x.Amount)}</td>` +
      `<td>${esc(x.Mode)}</td><td>${esc(x.Note)}</td><td><button class="ghost" data-rprint="${esc(x.Receipt)}">Print</button></td></tr>`);
    $('r_recCard').hidden = false; $('r_receipts').innerHTML = rh + '</table>';
    $('r_schedCard').hidden = false; $('r_sched').innerHTML = schedTable(ledger.schedule);
  } catch (err) { alert(err.message); }
}
async function addReceipt() {
  const id = val('r_LoanId').trim(); if (!id) { alert('Load a loan first.'); return; }
  const mode = val('r_Mode');
  if (mode === 'UPI' && !val('r_Utr').trim()) { alert('Please enter the UTR number for UPI.'); return; }
  $('r_msg').textContent = 'Saving…';
  try { const { receipt } = await api('repayment_add', { repayment: { LoanID:id, Date:val('r_Date'),
      Amount:val('r_Amount'), Mode:mode, Ref:val('r_Utr'), Note:val('r_Note') } });
    lastReceipt = receipt; $('r_msg').textContent = 'Receipt ' + receipt.receiptNo; $('r_Amount').value = '';
    $('r_receiptBox').hidden = false; $('r_receiptView').innerHTML = receiptSummary(receipt); loadLedger();
  } catch (err) { $('r_msg').textContent = ''; alert(err.message); }
}
const receiptSummary = (r) => summaryHtml([['Bank', esc(r.bankName)], ['Receipt No.', esc(r.receiptNo)], ['Date', esc(r.date)],
  ['Borrower', esc(r.borrower)], ['Mode', esc(r.mode) + (r.ref ? ' ('+esc(r.ref)+')' : '')], ['This payment', rupee(r.amount)],
  ['EMIs paid till now', r.emisPaid], ['Amount paid till now', rupee(r.amountPaidTillNow)],
  ['Pending loan amount', rupee(r.pendingAmount)], ['Operator', esc(r.operator)]]);
async function printPastReceipt(receiptNo) {
  try { const { receipt } = await api('receipt_print', { loanId: curLoanId, receiptNo }); printReceiptObj(receipt); }
  catch (err) { alert(err.message); }
}
function printReceiptObj(r) {
  if (!r) { alert('No receipt selected.'); return; }
  const inr = n => '₹' + Number(n||0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const L = s => (s + '           ').slice(0, 11);
  const line = '--------------------------------';
  const body =
    `<div class="c"><img src="${LOGO_URL}" class="rl" onerror="this.style.display='none'"/></div>` +
    `<div class="c b">${esc(BANK)}</div>` +
    `<div class="c">Loan Repayment Receipt</div>` +
    `<pre>${line}\n` +
    `${L('Receipt No')}: ${esc(r.receiptNo)}\n` +
    `${L('Date')}: ${esc(r.date)}\n` +
    `${L('Loan ID')}: ${esc(r.loanId)}\n` +
    `${L('Borrower')}: ${esc(r.borrower)}\n` +
    `${L('Mode')}: ${esc(r.mode)}${r.ref ? ' (' + esc(r.ref) + ')' : ''}\n` +
    `${line}\n` +
    `${L('EMIs Paid')}: ${esc(r.emisPaid)}\n` +
    `${L('Paid Amt')}: ${inr(r.amountPaidTillNow)}\n` +
    `${L('Pending')}: ${inr(r.pendingAmount)}\n` +
    `${line}\n` +
    `${L('Operator')}: ${esc(r.operator)}\n` +
    `${line}\n` +
    `        Thank You\n     Computer Generated\n   No Signature Required</pre>`;
  const css = `@page{size:80mm auto;margin:4mm}
    body{font-family:'Consolas','Courier New',monospace;font-size:8pt;color:#000;width:72mm}
    .c{text-align:center}.b{font-weight:bold;font-size:10pt;margin:2px 0}
    .rl{width:44px;height:44px;object-fit:contain}
    pre{font-family:'Consolas','Courier New',monospace;font-size:8pt;white-space:pre;margin:6px 0}`;
  printDoc(body, css, '');
}

/* --------------------------- FIXED DEPOSITS ------------------------ */
function depositFromForm() { return { Depositor:val('d_Depositor'), MemberID:val('d_MemberID'), DepositType:'Fixed Deposit',
  Branch:val('d_Branch'), Amount:val('d_Amount'), RateAnnual:Number(val('d_RatePct'))/100, TenureMonths:val('d_TenureMonths'),
  StartDate:val('d_StartDate'), PayoutMode:val('d_PayoutMode'), Remarks:val('d_Remarks'), Nominee:val('d_Nominee') }; }
async function previewDeposit() {
  $('d_msg').textContent = 'Calculating…';
  try { const { result } = await api('deposit_preview', { deposit: depositFromForm() });
    $('d_prev').innerHTML = summaryHtml([['Principal', rupee(result.principal)], ['Rate', result.annualRatePct + ' %'],
      ['Tenure', result.tenureMonths + ' mo'], ['Maturity (compound)', rupee(result.maturityCompound)],
      ['Maturity (simple)', rupee(result.maturitySimple)]]);
    $('d_add').hidden = false; $('d_msg').textContent = 'Estimate shown — Confirm & Save to record it.';
  } catch (err) { $('d_msg').textContent = ''; alert(err.message); }
}
async function addDeposit() {
  $('d_msg').textContent = 'Saving…';
  try {
    if (editing.type === 'deposits') { await api('reg_edit', { key:'deposits', id:editing.id, fields:depositFromForm() });
      $('d_msg').textContent = 'Updated ' + editing.id; clearEdit(); return loadList('deposits_list', 'd_list', null, 'deposits'); }
    const { id } = await api('deposits_add', { deposit: depositFromForm() });
    $('d_msg').textContent = 'Saved ' + id; $('d_add').hidden = true; loadList('deposits_list', 'd_list', null, 'deposits');
  } catch (err) { $('d_msg').textContent = ''; alert(err.message); }
}
async function fdWithdraw() {
  $('w_msg').textContent = 'Saving…';
  try { const { withdrawalNo, payout } = await api('fd_withdraw', { withdrawal: { DepositID:val('w_DepositID'),
      Type:val('w_Type'), Date:val('w_Date'), ReducedRate: val('w_ReducedRate') ? Number(val('w_ReducedRate'))/100 : '',
      PayoutAmount:val('w_Payout'), Note:val('w_Note') } });
    $('w_msg').textContent = withdrawalNo + ' · payout ' + rupee(payout);
  } catch (err) { $('w_msg').textContent = ''; alert(err.message); }
}

/* ------------------------------ SAVINGS ---------------------------- */
async function savingsOpen() {
  $('s_msg').textContent = 'Saving…';
  try { const { savingsId } = await api('savings_open', { account: { MemberID:val('s_MemberID'), MemberName:val('s_MemberName'),
      Branch:val('s_Branch'), Rate:Number(val('s_Rate'))/100, MinBalance:val('s_MinBalance'),
      OpenDate:val('s_OpenDate'), Nominee:val('s_Nominee') } });
    $('s_msg').textContent = 'Opened ' + savingsId; loadList('savings_list', 's_list');
  } catch (err) { $('s_msg').textContent = ''; alert(err.message); }
}
async function savingsTxn() {
  $('st_msg').textContent = 'Saving…';
  try { const { txnNo, balance } = await api('savings_txn', { txn: { SavingsID:val('st_SavingsID'), Type:val('st_Type'),
      Amount:val('st_Amount'), Date:val('st_Date'), Note:val('st_Note') } });
    $('st_msg').textContent = txnNo + ' · balance ' + rupee(balance); $('st_Amount').value = '';
    if (val('pb_SavingsID') === val('st_SavingsID')) loadPassbook();
  } catch (err) { $('st_msg').textContent = ''; alert(err.message); }
}
async function loadPassbook() {
  const id = val('pb_SavingsID').trim(); if (!id) return;
  try { const { passbook } = await api('savings_passbook', { savingsId: id });
    $('pb_summary').innerHTML = summaryHtml([['Member', esc(passbook.account.Member)], ['Balance', rupee(passbook.account.Balance)],
      ['Minimum Balance', rupee(passbook.account.MinBalance)]]);
    $('pb_rows').innerHTML = tableFrom(passbook.rows);
  } catch (err) { alert(err.message); }
}

/* ------------------------------ TRANSFERS -------------------------- */
async function doTransfer() {
  $('tf_msg').textContent = 'Transferring…';
  try { const { txnNo, fromBalance, toBalance } = await api('transfer', { fromId:val('tf_From'), toId:val('tf_To'),
      amount:val('tf_Amount'), date:val('tf_Date'), note:val('tf_Note') });
    $('tf_msg').textContent = `${txnNo} · from ${rupee(fromBalance)} · to ${rupee(toBalance)}`; $('tf_Amount').value = '';
  } catch (err) { $('tf_msg').textContent = ''; alert(err.message); }
}

/* ------------------------------ MODAL ------------------------------ */
function openModal(title, html) { $('modal_title').textContent = title || ''; $('modal_body').innerHTML = html; $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; $('modal_body').innerHTML = ''; }
function driveId(url) { const m = String(url||'').match(/\/d\/([^/]+)\//) || String(url||'').match(/id=([^&]+)/); return m ? m[1] : ''; }
function showPhoto(url) {
  const id = driveId(url);
  const img = id ? `https://drive.google.com/thumbnail?id=${id}&sz=w600` : url;
  openModal('Member photo',
    `<img src="${esc(img)}" style="max-width:100%;border-radius:10px" onerror="this.style.display='none';document.getElementById('photo_fallback').style.display='block'"/>` +
    `<p id="photo_fallback" style="display:none">Couldn't load the image inline (the photo is stored privately in Drive). ` +
    `<a href="${esc(url)}" target="_blank">Open in Drive</a> instead.</p>`);
}

/* ------------------------------ MEMBERS ---------------------------- */
async function addMember() {
  $('m_msg').textContent = 'Saving…';
  try { const member = { FullName:val('m_FullName'), DOB:val('m_DOB'), Phone:val('m_Phone'), Address:val('m_Address'),
      Aadhaar:val('m_Aadhaar'), PAN:val('m_PAN'), BankName:val('m_BankName'), BankAccount:val('m_BankAccount'), IFSC:val('m_IFSC'), Branch:val('m_Branch') };
    const f = $('m_Photo').files[0]; if (f) { member.PhotoBase64 = await fileToB64(f); member.PhotoMime = f.type; }
    if (editing.type === 'member') { await api('member_edit', { memberId:editing.id, member });
      $('m_msg').textContent = 'Updated ' + editing.id; $('m_Photo').value = ''; clearEdit(); return loadList('members_list', 'm_list', 'member', 'member'); }
    const { memberId, warning } = await api('members_add', { member });
    $('m_msg').textContent = warning ? warning : ('Saved ' + memberId); $('m_Photo').value = ''; loadList('members_list', 'm_list', 'member', 'member');
  } catch (err) { $('m_msg').textContent = ''; alert(err.message); }
}
async function showMember(id) {
  try { const { member } = await api('member_get', { memberId: id }); $('m_card').hidden = false;
    const pairs = [['Member ID', member.MemberID], ['Full Name', member.FullName], ['DOB', member.DOB], ['Phone', member.Phone],
      ['Address', member.Address], ['Aadhaar', member.Aadhaar], ['PAN', member.PAN], ['Bank Name', member.BankName],
      ['Bank A/C', member.BankAccount], ['IFSC', member.IFSC], ['Branch', member.Branch]];
    let h = '<div class="summary">' + pairs.map(([k,v]) => `<div><span>${esc(k)} :</span><b>${esc(v)}</b></div>`).join('') + '</div>';
    if (member.PhotoUrl) h += `<div style="margin-top:12px"><button class="ghost" data-photo="${esc(member.PhotoUrl)}">View photo</button></div>`;
    $('m_detail').innerHTML = h; $('m_card').scrollIntoView({ behavior:'smooth' });
  } catch (err) { alert(err.message); }
}

/* ------------------------------ EXPENSES --------------------------- */
function expenseFromForm() {
  const cat = val('e_Category');
  const ex = { Date:val('e_Date'), Category:cat, Description:val('e_Description'),
    Branch:val('e_Branch'), Amount:val('e_Amount'), Remarks:val('e_Remarks') };
  if (cat === 'External Expenses') ex.To = val('e_To');
  return ex;
}
async function addExpense() {
  $('e_msg').textContent = 'Saving…';
  try {
    if (editing.type === 'expenses') { await api('reg_edit', { key:'expenses', id:editing.id, fields:expenseFromForm() });
      $('e_msg').textContent = 'Updated ' + editing.id; clearEdit(); return loadList('expenses_list', 'e_list', null, 'expenses'); }
    const { id, voucher } = await api('expenses_add', { expense: expenseFromForm() });
    lastVoucher = voucher; $('e_msg').textContent = 'Saved ' + id;
    $('e_voucherBox').hidden = false;
    $('e_voucherView').innerHTML = summaryHtml([['Bank', esc(voucher.bankName)], ['Voucher No.', esc(voucher.expenseNo)],
      ['Date', esc(voucher.date)], ['To', esc(voucher.to)], ['Category', esc(voucher.category)],
      ['Description', esc(voucher.description)], ['Amount', rupee(voucher.amount)], ['Branch', esc(voucher.branch)]]);
    loadList('expenses_list', 'e_list', null, 'expenses');
  } catch (err) { $('e_msg').textContent = ''; alert(err.message); }
}
function printVoucher(v) {
  if (!v) { alert('Add an expense first.'); return; }
  const body = printHeader('Expense Voucher') +
    `<table class="meta">
      <tr><td><b>Voucher No.:</b> ${esc(v.expenseNo)}</td><td><b>Date:</b> ${esc(v.date)}</td></tr>
      <tr><td><b>To:</b> ${esc(v.to)}</td><td><b>Category:</b> ${esc(v.category)}</td></tr></table>` +
    `<table><tr><th>Description</th><th>Amount</th></tr>
      <tr><td>${esc(v.description || v.category)}</td><td>${rupee(v.amount)}</td></tr>
      <tr><td style="text-align:right"><b>Total</b></td><td><b>${rupee(v.amount)}</b></td></tr></table>` +
    `<div class="sign">_______________________<br>Branch Manager Signature</div>` +
    `<div class="foot">${esc(v.branch)} Branch${v.branchAddress ? ' — ' + esc(v.branchAddress) : ''}` +
    `${v.branchPhone ? ' · Phone: ' + esc(v.branchPhone) : ''}${v.email ? ' · Email: ' + esc(v.email) : ''}</div>`;
  printDoc(body, '@page{size:A4;margin:2cm 1cm}', 'body{font-size:12px}');
}

/* ------------------------------ REPORTS ---------------------------- */
const AS_OF_REPORTS = ['Profit_Loss','Balance_Sheet','Cash_Flow'];
let periodsLoaded = false, lastReportName = '';
async function ensurePeriods() {
  if (periodsLoaded) return;
  try { const { periods } = await api('period_list');
    $('rep_period').innerHTML = periods.map(p => `<option>${esc(p)}</option>`).join(''); periodsLoaded = true;
  } catch (e) {}
}
function repPeriodToggle() { $('rep_periodWrap').style.display = AS_OF_REPORTS.includes(val('rep_sheet')) ? '' : 'none'; }
async function loadReport() {
  $('rep_grid').innerHTML = '<p class="msg">Loading…</p>';
  const sheet = val('rep_sheet'); lastReportName = $('rep_sheet').selectedOptions[0].text;
  const payload = { sheet };
  if (AS_OF_REPORTS.includes(sheet)) { await ensurePeriods();
    if (val('rep_period')) payload.setCell = { a1:'B4', value: val('rep_period') }; }
  try { const { grid } = await api('report_get', payload);
    let h = '<table>'; grid.forEach((row, ri) => h += '<tr>' + row.map(c => (ri === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('') + '</tr>');
    $('rep_grid').innerHTML = h + '</table>';
  } catch (err) { $('rep_grid').innerHTML = `<p class="err">${err.message}</p>`; }
}
function printReport() {
  const grid = $('rep_grid').innerHTML;
  if (!/table/.test(grid)) { alert('Load a report first.'); return; }
  printDoc(printHeader(lastReportName || 'Report') + grid, '@page{size:A4 landscape;margin:1cm}',
    'body{font-size:8px} th,td{padding:2px 3px;white-space:normal;word-break:break-word} table{table-layout:fixed}');
}

/* ------------------------------ SOCIETY BANK ----------------------- */
async function loadSociety() {
  try { const { society } = await api('society_get');
    $('soc_Acc').value = society.accountNumber || ''; $('soc_IFSC').value = society.ifsc || '';
    $('soc_Addr').value = society.address || ''; $('soc_Open').value = society.openingBalance || 0;
    $('soc_bal').innerHTML = summaryHtml([['Current Balance', rupee(society.balance)]]);
    let h = '<table><tr><th>Txn No</th><th>Date</th><th>Direction</th><th>Amount</th><th>Party</th><th>Ref</th><th>Note</th></tr>';
    society.txns.forEach(t => h += `<tr><td>${esc(t.TxnNo)}</td><td>${esc(t.Date)}</td><td>${esc(t.Direction)}</td>` +
      `<td>${rupee(t.Amount)}</td><td>${esc(t.Party)}</td><td>${esc(t.Ref)}</td><td>${esc(t.Note)}</td></tr>`);
    $('soc_list').innerHTML = h + '</table>';
  } catch (err) { $('soc_list').innerHTML = `<p class="err">${err.message}</p>`; }
}
async function socSave() {
  $('soc_msg').textContent = 'Saving…';
  try { await api('society_update', { info: { accountNumber:val('soc_Acc'), ifsc:val('soc_IFSC'),
      address:val('soc_Addr'), openingBalance:val('soc_Open') } });
    $('soc_msg').textContent = 'Saved.'; loadSociety();
  } catch (err) { $('soc_msg').textContent = ''; alert(err.message); }
}
async function socTxn() {
  $('soc_tmsg').textContent = 'Posting…';
  try { const { balance } = await api('society_txn', { txn: { Direction:val('soc_Dir'), Amount:val('soc_Amt'),
      Party:val('soc_Party'), Note:val('soc_Note') } });
    $('soc_tmsg').textContent = 'Balance ' + rupee(balance); $('soc_Amt').value = ''; loadSociety();
  } catch (err) { $('soc_tmsg').textContent = ''; alert(err.message); }
}

async function printPastVoucher(id) {
  try { const { voucher } = await api('voucher_get', { id }); printVoucher(voucher); }
  catch (err) { alert(err.message); }
}

/* ------------------------------ BRANCH CONTACTS -------------------- */
let branchRows = [];
async function loadBranches() {
  try { const { branches } = await api('branches_list'); branchRows = branches || [];
    if (!branchRows.length) { $('br_list').innerHTML = '<p class="msg">No branches yet.</p>'; return; }
    let h = '<table><tr><th>Branch</th><th>Address</th><th>Phone</th><th></th></tr>';
    branchRows.forEach((b,i) => h += `<tr><td>${esc(b.Branch)}</td><td>${esc(b.Address)}</td><td>${esc(b.Phone)}</td>` +
      `<td><button class="ghost" data-bredit="${i}">Edit</button></td></tr>`);
    $('br_list').innerHTML = h + '</table>';
  } catch (err) { $('br_list').innerHTML = `<p class="err">${err.message}</p>`; }
}
function fillBranch(i) { const b = branchRows[i]; if (!b) return;
  setV('br_Branch', b.Branch); setV('br_Address', b.Address); setV('br_Phone', b.Phone); $('br_msg').textContent = 'Editing ' + b.Branch; }
async function branchSave() {
  $('br_msg').textContent = 'Saving…';
  try { await api('branch_save', { branch: { Branch:val('br_Branch'), Address:val('br_Address'), Phone:val('br_Phone') } });
    $('br_msg').textContent = 'Saved.'; setV('br_Branch',''); setV('br_Address',''); setV('br_Phone','');
    loadBranches(); populateBranchSelects();
  } catch (err) { $('br_msg').textContent = ''; alert(err.message); }
}

/* ------------------------------ SETTINGS --------------------------- */
async function loadSettings() {
  try { const { settings } = await api('settings_get');
    $('set_form').innerHTML = settings.map(s => `<label>${esc(s.label)}<input data-skey="${esc(s.key)}" ` +
      `type="${s.type==='date'?'date':(s.type==='number'?'number':'text')}" value="${esc(s.value)}"></label>`).join('');
  } catch (err) { $('set_form').innerHTML = `<p class="err">${err.message}</p>`; }
}
async function saveSettings() {
  $('set_msg').textContent = 'Saving…'; const values = {};
  document.querySelectorAll('#set_form input').forEach(i => values[i.dataset.skey] = i.value);
  try { await api('settings_update', { values }); $('set_msg').textContent = 'Saved.';
    try { const { bankName } = await api('bank_info'); if (bankName) { BANK = bankName; applyBranding(BANK); } } catch(e){}
  } catch (err) { $('set_msg').textContent = ''; alert(err.message); }
}

async function resetAll() {
  if (val('reset_confirm').trim() !== 'RESET') { $('reset_msg').textContent = 'Type RESET to confirm.'; return; }
  if (!confirm('This will permanently delete ALL transaction data. User accounts will be kept.\n\nAre you absolutely sure?')) return;
  $('reset_msg').textContent = 'Deleting…';
  try { const { message } = await api('reset_all', { confirm:'CONFIRMED' });
    $('reset_msg').textContent = message; $('reset_confirm').value = '';
  } catch (err) { $('reset_msg').textContent = err.message; }
}
/* ------------------------------ USERS ------------------------------ */
async function loadUsers() {
  try { const { users } = await api('users_list');
    let h = '<table><tr><th>User ID</th><th>Name</th><th>Role</th><th>Branch</th><th>Active</th><th>Last login</th><th></th></tr>';
    users.forEach(u => h += `<tr><td>${esc(u.UserID)}</td><td>${esc(u.Name)}</td><td>${esc(u.Role)}</td><td>${esc(u.Branch)}</td>` +
      `<td>${u.Active?'Yes':'No'}</td><td>${esc((u.LastLogin||'').slice(0,10))}</td>` +
      `<td><button class="ghost" data-reset="${esc(u.UserID)}">Reset PW</button> ` +
      `<button class="ghost" data-toggle="${esc(u.UserID)}" data-active="${u.Active}">${u.Active?'Disable':'Enable'}</button></td></tr>`);
    $('u_list').innerHTML = h + '</table>';
  } catch (err) { $('u_list').innerHTML = `<p class="err">${err.message}</p>`; }
}
async function addUser() {
  $('u_msg').textContent = 'Saving…';
  try { await api('users_add', { user: { userId:val('u_Id'), name:val('u_Name'), role:val('u_Role'),
      branch:val('u_Branch'), password:val('u_Pw') } });
    $('u_msg').textContent = 'User added.'; $('u_Pw').value = ''; loadUsers();
  } catch (err) { $('u_msg').textContent = ''; alert(err.message); }
}
async function toggleUser(userId, active) { try { await api('users_update', { userId, active: !active }); loadUsers(); } catch (e) { alert(e.message); } }
async function resetUser(userId) { try { const { tempPassword } = await api('users_reset_pw', { userId });
  alert('New temp password for ' + userId + ':\n\n' + tempPassword); } catch (e) { alert(e.message); } }

/* -------------------------- MY PASSWORD ---------------------------- */
async function changePw() {
  $('cp_msg').textContent = '';
  try { await api('change_password', { oldPassword:val('cp_Old'), newPassword:val('cp_New') });
    $('cp_msg').textContent = 'Updated.'; $('cp_Old').value = $('cp_New').value = ''; }
  catch (err) { $('cp_msg').textContent = err.message; }
}
