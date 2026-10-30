# Arc Microgrants: Built with Arc Studio (DoraHacks), Twokey Escrow

Round 2 closes **Nov 2, 2026, 10:29 IST** (Nov 1 in the US). It needs contracts written and tested **in Arc Studio**, deployed to **Arc mainnet**, an app built there, and at least one mainnet transaction moving USDC through the contract. Twokey itself was built outside Arc Studio, so the entry is a small companion built there: the two-key rule as a contract.

## The Arc Studio prompt
> Build "Twokey Escrow", the two-key rule for AI agents paying in USDC on Arc.
>
> **Contract `TwokeyEscrow`**
> - The constructor sets an `owner` (the human key) and the USDC token at `0x3600000000000000000000000000000000000000` (6 decimals).
> - The owner can pin payees, each with a per-payment auto limit, and can add or remove agent addresses.
> - `request(payee, amount, memo)` can be called by an allowed agent. It pulls `amount` of USDC from the agent with `transferFrom`.
>   - If the payee is pinned and `amount` is within its auto limit, pay the payee immediately and emit `Paid(id, payee, amount, auto = true)`.
>   - Otherwise hold the USDC in escrow, store `termsHash = keccak256(payee, amount, memo, id)` and an expiry 24 hours ahead, and emit `Requested(id, payee, amount, termsHash)`.
> - `countersign(id, termsHash)` can only be called by the owner. It must match the stored `termsHash` (the approval is sealed to the exact terms), then pays the payee and emits `Paid(id, payee, amount, auto = false)`.
> - `reject(id)` (owner) or `refund(id)` (anyone, after expiry) returns the USDC to the agent.
> - Reentrancy guard; no admin withdrawal of escrowed funds.
>
> Write tests for:
> - auto-pay within the limit;
> - escrow above the limit;
> - countersign with the right hash and with a wrong one (must revert);
> - reject;
> - refund after expiry;
> - a non-owner trying to countersign (must revert).
>
> **App:** connect a wallet.
> - **Owner view:** pinned payees and limits, plus a "Needs you" list with Countersign and Reject buttons showing the terms hash.
> - **Agent view:** a form to request a payment.
> - **Feed:** every Paid and Requested event, linked to explorer.arc.io.
>
> Deploy to Arc mainnet.

## Mainnet transaction to show
- **Auto-pay:** the agent requests 0.05 USDC to a pinned payee within its limit, and it is paid at once.
- **Countersign:** the agent requests 0.20 USDC (over the limit), and the owner countersigns.
- **Total cost:** about 0.25 USDC plus gas.

## Live on Arc mainnet (30 Oct 2026)
- **Contract:** `0x5D1333bA6E53Cb3A5Ff26Ff22cC1d4E9c8A49715`, https://explorer.arc.io/address/0x5D1333bA6E53Cb3A5Ff26Ff22cC1d4E9c8A49715
  - Deployed from the owner's MetaMask with the app's Deploy card.
  - Deploy tx `0xf360bf0fda031a1e500d56cc7e4153397430f3835c2be5649571e732973b16c7`, block 28645318.
  - Owner `0x548c68cD338442eE5C64D43cd3061C978aE2cF98`, max hold 7 days.
- **Payee:** the Twokey mainnet treasury `0x6d57604cbefd802a0d74ae5bb0461891711adbf2`, pinned with a cap of 0.05 per payment.
- **Agent:** the owner wallet, with a 0.25 cap per rolling 24h.
- **Funding:** the escrow was funded with 0.30 USDC.
- **Auto-pay, request #1, 0.05 USDC:** `0xe7419fbacc7bc55307ad102169a6ed5556ea0db2c43a188b23740981a07d1fce`
- **Held, request #2, 0.20 USDC:** `0x3a4b437059a89f8200afeb536e43637c3d49bdc7860fb952617e4481ab920dce`
- **Countersigned and paid, request #2:** `0x2d74a412751c41974f2637ad30ef3b2cccbec1af4d0baa3654b531d8dbdbf24d`
- **Live app:** https://fascinating-figolla-b5b7a2.netlify.app
- **Repo:** https://github.com/PrabalParihar/twokey-escrow-studio
- **Arc Studio project:** https://studio.arc.io/app/79af613f-395f-4540-8682-9de524aac944

## DoraHacks fields
- **Name:** Twokey Escrow: the two-key rule for agent payments, onchain
- **Short description:** AI agents pay pinned payees on their own within a limit. Anything else waits in escrow until a human countersigns the exact terms, matched by hash, on Arc mainnet.
- **Arc Studio project URL:** «from Arc Studio»
- **Live app:** «Arc Studio app link»
- **Contract and tx:** «address», «tx hash» on explorer.arc.io
- **Repo:** «Arc Studio → GitHub push»
- **Video:** the build in Arc Studio plus the mainnet transaction
- **How Arc Studio was used:** contracts, tests and the app were generated and iterated in Arc Studio from the prompt above, and deployed from there.
- **Builder profile:** https://github.com/PrabalParihar
- **Relation to Twokey (https://twokey.si, https://github.com/PrabalParihar/twokey-arc):** Twokey enforces this rule offchain in front of Circle developer-controlled wallets. This companion is the same rule as a contract, built and deployed in Arc Studio for this round. It is not funded by any Circle or Arc program.
