# Puente — Implementation plan v1.0

Local-first cashflow and savings app for a contractor paid in CAD and living in MXN.

**Core promise:** Know what you really have, what is already promised, and what you can safely spend before your next income.

No backend. Data stays on device. AI is manual and opt-in. Sharing uses URL fragments, QR codes, and encrypted files.

This plan is the source of truth for scope. Visual and product rules in `.cursor/rules/` enforce it on later features.

---

## How to use this plan

- Build phases in order. A later phase may stub a screen, but it does not ship money math that contradicts an earlier phase.
- Every feature closes the [new-feature checklist](#new-feature-checklist) before it is done.
- User-facing copy is Spanish (Mexico). Code, schemas, and identifiers are English.
- Checkboxes are the acceptance list. Do not mark one done until the behavior exists on device, offline.

---

## Visual system

References: iDroid staff roster and weapons development (MGSV). The app is that HUD applied to cashflow, not a consumer finance dashboard.

### What to copy

- One cyan-on-navy field. Panels are translucent rectangles with a 1px line, not elevated cards.
- Information density: a roster of rows, or a dossier with horizontal stat bars. Whitespace is a hairline grid, not marketing padding.
- Chrome in four bands: status strip, section rail, stage, command bar.
- Status is color used rarely. Healthy reads as bright cyan. Tight reads as amber. Shortfall reads as heat orange. No second palette, no purple, no drop shadows, no 16px “fintech” radii.
- Numbers are tabular. Labels are small-caps. The one hero figure on a screen is large and light.
- Locked or unaffordable rows use a padlock and amber cost, the way a weapon grade shows GMP required vs current.
- A faint photographic or terrain wash may sit behind the UI at low opacity. The UI itself stays flat.

### Screen patterns

Reuse these. Do not invent a new layout for a new feature.

| Pattern | iDroid source | Use in Puente |
|---|---|---|
| Status strip | `iDROID VER` + meter + clock | Breadcrumb, next-income meter, FX / GMP-style totals |
| Section rail | Weapon icon row with counts | Account chips, or the five bottom tabs on small screens |
| Roster | Staff name grid | Transactions, bills, items, places, import diff, audit log |
| Grade cards | Grade 1 / 2 / 3 weapon tiles | Emergency / Retirement / Travel, Conservative / Base / Optimistic FX, and pay as scheduled / extra payment / pay off now |
| Requirements table | Required vs Current | Savings-rule check, “can I buy?”, CC payment vs bank, cheapest place vs last price |
| Dossier | Right column: title, blurb, stat bars | Real-available breakdown, card detail, loan detail, scenario result, item price history |
| Stat bars | Damage / penetration bars | Breakdown of Disponible real, budget pace, bucket progress, spend by type |
| Series | Thin cyan meter, not a chart theme | Expense over time, unit price by date. One cyan series. Amber is the previous window only. |
| Command bar | X / Y / A verb row | Select, switch display, change assignment, share, add |
| Resource cluster | GMP bottom-right | MXN liquid, CAD rate, buffer |

### Mobile shell

Phone is the primary surface. Wide screens keep the dossier as a right column; narrow screens turn it into a sheet.

1. **Status strip** — `PUENTE` · section path · thin meter (days until next income) · clock.
2. **Stage** — the active pattern (roster, grade cards, or dossier).
3. **Command bar** — five tabs as glyphs plus a short label: Inicio, Tiempo, Movimientos, Ahorro, Proyección. Active tab is brighter cyan with a 1px underline. Movimientos switches view (Lista, Estadísticas, Precios). That is a display change, not a sixth tab.
4. **Add** — a command-bar verb (`+`), not a shadowed floating button. Choices: Gasto, Ingreso, Transferencia, Pago TDC, Regla de ahorro.
5. **Sparkle** — AI Bridge, only on data-entry surfaces.
6. **Share** — on a scenario, a transaction, a bucket, a month, and Settings.

### Tokens

Define these once in CSS and only consume the variables.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#07141c` | Field |
| `--bg-wash` | photo or noise at ~18% | Depth behind panels |
| `--panel` | `rgba(126, 184, 210, 0.10)` | Panel fill |
| `--panel-active` | `rgba(186, 224, 240, 0.18)` | Selected row |
| `--line` | `rgba(186, 224, 240, 0.38)` | Hairline |
| `--line-strong` | `rgba(214, 238, 248, 0.72)` | Focus, active tab |
| `--ink` | `#e7f6fc` | Primary text |
| `--ink-dim` | `#8fb8c9` | Labels, help |
| `--cyan` | `#7ec8e3` | Safe, progress, links |
| `--cyan-bright` | `#d7f3ff` | Hero number |
| `--amber` | `#e6c56a` | Tight, locked, warning |
| `--heat` | `#e07a45` | Shortfall, over-budget bar |
| `--radius` | `2px` | Panels and controls |
| `--font-ui` | condensed sans (system first) | Labels and names |
| `--font-mono` | tabular monospace | Amounts, dates, ids |

Type scale: labels 11px uppercase, tracking ~0.08em; row titles 15px; section titles 13px uppercase; hero 40–48px weight 400. Body help text matches the iDroid footer: one sentence, `--ink-dim`, left aligned.

### Copy

- Hero question on Inicio: **¿Cuánto tengo de verdad?**
- Hero figure label: **Disponible real**.
- Empty and skip states are neutral. A negative first-income remainder says the rule does not apply. It does not scold.
- Amounts: `es-MX` grouping, currency code visible (`MXN`, `CAD`). Never a bare `$` when both currencies can appear.

---

## Mental model

Four layers. Location is not purpose.

| Layer | Examples | Question it answers |
|---|---|---|
| Accounts | Bank MXN, Cash MXN, CAD, Savings | Where does the money sit? |
| Buckets | Emergency, Retirement, Travel | Why is it reserved? |
| Liabilities | Credit card A, B, car loan, personal loan, money borrowed from family | What is already owed? |
| Events | Income, bills, due dates, loan installments, savings rules | What changes the future? |

```
Liquid                  = Bank + Cash + Unassigned_Opening_Balance
CC_Reserve              = sum of card balances whose strategy is full
Bills_Before_Next_Income = recurring bills due before the next income event
Loan_Installments_Before_Next_Income = loan installments due before the next income event
Virtual_Buckets_In_Liquid = bucket balances held in bank or cash
Buffer                  = settings.buffer_mxn

Real_Available = Liquid − CC_Reserve − Bills_Before_Next_Income
                 − Loan_Installments_Before_Next_Income
                 − Virtual_Buckets_In_Liquid − Buffer
```

The opening balance lets the user start with one number (“tengo 12,000 hoy”) before saying where it sits. It is liquid money held in a single `unassigned` account, shown as **Saldo sin origen**. Assigning it later is a transfer to bank or cash, so Disponible real does not move.

Bank balance is never shown as spendable. A credit-card expense leaves the bank balance unchanged, raises card debt, and lowers Real Available immediately.

A loan’s full principal is not subtracted from today’s Real Available. Only the installments that fall before the next income are. The rest of the schedule drives the projection until the payoff date. Money the user lent to someone else is tracked as a receivable and never counts as available until it is received.

```
Loan_Remaining      = principal − sum(principal paid)
Installments_Left   = ceil(Loan_Remaining / principal_per_installment), or the schedule count
Payoff_Date         = date of the last scheduled installment
Real_Available_On(d) = projected Liquid(d) − reserves due before the next income after d
                       − loan installments due before the next income after d
                       − buckets − buffer
```

Income rules key off the 1st and 2nd income event, not the calendar month.

```
Expected_MXN = CAD_Day_Rate × Expected_Days × FX_Scenario

Remainder = Reconciled_Bank_Balance − Most_Recent_Income
Emergency_Contribution = max(0, Remainder)

Retirement_Contribution = Reconciled_Bank_Balance × 0.20
Travel_Contribution = min(5000, Reconciled_Bank_Balance − Retirement_Contribution)
True_Bank_After_CC = Bank_Balance − Credit_Card_Balance_Due
```

Second-income percentages and the travel amount are settings, defaulting to 20% and 5,000 MXN.

---

## Data

Local SQLite (Capacitor) or IndexedDB (PWA). Export is encrypted JSON. Every domain row has `uuid` and `updated_at`.

| Table | Fields that matter |
|---|---|
| `accounts` | name, type (`checking` / `cash` / `savings` / `unassigned`), currency, current_balance, balance_date |
| `transactions` | date, type (`income` / `expense` / `transfer` / `cc_payment`), amount, currency, account_id, category_id, place_id, payment_method (`bank` / `cash` / `credit_card`), cc_id, notes, source (`manual` / `ai_manual` / `import`) |
| `transaction_lines` | transaction_id, item_id, place_id, qty, unit, unit_price, line_total, currency |
| `items` | name, normalized_name, default_unit, category_id, barcode (optional, local only) |
| `places` | name, kind (`supermarket` / `market` / `convenience` / `other`), area |
| `credit_cards` | name, limit, current_balance, statement_day, due_day, payment_strategy (`full` / `statement` / `minimum`) |
| `loans` | name, direction (`borrowed` / `lent`), lender_label (short, no full names), principal, currency, interest (`none` / `fixed_rate` / `fixed_installment`), rate_annual, installment_amount, frequency (`monthly` / `biweekly` / `per_income` / `custom`), first_due_date, installment_count, pay_from_account_id, status (`active` / `paid` / `paused`) |
| `loan_installments` | loan_id, due_date, amount, principal_part, interest_part, status (`scheduled` / `paid` / `skipped` / `late`), transaction_id |
| `savings_buckets` | name, target, balance, rule_type (`emergency` / `retirement` / `travel`) |
| `recurring_items` | name, amount, due_day, account_id, category_id, type (`bill` / `income`) |
| `budgets` | category_id, month, limit_mxn |
| `settings` | cad_day_rate, fx_rate, fx_source, buffer_mxn, first_income_rule, second_income_rule |
| `projection_scenarios` | saved what-if plans |
| `ai_jobs` | task, status (`prompt_copied` / `json_pasted` / `validated` / `committed` / `failed`), prompt_hash, response_hash |
| `share_events` | kind (`url` / `qr` / `file` / `p2p`), payload_hash |

AI jobs and share events are append-only.

### Merge

| Record | Rule |
|---|---|
| Transactions | Match `uuid`. Same id keeps the newer `updated_at`. Unknown id is added. Lines follow their transaction. |
| Credit cards | Match id, keep newer `updated_at`. |
| Loans, installments | Never auto-overwrite a balance or schedule. Show the diff and ask. |
| Items, places | Match `uuid`. Similar names never auto-merge. Show the diff and ask. |
| Price lines | Match `uuid`. A line never changes Real Available by itself. |
| Buckets | Never auto-overwrite. Show the diff and ask. |
| Settings | Never auto-overwrite. Ask. |
| AI jobs, audit | Append only. |

---

## Architecture constraints

- PWA with IndexedDB first. Capacitor + SQLite only if a native binary is required. Service worker for offline.
- Encryption at rest via Web Crypto. Biometric or passcode lock.
- FX: manual entry, optional direct fetch from a public API, cache the last rate. No app backend.
- No analytics, no accounts, no server.
- Backup reminder every 30 days: export your data.
- AI never calls a model. The app builds a prompt; the user pastes JSON back; the app validates.
- Share payloads ride in the URL fragment (`#`), a QR of that same payload, or a `.puente` file. Never a query string.

---

## Phase 0 — Shell and tokens

**Goal:** Every later screen drops into the same HUD. No money features yet beyond an empty Disponible real.

- [ ] CSS tokens from the table above, consumed only as variables.
- [ ] Fonts: condensed UI face and a tabular mono for amounts.
- [ ] App shell: status strip, stage, command bar with the five tabs.
- [ ] Empty states for Inicio, Tiempo, Movimientos, Ahorro, Proyección, written as one dim footer sentence each.
- [ ] `+` command opens the five add types and routes to stubs.
- [ ] Sparkle and Share glyphs exist and are hidden until their phase.
- [ ] Local database opens offline, with `uuid` + `updated_at` on every table.
- [ ] Seed categories in Spanish (food, transport, rent, and an `Uncategorized` fallback).
- [ ] Formatters: MXN, CAD, dates `es-MX`.
- [ ] Passcode gate stub (can be a no-op until Phase 8) that does not block development data.

**Done when:** The five tabs render in the iDroid shell with no default Vite chrome left, and a reload keeps the empty database.

---

## Phase 1 — Core tracking

**Goal:** Register money fast and see Real Available.

### Opening balance

- [x] **Saldo inicial** panel on Inicio: amount in MXN and the balance date (today by default, never in the future).
- [x] Saved as one `unassigned` account named “Saldo sin origen”. It counts as liquid in Disponible real.
- [x] **Ajustar** edits it explicitly, showing the previous amount. There is only ever one opening balance.
- [x] Assign it to bank or cash with a transfer. Disponible real stays the same, and the unassigned balance shrinks.
- [x] When the unassigned balance reaches zero, hide the chip and the breakdown row.
- [ ] Opening values for cards and loans: current debt and next due date, without importing past transactions.
- [ ] A reconcile after the opening balance shows the gap versus the new real number, never overwrites silently.

### Accounts and cards

- [x] Accounts: Bank MXN, Cash MXN, Savings. Optional CAD account is display-only until Phase 8.
- [x] Each account stores type, currency, and current balance.
- [x] Credit cards: name, limit, balance, statement day, due day, strategy (`full` default).
- [x] Account chips on Inicio use the section-rail pattern and show a count or balance.
- [ ] Edit and archive accounts and cards.

### Loans

- [ ] Create a loan: name, borrowed or lent, principal, currency, installment amount or rate, frequency, first due date, number of installments, and the account that pays it.
- [ ] Generate the installment schedule locally. The user can edit any row before saving.
- [ ] Interest types: none (family loan), fixed installment (the bank quotes one amount), fixed annual rate (the app splits principal and interest).
- [ ] Frequency `per_income` ties an installment to the 1st or 2nd income event, not a calendar day.
- [ ] Installments due before the next income reduce Disponible real. The rest of the principal does not.
- [ ] Mark an installment paid: creates one bank or cash expense linked by `transaction_id`, lowers the remaining balance, and the next installment becomes active.
- [ ] Extra payment: lowers the remaining principal and recomputes the payoff date or the installment count after confirm.
- [ ] Lent money: a receivable roster. Expected repayments show on Tiempo, never in Disponible real until marked received.
- [ ] Loan chip on Inicio: total owed, next installment, and the payoff date.
- [ ] Loan dossier: remaining, paid so far, interest paid, installments left, payoff date, and a stat bar of progress.
- [ ] Installment due dates appear on Tiempo and in the next-14-days list next to bills and card due dates.

### Transactions

- [x] Types: income, expense, transfer, CC payment.
- [x] Expense form: amount, category, method (bank / cash / card), date, note. Default date is today.
- [x] Card expense does not change bank balance, increases card debt, and lowers Real Available immediately.
- [x] CC payment reduces card debt and bank balance together.
- [x] Refunds: a negative expense on a card reduces card debt and is not income.
- [x] Transfer between accounts does not change Real Available except when it moves money in or out of a liquid account.
- [x] Roster list: select, name, amount, method. Filter by method without leaving the HUD.
- [x] Delete a movement after confirm. The balance effect is reversed in the same write.
- [ ] Edit a movement (reverse the old effect, apply the new one in one write).

### Dashboard

- [ ] Hero: **Disponible real**, colored cyan / amber / heat from the sign and a tightness threshold.
- [ ] Tap opens the dossier breakdown: Bank, Cash, − CC debt, − bills before next income, − loan installments before next income, − buckets in liquid, − buffer, = safe to spend.
- [ ] Next 14 days: income, bills, card due dates. Card due and statement dates are done; income and bills wait for recurring items.
- [x] Quick verbs: add expense, add income, open accounts. Savings rule and share stay stubs until their phases.

### Calendar

- [ ] Month view marks income, bills, and card due dates. Card due and statement dates are done.
- [x] Tap a day for that day’s in and out.
- [ ] Projected daily balance can be a flat “known events only” line until Phase 3.

### Calculations in this phase

- [ ] Real Available matches the formula, including buffer and loan installments before next income.
- [x] Multiple cards sum into one CC reserve, and each card keeps its own due date.
- [ ] Missing FX uses the last cached rate or asks. It never invents one.

**Done when:** A card expense, a cash expense, a bill, and a loan installment dated before next income all move Disponible real correctly, and the bank balance itself only moves for bank and cash.

---

## Phase 2 — Savings method

**Goal:** First and second income rules run without manual math.

### Buckets

- [ ] Three grade cards: Emergency, Retirement, Travel. Balance, target, progress bar, rule history.
- [ ] Manual add and withdraw. Withdraw asks for a reason and shows the impact on Real Available.
- [ ] Bucket balances held in bank or cash count in `Virtual_Buckets_In_Liquid`.

### Add income

- [ ] Enter days worked or a CAD amount. Day rate comes from settings.
- [ ] Show `CAD × FX = MXN` before save. FX is editable per entry.
- [ ] Choose account and date.
- [ ] If this is the 1st or 2nd income event of the cycle, offer the matching rule. The user can skip.

### First-income rule

- [ ] Ask: “¿Cuál es tu saldo real de banco ahora?”
- [ ] Show the gap versus the calculated balance.
- [ ] `Remainder = reconciled bank − most recent income`.
- [ ] If remainder > 0, suggest a virtual transfer to Emergency and wait for confirm.
- [ ] If remainder ≤ 0, skip with a neutral message. No shame copy.

### Second-income rule

- [ ] Reconcile bank balance the same way.
- [ ] Compute retirement (default 20%) and travel (default 5,000 MXN, capped by what remains).
- [ ] Subtract bills and CC reserve due before the next income.
- [ ] If short, offer: lower retirement %, lower travel, skip, or move anyway.
- [ ] Only confirmation writes the virtual transfers.

### Reconciliation

- [ ] Weekly cash prompt: quick-add forgotten cash expenses.
- [ ] Card payment larger than bank balance warns and offers a transfer from a bucket.

**Done when:** Both rules can be completed from an income save, declined cleanly, and replayed from bucket history.

---

## Phase 3 — Projections and budgets

**Goal:** “¿Puedo comprarlo?” is a planning screen, not a report.

### Budgets

- [ ] Monthly limit per category, in MXN.
- [ ] Show budgeted / spent / remaining, and percent of expected income.
- [ ] Pace line: spending faster than income arrives, using the stat-bar pattern (cyan under pace, heat over pace).
- [ ] Expected income uses a conservative FX scenario, not the last mid-month spike.

### Projections

- [ ] Inputs: purchase amount, target date, optional “pay with card”.
- [ ] Outputs: projected safe-to-spend on that date, shortfall or surplus, impact on the three buckets, impact on the next card payment.
- [ ] Sliders: FX, days worked, extra expenses.
- [ ] Three grade cards: Conservative / Base / Optimistic FX.
- [ ] Requirements table: cost required vs projected available.
- [ ] Daily projected balance on the calendar, driven by recurring items plus expected income events.
- [ ] Save a scenario to `projection_scenarios`.

### Loan timeline — “¿Hasta cuándo?”

- [ ] Per loan and for all loans: a series of projected Disponible real at each income event from today until the last payoff date.
- [ ] Mark the payoff date on the series and on Tiempo. After that date, the series shows the installment coming back as available money.
- [ ] Requirements row per income cycle: installment required vs projected available. A cycle that cannot cover it shows amber, or heat if it is short.
- [ ] Grade cards: pay as scheduled / extra payment of X each income / pay off now. Each shows payoff date, interest paid, and the lowest Disponible real along the way.
- [ ] “¿Puedo comprarlo?” includes future loan installments. A purchase that breaks an installment cycle names that date.
- [ ] Taking a new loan is a scenario: amount, installment, term. The projection shows the new Disponible real per cycle and the new payoff date before anything is saved.
- [ ] FX scenarios apply to CAD-denominated income, while MXN loan installments stay fixed.

**Done when:** A purchase dated three months out answers in one screen, changing FX scenario changes the surplus without a reload ritual, and a loan shows the Disponible real for each income cycle until its payoff date.

---

## Phase 4 — Expense stats and price book

**Goal:** See where spending went, by type and over time, and what each grocery item cost at each place on each date.

This does not add a money layer. A line item explains an expense. It does not change Disponible real. “Place” here is the store, not the bank account.

Stats and the price book are display modes on Movimientos: **Lista**, **Estadísticas**, **Precios**.

### Expense stats

Window chips use the section rail: ciclo de ingreso, mes, 3 meses, 12 meses.

- [ ] Hero on Estadísticas: **Total gastado** in the selected window, tabular, `--cyan-bright`.
- [ ] Spend by category (the expense type) as horizontal stat bars, longest bar at the top, amount and share labeled.
- [ ] Spend over time as one cyan series (week buckets inside a month, month buckets inside a year). Amber draws the previous window only, for comparison.
- [ ] A category over its Phase 3 budget uses `--heat` on that bar. Other categories stay cyan. No per-category rainbow.
- [ ] Spend by payment method: bank, cash, credit card, three bars.
- [ ] Tap a bar or a point to open the roster filtered to that type and those dates.
- [ ] Income, transfers, and CC payments stay out of the expense series.
- [ ] Refunds reduce the category total. They do not appear as income.
- [ ] Empty window uses one dim footer sentence.

### Price book

A grocery trip can list products without using AI. Confirming a receipt later fills the same tables.

- [ ] Optional lines on an expense: item, qty, unit, unit price or line total, place, date (defaults to the expense date).
- [ ] `unit_price = line_total / qty` when qty > 0. If qty is missing, keep the line total and leave unit price empty. Empty unit prices stay off the chart.
- [ ] Units: `pza`, `kg`, `g`, `L`, `ml`. Compare prices only inside one unit family (weight, volume, or piece). A kg price and a piece price never share a series.
- [ ] Item match uses `normalized_name` (trim, lower case, strip accents). Display the name the user typed. A near-match asks. It does not merge.
- [ ] Places are local rows: name, kind, optional area (colonia or city). No map and no store directory.
- [ ] Unknown place still saves as **Sin lugar**.
- [ ] Precios roster: item name, last unit price, last place, last date.
- [ ] Item dossier: cyan series of unit price by date, and a requirements row — cheapest recent place vs last price paid.
- [ ] Place filter on the dossier. Same item at Walmart, Chedraui, Oxxo, and the tianguis stays one item with many observations.
- [ ] Currency stays on the observation. MXN and CAD never share a price series.
- [ ] Deleting or editing an expense updates its lines. Price history does not keep a ghost row.
- [ ] Scanning the same ticket twice does not double-count. Lines belong to one transaction `uuid`.

**Example.** Leche 1 L: 1 Sep Chedraui 28.50 MXN, 12 Sep Walmart 26.00 MXN. The dossier names Walmart as the cheaper recent place and plots both dates.

**Done when:** A month of categorized expenses shows type bars and a time series, and two shops for the same item show different unit prices on the dates they were bought.

---

## Phase 5 — AI Bridge (P0)

**Goal:** Tickets and statements become drafts. The model never touches the database.

The app does not call an LLM. No API keys.

### Six steps, every task

1. Trigger — sparkle.
2. Context review — user can redact fields before they are copied.
3. Copy prompt — from a local template.
4. Open the model — system share sheet or copy.
5. Paste JSON — raw JSON, fences, or surrounding text. No automatic clipboard read.
6. Validate → preview → confirm. Nothing is written before confirm.

- [ ] Records created this way are `source: ai_manual`.
- [ ] Manual entry stays one tap away on the same form.
- [ ] `ai_jobs` stores task, status, `prompt_hash`, `response_hash`.
- [ ] A second paste with the same `response_hash` asks before creating another row.

### JSON envelope

```json
{
  "schema_version": "1.0",
  "task": "parse_receipt",
  "data": {},
  "warnings": [],
  "confidence": 0.92
}
```

- [ ] Strip fences, take the first `{` through the last `}`, parse.
- [ ] Reject a wrong `schema_version` or `task`.
- [ ] Validate required fields and types. Errors are human-readable.
- [ ] Repair loop copies a second prompt that includes the errors, the schema, and the bad JSON.
- [ ] Confidence badges: cyan above 0.8, amber from 0.5 to 0.8, heat below 0.5. Below 0.6, highlight the weak fields.
- [ ] Redaction warning before copy whenever the prompt contains amounts, merchants, or statement text.

### P0 tasks

- [ ] `parse_receipt` — date, merchant, total, currency, payment method, last4, category, items, confidence. Total must be > 0. Date must be valid and not far in the future. Category must match the local list or become Uncategorized. Item sum mismatch is a warning, not a block.
- [ ] On confirm, each parsed line becomes a `transaction_line`. Merchant maps to a place. A new item or place is created only after that confirm. Unit price feeds the Phase 4 dossier when qty and unit are present.
- [ ] `parse_bank_statement` — account name, period, closing balance, transactions. Dedupe on date + amount + description. Flag possible duplicates and recurring-bill matches. User confirms the import.
- [ ] Preview lists exactly which balances will change.

**Done when:** A receipt JSON and a statement JSON can be pasted, repaired, previewed, and either committed or discarded, with the database unchanged until confirm.

---

## Phase 6 — Share, import, export

**Goal:** Move a snapshot or the whole file without a server.

### Tier 1 — URL fragment

```
#s=<base64url(gzip(json))>
```

- [ ] JSON → `CompressionStream('gzip')` → base64url (RFC 4648 §5, no padding).
- [ ] Payload lives in the fragment only. Never `?query`.
- [ ] Opening the link shows preview, then Import / Merge / Discard.
- [ ] Fragment is stripped from history after a decision.
- [ ] Warn: anyone with this link can read this data.
- [ ] Optional passphrase (AES-GCM, PBKDF2 or Argon2 via Web Crypto) before encode.
- [ ] If the payload exceeds ~2,000 characters, refuse the link and offer file export.
- [ ] Allowed in a link: one scenario, one transaction, one savings plan, one goal, one budget template, one item’s price history.
- [ ] Forbidden in a link: full history, full price book, statements, big batches, account numbers, full names, card PANs.

### Tier 2 — QR

- [ ] Same payload as Tier 1, rendered as a QR.
- [ ] Over ~2,900 bytes, refuse and offer file export.

### Tier 3 — `.puente` file

- [ ] JSON → gzip → optional AES-GCM → download `.puente`.
- [ ] Import via file picker and, on the PWA, `file_handlers` / `launchQueue`.
- [ ] This is the backup. Remind every 30 days.

### Import diff

- [ ] Preview rows: new, updated, conflict.
- [ ] Merge follows the [merge table](#merge). Replace is explicit. Cancel writes nothing.
- [ ] Money state is never auto-overwritten.

- [ ] `share_events` appends kind + `payload_hash`.

**Done when:** A scenario survives a fragment round-trip, a QR round-trip on two devices or a scanner, and a passphrase-encrypted file round-trip, including a conflict that waits for a choice.

---

## Phase 7 — AI Bridge (P1–P2)

Same six steps and the same envelope. Each task is a local template plus a validator.

### P1

- [ ] `parse_expense_text` — “Pagué 450 en Oxxo con tarjeta” prefills the expense form.
- [ ] `categorize_transactions` — map existing rows to categories, preview, then apply.
- [ ] `parse_income` — CAD, days, FX, MXN. Creating the income may offer the Phase 2 rule. The model does not run the rule.
- [ ] `parse_cc_statement` — balance, due, minimum, transactions. Updates the card only after confirm, and refreshes CC reserve.

### P2

- [ ] `reconcile_transactions` — app rows vs pasted bank text. Show matches, missing, duplicates. User resolves.
- [ ] `parse_purchase_goal` — “moto 45,000 en marzo” fills the projection inputs. Math stays in Phase 3.
- [ ] `savings_recommendation` — suggests emergency, retirement, and travel amounts. The app rechecks bills, CC due, and buffer, then offers reduce / skip / move anyway. Only confirm writes transfers.

**Done when:** Each task has a template, a validator, a preview, and a test paste that fails closed.

---

## Phase 8 — Polish

Ship only what is still needed after Phases 0–7.

- [ ] On-device receipt OCR as a fallback that still lands in the same preview. No network model.
- [ ] CSV import through the same diff screen as statements.
- [ ] Home-screen widget for Disponible real, if the shell supports it.
- [ ] Recurring detection suggestions. They never auto-create bills.
- [ ] CAD account that can hold a balance and convert on transfer.
- [ ] Passcode and biometric lock.
- [ ] P2P sync only if file + URL + QR are not enough: WebRTC data channel, manual signaling via fragment or QR, encrypted payloads, merge on `uuid` + `updated_at`. Not part of v1 acceptance.

---

## Edge cases

These are requirements, not later nice-to-haves. Cover them in the phase that owns the math.

- [ ] Negative first-income remainder skips with neutral copy.
- [ ] Second income cannot fund 20% + 5,000: offer reduced amounts.
- [ ] Card payment larger than the bank: warn, offer a bucket transfer.
- [ ] Forgotten cash: quick add plus a weekly reconcile prompt.
- [ ] FX change mid-cycle: projections use the selected scenario.
- [ ] Several cards: one combined reserve, separate due dates.
- [ ] Card refund: lower card debt, do not book income.
- [ ] Bucket withdrawal: reason and impact before write.
- [ ] Model invents a merchant or amount: user still confirms.
- [ ] Duplicate paste: same `response_hash` asks.
- [ ] Negative expense amount: treat as a refund.
- [ ] FX missing: last known rate or ask.
- [ ] Unknown category: Uncategorized.
- [ ] Partial JSON: repair loop, no partial write.
- [ ] Sensitive prompt: warn before copy.
- [ ] Share payload too big: offer `.puente`.
- [ ] Bucket or settings conflict on import: always ask.
- [ ] Item names almost match: ask, do not auto-merge.
- [ ] Qty missing on a grocery line: keep the spend on the expense, omit unit price from the chart.
- [ ] Mixed units or mixed currencies on one item: separate series.
- [ ] Refund of a grocery line: lower the expense total, do not plot it as a cheaper price.
- [ ] Missed loan installment: mark it late, keep it in the next cycle’s reserve, and use neutral copy.
- [ ] Installment larger than a cycle’s income: warn on the timeline, and offer a bucket transfer or a scenario with an extra payment later.
- [ ] Loan in CAD paid from MXN: convert with the selected FX scenario and show both amounts.
- [ ] Lender changes the rate or schedule: edit the remaining schedule only. Paid rows never change.
- [ ] Loan paid early: status becomes `paid`, the remaining scheduled rows are removed after confirm, and the timeline updates.
- [ ] Money lent is never repaid: the user can write it off. It never touched Disponible real, so nothing moves.

---

## New-feature checklist

Run this for every feature after Phase 0.

- [ ] Uses an existing screen pattern (roster, grade cards, requirements, dossier, stat bars, series, command bar).
- [ ] Colors come from tokens. Cyan, amber, and heat keep their meanings.
- [ ] Copy is Spanish. Identifiers and schema fields are English.
- [ ] Money writes go through the app. A suggestion, import, or model output cannot commit itself.
- [ ] Real Available still matches the formula after the change.
- [ ] Location (account) and purpose (bucket) stay separate.
- [ ] New rows have `uuid` and `updated_at`.
- [ ] Shareable objects omit PANs, account numbers, and full names.
- [ ] Empty, skip, and error states use the dim footer voice.
- [ ] Works offline after the first load.

---

## Success metrics

- [ ] Expenses can be logged in under 15 seconds (the habit target is ≥ 4 times a week).
- [ ] Real Available stays within about 5% of bank − card − bills when the user reconciles.
- [ ] Both income rules finish without the user doing the arithmetic.
- [ ] “Can I buy X in 3 months?” resolves on one screen, comfortably under 30 seconds.
- [ ] Ticket and statement bridge are usable weekly once Phase 5 ships.
- [ ] At least one fragment, QR, or file round-trip works each month once Phase 6 ships.
- [ ] Estadísticas shows which expense type grew versus the previous window.
- [ ] Each loan answers “what is my Disponible real until it is paid off, and on what date does it end?” on one screen.
- [ ] The price dossier answers where an item was cheaper, and on which date, without leaving the item.
- [ ] Inicio answers “can I spend this?” before the purchase, not after.

---

## Out of scope for v1

- Hosted accounts, sync servers, analytics, push that depends on a backend.
- Automatic LLM calls or stored API keys.
- Full history inside a URL or QR.
- Silent merge of buckets, settings, or balances.
- P2P live sync.
- Investment tracking, invoicing, and tax filing.
- Store maps, live shelf-price APIs, and any product lookup that needs a server.

---

## Suggested build order inside a phase

1. Data write and the formula that depends on it.
2. The HUD pattern that displays it.
3. The confirm step (rule wizard, AI preview, or import diff).
4. The edge cases for that write.
5. The new-feature checklist.
