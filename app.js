(() => {
"use strict";

/* ---------- Configuration and state ---------- */
const STORAGE = { data: "finance-data-v2", settings: "finance-settings-v1", legacy: "personalFinanceTransactions_v1", legacyBudget: "personalFinanceBudget_v1" };
const SCHEMA_VERSION = 2;
const MONTHS = ["बैशाख","जेठ","असार","साउन","भदौ","असोज","कात्तिक","मंसिर","पुष","माघ","फागुन","चैत"];
const CATEGORIES = {
  income: ["Salary","Office Allowances","Bonus","Teaching Income","Business Income","Investment Income","Gift Received","Other Income"],
  expense: ["Food & Groceries","Rent & Housing","Fuel & Transport","Motorcycle Maintenance","Utilities","Mobile & Internet","Health & Medicine","Clothing & Shopping","Education","Family Support","Entertainment","Travel","Loan Repayment","Investment","Personal Care","Other Expense"]
};
const ACCOUNTS = ["Bank","Cash","Digital Wallet","Credit Card","Loan Account","Investment Account","Other"];
const $ = id => document.getElementById(id);
const state = {
  transactions: [], budgets: {}, selectedBsMonth: null,
  selectedType: "both", charts: {}, page: 1, pageSize: 100
};

/* ---------- Date conversion ---------- */
function NepaliDateClass() {
  return window.NepaliDate?.default || window.NepaliDate || null;
}
function isoFromDate(d) {
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}
function parseAD(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null;
  const [y,m,d] = iso.split("-").map(Number);
  const date = new Date(y,m-1,d,12);
  return date.getFullYear()===y && date.getMonth()===m-1 && date.getDate()===d ? date : null;
}
function bsParts(adIso) {
  const Ctor = NepaliDateClass(), date = parseAD(adIso);
  if (!Ctor || !date) return null;
  try {
    const nd = new Ctor(date);
    return {year:nd.getYear(),month:nd.getMonth()+1,day:nd.getDate()};
  } catch (_) { return null; }
}
function adFromBS(bsIso) {
  const Ctor = NepaliDateClass();
  if (!Ctor || !/^\d{4}-\d{2}-\d{2}$/.test(String(bsIso))) return null;
  try {
    const [y,m,d] = bsIso.split("-").map(Number);
    if (m<1 || m>12 || d<1 || d>32) return null;
    const nd = new Ctor(y,m-1,d), ad = nd.toJsDate();
    const iso = ad && isoFromDate(ad);
    const roundTrip = iso && bsParts(iso);
    return roundTrip && roundTrip.year===y && roundTrip.month===m && roundTrip.day===d ? iso : null;
  } catch (_) { return null; }
}
function bsKey(adIso) {
  const p = bsParts(adIso);
  return p ? `${p.year}-${String(p.month).padStart(2,"0")}` : "";
}
function bsDisplay(adIso) {
  const p = bsParts(adIso);
  return p ? `${String(p.day).padStart(2,"0")}/${String(p.month).padStart(2,"0")}/${p.year}` : "BS unavailable";
}
function bsMonthTitle(key) {
  const [year,month] = key.split("-").map(Number);
  return `${MONTHS[month-1] || "Unknown"} ${year}`;
}
function bsQuarterKey(adIso) {
  const p = bsParts(adIso);
  return p ? `${p.year}-Q${Math.floor((p.month-1)/3)+1}` : "";
}
function bsQuarterTitle(key) {
  const m = key.match(/^(\d{4})-Q([1-4])$/);
  return m ? `${m[1]} · Q${m[2]}` : key;
}

/* ---------- Storage, migration and validation ---------- */
function readJSON(key, fallback) {
  try { const raw=localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (error) { console.error("Storage read failed",key,error); return fallback; }
}
function validTransaction(t, ids = new Set()) {
  return t && typeof t.id==="string" && !ids.has(t.id) &&
    (t.type==="income" || t.type==="expense") &&
    Number.isFinite(Number(t.amount)) && Number(t.amount)>0 &&
    typeof t.date==="string" && !!parseAD(t.date) &&
    typeof t.category==="string" && CATEGORIES[t.type].includes(t.category) &&
    typeof t.account==="string" && ACCOUNTS.includes(t.account) &&
    typeof (t.note ?? "")==="string";
}
function normalizeTransaction(t) {
  return {id:String(t.id),date:t.date,type:t.type,amount:Number(t.amount),category:t.category,
    account:ACCOUNTS.includes(t.account)?t.account:"Other",note:String(t.note||""),
    createdAt:t.createdAt || new Date().toISOString(),updatedAt:t.updatedAt || new Date().toISOString()};
}
function loadData() {
  const current=readJSON(STORAGE.data,null);
  if (current && current.schemaVersion===SCHEMA_VERSION && Array.isArray(current.transactions)) {
    const ids=new Set();
    state.transactions=current.transactions.filter(t=>validTransaction(t,ids) && (ids.add(t.id),true)).map(normalizeTransaction);
    state.budgets=current.budgets && typeof current.budgets==="object" ? current.budgets : {};
    return;
  }
  // One-time migration from the earlier app's storage keys.
  const old=readJSON(STORAGE.legacy,[]);
  if (Array.isArray(old)) {
    const ids=new Set();
    state.transactions=old.filter(t=>validTransaction({...t,account:ACCOUNTS.includes(t.account)?t.account:"Other"},ids) && (ids.add(t.id),true)).map(normalizeTransaction);
  }
  const oldBudgets=readJSON(STORAGE.legacyBudget,{});
  state.budgets=oldBudgets && typeof oldBudgets==="object" ? oldBudgets : {};
  persist();
  if (state.transactions.length) setStatus("Older records were migrated to the new data format.","success");
}
function persist() {
  try {
    localStorage.setItem(STORAGE.data,JSON.stringify({schemaVersion:SCHEMA_VERSION,transactions:state.transactions,budgets:state.budgets,updatedAt:new Date().toISOString()}));
    localStorage.setItem(STORAGE.settings,JSON.stringify({schemaVersion:1,lastUpdated:new Date().toISOString()}));
    return true;
  } catch (error) {
    setStatus("Could not save data. Browser storage may be full; download a JSON backup.","error");
    return false;
  }
}
function addTransaction(raw) {
  const item={...raw,id:crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    amount:Number(raw.amount),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  if (!validTransaction(item,new Set(state.transactions.map(t=>t.id)))) throw new Error("Please check the date, amount, category and other required fields.");
  state.transactions.push(item);
  if (!persist()) { state.transactions.pop(); throw new Error("The transaction was not saved."); }
}

/* ---------- UI state and rendering ---------- */
function setStatus(message,type="") {
  const el=$("status"); el.textContent=message; el.className=`status ${type}`;
}
function money(value) {
  return "NPR " + Number(value||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function sum(items,type) { return items.filter(t=>t.type===type).reduce((n,t)=>n+t.amount,0); }
function selectedItems() { return state.transactions.filter(t=>bsKey(t.date)===state.selectedBsMonth); }
function updateCategoryOptions() {
  const type=$("txType").value, select=$("txCategory"), previous=select.value;
  select.replaceChildren();
  CATEGORIES[type].forEach(name=>{const o=document.createElement("option");o.value=name;o.textContent=name;select.append(o);});
  if (CATEGORIES[type].includes(previous)) select.value=previous;
}
function buildBSMonthPicker() {
  const Ctor=NepaliDateClass();
  if (!Ctor) { setStatus("Nepali date library did not load. Refresh with an internet connection.","error"); return; }
  const today=new Ctor(new Date()), currentYear=today.getYear(), currentMonth=today.getMonth()+1;
  const yearSelect=$("bsYear"), monthSelect=$("bsMonth");
  const years=[];
  for(let y=currentYear-8;y<=currentYear+5;y++) years.push(y);
  yearSelect.replaceChildren();
  years.forEach(y=>{const o=document.createElement("option");o.value=String(y);o.textContent=String(y);yearSelect.append(o);});
  yearSelect.value=String(currentYear);
  monthSelect.replaceChildren();
  MONTHS.forEach((name,i)=>{const o=document.createElement("option");o.value=String(i+1).padStart(2,"0");o.textContent=name;monthSelect.append(o);});
  monthSelect.value=String(currentMonth).padStart(2,"0");
  state.selectedBsMonth=`${currentYear}-${String(currentMonth).padStart(2,"0")}`;
  updateSelectedMonth();
}
function updateSelectedMonth() {
  state.selectedBsMonth=`${$("bsYear").value}-${$("bsMonth").value}`;
  $("selectedBsLabel").textContent=`Selected period: ${bsMonthTitle(state.selectedBsMonth)}`;
  $("transactionTitle").textContent=`Transactions for ${bsMonthTitle(state.selectedBsMonth)}`;
  $("budgetInput").value=state.budgets[state.selectedBsMonth] ?? "";
  render();
}
function renderSummary(items) {
  const income=sum(items,"income"), expense=sum(items,"expense"), budget=Number(state.budgets[state.selectedBsMonth]||0);
  $("totalIncome").textContent=money(income); $("totalExpense").textContent=money(expense);
  $("netBalance").textContent=money(income-expense);
  $("budgetRemaining").textContent=budget ? money(budget-expense) : "Not set";
  $("budgetRemaining").className=budget && budget-expense<0 ? "expense" : "income";
}
function renderTable(items) {
  const query=$("searchInput").value.trim().toLowerCase(), type=$("tableTypeFilter").value, account=$("tableAccountFilter").value;
  let rows=items.filter(t=>(type==="all"||t.type===type)&&(account==="all"||t.account===account)&&
    (!query||`${t.note} ${t.category} ${t.account}`.toLowerCase().includes(query)));
  const sort=$("sortBy").value;
  rows.sort((a,b)=>sort==="date-asc"?a.date.localeCompare(b.date):sort==="amount-desc"?b.amount-a.amount:sort==="amount-asc"?a.amount-b.amount:b.date.localeCompare(a.date));
  const body=$("transactionRows"); body.replaceChildren();
  if(!rows.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=8;td.className="empty";td.textContent="No transactions match this BS month and filter."; }
  rows.forEach(t=>{
    const tr=body.insertRow();
    [bsDisplay(t.date),t.type==="income"?"Income":"Expenditure",t.category,t.note||"—",t.account].forEach(v=>{const td=tr.insertCell();td.textContent=v;});
    const inc=tr.insertCell();inc.className="amount-cell income";inc.textContent=t.type==="income"?money(t.amount):"—";
    const exp=tr.insertCell();exp.className="amount-cell expense";exp.textContent=t.type==="expense"?money(t.amount):"—";
    const action=tr.insertCell(),btn=document.createElement("button");btn.className="delete-btn";btn.textContent="Delete";btn.type="button";btn.setAttribute("aria-label",`Delete transaction ${t.category} ${money(t.amount)}`);
    btn.addEventListener("click",()=>deleteTransaction(t.id));action.append(btn);
  });
  $("transactionCount").textContent=`${rows.length} displayed · ${items.length} transactions in ${bsMonthTitle(state.selectedBsMonth)}.`;
}
function updateChart(id,type,data,options) {
  const canvas=$(id);
  if(!window.Chart){canvas.parentElement.textContent="Charts require an internet connection.";return;}
  if(state.charts[id]) {state.charts[id].data=data;state.charts[id].options=options;state.charts[id].update();return;}
  state.charts[id]=new Chart(canvas,{type,data,options});
}
const chartOptions={responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${money(c.raw)}`}}}};
function renderCharts(items) {
  const categories={};items.filter(t=>t.type==="expense").forEach(t=>categories[t.category]=(categories[t.category]||0)+t.amount);
  updateChart("categoryChart","doughnut",{labels:Object.keys(categories),datasets:[{data:Object.values(categories)}]},{...chartOptions,cutout:"58%"});

  const [sy,sm]=state.selectedBsMonth.split("-").map(Number), months=[];
  let y=sy,m=sm;for(let i=0;i<6;i++){months.unshift(`${y}-${String(m).padStart(2,"0")}`);m--;if(m===0){m=12;y--;}}
  const monthlyGroups=months.map(k=>state.transactions.filter(t=>bsKey(t.date)===k));
  updateChart("monthlyChart","bar",{labels:months.map(bsMonthTitle),datasets:[
    {label:"Income",data:monthlyGroups.map(g=>sum(g,"income")),backgroundColor:"#16845b"},
    {label:"Expenditure",data:monthlyGroups.map(g=>sum(g,"expense")),backgroundColor:"#c93645"}]},
    {...chartOptions,scales:{y:{beginAtZero:true}}});

  const dailyIncome=Array(32).fill(0),dailyExpense=Array(32).fill(0);
  items.forEach(t=>{const p=bsParts(t.date);if(p){if(t.type==="income")dailyIncome[p.day-1]+=t.amount;else dailyExpense[p.day-1]+=t.amount;}});
  const maxDay=Math.max(30,...items.map(t=>bsParts(t.date)?.day||0));
  updateChart("dailyChart","line",{labels:Array.from({length:maxDay},(_,i)=>String(i+1)),datasets:[
    {label:"Income",data:dailyIncome.slice(0,maxDay),borderColor:"#16845b",tension:.25},
    {label:"Expenditure",data:dailyExpense.slice(0,maxDay),borderColor:"#c93645",tension:.25}]},
    {...chartOptions,scales:{y:{beginAtZero:true}}});

  const qKeys=[1,2,3,4].map(q=>`${sy}-Q${q}`), qGroups=qKeys.map(q=>state.transactions.filter(t=>bsQuarterKey(t.date)===q));
  updateChart("quarterChart","bar",{labels:qKeys.map(bsQuarterTitle),datasets:[
    {label:"Income",data:qGroups.map(g=>sum(g,"income")),backgroundColor:"#16845b"},
    {label:"Expenditure",data:qGroups.map(g=>sum(g,"expense")),backgroundColor:"#c93645"}]},
    {...chartOptions,indexAxis:"y",scales:{x:{beginAtZero:true}}});
}
function render() {
  const items=selectedItems();renderSummary(items);renderTable(items);renderCharts(items);
}
function deleteTransaction(id) {
  if(!confirm("Permanently delete this transaction?")) return;
  const previous=state.transactions;state.transactions=previous.filter(t=>t.id!==id);
  if(!persist()){state.transactions=previous;return;}render();setStatus("Transaction deleted.","success");
}

/* ---------- Reports and backups ---------- */
function reportItems() {
  let items=$("reportPeriod").value==="all"?[...state.transactions]:selectedItems();
  const type=$("reportType").value;if(type!=="both")items=items.filter(t=>t.type===type);
  return items.sort((a,b)=>a.date.localeCompare(b.date));
}
function reportRows(items) {
  return items.map(t=>({"Date (BS)":bsDisplay(t.date),"Date (AD)":t.date,"Type":t.type==="income"?"Income":"Expenditure","Category":t.category,"Description":t.note,"Account":t.account,"Income (NPR)":t.type==="income"?t.amount:"","Expenditure (NPR)":t.type==="expense"?t.amount:""}));
}
function exportExcel() {
  if(!window.XLSX){setStatus("Excel library unavailable. Check your internet connection.","error");return;}
  const items=reportItems(), rows=reportRows(items), wb=XLSX.utils.book_new();
  const income=items.filter(t=>t.type==="income"),expense=items.filter(t=>t.type==="expense");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.length?rows:[{"Message":"No matching records"}]),"Transactions");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(reportRows(income)),"Income");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(reportRows(expense)),"Expenditure");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{"Period":$("reportPeriod").value==="all"?"All transactions":bsMonthTitle(state.selectedBsMonth),"Record count":items.length,"Total income":sum(items,"income"),"Total expenditure":sum(items,"expense"),"Net":sum(items,"income")-sum(items,"expense")}]),"Summary");
  XLSX.writeFile(wb,`finance-report-${new Date().toISOString().slice(0,10)}.xlsx`);setStatus("Excel report downloaded.","success");
}
function downloadBlob(content,type,name) {
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportCSV() {
  const rows=[["Date (BS)","Date (AD)","Type","Category","Account","Income (NPR)","Expenditure (NPR)","Description"],...reportRows(reportItems()).map(r=>[r["Date (BS)"],r["Date (AD)"],r.Type,r.Category,r.Account,r["Income (NPR)"],r["Expenditure (NPR)"],r.Description])];
  const csv=rows.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  downloadBlob("\ufeff"+csv,"text/csv;charset=utf-8",`finance-report-${Date.now()}.csv`);setStatus("Filtered CSV report downloaded.","success");
}
function exportJSON() {
  const backup={app:"Personal Finance Manager",schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),transactions:state.transactions,budgets:state.budgets};
  downloadBlob(JSON.stringify(backup,null,2),"application/json",`finance-backup-${new Date().toISOString().slice(0,10)}.json`);
  setStatus("JSON backup downloaded. Store it safely.","success");
}
async function restoreJSON(file) {
  try {
    const parsed=JSON.parse(await file.text()),incoming=parsed.transactions;
    if(!Array.isArray(incoming))throw new Error("This file does not contain a valid transactions array.");
    const ids=new Set(),clean=[];
    for(const t of incoming){const normalized=normalizeTransaction(t);if(!validTransaction(normalized,ids))throw new Error("Backup contains an invalid or duplicate transaction.");ids.add(normalized.id);clean.push(normalized);}
    if(!confirm(`Restore ${clean.length} transactions? This replaces the records currently stored in this browser.`))return;
    const old={transactions:state.transactions,budgets:state.budgets};
    state.transactions=clean;state.budgets=parsed.budgets&&typeof parsed.budgets==="object"?parsed.budgets:{};
    if(!persist()){state.transactions=old.transactions;state.budgets=old.budgets;return;}
    render();setStatus("Backup restored successfully.","success");
  } catch(error){setStatus(`Restore failed: ${error.message}`,"error");}
}
function printReport() {
  const items=reportItems(),body=$("printRows");body.replaceChildren();
  items.forEach(t=>{
    const tr=body.insertRow(),vals=[bsDisplay(t.date),t.type==="income"?"Income":"Expenditure",t.category,t.note||"—",t.account];
    vals.forEach(v=>{const td=tr.insertCell();td.textContent=v;});
    tr.insertCell().textContent=t.type==="income"?money(t.amount):"—";
    tr.insertCell().textContent=t.type==="expense"?money(t.amount):"—";
  });
  $("printSubtitle").textContent=`${$("reportPeriod").value==="all"?"All transactions":bsMonthTitle(state.selectedBsMonth)} · ${items.length} records`;
  $("printTotals").textContent=`Income: ${money(sum(items,"income"))} | Expenditure: ${money(sum(items,"expense"))} | Net: ${money(sum(items,"income")-sum(items,"expense"))}`;
  window.print();
}

/* ---------- Events and initialization ---------- */
function bindEvents() {
  $("bsYear").addEventListener("change",updateSelectedMonth);$("bsMonth").addEventListener("change",updateSelectedMonth);
  $("txType").addEventListener("change",updateCategoryOptions);
  $("dateMode").addEventListener("change",()=>{
    const bs=$("dateMode").value==="BS";$("bsDateGroup").hidden=!bs;$("adDateGroup").hidden=bs;
  });
  $("transactionForm").addEventListener("submit",event=>{
    event.preventDefault();
    try {
      const date=$("dateMode").value==="BS"?adFromBS($("txBsDate").value.trim()):$("txAdDate").value;
      if(!date)throw new Error("Date is invalid or the Nepali date library is unavailable. Enter a valid BS date as YYYY-MM-DD or choose AD.");
      const amount=Number($("txAmount").value),type=$("txType").value,category=$("txCategory").value;
      addTransaction({date,type,amount,category,account:$("txAccount").value,note:$("txNote").value.trim()});
      $("transactionForm").reset();$("dateMode").value="BS";$("bsDateGroup").hidden=false;$("adDateGroup").hidden=true;
      const DateCtor=NepaliDateClass();
      if(DateCtor){const nowBS=new DateCtor(new Date());$("txBsDate").value=`${nowBS.getYear()}-${String(nowBS.getMonth()+1).padStart(2,"0")}-${String(nowBS.getDate()).padStart(2,"0")}`;}
      $("txAdDate").value=isoFromDate(new Date());
      updateCategoryOptions();render();setStatus("Transaction saved successfully.","success");
    } catch(error){setStatus(error.message,"error");}
  });
  $("saveBudgetBtn").addEventListener("click",()=>{
    const v=Number($("budgetInput").value);if(!Number.isFinite(v)||v<0){setStatus("Budget must be zero or a positive number.","error");return;}
    state.budgets[state.selectedBsMonth]=v;if(persist()){render();setStatus("Budget saved.","success");}
  });
  $("searchInput").addEventListener("input",()=>renderTable(selectedItems()));
  ["tableTypeFilter","tableAccountFilter","sortBy"].forEach(id=>$(id).addEventListener("change",()=>renderTable(selectedItems())));
  $("excelBtn").addEventListener("click",exportExcel);$("csvBtn").addEventListener("click",exportCSV);
  $("jsonBtn").addEventListener("click",exportJSON);$("printBtn").addEventListener("click",printReport);
  $("restoreInput").addEventListener("change",e=>{const f=e.target.files[0];if(f)restoreJSON(f);e.target.value="";});
  $("deleteMonthBtn").addEventListener("click",()=>{
    const key=state.selectedBsMonth,old=state.transactions;
    const remaining=old.filter(t=>bsKey(t.date)!==key),count=old.length-remaining.length;
    if(!count){setStatus("No transactions in this BS month.");return;}
    if(!confirm(`Delete all ${count} transactions in ${bsMonthTitle(key)}? Download a JSON backup first if needed.`))return;
    state.transactions=remaining;if(!persist()){state.transactions=old;return;}render();setStatus(`Deleted ${count} transactions from ${bsMonthTitle(key)}.`,"success");
  });
}
function init() {
  loadData();
  const Ctor=NepaliDateClass();
  if(Ctor) {
    const today=new Ctor(new Date()),bsToday=`${today.getYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    $("txBsDate").value=bsToday;$("txAdDate").value=isoFromDate(new Date());
  }
  updateCategoryOptions();
  const accountSelect=$("tableAccountFilter");
  ACCOUNTS.forEach(a=>{const o=document.createElement("option");o.value=a;o.textContent=a;accountSelect.append(o);});
  buildBSMonthPicker();bindEvents();
  if(!Ctor)setStatus("Nepali date converter is unavailable. Check internet/CDN access and reload.","error");
}
document.addEventListener("DOMContentLoaded",init);
})();