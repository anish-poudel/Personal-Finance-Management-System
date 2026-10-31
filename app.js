(() => {
  "use strict";

  /* ================================================================
     PERSONAL FINANCE MANAGER
     - One source of truth for the selected BS period
     - Central validation, versioned migration and safety backups
     - Browser-local storage only; no cloud overwrite/sync behavior
     ================================================================ */

  /* ---------- Configuration and state ---------- */
  const STORAGE = {
    data: "finance-data-v3",
    previousData: "finance-data-v2",
    legacyTransactions: "personalFinanceTransactions_v1",
    legacyBudgets: "personalFinanceBudget_v1",
    lastSafetyBackup: "finance-last-safety-backup-v1",
    preRestoreBackup: "finance-pre-restore-backup-v1"
  };
  const DATA_VERSION = 3;
  const MONTHS = ["बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज", "कात्तिक", "मंसिर", "पुष", "माघ", "फागुन", "चैत"];
  const CATEGORIES = {
    income: ["Salary", "Office Allowances", "Bonus", "Teaching Income", "Business Income", "Investment Income", "Gift Received", "Other Income"],
    expense: ["Food & Groceries", "Rent & Housing", "Fuel & Transport", "Motorcycle Maintenance", "Utilities", "Mobile & Internet", "Health & Medicine", "Clothing & Shopping", "Education", "Family Support", "Entertainment", "Travel", "Loan Repayment", "Investment", "Personal Care", "Other Expense"]
  };
  const ACCOUNTS = ["Bank", "Cash", "Digital Wallet", "Credit Card", "Loan Account", "Investment Account", "Other"];
  const $ = id => document.getElementById(id);
  const state = {
    transactions: [],
    budgets: {},
    selectedBsYear: null,
    selectedBsMonth: null,
    syncStatus: "local-only",
    charts: {},
    currentPage: 1,
    pageSize: 25,
    storageWarning: "",
    blockWrites: false
  };

  /* ---------- BS / AD date utilities ---------- */
  function NepaliDateClass() {
    return window.NepaliDate?.default || window.NepaliDate || null;
  }

  function isoFromDate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function parseAD(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  function adToBs(adDate) {
    const DateClass = NepaliDateClass();
    const date = parseAD(adDate);
    if (!DateClass || !date) return null;
    try {
      const nepali = new DateClass(date);
      return { year: nepali.getYear(), month: nepali.getMonth() + 1, day: nepali.getDate() };
    } catch (error) {
      console.error("AD to BS conversion failed", error);
      return null;
    }
  }

  function bsToAd(bsDate) {
    const DateClass = NepaliDateClass();
    if (!DateClass || !/^\d{4}-\d{2}-\d{2}$/.test(String(bsDate))) return null;
    try {
      const [year, month, day] = bsDate.split("-").map(Number);
      if (month < 1 || month > 12 || day < 1 || day > 32) return null;
      const nepali = new DateClass(year, month - 1, day);
      const adDate = nepali.toJsDate();
      if (!adDate || Number.isNaN(adDate.getTime())) return null;
      const iso = isoFromDate(adDate);
      const roundTrip = adToBs(iso);
      return roundTrip && roundTrip.year === year && roundTrip.month === month && roundTrip.day === day ? iso : null;
    } catch (error) {
      console.error("BS to AD conversion failed", error);
      return null;
    }
  }

  function isValidBsDate(value) {
    return bsToAd(value) !== null;
  }

  function formatBsDate(adDate) {
    const parts = adToBs(adDate);
    return parts ? `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}` : "BS unavailable";
  }

  function getBsMonthKeyFromAdDate(adDate) {
    const parts = adToBs(adDate);
    return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}` : "";
  }

  function getBsQuarterKeyFromAdDate(adDate) {
    const parts = adToBs(adDate);
    return parts ? `${parts.year}-Q${Math.floor((parts.month - 1) / 3) + 1}` : "";
  }

  function selectedBsMonthKey() {
    if (!Number.isInteger(state.selectedBsYear) || !Number.isInteger(state.selectedBsMonth)) return "";
    return `${state.selectedBsYear}-${String(state.selectedBsMonth).padStart(2, "0")}`;
  }

  function bsMonthTitle(key) {
    const [year, month] = String(key).split("-").map(Number);
    return `${MONTHS[month - 1] || "Unknown"} ${year || ""}`.trim();
  }

  function bsQuarterTitle(key) {
    const match = String(key).match(/^(\d{4})-Q([1-4])$/);
    return match ? `${match[1]} · Q${match[2]}` : key;
  }

  /* ---------- Validation and data migration ---------- */
  function validateTransaction(transaction, existingIds = new Set()) {
    if (!transaction || typeof transaction !== "object") return "Invalid transaction record.";
    if (typeof transaction.id !== "string" || !transaction.id.trim()) return "Missing transaction ID.";
    if (existingIds.has(transaction.id)) return "Duplicate transaction ID.";
    if (transaction.type !== "income" && transaction.type !== "expense") return "Transaction type must be income or expense.";
    if (!Number.isFinite(Number(transaction.amount)) || Number(transaction.amount) <= 0) return "Amount must be a number greater than zero.";
    if (typeof transaction.date !== "string" || !parseAD(transaction.date)) return "Transaction date is invalid.";
    if (typeof transaction.category !== "string" || !transaction.category.trim()) return "Transaction category is required.";
    if (typeof transaction.account !== "string" || !ACCOUNTS.includes(transaction.account)) return "Transaction account is invalid.";
    if (typeof (transaction.note ?? "") !== "string") return "Transaction description must be text.";
    return null;
  }

  function safeTimestamp(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();
  }

  function createId() {
    return window.crypto?.randomUUID ? window.crypto.randomUUID() : `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeTransaction(transaction) {
    const item = transaction && typeof transaction === "object" ? transaction : {};
    return {
      id: typeof item.id === "string" && item.id.trim() ? item.id : createId(),
      date: String(item.date || ""),
      type: item.type,
      amount: Number(item.amount),
      category: String(item.category || "").trim(),
      account: ACCOUNTS.includes(item.account) ? item.account : "Other",
      note: String(item.note || "").trim(),
      createdAt: safeTimestamp(item.createdAt),
      updatedAt: safeTimestamp(item.updatedAt)
    };
  }

  function migrateTransactions(input) {
    const result = { transactions: [], rejected: 0 };
    if (!Array.isArray(input)) return result;
    const ids = new Set();
    for (const raw of input) {
      const item = normalizeTransaction(raw);
      const problem = validateTransaction(item, ids);
      if (problem) {
        result.rejected += 1;
        continue;
      }
      ids.add(item.id);
      result.transactions.push(item);
    }
    return result;
  }

  function normalizeBudgets(value) {
    const clean = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return clean;
    for (const [key, amount] of Object.entries(value)) {
      const numeric = Number(amount);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key) && Number.isFinite(numeric) && numeric >= 0) clean[key] = numeric;
    }
    return clean;
  }

  function preserveCorruptStorage(key, raw) {
    if (raw == null) return;
    try {
      localStorage.setItem(`finance-corrupt-${key}-${Date.now()}`, raw);
      state.storageWarning = `A damaged saved-data record was preserved separately (${key}). Check your JSON backups before continuing.`;
      return true;
    } catch (error) {
      state.blockWrites = true;
      state.storageWarning = `Saved data for ${key} could not be read, and the browser could not preserve a copy. App writes are paused to avoid overwriting it. Export or recover a backup before continuing.`;
      return false;
    }
  }

  function readJSON(key, fallback) {
    let raw;
    try {
      raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      console.error("Could not read saved data", key, error);
      preserveCorruptStorage(key, raw);
      return fallback;
    }
  }

  function buildBackupPayload(reason = "Manual backup") {
    return {
      app: "Personal Finance Manager",
      schemaVersion: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      reason,
      transactions: state.transactions,
      budgets: state.budgets
    };
  }

  function saveSafetyBackup(reason) {
    try {
      localStorage.setItem(STORAGE.lastSafetyBackup, JSON.stringify(buildBackupPayload(reason)));
      return true;
    } catch (error) {
      setStatus("Safety backup could not be saved. The requested deletion or replacement was cancelled.", "error");
      return false;
    }
  }

  function savePreRestoreBackup() {
    try {
      localStorage.setItem(STORAGE.preRestoreBackup, JSON.stringify(buildBackupPayload("Before restoring the last safety backup")));
      return true;
    } catch (error) {
      setStatus("Could not preserve the current records. Restore was cancelled.", "error");
      return false;
    }
  }

  function loadData() {
    let source = readJSON(STORAGE.data, null);
    let sourceLabel = STORAGE.data;

    // Upgrade the previous modular version before falling back to the older app keys.
    if (!source || !Array.isArray(source.transactions)) {
      const previous = readJSON(STORAGE.previousData, null);
      if (previous && Array.isArray(previous.transactions)) {
        source = previous;
        sourceLabel = STORAGE.previousData;
      } else if (previous !== null) {
        preserveCorruptStorage(STORAGE.previousData, localStorage.getItem(STORAGE.previousData));
      }
    }

    if (source !== null && (!source || typeof source !== "object" || !Array.isArray(source.transactions))) {
      preserveCorruptStorage(sourceLabel, localStorage.getItem(sourceLabel));
      source = null;
    }

    if (source && Array.isArray(source.transactions)) {
      const migrated = migrateTransactions(source.transactions);
      state.transactions = migrated.transactions;
      state.budgets = normalizeBudgets(source.budgets);
      persist();
      if (migrated.rejected) setStatus(`${migrated.rejected} invalid record(s) were skipped during data migration. Check your JSON backup if anything looks missing.`, "error");
      else if (sourceLabel !== STORAGE.data || source.schemaVersion !== DATA_VERSION) setStatus("Your existing records were migrated to the latest data format.", "success");
      return;
    }

    const legacyRows = readJSON(STORAGE.legacyTransactions, []);
    const legacy = migrateTransactions(legacyRows);
    state.transactions = legacy.transactions;
    state.budgets = normalizeBudgets(readJSON(STORAGE.legacyBudgets, {}));
    persist();
    if (legacy.rejected) setStatus(`${legacy.rejected} older record(s) could not be migrated because they did not pass validation.`, "error");
    else if (legacy.transactions.length) setStatus("Older records were migrated to the latest data format.", "success");
  }

  function persist() {
    if (state.blockWrites) {
      setStatus(state.storageWarning || "Saving is paused to protect damaged browser data.", "error");
      return false;
    }
    try {
      localStorage.setItem(STORAGE.data, JSON.stringify({
        schemaVersion: DATA_VERSION,
        transactions: state.transactions,
        budgets: state.budgets,
        updatedAt: new Date().toISOString()
      }));
      return true;
    } catch (error) {
      console.error("Could not save finance data", error);
      setStatus("Could not save data. Browser storage may be full or disabled. Download a JSON backup and free some browser storage.", "error");
      return false;
    }
  }

  function addTransaction(raw) {
    const now = new Date().toISOString();
    const item = normalizeTransaction({ ...raw, id: createId(), createdAt: now, updatedAt: now });
    const problem = validateTransaction(item, new Set(state.transactions.map(tx => tx.id)));
    if (problem) throw new Error(problem);
    state.transactions.push(item);
    if (!persist()) {
      state.transactions.pop();
      throw new Error("The transaction was not saved. Your previous records were kept.");
    }
  }

  /* ---------- User feedback and shared calculations ---------- */
  function setStatus(message, type = "") {
    const element = $("status");
    if (!element) return;
    element.textContent = message;
    element.className = `status ${type}`.trim();
  }

  function money(value) {
    return "NPR " + Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function sum(items, type) {
    return items.filter(item => item.type === type).reduce((total, item) => total + item.amount, 0);
  }

  function selectedItems() {
    const key = selectedBsMonthKey();
    return state.transactions.filter(item => getBsMonthKeyFromAdDate(item.date) === key);
  }

  /* ---------- BS period selector ---------- */
  function buildBSMonthPicker() {
    const DateClass = NepaliDateClass();
    if (!DateClass) {
      setStatus("Nepali date converter did not load. Check your internet connection and refresh the page.", "error");
      return false;
    }

    const today = new DateClass(new Date());
    const currentYear = today.getYear();
    const currentMonth = today.getMonth() + 1;
    const yearSelect = $("bsYear");
    const monthSelect = $("bsMonth");
    yearSelect.replaceChildren();
    monthSelect.replaceChildren();

    for (let year = currentYear - 8; year <= currentYear + 5; year += 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      yearSelect.append(option);
    }
    MONTHS.forEach((monthName, index) => {
      const option = document.createElement("option");
      option.value = String(index + 1);
      option.textContent = monthName;
      monthSelect.append(option);
    });

    state.selectedBsYear = currentYear;
    state.selectedBsMonth = currentMonth;
    yearSelect.value = String(currentYear);
    monthSelect.value = String(currentMonth);
    updateSelectedMonth();
    return true;
  }

  function updateSelectedMonth() {
    // Read the visible controls only here; all business logic uses state thereafter.
    state.selectedBsYear = Number($("bsYear").value);
    state.selectedBsMonth = Number($("bsMonth").value);
    state.currentPage = 1;
    const key = selectedBsMonthKey();
    $("selectedBsLabel").textContent = `Selected period: ${bsMonthTitle(key)}`;
    $("transactionTitle").textContent = `Transactions for ${bsMonthTitle(key)}`;
    $("budgetInput").value = state.budgets[key] ?? "";
    render();
  }

  function updateCategoryOptions() {
    const type = $("txType").value;
    const select = $("txCategory");
    const previous = select.value;
    select.replaceChildren();
    CATEGORIES[type].forEach(category => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      select.append(option);
    });
    if (CATEGORIES[type].includes(previous)) select.value = previous;
  }

  /* ---------- Dashboard rendering ---------- */
  function renderSummary(items) {
    const income = sum(items, "income");
    const expense = sum(items, "expense");
    const budget = Number(state.budgets[selectedBsMonthKey()] || 0);
    $("totalIncome").textContent = money(income);
    $("totalExpense").textContent = money(expense);
    $("netBalance").textContent = money(income - expense);
    $("budgetRemaining").textContent = budget > 0 ? money(budget - expense) : "Not set";
    $("budgetRemaining").className = budget > 0 && budget - expense < 0 ? "expense" : "income";
  }

  function renderTable(items) {
    const query = $("searchInput").value.trim().toLowerCase();
    const type = $("tableTypeFilter").value;
    const account = $("tableAccountFilter").value;
    const filtered = items.filter(item =>
      (type === "all" || item.type === type) &&
      (account === "all" || item.account === account) &&
      (!query || `${item.note} ${item.category} ${item.account}`.toLowerCase().includes(query))
    );

    const sort = $("sortBy").value;
    filtered.sort((a, b) => {
      if (sort === "date-asc") return a.date.localeCompare(b.date);
      if (sort === "amount-desc") return b.amount - a.amount;
      if (sort === "amount-asc") return a.amount - b.amount;
      return b.date.localeCompare(a.date);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
    const start = (state.currentPage - 1) * state.pageSize;
    const visibleRows = filtered.slice(start, start + state.pageSize);
    const body = $("transactionRows");
    body.replaceChildren();

    if (!visibleRows.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 8;
      cell.className = "empty";
      cell.textContent = filtered.length ? "No transactions on this page." : "No transactions match this BS month and filter.";
    }

    visibleRows.forEach(item => {
      const row = body.insertRow();
      [formatBsDate(item.date), item.type === "income" ? "Income" : "Expenditure", item.category, item.note || "—", item.account].forEach(value => {
        const cell = row.insertCell();
        cell.textContent = value;
      });
      const incomeCell = row.insertCell();
      incomeCell.className = "amount-cell income";
      incomeCell.textContent = item.type === "income" ? money(item.amount) : "—";
      const expenseCell = row.insertCell();
      expenseCell.className = "amount-cell expense";
      expenseCell.textContent = item.type === "expense" ? money(item.amount) : "—";
      const actionCell = row.insertCell();
      const button = document.createElement("button");
      button.className = "delete-btn";
      button.textContent = "Delete";
      button.type = "button";
      button.setAttribute("aria-label", `Delete ${item.category} transaction for ${money(item.amount)}`);
      button.addEventListener("click", () => deleteTransaction(item.id));
      actionCell.append(button);
    });

    const from = filtered.length ? start + 1 : 0;
    const to = Math.min(start + state.pageSize, filtered.length);
    $("transactionCount").textContent = `${from}–${to} of ${filtered.length} matching · ${items.length} transactions in ${bsMonthTitle(selectedBsMonthKey())}.`;
    $("pageInfo").textContent = `Page ${state.currentPage} of ${totalPages}`;
    $("prevPageBtn").disabled = state.currentPage <= 1;
    $("nextPageBtn").disabled = state.currentPage >= totalPages;
  }

  function showChartEmpty(id, message) {
    const canvas = $(id);
    if (state.charts[id]) {
      state.charts[id].destroy();
      delete state.charts[id];
    }
    canvas.hidden = true;
    let empty = canvas.parentElement.querySelector(".chart-empty");
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.setAttribute("role", "status");
      canvas.parentElement.append(empty);
    }
    empty.textContent = message;
  }

  function updateChart(id, type, data, options, hasData, emptyMessage) {
    const canvas = $(id);
    if (!hasData) {
      showChartEmpty(id, emptyMessage);
      return;
    }
    const empty = canvas.parentElement.querySelector(".chart-empty");
    if (empty) empty.remove();
    canvas.hidden = false;
    if (!window.Chart) {
      showChartEmpty(id, "Charts need an internet connection to load.");
      return;
    }
    if (state.charts[id]) {
      state.charts[id].data = data;
      state.charts[id].options = options;
      state.charts[id].update();
    } else {
      state.charts[id] = new window.Chart(canvas, { type, data, options });
    }
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" },
      tooltip: { callbacks: { label: context => `${context.dataset.label}: ${money(context.raw)}` } }
    }
  };

  function renderCharts(items) {
    const expenseItems = items.filter(item => item.type === "expense");
    const categories = {};
    expenseItems.forEach(item => { categories[item.category] = (categories[item.category] || 0) + item.amount; });
    updateChart("categoryChart", "doughnut", {
      labels: Object.keys(categories), datasets: [{ data: Object.values(categories) }]
    }, { ...chartOptions, cutout: "58%" }, expenseItems.length > 0, "No expenses recorded for this BS month.");

    const [selectedYear, selectedMonth] = selectedBsMonthKey().split("-").map(Number);
    const months = [];
    let year = selectedYear;
    let month = selectedMonth;
    for (let index = 0; index < 6; index += 1) {
      months.unshift(`${year}-${String(month).padStart(2, "0")}`);
      month -= 1;
      if (month === 0) { month = 12; year -= 1; }
    }
    const monthlyGroups = months.map(key => state.transactions.filter(item => getBsMonthKeyFromAdDate(item.date) === key));
    const monthlyHasData = monthlyGroups.some(group => group.length > 0);
    updateChart("monthlyChart", "bar", {
      labels: months.map(bsMonthTitle),
      datasets: [
        { label: "Income", data: monthlyGroups.map(group => sum(group, "income")), backgroundColor: "#16845b" },
        { label: "Expenditure", data: monthlyGroups.map(group => sum(group, "expense")), backgroundColor: "#c93645" }
      ]
    }, { ...chartOptions, scales: { y: { beginAtZero: true } } }, monthlyHasData, "No income or expenditure recorded in these six BS months.");

    const dailyIncome = Array(32).fill(0);
    const dailyExpense = Array(32).fill(0);
    items.forEach(item => {
      const parts = adToBs(item.date);
      if (!parts) return;
      if (item.type === "income") dailyIncome[parts.day - 1] += item.amount;
      else dailyExpense[parts.day - 1] += item.amount;
    });
    const maxDay = Math.max(30, ...items.map(item => adToBs(item.date)?.day || 0));
    updateChart("dailyChart", "line", {
      labels: Array.from({ length: maxDay }, (_, index) => String(index + 1)),
      datasets: [
        { label: "Income", data: dailyIncome.slice(0, maxDay), borderColor: "#16845b", tension: 0.25 },
        { label: "Expenditure", data: dailyExpense.slice(0, maxDay), borderColor: "#c93645", tension: 0.25 }
      ]
    }, { ...chartOptions, scales: { y: { beginAtZero: true } } }, items.length > 0, "No transactions recorded for this BS month.");

    const quarterKeys = [1, 2, 3, 4].map(quarter => `${selectedYear}-Q${quarter}`);
    const quarterGroups = quarterKeys.map(key => state.transactions.filter(item => getBsQuarterKeyFromAdDate(item.date) === key));
    updateChart("quarterChart", "bar", {
      labels: quarterKeys.map(bsQuarterTitle),
      datasets: [
        { label: "Income", data: quarterGroups.map(group => sum(group, "income")), backgroundColor: "#16845b" },
        { label: "Expenditure", data: quarterGroups.map(group => sum(group, "expense")), backgroundColor: "#c93645" }
      ]
    }, { ...chartOptions, indexAxis: "y", scales: { x: { beginAtZero: true } } }, quarterGroups.some(group => group.length), `No transactions recorded in BS ${selectedYear}.`);
  }

  function render() {
    const items = selectedItems();
    renderSummary(items);
    renderTable(items);
    renderCharts(items);
    $("restoreLastBackupBtn").disabled = !readJSON(STORAGE.lastSafetyBackup, null);
    $("restorePreRestoreBackupBtn").disabled = !readJSON(STORAGE.preRestoreBackup, null);
  }

  /* ---------- Safe destructive actions ---------- */
  function deleteTransaction(id) {
    const transaction = state.transactions.find(item => item.id === id);
    if (!transaction) return;
    if (!window.confirm("Permanently delete this transaction? A safety backup will be created first.")) return;
    if (!saveSafetyBackup("Before deleting one transaction")) return;

    const previous = state.transactions;
    state.transactions = previous.filter(item => item.id !== id);
    if (!persist()) { state.transactions = previous; return; }
    render();
    setStatus("Transaction deleted. A safety backup is available.", "success");
  }

  function deleteSelectedMonth() {
    const key = selectedBsMonthKey();
    const previous = state.transactions;
    const remaining = previous.filter(item => getBsMonthKeyFromAdDate(item.date) !== key);
    const count = previous.length - remaining.length;
    if (!count) { setStatus(`No transactions found in ${bsMonthTitle(key)}.`); return; }
    if (!window.confirm(`Delete all ${count} transactions in ${bsMonthTitle(key)}? A safety backup will be created first.`)) return;
    if (!saveSafetyBackup(`Before deleting all transactions in ${bsMonthTitle(key)}`)) return;

    state.transactions = remaining;
    if (!persist()) { state.transactions = previous; return; }
    state.currentPage = 1;
    render();
    setStatus(`${count} transaction(s) deleted from ${bsMonthTitle(key)}. A safety backup is available.`, "success");
  }

  /* ---------- Filtered reports and exports ---------- */
  function reportItems() {
    let items = $("reportPeriod").value === "all" ? [...state.transactions] : selectedItems();
    const type = $("reportType").value;
    if (type !== "both") items = items.filter(item => item.type === type);
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  function reportRows(items) {
    return items.map(item => ({
      "Date (BS)": formatBsDate(item.date),
      "Date (AD)": item.date,
      "Type": item.type === "income" ? "Income" : "Expenditure",
      "Category": item.category,
      "Description": item.note,
      "Account": item.account,
      "Income (NPR)": item.type === "income" ? item.amount : "",
      "Expenditure (NPR)": item.type === "expense" ? item.amount : ""
    }));
  }

  function filenameTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  }

  function exportExcel() {
    if (!window.XLSX) { setStatus("Excel export library is unavailable. Check your internet connection.", "error"); return; }
    const items = reportItems();
    const rows = reportRows(items);
    const workbook = window.XLSX.utils.book_new();
    const income = items.filter(item => item.type === "income");
    const expense = items.filter(item => item.type === "expense");
    const addSheet = (sheetRows, fallback) => window.XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ Message: fallback }]);

    window.XLSX.utils.book_append_sheet(workbook, addSheet(rows, "No matching records"), "Transactions");
    window.XLSX.utils.book_append_sheet(workbook, addSheet(reportRows(income), "No income records"), "Income");
    window.XLSX.utils.book_append_sheet(workbook, addSheet(reportRows(expense), "No expenditure records"), "Expenditure");
    window.XLSX.utils.book_append_sheet(workbook, window.XLSX.utils.json_to_sheet([{
      Period: $("reportPeriod").value === "all" ? "All transactions" : bsMonthTitle(selectedBsMonthKey()),
      "Transaction type filter": $("reportType").value,
      "Record count": items.length,
      "Total income (NPR)": sum(items, "income"),
      "Total expenditure (NPR)": sum(items, "expense"),
      "Net (NPR)": sum(items, "income") - sum(items, "expense")
    }]), "Summary");
    window.XLSX.writeFile(workbook, `finance-report-${filenameTimestamp()}.xlsx`);
    setStatus("Filtered Excel report downloaded.", "success");
  }

  function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCSV() {
    const headers = ["Date (BS)", "Date (AD)", "Type", "Category", "Account", "Income (NPR)", "Expenditure (NPR)", "Description"];
    const rows = reportItems().map(item => [
      formatBsDate(item.date), item.date, item.type === "income" ? "Income" : "Expenditure", item.category,
      item.account, item.type === "income" ? item.amount : "", item.type === "expense" ? item.amount : "", item.note
    ]);
    const csv = [headers, ...rows].map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    downloadBlob("\ufeff" + csv, "text/csv;charset=utf-8", `finance-report-${filenameTimestamp()}.csv`);
    setStatus("Filtered CSV report downloaded.", "success");
  }

  function exportJSON() {
    downloadBlob(JSON.stringify(buildBackupPayload("Manual JSON backup"), null, 2), "application/json", `finance-backup-${filenameTimestamp()}.json`);
    setStatus("JSON backup downloaded. Store it somewhere secure.", "success");
  }

  function validateBackup(parsed) {
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.transactions)) {
      throw new Error("This file does not contain a valid transactions array.");
    }
    const migrated = migrateTransactions(parsed.transactions);
    if (migrated.rejected) throw new Error(`${migrated.rejected} record(s) failed validation. No data was changed.`);
    return { transactions: migrated.transactions, budgets: normalizeBudgets(parsed.budgets) };
  }

  function applyBackup(snapshot) {
    const previous = { transactions: state.transactions, budgets: state.budgets };
    state.transactions = snapshot.transactions;
    state.budgets = snapshot.budgets;
    if (!persist()) {
      state.transactions = previous.transactions;
      state.budgets = previous.budgets;
      return false;
    }
    state.currentPage = 1;
    updateSelectedMonth();
    return true;
  }

  async function restoreJSON(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const snapshot = validateBackup(parsed);
      if (!window.confirm(`Restore ${snapshot.transactions.length} transactions? This replaces the records currently stored in this browser.`)) return;
      if (!saveSafetyBackup("Before restoring an uploaded JSON backup")) return;
      if (applyBackup(snapshot)) setStatus("JSON backup restored. Your previous data was saved as a safety backup.", "success");
    } catch (error) {
      setStatus(`Restore failed: ${error.message}`, "error");
    }
  }

  function restoreStoredBackup(storageKey, label) {
    try {
      const parsed = readJSON(storageKey, null);
      const snapshot = validateBackup(parsed);
      if (!window.confirm(`Restore ${label} containing ${snapshot.transactions.length} transactions? Current records will be replaced.`)) return;
      if (!saveSafetyBackup(`Before restoring ${label}`)) return;
      if (applyBackup(snapshot)) {
        localStorage.removeItem(storageKey);
        render();
        setStatus(`${label} restored. The records that were replaced are now saved as the last safety backup.`, "success");
      }
    } catch (error) {
      setStatus(`${label} could not be restored: ${error.message}`, "error");
    }
  }

  function restoreLastSafetyBackup() {
    try {
      const parsed = readJSON(STORAGE.lastSafetyBackup, null);
      const snapshot = validateBackup(parsed);
      if (!window.confirm(`Restore the last safety backup containing ${snapshot.transactions.length} transactions? Current records will be replaced.`)) return;
      if (!savePreRestoreBackup()) return;
      if (applyBackup(snapshot)) setStatus("Last safety backup restored. Use ‘Undo last backup restore’ to recover the records that were present immediately before this restore.", "success");
    } catch (error) {
      setStatus(`No usable safety backup is available: ${error.message}`, "error");
    }
  }

  function printReport() {
    const items = reportItems();
    const body = $("printRows");
    body.replaceChildren();
    items.forEach(item => {
      const row = body.insertRow();
      [formatBsDate(item.date), item.type === "income" ? "Income" : "Expenditure", item.category, item.note || "—", item.account].forEach(value => {
        const cell = row.insertCell();
        cell.textContent = value;
      });
      row.insertCell().textContent = item.type === "income" ? money(item.amount) : "—";
      row.insertCell().textContent = item.type === "expense" ? money(item.amount) : "—";
    });
    $("printSubtitle").textContent = `${$("reportPeriod").value === "all" ? "All transactions" : bsMonthTitle(selectedBsMonthKey())} · ${items.length} records · ${$("reportType").value}`;
    $("printTotals").textContent = `Income: ${money(sum(items, "income"))} | Expenditure: ${money(sum(items, "expense"))} | Net: ${money(sum(items, "income") - sum(items, "expense"))}`;
    window.print();
  }

  /* ---------- Event handlers ---------- */
  function bindEvents() {
    $("bsYear").addEventListener("change", updateSelectedMonth);
    $("bsMonth").addEventListener("change", updateSelectedMonth);
    $("txType").addEventListener("change", updateCategoryOptions);

    $("dateMode").addEventListener("change", () => {
      const useBs = $("dateMode").value === "BS";
      $("bsDateGroup").hidden = !useBs;
      $("adDateGroup").hidden = useBs;
    });

    $("transactionForm").addEventListener("submit", event => {
      event.preventDefault();
      try {
        const isBs = $("dateMode").value === "BS";
        const enteredDate = isBs ? $("txBsDate").value.trim() : $("txAdDate").value;
        if (isBs && !isValidBsDate(enteredDate)) throw new Error("Enter a valid BS date in YYYY-MM-DD format.");
        const adDate = isBs ? bsToAd(enteredDate) : enteredDate;
        const raw = {
          date: adDate,
          type: $("txType").value,
          amount: Number($("txAmount").value),
          category: $("txCategory").value,
          account: $("txAccount").value,
          note: $("txNote").value.trim()
        };
        const draft = normalizeTransaction({ ...raw, id: "validation-draft" });
        const problem = validateTransaction(draft);
        if (problem) throw new Error(problem);
        addTransaction(raw);

        $("transactionForm").reset();
        $("dateMode").value = "BS";
        $("bsDateGroup").hidden = false;
        $("adDateGroup").hidden = true;
        const DateClass = NepaliDateClass();
        if (DateClass) {
          const today = new DateClass(new Date());
          $("txBsDate").value = `${today.getYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        }
        $("txAdDate").value = isoFromDate(new Date());
        updateCategoryOptions();
        render();
        setStatus("Transaction saved successfully.", "success");
      } catch (error) {
        setStatus(error.message, "error");
      }
    });

    $("saveBudgetBtn").addEventListener("click", () => {
      const raw = $("budgetInput").value.trim();
      const amount = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        setStatus("Budget must be a valid number equal to or greater than zero.", "error");
        return;
      }
      const key = selectedBsMonthKey();
      const hadPrevious = Object.prototype.hasOwnProperty.call(state.budgets, key);
      const previous = state.budgets[key];
      state.budgets[key] = amount;
      if (persist()) { render(); setStatus("Budget saved.", "success"); }
      else if (hadPrevious) state.budgets[key] = previous;
      else delete state.budgets[key];
    });

    $("searchInput").addEventListener("input", () => { state.currentPage = 1; renderTable(selectedItems()); });
    ["tableTypeFilter", "tableAccountFilter", "sortBy"].forEach(id => $(id).addEventListener("change", () => {
      state.currentPage = 1;
      renderTable(selectedItems());
    }));
    $("prevPageBtn").addEventListener("click", () => { state.currentPage -= 1; renderTable(selectedItems()); });
    $("nextPageBtn").addEventListener("click", () => { state.currentPage += 1; renderTable(selectedItems()); });

    $("excelBtn").addEventListener("click", exportExcel);
    $("csvBtn").addEventListener("click", exportCSV);
    $("jsonBtn").addEventListener("click", exportJSON);
    $("printBtn").addEventListener("click", printReport);
    $("restoreInput").addEventListener("change", event => {
      const file = event.target.files[0];
      if (file) restoreJSON(file);
      event.target.value = "";
    });
    $("restoreLastBackupBtn").addEventListener("click", restoreLastSafetyBackup);
    $("restorePreRestoreBackupBtn").addEventListener("click", () => restoreStoredBackup(STORAGE.preRestoreBackup, "the pre-restore backup"));
    $("deleteMonthBtn").addEventListener("click", deleteSelectedMonth);
  }

  /* ---------- Initialization ---------- */
  function init() {
    loadData();

    const DateClass = NepaliDateClass();
    if (DateClass) {
      const today = new DateClass(new Date());
      $("txBsDate").value = `${today.getYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      $("txAdDate").value = isoFromDate(new Date());
    }

    updateCategoryOptions();
    const accountSelect = $("tableAccountFilter");
    ACCOUNTS.forEach(account => {
      const option = document.createElement("option");
      option.value = account;
      option.textContent = account;
      accountSelect.append(option);
    });

    bindEvents();
    const periodReady = buildBSMonthPicker();
    if (!periodReady) {
      $("transactionRows").innerHTML = '<tr><td colspan="8" class="empty">BS calendar is unavailable. Refresh after the date library loads.</td></tr>';
    }
    if (state.storageWarning) setStatus(state.storageWarning, "error");
    else if (!DateClass) setStatus("Nepali date converter is unavailable. Check CDN access and refresh.", "error");
    else if (!$("status").textContent || $("status").textContent === "Ready") setStatus("Ready · Data is stored in this browser only.");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
