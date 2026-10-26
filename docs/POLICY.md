# Policy

`classify(action, state, mandate, now)` is in `packages/policy/src/classify.ts`. It is pure and deterministic and has 100% branch coverage. It returns `{ lane, outcome, ruleId, checks }`.

| Lane | Outcome | Rule ids |
|---|---|---|
| Lowers risk | `executed` | `R-LR-001` (cancel before submit; a mandate change that only tightens) |
| Inside your mandate | `executed` | `R-WM-PAY` |
| Adds risk | `pending_approval` | `R-EX-PAY`, `R-EX-UPDATE_MANDATE` |
| Breaks a rule | `blocked` | the invariant's id, below |

**Invariants**, checked first. None can be overridden.

| Rule id | Blocks when |
|---|---|
| `INV-NO-MANDATE` | no active mandate |
| `INV-AMOUNT` | not a positive decimal with at most 6 decimals |
| `INV-ADDRESS` | not an EVM address, the zero address, the treasury itself, or no destination at all |
| `INV-NETWORK` | not the mandate's network, or not supported by this build (only `ARC-TESTNET`) |
| `INV-PAYEE-PINNED` | a known payee (by id or name) at any address other than its pinned one |
| `INV-HARD-MAX` | over `hard_max_per_tx` |
| `INV-FUNDS` | amount + fee estimate > balance (USDC is the gas token) |
| `INV-DUPLICATE` | a live attempt already exists |

**Lane checks for PAY.** If all of these pass, the payment is inside the mandate. If any fails, it needs a person.
- `mandate_active`
- `payee_known`, by id or exact pinned address (never by name)
- `per_tx_limit`: a payee override can only lower it
- `daily_cap`: counts only payments that ran without approval
- `reserve_after`

**Mandate changes.**
- Tightens, so it applies now: lowering a cap, removing a payee, an earlier expiry, a higher reserve.
- Loosens, so it needs approval: anything else, including any change to a payee's address or name.

**Tests.**
- `test/classify.table.test.ts`: the PRD §8.4 table, 19 rows.
- `test/classify.edges.test.ts`: 47 edge cases.
- `test/classify.property.test.ts` (fast-check) checks four properties:
  - determinism;
  - inside the mandate ⇒ every check passes;
  - raising a limit never makes the lane stricter;
  - a pinned payee at any other address always breaks a rule.
