/* ── CONFIG ──────────────────────────────────────────────────── */
const WEB_APP_URL = 'https://tgopjjtamvoftzdfvzuc.supabase.co/functions/v1/api';
const IDLE_MS = 60 * 1000;

let session = null, lastSchedule = null, lastMeta = null, lastReceipt = null, curLoanId = '';
let editing = { type:null, id:null }, lastVoucher = null, repLoans = [];
let BANK = 'ECOSMART', APP_NAME = 'ECOSMART', LOGO_URL = 'logo.png';
let HQ_ADDRESS = '', HQ_PHONE = '', COMMON_EMAIL = '';
const $ = id => document.getElementById(id);
const val = id => ($(id) ? $(id).value : '');
const rupee = n => (n===''||n==null||isNaN(Number(String(n).replace(/[^0-9.\-]/g,''))))
  ? (n||'') : '\u20b9\u00a0'+Number(String(n).replace(/[^0-9.\-]/g,'')).toLocaleString('en-IN',{maximumFractionDigits:2});
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const token = () => localStorage.getItem('coop_token') || '';
const isPWA = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ── API ─────────────────────────────────────────────────────── */
async function api(action, payload={}) {
  try {
    const res = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action, token: token() }, payload))
    });
    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      throw new Error(`HTTP ${res.status}: ${res.statusText||txt||'Server error'}`);
    }
    const data = await res.json();
    if (!data.ok) {
      if (/sign in/i.test(data.error||'')) logout();
      throw new Error(data.error || 'Request failed');
    }
    return data;
  } catch(err) {
    // Log the real error so it appears in browser DevTools console
    console.error('[API]', action, err);
    const msg = err.message || '';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed') || msg.includes('fetch')) {
      throw new Error('Cannot reach server.\n\nOpen browser DevTools (F12) → Console to see the real error.\n\nMost likely: re-deploy the Supabase function:\n  supabase functions deploy api');
    }
    throw err;
  }
}
const summaryHtml = pairs => pairs.map(([k,v])=>`<div><span>${esc(k)}</span><b>${v}</b></div>`).join('');
const tableFrom = rows => {
  if (!rows||!rows.length) return '<p class="msg">Nothing to show.</p>';
  const cols=Object.keys(rows[0]);
  // Right-align only clear money/numeric columns; everything else left-aligned
  const isNum=c=>/^(amount|emi|repayable|value|paid|balance|arrears|payout|instalment|principal|interest|closing|opening|rate|min.?bal|outstanding)/i.test(c.trim());
  let h='<table><thead><tr>'+cols.map(c=>`<th${isNum(c)?' class="num"':''}>${esc(c)}</th>`).join('')+'</tr></thead><tbody>';
  rows.forEach(r=>h+='<tr>'+cols.map(c=>{
    const num=isNum(c);
    const v=num?rupee(r[c]):esc(r[c]);
    return `<td${num?' class="num"':''}>${v}</td>`;
  }).join('')+'</tr>');
  return h+'</tbody></table>';
};
const schedTable = sch => {
  let h='<table><tr><th>#</th><th>Date</th><th>Opening</th><th>Interest</th><th>Principal</th><th>Instalment</th><th>Closing</th></tr>';
  sch.forEach(x=>h+=`<tr><td>${x.period}</td><td>${x.date}</td><td>${rupee(x.opening)}</td><td>${rupee(x.interest)}</td><td>${rupee(x.principal)}</td><td>${rupee(x.emi)}</td><td>${rupee(x.closing)}</td></tr>`);
  return h+'</table>';
};
const fileToB64 = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(f);});

/* ── SINGLE SESSION (Fix #9) ─────────────────────────────────── */
// BroadcastChannel forces logout on other tabs/windows when a new login happens
const _sessionChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('coop_session') : null;
if(_sessionChannel){
  _sessionChannel.onmessage = e => {
    if(e.data && e.data.type === 'new_login' && session){
      // Another window/tab just logged in — log out this one silently
      clearTimeout(idleTimer);
      localStorage.removeItem('coop_token');
      session=null;
      if($('app'))$('app').hidden=true;
      if($('splash'))$('splash').hidden=false;
      if($('gate'))$('gate').hidden=true;
      if($('loginMsg'))$('loginMsg').textContent='Signed in from another device/tab.';
      setTimeout(()=>{if($('splash'))$('splash').hidden=true;if($('gate'))$('gate').hidden=false;},1400);
    }
  };
}

/* ── IDLE AUTO-LOGOUT ────────────────────────────────────────── */
let idleTimer=null;
function resetIdle(){if(!session)return;clearTimeout(idleTimer);
  idleTimer=setTimeout(()=>{logout();const t=$('inactivity-toast');if(t){t.style.display='block';setTimeout(()=>t.style.display='none',5000);}},IDLE_MS);}
['click','keydown','mousemove','touchstart','scroll'].forEach(ev=>document.addEventListener(ev,resetIdle,{passive:true}));

/* ── BOOT ────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  LOGO_URL = new URL('logo.png', location.href).href;
  if ($('loginMsg')) $('loginMsg').textContent='';
  localStorage.removeItem('coop_token');
  // Password toggle for login page — direct button handler (fix #1)
  setupPwToggle('loginPwToggle','loginPw');
  setupPwToggle('cpOldToggle','cp_Old');
  setupPwToggle('cpNewToggle','cp_New');
  // Show PDF button only in PWA
  if ($('r_pdf')) $('r_pdf').style.display = isPWA() ? 'inline-flex' : 'none';
  try{
    const bi=await api('bank_info');
    if(bi.bankName) BANK=bi.bankName;
    if(bi.appName){APP_NAME=bi.appName;localStorage.setItem('coop_app_name',APP_NAME);}
    else{APP_NAME=localStorage.getItem('coop_app_name')||'ECOSMART';}
  }catch(e){APP_NAME=localStorage.getItem('coop_app_name')||'ECOSMART';}
  applyBranding(APP_NAME, BANK);
  // Apply app name immediately to login page (Fix 2)
  if($('loginName')) $('loginName').textContent = APP_NAME;
  if($('splashName')) $('splashName').textContent = APP_NAME;
  setTimeout(()=>{$('splash').hidden=true;$('gate').hidden=false;},1600);
});


function setupPwToggle(btnId, inputId) {
  const btn = $(btnId); if (!btn) return;
  btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const inp = $(inputId); if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.classList.toggle('active', show);
  });
}

function applyBranding(appName, bankName){
  // APP_NAME = application/UI name shown in splash, login header, topbar, nav
  // BANK     = cooperative/bank name used ONLY in printed docs (receipts, passbooks, vouchers, reports)
  if(appName) APP_NAME = appName;
  if(bankName) BANK = bankName;
  document.title = APP_NAME;
  if($('splashName'))    $('splashName').textContent    = APP_NAME;
  if($('loginName'))     $('loginName').textContent     = APP_NAME;
  if($('brandName'))     $('brandName').textContent     = APP_NAME;
  if($('nav_bank'))      $('nav_bank').textContent      = APP_NAME; // nav shows app name
  if($('login_bankname'))$('login_bankname').textContent= BANK;     // login footer shows bank name
}

/* ── EVENTS ──────────────────────────────────────────────────── */
document.addEventListener('change',e=>{
  if(e.target.id==='r_Mode')$('r_UtrWrap').hidden=(e.target.value!=='UPI');
  if(e.target.id==='rep_sheet')repPeriodToggle();
  if(e.target.id==='e_Category')$('e_ToWrap').hidden=(e.target.value!=='External Expenses');
});
document.addEventListener('blur',async e=>{
  if(e.target.id==='l_Borrower'&&val('l_Borrower').trim()&&!val('l_MemberID').trim()){
    const m=await autofillMember(val('l_Borrower').trim(),null,'l_MemberID');
    if(m&&m.Branch&&$('l_Branch')&&!$('l_Branch').disabled){setSelectValue('l_Branch',m.Branch);loadCollectorsForBranch(m.Branch);}
  }
  if(e.target.id==='l_MemberID'&&val('l_MemberID').trim()&&!val('l_Borrower').trim()){
    const m=await autofillMember(val('l_MemberID').trim(),'l_Borrower',null);
    if(m&&m.Branch&&$('l_Branch')&&!$('l_Branch').disabled){setSelectValue('l_Branch',m.Branch);loadCollectorsForBranch(m.Branch);}
  }
  if(e.target.id==='s_MemberID'&&val('s_MemberID').trim()) await autofillMember(val('s_MemberID').trim(),'s_MemberName',null);
  if(e.target.id==='l_G1MemberID'&&val('l_G1MemberID').trim()) await autofillMember(val('l_G1MemberID').trim(),'l_G1Name',null);
  if(e.target.id==='l_G2MemberID'&&val('l_G2MemberID').trim()) await autofillMember(val('l_G2MemberID').trim(),'l_G2Name',null);
  if(e.target.id==='d_MemberID'&&val('d_MemberID').trim()) await autofillMember(val('d_MemberID').trim(),'d_Depositor',null);
  if(e.target.id==='tf_From'&&val('tf_From').trim()){try{const{account}=await api('savings_lookup',{query:val('tf_From').trim()});if($('tf_FromName'))$('tf_FromName').value=account.MemberName||'';}catch(e){}}
  if(e.target.id==='tf_To'&&val('tf_To').trim()){try{const{account}=await api('savings_lookup',{query:val('tf_To').trim()});if($('tf_ToName'))$('tf_ToName').value=account.MemberName||'';}catch(e){}}
},true);
document.addEventListener('input',e=>{
  if(e.target.id==='r_search')filterLoanList();
  if(e.target.id==='l_search')filterList(allLoans,val('l_search'),'l_list','loan','loans');
  if(e.target.id==='d_search')filterList(allDeposits,val('d_search'),'d_list',null,'deposits');
  if(e.target.id==='s_search')filterList(allSavings,val('s_search'),'s_list');
  if(e.target.id==='m_search')filterList(allMembers,val('m_search'),'m_list','member','member');
});
document.addEventListener('click',e=>{
  const t=e.target, d=t.dataset||{};
  if(t.id==='hamburger') return toggleNav();
  if(t.id==='backdrop')  return toggleNav(false);
  if(t.id==='loginBtn')  return login();
  if(d.view)    return showView(d.view);
  if(d.refresh) return refresh(d.refresh, true);  // manual = show toast
  if(d.clear)   return clearForm(d.clear);
  if(d.edituser) return startUserEdit(d.edituser);
  if(d.rprint)  return printPastReceipt(d.rprint);
  if(d.voucher) return printPastVoucher(d.voucher);
  if(d.photo)   return showPhoto(d.photo);
  if(d.bredit)  return fillBranch(d.bredit);
  if(t.id==='modal_close'||t.id==='modal') return closeModal();
  if(d.edit){const i=d.edit.indexOf(':');return startEdit(d.edit.slice(0,i),d.edit.slice(i+1));}
  if(d.openledger) return openLedger(d.openledger);
  if(d.approveaction) return handleApprovalAction(d.approveaction, d.loanid);
  if(d.resubmit) return resubmitApproval(d.resubmit);
  const map={
    l_preview:previewLoan, l_add:addLoan, l_print:printSchedule, l_min:()=>{$('l_schedCard').hidden=true;},
    d_preview:previewDeposit, d_add:addDeposit, w_go:fdWithdraw, s_open:savingsOpen, st_go:savingsTxn,
    pb_load:loadPassbook, pb_print:printPassbook, tf_go:doTransfer, m_add:addMember,
    e_add:addExpense, e_print:()=>printVoucher(lastVoucher), m_close:()=>{$('m_card').hidden=true;},
    m_delete:deleteMember, ap_submit:submitApproval, ap_clear:clearApprovalForm, ap_clearall:clearApprovalView,
    r_load:()=>openLedger(val('r_LoanId').trim()), r_add:addReceipt,
    r_print:()=>printReceiptObj(lastReceipt), r_pdf:()=>pdfReceiptObj(lastReceipt),
    r_min:minimiseLedger, rep_load:loadReport, rep_print:printReport,
    soc_save:socSave, soc_txn:socTxn, br_save:branchSave,
    set_save:saveSettings, hier_save:saveHierarchy, hier_reset:resetHierarchy,
    u_add:addUser, mp_load:loadModulePerms, mp_save:saveModulePerms, mp_reset_perms:resetModulePerms,
    cp_go:changePw, prof_save:saveProfile, prof_photo_save:saveProfilePhoto,
    reset_go:resetAll, logoutBtn:logout
  };
  if(map[t.id]) return map[t.id]();
  if(d.loan)   return showSchedule(d.loan);
  if(d.member) return showMember(d.member);
  if(d.reset)  return resetUser(d.reset);
  if(d.toggle) return toggleUser(d.toggle, d.active==='true');
});
function toggleSection(id,btn){
  const el=$(id);if(!el)return;
  const hidden=el.style.display==='none';
  el.style.display=hidden?'':'none';
  if(btn)btn.textContent=hidden?'Minimise':'Expand';
}
function toggleNav(open){const n=$('nav'),b=$('backdrop');
  const show=open===undefined?!n.classList.contains('open'):open;
  n.classList.toggle('open',show);b.classList.toggle('show',show);}

/* ── AUTH ────────────────────────────────────────────────────── */
async function login(){
  const msg=$('loginMsg');
  if(msg){ msg.style.color='#6b7280'; msg.textContent='Signing in…'; }
  try{
    const{token:tk,user}=await api('login',{userId:val('loginId').trim(),password:val('loginPw')});
    localStorage.setItem('coop_token',tk); $('loginPw').value='';
    if(msg){ msg.textContent=''; msg.style.color=''; }
    if(_sessionChannel) _sessionChannel.postMessage({type:'new_login',userId:user.userId});
    start(user);
  }catch(err){
    if(msg){ msg.style.color='#dc2626'; msg.textContent=err.message||'Login failed.'; }
    console.error('[Login error]', err);
  }
}
function logout(){
  clearTimeout(idleTimer);localStorage.removeItem('coop_token');session=null;
  $('app').hidden=true;$('splash').hidden=false;$('gate').hidden=true;
  $('loginMsg').textContent='';
  setTimeout(()=>{$('splash').hidden=true;$('gate').hidden=false;},1400);
}

/* ── MODULE PERMISSIONS (localStorage per userId) ────────────── */
const ALL_MODULES=['dashboard','members','loans','repayments','deposits','savings','transfers','society','expenses','reports','approvals','settings','users','account'];
const DEFAULT_MODULES={
  Admin: ALL_MODULES,
  CEO: ['dashboard','members','loans','repayments','deposits','savings','transfers','society','expenses','reports','approvals','account'],
  BranchManager: ['dashboard','members','loans','repayments','deposits','savings','transfers','expenses','reports','approvals','settings','account'],
  Operator: ['dashboard','members','loans','repayments','deposits','savings','expenses','account'],
  Collector: ['dashboard','repayments','account'],
  Director: ['dashboard','loans','reports','approvals','account'],
};
function getModulePerms(userId, role){
  const key='modperms_'+userId;
  const stored=localStorage.getItem(key);
  if(stored){try{return JSON.parse(stored);}catch(e){}}
  return (DEFAULT_MODULES[role]||['dashboard','account']).slice();
}
function setModulePerms(userId, perms){ localStorage.setItem('modperms_'+userId, JSON.stringify(perms)); }
function applyModulePerms(userId, role){
  const allowed=getModulePerms(userId,role);
  document.querySelectorAll('.navbtn[data-view]').forEach(b=>{
    const v=b.dataset.view;
    if(!allowed.includes(v)) b.style.display='none';
  });
}

/* ── START (after login) ─────────────────────────────────────── */
async function start(user){
  session=user;
  if(user.bankName){ BANK=user.bankName; }
  try{
    const bi2=await api('bank_info');
    if(bi2.appName){APP_NAME=bi2.appName;localStorage.setItem('coop_app_name',APP_NAME);}
    else{APP_NAME=localStorage.getItem('coop_app_name')||'ECOSMART';}
  }catch(e){APP_NAME=localStorage.getItem('coop_app_name')||'ECOSMART';}
  applyBranding(APP_NAME, BANK);
  $('gate').hidden=true;$('splash').hidden=true;$('app').hidden=false;resetIdle();
  const role=user.role;
  const canWrite    =['Admin','CEO','BranchManager','Operator','Collector'].includes(role);
  const canReport   =canWrite;
  const canSettings =['Admin','CEO','BranchManager'].includes(role);
  const canSociety  =['Admin','CEO','BranchManager'].includes(role);
  const isAdmin     =role==='Admin';

  const roleLabel=role.replace(/([a-z])([A-Z])/g,'$1 $2');
  const branchLabel=(role!=='Admin'&&role!=='Director')?' · '+esc(user.branch||'—'):'';

  // Topbar: show avatar + name + sign out
  const avatar=localStorage.getItem('avatar_'+user.userId);
  const avatarHtml=avatar
    ?`<img src="${avatar}" class="topbar-avatar" title="My profile" onclick="showView('account')" />`
    :`<div class="topbar-avatar-placeholder" title="My profile" onclick="showView('account')">${esc((user.name||'?')[0].toUpperCase())}</div>`;
  $('who').innerHTML=
    `${avatarHtml}`+
    `<div style="text-align:right"><div style="font-size:13px;font-weight:600;color:#111827">${esc(user.name)}</div>`+
    `<div style="font-size:11px;color:#6b7280">${esc(roleLabel)}${branchLabel}</div></div>`+
    `<button id="logoutBtn" style="margin-left:8px">Sign out</button>`;

  // Sidebar last-login + avatar (PWA)
  if($('nav_lastlogin')){
    const avHtml=avatar
      ?`<img src="${avatar}" class="nl-avatar" />`
      :`<div class="nl-avatar-ph">${esc((user.name||'?')[0].toUpperCase())}</div>`;
    $('nav_lastlogin').innerHTML=
      avHtml+
      `<div class="nl-info">`+
      `<div class="nl-name">${esc(user.name)}</div>`+
      `<div class="nl-role">${esc(roleLabel)}${branchLabel}</div>`+
      (user.lastLogin?`<div class="nl-login">Last login: ${esc(user.lastLogin)}</div>`:'')+
      `</div>`;
  }

  // Role-based visibility
  document.querySelectorAll('.add-only').forEach(el    =>el.style.display=canWrite    ?'':'none');
  document.querySelectorAll('.report-only').forEach(el =>el.style.display=canReport   ?'':'none');
  document.querySelectorAll('.settings-only').forEach(el=>el.style.display=canSettings?'':'none');
  document.querySelectorAll('.society-only').forEach(el =>el.style.display=canSociety  ?'':'none');
  document.querySelectorAll('.admin-only').forEach(el  =>el.style.display=isAdmin     ?'':'none');
  if(role==='Director'){
    document.querySelectorAll('.no-director').forEach(el=>el.style.display='none');
    document.querySelectorAll('.no-director-passbook').forEach(el=>el.style.display='none');
    document.querySelectorAll('.report-only').forEach(el=>el.style.display='block');
  }
  const canApproval=['Admin','CEO','BranchManager','Director'].includes(role);
  document.querySelectorAll('.approval-role').forEach(el=>{
    if(!canApproval){el.style.display='none';return;}
    if(role==='Director'&&el.classList.contains('add-only')){el.style.display='none';return;}
    el.style.display=(el.tagName==='BUTTON')?'inline-block':'block';
  });
  // Apply per-user module permissions (overrides defaults)
  applyModulePerms(user.userId, role);
  // Show PDF button in PWA
  if($('r_pdf')) $('r_pdf').style.display=isPWA()?'inline-flex':'none';
  // applyBranding already sets nav_bank to APP_NAME — no need to repeat here
  populateBranchSelects(); populateCollectorSelect();
  loadProfile();
  checkApprovalNotifications();
  showView('dashboard');
}

/* ── NAVIGATION ──────────────────────────────────────────────── */
async function populateBranchSelects(){
  let names=[];
  try{const{branches}=await api('branches_list');names=(branches||[]).map(b=>b.Branch).filter(Boolean);}catch(e){}
  if(!names.length) names=['Main Branch'];
  const locked=(session.role==='BranchManager'||session.role==='Operator');
  document.querySelectorAll('select.branch-select').forEach(sel=>{
    const cur=sel.value;
    sel.innerHTML=names.map(n=>`<option>${esc(n)}</option>`).join('');
    if(locked&&session.branch){if(!names.includes(session.branch))sel.innerHTML+=`<option>${esc(session.branch)}</option>`;sel.value=session.branch;sel.disabled=true;}
    else if(cur&&names.includes(cur)) sel.value=cur;
  });
}
function showView(v){
  document.querySelectorAll('.view').forEach(s=>s.hidden=true);
  const vEl=$('view-'+v); if(!vEl) return;
  vEl.hidden=false;
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  toggleNav(false); refresh(v);
}
function refresh(v, manual=false){
  if(v==='dashboard')   loadDashboard();
  if(v==='members'){loadList('members_list','m_list','member','member').then(()=>{if(manual)showToast('Members refreshed','ok');});}
  if(v==='loans')       loadList('loans_list','l_list','loan','loans');
  if(v==='deposits')    loadList('deposits_list','d_list',null,'deposits');
  if(v==='savings')     loadList('savings_list','s_list');
  if(v==='expenses')    loadList('expenses_list','e_list',null,'expenses');
  if(v==='repayments')  loadRepaymentLoans();
  if(v==='society'&&session.role) loadSociety();
  if(v==='approvals')   loadApprovals();
  if(v==='reports'){
    repPeriodToggle();
    if(!val('rep_from')){
      const now=new Date(); const fyYear=now.getMonth()>=3?now.getFullYear():now.getFullYear()-1;
      $('rep_from').value=`${fyYear}-04-01`; $('rep_to').value=now.toISOString().split('T')[0];
    }
  }
  if(v==='users'&&session.role==='Admin'){loadUsers();loadUserDropdown();}
  if(v==='settings'&&['Admin','BranchManager'].includes(session.role)){loadSettings();loadBranches();if(session.role==='Admin')loadHierarchy();}
}

/* ── TOAST ───────────────────────────────────────────────────── */
function showToast(msg,type){
  let t=$('app-toast');
  if(!t){t=document.createElement('div');t.id='app-toast';document.body.appendChild(t);}
  t.textContent=msg; t.className='toast toast-'+(type||'ok')+' toast-show';
  clearTimeout(t._timer); t._timer=setTimeout(()=>{t.className='toast';},4000);
}

/* ── DASHBOARD ───────────────────────────────────────────────── */
async function loadDashboard(){
  $('dash').innerHTML='<p class="msg">Loading…</p>';$('dash_overdue').innerHTML='';
  try{const{stats,overdue,extraStats}=await api('dashboard_stats');
    let html=[['Loans',stats.loanCount,''],['Amount Disbursed',rupee(stats.totalDisbursed),''],
      ['Due This Month',rupee(stats.dueThisMonth),''],['Members in Arrears',stats.overdueCount,stats.overdueCount?'warn':''],
      ['Total Arrears',rupee(stats.totalArrears),stats.totalArrears>0?'warn':'']]
      .map(([l,v,c])=>`<div class="stat ${c}"><span>${l}</span><b>${v}</b></div>`).join('');
    if(extraStats) html+=[['Interest Due This Month',rupee(extraStats.interestDueMonth),''],
      ['Principal Due This Month',rupee(extraStats.principalDueMonth),''],
      ['New Loans This Month',extraStats.newLoansThisMonth,'']]
      .map(([l,v,c])=>`<div class="stat ${c}"><span>${l}</span><b>${v}</b></div>`).join('');
    $('dash').innerHTML=html;
    $('dash_overdue').innerHTML=overdue&&overdue.length?tableFrom(overdue):'<p class="msg">No missed EMIs.</p>';
    if(extraStats&&extraStats.newLoansDetail&&extraStats.newLoansDetail.length){
      let nt='<table><thead><tr><th>Loan ID</th><th>Borrower</th><th class="num">Amount</th><th>Date</th></tr></thead><tbody>';
      extraStats.newLoansDetail.forEach(r=>nt+=`<tr><td>${esc(r['Loan ID']||r.loan_id||'')}</td><td>${esc(r.Borrower||r.borrower||'')}</td><td class="num">${rupee(r.Amount||r.amount)}</td><td>${esc(r.Date||r.date||'')}</td></tr>`);
      $('dash_overdue').innerHTML+='<h3 style="margin-top:16px">New Loans This Month</h3>'+nt+'</tbody></table>';}
  }catch(err){$('dash').innerHTML=`<p class="err">${err.message}</p>`;}
}

/* ── GENERIC LIST ────────────────────────────────────────────── */
async function loadList(action,target,linkKind,editKey){
  try{const{rows}=await api(action);
    if(action==='loans_list')    allLoans=rows;
    if(action==='deposits_list') allDeposits=rows;
    if(action==='savings_list'){
      allSavings=rows;
      // Format Rate as % for display (stored as decimal e.g. 0.04 → 4.00%)
      rows.forEach(r=>{ if(r.Rate!==undefined) r.Rate=(Number(r.Rate)*100).toFixed(2)+'%'; });
    }
    if(action==='members_list')  allMembers=rows;
    renderListHtml(rows,target,linkKind,editKey);
  }catch(err){$(target).innerHTML=`<p class="err">${err.message}</p>`;}
}
let allLoans=[],allDeposits=[],allSavings=[],allMembers=[];
function filterList(rows,query,target,linkKind,editKey){
  const q=(query||'').toLowerCase().trim();
  const filtered=!q?rows:rows.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(q)));
  renderListHtml(filtered,target,linkKind,editKey);
}
function renderListHtml(rows,target,linkKind,editKey){
  if(!rows||!rows.length){$(target).innerHTML='<p class="msg">Nothing to show.</p>';return;}
  const cols=Object.keys(rows[0]); const money=/amount|emi|repayable|value|paid|balance|arrears|min/i;
  const hasBtn=linkKind||editKey;
  let h='<table><tr>'+cols.map(c=>`<th>${esc(c)}</th>`).join('')+(hasBtn?'<th></th>':'')+' </tr>';
  rows.forEach(r=>{const id=r[cols[0]];h+='<tr>'+cols.map(c=>`<td>${money.test(c)?rupee(r[c]):esc(r[c])}</td>`).join('');
    if(hasBtn){h+='<td>';
      if(linkKind==='loan')   h+=`<button class="ghost" data-loan="${esc(id)}">Schedule</button> `;
      if(linkKind==='member') h+=`<button class="ghost" data-member="${esc(id)}">View</button> `;
      if(editKey==='expenses') h+=`<button class="ghost" data-voucher="${esc(id)}">Voucher</button> `;
      if(editKey) h+=`<button class="ghost" data-edit="${esc(editKey)}:${esc(id)}">Edit</button>`;
      h+='</td>';}h+='</tr>';});
  $(target).innerHTML=h+'</table>';
}

/* ── CLEAR FORMS ─────────────────────────────────────────────── */
function clearForm(section){
  const maps={
    members:['m_FullName','m_DOB','m_Phone','m_Branch','m_Address','m_Aadhaar','m_PAN','m_BankName','m_BankAccount','m_IFSC','m_ShareCapitalCollected'],
    loans:['l_Borrower','l_MemberID','l_LoanType','l_Amount','l_RatePct','l_TenureMonths','l_SanctionDate','l_DisbursementDate','l_FirstEMIDate','l_CustomEMI','l_G1Name','l_G1MemberID','l_G2Name','l_G2MemberID','l_NewId'],
    deposits:['d_MemberID','d_Depositor','d_Amount','d_RatePct','d_TenureMonths','d_StartDate','d_PayoutMode','d_Nominee','d_Remarks'],
    savings:['s_MemberID','s_MemberName','s_Rate','s_MinBalance','s_OpenDate','s_Nominee'],
    expenses:['e_Date','e_Description','e_Amount','e_Remarks','e_To'],
    passbook:['pb_SavingsID','pb_from','pb_to'],
  };
  (maps[section]||[]).forEach(id=>{if($(id))$(id).value='';});
  if(section==='members'&&$('m_Photo'))$('m_Photo').value='';
  if(section==='loans'){$('l_add').hidden=true;if($('l_schedCard'))$('l_schedCard').hidden=true;$('l_msg').textContent='';if($('l_NewIdWrap'))$('l_NewIdWrap').style.display='none';}
  if(section==='deposits'){$('d_add').hidden=true;if($('d_prev'))$('d_prev').innerHTML='';$('d_msg').textContent='';}
  if(section==='members'){$('m_msg').textContent='';clearEdit();}
  if(section==='passbook'){$('pb_summary').innerHTML='';if($('pb_rows'))$('pb_rows').innerHTML='';}
}
const EDIT_BTN={loans:'l_add',deposits:'d_add',expenses:'e_add',member:'m_add'};
const EDIT_VIEW={loans:'loans',deposits:'deposits',expenses:'expenses',member:'members'};
const EDIT_MSG={loans:'l_msg',deposits:'d_msg',expenses:'e_msg',member:'m_msg'};
function clearEdit(){
  editing={type:null,id:null};
  setText('l_add','Confirm & Save');$('l_add').hidden=true;
  setText('d_add','Confirm & Save');$('d_add').hidden=true;
  setText('e_add','Add expense');setText('m_add','Add member');
  if($('l_NewIdWrap'))$('l_NewIdWrap').style.display='none';
}
function cancelEdit(section){
  clearForm(section);
  clearEdit();
  const msgs={loans:'l_msg',deposits:'d_msg',expenses:'e_msg',member:'m_msg'};
  const msgEl=$(msgs[section]);if(msgEl)msgEl.textContent='';
}
function setText(id,t){if($(id))$(id).textContent=t;}
async function startEdit(key,id){
  try{
    showView(EDIT_VIEW[key]);
    if(key==='member'){const{member}=await api('member_get',{memberId:id});fillMember(member);}
    else{const{fields}=await api('reg_get',{key,id});fillReg(key,fields,id);}
    editing={type:key,id};
    const btn=EDIT_BTN[key];$(btn).hidden=false;setText(btn,'Update');
    $(EDIT_MSG[key]).textContent='Editing '+id+' — change fields, then Update.';
    const cBtnId={loans:'l_cancel_edit',deposits:'d_cancel_edit',expenses:'e_cancel_edit',member:'m_cancel_edit'}[key];
    const cBtn=$(cBtnId);if(cBtn)cBtn.style.display='inline-flex';
  }catch(err){alert(err.message);}
}
function fillReg(key,f,id){
  if(key==='loans'){setV('l_Borrower',f.Borrower);setV('l_MemberID',f.MemberID||f.member_id);setV('l_LoanType',f.LoanType||f.loan_type);
    setV('l_Branch',f.Branch||f.branch);setV('l_Amount',f.Amount||f.amount);setV('l_RatePct',(Number(f.RateAnnual||f.rate_annual)||0)*100);
    setV('l_TenureMonths',f.TenureMonths||f.tenure_months);setV('l_Method',f.Method||f.method||'Flat');setV('l_Frequency',f.Frequency||f.frequency||'Monthly');
    setV('l_SanctionDate',f.SanctionDate||f.sanction_date);setV('l_DisbursementDate',f.DisbursementDate||f.disbursement_date);
    setV('l_FirstEMIDate',f.FirstEMIDate||f.first_emi_date);setV('l_CustomEMI',f.CustomEMI||f.custom_emi);
    // Show Change Loan ID field for BM, CEO, Admin (fix #5)
    if(['BranchManager','CEO','Admin'].includes(session.role)){
      if($('l_NewIdWrap'))$('l_NewIdWrap').style.display='';
      setV('l_NewId','');
      if($('l_NewId'))$('l_NewId').placeholder='leave blank to keep '+id;
    }
  }
  if(key==='deposits'){setV('d_Depositor',f.Depositor);setV('d_MemberID',f.MemberID);setV('d_DepositType',f.DepositType);
    setV('d_Branch',f.Branch);setV('d_Amount',f.Amount);setV('d_RatePct',(Number(f.RateAnnual)||0)*100);
    setV('d_TenureMonths',f.TenureMonths);setV('d_StartDate',f.StartDate);setV('d_PayoutMode',f.PayoutMode);setV('d_Remarks',f.Remarks);}
  if(key==='expenses'){setV('e_Date',f.Date);setV('e_Category',f.Category);setV('e_Description',f.Description);
    setV('e_Branch',f.Branch);setV('e_Amount',f.Amount);setV('e_Remarks',f.Remarks);
    $('e_ToWrap').hidden=(f.Category!=='External Expenses');}
}
function fillMember(m){setV('m_FullName',m.FullName);setV('m_DOB',m.DOB&&m.DOB.length>10?'':m.DOB);setV('m_Phone',m.Phone);
  setV('m_Branch',m.Branch);setV('m_Address',m.Address);setV('m_Aadhaar','');$('m_Aadhaar').placeholder='unchanged ('+(m.Aadhaar||'')+') — type to replace';
  setV('m_PAN',m.PAN);setV('m_BankName',m.BankName);setV('m_BankAccount',m.BankAccount);setV('m_IFSC',m.IFSC);
  setV('m_ShareCapitalCollected',m.ShareCapitalCollected||0);
  if($('m_MemberType'))$('m_MemberType').value=m.MemberType||'Original Member';
  if($('m_ShareCapitalMember'))$('m_ShareCapitalMember').value=m.ShareCapitalMember||'No';
  // Show current Member ID as read-only, and Change ID field for Admin/CEO (Issue 1)
  const curIdWrap=$('m_CurIdWrap');if(curIdWrap){curIdWrap.style.display='';$('m_CurId')&&($('m_CurId').value=m.MemberID||'');}
  if(['Admin','CEO'].includes(session.role)){if($('m_NewIdWrap'))$('m_NewIdWrap').style.display='';setV('m_NewId','');if($('m_NewId'))$('m_NewId').placeholder='leave blank to keep '+m.MemberID;}
  else{if($('m_NewIdWrap'))$('m_NewIdWrap').style.display='none';}
  if(curIdWrap)curIdWrap.style.display='';}
function setV(id,v){if($(id))$(id).value=(v==null?'':v);}
function setSelectValue(sid,value){const sel=$(sid);if(!sel||!value)return;sel.value=value;if(sel.value!==value){const o=document.createElement('option');o.value=value;o.textContent=value;sel.appendChild(o);sel.value=value;}}

/* ── REPAYMENTS ──────────────────────────────────────────────── */
async function loadRepaymentLoans(){
  try{const{rows}=await api('loans_list');repLoans=rows;renderLoanList();}
  catch(err){$('r_loanlist').innerHTML=`<p class="err">${err.message}</p>`;}
}
function filterLoanList(){renderLoanList();}
function renderLoanList(){
  const q=(val('r_search')||'').toLowerCase();
  const rows=repLoans.filter(r=>!q||Object.values(r).some(v=>String(v).toLowerCase().includes(q)));
  if(!rows.length){$('r_loanlist').innerHTML='<p class="msg">No matching loans.</p>';return;}
  const cols=Object.keys(rows[0]); const money=/amount|emi|repayable/i;
  let h='<table><tr>'+cols.map(c=>`<th>${esc(c)}</th>`).join('')+'<th></th></tr>';
  rows.forEach(r=>{h+='<tr>'+cols.map(c=>`<td>${money.test(c)?rupee(r[c]):esc(r[c])}</td>`).join('')+
    `<td><button class="ghost" data-openledger="${esc(r[cols[0]])}">Collect / View</button></td></tr>`;});
  $('r_loanlist').innerHTML=h+'</table>';
}
function openLedger(id){if(!id)return;$('r_LoanId').value=id;loadLedger();}
function minimiseLedger(){['r_ledgerHead','r_addCard','r_recCard','r_schedCard'].forEach(x=>$(x).hidden=true);}
async function loadLedger(){
  const id=val('r_LoanId').trim();if(!id)return;curLoanId=id;
  try{const{ledger}=await api('repayment_ledger',{loanId:id});const s=ledger.summary;
    $('r_ledgerHead').hidden=false;$('r_ledgerTitle').textContent='Ledger — '+id;
    $('r_summary').innerHTML=summaryHtml([['Total Payable',rupee(s.totalPayable)],['Total Paid',rupee(s.totalPaid)],
      ['Balance Remaining',rupee(s.balanceRemaining)],['Scheduled Due To-Date',rupee(s.scheduledDueToDate)],
      ['Arrears / (Advance)',rupee(s.arrears)],['Next Due',s.nextDueDate+' · '+rupee(s.nextDueAmount)]]);
    $('r_addCard').hidden=(session.role==='Director');$('r_receiptBox').hidden=true;
    let rh='<table><tr><th style="text-align:left">Receipt</th><th style="text-align:left">Date</th><th style="text-align:right">Amount</th><th style="text-align:left">Mode</th><th style="text-align:left">Note</th><th></th></tr>';
    ledger.receipts.forEach(x=>rh+=`<tr><td>${esc(x.Receipt)}</td><td>${esc(x.Date)}</td><td style="text-align:right">${rupee(x.Amount)}</td>`+
      `<td>${esc(x.Mode)}</td><td>${esc(x.Note)}</td><td><button class="ghost" data-rprint="${esc(x.Receipt)}">Print</button></td></tr>`);
    $('r_recCard').hidden=false;$('r_receipts').innerHTML=rh+'</table>';
    $('r_schedCard').hidden=false;$('r_sched').innerHTML=schedTable(ledger.schedule);
  }catch(err){alert(err.message);}
}
async function addReceipt(){
  const id=val('r_LoanId').trim();if(!id){alert('Load a loan first.');return;}
  const mode=val('r_Mode');
  if(mode==='UPI'&&!val('r_Utr').trim()){alert('Please enter the UTR number for UPI.');return;}
  $('r_msg').textContent='Saving…';
  try{const{receipt}=await api('repayment_add',{repayment:{LoanID:id,Date:val('r_Date'),
    Amount:val('r_Amount'),Mode:mode,Ref:val('r_Utr'),Note:val('r_Note'),PenaltyAmount:val('r_Penalty')||0,PenaltyType:val('r_PenaltyType')}});
    lastReceipt=receipt;$('r_msg').textContent='Receipt '+receipt.receiptNo;$('r_Amount').value='';
    $('r_receiptBox').hidden=false;$('r_receiptView').innerHTML=receiptSummary(receipt);loadLedger();
    if($('r_pdf'))$('r_pdf').style.display=isPWA()?'inline-flex':'none';
  }catch(err){$('r_msg').textContent='';alert(err.message);}
}
const receiptSummary=r=>{
  const pairs=[['Bank',esc(r.bankName)],['Receipt No.',esc(r.receiptNo)],['Date',esc(r.date)],
    ['Borrower',esc(r.borrower)],['Mode',esc(r.mode)+(r.ref?' ('+esc(r.ref)+')':'')],['This payment',rupee(r.amount)]];
  if(r.penalty&&Number(r.penalty)>0) pairs.push(['Penalty',rupee(r.penalty)+(r.penaltyType?' ('+esc(r.penaltyType)+')':'')]);
  pairs.push(['EMIs paid till now',r.emisPaid],['Amount paid till now',rupee(r.amountPaidTillNow)],
    ['Pending loan amount',rupee(r.pendingAmount)],['Operator',esc(r.operator)]);
  return summaryHtml(pairs);
};
async function printPastReceipt(receiptNo){
  try{const{receipt}=await api('receipt_print',{loanId:curLoanId,receiptNo});printReceiptObj(receipt);}
  catch(err){alert(err.message);}
}
/* ── PRINT FUNCTIONS ─────────────────────────────────────────── */
/* PWA-safe print via srcdoc + onload */
function printDoc(inner,pageCss,extraCss){
  const base=`body{font-family:Arial,sans-serif;color:#000}
    .hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px}
    .hd .lg{width:60px;height:60px;object-fit:contain}
    .hd h2{margin:0;font-size:20px}.hd h3{margin:2px 0 0;font-weight:normal;font-size:13px;color:#444}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{border:1px solid #999;padding:4px 6px;text-align:right}
    th:nth-child(2),td:nth-child(2){text-align:left}th:first-child,td:first-child{text-align:left}
    table.meta td{border:0;text-align:left;padding:3px 6px}
    .sign{margin-top:44px;text-align:right;font-size:12px}
    .foot{margin-top:14px;border-top:1px solid #999;padding-top:6px;font-size:10px;color:#333;text-align:center}`;
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{}${pageCss}${base}${extraCss||''}</style></head><body>${inner}</body></html>`;
  const frame=document.createElement('iframe');
  frame.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  frame.srcdoc=html;
  let printed=false;
  function doPrint(){if(printed)return;printed=true;
    try{frame.contentWindow.focus();frame.contentWindow.print();}catch(e){}
    setTimeout(()=>{try{frame.remove();}catch(e){}},2000);}
  frame.onload=()=>setTimeout(doPrint,120);
  document.body.appendChild(frame);
  setTimeout(()=>{if(!printed)doPrint();},900);
}
function buildReceiptHtml(r){
  if(!r) return '';
  const inr=n=>'\u20b9'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const D='--------------------------------';
  return `<div class="rc">`+
    `<img src="${LOGO_URL}" class="rl" onerror="this.style.display='none'"/>`+
    `<div class="bn">${esc(BANK)}</div>`+
    `<div class="st">Loan Repayment Receipt</div>`+
    `<pre>${D}\nReceipt : ${esc(r.receiptNo)}\nDate    : ${esc(r.date)}\nLoan ID : ${esc(r.loanId)}\nBorrower: ${esc(r.borrower)}\nMode    : ${esc(r.mode)}${r.ref?' ('+esc(r.ref)+')':''}\n${D}\nEMIs    : ${r.emisPaid}\nPaid    : ${inr(r.amountPaidTillNow)}\nBalance : ${inr(r.pendingAmount)}\n`+
    (r.penalty&&Number(r.penalty)>0?`Penalty : ${inr(r.penalty)} (${esc(r.penaltyType||'Late')})\n`:'')+
    `${D}\nOperator: ${esc(r.operator)}\n${D}\n      ** THANK YOU **\n Computer Generated Receipt\n   No Signature Required</pre></div>`;
}
const receiptCss=`@page{size:72mm auto;margin:2mm 3mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',Courier,monospace;font-size:8.5pt;color:#000;width:66mm;background:#fff}.rc{width:100%;text-align:center}.rl{width:32px;height:32px;object-fit:contain;display:block;margin:2px auto 3px}.bn{font-size:11pt;font-weight:bold;letter-spacing:.5px;margin-bottom:1px}.st{font-size:8pt;margin-bottom:3px;font-style:italic}pre{font-family:'Courier New',Courier,monospace;font-size:8pt;white-space:pre;text-align:left;margin-top:4px;line-height:1.45}`;
function printReceiptObj(r){
  if(!r){alert('No receipt selected.');return;}
  printDoc(buildReceiptHtml(r),receiptCss,'');
}
/* PDF receipt (PWA only) — Portrait credit-card size via blob URL (#8) */
function pdfReceiptObj(r){
  if(!r){alert('No receipt selected.');return;}
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page{size:54mm 86mm;margin:2mm 3mm}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',Courier,monospace;font-size:7.5pt;color:#000;width:50mm;background:#fff}
    .rc{width:100%;text-align:center}.rl{width:26px;height:26px;object-fit:contain;display:block;margin:2px auto 3px}
    .bn{font-size:9.5pt;font-weight:bold;letter-spacing:.5px;margin-bottom:1px}
    .st{font-size:7pt;margin-bottom:3px;font-style:italic}
    pre{font-size:7pt;white-space:pre;text-align:left;margin-top:3px;line-height:1.4}
  </style></head><body>${buildReceiptHtml(r)}</body></html>`;
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`receipt_${r.receiptNo||'receipt'}.html`;
  document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1500);
  showToast('📄 Receipt saved — open in browser and Print → Save as PDF','ok');
}
function printHeader(subtitle){
  return `<div class="hd"><img src="${LOGO_URL}" class="lg" onerror="this.style.display='none'"/>`+
    `<div><h2>${esc(BANK)}</h2><h3>${esc(subtitle)}</h3></div></div>`;
}
function printSchedule(){
  if(!lastSchedule){alert('Load or preview a schedule first.');return;}
  const m=lastMeta||{};
  const info=`<table class="meta" style="width:100%">`+
    `<tr><td style="width:50%"><b>Borrower:</b> ${esc(m.borrower)}</td>`+
    `<td style="text-align:right"><b>Member ID:</b> ${esc(m.memberId)}</td></tr>`+
    `<tr><td><b>Loan Type:</b> ${esc(m.loanType)}</td>`+
    `<td style="text-align:right"><b>Tenure:</b> ${esc(m.tenure)} months (${esc(m.method)} · ${esc(m.frequency)})</td></tr></table>`;
  const sign=`<div class="sign">_______________________<br>Branch Manager Signature</div>`;
  const foot=`<div class="foot">${esc(m.branch)} Branch${m.branchAddress?' — '+esc(m.branchAddress):''}${m.branchPhone?' · Phone: '+esc(m.branchPhone):''}${m.email?' · Email: '+esc(m.email):''}</div>`;
  printDoc(printHeader('Amortization Schedule')+info+schedTable(lastSchedule)+sign+foot,'@page{size:A4;margin:1cm}','.hd{text-align:center;display:block}.hd h2{font-size:18px}body{font-size:9pt}table{font-size:9pt}th,td{font-size:9pt;padding:3px 5px}');
}

/* ── LOANS ───────────────────────────────────────────────────── */
async function populateCollectorSelect(branch){
  if(!$('l_Collector'))return;
  try{const{collectors}=await api('collectors_by_branch',{branch:branch||val('l_Branch')||''});
    $('l_Collector').innerHTML='<option value="">— select collector —</option>'+
      (collectors||[]).map(u=>`<option value="${esc(u.userId)}">${esc(u.name)} (${esc(u.branch)})</option>`).join('');
  }catch(e){}
}
async function loadCollectorsForBranch(branch){await populateCollectorSelect(branch);}
async function autofillMember(query,nameId,memberIdId){
  if(!query)return null;
  try{const{member}=await api('member_lookup',{query});
    if(nameId&&$(nameId))$(nameId).value=member.FullName||'';
    if(memberIdId&&$(memberIdId))$(memberIdId).value=member.MemberID||'';
    return member;
  }catch(e){return null;}
}
function loanFromForm(){return{Borrower:val('l_Borrower'),MemberID:val('l_MemberID'),LoanType:val('l_LoanType'),
  Branch:val('l_Branch'),Amount:val('l_Amount'),RateAnnual:Number(val('l_RatePct'))/100,TenureMonths:val('l_TenureMonths'),
  Method:val('l_Method'),Frequency:val('l_Frequency'),SanctionDate:val('l_SanctionDate'),
  DisbursementDate:val('l_DisbursementDate'),FirstEMIDate:val('l_FirstEMIDate'),CustomEMI:val('l_CustomEMI'),
  Collector:val('l_Collector'),G1Name:val('l_G1Name'),G1MemberID:val('l_G1MemberID'),
  G2Name:val('l_G2Name'),G2MemberID:val('l_G2MemberID')};}
async function previewLoan(){
  $('l_msg').textContent='Calculating…';
  try{const{result,meta}=await api('loan_preview',{loan:loanFromForm()});
    renderSchedule('PREVIEW (not yet saved)',result,meta);$('l_add').hidden=false;
    $('l_msg').textContent='Preview ready — review, then Confirm & Save.';
  }catch(err){$('l_msg').textContent='';alert(err.message);}
}
async function addLoan(){
  $('l_msg').textContent='Saving…';
  try{
    if(editing.type==='loans'){
      const fields=loanFromForm();
      // Change Loan ID if provided and role allows (#5)
      const newId=val('l_NewId').trim();
      if(newId&&['BranchManager','CEO','Admin'].includes(session.role)) fields.NewLoanId=newId;
      await api('reg_edit',{key:'loans',id:editing.id,fields});
      $('l_msg').textContent='Updated '+(newId||editing.id);clearEdit();
      return loadList('loans_list','l_list','loan','loans');
    }
    const{id}=await api('loans_add',{loan:loanFromForm()});
    $('l_msg').textContent='Saved '+id;$('l_add').hidden=true;
    await loadList('loans_list','l_list','loan','loans');showSchedule(id);
    // Auto-fill approval form with new Loan ID (#6)
    if($('ap_LoanId'))$('ap_LoanId').value=id;
  }catch(err){$('l_msg').textContent='';alert(err.message);}
}
async function showSchedule(id){
  try{const{result,meta}=await api('loan_schedule',{loanId:id});renderSchedule(id,result,meta);}
  catch(err){alert(err.message);}
}
function renderSchedule(title,result,meta){
  const s=result.summary;lastSchedule=result.schedule;lastMeta=meta||{};
  $('l_schedCard').hidden=false;$('l_schedTitle').textContent='Schedule — '+title;
  $('l_summary').innerHTML=summaryHtml([
    [s.frequency==='Daily'?'Daily Instalment':'Effective Instalment',rupee(s.effEMI)],
    [s.frequency==='Daily'?'Total Days':'Tenure (months)',s.frequency==='Daily'?s.tenureDays||s.effTenure:s.effTenure+' mo'],
    ['Total Interest',rupee(s.totalInterest)],['Total Repayable',rupee(s.totalRepayable)],
    ['Extra-Day Interest',rupee(s.extraInterest)+' ('+s.extraDays+' d)']]);
  lastMeta.tenure=s.nominalTenure;lastMeta.method=s.method;lastMeta.frequency=s.frequency;
  $('l_sched').innerHTML=schedTable(result.schedule);
  $('l_schedCard').scrollIntoView({behavior:'smooth'});
}

/* ── FIXED DEPOSITS ──────────────────────────────────────────── */
function depositFromForm(){return{Depositor:val('d_Depositor'),MemberID:val('d_MemberID'),DepositType:'Fixed Deposit',
  Branch:val('d_Branch'),Amount:val('d_Amount'),RateAnnual:Number(val('d_RatePct'))/100,TenureMonths:val('d_TenureMonths'),
  StartDate:val('d_StartDate'),PayoutMode:val('d_PayoutMode'),Remarks:val('d_Remarks'),Nominee:val('d_Nominee')};}
async function previewDeposit(){
  $('d_msg').textContent='Calculating…';
  try{const{result}=await api('deposit_preview',{deposit:depositFromForm()});
    $('d_prev').innerHTML=summaryHtml([['Principal',rupee(result.principal)],['Rate',result.annualRatePct+' %'],
      ['Tenure',result.tenureMonths+' mo'],['Maturity (compound)',rupee(result.maturityCompound)],
      ['Maturity (simple)',rupee(result.maturitySimple)]]);
    $('d_add').hidden=false;$('d_msg').textContent='Estimate shown — Confirm & Save to record it.';
  }catch(err){$('d_msg').textContent='';alert(err.message);}
}
async function addDeposit(){
  $('d_msg').textContent='Saving…';
  try{
    if(editing.type==='deposits'){await api('reg_edit',{key:'deposits',id:editing.id,fields:depositFromForm()});
      $('d_msg').textContent='Updated '+editing.id;clearEdit();return loadList('deposits_list','d_list',null,'deposits');}
    const{id}=await api('deposits_add',{deposit:depositFromForm()});
    $('d_msg').textContent='Saved '+id;$('d_add').hidden=true;loadList('deposits_list','d_list',null,'deposits');
  }catch(err){$('d_msg').textContent='';alert(err.message);}
}
async function fdWithdraw(){
  $('w_msg').textContent='Saving…';
  try{const{withdrawalNo,payout}=await api('fd_withdraw',{withdrawal:{DepositID:val('w_DepositID'),
    Type:val('w_Type'),Date:val('w_Date'),ReducedRate:val('w_ReducedRate')?Number(val('w_ReducedRate'))/100:'',
    PayoutAmount:val('w_Payout'),Note:val('w_Note')}});
    $('w_msg').textContent=withdrawalNo+' · payout '+rupee(payout);
  }catch(err){$('w_msg').textContent='';alert(err.message);}
}

/* ── SAVINGS ─────────────────────────────────────────────────── */
async function savingsOpen(){
  $('s_msg').textContent='Saving…';
  try{const{savingsId}=await api('savings_open',{account:{MemberID:val('s_MemberID'),MemberName:val('s_MemberName'),
    Branch:val('s_Branch'),Rate:Number(val('s_Rate'))/100,MinBalance:val('s_MinBalance'),
    OpenDate:val('s_OpenDate'),Nominee:val('s_Nominee')}});
    $('s_msg').textContent='Opened '+savingsId;loadList('savings_list','s_list');
  }catch(err){$('s_msg').textContent='';alert(err.message);}
}
async function savingsTxn(){
  $('st_msg').textContent='Saving…';
  try{const{txnNo,balance}=await api('savings_txn',{txn:{SavingsID:val('st_SavingsID'),Type:val('st_Type'),
    Amount:val('st_Amount'),Date:val('st_Date'),Note:val('st_Note')}});
    $('st_msg').textContent=txnNo+' · balance '+rupee(balance);$('st_Amount').value='';
    if(val('pb_SavingsID')===val('st_SavingsID'))loadPassbook();
  }catch(err){$('st_msg').textContent='';alert(err.message);}
}
async function loadPassbook(){
  const id=val('pb_SavingsID').trim();if(!id)return;
  try{const{passbook}=await api('savings_passbook',{savingsId:id});
    $('pb_summary').innerHTML=summaryHtml([['Member',esc(passbook.account.Member)],['Savings ID',esc(passbook.account.SavingsID||'')],['Balance',rupee(passbook.account.Balance)],['Min Balance',rupee(passbook.account.MinBalance)]]);
    const from=val('pb_from'),to=val('pb_to');
    let rows=passbook.rows;
    if(from)rows=rows.filter(r=>r.Date>=from);if(to)rows=rows.filter(r=>r.Date<=to);
    $('pb_rows').innerHTML=tableFrom(rows);
    // Enrich account with branch from session if not returned
    const acct=Object.assign({Branch:session?.branch||''},passbook.account);
    $('pb_rows').dataset.passbook=JSON.stringify({account:acct,rows});
  }catch(err){alert(err.message);}
}
function printPassbook(){
  const raw=$('pb_rows').dataset.passbook;if(!raw){alert('Load a passbook first.');return;}
  const{account,rows}=JSON.parse(raw);
  // Format DOB nicely
  const fmtDob=d=>{if(!d)return'—';try{const dt=new Date(d);const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return`${String(dt.getDate()).padStart(2,'0')}-${M[dt.getMonth()]}-${dt.getFullYear()}`;}catch(e){return d;}};
  const hd=
    `<div class="pb-header">`+
    `<img src="${LOGO_URL}" style="width:60px;height:60px;object-fit:contain;display:block;margin:0 auto 6px" onerror="this.style.display='none'"/>`+
    `<h2 style="margin:0;font-size:20px;letter-spacing:-.5px">${esc(BANK)}</h2>`+
    `<h3 style="margin:4px 0 0;font-weight:400;font-size:13px;color:#444">Savings Passbook</h3>`+
    `</div>`+
    `<table class="pb-meta">`+
    `<tr><td class="lbl">Savings ID</td><td class="val">${esc(account.SavingsID||'—')}</td>`+
    `    <td class="lbl">Member ID</td><td class="val">${esc(account.MemberID||'—')}</td></tr>`+
    `<tr><td class="lbl">Member Name</td><td class="val" colspan="3">${esc(account.Member||'—')}</td></tr>`+
    `<tr><td class="lbl">Date of Birth</td><td class="val">${fmtDob(account.DOB)}</td>`+
    `    <td class="lbl">Branch</td><td class="val">${esc(account.Branch||session?.branch||'—')}</td></tr>`+
    `<tr><td class="lbl">Address</td><td class="val" colspan="3">${esc(account.Address||'—')}</td></tr>`+
    `<tr><td class="lbl">Phone</td><td class="val">${esc(account.Phone||'—')}</td>`+
    `    <td class="lbl">Min Balance</td><td class="val">${rupee(account.MinBalance)}</td></tr>`+
    `<tr><td class="lbl">Current Balance</td><td class="val" colspan="3" style="font-weight:700;font-size:13px">${rupee(account.Balance)}</td></tr>`+
    `</table>`;
  let t='<table class="pb-txn"><tr><th>Txn No</th><th>Date</th><th>Type</th><th>Amount (₹)</th><th>Balance (₹)</th><th>Note</th></tr>';
  rows.forEach(r=>t+=`<tr><td>${esc(r.TxnNo)}</td><td>${esc(r.Date)}</td><td>${esc(r.Type)}</td><td style="text-align:right">${rupee(r.Amount)}</td><td style="text-align:right">${rupee(r.Balance)}</td><td>${esc(r.Note||'')}</td></tr>`);
  t+='</table>';
  const pbCss=
    `@page{size:A4;margin:1.2cm}`+
    `body{font-size:10px;font-family:Arial,sans-serif;color:#000;`+
    `border:3px double #222;padding:16px;margin:0;min-height:calc(100vh - 2.4cm)}`+
    `.pb-header{text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:12px}`+
    `table.pb-meta{width:100%;border-collapse:collapse;margin-bottom:14px}`+
    `table.pb-meta td{padding:5px 8px;border:1px solid #ccc;font-size:10px;vertical-align:top}`+
    `table.pb-meta td.lbl{background:#f5f5f5;font-weight:700;color:#333;width:100px}`+
    `table.pb-meta td.val{min-width:120px}`+
    `table.pb-txn{width:100%;border-collapse:collapse}`+
    `table.pb-txn th{background:#e8eef8;color:#1a3a8f;font-size:9px;text-transform:uppercase;`+
    `font-weight:700;padding:5px 6px;border:1px solid #bbb;text-align:left}`+
    `table.pb-txn td{padding:4px 6px;border:1px solid #ddd;font-size:9.5px}`+
    `table.pb-txn tr:nth-child(even) td{background:#fafbff}`;
  printDoc(hd+t,pbCss,'');
}

/* ── TRANSFERS ───────────────────────────────────────────────── */
async function doTransfer(){
  $('tf_msg').textContent='Transferring…';
  try{const{txnNo,fromBalance,toBalance}=await api('transfer',{fromId:val('tf_From'),toId:val('tf_To'),amount:val('tf_Amount'),date:val('tf_Date'),note:val('tf_Note')});
    $('tf_msg').textContent=`${txnNo} · from ${rupee(fromBalance)} · to ${rupee(toBalance)}`;$('tf_Amount').value='';
  }catch(err){$('tf_msg').textContent='';alert(err.message);}
}

/* ── MODAL ───────────────────────────────────────────────────── */
function openModal(title,html){$('modal_title').textContent=title||'';$('modal_body').innerHTML=html;$('modal').hidden=false;}
function closeModal(){$('modal').hidden=true;$('modal_body').innerHTML='';}
function driveId(url){const s=String(url||"");const m=s.match(/\/d\/([^/]+)\//)||s.match(/id=([^&]+)/);return m?m[1]:"";}
function showPhoto(url){
  const id=driveId(url);
  const img=id?`https://drive.google.com/thumbnail?id=${id}&sz=w600`:url;
  openModal('Member photo',
    `<img src="${esc(img)}" style="max-width:100%;border-radius:10px" onerror="this.style.display='none';document.getElementById('photo_fallback').style.display='block'"/>`+
    `<p id="photo_fallback" style="display:none">Couldn't load inline. <a href="${esc(url)}" target="_blank">Open in Drive</a></p>`);
}

/* ── MEMBERS ─────────────────────────────────────────────────── */
async function addMember(){
  const btn=$('m_add');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  $('m_msg').textContent='Saving…';
  try{const member={FullName:val('m_FullName'),DOB:val('m_DOB'),Phone:val('m_Phone'),Address:val('m_Address'),
    Aadhaar:val('m_Aadhaar'),PAN:val('m_PAN'),BankName:val('m_BankName'),BankAccount:val('m_BankAccount'),
    IFSC:val('m_IFSC'),Branch:val('m_Branch'),MemberType:val('m_MemberType'),ShareCapitalMember:val('m_ShareCapitalMember'),ShareCapitalCollected:val('m_ShareCapitalCollected')};
    const f=$('m_Photo').files[0];if(f){member.PhotoBase64=await fileToB64(f);member.PhotoMime=f.type;}
    const idp=$('m_IdProof').files[0];if(idp){member.IdProofBase64=await fileToB64(idp);member.IdProofMime=idp.type;member.IdProofName=idp.name;}
    if(editing.type==='member'){
      const newMId=val('m_NewId').trim();
      const mPay={memberId:editing.id,member};
      if(newMId)mPay.newMemberId=newMId;
      const mRes=await api('member_edit',mPay);
      $('m_msg').textContent='Updated '+(mRes.memberId||editing.id);
      $('m_Photo').value='';if($('m_NewId'))$('m_NewId').value='';clearEdit();
      return loadList('members_list','m_list','member','member');}
    const{memberId,photoUrl,idProofUrl,warning}=await api('members_add',{member});
    $('m_Photo').value='';if($('m_IdProof'))$('m_IdProof').value='';
    let msg='Member saved — '+memberId;
    if(photoUrl)   msg+=' · 📷 Photo uploaded';
    if(idProofUrl) msg+=' · 📄 ID Proof uploaded';
    if(warning)    msg+='\n⚠ '+warning;
    $('m_msg').textContent=msg;
    showToast(photoUrl||idProofUrl?'Files uploaded to Google Drive':(warning?'⚠ '+warning:'Member saved'),warning?'warn':'ok');
    loadList('members_list','m_list','member','member');
  }catch(err){$('m_msg').textContent='';alert(err.message);}
  finally{if(btn){btn.disabled=false;btn.textContent=editing.type==='member'?'Update':'Add member';}}
}
async function uploadMemberFile(memberId,type){
  const fi=type==='photo'?$('mu_Photo_'+memberId):$('mu_IdProof_'+memberId);
  const msgEl=$('mu_msg_'+memberId);
  if(!fi||!fi.files[0]){if(msgEl)msgEl.textContent='Please select a file first.';return;}
  const f=fi.files[0];if(msgEl)msgEl.textContent='Uploading…';
  try{const b64=await fileToB64(f);
    const member=type==='photo'?{PhotoBase64:b64,PhotoMime:f.type}:{IdProofBase64:b64,IdProofMime:f.type,IdProofName:f.name};
    const{photoUrl,idProofUrl,warning}=await api('member_update_files',{memberId,member});
    if(warning&&!photoUrl&&!idProofUrl){if(msgEl)msgEl.textContent='⚠ '+warning;showToast('⚠ '+warning,'warn');}
    else{if(msgEl)msgEl.textContent='Uploaded';showToast('File uploaded','ok');setTimeout(()=>showMember(memberId),800);}
  }catch(err){if(msgEl)msgEl.textContent='⚠ '+err.message;}
}
let currentMemberId=null;
async function showMember(id){
  currentMemberId=id;
  try{const{member}=await api('member_get',{memberId:id});$('m_card').hidden=false;
    const pairs=[['Member ID',member.MemberID],['Full Name',member.FullName],['DOB',member.DOB],['Phone',member.Phone],
      ['Address',member.Address],['Aadhaar',member.Aadhaar],['PAN',member.PAN],['Bank Name',member.BankName],
      ['Bank A/C',member.BankAccount],['IFSC',member.IFSC],['Branch',member.Branch],
      ['Member Type',member.MemberType||'Original Member'],['Share Capital Member',member.ShareCapitalMember],['Share Capital Collected',rupee(member.ShareCapitalCollected)]];
    let h='<div class="summary">'+pairs.map(([k,v])=>`<div><span>${esc(k)} :</span><b>${esc(v)}</b></div>`).join('')+'</div>';
    h+=`<div style="margin-top:12px">`;
    if(member.PhotoUrl)h+=`<button class="ghost" data-photo="${esc(member.PhotoUrl)}" style="margin-bottom:6px">📷 View current photo</button><br>`;
    h+=`<label style="font-size:12px;color:#5b6472">📷 ${member.PhotoUrl?'Replace':'Upload'} Photo<input type="file" id="mu_Photo_${esc(member.MemberID)}" accept="image/*" style="margin-left:8px"/></label><button class="ghost" style="margin-top:6px" onclick="uploadMemberFile('${esc(member.MemberID)}','photo')">${member.PhotoUrl?'Replace Photo':'Upload Photo'}</button></div>`;
    h+=`<div style="margin-top:8px">`;
    if(member.IdProofUrl)h+=`<a href="${esc(member.IdProofUrl)}" target="_blank" style="display:inline-block;margin-bottom:6px;padding:7px 14px;border-radius:10px;background:#eaf1fb;color:#2c4a7c;text-decoration:none;font-size:13px">📄 View current ID Proof${member.IdProofName?' — '+esc(member.IdProofName):''}</a><br>`;
    h+=`<label style="font-size:12px;color:#5b6472">📄 ${member.IdProofUrl?'Replace':'Upload'} ID Proof<input type="file" id="mu_IdProof_${esc(member.MemberID)}" accept="image/jpeg,image/png,application/pdf" style="margin-left:8px"/></label><button class="ghost" style="margin-top:6px" onclick="uploadMemberFile('${esc(member.MemberID)}','idproof')">${member.IdProofUrl?'Replace ID Proof':'Upload ID Proof'}</button></div>`;
    h+=`<div id="mu_msg_${esc(member.MemberID)}" style="margin-top:8px;font-size:13px;color:#5b6472"></div>`;
    if(member.loans&&member.loans.length){
      h+=`<h3 style="margin:16px 0 8px;font-size:14px">Loans</h3><table><tr><th>Loan ID</th><th>Amount</th><th>Paid</th><th>Remaining</th><th>Missed EMI</th></tr>`;
      member.loans.forEach(l=>h+=`<tr><td>${esc(l.loanId)}</td><td>${rupee(l.amount)}</td><td>${rupee(l.paid)}</td><td>${rupee(l.remaining)}</td><td style="color:${l.missedEMI>0?'#c0392b':'#27ae60'}">${l.missedEMI>0?rupee(l.missedEMI):'—'}</td></tr>`);
      h+='</table>';
    }else h+=`<p style="margin-top:14px;color:#7b8794;font-size:13px">No loans linked.</p>`;
    if(member.savings&&member.savings.length){
      h+=`<h3 style="margin:16px 0 8px;font-size:14px">Savings Accounts</h3><table><tr><th>Savings ID</th><th>Balance</th><th>Min Balance</th></tr>`;
      member.savings.forEach(s=>h+=`<tr><td>${esc(s.savingsId)}</td><td>${rupee(s.balance)}</td><td>${rupee(s.minBalance)}</td></tr>`);
      h+='</table>';
    }else h+=`<p style="margin-top:8px;color:#7b8794;font-size:13px">No savings accounts linked.</p>`;
    $('m_detail').innerHTML=h;$('m_card').scrollIntoView({behavior:'smooth'});
  }catch(err){alert(err.message);}
}
async function deleteMember(){
  if(!currentMemberId){alert('Open a member first.');return;}
  if(!confirm(`Delete member ${currentMemberId}?`))return;
  try{await api('member_delete',{memberId:currentMemberId});
    showToast('Member deleted','ok');$('m_card').hidden=true;currentMemberId=null;
    loadList('members_list','m_list','member','member');
  }catch(err){showToast('⚠ '+err.message,'err');}
}

/* ── EXPENSES ────────────────────────────────────────────────── */
function expenseFromForm(){
  const cat=val('e_Category');
  const ex={Date:val('e_Date'),Category:cat,Description:val('e_Description'),Branch:val('e_Branch'),Amount:val('e_Amount'),Remarks:val('e_Remarks')};
  if(cat==='External Expenses')ex.To=val('e_To');return ex;
}
async function addExpense(){
  $('e_msg').textContent='Saving…';
  try{
    if(editing.type==='expenses'){await api('reg_edit',{key:'expenses',id:editing.id,fields:expenseFromForm()});
      $('e_msg').textContent='Updated '+editing.id;clearEdit();return loadList('expenses_list','e_list',null,'expenses');}
    const{id,voucher}=await api('expenses_add',{expense:expenseFromForm()});
    lastVoucher=voucher;$('e_msg').textContent='Saved '+id;$('e_voucherBox').hidden=false;
    $('e_voucherView').innerHTML=summaryHtml([['Bank',esc(voucher.bankName)],['Voucher No.',esc(voucher.expenseNo)],
      ['Date',esc(voucher.date)],['To',esc(voucher.to)],['Category',esc(voucher.category)],
      ['Description',esc(voucher.description)],['Amount',rupee(voucher.amount)],['Branch',esc(voucher.branch)]]);
    loadList('expenses_list','e_list',null,'expenses');
  }catch(err){$('e_msg').textContent='';alert(err.message);}
}
function printVoucher(v){
  if(!v){alert('Add an expense first.');return;}
  const body=`<div class="vh"><img src="${LOGO_URL}" class="vl" onerror="this.style.display='none'"/><div class="vbank">${esc(BANK)}</div><div class="vtitle">EXPENSE VOUCHER</div></div>`+
    `<table class="vmeta"><tr><td class="vl-col">Voucher No.</td><td class="vc-col">${esc(v.expenseNo)}</td><td class="vl-col" style="text-align:right">Date</td><td class="vr-col">${esc(v.date)}</td></tr><tr><td class="vl-col">To</td><td class="vc-col">${esc(v.to)}</td><td class="vl-col" style="text-align:right">Category</td><td class="vr-col">${esc(v.category)}</td></tr></table>`+
    `<table class="vamt"><tr><th>Description</th><th>Amount (₹)</th></tr><tr><td>${esc(v.description||v.category)}</td><td>${rupee(v.amount)}</td></tr><tr class="vtot"><td><b>Total</b></td><td><b>${rupee(v.amount)}</b></td></tr></table>`+
    `<div class="vsign"><div><div class="vline"></div>Receiver Signature</div><div><div class="vline"></div>Branch Manager Signature</div></div>`+
    `<div class="vfoot">${esc(v.branch)} Branch${v.branchAddress?' — '+esc(v.branchAddress):''}${v.branchPhone?' · '+esc(v.branchPhone):''}${v.email?' · '+esc(v.email):''}</div>`;
  const css=`@page{size:A4;margin:1cm}body{font-family:Arial,sans-serif;font-size:11px;color:#000;border:3px double #222;padding:16px;margin:0}.vh{text-align:center;border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:12px}.vl{width:52px;height:52px;object-fit:contain;display:block;margin:0 auto 4px}.vbank{font-size:18px;font-weight:bold;letter-spacing:.5px}.vtitle{font-size:14px;font-weight:700;margin-top:4px;letter-spacing:2px;text-transform:uppercase;border:1px solid #444;display:inline-block;padding:2px 14px}table.vmeta{width:100%;border-collapse:collapse;margin:12px 0}table.vmeta td{padding:5px 8px;border:1px solid #ccc;font-size:11px}.vl-col{color:#555;width:80px;font-weight:600}.vc-col{font-weight:bold;width:180px}.vr-col{font-weight:bold;text-align:right;width:120px}table.vamt{width:100%;border-collapse:collapse;margin-top:8px}table.vamt th{background:#f0f0f0;border:1px solid #aaa;padding:5px 8px;font-size:11px;text-align:right}table.vamt th:first-child{text-align:left}table.vamt td{border:1px solid #ccc;padding:5px 8px;text-align:right}table.vamt td:first-child{text-align:left}.vtot td{border-top:2px solid #444;background:#f9f9f9}.vsign{display:flex;justify-content:space-between;margin-top:48px;font-size:11px;text-align:center}.vline{border-top:1px solid #333;width:160px;margin:0 auto 4px}.vfoot{margin-top:16px;border-top:1px solid #aaa;padding-top:6px;font-size:9px;color:#555;text-align:center}`;
  printDoc(body,css,'');
}
async function printPastVoucher(id){
  try{const{voucher}=await api('voucher_get',{id});printVoucher(voucher);}
  catch(err){alert(err.message);}
}

/* ── REPORTS ─────────────────────────────────────────────────── */
let lastReportName='';
function repPeriodToggle(){}
async function loadReport(){
  $('rep_grid').innerHTML='<p class="msg">Loading…</p>';
  const sheet=val('rep_sheet');lastReportName=$('rep_sheet').selectedOptions[0].text;
  const fromDate=val('rep_from'),toDate=val('rep_to');
  if(!fromDate||!toDate){$('rep_grid').innerHTML='<p class="err">Please select From and To dates.</p>';return;}
  try{const{grid}=await api('report_get',{sheet,fromDate,toDate});
    let h='<table>';grid.forEach((row,ri)=>h+='<tr>'+row.map(c=>(ri===0?`<th>${esc(c)}</th>`:`<td>${esc(c)}</td>`)).join('')+'</tr>');
    $('rep_grid').innerHTML=h+'</table>';
  }catch(err){$('rep_grid').innerHTML=`<p class="err">${err.message}</p>`;}
}
function printReport(){
  const grid=$('rep_grid').innerHTML;if(!/table/.test(grid)){alert('Load a report first.');return;}
  const from=val('rep_from'),to=val('rep_to');
  const fmtD=d=>{if(!d)return'';const dt=new Date(d);const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return dt.getDate()+'-'+M[dt.getMonth()]+'-'+dt.getFullYear();};
  const tl=from&&to?`<div class="tl">Period: <b>${fmtD(from)}</b> &nbsp;to&nbsp; <b>${fmtD(to)}</b></div>`:'';
  const hqFoot=HQ_ADDRESS?`<div style="font-size:7px;color:#666;text-align:center;border-top:1px solid #ccc;padding-top:4px;margin-top:8px">${esc(HQ_ADDRESS)}${HQ_PHONE?' | Tel: '+esc(HQ_PHONE):''}${COMMON_EMAIL?' | '+esc(COMMON_EMAIL):''}</div>`:'';
  const hdr=`<div class="rh"><img src="${LOGO_URL}" class="rl" onerror="this.style.display='none'"/><h1>${esc(BANK)}</h1><h2>${esc(lastReportName||'Report')}</h2>${tl}</div>`;
  const css=`body{font-size:8.5px;font-family:Arial,sans-serif;color:#000}.rh{text-align:center;border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:10px}.rl{width:44px;height:44px;object-fit:contain;display:block;margin:0 auto 4px}h1{margin:0;font-size:16px;text-align:center}h2{margin:2px 0 0;font-size:11px;font-weight:600;text-align:center;color:#444}.tl{font-size:9px;color:#333;margin-top:5px;text-align:center;background:#f5f5f5;padding:3px 8px;border-radius:3px;display:inline-block}table{width:100%;border-collapse:collapse;margin-top:8px;table-layout:fixed}th{background:#e8eef8;color:#1a3a8f;font-size:7.5px;padding:4px 5px;text-align:right;border:1px solid #bbb;text-transform:uppercase;font-weight:700}th:first-child,th:nth-child(2){text-align:left}td{padding:3px 5px;text-align:right;border:1px solid #ddd;font-size:8.5px;word-break:break-word}td:first-child,td:nth-child(2){text-align:left}tr:nth-child(even) td{background:#fafbff}`;
  printDoc(hdr+grid+hqFoot,'@page{size:A4 landscape;margin:1cm}',css);
}

/* ── SOCIETY ─────────────────────────────────────────────────── */
async function loadSociety(){
  try{const{society}=await api('society_get');
    $('soc_Acc').value=society.accountNumber||'';$('soc_IFSC').value=society.ifsc||'';
    $('soc_Addr').value=society.address||'';$('soc_Open').value=society.openingBalance||0;
    $('soc_bal').innerHTML=summaryHtml([['Current Balance',rupee(society.balance)]]);
    let h='<table><tr><th>Txn No</th><th>Date</th><th>Direction</th><th>Amount</th><th>Party</th><th>Ref</th><th>Note</th></tr>';
    const cleanStr=s=>(s||'').replace(/\uFFFD/g,'-').replace(/[\u2013\u2014]/g,'-');
    society.txns.forEach(t=>h+=`<tr><td>${esc(t.TxnNo)}</td><td>${esc(t.Date)}</td><td>${esc(t.Direction)}</td><td>${rupee(t.Amount)}</td><td>${esc(t.Party)}</td><td>${esc(t.Ref)}</td><td>${esc(cleanStr(t.Note))}</td></tr>`);
    $('soc_list').innerHTML=h+'</table>';
  }catch(err){$('soc_list').innerHTML=`<p class="err">${err.message}</p>`;}
}
async function socSave(){
  $('soc_msg').textContent='Saving…';
  try{await api('society_update',{info:{accountNumber:val('soc_Acc'),ifsc:val('soc_IFSC'),address:val('soc_Addr'),openingBalance:val('soc_Open')}});
    $('soc_msg').textContent='Saved.';loadSociety();
  }catch(err){$('soc_msg').textContent='';alert(err.message);}
}
async function socTxn(){
  $('soc_tmsg').textContent='Posting…';
  try{const{balance}=await api('society_txn',{txn:{Date:val('soc_Date'),Direction:val('soc_Dir'),Amount:val('soc_Amt'),Party:val('soc_Party'),Note:val('soc_Note')}});
    $('soc_tmsg').textContent='Balance '+rupee(balance);$('soc_Amt').value='';loadSociety();
  }catch(err){$('soc_tmsg').textContent='';alert(err.message);}
}

/* ── SETTINGS ────────────────────────────────────────────────── */
async function loadSettings(){
  // Populate app name field
  if($('set_appname')) $('set_appname').value=localStorage.getItem('coop_app_name')||APP_NAME||'';
  try{const{settings}=await api('settings_get');
    $('set_form').innerHTML=settings.map(s=>`<label>${esc(s.label)}<input data-skey="${esc(s.key)}" type="${s.type==='date'?'date':(s.type==='number'?'number':'text')}" value="${esc(s.value)}"></label>`).join('');
  }catch(err){$('set_form').innerHTML=`<p class="err">${err.message}</p>`;}
}
async function saveSettings(){
  $('set_msg').textContent='Saving…';const values={};
  document.querySelectorAll('#set_form input[data-skey]').forEach(i=>values[i.dataset.skey]=i.value);
  // Save appName locally (not sent to backend — UI-only setting)
  const appNameEl=$('set_appname');
  if(appNameEl && appNameEl.value.trim()){
    APP_NAME = appNameEl.value.trim();
    localStorage.setItem('coop_app_name', APP_NAME);
    values['appName'] = APP_NAME;
  }
  try{await api('settings_update',{values});$('set_msg').textContent='Saved.';
    try{const{bankName}=await api('bank_info');if(bankName)BANK=bankName;}catch(e){}
    // Cache common email for report footer
    try{const{settings}=await api('settings_get');const em=(settings||[]).find(s=>s.key==='commonEmail');if(em)COMMON_EMAIL=em.value||'';}catch(e){}
    applyBranding(APP_NAME,BANK);
  }catch(err){$('set_msg').textContent='';alert(err.message);}
}

/* ── HIERARCHY (#4) ──────────────────────────────────────────── */
const DEFAULT_HIERARCHY=['Admin','CEO','BranchManager','Director','Operator','Collector'];
function loadHierarchy(){
  const stored=localStorage.getItem('coop_hierarchy');
  let levels=stored?JSON.parse(stored):DEFAULT_HIERARCHY.slice();
  renderHierarchy(levels);
}
function renderHierarchy(levels){
  const el=$('hier_tree');if(!el)return;
  el.innerHTML='';
  levels.forEach((role,i)=>{
    const node=document.createElement('div');
    node.className='hier-node';node.draggable=true;node.dataset.idx=i;
    node.innerHTML=`<span class="hier-handle">⠿</span>`+
      `<span style="flex:1;font-weight:600">${esc(role)}</span>`+
      `<span style="font-size:11px;color:#9ca3af">${i===0?'Highest authority':i===levels.length-1?'Lowest':'Level '+(i+1)}</span>`;
    node.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',i);node.style.opacity='.5';});
    node.addEventListener('dragend',()=>node.style.opacity='1');
    node.addEventListener('dragover',e=>{e.preventDefault();node.classList.add('drag-over');});
    node.addEventListener('dragleave',()=>node.classList.remove('drag-over'));
    node.addEventListener('drop',e=>{
      e.preventDefault();node.classList.remove('drag-over');
      const from=parseInt(e.dataTransfer.getData('text/plain'));
      const to=parseInt(node.dataset.idx);
      if(from===to)return;
      const arr=[...levels];const[moved]=arr.splice(from,1);arr.splice(to,0,moved);
      renderHierarchy(arr);
    });
    el.appendChild(node);
  });
  el._levels=levels;
}
function saveHierarchy(){
  const el=$('hier_tree');if(!el||!el._levels)return;
  localStorage.setItem('coop_hierarchy',JSON.stringify(el._levels));
  if($('hier_msg'))$('hier_msg').textContent='Saved.';showToast('Hierarchy saved','ok');
}
function resetHierarchy(){
  localStorage.removeItem('coop_hierarchy');loadHierarchy();
  if($('hier_msg'))$('hier_msg').textContent='Reset to defaults.';
}

/* ── BRANCH CONTACTS ─────────────────────────────────────────── */
let branchRows=[];
async function loadBranches(){
  try{const{branches}=await api('branches_list');branchRows=branches||[];
    // Store HQ info for report footer
    const hq=(branches||[]).find(b=>/head.?quarter/i.test(b.Branch||''))||(branches||[])[0];
    if(hq){HQ_ADDRESS=hq.Address||'';HQ_PHONE=hq.Phone||'';}
    if(!branchRows.length){$('br_list').innerHTML='<p class="msg">No branches yet.</p>';return;}
    let h='<table><tr><th style="text-align:left">Branch</th><th style="text-align:left">Address</th><th style="text-align:left">Phone</th><th></th></tr>';
    branchRows.forEach((b,i)=>h+=`<tr><td>${esc(b.Branch)}</td><td style="text-align:left">${esc(b.Address)}</td><td style="text-align:left">${esc(b.Phone)}</td><td><button class="ghost" data-bredit="${i}">Edit</button></td></tr>`);
    $('br_list').innerHTML=h+'</table>';
  }catch(err){$('br_list').innerHTML=`<p class="err">${err.message}</p>`;}
}
function fillBranch(i){const b=branchRows[i];if(!b)return;setV('br_Branch',b.Branch);setV('br_Address',b.Address);setV('br_Phone',b.Phone);$('br_msg').textContent='Editing '+b.Branch;}
async function branchSave(){
  $('br_msg').textContent='Saving…';
  try{await api('branch_save',{branch:{Branch:val('br_Branch'),Address:val('br_Address'),Phone:val('br_Phone')}});
    $('br_msg').textContent='Saved.';setV('br_Branch','');setV('br_Address','');setV('br_Phone','');
    loadBranches();populateBranchSelects();
  }catch(err){$('br_msg').textContent='';alert(err.message);}
}

/* ── USERS (#2 custom roles, #3 module perms) ────────────────── */
let editingUser=null;
async function startUserEdit(userId){
  try{const{users}=await api('users_list');
    const u=users.find(x=>x.UserID===userId);if(!u)return;
    editingUser=userId;
    setV('u_Id',u.UserID);setV('u_Name',u.Name);setV('u_Role',u.Role);setV('u_Branch',u.Branch);
    $('u_Id').readOnly=true;$('u_msg').textContent='Editing '+userId;setText('u_add','Update user');
  }catch(err){alert(err.message);}
}
async function addUser(){
  $('u_msg').textContent='Saving…';
  try{
    const role=val('u_Role').trim();
    if(editingUser){
      await api('users_edit',{user:{userId:editingUser,name:val('u_Name'),role,branch:val('u_Branch')}});
      $('u_msg').textContent='Updated '+editingUser;editingUser=null;$('u_Id').readOnly=false;setText('u_add','Add user');
    }else{
      await api('users_add',{user:{userId:val('u_Id'),name:val('u_Name'),role,branch:val('u_Branch'),password:val('u_Pw')}});
      $('u_msg').textContent='User added.';$('u_Pw').value='';
      // Add new custom role to datalist if not already there
      if(role&&!['Admin','CEO','BranchManager','Operator','Collector','Director'].includes(role)){
        const dl=$('u_role_list');
        if(dl&&![...dl.options].some(o=>o.value===role)){
          const opt=document.createElement('option');opt.value=role;dl.appendChild(opt);
        }
        // Save custom roles
        const custom=JSON.parse(localStorage.getItem('coop_custom_roles')||'[]');
        if(!custom.includes(role)){custom.push(role);localStorage.setItem('coop_custom_roles',JSON.stringify(custom));}
        // Give default perms to new role
        if(!DEFAULT_MODULES[role]) DEFAULT_MODULES[role]=['dashboard','account'];
      }
    }
    $('u_Id').value='';$('u_Name').value='';$('u_Branch').value='';
    loadUsers();loadUserDropdown();
  }catch(err){$('u_msg').textContent='';alert(err.message);}
}
async function loadUsers(){
  try{const{users}=await api('users_list');
    let h='<table><tr><th>User ID</th><th>Name</th><th>Role</th><th>Branch</th><th>Active</th><th>Last Login (IST)</th><th></th></tr>';
    users.forEach(u=>{
      // LastLogin is now an ISO string from backend; parse and format in IST
      let ll='Never';
      if(u.LastLogin){
        try{
          ll=new Date(u.LastLogin).toLocaleString('en-IN',{
            timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',
            hour:'2-digit',minute:'2-digit',hour12:true
          });
        }catch(e){ ll=String(u.LastLogin); }
      }
      const roleDisplay=esc(u.Role).replace(/([a-z])([A-Z])/g,'$1 $2');
      h+=`<tr>
        <td>${esc(u.UserID)}</td>
        <td style="font-weight:600">${esc(u.Name)}</td>
        <td>${roleDisplay}</td>
        <td>${esc(u.Branch)}</td>
        <td><span style="color:${u.Active?'#16a34a':'#dc2626'};font-weight:600">${u.Active?'Active':'Inactive'}</span></td>
        <td style="font-size:12px;color:#6b7280">${ll}</td>
        <td style="white-space:nowrap">
          <button class="ghost" data-edituser="${esc(u.UserID)}">Edit</button>
          <button class="ghost" data-reset="${esc(u.UserID)}">Reset PW</button>
          <button class="ghost" data-toggle="${esc(u.UserID)}" data-active="${u.Active}">${u.Active?'Disable':'Enable'}</button>
          <button class="ghost" onclick="showUserActivity('${esc(u.UserID)}','${esc(u.Name)}')">Activity</button>
        </td></tr>`;
    });
    $('u_list').innerHTML=h+'</table>';
  }catch(err){$('u_list').innerHTML=`<p class="err">${err.message}</p>`;}
}
async function loadUserDropdown(){
  if(!$('mp_user'))return;
  try{const{users}=await api('users_list');
    $('mp_user').innerHTML=users.map(u=>`<option value="${esc(u.UserID)}">${esc(u.Name)} (${esc(u.Role)})</option>`).join('');
  }catch(e){}
}
function loadModulePerms(){
  const userId=val('mp_user');if(!userId)return;
  const userSel=$('mp_user');
  const opt=userSel?userSel.selectedOptions[0]:null;
  const roleMatch=(opt?opt.textContent:'').match(/\(([^)]+)\)/);
  const role=roleMatch?roleMatch[1]:'Operator';
  const allowed=getModulePerms(userId,role);
  const MODULE_LABELS={dashboard:'Dashboard',members:'Members',loans:'Loans',repayments:'Repayments',
    deposits:'Fixed Deposits',savings:'Savings',transfers:'Transfers',society:'Society Bank',
    expenses:'Expenses',reports:'Reports',approvals:'Loan Approvals',settings:'Settings',users:'Users',account:'My Account'};
  let h='';
  ALL_MODULES.forEach(mod=>{
    const checked=allowed.includes(mod)?'checked':'';
    h+=`<div class="mod-toggle"><label>${esc(MODULE_LABELS[mod]||mod)}</label>`+
      `<label class="toggle-sw"><input type="checkbox" id="mp_${mod}" ${checked}/><span></span></label></div>`;
  });
  $('mp_perms').innerHTML=h;
  if($('mp_actions'))$('mp_actions').style.display='flex';
}
function saveModulePerms(){
  const userId=val('mp_user');if(!userId)return;
  const allowed=ALL_MODULES.filter(m=>{const cb=$('mp_'+m);return cb&&cb.checked;});
  setModulePerms(userId,allowed);
  if($('mp_msg'))$('mp_msg').textContent='Saved.';
  showToast('Module permissions saved','ok');
}
function resetModulePerms(){
  const userId=val('mp_user');if(!userId)return;
  localStorage.removeItem('modperms_'+userId);
  loadModulePerms();showToast('↩ Reset to role defaults','ok');
}
async function toggleUser(userId,active){try{await api('users_update',{userId,active:!active});loadUsers();}catch(e){alert(e.message);}}
async function resetUser(userId){try{const{tempPassword}=await api('users_reset_pw',{userId});alert('New temp password for '+userId+':\n\n'+tempPassword);}catch(e){alert(e.message);}}

/* ── USER ACTIVITY MODAL (#4) ────────────────────────────────── */
async function showUserActivity(userId, userName){
  openModal('Recent Activity — '+userName,
    `<div id="ua_loading" style="text-align:center;padding:20px;color:#6b7280">Loading activity…</div>`);
  try{
    const{activity}=await api('user_activity',{userId});
    if(!activity||!activity.length){
      $('ua_loading').innerHTML='<p style="color:#6b7280;text-align:center">No recorded activity for this user.</p>';
      return;
    }
    const TYPE_COLORS={
      'Repayment':'#16a34a','Loan Added':'#2563eb','Expense':'#dc2626',
      'Savings Txn':'#7c3aed','Deposit':'#d97706','Member Added':'#0891b2'
    };
    let h='<div style="max-height:60vh;overflow-y:auto">';
    h+='<table><tr><th style="text-align:left">Type</th><th style="text-align:left">Ref</th><th style="text-align:left">Detail</th><th style="text-align:left">Date / Time (IST)</th></tr>';
    activity.forEach(a=>{
      const color=TYPE_COLORS[a.type]||'#374151';
      let ts='—';
      if(a.at){try{ts=new Date(a.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});}catch(e){ts=a.at;}}
      h+=`<tr><td><span style="background:${color}18;color:${color};padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap">${esc(a.type)}</span></td>`+
         `<td style="font-size:12px;font-weight:600">${esc(a.ref||'')}</td>`+
         `<td style="font-size:12px;max-width:200px">${esc(a.detail||'')}</td>`+
         `<td style="font-size:11px;color:#6b7280;white-space:nowrap">${ts}</td></tr>`;
    });
    h+='</table></div>';
    $('ua_loading').outerHTML=h;
  }catch(err){
    if($('ua_loading'))$('ua_loading').innerHTML=`<p style="color:#dc2626">${esc(err.message)}</p>`;
  }
}

/* ── PASSWORD CHANGE ─────────────────────────────────────────── */
async function changePw(){
  $('cp_msg').textContent='';
  try{await api('change_password',{oldPassword:val('cp_Old'),newPassword:val('cp_New')});
    $('cp_msg').textContent='Updated.';$('cp_Old').value=$('cp_New').value='';
  }catch(err){$('cp_msg').textContent=err.message;}
}

/* ── PROFILE (#9 profile photo) ─────────────────────────────── */
async function loadProfile(){
  try{const{profile}=await api('profile_get');
    setV('prof_Name',profile.name);setV('prof_DisplayName',profile.displayName);
    setV('prof_Phone',profile.phone);setV('prof_Email',profile.email);setV('prof_Address',profile.address);
  }catch(e){}
  // Always refresh avatars after profile loads (Fix 1: sync PWA+desktop)
  refreshAvatars();
  // Show current avatar in profile page
  if(session){
    const avatar=localStorage.getItem('avatar_'+session.userId);
    const wrap=$('prof_avatar_wrap');if(!wrap)return;
    if(avatar) wrap.innerHTML=`<img src="${avatar}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid var(--primary)" />`;
    else wrap.innerHTML=`<div style="width:72px;height:72px;border-radius:50%;background:var(--chip-bg);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:var(--chip-fg);border:3px solid var(--primary)">${esc((session.name||'?')[0].toUpperCase())}</div>`;
  }
}
async function saveProfile(){
  $('prof_msg').textContent='Saving…';
  try{await api('profile_update',{profile:{name:val('prof_Name'),displayName:val('prof_DisplayName'),phone:val('prof_Phone'),email:val('prof_Email'),address:val('prof_Address')}});
    $('prof_msg').textContent='Profile saved.';
  }catch(err){$('prof_msg').textContent=err.message;}
}
// Live crop preview (#7)
document.addEventListener('change', e=>{
  if(e.target.id!=='prof_photo') return;
  const f=e.target.files[0]; if(!f) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      const prev=$('prof_crop_preview'); const canvas=$('prof_crop_canvas');
      if(!prev||!canvas) return;
      const sz=Math.min(img.width,img.height);
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,100,100);
      const sx=(img.width-sz)/2, sy=(img.height-sz)/2;
      ctx.drawImage(img,sx,sy,sz,sz,0,0,100,100);
      prev.style.display='block';
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(f);
});
async function saveProfilePhoto(){
  const f=$('prof_photo').files[0];if(!f){showToast('Please select a photo first.','warn');return;}
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      const OUTPUT=200; canvas.width=OUTPUT; canvas.height=OUTPUT;
      const ctx=canvas.getContext('2d');
      const sz=Math.min(img.width,img.height);
      const sx=(img.width-sz)/2, sy=(img.height-sz)/2;
      ctx.drawImage(img,sx,sy,sz,sz,0,0,OUTPUT,OUTPUT);
      const compressed=canvas.toDataURL('image/jpeg',0.85);
      localStorage.setItem('avatar_'+session.userId,compressed);
      showToast('Profile photo saved','ok');
      // Hide preview
      if($('prof_crop_preview'))$('prof_crop_preview').style.display='none';
      if($('prof_photo'))$('prof_photo').value='';
      loadProfile();
      // Refresh topbar + sidebar avatar without full re-login
      refreshAvatars();
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(f);
}
function refreshAvatars(){
  if(!session) return;
  const avatar=localStorage.getItem('avatar_'+session.userId);
  const avatarHtml=avatar
    ?`<img src="${avatar}" class="topbar-avatar" title="My profile" onclick="showView('account')" />`
    :`<div class="topbar-avatar-placeholder" title="My profile" onclick="showView('account')">${esc((session.name||'?')[0].toUpperCase())}</div>`;
  // Update topbar who area avatar
  const whoEl=$('who'); if(whoEl){
    const existing=whoEl.querySelector('.topbar-avatar,.topbar-avatar-placeholder');
    if(existing){const newEl=document.createElement('div');newEl.innerHTML=avatarHtml;const newAvatar=newEl.firstChild;if(newAvatar)whoEl.replaceChild(newAvatar,existing);}
  }
  // Update sidebar
  if($('nav_lastlogin')){
    const avDiv=$('nav_lastlogin').querySelector('.nl-avatar,.nl-avatar-ph');
    if(avDiv){const newEl=document.createElement('div');newEl.innerHTML=avatar?`<img src="${avatar}" class="nl-avatar" />`:`<div class="nl-avatar-ph">${esc((session.name||'?')[0].toUpperCase())}</div>`;if(newEl.firstChild)avDiv.replaceWith(newEl.firstChild);}
  }
}

/* ── LOAN APPROVALS (#6 full workflow) ───────────────────────── */
/* Notifications stored in localStorage per user */
function getApprovalNotifs(userId){try{return JSON.parse(localStorage.getItem('apnotif_'+userId)||'[]');}catch(e){return[];}}
function addApprovalNotif(userId,msg){const n=getApprovalNotifs(userId);n.unshift({msg,ts:new Date().toISOString()});localStorage.setItem('apnotif_'+userId,JSON.stringify(n.slice(0,20)));}
function checkApprovalNotifications(){
  if(!session)return;
  const n=getApprovalNotifs(session.userId);
  const badge=$('ap_badge');if(badge)badge.style.display=n.length?'inline-block':'none';
}
function clearApprovalForm(){
  if($('ap_LoanId'))$('ap_LoanId').value='';
  if($('ap_Remarks'))$('ap_Remarks').value='';
  if($('ap_Doc'))$('ap_Doc').value='';
  if($('ap_msg'))$('ap_msg').textContent='';
}
function clearApprovalView(){
  if($('ap_list'))$('ap_list').innerHTML='<p class="msg">View cleared. Click Refresh to reload.</p>';
}
async function loadApprovals(){
  // Show & clear notifications
  const notifs=getApprovalNotifs(session.userId);
  if($('ap_badge'))$('ap_badge').style.display='none';
  localStorage.setItem('apnotif_'+session.userId,'[]');
  try{const{approvals}=await api('approval_list');
    if(!approvals.length){$('ap_list').innerHTML='<p class="msg">No approvals yet.</p>';return;}
    let h='';
    approvals.forEach(a=>{
      const l=a.loan||{};
      // Detect Keep Pending (stored as Pending with [Keep Pending] prefix in comments)
      const rawRemark=a.remarks||'';
      const displayStatus=(a.status==='Pending'&&rawRemark.startsWith('[Keep Pending]'))?'Keep Pending':a.status;
      const displayComments=rawRemark.replace(/^\[Review\]\s*/,'').replace(/^\[Keep Pending\]\s*/,'');
      const statusClass=displayStatus==='Approved'?'approved':displayStatus==='Rejected'?'rejected':displayStatus==='Keep Pending'?'keepending':'';
      const statusColor=displayStatus==='Approved'?'#16a34a':displayStatus==='Rejected'?'#dc2626':displayStatus==='Keep Pending'?'#7c3aed':'#d97706';
      h+=`<div class="card ap-card ${statusClass}" style="margin:10px 0">`;
      h+=`<div class="card-head"><h2>Loan ${esc(a.loan_id)} — ${esc(l.borrower||'')}</h2><span style="color:${statusColor};font-weight:700">${esc(displayStatus)}</span></div>`;
      const submittedAt=a.submitted_at?new Date(a.submitted_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}):'-';
      h+=`<div class="summary">${summaryHtml([['Branch',esc(l.branch||'')],['Amount',rupee(l.amount||0)],['Type',esc(l.loan_type||'')],['Submitted by',esc(a.submitted_by_name||'')],['Pending with',esc(a.next_role||'')],['Submitted at',submittedAt],['Remarks',esc(a.remarks||'—')],['Reviewed by',esc(a.reviewed_by||'—')],['Decision notes',esc(displayComments||'—')]])}</div>`;
      if(a.doc_url) h+=`<div style="margin:8px 0"><a href="${esc(a.doc_url)}" target="_blank" class="ghost" style="padding:6px 12px;border-radius:8px;background:#eaf1fb;color:#2c4a7c;text-decoration:none;font-size:12px">📎 View Document${a.doc_name?' — '+esc(a.doc_name):''}</a></div>`;
      // Notification banners
      if(notifs.length) h+=`<div style="background:#fef3c7;border-radius:6px;padding:6px 10px;font-size:12px;margin:6px 0">${notifs.map(n=>`🔔 ${esc(n.msg)}`).join('<br>')}</div>`;
      // Action controls for reviewers (CEO approves/rejects BM submissions; Director has 3 options)
      const role=session.role;
      const canReview=(role==='CEO'&&(a.next_role==='CEO'||a.next_role==='Director'&&a.status==='Approved'))||
        (role==='Director'&&a.next_role==='Director')||(role==='Admin');
      if(canReview){
        const opts=role==='Director'
          ?`<option value="Approved">✅ Approve</option><option value="Rejected">❌ Reject</option><option value="Keep Pending">⏳ Keep Pending</option>`
          :`<option value="Approved">✅ Approve</option><option value="Rejected">❌ Reject back to BM</option>`;
        h+=`<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">`;
        h+=`<div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:10px">`;
        h+=`<label>Decision<select id="ap_status_${esc(a.loan_id)}">${opts}</select></label>`;
        h+=`<label>Note / Comment<input id="ap_comment_${esc(a.loan_id)}" placeholder="Add your note (required for Reject / Keep Pending)" /></label>`;
        h+=`</div>`;
        h+=`<button class="primary" data-approveaction="save" data-loanid="${esc(a.loan_id)}">Save decision</button>`;
        h+=`</div>`;
      }
      // Re-submit button for BM when CEO sends back
      const canResubmit=(role==='BranchManager'||role==='CEO')&&a.status==='Rejected'&&a.next_role==='CEO';
      if(canResubmit){
        h+=`<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">`;
        h+=`<p style="font-size:12px;color:#dc2626;margin:0 0 8px">Returned with note: <b>${esc(displayComments||'—')}</b></p>`;
        h+=`<div class="grid" style="grid-template-columns:1fr;margin-bottom:8px">`;
        h+=`<label>Updated remarks / attachment<input id="ap_resub_remarks_${esc(a.loan_id)}" value="${esc(a.remarks||'')}" /></label>`;
        h+=`<label>Updated document<input type="file" id="ap_resub_doc_${esc(a.loan_id)}" accept="image/*,application/pdf" /></label>`;
        h+=`</div>`;
        h+=`<button class="primary" data-resubmit="${esc(a.loan_id)}">↩ Re-submit for approval</button>`;
        h+=`</div>`;
      }
      h+=`</div>`;
    });
    $('ap_list').innerHTML=h;
  }catch(err){$('ap_list').innerHTML=`<p class="err">${err.message}</p>`;}
}
async function submitApproval(){
  $('ap_msg').textContent='Submitting…';
  const loanId=val('ap_LoanId').trim();
  if(!loanId){$('ap_msg').textContent='Loan ID required.';return;}
  const f=$('ap_Doc').files[0];
  const payload={loanId,remarks:val('ap_Remarks'),nextRole:val('ap_SendTo')||'CEO'};
  if(f){payload.docBase64=await fileToB64(f);payload.docMime=f.type;payload.docName=f.name;}
  try{const{nextRole}=await api('approval_submit',payload);
    $('ap_msg').textContent='';
    // Show detailed success popup (Fix #3)
    const nowIST=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
    showApprovalConfirm(loanId,nextRole,nowIST);
    notifyRoleUsers(nextRole,'New loan approval submitted: Loan '+loanId+' from '+session.name);
    clearApprovalForm();
    loadApprovals();
  }catch(err){$('ap_msg').textContent='';showToast('⚠ '+err.message,'err');}
}
function showApprovalConfirm(loanId,nextRole,timeStr){
  openModal('Loan Submitted for Approval',
    `<div style="text-align:center;padding:8px 0">`+
    `<div style="font-size:40px;margin-bottom:8px;color:#16a34a">&#10003;</div>`+
    `<h3 style="margin:0 0 12px;font-size:16px;color:#16a34a">Submitted Successfully</h3>`+
    `<table class="meta" style="width:100%;text-align:left"><tr><td style="padding:6px 8px;color:#6b7280;font-size:12px">Loan ID</td><td style="padding:6px 8px;font-weight:700">${esc(loanId)}</td></tr>`+
    `<tr style="background:#f9fafb"><td style="padding:6px 8px;color:#6b7280;font-size:12px">Submitted to</td><td style="padding:6px 8px;font-weight:700;color:#2563eb">${esc(nextRole)}</td></tr>`+
    `<tr><td style="padding:6px 8px;color:#6b7280;font-size:12px">Submitted at</td><td style="padding:6px 8px;font-weight:600">${esc(timeStr)}</td></tr>`+
    `<tr style="background:#f9fafb"><td style="padding:6px 8px;color:#6b7280;font-size:12px">Submitted by</td><td style="padding:6px 8px">${esc(session?.name||'')}</td></tr>`+
    `</table>`+
    `<p style="margin:14px 0 0;font-size:12px;color:#6b7280">The ${esc(nextRole)} will review and take action. You will be notified of the decision.</p>`+
    `<button class="primary" onclick="closeModal()" style="margin-top:16px;width:100%">OK</button>`+
    `</div>`);
}
async function handleApprovalAction(action,loanId){
  const statusRaw=$(`ap_status_${loanId}`)?.value||'Pending';
  const comments=$(`ap_comment_${loanId}`)?.value||'';
  if((statusRaw==='Rejected'||statusRaw==='Keep Pending')&&!comments.trim()){
    alert('Please add a note when rejecting or keeping pending.');return;
  }
  // Backend only accepts Approved/Rejected/Pending — map Keep Pending → Pending with note prefix
  const statusForApi=statusRaw==='Keep Pending'?'Pending':statusRaw;
  const commentsForApi=statusRaw==='Keep Pending'?('[Keep Pending] '+comments):('[Review] '+comments);
  try{await api('approval_update',{loanId,status:statusForApi,comments:commentsForApi});
    showToast('Decision saved: '+statusRaw,'ok');
    notifyAboutDecision(loanId,statusRaw,comments);
    loadApprovals();
  }catch(err){showToast('⚠ '+err.message,'err');}
}
async function resubmitApproval(loanId){
  const remarks=$(`ap_resub_remarks_${loanId}`)?.value||'';
  const docInput=$(`ap_resub_doc_${loanId}`);
  const payload={loanId,remarks,nextRole:'CEO'};
  if(docInput&&docInput.files[0]){const f=docInput.files[0];payload.docBase64=await fileToB64(f);payload.docMime=f.type;payload.docName=f.name;}
  try{await api('approval_submit',payload);
    showToast('Re-submitted to CEO','ok');
    notifyRoleUsers('CEO','Loan '+loanId+' re-submitted by '+session.name+' with updated documents.');
    loadApprovals();
  }catch(err){showToast('⚠ '+err.message,'err');}
}
function notifyRoleUsers(role,msg){
  // Notify any logged-in users of that role (stored so they see it next time they open approvals)
  try{const{users}=JSON.parse(localStorage.getItem('coop_users_cache')||'{}');
    if(users) users.filter(u=>u.Role===role&&u.Active).forEach(u=>addApprovalNotif(u.UserID,msg));
  }catch(e){}
  // Always store for the current session if role matches
  if(session&&session.role===role) addApprovalNotif(session.userId,msg);
}
function notifyAboutDecision(loanId,status,comments){
  const msg=`Loan ${loanId}: ${status} by ${session.name}${comments?' — Note: '+comments:''}`;
  // Notify BM and CEO
  ['CEO','BranchManager'].forEach(role=>notifyRoleUsers(role,msg));
  checkApprovalNotifications();
  // Update badge
  if($('ap_badge'))$('ap_badge').style.display='inline-block';
}
// Cache users list for notification lookup
(async()=>{try{if(token()){const r=await api('users_list');localStorage.setItem('coop_users_cache',JSON.stringify(r));}}catch(e){}})();

/* ── RESET ALL ───────────────────────────────────────────────── */
async function resetAll(){
  if(val('reset_confirm').trim()!=='RESET'){$('reset_msg').textContent='Type RESET to confirm.';return;}
  if(!confirm('This will permanently delete ALL transaction data. User accounts will be kept.\n\nAre you absolutely sure?'))return;
  $('reset_msg').textContent='Deleting…';
  try{const{message}=await api('reset_all',{confirm:'CONFIRMED'});$('reset_msg').textContent=message;$('reset_confirm').value='';}
  catch(err){$('reset_msg').textContent=err.message;}
}
