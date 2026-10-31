PERSONAL FINANCE MANAGER — GITHUB PAGES SETUP

Files:
- index.html: page structure and library links
- styles.css: visual styling
- app.js: application logic, BS date handling, storage, charts, reports and backups

UPLOAD:
1. Open your personal-finance-manager GitHub repository.
2. Upload these three files into the SAME folder (repository root).
3. Replace the old index.html. Add styles.css and app.js.
4. Commit changes.
5. Wait for GitHub Pages to publish, then refresh your site.

DATA SAFETY:
- Existing records stored under personalFinanceTransactions_v1 and
  personalFinanceBudget_v1 are migrated once into finance-data-v2.
- Data stays in the browser/device. GitHub Pages does not sync localStorage
  between laptop and mobile. Use JSON backup/restore to move records.
- Do not put passwords, bank credentials, private keys or Firebase admin
  credentials in these files or a public GitHub repository.

DATE HANDLING:
- BS date input format: YYYY-MM-DD (English numerals), e.g. 2083-07-15.
- Dashboard selector uses BS year and BS month.
- BS month reporting, transaction table, monthly/daily/quarterly charts,
  and exports use converted BS dates.
- The selected quarter grouping is calendar-year quarters:
  Q1 Baisakh-Asar; Q2 Shrawan-Asoj; Q3 Kartik-Poush; Q4 Magh-Chaitra.

LIMITATIONS:
- This is a browser-local personal finance tracker, not a bank-connected
  accounting system. Loan Account and Investment Account are account labels;
  loan balances and investment market valuations are not automatically tracked.
- Chart.js, SheetJS, and Nepali Date Converter load from public CDNs, so
  charts/Excel/date conversion require internet access.
- Check date conversion with known dates and keep JSON backups.
