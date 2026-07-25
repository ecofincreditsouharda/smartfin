/* ---- CONFIG ---- */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwRuT2u72CRkkpx_kR4cL6zUdY_0AA0m-HPRkqZK4OC6D-hxD_RgWbXRQvRVUQaMB0j/exec';   // ends with /exec

let session = null, lastSchedule = null, lastScheduleTitle = '';
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
const summaryHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
const tableFrom = (rows) => {
  if (!rows || !rows.length) return '<p class="msg">Nothing to show.</p>';
  const cols = Object.keys(rows[0]);
  const money = /amount|emi|repayable|value|paid|balance|arrears|due|payout|instal/i;
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
const fileToB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });

/* ------------------------------ BOOT ------------------------------- */
window.addEventListener('DOMContentLoaded', async () => {
  if (token()) { try { const { user } = await api('me'); start(user); } catch { logout(); } }
});
document.addEventListener('click', e => {
  const t = e.target, d = t.dataset || {};
  if (t.id === 'loginBtn') return login();
  if (d.view) return showView(d.view);
  if (d.refresh) return refresh(d.refresh);
  const map = { l_preview:previewLoan, l_add:addLoan, l_print:printSchedule,
    d_preview:previewDeposit, d_add:addDeposit, w_go:fdWithdraw,
    s_open:savingsOpen, st_go:savingsTxn, pb_load:loadPassbook, tf_go:doTransfer,
    m_add:addMember, e_add:addExpense, r_load:loadLedger, r_add:addReceipt,
    rep_load:loadReport, set_save:saveSettings, u_add:addUser, cp_go:changePw, logoutBtn:logout };
  if (map[t.id]) return map[t.id]();
  if (d.loan) return showSchedule(d.loan);
  if (d.member) return showMember(d.member);
  if (d.reset) return resetUser(d.reset);
  if (d.toggle) return toggleUser(d.toggle, d.active === 'true');
});

/* ------------------------------ AUTH ------------------------------- */
async function login() {
  $('loginMsg').textContent = '';
  try { const { token: tk, user } = await api('login', { userId: val('loginId').trim(), password: val('loginPw') });
    localStorage.setItem('coop_token', tk); $('loginPw').value = ''; start(user);
  } catch (err) { $('loginMsg').textContent = err.message; }
}
function logout(){ localStorage.removeItem('coop_token'); session = null; $('app').hidden = true; $('gate').hidden = false; }
function start(user) {
  session = user; $('gate').hidden = true; $('app').hidden = false;
  const canWrite = ['Admin','BranchManager','Operator'].includes(user.role);
  const canReport = canWrite, canSettings = ['Admin','BranchManager'].includes(user.role), isAdmin = user.role === 'Admin';
  $('who').innerHTML = `${user.name}<br><b>${user.role}</b>${(user.role!=='Admin'&&user.role!=='Director') ? ' · '+(user.branch||'—') : ''}` +
    `<br><button id="logoutBtn" class="ghost">Sign out</button>`;
  document.querySelectorAll('.add-only').forEach(el => el.style.display = canWrite ? '' : 'none');
  document.querySelectorAll('.report-only').forEach(el => el.style.display = canReport ? '' : 'none');
  document.querySelectorAll('.settings-only').forEach(el => el.style.display = canSettings ? '' : 'none');
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
  if (user.role === 'BranchManager' || user.role === 'Operator')
    ['l_Branch','d_Branch','e_Branch','m_Branch','s_Branch'].forEach(id => { if($(id)){ $(id).value = user.branch; $(id).readOnly = true; }});
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
  if (v === 'members') loadList('members_list', 'm_list', 'member');
  if (v === 'loans') loadList('loans_list', 'l_list', 'loan');
  if (v === 'deposits') loadList('deposits_list', 'd_list');
  if (v === 'savings') loadList('savings_list', 's_list');
  if (v === 'expenses') loadList('expenses_list', 'e_list');
  if (v === 'users' && session.role === 'Admin') loadUsers();
  if (v === 'settings' && ['Admin','BranchManager'].includes(session.role)) loadSettings();
}

/* ----------------------------- DASHBOARD --------------------------- */
async function loadDashboard() {
  $('dash').innerHTML = '<p class="msg">Loading…</p>'; $('dash_overdue').innerHTML = '';
  try {
    const { stats, overdue } = await api('dashboard_stats');
    $('dash').innerHTML = [
      ['Loans', stats.loanCount, ''], ['Amount Disbursed', rupee(stats.totalDisbursed), ''],
      ['Due This Month', rupee(stats.dueThisMonth), ''],
      ['Members in Arrears', stats.overdueCount, stats.overdueCount ? 'warn' : ''],
      ['Total Arrears', rupee(stats.totalArrears), stats.totalArrears > 0 ? 'warn' : '']
    ].map(([l, v, c]) => `<div class="stat ${c}"><span>${l}</span><b>${v}</b></div>`).join('');
    $('dash_overdue').innerHTML = overdue && overdue.length ? tableFrom(overdue)
      : '<p class="msg">No missed EMIs 🎉</p>';
  } catch (err) { $('dash').innerHTML = `<p class="err">${err.message}</p>`; }
}

/* --------------------------- GENERIC LIST -------------------------- */
async function loadList(action, target, linkKind) {
  try {
    const { rows } = await api(action);
    if (!rows.length) { $(target).innerHTML = '<p class="msg">Nothing to show.</p>'; return; }
    const cols = Object.keys(rows[0]);
    const money = /amount|emi|repayable|value|paid|balance|arrears|min/i;
    let h = '<table><tr>' + cols.map(c => `<th>${c}</th>`).join('') + (linkKind ? '<th></th>' : '') + '</tr>';
    rows.forEach(r => { h += '<tr>' + cols.map(c => `<td>${money.test(c) ? rupee(r[c]) : (r[c] ?? '')}</td>`).join('');
      if (linkKind === 'loan') h += `<td><button class="ghost" data-loan="${r[cols[0]]}">Schedule</button></td>`;
      if (linkKind === 'member') h += `<td><button class="ghost" data-member="${r[cols[0]]}">View</button></td>`;
      h += '</tr>'; });
    $(target).innerHTML = h + '</table>';
  } catch (err) { $(target).innerHTML = `<p class="err">${err.message}</p>`; }
}

/* ------------------------------ LOANS ------------------------------ */
function loanFromForm() {
  return { Borrower:val('l_Borrower'), MemberID:val('l_MemberID'), LoanType:val('l_LoanType'),
    Branch:val('l_Branch'), Amount:val('l_Amount'), RateAnnual:Number(val('l_RatePct'))/100,
    TenureMonths:val('l_TenureMonths'), Method:val('l_Method'), Frequency:val('l_Frequency'),
    SanctionDate:val('l_SanctionDate'), DisbursementDate:val('l_DisbursementDate'),
    FirstEMIDate:val('l_FirstEMIDate'), CustomEMI:val('l_CustomEMI') };
}
async function previewLoan() {
  $('l_msg').textContent = 'Calculating…';
  try { const { result } = await api('loan_preview', { loan: loanFromForm() });
    renderSchedule('PREVIEW (not yet saved)', result); $('l_add').hidden = false; $('l_msg').textContent = 'Preview ready — review, then Confirm & Save.';
  } catch (err) { $('l_msg').textContent = ''; alert(err.message); }
}
async function addLoan() {
  $('l_msg').textContent = 'Saving…';
  try { const { id } = await api('loans_add', { loan: loanFromForm() });
    $('l_msg').textContent = 'Saved ' + id; $('l_add').hidden = true;
    await loadList('loans_list', 'l_list', 'loan'); showSchedule(id);
  } catch (err) { $('l_msg').textContent = ''; alert(err.message); }
}
async function showSchedule(id) {
  try { const { result } = await api('loan_schedule', { loanId: id }); renderSchedule(id, result); }
  catch (err) { alert(err.message); }
}
function renderSchedule(title, result) {
  const s = result.summary; lastSchedule = result.schedule;
  lastScheduleTitle = 'Amortization — ' + title + ' (' + s.method + ' · ' + (s.frequency||'Monthly') + ')';
  $('l_schedCard').hidden = false; $('l_schedTitle').firstChild.textContent = 'Schedule — ' + title + '  ';
  $('l_summary').innerHTML = summaryHtml([['Effective Instalment', rupee(s.effEMI)],
    [s.frequency === 'Daily' ? 'Days' : 'Tenure', s.effTenure + (s.frequency === 'Daily' ? ' days' : ' mo')],
    ['Total Interest', rupee(s.totalInterest)], ['Total Repayable', rupee(s.totalRepayable)],
    ['Extra-Day Interest', rupee(s.extraInterest) + ' (' + s.extraDays + ' d)']]);
  $('l_sched').innerHTML = schedTable(result.schedule);
  $('l_schedCard').scrollIntoView({ behavior:'smooth' });
}
function printSchedule() {
  if (!lastSchedule) { alert('Load or preview a schedule first.'); return; }
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>${lastScheduleTitle}</title><style>
    @page { size: A4; margin: 2cm 1cm; }
    body { font-family: Arial, sans-serif; font-size: 11px; color:#000; }
    h3 { text-align:center; margin:0 0 12px; }
    table { width:100%; border-collapse:collapse; }
    th,td { border:1px solid #999; padding:4px 6px; text-align:right; }
    th:nth-child(2),td:nth-child(2){ text-align:left; }
  </style></head><body><h3>${lastScheduleTitle}</h3>${schedTable(lastSchedule)}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { w.print(); }, 300);
}

/* --------------------------- REPAYMENTS ---------------------------- */
async function loadLedger() {
  const id = val('r_LoanId').trim(); if (!id) return;
  try { const { ledger } = await api('repayment_ledger', { loanId: id }); const s = ledger.summary;
    $('r_summary').innerHTML = summaryHtml([['Total Payable', rupee(s.totalPayable)], ['Total Paid', rupee(s.totalPaid)],
      ['Balance Remaining', rupee(s.balanceRemaining)], ['Scheduled Due To-Date', rupee(s.scheduledDueToDate)],
      ['Arrears / (Advance)', rupee(s.arrears)], ['Next Due', s.nextDueDate + ' · ' + rupee(s.nextDueAmount)]]);
    $('r_addCard').hidden = (session.role === 'Director');
    $('r_recCard').hidden = false; $('r_receipts').innerHTML = tableFrom(ledger.receipts);
    $('r_schedCard').hidden = false; $('r_sched').innerHTML = schedTable(ledger.schedule);
  } catch (err) { alert(err.message); }
}
async function addReceipt() {
  const id = val('r_LoanId').trim(); if (!id) { alert('Load a loan first.'); return; }
  $('r_msg').textContent = 'Saving…';
  try { const { receiptNo } = await api('repayment_add', { repayment: { LoanID:id, Date:val('r_Date'),
      Amount:val('r_Amount'), Mode:val('r_Mode'), Note:val('r_Note') } });
    $('r_msg').textContent = 'Receipt ' + receiptNo; $('r_Amount').value = ''; loadLedger();
  } catch (err) { $('r_msg').textContent = ''; alert(err.message); }
}

/* --------------------------- FIXED DEPOSITS ------------------------ */
function depositFromForm() {
  return { Depositor:val('d_Depositor'), MemberID:val('d_MemberID'), DepositType:'Fixed Deposit',
    Branch:val('d_Branch'), Amount:val('d_Amount'), RateAnnual:Number(val('d_RatePct'))/100,
    TenureMonths:val('d_TenureMonths'), StartDate:val('d_StartDate'), PayoutMode:val('d_PayoutMode'), Remarks:val('d_Remarks') };
}
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
  try { const { id } = await api('deposits_add', { deposit: depositFromForm() });
    $('d_msg').textContent = 'Saved ' + id; $('d_add').hidden = true; loadList('deposits_list', 'd_list');
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
      Branch:val('s_Branch'), Rate:Number(val('s_Rate'))/100, MinBalance:val('s_MinBalance'), OpenDate:val('s_OpenDate') } });
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
    $('pb_summary').innerHTML = summaryHtml([['Member', passbook.account.Member], ['Balance', rupee(passbook.account.Balance)],
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

/* ------------------------------ MEMBERS ---------------------------- */
async function addMember() {
  $('m_msg').textContent = 'Saving…';
  try {
    const member = { FullName:val('m_FullName'), DOB:val('m_DOB'), Phone:val('m_Phone'), Address:val('m_Address'),
      Aadhaar:val('m_Aadhaar'), PAN:val('m_PAN'), BankAccount:val('m_BankAccount'), IFSC:val('m_IFSC'), Branch:val('m_Branch') };
    const f = $('m_Photo').files[0];
    if (f) { member.PhotoBase64 = await fileToB64(f); member.PhotoMime = f.type; }
    const { memberId } = await api('members_add', { member });
    $('m_msg').textContent = 'Saved ' + memberId; $('m_Photo').value = ''; loadList('members_list', 'm_list', 'member');
  } catch (err) { $('m_msg').textContent = ''; alert(err.message); }
}
async function showMember(id) {
  try { const { member } = await api('member_get', { memberId: id }); $('m_card').hidden = false;
    $('m_detail').innerHTML = summaryHtml([['Member ID', member.MemberID], ['Full Name', member.FullName],
      ['DOB', member.DOB], ['Phone', member.Phone], ['Address', member.Address], ['Aadhaar', member.Aadhaar],
      ['PAN', member.PAN], ['Bank A/C', member.BankAccount], ['IFSC', member.IFSC], ['Branch', member.Branch]]) +
      (member.PhotoUrl ? `<div style="margin-top:10px"><a href="${member.PhotoUrl}" target="_blank">View photo</a></div>` : '');
    $('m_card').scrollIntoView({ behavior:'smooth' });
  } catch (err) { alert(err.message); }
}

/* ------------------------------ EXPENSES --------------------------- */
async function addExpense() {
  $('e_msg').textContent = 'Saving…';
  try { const { id } = await api('expenses_add', { expense: { Date:val('e_Date'), Category:val('e_Category'),
      Description:val('e_Description'), Branch:val('e_Branch'), Amount:val('e_Amount'), Remarks:val('e_Remarks') } });
    $('e_msg').textContent = 'Saved ' + id; loadList('expenses_list', 'e_list');
  } catch (err) { $('e_msg').textContent = ''; alert(err.message); }
}

/* ------------------------------ REPORTS ---------------------------- */
async function loadReport() {
  $('rep_grid').innerHTML = '<p class="msg">Loading…</p>';
  try { const { grid } = await api('report_get', { sheet: val('rep_sheet') });
    let h = '<table>'; grid.forEach((row, ri) => h += '<tr>' + row.map(c => (ri === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('') + '</tr>');
    $('rep_grid').innerHTML = h + '</table>';
  } catch (err) { $('rep_grid').innerHTML = `<p class="err">${err.message}</p>`; }
}

/* ------------------------------ SETTINGS --------------------------- */
async function loadSettings() {
  try { const { settings } = await api('settings_get');
    $('set_form').innerHTML = settings.map(s => `<label>${s.label}<input data-skey="${s.key}" ` +
      `type="${s.type==='date'?'date':(s.type==='number'?'number':'text')}" value="${s.value ?? ''}"></label>`).join('');
  } catch (err) { $('set_form').innerHTML = `<p class="err">${err.message}</p>`; }
}
async function saveSettings() {
  $('set_msg').textContent = 'Saving…'; const values = {};
  document.querySelectorAll('#set_form input').forEach(i => values[i.dataset.skey] = i.value);
  try { await api('settings_update', { values }); $('set_msg').textContent = 'Saved.'; }
  catch (err) { $('set_msg').textContent = ''; alert(err.message); }
}

/* ------------------------------ USERS ------------------------------ */
async function loadUsers() {
  try { const { users } = await api('users_list');
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
