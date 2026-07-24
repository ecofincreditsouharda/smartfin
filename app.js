/* ---- CONFIG: set after deploying the backend ---- */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwRuT2u72CRkkpx_kR4cL6zUdY_0AA0m-HPRkqZK4OC6D-hxD_RgWbXRQvRVUQaMB0j/exec';   // ends with /exec

let session = null;
const $ = id => document.getElementById(id);
const val = id => ($(id) ? $(id).value : '');
const rupee = n => (n === '' || n == null || isNaN(Number(String(n).replace(/[^0-9.\-]/g,''))))
  ? (n || '') : '₹ ' + Number(String(n).replace(/[^0-9.\-]/g,'')).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const token = () => localStorage.getItem('coop_token') || '';

async function api(action, payload = {}) {
  const res = await fetch(WEB_APP_URL, { method:'POST',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action, token: token() }, payload)) });
  const data = await res.json();
  if (!data.ok) { if (/sign in/i.test(data.error||'')) logout(); throw new Error(data.error || 'Request failed'); }
  return data;
}
const tableFrom = (rows) => {
  if (!rows || !rows.length) return '<p class="msg">Nothing to show.</p>';
  const cols = Object.keys(rows[0]);
  const money = /amount|emi|repayable|value|paid|balance|arrears|interest/i;
  let h = '<table><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  rows.forEach(r => h += '<tr>' + cols.map(c => `<td>${money.test(c) ? rupee(r[c]) : (r[c] ?? '')}</td>`).join('') + '</tr>');
  return h + '</table>';
};
const schedTable = (sch) => {
  let h = '<table><tr><th>#</th><th>Date</th><th>Opening</th><th>Interest</th><th>Principal</th><th>Instalment</th><th>Closing</th></tr>';
  sch.forEach(x => h += `<tr><td>${x.period}</td><td>${x.date}</td><td>${rupee(x.opening)}</td><td>${rupee(x.interest)}</td>` +
    `<td>${rupee(x.principal)}</td><td>${rupee(x.emi)}</td><td>${rupee(x.closing)}</td></tr>`);
  return h + '</table>';
};

/* ------------------------------ BOOT ------------------------------- */
window.addEventListener('DOMContentLoaded', async () => {
  if (token()) { try { const { user } = await api('me'); start(user); } catch { logout(); } }
});
document.addEventListener('click', e => {
  const t = e.target, d = t.dataset || {};
  if (t.id === 'loginBtn') return login();
  if (d.view) return showView(d.view);
  if (d.refresh) return refresh(d.refresh);
  const map = { l_add:addLoan, d_add:addDeposit, e_add:addExpense, r_load:loadLedger, r_add:addReceipt,
    rep_load:loadReport, set_save:saveSettings, u_add:addUser, cp_go:changePw, logoutBtn:logout };
  if (map[t.id]) return map[t.id]();
  if (d.loan) return showSchedule(d.loan);
  if (d.reset) return resetUser(d.reset);
  if (d.toggle) return toggleUser(d.toggle, d.active === 'true');
});

/* ------------------------------ AUTH ------------------------------- */
async function login() {
  $('loginMsg').textContent = '';
  try {
    const { token: tk, user } = await api('login', { userId: val('loginId').trim(), password: val('loginPw') });
    localStorage.setItem('coop_token', tk); $('loginPw').value = ''; start(user);
  } catch (err) { $('loginMsg').textContent = err.message; }
}
function logout(){ localStorage.removeItem('coop_token'); session = null; $('app').hidden = true; $('gate').hidden = false; }
function start(user) {
  session = user; $('gate').hidden = true; $('app').hidden = false;
  $('who').innerHTML = `${user.name}<br><b>${user.role}</b>${user.role!=='Admin' ? ' · '+(user.branch||'—') : ''}` +
    `<br><button id="logoutBtn" class="ghost">Sign out</button>`;
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = user.role === 'Admin' ? '' : 'none');
  const canAdd = user.role !== 'Staff';
  document.querySelectorAll('.add-only').forEach(el => el.style.display = canAdd ? '' : 'none');
  if (user.role === 'BranchManager') ['l_Branch','d_Branch','e_Branch'].forEach(id => { if($(id)){ $(id).value = user.branch; $(id).readOnly = true; }});
  showView('dashboard');
}
function showView(v) {
  document.querySelectorAll('.view').forEach(s => s.hidden = true);
  $('view-' + v).hidden = false;
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  refresh(v);
}
function refresh(v) {
  if (v === 'dashboard') loadDashboard();
  if (v === 'loans') loadList('loans_list', 'l_list', true);
  if (v === 'deposits') loadList('deposits_list', 'd_list');
  if (v === 'expenses') loadList('expenses_list', 'e_list');
  if (v === 'users' && session.role === 'Admin') loadUsers();
  if (v === 'settings' && session.role === 'Admin') loadSettings();
}

/* ----------------------------- DASHBOARD --------------------------- */
async function loadDashboard() {
  $('dash').innerHTML = '<p class="msg">Loading…</p>';
  try {
    const { stats } = await api('dashboard_stats');
    const cards = [
      ['Loans', stats.loanCount, ''],
      ['Amount Disbursed', rupee(stats.totalDisbursed), ''],
      ['Total Repayable', rupee(stats.totalRepayable), ''],
      ['Collected', rupee(stats.totalCollected), ''],
      ['Repayment Pending', rupee(stats.repaymentPending), 'warn'],
      ['Deposits', stats.depositCount + ' · ' + rupee(stats.totalDeposits), ''],
      ['Total Expenses', rupee(stats.totalExpenses), '']
    ];
    $('dash').innerHTML = cards.map(([label, value, cls]) =>
      `<div class="stat ${cls}"><span>${label}</span><b>${value}</b></div>`).join('');
  } catch (err) { $('dash').innerHTML = `<p class="err">${err.message}</p>`; }
}

/* --------------------------- REGISTERS ----------------------------- */
async function loadList(action, target, withSchedule) {
  try {
    const { rows } = await api(action);
    if (!rows.length) { $(target).innerHTML = '<p class="msg">Nothing to show.</p>'; return; }
    const cols = Object.keys(rows[0]);
    const money = /amount|emi|repayable|value|paid|balance|arrears|interest/i;
    let h = '<table><tr>' + cols.map(c => `<th>${c}</th>`).join('') + (withSchedule ? '<th></th>' : '') + '</tr>';
    rows.forEach(r => {
      h += '<tr>' + cols.map(c => `<td>${money.test(c) ? rupee(r[c]) : (r[c] ?? '')}</td>`).join('');
      if (withSchedule) h += `<td><button class="ghost" data-loan="${r[cols[0]]}">Schedule</button></td>`;
      h += '</tr>';
    });
    $(target).innerHTML = h + '</table>';
  } catch (err) { $(target).innerHTML = `<p class="err">${err.message}</p>`; }
}

async function addLoan() {
  $('l_msg').textContent = 'Saving…';
  try {
    const loan = { Borrower:val('l_Borrower'), MemberID:val('l_MemberID'), LoanType:val('l_LoanType'),
      Branch:val('l_Branch'), Amount:val('l_Amount'), RateAnnual:Number(val('l_RatePct'))/100,
      TenureMonths:val('l_TenureMonths'), Method:val('l_Method'), Frequency:val('l_Frequency'),
      SanctionDate:val('l_SanctionDate'), DisbursementDate:val('l_DisbursementDate'),
      FirstEMIDate:val('l_FirstEMIDate'), CustomEMI:val('l_CustomEMI') };
    const { id } = await api('loans_add', { loan });
    $('l_msg').textContent = 'Saved ' + id;
    await loadList('loans_list', 'l_list', true);
    showSchedule(id);
  } catch (err) { $('l_msg').textContent = ''; alert(err.message); }
}
async function addDeposit() {
  $('d_msg').textContent = 'Saving…';
  try {
    const deposit = { Depositor:val('d_Depositor'), MemberID:val('d_MemberID'), DepositType:val('d_DepositType'),
      Branch:val('d_Branch'), Amount:val('d_Amount'), RateAnnual:Number(val('d_RatePct'))/100,
      TenureMonths:val('d_TenureMonths'), StartDate:val('d_StartDate'), PayoutMode:val('d_PayoutMode'), Remarks:val('d_Remarks') };
    const { id } = await api('deposits_add', { deposit });
    $('d_msg').textContent = 'Saved ' + id; loadList('deposits_list', 'd_list');
  } catch (err) { $('d_msg').textContent = ''; alert(err.message); }
}
async function addExpense() {
  $('e_msg').textContent = 'Saving…';
  try {
    const expense = { Date:val('e_Date'), Category:val('e_Category'), Description:val('e_Description'),
      Branch:val('e_Branch'), Amount:val('e_Amount'), Remarks:val('e_Remarks') };
    const { id } = await api('expenses_add', { expense });
    $('e_msg').textContent = 'Saved ' + id; loadList('expenses_list', 'e_list');
  } catch (err) { $('e_msg').textContent = ''; alert(err.message); }
}

async function showSchedule(id) {
  try {
    const { result } = await api('loan_schedule', { loanId: id });
    const s = result.summary; $('l_schedCard').hidden = false;
    $('l_schedTitle').textContent = 'Schedule — ' + id + ' (' + s.method + ' · ' + (s.frequency||'Monthly') + ')';
    const rows = [['Effective Instalment', rupee(s.effEMI)],
      [s.frequency === 'Daily' ? 'Days' : 'Tenure', s.effTenure + (s.frequency === 'Daily' ? ' days' : ' mo')],
      ['Total Interest', rupee(s.totalInterest)], ['Total Repayable', rupee(s.totalRepayable)],
      ['Extra-Day Interest', rupee(s.extraInterest) + ' (' + s.extraDays + ' d)']];
    $('l_summary').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('l_sched').innerHTML = schedTable(result.schedule);
    $('l_schedCard').scrollIntoView({ behavior:'smooth' });
  } catch (err) { alert(err.message); }
}

/* --------------------------- REPAYMENTS ---------------------------- */
async function loadLedger() {
  const id = val('r_LoanId').trim(); if (!id) return;
  try {
    const { ledger } = await api('repayment_ledger', { loanId: id });
    const s = ledger.summary;
    $('r_summary').innerHTML = [['Total Payable', rupee(s.totalPayable)], ['Total Paid', rupee(s.totalPaid)],
      ['Balance Remaining', rupee(s.balanceRemaining)], ['Scheduled Due To-Date', rupee(s.scheduledDueToDate)],
      ['Arrears / (Advance)', rupee(s.arrears)], ['Next Due', s.nextDueDate + ' · ' + rupee(s.nextDueAmount)]]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('r_addCard').hidden = (session.role === 'Staff');
    $('r_recCard').hidden = false; $('r_receipts').innerHTML = tableFrom(ledger.receipts);
    $('r_schedCard').hidden = false; $('r_sched').innerHTML = schedTable(ledger.schedule);
  } catch (err) { alert(err.message); }
}
async function addReceipt() {
  const id = val('r_LoanId').trim(); if (!id) { alert('Load a loan first.'); return; }
  $('r_msg').textContent = 'Saving…';
  try {
    await api('repayment_add', { repayment: { LoanID:id, Date:val('r_Date'), Amount:val('r_Amount'),
      Mode:val('r_Mode'), Note:val('r_Note') } });
    $('r_msg').textContent = 'Recorded.'; $('r_Amount').value = ''; loadLedger();
  } catch (err) { $('r_msg').textContent = ''; alert(err.message); }
}

/* ----------------------------- REPORTS ----------------------------- */
async function loadReport() {
  $('rep_grid').innerHTML = '<p class="msg">Loading…</p>';
  try {
    const { grid } = await api('report_get', { sheet: val('rep_sheet') });
    let h = '<table>';
    grid.forEach((row, ri) => h += '<tr>' + row.map(c => (ri === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('') + '</tr>');
    $('rep_grid').innerHTML = h + '</table>';
  } catch (err) { $('rep_grid').innerHTML = `<p class="err">${err.message}</p>`; }
}

/* ----------------------------- SETTINGS ---------------------------- */
async function loadSettings() {
  try {
    const { settings } = await api('settings_get');
    $('set_form').innerHTML = settings.map(s =>
      `<label>${s.label}<input data-skey="${s.key}" type="${s.type==='date'?'date':(s.type==='number'?'number':'text')}" value="${s.value ?? ''}"></label>`).join('');
  } catch (err) { $('set_form').innerHTML = `<p class="err">${err.message}</p>`; }
}
async function saveSettings() {
  $('set_msg').textContent = 'Saving…';
  const values = {}; document.querySelectorAll('#set_form input').forEach(i => values[i.dataset.skey] = i.value);
  try { await api('settings_update', { values }); $('set_msg').textContent = 'Saved.'; }
  catch (err) { $('set_msg').textContent = ''; alert(err.message); }
}

/* ------------------------------ USERS ------------------------------ */
async function loadUsers() {
  try {
    const { users } = await api('users_list');
    let h = '<table><tr><th>User ID</th><th>Name</th><th>Role</th><th>Branch</th><th>Active</th><th>Last login</th><th></th></tr>';
    users.forEach(u => h += `<tr><td>${u.UserID}</td><td>${u.Name||''}</td><td>${u.Role}</td><td>${u.Branch||''}</td>` +
      `<td>${u.Active?'Yes':'No'}</td><td>${(u.LastLogin||'').slice(0,10)}</td>` +
      `<td><button class="ghost" data-reset="${u.UserID}">Reset PW</button> ` +
      `<button class="ghost" data-toggle="${u.UserID}" data-active="${u.Active}">${u.Active?'Disable':'Enable'}</button></td></tr>`);
    $('u_list').innerHTML = h + '</table>';
  } catch (err) { $('u_list').innerHTML = `<p class="err">${err.message}</p>`; }
}
async function addUser() {
  $('u_msg').textContent = 'Saving…';
  try {
    await api('users_add', { user: { userId:val('u_Id'), name:val('u_Name'), role:val('u_Role'),
      branch:val('u_Branch'), password:val('u_Pw') } });
    $('u_msg').textContent = 'User added.'; $('u_Pw').value = ''; loadUsers();
  } catch (err) { $('u_msg').textContent = ''; alert(err.message); }
}
async function toggleUser(userId, active) { try { await api('users_update', { userId, active: !active }); loadUsers(); } catch (e) { alert(e.message); } }
async function resetUser(userId) { try { const { tempPassword } = await api('users_reset_pw', { userId });
  alert('New temp password for ' + userId + ':\n\n' + tempPassword + '\n\nShare securely; they change it on login.'); } catch (e) { alert(e.message); } }

/* -------------------------- MY PASSWORD ---------------------------- */
async function changePw() {
  $('cp_msg').textContent = '';
  try { await api('change_password', { oldPassword:val('cp_Old'), newPassword:val('cp_New') });
    $('cp_msg').textContent = 'Updated.'; $('cp_Old').value = $('cp_New').value = ''; }
  catch (err) { $('cp_msg').textContent = err.message; }
}
