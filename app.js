/* ------------------------------------------------------------------ *
 *  CONFIG — set this after deploying the backend (see SETUP_GUIDE)     *
 * ------------------------------------------------------------------ */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyBl70LXkgBkhsL_wteXn_U51Sh6xA6f89i2V_Ukih3HNMrkTeaGzvlkLFuwqSVibPARA/exec';   // ends with /exec

let session = null;   // { userId, name, role, branch }
const $  = id => document.getElementById(id);
const rupee = n => '₹ ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const getToken = () => localStorage.getItem('coop_token') || '';

/* --------------------------- API CALL ------------------------------ *
 * text/plain avoids a CORS pre-flight (Apps Script doesn't answer OPTIONS). */
async function api(action, payload = {}) {
  const res = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action, token: getToken() }, payload))
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ------------------------------ BOOT ------------------------------- */
window.addEventListener('DOMContentLoaded', async () => {
  if (getToken()) { try { const { user } = await api('me'); startSession(user); } catch { logout(); } }
});

document.addEventListener('click', e => {
  const t = e.target;
  if (t.id === 'loginBtn')   login();
  if (t.id === 'refreshBtn') loadLoans();
  if (t.id === 'addBtn')     addLoan();
  if (t.id === 'userAddBtn') addUser();
  if (t.id === 'cpBtn')      changePassword();
  if (t.id === 'logoutBtn')  logout();
  if (t.dataset && t.dataset.loan)    showSchedule(t.dataset.loan);
  if (t.dataset && t.dataset.toggle)  toggleUser(t.dataset.toggle, t.dataset.active === 'true');
  if (t.dataset && t.dataset.reset)   resetUser(t.dataset.reset);
});

/* ------------------------------ AUTH ------------------------------- */
async function login() {
  $('loginMsg').textContent = '';
  try {
    const { token, user } = await api('login', { userId: $('loginId').value.trim(), password: $('loginPw').value });
    localStorage.setItem('coop_token', token);
    $('loginPw').value = '';
    startSession(user);
  } catch (err) { $('loginMsg').textContent = err.message; }
}
function logout() { localStorage.removeItem('coop_token'); session = null;
  $('app').hidden = true; $('gate').hidden = false; }

function startSession(user) {
  session = user;
  $('gate').hidden = true; $('app').hidden = false;
  $('who').innerHTML = `${user.name} · <b>${user.role}</b>` +
    (user.role !== 'Admin' ? ` · ${user.branch || '—'}` : '') +
    ` &nbsp; <button id="logoutBtn" class="ghost">Sign out</button>`;
  // role-based visibility
  $('addCard').hidden   = (user.role === 'Staff');                 // Staff = view only
  $('adminCard').hidden = (user.role !== 'Admin');
  if (user.role === 'BranchManager') { $('Branch').value = user.branch; $('Branch').readOnly = true; }
  loadLoans();
  if (user.role === 'Admin') loadUsers();
}

/* ------------------------------ LOANS ------------------------------ */
async function loadLoans() {
  try {
    const { loans } = await api('loans_list');
    if (!loans.length) { $('loans').innerHTML = '<p class="msg">No loans in your scope yet.</p>'; return; }
    let h = '<table><tr><th>Loan ID</th><th>Borrower</th><th>Branch</th><th>Method</th><th>Amount</th>' +
            '<th>Eff. EMI</th><th>Tenure</th><th>Total Repayable</th><th></th></tr>';
    loans.forEach(l => h +=
      `<tr><td>${l.LoanID}</td><td>${l.Borrower||''}</td><td>${l.Branch||''}</td><td>${l.Method}</td>` +
      `<td>${rupee(l.Amount)}</td><td>${rupee(l.EffectiveEMI)}</td><td>${l.EffectiveTenure}</td>` +
      `<td>${rupee(l.TotalRepayable)}</td>` +
      `<td><button class="ghost" data-loan="${l.LoanID}">Schedule</button></td></tr>`);
    $('loans').innerHTML = h + '</table>';
  } catch (err) { $('loans').innerHTML = `<p class="err">${err.message}</p>`; if (/sign in/i.test(err.message)) logout(); }
}

async function addLoan() {
  $('addMsg').textContent = 'Saving…';
  try {
    const loan = {
      Borrower:$('Borrower').value, MemberID:$('MemberID').value, LoanType:$('LoanType').value,
      Branch:$('Branch').value, Amount:$('Amount').value,
      RateAnnual: Number($('RatePct').value) / 100, TenureMonths:$('TenureMonths').value,
      Method:$('Method').value, SanctionDate:$('SanctionDate').value,
      DisbursementDate:$('DisbursementDate').value, FirstEMIDate:$('FirstEMIDate').value,
      CustomEMI:$('CustomEMI').value
    };
    const { loan: saved } = await api('loans_add', { loan });
    $('addMsg').textContent = 'Saved ' + saved.LoanID;
    await loadLoans();
    renderSchedule(saved.LoanID, saved.computed);
  } catch (err) { $('addMsg').textContent = ''; alert(err.message); }
}

async function showSchedule(id) {
  try { const { result } = await api('loan_schedule', { loanId: id }); renderSchedule(id, result); }
  catch (err) { alert(err.message); }
}

function renderSchedule(id, r) {
  const s = r.summary; $('schedCard').hidden = false;
  $('schedTitle').textContent = 'Schedule — ' + id + ' (' + s.method + ')';
  $('summary').innerHTML = [
    ['Principal', rupee(s.principal)], ['Rate (p.a.)', s.annualRatePct + ' %'],
    ['Base EMI', rupee(s.baseEMI)], ['Custom EMI', s.customEMI ? rupee(s.customEMI) : '—'],
    ['Effective EMI', rupee(s.effEMI)], ['Nominal Tenure', s.nominalTenure + ' mo'],
    ['Effective Tenure', s.effTenure + ' mo'], ['Total Interest', rupee(s.totalInterest)],
    ['Total Repayable', rupee(s.totalRepayable)],
    ['Extra-Day Interest', rupee(s.extraInterest) + ' (' + s.extraDays + ' days, add to EMI 1)']
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  let h = '<table><tr><th>#</th><th>Date</th><th>Opening</th><th>Interest</th>' +
          '<th>Principal</th><th>EMI</th><th>Closing</th></tr>';
  r.schedule.forEach(x => h +=
    `<tr><td>${x.period}</td><td>${x.date}</td><td>${rupee(x.opening)}</td><td>${rupee(x.interest)}</td>` +
    `<td>${rupee(x.principal)}</td><td>${rupee(x.emi)}</td><td>${rupee(x.closing)}</td></tr>`);
  $('schedule').innerHTML = h + '</table>';
  $('schedCard').scrollIntoView({ behavior: 'smooth' });
}

/* --------------------------- USER ADMIN ---------------------------- */
async function loadUsers() {
  try {
    const { users } = await api('users_list');
    let h = '<table><tr><th>User ID</th><th>Name</th><th>Role</th><th>Branch</th><th>Active</th>' +
            '<th>Last login</th><th></th></tr>';
    users.forEach(u => h +=
      `<tr><td>${u.UserID}</td><td>${u.Name||''}</td><td>${u.Role}</td><td>${u.Branch||''}</td>` +
      `<td>${u.Active ? 'Yes' : 'No'}</td><td>${(u.LastLogin||'').slice(0,10)}</td>` +
      `<td><button class="ghost" data-reset="${u.UserID}">Reset PW</button> ` +
      `<button class="ghost" data-toggle="${u.UserID}" data-active="${u.Active}">${u.Active?'Disable':'Enable'}</button></td></tr>`);
    $('users').innerHTML = h + '</table>';
  } catch (err) { $('users').innerHTML = `<p class="err">${err.message}</p>`; }
}
async function addUser() {
  $('userMsg').textContent = 'Saving…';
  try {
    await api('users_add', { user: { userId:$('uId').value, name:$('uName').value,
      role:$('uRole').value, branch:$('uBranch').value, password:$('uPw').value } });
    $('userMsg').textContent = 'User added.'; $('uPw').value = ''; loadUsers();
  } catch (err) { $('userMsg').textContent = ''; alert(err.message); }
}
async function toggleUser(userId, active) {
  try { await api('users_update', { userId, active: !active }); loadUsers(); }
  catch (err) { alert(err.message); }
}
async function resetUser(userId) {
  try { const { tempPassword } = await api('users_reset_pw', { userId });
    alert('New temporary password for ' + userId + ':\n\n' + tempPassword + '\n\nShare it securely; they should change it on login.');
  } catch (err) { alert(err.message); }
}

/* ----------------------- CHANGE MY PASSWORD ------------------------ */
async function changePassword() {
  $('cpMsg').textContent = '';
  try {
    await api('change_password', { oldPassword:$('cpOld').value, newPassword:$('cpNew').value });
    $('cpMsg').textContent = 'Password updated.'; $('cpOld').value = $('cpNew').value = '';
  } catch (err) { $('cpMsg').textContent = err.message; }
}
