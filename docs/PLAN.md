# Guanabana — Implementation plan v1.0

Local-first cashflow and savings app for anyone who lives in MXN and gets paid on a few income events a month: salary, freelance, or contract work.

Everything is in MXN. Income is the MXN amount that landed; someone paid in another currency enters it already converted. The app has no currency conversion or exchange rates, because keeping a rate current is more tracking than it is worth.

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

| Pattern | iDroid source | Use in Guanabana |
|---|---|---|
| Status strip | `iDROID VER` + meter + clock | Breadcrumb, next-income meter, GMP-style totals |
| Section rail | Weapon icon row with counts | Account chips, or the five bottom tabs on small screens |
| Roster | Staff name grid | Transactions, bills, items, places, import diff, audit log |
| Grade cards | Grade 1 / 2 / 3 weapon tiles | Emergency / Retirement / Travel, Conservative / Base / Optimistic income, and pay as scheduled / extra payment / pay off now |
| Requirements table | Required vs Current | Savings-rule check, “can I buy?”, CC payment vs bank, cheapest place vs last price |
| Dossier | Right column: title, blurb, stat bars | Real-available breakdown, card detail, loan detail, scenario result, item price history |
| Stat bars | Damage / penetration bars | Breakdown of Disponible real, budget pace, bucket progress, spend by type |
| Series | Thin cyan meter, not a chart theme | Expense over time, unit price by date. One cyan series. Amber is the previous window only. |
| Command bar | X / Y / A verb row | Select, switch display, change assignment, share, add |
| Resource cluster | GMP bottom-right | MXN liquid and buffer |

### Mobile shell

Phone is the primary surface. Wide screens keep the dossier as a right column; narrow screens turn it into a sheet.

1. **Status strip** — `GUANABANA` · section path · thin meter (days until next income) · clock.
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
- Amounts: `es-MX` grouping, currency code visible (`MXN`). Never a bare `$`.

---

## Mental model

Four layers. Location is not purpose.

| Layer | Examples | Question it answers |
|---|---|---|
| Accounts | Bank MXN, Cash MXN, Savings | Where does the money sit? |
| Buckets | Emergency, Retirement, Travel, plus any the user creates (Auto, Regalos) | Why is it reserved? |
| Liabilities | Credit card A, B, car loan, personal loan, money borrowed from family | What is already owed? |
| Events | Income, bills, due dates, loan installments, savings rules | What changes the future? |

```
Liquid                  = Bank + Cash + Unassigned_Opening_Balance
CC_Reserve              = sum over all cards of max(0, balance − MSI_Unbilled)
MSI_Unbilled            = MSI charges whose statement period has not opened yet
Bills_Before_Next_Income = recurring bills due before the next income event
Invoices_Outstanding     = one-time bills already generated (issued_on on or before today) and not yet registered
Loan_Installments_Before_Next_Income = loan installments due before the next income event
Virtual_Buckets_In_Liquid = bucket balances held in bank or cash, minus opening moves
Buffer                  = settings.buffer_mxn

Real_Available = Liquid − CC_Reserve − Bills_Before_Next_Income
                 − Invoices_Outstanding
                 − Loan_Installments_Before_Next_Income
                 − Virtual_Buckets_In_Liquid − Buffer
```

The opening balance lets the user start with one number (“tengo 12,000 hoy”) before saying where it sits. It is liquid money held in a single `unassigned` account, shown as **Saldo sin origen**. Assigning it later is a transfer to bank or cash, so Disponible real does not move.

An apartado can also start with money that was already set aside and is not inside Banco, Efectivo, or Saldo sin origen. That amount is an opening move on the bucket. It counts in the apartado balance and in its progress, and it is left out of `Virtual_Buckets_In_Liquid`, so Disponible real does not change. Pesos that are already inside those accounts are not an opening: reserving them is Apartar, and Disponible real drops.

Bank balance is never shown as spendable. A credit-card expense leaves the bank balance unchanged, raises card debt, and lowers Real Available immediately.

The payment strategy never changes the reserve. Every peso on a card is owed, so Pago total, Saldo al corte, and Pago mínimo all reserve the whole balance. The strategy only changes the next payment: its amount, the payment form's suggestion, and the split shown as “vence el …” and “pasa al siguiente corte”.

```
Last_Cut          = latest statement day on or before today
Statement_Balance = card debt on Last_Cut − MSI still unbilled on Last_Cut
                    (or the “Saldo al último corte” the user entered for that cut)
Credits_Since_Cut = card payments, refunds, and negative adjustments after Last_Cut
Statement_Due     = clamp(Statement_Balance − Credits_Since_Cut, 0, payable balance)
Minimum_Due       = clamp(minimum_payment − Credits_Since_Cut, 0, Statement_Due), only when entered for Last_Cut
Next_Payment      = Statement_Due (Saldo al corte) or Minimum_Due (Pago mínimo), due on the first due day after Last_Cut
```

Once that due date passes, the open period is the next payment: everything payable at the next cut, due after it. A statement balance or minimum entered for an older cut is ignored. Without an entered figure, opening debt counts as billed, so it is all due on the next due date.

A card purchase at meses sin intereses (MSI) raises card debt by the whole amount, but Real Available only reserves one monthly charge per statement. Charges are equal (the last keeps the cents) and fall on the card’s cut day, starting with the first cut on or after the purchase. Each charge enters the reserve the day after the previous cut, like any purchase in that period, so the first one counts right away. The unbilled rest is still owed and shows as “a meses por cobrar”; the projection picks up each charge as its period opens. Paying MSI early is allowed and only lowers the reserve to zero, never below.

A loan’s full principal is not subtracted from today’s Real Available. Only the installments that fall before the next income are. The rest of the schedule drives the projection until the payoff date. Money the user lent to someone else is tracked as a receivable and never counts as available until it is received.

```
Loan_Remaining      = principal − sum(principal paid)
Installments_Left   = ceil(Loan_Remaining / principal_per_installment), or the schedule count
Payoff_Date         = date of the last scheduled installment
Real_Available_On(d) = projected Liquid(d) − reserves due before the next income after d
                       − one-time bills generated on or before d and not yet paid by d
                       − loan installments due before the next income after d
                       − buckets − buffer
```

Income rules key off the 1st and 2nd income event, not the calendar month.

```
Expected_MXN = recurring income amount in MXN × Income_Scenario

Reconciled_Liquid = Liquid after the user confirms the real balance of the income account

Remainder = Reconciled_Liquid − Most_Recent_Income − Virtual_Buckets_In_Liquid − CC_Reserve
Emergency_Contribution = max(0, Remainder)

Retirement_Contribution = Most_Recent_Income × retirement_pct
Travel_Contribution = min(travel_mxn, Most_Recent_Income − Retirement_Contribution)
Short = max(0, Retirement + Travel − Real_Available)   (Real_Available after reconcile)
```

The remainder subtracts money already in buckets and card debt, so a rule never reserves the same peso twice or treats owed money as leftover. Retirement is a share of the income, not of the whole balance. The share and the travel amount are settings, defaulting to 20% and 5,000 MXN.

Which income is 1st or 2nd comes from the active recurring income items sorted by day: the earliest is the first income, the next one the second. An income linked to a recurring item uses that item. Otherwise it matches the nearest payday. With a single payday it is always the first income, and with no schedule the user picks the rule. When any main income repeats weekly, the scheduled main-income dates alternate 1st, 2nd, 1st… in date order, counting from the earliest `start_date`. Every 2 weeks then behaves like a quincena, and a weekly payday gets both rules each fortnight. Only the main income category (**Ingreso principal**) or a scheduled income triggers a rule. Loan repayments and other income never do.

---

## Data

Local SQLite (Capacitor) or IndexedDB (PWA). Export is encrypted JSON. Every domain row has `uuid` and `updated_at`.

| Table | Fields that matter |
|---|---|
| `accounts` | name, type (`checking` / `cash` / `savings` / `unassigned`), currency, current_balance, balance_date, archived |
| `categories` | key, name, kind (`expense` / `income`), parent_id (optional, one level only), archived |
| `transactions` | date, type (`income` / `expense` / `transfer` / `cc_payment` / `adjustment`, a signed reconcile gap that stats ignore), amount, currency, account_id, category_id (a category or a subcategory), place_id, payment_method (`bank` / `cash` / `credit_card`), cc_id, notes, source (`manual` / `ai_manual` / `import`), msi_months (card expenses only; null or 1 = one payment), loan_id (the expense that handed over lent money; not spending). `amount` is always the MXN that landed. The MSI schedule is derived from the row and the card’s cut day, so it merges with its transaction. |
| `transaction_lines` | transaction_id, item_id, place_id, qty, unit, unit_price, line_total, currency |
| `items` | name, normalized_name, default_unit, category_id, barcode (optional, local only) |
| `places` | name, kind (`supermarket` / `market` / `convenience` / `other`), area |
| `credit_cards` | name, limit, current_balance, statement_day, due_day, payment_strategy (`full` / `statement` / `minimum`), statement_balance (optional), minimum_payment (optional), statement_date (the cut both belong to), archived |
| `loans` | name, direction (`borrowed` / `lent`), lender_label (short, no full names), principal, currency, interest (`none` / `fixed_rate` / `fixed_installment`), rate_annual, installment_amount, frequency (`monthly` / `biweekly` / `per_income` / `unscheduled`, no installments), income_slot (`first` / `second` / `both`, only for `per_income`), first_due_date, installment_count, pay_from_account_id, status (`active` / `paid` / `paused` / `written_off`, lent only) |
| `loan_installments` | loan_id, due_date, amount, principal_part, interest_part, status (`scheduled` / `skipped` / `settled` / `superseded`), created_by, replaced_by. Paid and late are derived: an installment is paid when a transaction carries its `loan_installment_id` (or it is `settled`, paid before tracking), and late when it is unpaid past its due date. `superseded` rows were replaced by an extra payment and stay for undo. |
| `savings_buckets` | name, target, target_date (optional), sort_order, archived, rule_type (`emergency` / `retirement` / `travel` / `custom`), account_id (null = bank or cash; a savings account = outside liquid), income_share (custom only, optional: `{income: first / second / both, amount}`). Balance is derived from `bucket_moves`. |
| `bucket_moves` | bucket_id, amount (signed), date, reason, source (`manual` / `opening` / `first_income` / `second_income` / `bucket_transfer`), income_tx_id, transfer_id (pairs the two moves of a bucket-to-bucket transfer), tx_id (the account transfer that funded it), reverses_id (a move that cancels another). `opening` is money already set aside outside liquid accounts. |
| `recurring_items` | name, amount, frequency (`monthly` / `weekly` / `once`, missing = monthly), interval (months 1, 2, 3, 6, 12, bills only above 1; weeks 1–4; missing = 1; ignored for `once`), due_day (`monthly` only; a one-time bill stores the day of its due date), start_date (sets the phase of the interval; a weekly item falls on its weekday; for `once`, the date it should be paid), issued_on (one-time bills: the day the invoice was generated; the reserve starts then), account_id, cc_id (bills only: paid with a card), category_id, type (`bill` / `income`) |
| `recurring_overrides` | recurring_id, occurrence (ISO date), amount (MXN, ≥ 0). One per occurrence. Changes that date's reserve (bill) or expected amount (income) only; the registered transaction stays the record of what was paid or received. |
| `budgets` | category_id (a category or a subcategory), month (`YYYY-MM`, or null for every month), limit_mxn |
| `settings` | buffer_mxn, cash_reviewed_at, rule_prompt_dismissed_at, first_income_rule, second_income_rule, plan (`{include_rules, in_tiempo}`) |
| `projection_scenarios` | name, amount, date, card_id, msi_months, income_monthly, daily_spend, extra_expenses. Migrated into `plan_items` and no longer written. |
| `plan_items` | name, amount, target_date (null = lo antes posible), enabled, sort_order, payment_method (`bank` / `cash` / `credit_card`), card_id, msi_months, category_id, bucket_draws (`[{bucket_id, amount}]`), status (`planned` / `dropped`), tx_id (the purchase; bought while it exists), notes, source |
| `planned_contributions` | bucket_id, amount, income_slot (`first` / `second` / `both`), enabled. Projection only; never a `bucket_move`. |
| `ai_jobs` | task, status (`prompt_copied` / `json_pasted` / `validated` / `committed` / `failed`), prompt_hash, response_hash |
| `share_events` | kind (`url` / `qr` / `file` / `p2p`), payload_hash |

AI jobs, share events, and bucket moves are append-only.

### Merge

| Record | Rule |
|---|---|
| Transactions | Match `uuid`. Same id keeps the newer `updated_at`. Unknown id is added. Lines follow their transaction. |
| Credit cards | Match id, keep newer `updated_at`. |
| Loans, installments | Never auto-overwrite a balance or schedule. Show the diff and ask. |
| Items, places | Match `uuid`. Similar names never auto-merge. Show the diff and ask. |
| Categories, subcategories | Match `uuid`. Similar names, or the same name under another parent, never auto-merge. Show the diff and ask. |
| Price lines | Match `uuid`. A line never changes Real Available by itself. |
| Buckets | Never auto-overwrite. Show the diff and ask. |
| Recurring overrides | Match `recurring_id` + `occurrence`. A different amount for the same date shows both and asks. Unknown ones are added. |
| Plan items, planned contributions | Match `uuid`, keep newer `updated_at`. They are not money state. A draw or contribution for an unknown apartado is kept and ignored. |
| Settings | Never auto-overwrite. Ask. |
| AI jobs, audit | Append only. |

---

## Architecture constraints

- PWA with IndexedDB first. Capacitor + SQLite only if a native binary is required. Service worker for offline.
- Encryption at rest via Web Crypto. Biometric or passcode lock.
- No analytics, no accounts, no server.
- Backup reminder every 30 days: export your data.
- AI never calls a model. The app builds a prompt; the user pastes JSON back; the app validates.
- Share payloads ride in the URL fragment (`#`), a QR of that same payload, or a `.guanabana` file. Never a query string.

---

## Phase 0 — Shell and tokens

**Goal:** Every later screen drops into the same HUD. No money features yet beyond an empty Disponible real.

- [x] CSS tokens from the table above, consumed only as variables. Colors live in `src/styles/tokens.css` only.
- [x] Fonts: condensed UI face and a tabular mono for amounts. Roboto Condensed is bundled (`@fontsource`), so it works offline and never calls a font CDN.
- [x] App shell: status strip, stage, command bar with the five tabs.
- [x] Empty states for Inicio, Tiempo, Movimientos, Ahorro, Proyección, written as one dim footer sentence each.
- [x] `+` command opens the five add types and routes to stubs.
- [x] Sparkle and Share glyphs exist and are hidden until their phase.
- [x] Local database opens offline, with `uuid` + `updated_at` on every table.
- [x] Seed categories in Spanish (food, transport, rent, and an `Uncategorized` fallback).
- [x] Formatters: MXN, dates `es-MX`.
- [x] Passcode gate stub (can be a no-op until Phase 8) that does not block development data.

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
- [x] Opening values for cards and loans: current debt and next due date, without importing past transactions. Cards take the current debt on creation. Loans take “Cuotas ya pagadas”; those rows are `settled` and never touch a balance.
- [x] A reconcile after the opening balance shows the gap versus the new real number, never overwrites silently. **Ajustar saldo** on any account or card shows calculated, real, the gap, and the change in Disponible real. Confirm writes one `adjustment` movement that can be deleted to undo.

### Accounts and cards

- [x] Accounts: Bank MXN, Cash MXN, Savings. Savings shows as **Ahorro o inversión** and covers investment accounts too; there is no investment logic. `isLiquid` (`src/lib/accounts.ts`) is the one place that decides what counts in Disponible real.
- [x] An Ahorro account's dossier breaks its balance into the apartados that live there plus **Sin apartar** (balance minus those apartados). When the apartados add up to more, it shows the gap in amber and **Ajustar {cuenta} a tus apartados**, one confirmed `adjustment`. An account with apartados cannot be archived.
- [x] **Actualizar saldo** on an Ahorro account with apartados: the real balance, the gap as Rendimientos or Ajuste, and one editable line per apartado, prefilled in proportion to its balance (in cents; the remainder goes to the largest). What is not assigned stays Sin apartar. A line cannot take an apartado below zero. One write saves the `adjustment` and a `manual` move per line (`tx_id`); deleting the adjustment reverses them. Interest is not income.
- [x] Each account stores type, currency, and current balance.
- [x] Credit cards: name, limit, balance, statement day, due day, strategy (`full` default).
- [ ] Every strategy reserves the whole card balance (minus unbilled MSI). Saldo al corte and Pago mínimo only change the next payment.
- [ ] Next payment per card: Saldo al corte shows what the last statement billed minus credits since; Pago mínimo shows the minimum entered for that cut. The Disponible real breakdown, the card roster and dossier, and Próximos 14 días show “vence el …” and “pasa al siguiente corte”. Amounts, not percentages.
- [ ] Optional “Saldo al último corte” and “Pago mínimo de este corte” on the card form, tied to the last cut. Editing shows the previous value. Empty or older figures fall back to the computed statement.
- [ ] The card-payment form suggests the statement amount and the minimum when they apply, and still allows the total.
- [x] Account chips on Inicio use the section-rail pattern and show a count or balance.
- [x] Edit and archive accounts and cards. Editing changes details only (name, bank ↔ cash, card limit, days, strategy); balances change only through Ajustar saldo. Archiving needs a zero balance; archived records leave the pickers and keep their history.

### Loans

- [x] Create a loan: name, borrowed or lent, principal, currency, installment amount or rate, frequency, first due date, number of installments, and the account that pays it.
- [x] Generate the installment schedule locally. The user can edit any row before saving (dates always; amounts unless the loan uses an annual rate). Saving is blocked until the rows add up to the principal.
- [x] Interest types: none (family loan), fixed installment (the bank quotes one amount), fixed annual rate (the app splits principal and interest).
- [x] Frequency `per_income` ties an installment to the 1st or 2nd income event, not a calendar day. “Por ingreso” appears once there are income days; it follows the 1st, the 2nd, or every income (`income_slot`). Rows fall on those paydays from the “Desde” date, clamped to short months, and an annual rate splits by the number of matching paydays per year (12 or 24 for monthly paydays; 26 or 52 for weekly ones). An installment on a payday is paid from that income, so it reserves from that day. The saved rows keep their dates if the income days change later.
- [x] Installments due before the next income reduce Disponible real. The rest of the principal does not.
- [x] Mark an installment paid: **Pagar cuota** opens the prefilled expense form. The saved expense carries `loan_installment_id`, which lowers the remaining balance and moves on to the next installment.
- [x] Extra payment: lowers the remaining principal and recomputes the payoff date or the installment count after confirm. **Abono extra** previews now vs. after (“Terminar antes” or “Bajar la cuota”). One write records the linked movement (`loan_extra_id`), marks the unpaid rows `superseded`, and adds the new rows. Deleting the movement restores the previous schedule, unless a new row was already paid.
- [x] Lent money: a receivable roster. Expected repayments show on Tiempo, never in Disponible real until marked received (**Registrar cobro** opens the income form).
- [x] Lending moves the money out. Saving a “Me deben” loan with a “Se recibe en” account also writes one expense for the principal from that account (category `loan_disbursement`, “Préstamo otorgado”, linked by `loan_id`), in the same write as the loan. The form previews the change in Disponible real before confirm. With “Elegir al pagar”, the form asks for the account the money left from, or offers “Ya lo registré” for a loan that started before Guanabana. Deleting the loan asks whether to keep or delete that movement. Stats leave `loan_disbursement` out of spending. (**El dinero salió de** follows “Se recibe en” until changed, with a **Prestado el** date that is never in the future. A movement with `loan_id` is left out of Estadísticas, Presupuesto, and the habitual daily spend; the category stays out of the pickers.)
- [x] Write off lent money: **Dar por perdido** in the dossier asks, then sets status `written_off`. The unpaid rows leave Tiempo, the collected amount stays, and no balance changes. The roster shows it dimmed with neutral copy.
- [x] The dossier copy follows direction: “Interés cobrado” and “Cuotas por cobrar” for lent money.
- [x] Loan without dates (family loan): frequency **Sin fecha** (`unscheduled`) saves the loan with no installments and interest `none`. It reserves nothing in Disponible real and stays off Tiempo and the projection. Each payment is an abono (**Registrar pago** / **Registrar cobro**, `loan_extra_id`) that lowers the balance; the dossier lists them. Money owed still counts in the Préstamos chip; lent money can be written off.
- [x] Lent money on Inicio: under the Disponible real total, a dim **Te deben · no cuenta hasta cobrarlo** row shows what is left on active lent loans and opens Préstamos. It never subtracts or adds.
- [x] Edit a loan: **Editar** in the dossier changes the name, who, and the account, plus the dates and amounts of unpaid rows (dates only with an annual rate). Paid and settled rows never change. Without interest the open rows must still add up to the remaining; a fixed installment never drops below its principal. A borrowed loan previews the change in Disponible real before confirm. Principal, interest type, and frequency are not editable; deleting and registering again covers those.
- [x] Loan chip on Inicio: total owed. Next installment and payoff date are in the Préstamos roster.
- [x] Loan dossier: remaining, paid so far, interest paid, installments left, payoff date, and a stat bar of progress.
- [x] Installment due dates appear on Tiempo and in the next-14-days list next to bills and card due dates.

### Income days and fixed bills

- [x] **Pagos fijos** screen: income days and fixed bills (name, amount, day of month, account, category).
- [x] Income cycle runs from the previous income day to the next one. Without income days it falls back to 15 days.
- [x] Unpaid bills in the current cycle reduce Disponible real. Overdue ones stay reserved and show in amber.
- [x] Registering a bill or income opens the prefilled form. The transaction carries `recurring_id` + `occurrence`, which marks that occurrence as done.
- [x] Status strip meter shows progress toward the next income (“En N días”).
- [x] Edit a recurring item, and income with an unknown amount (amount left empty).

### Repeat rules

Bills and income can repeat on a weekday or every few months, not only on one day of every month. Example: “Cada viernes”, “Cada 2 viernes”, “Cada 2 meses, día 10” (CFE), “Cada año, 31 ene” (predial). This changes only when occurrences fall. Each occurrence still reserves, registers, and projects exactly like a monthly one.

- [ ] **Se repite** on the Pagos fijos form: Cada semana, Cada 2 semanas, Cada 3 semanas, Cada 4 semanas, Cada mes (default), Cada 2 meses, Cada 3 meses, Cada 6 meses, Cada año. Weekly options ask for the weekday. Monthly options keep **Día del mes**.
- [ ] Every 2 to 4 weeks, and every 2 or more months, needs a starting point. The form offers the next matching dates (“¿Cuál viernes es el próximo? 2 oct · 9 oct”), or the next months for a monthly day, and saves the choice as `start_date`. Weeks and months are counted from that date.
- [ ] A preview under the field lists the next three dates before saving.
- [ ] The roster row says the rule in words: “Cada viernes”, “Cada 2 viernes · próximo 9 oct”, “Día 15 de cada mes”, “Cada 2 meses · día 10”. Day 29–31 clamps to short months and reads “Último día” when it is 31.
- [ ] Income repeats weekly (every 1 to 4 weeks) or monthly only. Longer repeats are for bills, so an income cycle is never longer than a month.
- [ ] One occurrence helper in `src/lib/cycle.ts` drives the income cycle, bill commitments, Tiempo, Próximos 14 días, and the projection. No second schedule path.
- [ ] A weekly bill can fall more than once in a cycle. Every unpaid occurrence before the next income reserves, and each registers on its own (`occurrence` is the date).
- [ ] Monthly income equivalent for sliders, scenarios, and budget percent = amount × occurrences per year ÷ 12 (weekly 52, every 2 weeks 26). The projection engine uses the real dates, so a month with five Fridays gets five paydays.
- [ ] Pago programado matches within half the interval for weekly repeats (±3 days weekly, ±7 every 2 weeks) and keeps ±10 days for monthly.
- [ ] Editing the repeat applies from the next occurrence. Registered occurrences keep their link. Before saving, the edit lists any overdue unregistered occurrence under the old rule and asks to register it first or let it go, and shows the change in Disponible real. It never drops a reserve without asking.
- [ ] Existing rows read as `frequency: monthly`, `interval: 1`, so nothing moves on upgrade.
- [ ] Loans paid **Por ingreso** follow weekly paydays too. Until then, “Por ingreso” only offers day-of-month paydays.

### One-time bills

A bill that does not repeat: a tax invoice, a one-off fee. It is still a bill. `frequency: once`, `issued_on` is the day it was generated, and `start_date` is the date it should be paid. The same occurrence helper, register form, and projection pay it. It is not a second money path.

- [x] **Se repite: Una vez** on Pagos fijos (bills only). The form asks **Generado el** (defaults to today) and **Fecha límite**. The amount is required. The roster reads “Una vez · generado 30 sep” and shows the due date; a past unpaid date is amber, and a registered one reads “Pagada”.
- [x] An unpaid one-time bill lowers Disponible real from `issued_on`, even when the due date is after the next income. It is `Invoices_Outstanding` (“− Facturas por pagar”), not part of Bills_Before_Next_Income, so it is not reserved twice.
- [x] A future `issued_on` does not reserve today. The reserve starts on that day. Once the due date passes unpaid, it stays reserved and shows in amber.
- [x] Registering it uses the same prefilled expense. `occurrence` is the due date. The saved amount is what was paid. After that the reserve is gone.
- [x] The projection keeps the reserve until the due date, then treats it as paid. Disponible real does not drop a second time on that date.
- [x] Existing rows have no `once` frequency, so nothing moves on upgrade.

### Adjust one occurrence

Recurring items are never registered automatically. Each occurrence stays a reserve until the user opens it and saves the prefilled form. When one occurrence is known to differ (this month's CFE is 1,340, not 900), the user can change that reserve ahead of time without touching the item's usual amount.

- [ ] **Ajustar este pago** on an unregistered bill occurrence from today on (Próximos 14 días and the Tiempo day panel) asks for the amount of that date only. It shows the usual amount, the new one, and the change in Disponible real before confirm.
- [ ] Confirm writes one `recurring_overrides` row keyed by `recurring_id` + `occurrence`. It writes no transaction and moves no balance. Only the reserve for that date changes.
- [ ] The override feeds the same commitment path: Bills_Before_Next_Income, Tiempo, Próximos 14 días, and the projection use it instead of the item amount. No second money path.
- [ ] Registering that occurrence prefills the form with the override. The saved amount is still what the user types.
- [ ] An item without a usual amount can get an override, so one occurrence of a variable bill reserves while the others do not.
- [ ] Rows with an override show both amounts (“1,340 MXN · normalmente 900”). **Quitar ajuste** restores the usual amount after the same preview.
- [ ] An override of 0 is allowed and reads “Sin cargo este periodo”. It reserves nothing and stays pending until registered or the ajuste is removed.
- [ ] Editing the item's usual amount never changes existing overrides. Editing its repeat lists overrides on dates that no longer occur and asks before dropping them.
- [ ] Past or registered occurrences cannot be adjusted. The registered movement is the record.

### Adjust one income occurrence

Expected income can differ on one date too: the aguinaldo quincena, a short freelance month, unpaid leave. Same `recurring_overrides` row and same rules as a bill, with one difference: expected income never counts toward Disponible real before it arrives, so an income override changes the projection only.

- [x] **Ajustar este ingreso** on an unregistered income occurrence from today on (Próximos 14 días and the Tiempo day panel) asks for the amount of that date only. It shows the usual amount, the new one, and the change in projected Disponible real at that income and at the lowest point of the next 90 days before confirm. Today's Disponible real does not move.
- [x] Confirm writes one `recurring_overrides` row keyed by `recurring_id` + `occurrence`. It writes no transaction and moves no balance.
- [x] The override feeds the same expected-income path: the projection, **¿Puedo comprar?**, income scenarios (the override × Income_Scenario), and the loan timeline use it instead of the item amount on that date. No second money path.
- [x] The monthly income equivalent for sliders, scenarios, and budget percent keeps the usual amount. One adjusted date does not change the monthly figure.
- [x] Registering that occurrence prefills the income form with the override. The saved amount is still what the user types, and the 1st or 2nd income rule runs on that amount as usual.
- [x] An income with no usual amount can get an override, so one known payment projects while the others do not.
- [x] Rows with an override show both amounts (“18,500 MXN · normalmente 12,000”). **Quitar ajuste** restores the usual amount after the same preview.
- [x] An override of 0 reads “Sin ingreso este periodo”. The date still bounds the income cycle and keeps its 1st or 2nd slot, so bills, “Por ingreso” installments, and rules do not shift. It projects nothing and stays pending until registered or the ajuste is removed.
- [x] Editing the item's usual amount or repeat treats income overrides exactly like bill overrides: kept on amount edits, listed and asked before dropping on repeat edits.
- [x] Past or registered occurrences cannot be adjusted.

### Transactions

- [x] Types: income, expense, transfer, CC payment.
- [x] Expense form: amount, category, method (bank / cash / card), date, note. Default date is today.
- [x] Card expense does not change bank balance, increases card debt, and lowers Real Available immediately.
- [x] CC payment reduces card debt and bank balance together.
- [x] Refunds: a negative expense on a card reduces card debt and is not income.
- [x] Meses sin intereses: a card expense can be split into 3, 6, 9, 12, 18, or 24 monthly charges (`msi_months`). The form previews the charge and the first and last cut. Card debt rises by the total; a full-strategy card reserves only the charges whose period has opened. The card roster and dossier show “a meses por cobrar” and each plan (charges posted, monthly amount, last cut). **Pagar sin meses** prefills the payment without the charges still to come. Movimientos marks the row “N MSI”. Refunds and bill or loan payments never use MSI.
- [x] Transfer between accounts does not change Real Available except when it moves money in or out of a liquid account.
- [x] Roster list: select, name, amount, method. Filter by method without leaving the HUD.
- [x] Delete a movement after confirm. The balance effect is reversed in the same write.
- [x] Edit a movement (reverse the old effect, apply the new one in one write). Reuses the add forms; links to bills and loan installments are kept. Adjustments are delete-only.

### Dashboard

- [x] Hero: **Disponible real**, colored cyan / amber / heat from the sign and a tightness threshold.
- [x] Tap opens the dossier breakdown: Bank, Cash, − CC debt, − bills before next income, − loan installments before next income, − buckets in liquid, − buffer, = safe to spend.
- [x] Next 14 days: income, bills, loan installments, card due dates, plus overdue commitments. Select a row to register it.
- [x] Quick verbs: add expense, add income, open accounts, fixed payments, loans. Savings rule and share stay stubs until their phases.

### Calendar

- [x] Month view marks income, bills, loan installments, and card dates, with a legend and month navigation. Registered events are dimmed.
- [x] Tap a day for that day’s in and out.
- [x] Projected daily balance can be a flat “known events only” line until Phase 3. (Superseded: Tiempo shows the Phase 3 daily projection.)

### Calculations in this phase

- [x] Real Available matches the formula, including buffer and loan installments before next income.
- [x] Multiple cards sum into one CC reserve, and each card keeps its own due date.
**Done when:** A card expense, a cash expense, a bill, and a loan installment dated before next income all move Disponible real correctly, and the bank balance itself only moves for bank and cash.

---

## Phase 2 — Savings method

**Goal:** First and second income rules run without manual math.

### Buckets

- [x] Three grade cards: Emergency, Retirement, Travel. Balance, target, progress bar, rule history.
- [x] Manual add and withdraw. Withdraw asks for a reason and shows the impact on Real Available.
- [x] Bucket balances held in bank or cash count in `Virtual_Buckets_In_Liquid`. A bucket pointed at a savings account is already outside liquid and does not count twice.
- [x] An apartado in an Ahorro account keeps that account in step. The account holds the money (location), the apartado says what it is for (purpose); both are stored, and every write that touches both goes through `transferWithBuckets` or a linked `adjustment`, one write with `tx_id` on the moves. Such rows are delete-only and deleting one appends the reversing moves.
- [x] **Depositar** replaces Apartar for those apartados. Desde lists every active account; Hacia is the apartado's account. The preview shows Desde, Hacia, the apartado, and Disponible real before and after (it drops only when Desde is liquid). **Ya está en {cuenta}** claims pesos already Sin apartar there, capped at that amount, with no transfer. A Desde balance lower than the amount warns and does not block.
- [x] **Retirar** on those apartados asks where the money goes: **Traer a** a liquid account (a transfer; Disponible real rises) or **Se queda en {cuenta}** (the apartado move only; the pesos become Sin apartar). The reason stays required.
- [x] The transfer form asks **Para qué apartado** when Hacia is an Ahorro account with apartados, and **De qué apartado sale** when Desde is one. One apartado is preselected; with several, Sin apartado is. Editing a plain transfer does not add an apartado.
- [x] Apartados in bank or cash keep Apartar and Retirar. The Apartar note points to Editar → Dónde está, and changing Dónde está on an apartado with money says that it does not transfer anything.
- [x] Ajustes holds the buffer and the second-income split.

### Saldo ya apartado

Apartar reserves pesos that already sit in Banco, Efectivo, or Saldo sin origen, so Disponible real drops by that amount. **Fijar saldo** is the other write: the apartado already holds this much, and that money is not in those accounts.

- [x] From the apartado dossier, **Fijar saldo** asks for the total the card should show. The field is the current balance, not an amount to add. System and custom apartados both.
- [x] The gap versus the balance now is one append-only `bucket_moves` row with `source: opening`. A later fijar appends only the new gap. The bank, cash, and unassigned balances do not move. This is not income and not a transfer.
- [x] Opening moves are left out of `Virtual_Buckets_In_Liquid`. Confirm shows apartado now, the saldo being set, and Disponible real unchanged. The note says this money is not in the accounts.
- [x] The new total cannot fall below the part already reserved from liquid (Apartar, income rules, moves between apartados). That part is released only with Retirar, which still frees Disponible real. Copy names the reserved amount.
- [x] Retirar spends opening money only after the reserved part is gone. That withdrawal asks for a reason and does not change Disponible real, because those pesos were never in liquid. History keeps the opening row; undo appends a reversing move (`reverses_id`).
- [x] **Ya está en mi banco** converts the opening portion into a normal reserve. Confirm shows the drop in Disponible real before the write. The conversion appends a reversing opening move and a `manual` move for the same amount.
- [x] For an apartado in an Ahorro account, **Fijar saldo** asks “¿Cuánto hay hoy en este apartado?” and writes no `opening` row, because the money is in an account the app tracks. A higher total first claims that account's Sin apartar pesos, then raises the account by the rest with one `adjustment` linked to a `manual` move. A lower total leaves the difference in the account, Sin apartar. The preview shows the apartado, the account, Sin apartar, and Disponible real unchanged.
- [x] The grade card, its progress bar, and the pace row use the full apartado balance, opening included. The income-rule remainder keeps using `Virtual_Buckets_In_Liquid`, so an opening amount is not subtracted twice and does not shrink the suggestion. No second money path.

### Custom buckets

- [x] Create a bucket from Ahorro (“Nuevo apartado”): name, optional target, optional target date, and where it sits (bank or cash, or a savings account). Examples: Auto, Regalos, Predial, Mascota. Names are unique among active buckets.
- [x] Custom buckets use `rule_type: custom` and show as grade cards after the three system buckets, with the same dossier: Apartar, Retirar, Mover, Editar, history.
- [x] They count in `Virtual_Buckets_In_Liquid` exactly like the system buckets. No second money path.
- [x] With a target date, the dossier shows how much to set aside per income event to arrive on time (paydays from recurring income, or one every 15 days without a schedule). A passed date with money missing shows what is left, neutrally.
- [x] Requirements row on that pace: needed per income vs what the last income actually set aside. (Required is the pace as of the last payday; set aside counts deposits since then, without moves between buckets or reversals. Amber when short, with neutral copy.)
- [x] Rename in place; history keeps the same `uuid`. Reorder custom cards (‹ ›); system buckets stay first.
- [x] Archive only at a zero balance, like accounts. To archive a bucket with money, withdraw it first (with a reason) or move it to another bucket in one confirmed step that writes two moves (`source: bucket_transfer`, shared `transfer_id`). Archived buckets leave the cards and Inicio, and can be restored from Archivados.
- [x] Moving between a liquid bucket and one in a savings account shows the Disponible real change before confirm.
- [x] The three system buckets can be renamed and have their target changed, but not archived, because the income rules point at them.
- [x] The first- and second-income rules keep their fixed targets (Emergencia; Retiro and Viajes).
- [x] Letting a rule send part of an income to a custom bucket goes through the same confirm step. A custom bucket can set “Con cada ingreso” (1er, 2º, or ambos) and a fixed MXN amount. That rule then shows it as an editable line after the system buckets; the moves use the rule’s source, count in the shortfall, and “Ajustar a lo que alcanza” cuts custom lines after the system ones. Archived buckets drop out.
- [ ] Payloads and share links carry the bucket name and amounts only.

### Add income

- [x] One MXN amount, already converted. No currency, exchange-rate, or day-rate field.
- [x] Choose account, type (Ingreso principal, Otros ingresos, Cobro de préstamo), and date.
- [x] If this is the 1st or 2nd income event of the cycle, offer the matching rule. The user can skip.
- [x] A manual income near an unrecorded scheduled payday (±10 days) offers “Pago programado”, preselecting the nearest one, so that payday stops showing as pending on Inicio and Tiempo. “No es un pago programado” is always an option.

### First-income rule

- [x] Ask for the real balance of the income account now, prefilled with the calculated one.
- [x] Show the gap versus the calculated balance. Confirming saves it as an `adjustment`.
- [x] `Remainder = reconciled liquid − most recent income − already in buckets − card reserve`.
- [x] If remainder > 0, suggest a virtual transfer to Emergency (editable) and wait for confirm.
- [x] If remainder ≤ 0, skip with a neutral message. No shame copy.

### Second-income rule

- [x] Reconcile the balance the same way.
- [x] Compute retirement (default 20% of the income) and travel (default 5,000 MXN, capped by what remains of the income).
- [x] Check against Real Available after reconcile, which already subtracts bills, card reserve, loan installments, buckets, and buffer before the next income.
- [x] If short, offer: edit either amount, “Ajustar a lo que alcanza” (travel drops first, then retirement), skip, or move anyway.
- [x] Only confirmation writes the virtual transfers.

### Rule history

- [x] Every rule move is a `bucket_moves` row with its source and `income_tx_id`.
- [x] Ahorro lists recent main incomes with their rule, what was moved, or **Sin aplicar** with an Aplicar verb. Skipping writes nothing, so a skipped income can be applied later.
- [x] The same rule cannot run twice on one income. A second attempt shows what it already moved.
- [x] **Regla de ahorro** in the add menu picks any recent income and either rule, for one payday a month or no schedule.
- [ ] **Regla pendiente** on Inicio: a main income in the current cycle that could run a rule and has none applied shows one row with the income, its date, and the rule (1er or 2º ingreso). Same panel pattern as Revisión de efectivo.
- [ ] **Aplicar** opens the rule wizard for that income. The wizard is unchanged: reconcile, editable amounts, confirm. The prompt itself never writes a move.
- [ ] **Ahora no** hides the prompt until the next payday by saving `settings.rule_prompt_dismissed_at`. It writes no bucket move, so the income stays **Sin aplicar** in Ahorro and can still be applied from there or from the add menu.
- [ ] The prompt clears on its own once the rule runs, or when the income is edited out of the main income category or deleted. An income from an earlier cycle does not show on Inicio; it stays in the Ahorro history.
- [ ] Copy is neutral: “Tu ingreso del 15 sep aún no tiene regla.” No count of skipped incomes, no warning color.

### Reconciliation

- [x] Weekly cash prompt: a week after the last review, Inicio shows **Revisión de efectivo** per cash account with Anotar gasto (cash prefilled), Contar efectivo (the Ajustar saldo form, gap as an `adjustment`), and Está al día. A cash adjustment or `settings.cash_reviewed_at` counts as a review; a new cash account waits a week from its balance date.
- [x] Card payment larger than bank balance warns (balance vs missing amount) and offers a transfer from a bucket held in a savings account, capped by the bucket and the account. The preview names both accounts, the bucket, and the rise in Disponible real; only **Confirmar transferencia** writes. One write saves the transfer (`bucket_id`) and the bucket withdrawal (`tx_id`). Such transfers are delete-only. Deleting one appends a reversing move (`reverses_id`) that returns the money to the bucket; bucket moves stay append-only.

**Done when:** Both rules can be completed from an income save, declined cleanly, and replayed from bucket history.

---

## Phase 3 — Projections and budgets

**Goal:** “¿Puedo comprarlo?” is a planning screen, not a report.

### Budgets

- [x] Monthly limit per expense category, in MXN, on **Proyección → Presupuesto**. A standing limit (`month: null`) repeats every month; a row for one month overrides it. Removing a limit never touches spending.
- [x] A category limit covers its subcategories (with the subcategories section). Presupuesto lists top-level categories; a parent’s dossier lists its subcategories plus Sin subcategoría.
- [x] Optional limit on a subcategory (for example, Cine inside Entretenimiento). It counts toward the parent limit, and it never raises it. Sub limits never add to the month’s budgeted total.
- [x] Show budgeted / spent / remaining as three grade cards, and budgeted as a percent of expected income. Month navigation; spending without a limit is listed as “sin límite”.
- [x] Spending counts `expense` rows of the month (card, bank, and cash alike). Refunds lower it; transfers, card payments, and adjustments never count. Uncategorized spending goes to Sin categoría.
- [x] Pace line: a tick on each stat bar marks how much of the month has passed. Cyan under pace, amber over pace, heat over the limit.
- [x] Expected income comes from recurring income items with an amount, in MXN. Without amounts, it uses the income already received that month and says so.
### Projections

- [x] Inputs: purchase amount, target date (a past date means today), optional “pay with card”, and with a card, optional meses sin intereses. With MSI each checkpoint subtracts only the charges posted by that date.
- [x] Projection engine: `Real_Available_On(d)` is the same `moneySnapshot` formula run on projected data — expected income after today arrives, unpaid bills (from the current cycle) and borrowed installments up to `d` are paid from liquid, and the next cycle’s reserves apply. Lent money, unscheduled income, and income without an amount are not assumed. On today it equals Disponible real.
- [x] Outputs: Disponible real on that date before and after the purchase, and the lowest point at each income event for the next 90 days. Shortfall copy is neutral and names the date. Card purchases show the card debt after; buckets in bank and cash show whether they would cover a shortfall. Nothing is written.
- [x] Sliders: expected income per month (MXN, from scheduled paydays), habitual daily spending (prefilled with the average of the last 60 days of everyday expenses, without scheduled bills or installments), and one-off extra expenses until the date.
- [x] Three grade cards: Conservative / Base / Optimistic income (×0.9 / ×1 / ×1.1 on scheduled income). Selecting one drives the requirements table and the per-income series.
- [x] Requirements table: cost required vs projected available, plus after purchase, lowest point, card debt, and buckets.
- [x] Daily projected balance on the calendar: each day from today on Tiempo shows its projected Disponible real (compact, heat when negative), with the full figure in the day panel. Same engine and base assumptions as ¿Puedo comprarlo?, including habitual daily spending.
- [x] Save a scenario to `projection_scenarios` (name, amount, date, card, monthly income, daily and extra spending). Open or remove saved scenarios.

### Loan timeline — “¿Hasta cuándo?”

- [x] Per loan (in its dossier) and for all loans (on Préstamos): a series of projected Disponible real at each income event from today until the last payoff date, plus one income after.
- [x] Mark the payoff date on the series (“Termina …”) and on Tiempo (“Última cuota …”). After that date, the series shows the installment coming back (“Cuota liberada”).
- [x] Requirements row per income cycle: installments of that cycle vs projected Disponible real after reserving them. Amber when what is left is less than those installments, heat when it is short.
- [x] Grade cards: pay as scheduled / extra payment of X each income / pay off now. Each shows payoff date, total interest, and the lowest Disponible real along the way; selecting one drives the series. Extra payments reschedule with the same “Terminar antes” rules as Abono extra. The panel only projects; Abono extra is still the only write.
- [x] “¿Puedo comprarlo?” includes future loan installments. A purchase that breaks an installment cycle names that date (lowest point).
- [x] Taking a new loan is a scenario: amount, installment, term. The projection shows the new Disponible real per cycle and the new payoff date before anything is saved. (The borrowed loan form shows Disponible real with and without the new installments at each income, up to 48 incomes, plus the lowest point. The loaned money itself is not counted, since it usually already has a destination.)
- [x] Income scenarios move expected income only. Loan installments stay fixed.

### Plan — lista de deseos

“¿Qué compro, cuándo y con qué?” Several planned purchases, each switched on or off, paid from Disponible real, a card, or apartados, next to the projected balance of every apartado. **Plan** is a third view on Proyección (¿Puedo comprarlo? · Plan · Presupuesto). A wish is an event that has not happened; a draw is a planned bucket move; only **Ya lo compré** touches accounts. In the UI the forward layer is “proyectado” or “planeado”, never “virtual”, which already means money reserved in liquid.

Engine (`src/lib/plan.ts`, on top of `projectedAvailable`):

```
Base(d)          = Real_Available_On(d) − planned bucket contributions up to d
Item_Cost(d)     = amount, or with MSI the charges posted by d (as in ¿Puedo comprarlo?)
Item_Covered(d)  = min(granted draws, Item_Cost(d))
Plan_Available(d) = Base(d) − Σ (Item_Cost(d) − Item_Covered(d)) over active items dated ≤ d
```

- [x] `plan_items` and `planned_contributions` stores. A wish never needs an apartado: **Usar apartados** starts empty.
- [x] Saved scenarios from ¿Puedo comprarlo? migrate once into disabled wishes (name, amount, date, card, MSI). Their slider values are not kept. **Guardar escenario** becomes **Agregar al plan**.
- [x] Rules come before wishes. With **Incluir reglas de ahorro** on (the default, `settings.plan.include_rules`), each projected 2nd income adds Retiro (income × `retirement_pct`) and Viajes (`min(travel_mxn, income − Retiro)`), every projected income adds the custom `income_share` lines of its slot, then the planned contributions. All of them go through `fitInOrder` against the projected Disponible real of that payday, exactly like “Ajustar a lo que alcanza”. The first-income sweep to Emergencia is not projected: it would hide slack.
- [x] Every contribution lowers projected Disponible real and raises that apartado’s projected balance, whether it sits in bank, cash, or an Ahorro account (the plan assumes you deposit it). Every draw raises projected Disponible real by what it covers. No second formula: with no wishes and no contributions the Plan equals ¿Puedo comprarlo?’s base line.
- [x] A draw is capped by the apartado’s projected balance from the wish’s date on, after the draws of wishes above it. A capped draw shows amber with what fits.
- [x] With a card, the draw covers the charges as they enter the reserve (the whole purchase without MSI, one monthly charge with MSI) until it runs out.
- [x] Wishes are evaluated in list order. Each one sees the wishes above it, never the ones below. Reorder with ‹ ›.
- [x] **Lo antes posible** (no date): the earliest of today and the next projected paydays (up to 12 months) where the wish, its draws, and every later payday stay at 0 or more. “Alcanza el 12 dic” or, neutrally, “No alcanza en los próximos 12 meses”.
- [x] Hero: **Punto más bajo con tu plan** and its date. Roster: switch, name, date or “Lo antes posible → fecha”, amount, funding sub-line, and status (cyan fits, amber tight or capped draw, padlock and amber missing amount when it does not fit).
- [x] Grade cards Conservador / Base / Optimista apply to the whole plan. Sliders for income, daily spending, and extra expenses, as on ¿Puedo comprarlo?.
- [x] Wish dossier: requirements (cost, from apartados, from Disponible real, projected on that day, lowest point after, card debt after) and the verbs Editar, Ya lo compré, Descartar, Quitar.
- [x] Without a selection the dossier lists Disponible real at each payday **Sin deseos** and **Con deseos**.
- [x] **Apartados proyectados**: one stat bar per apartado, today vs the end of the plan, with what the rules and planned contributions add and what the wishes use, and “Meta el …” when the target is reached.
- [x] **Aporte planeado**: apartado, amount, and income (1er, 2º, ambos). It stops at the apartado’s target. It never writes a `bucket_move`. Switch it off or remove it.
- [x] **Ya lo compré** shows the expense (amount, date, Pagar con, category, MSI) and each draw, plus Disponible real and each apartado before and after. One write saves the expense (`plan_item_id`), the draws, and the wish’s `tx_id`. A draw from an apartado in bank or cash is a linked withdrawal (`tx_id`, reserved pesos first, then opening). A draw from an Ahorro apartado is a **Traer a** transfer into the paying account. With a card, only what the card reserves today is drawn; the rest stays in the apartado.
- [x] A wish is bought while its movement exists. Deleting the movement reverses its linked draws and returns the wish to the list. Movements with draws are delete-only, like other bucket-linked rows.
- [x] **Descartar** keeps the wish in Descartados and writes no money. **Restaurar** brings it back.
- [x] **Hacerlo regla**: turn a planned contribution on a custom apartado into its `income_share`, with the Disponible real preview.
- [x] **Apartar para esto**: create a custom apartado from a wish (name, target = amount − draws, target date = the wish’s date), optionally with a planned contribution at the suggested pace.
- [x] **Mostrar plan en Tiempo** (`settings.plan.in_tiempo`, off by default): the daily projection includes active wishes and contributions, and those days read “Con plan”.
- [x] Card wish with MSI after **Ya lo compré**: suggest “Pagar con {apartado}” on the next card payments until the rest of the draw is used.
- [x] Presupuesto shows active wishes with a category in their month as a dim “Planeado” line, never as spent.
- [ ] Share one wish or the list in a link: names, amounts, dates, apartado names. Sharing itself arrives in Phase 6.

**Done when:** A purchase dated three months out answers in one screen, changing the income scenario changes the surplus without a reload ritual, a loan shows the Disponible real for each income cycle until its payoff date, and three wishes (one on a card with MSI, one using an apartado, one “lo antes posible”) show their dates, funding, and the projected apartados without writing anything until **Ya lo compré**.

---

## Phase 4 — Expense stats and price book

**Goal:** See where spending went, by type and over time, and what each grocery item cost at each place on each date.

This does not add a money layer. A line item explains an expense. It does not change Disponible real. “Place” here is the store, not the bank account.

Stats and the price book are display modes on Movimientos: **Lista**, **Estadísticas**, **Precios**.

### Expense stats

Window chips use the section rail: ciclo de ingreso, mes, 3 meses, 12 meses.

- [x] Hero on Estadísticas: **Total gastado** in the selected window, tabular, `--cyan-bright`, with the previous window and the change beside it. The income cycle runs from the last payday to the next (the last 15 days without a schedule); 3 and 12 months end with the current month.
- [x] Stats count expenses only. Transfers, card payments, and `adjustment` rows never count as spending.
- [x] Spend by category (the expense type) as horizontal stat bars, longest bar at the top, amount and share labeled.
- [x] Spend over time as one cyan series (week buckets inside a cycle or a month, month buckets for 3 and 12 months). Amber draws the previous window only, as a tick on each column. On narrow screens a 12-column series drops the per-column figures.
- [x] A category over its Phase 3 budget uses `--heat` on that bar. Other categories stay cyan. No per-category rainbow. Windows that are not one calendar month compare against the monthly limits prorated by day.
- [x] Spend by payment method: bank, cash, credit card, three bars.
- [x] Tap a category bar that has subcategories to open its dossier: the same stat bars, one per subcategory, plus **Sin subcategoría** for spend booked on the parent. The bars sum to the parent total.
- [x] Tap a bar or a point to open the roster filtered to that type and those dates (category, payment method, or one week or month). “Volver a estadísticas” keeps the window.
- [x] Income, transfers, and CC payments stay out of the expense series.
- [x] Refunds reduce the category total. They do not appear as income.
- [x] Empty window uses one dim footer sentence.

### Subcategories

Subcategories are optional detail inside a category, for example Cine, Streaming, and Conciertos under Entretenimiento. They label spend. They do not add a money layer and never change Disponible real.

- [x] A category may have subcategories one level deep. A subcategory cannot have its own children. Subcategories use the parent’s `kind`.
- [x] None are seeded. The user creates them from the category picker or from Ajustes, and the category stays usable without them.
- [x] The expense and income forms show one picker, with subcategories indented under their parent. Choosing the parent alone is valid and stays one tap.
- [x] `category_id` on a transaction, recurring item, item, or budget can point to a category or a subcategory. Totals for a category always include its subcategories. (Items arrive with the price book.)
- [x] Uncategorized cannot have subcategories.
- [x] Rename a subcategory in place. Its history keeps the same `uuid`.
- [x] Move a subcategory to another parent only after a preview that names how many movements change category totals.
- [x] Archive instead of delete when a subcategory has movements. Archived ones leave the picker and stay in history and stats. Deleting an empty one is allowed.
- [x] Deleting a subcategory with movements asks first, then reassigns those movements to the parent in the same write.
- [x] Roster filter by category includes its subcategories. A subcategory filter shows only that subcategory.

**Example.** Entretenimiento 1,800 MXN this month: Cine 650, Streaming 900, Sin subcategoría 250. The Entretenimiento bar shows 1,800, and its dossier shows the three bars.

### Price book

A grocery trip can list products without using AI. Confirming a receipt later fills the same tables.

- [x] Optional lines on an expense: item, qty, unit, unit price or line total, place, date (defaults to the expense date). (One place per expense in the form; each line stores it and the expense date. Line total wins over qty × unit price. A neutral note shows when the lines do not sum to the amount.)
- [x] `unit_price = line_total / qty` when qty > 0. If qty is missing, keep the line total and leave unit price empty. Empty unit prices stay off the chart.
- [x] Units: `pza`, `kg`, `g`, `L`, `ml`. Compare prices only inside one unit family (weight, volume, or piece). A kg price and a piece price never share a series.
- [x] Item match uses `normalized_name` (trim, lower case, strip accents). Display the name the user typed. A near-match asks. It does not merge.
- [x] Places are local rows: name, kind, optional area (colonia or city). No map and no store directory.
- [x] Unknown place still saves as **Sin lugar**.
- [x] Precios roster: item name, last unit price, last place, last date.
- [x] Item dossier: cyan series of unit price by date, and a requirements row — cheapest recent place vs last price paid.
- [x] Place filter on the dossier. Same item at Walmart, Chedraui, Oxxo, and the tianguis stays one item with many observations.
- [x] Deleting or editing an expense updates its lines. Price history does not keep a ghost row. (Lines, new items, and new places save in the same write as the expense; items left with no line are removed.)
- [x] Scanning the same ticket twice does not double-count. Lines belong to one transaction `uuid`. (Duplicate-ticket detection on import belongs to Phase 5.)

**Example.** Leche 1 L: 1 Sep Chedraui 28.50 MXN, 12 Sep Walmart 26.00 MXN. The dossier names Walmart as the cheaper recent place and plots both dates.

**Done when:** A month of categorized expenses shows type bars and a time series, a category with subcategories breaks into bars that sum to its total, and two shops for the same item show different unit prices on the dates they were bought.

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

- [x] Records created this way are `source: ai_manual`.
- [x] Manual entry stays one tap away on the same form. (The sparkle on a new expense opens the ticket flow; “Llenar a mano” returns to the form. Movimientos opens ticket or statement.)
- [x] `ai_jobs` stores task, status, `prompt_hash`, `response_hash`.
- [x] A second paste with the same `response_hash` asks before creating another row. (The hash is the JSON object, so fences and surrounding text do not hide a repeat.)

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

- [x] Strip fences, take the first `{` through the last `}`, parse.
- [x] Reject a wrong `schema_version` or `task`.
- [x] Validate required fields and types. Errors are human-readable.
- [x] Repair loop copies a second prompt that includes the errors, the schema, and the bad JSON.
- [x] Confidence badges: cyan above 0.8, amber from 0.5 to 0.8, heat below 0.5. Below 0.6, highlight the weak fields.
- [x] Redaction warning before copy whenever the prompt contains amounts, merchants, or statement text.

### P0 tasks

- [x] `parse_receipt` — date, merchant, total, currency, payment method, last4, category, items, confidence. Total must be > 0. Date must be valid and not far in the future (more than a week). Category must match the local list or become Uncategorized. A subcategory must match one under that category, or the row falls back to the parent. The model never creates a category or a subcategory. Item sum mismatch is a warning, not a block. last4 is shown and not stored.
- [x] On confirm, each parsed line becomes a `transaction_line`. Merchant maps to a place. A new item or place is created only after that confirm. Unit price feeds the Phase 4 dossier when qty and unit are present.
- [x] `parse_bank_statement` — account name, period, closing balance, transactions. Dedupe on date + amount + description. Flag possible duplicates and recurring-bill matches. User confirms the import. Exact duplicates start omitted. The closing balance is shown and never written over the account.
- [x] Preview lists exactly which balances will change.

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

### Tier 3 — `.guanabana` file

- [ ] JSON → gzip → optional AES-GCM → download `.guanabana`.
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
- [ ] `parse_income` — MXN amount and date from a deposit or payslip. Creating the income may offer the Phase 2 rule. The model does not run the rule.
- [ ] `parse_cc_statement` — balance, due, minimum, transactions, and MSI plans (purchase, months, charge). Matches plans to existing MSI purchases and asks before creating or changing one. Updates the card only after confirm, and refreshes CC reserve.

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
- [ ] Recurring detection suggestions, including the repeat (“parece cada 2 viernes”). They never auto-create bills.
- [ ] Passcode and biometric lock.
- [ ] P2P sync only if file + URL + QR are not enough: WebRTC data channel, manual signaling via fragment or QR, encrypted payloads, merge on `uuid` + `updated_at`. Not part of v1 acceptance.

---

## Edge cases

These are requirements, not later nice-to-haves. Cover them in the phase that owns the math.

- [x] Negative first-income remainder skips with neutral copy.
- [ ] Rule wizard closed without confirming: nothing is written, and Inicio shows Regla pendiente until the rule runs, the user taps Ahora no, or the next payday arrives.
- [x] Second income cannot fund 20% + 5,000: offer reduced amounts.
- [x] Card payment larger than the bank: warn, offer a bucket transfer.
- [x] Forgotten cash: quick add plus a weekly reconcile prompt.
- [x] User paid in another currency: enters the MXN that landed. No currency or exchange-rate field appears.
- [x] Several cards: one combined reserve, separate due dates.
- [ ] Card refund: lower card debt, do not book income.
- [x] MSI paid early: card debt drops below the unbilled charges; the reserve stays at zero, never negative.
- [ ] MSI purchase refunded or cancelled: the user edits or deletes the purchase; a partial refund on an MSI plan asks whether it shortens the plan.
- [ ] Card cut day changes: MSI charges follow the new day. Reconcile against the statement if the bank kept the old schedule.
- [x] Bucket withdrawal: reason and impact before write.
- [x] Fijar saldo below the amount already reserved from liquid: refuse, and name that amount. Releasing it is Retirar.
- [x] Fijar saldo on an apartado that sits in a savings account: Disponible real stays the same either way. The verb still sets the total instead of adding to it.
- [x] Model invents a merchant or amount: user still confirms.
- [x] Duplicate paste: same `response_hash` asks.
- [ ] Negative expense amount: treat as a refund.
- [x] Unknown category: Uncategorized.
- [x] Unknown subcategory: keep the parent category. Do not create one without confirm.
- [x] Subcategory deleted with movements: ask, then move them to the parent. Parent totals do not change.
- [x] Subcategory budget above the parent budget: warn. The parent limit still governs.
- [x] Partial JSON: repair loop, no partial write.
- [x] Sensitive prompt: warn before copy.
- [ ] Share payload too big: offer `.guanabana`.
- [ ] Bucket or settings conflict on import: always ask.
- [ ] Item names almost match: ask, do not auto-merge.
- [ ] Qty missing on a grocery line: keep the spend on the expense, omit unit price from the chart.
- [ ] Mixed units on one item: separate series.
- [ ] Refund of a grocery line: lower the expense total, do not plot it as a cheaper price.
- [ ] Weekly bill with two unpaid occurrences in one cycle: both reserve, both show on Próximos 14 días, and registering one leaves the other pending.
- [ ] Payday every 2 weeks lands three times in one month: the projection counts three, and the monthly equivalent stays amount × 26 ÷ 12.
- [ ] Bill every 2 months on day 31: clamps to the last day of short months and keeps counting months from `start_date`.
- [ ] Repeat changed with an overdue occurrence: ask before letting it go. Disponible real never jumps silently.
- [ ] Occurrence adjusted, then paid a different amount: the movement keeps what was typed, the override stops reserving, and nothing asks to reconcile.
- [ ] Occurrence adjusted to 0 and later charged anyway: registering it still works, with the amount typed.
- [x] Income adjusted to 0 and paid anyway: registering it still works, and the 1st or 2nd rule is offered on the amount typed.
- [x] Income adjusted up and paid less: the projection moves to the typed amount, and the copy stays neutral.
- [ ] Missed loan installment: mark it late, keep it in the next cycle’s reserve, and use neutral copy.
- [ ] Installment larger than a cycle’s income: warn on the timeline, and offer a bucket transfer or a scenario with an extra payment later.
- [ ] Mover between apartados that live in different accounts (one in GBM, one in bank or another Ahorro account) moves only the apartados, not the account money. Pair it with a transfer or limit it to the same account.
- [ ] Changing an account's type after creation (bank or cash ↔ Ahorro o inversión), with the Disponible real change before confirm.
- [ ] Lender changes the rate or schedule: edit the remaining schedule only. Paid rows never change.
- [ ] Loan paid early: status becomes `paid`, the remaining scheduled rows are removed after confirm, and the timeline updates.
- [x] Money lent is never repaid: the user can write it off (**Dar por perdido**). The money already left with the disbursement, so no balance changes.
- [x] Lent money repaid in part, then written off: the collected income stays, and only the unpaid rows stop showing.
- [x] Lent loan saved without the disbursement (“Ya lo registré”): no second expense is written, and each **Registrar cobro** still adds income.

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
- [x] A subcategory total (for example, Cine this month) is two taps from Estadísticas.
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
