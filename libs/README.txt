Required:
  pnp-3.0.10.js          — SharePoint PnP ($pnp.sp)
  spListService.js       — CRUD payload normalization (Person/Lookup/Choice) used by sp-client.js

Used by the app:
  chartjs/               — Chart.js + datalabels (project effort chart; Insights fallback)
  (CDN in index.html)    — ApexCharts 3.x for Insights portfolio charts
  countup/               — Animated KPI numbers on Insights hero
  tabulator/             — Sortable detail tables (blocked, coverage, slippage)
  tippy/                 — Help tooltips on Insights cards (+ popper.min.js)
  flatpickr/             — Loaded for future date filters (optional)

Optional (not wired):
  spListService.js, userProfile.js — legacy helpers from other projects
