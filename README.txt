PERSONAL FINANCE MANAGER — UPDATED GITHUB PAGES VERSION

FILES TO UPLOAD
- index.html — page structure and CDN library links
- styles.css — layout and responsive styling
- app.js — application logic, BS/AD date conversion, validation, storage,
  migration, dashboard, charts, pagination, reporting and backups

UPLOAD TO GITHUB
1. Open your personal-finance-manager repository.
2. Upload index.html, styles.css and app.js into the repository root.
3. Replace the previous versions of all three files.
4. Commit the changes to the branch configured in GitHub Pages (usually main).
5. Open the GitHub Pages website and hard-refresh with Ctrl + Shift + R.

IMPORTANT DATA SAFETY
- The latest data key is finance-data-v3.
- The app migrates records from finance-data-v2 and the earlier keys:
  personalFinanceTransactions_v1 and personalFinanceBudget_v1.
- Invalid or duplicate records are skipped during migration/import; a status
  message reports when records are rejected.
- Before deleting a transaction, deleting a BS month, or restoring an uploaded
  JSON file, the app attempts to create a safety backup in this browser.
- Use “Restore last safety backup” to restore that last safety copy.
- Before restoring the last safety backup, the app also preserves the current
  data as a pre-restore backup. Use “Undo last backup restore” to switch back;
  that pre-restore copy is then consumed, while the replaced data becomes the
  last safety backup.
- Download JSON backups regularly and keep copies outside the browser.
- If browser storage is full/disabled, saving or safety-backup creation may fail.

BS / AD DATE HANDLING
- Enter BS dates as YYYY-MM-DD using English numerals, e.g. 2083-07-15.
- AD dates are stored internally; BS values are computed for display and
  period reporting using Nepali Date Converter.
- Dashboard period state uses selectedBsYear and selectedBsMonth. Business
  logic does not depend on a hidden AD month input.
- The BS quarter grouping is Q1 Baisakh-Asar, Q2 Shrawan-Asoj,
  Q3 Kartik-Poush, and Q4 Magh-Chaitra.

LATEST IMPROVEMENTS
- Centralized transaction validation is used for entry, migration and restore.
- Data migration is versioned and validates records/budgets.
- Corrupted JSON storage is preserved separately when possible and reported.
- Last safety backup before destructive actions, plus restore control.
- Inline status messages replace normal alert dialogs. Confirmations remain
  only for destructive actions.
- Empty charts display clear messages instead of empty/misleading plots.
- Transaction search, type/account filters, sorting and 25-row pagination.
- BS-month selection drives dashboard, table, budget, charts and deletion.
- Excel has Transactions, Income, Expenditure and Summary sheets; CSV and
  print/PDF use the selected report period and type filters.

PRIVACY AND SYNC
- This version is LOCAL-ONLY. It stores data in the browser on the current
  device. It does not synchronize laptop and mobile data.
- No cloud sync has been enabled. This is deliberate: a safe cloud merge needs
  authenticated backend storage, per-record conflict handling and user review;
  simply replacing local data with remote data could lose unsynced records.
- Do not store passwords, bank login credentials, private keys or API secrets
  in the public GitHub repository.

LIMITATIONS
- Loan Account and Investment Account are account labels; loan balances,
  repayment schedules and investment market valuations are not yet managed.
- Recurring transactions, savings goals, CSV import and multi-device cloud
  sync are not implemented in this version.
- Chart.js, SheetJS and Nepali Date Converter load from public CDNs, so the
  charts, Excel export and BS/AD conversion need an internet connection.
- Check a few known BS/AD dates after deployment and keep regular JSON backups.
