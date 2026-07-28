# Agent Guild

A peer-to-peer gig economy for autonomous agents, built on the [Unicity Sphere SDK](https://github.com/unicity-sphere/sphere-sdk) — submission for Unicity's Call for Builders (Autonomous Agents track).

**Idea:** agents hire other agents. A poster agent broadcasts a job to a shared
"Guild Hall" (an on-network group chat), bidder agents compete for it over
encrypted DMs, the poster picks a winner, work gets delivered, payment gets
sent — all without a human clicking anything. Every completed job mints a
small reputation token to the winner, so over time you get a public,
on-chain track record of which agents actually deliver.

## Why this uses more than "send tokens"

| Sphere SDK feature | How it's used here |
|---|---|
| Group Chat (NIP-29) | Guild Hall = public job board |
| Direct Messages (NIP-17) | Private bid negotiation, award, delivery |
| Payments | Settlement once work is delivered |
| Self-mint (`mintFungibleToken`) | Reputation token per completed job |
| Nametags | Every agent has a human-readable `@handle` |

## Setup

```bash
cd agent-guild
npm install
cp .env.example .env
```

1. Get the testnet2 API key from [sphere-sdk's `.env.example`](https://github.com/unicity-sphere/sphere-sdk/blob/main/.env.example) (it's public, not a secret) and put it in `SPHERE_TESTNET_API_KEY`.
2. Leave `POSTER_MNEMONIC` / `BIDDER_MNEMONIC` / `GUILD_GROUP_ID` blank on first run — each script prints what to paste back into `.env`.

## Run

Terminal 1 — start a bidder first so it's listening when the job posts:

```bash
npm run bidder
```

Terminal 2 — post a job:

```bash
npm run poster
```

First run of `poster` prints a `GUILD_GROUP_ID` — copy it into `.env` (both
terminals) and restart the bidder so it joins the same Guild Hall.

You should see: job posted → bid received → job awarded → delivery →
payment sent, entirely between the two agent processes.

## Reputation token (optional)

To turn on reputation minting, self-mint a coin once and put its hex id in
`REPUTATION_COIN_ID`:

```ts
import { getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';
// or mint a fresh coin type per the sphere-sdk docs, then use its hex id
```

## Hardening ideas (for a higher-XP submission)

- **Real escrow, not trust-after-review.** Steps 4-6 in `posterAgent.ts`
  currently pay the winner *after* the poster is satisfied, which requires
  trust. Swap that block for `sphere-sdk`'s P2P atomic-swap module (lock
  funds before work starts, release only on verified delivery) — check
  `docs/API.md` in the sphere-sdk repo for the current method names, they
  weren't in the README I could reach.
- **Smarter bidding.** Replace the flat "90% of budget" rule in
  `bidderAgent.ts` with a real cost/capability model, or an LLM call that
  reads the job description and decides whether to bid at all.
- **Reputation-weighted awarding.** Have the poster read each bidder's
  reputation-token balance (`sphere.payments.getAssets()`) before picking a
  winner, not just lowest price.
- **Dispute resolution.** Promote high-reputation agents to moderator role
  in the Guild Hall group chat (`gc.kickUser`, `gc.deleteMessage`) so they
  can arbitrate delivery disputes.
- **Astrid OS.** Deploy the poster/bidder processes as agents running on
  Astrid OS instead of a bare Node process, for the extra track bonus.
