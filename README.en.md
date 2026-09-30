# Nexora ERP

[简体中文](README.md) · [Website source](docs/site/) · [Development guide](docs/development.en.md)

A desktop ERP for internal operations, connecting purchasing, warehousing, sales, production and operational finance through traceable documents and stock movements. The desktop uses Electron, Vue 3, TypeScript and Pinia; the server uses FastAPI, SQLAlchemy and SQLite.

The project is in an **internal trial phase for one company, multiple warehouses and online LAN clients**. Windows and macOS clients access centralized server data over HTTPS. Disconnected clients cannot submit changes. Documentation and the website are bilingual; the application UI remains Chinese. Website code is prepared; GitHub Pages is not enabled yet.

## Project features

| Area | Current functionality |
| --- | --- |
| Accounts and permissions | Users, built-in/custom roles, document action permissions, account activation, password resets, permission trees and navigation icon settings. |
| Master data | Materials, suppliers, customers, warehouses and supplier-material relationships; server-side pagination for suppliers. |
| Purchasing | Request approval and split orders, orders, partial receiving, warehouse-confirmed receipts, returns awaiting shipment confirmation, and reversals. |
| Warehousing | Multi-warehouse stock, other inbounds/outbounds, transfers, stocktakes, independently approved adjustments, source movements and stock ledgers. |
| Sales | Orders, partial shipments, linked returns and reversals; confirmation checks remaining order quantities and stock. |
| Production | BOM versions, frozen work-order requirements, partial material issues/returns, completion reports, basic inspection and accepted-goods receipts. |
| Cost and operational finance | Moving-average valuation, manual valuation of unknown costs, material/labor/overhead collection, finished-goods cost allocation, receivable/payable sources, manual payments and reversals. |
| General ledger | Accounts, periods, independently reviewed/confirmed opening balances, independently reviewed/posted/reversed manual journals, posted account ledgers and trial balance; period records do not yet lock business operations. |
| Reports and operations | Basic purchasing/inventory reports and CSV; LAN discovery, certificate fingerprint trust, OS services, backup/restore and upgrade backups. |

Stock and financial changes retain sources, operators and correction records. Confirmation and movements commit together. Unknown prices remain unknown instead of becoming zero. Manual payments and basic inspection do not prove bank settlement or physical verification.

## Development progress

Snapshot: **2026-10-01, verified main commit `9f5a8cf` (formal opening balances merged)**. Work in progress is not delivered mainline functionality. Progress describes capabilities rather than an undefined percentage.

| Stage | Status | Delivered / next steps |
| --- | --- | --- |
| Purchasing–inventory–sales–production flow | Basic flows implemented | Partial receipts/shipments, returns, corrections and tracing; complex cases remain. |
| Backend data access | Migration complete | Existing business access uses ORM; migrations, SQLite configuration and online backup retain necessary low-level operations. |
| Inventory and finished-goods costs | Foundation implemented | Moving-average valuation and batch allocations; variances, work in progress and cross-period costs remain. |
| Ledger master data | Merged | Accounts, periods and auditing; business period locks and closing remain. |
| Formal opening balances | Implemented | First setup before any posted journal, independent review/confirmation, versions and audit, reversal before posting; excluded from current activity. |
| Manual journals | Merged | Balanced entries, independent review, posting, linked reversals and auditing; automatic business journals and formal statements remain. |
| Posted ledger reports | Merged | Account ledgers, trial balance, journal drill-down and CSV; formal opening balances and snapshot sources are available; balance sheet and income statement remain. |
| Closing and period locks | In development | Implementation and testing in the referenced task; outside this mainline snapshot. Business locks remain unavailable. |
| Full financial accounting | Planned | Automatic business journals, formal cost-of-goods-sold entries, subsidiary opening reconciliation, closing and formal financial statements. |
| Business expansion | Planned | MRP, scheduling, rework, quality/after-sales, CRM, equipment, HR and multiple organizations. |
| Data and devices | Planned / acceptance pending | MySQL and offline sync are not implemented; cross-platform devices, unattended startup and recovery drills need acceptance. |

Candidate sequencing and entry conditions are in the [expansion assessment (Chinese)](docs/erp-expansion-assessment.md). Build success does not replace device or business acceptance.

## Development entry points

Requires Node.js 22.12+ and Python 3.11+. Setup, architecture, business constraints, testing, **build instructions**, backup/restore and website publishing now live in the detailed guide:

- [English development guide](docs/development.en.md)
- [中文开发文档](docs/development.zh-CN.md)

Run `npm run docs:build` to generate a local HTML website and bilingual guide. GitHub Pages configuration is included, with hosting intentionally not enabled yet. Installer artifacts go to `release/` and remain unsigned/unnotarized; see the guide for commands.
