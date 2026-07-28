import 'dotenv/config';
import { randomUUID } from '@unicitylabs/sphere-sdk';
import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { JobPosting, JobBid, JobDelivery, parseGuildMessage } from '../types.js';

const JOB_BUDGET = '2000000';        // smallest-unit string
const JOB_COIN = 'UCT';
const BID_WINDOW_MS = 20_000;        // how long to collect bids before deciding

async function main() {
  const apiKey = process.env.SPHERE_TESTNET_API_KEY;
  if (!apiKey) throw new Error('Set SPHERE_TESTNET_API_KEY in .env');

  const providers = createNodeProviders({
    network: 'testnet',
    dataDir: './.wallets/poster',
    tokensDir: './.wallets/poster/tokens',
    oracle: { apiKey },
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: 'testnet',
    autoGenerate: true,
    mnemonic: process.env.POSTER_MNEMONIC,
    nametag: process.env.POSTER_NAMETAG || 'guild-poster',
    groupChat: true, // enables sphere.groupChat (NIP-29)
  });

  if (created && generatedMnemonic) {
    console.log('NEW POSTER WALLET — save to .env as POSTER_MNEMONIC:');
    console.log(`  ${generatedMnemonic}`);
  }
  console.log(`[poster] ready → @${sphere.identity?.nametag} · ${sphere.identity?.directAddress}`);

  const gc = sphere.groupChat!;
  await gc.connect();

  // 1. Get or create the Guild Hall — the public job board.
  let groupId = process.env.GUILD_GROUP_ID;
  if (!groupId) {
    const group = await gc.createGroup({
      name: 'Agent Guild Hall',
      description: 'Job board for autonomous agents — post work, bid, get paid.',
    });
    groupId = group.id;
    console.log(`[poster] Created Guild Hall. Set this in .env for every agent:`);
    console.log(`  GUILD_GROUP_ID=${groupId}`);
  } else {
    await gc.joinGroup(groupId);
  }

  // 2. Post a job.
  const job: JobPosting = {
    tag: 'GUILD_JOB',
    jobId: randomUUID(),
    title: 'Summarize 50 news articles into 3 bullet points each',
    description: 'Input set will be shared via DM to the winning bidder.',
    budget: JOB_BUDGET,
    coinId: JOB_COIN,
    deadlineTs: Math.floor(Date.now() / 1000) + 3600,
    postedBy: sphere.identity!.nametag!,
  };
  await gc.sendMessage(groupId, JSON.stringify(job));
  console.log(`[poster] Posted job ${job.jobId} — budget ${job.budget} ${job.coinId}. Collecting bids for ${BID_WINDOW_MS / 1000}s...`);

  // 3. Collect bids over DM.
  const bids: JobBid[] = [];
  const unsubscribe = sphere.communications.onDirectMessage((msg) => {
    const parsed = parseGuildMessage(msg.content);
    if (parsed?.tag === 'GUILD_BID' && parsed.jobId === job.jobId) {
      console.log(`[poster] Bid from @${parsed.bidder}: ${parsed.price} ${job.coinId}, eta ${parsed.etaSeconds}s`);
      bids.push(parsed);
    }
  });

  await new Promise((res) => setTimeout(res, BID_WINDOW_MS));
  unsubscribe();

  if (bids.length === 0) {
    console.log('[poster] No bids received. Exiting — try running the bidder agent first.');
    return;
  }

  // 4. Pick the cheapest bid (swap in a smarter scoring function here — e.g.
  //    weight price against the bidder's reputation-token balance).
  const winner = [...bids].sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)))[0];
  console.log(`[poster] Awarding job to @${winner.bidder} at ${winner.price} ${job.coinId}`);
  await sphere.communications.sendDM(`@${winner.bidder}`, JSON.stringify({
    tag: 'GUILD_AWARD', jobId: job.jobId, winner: winner.bidder,
  }));

  // 5. Wait for delivery, then pay.
  //
  //    MVP NOTE: this pays via a plain sphere.payments.send() call once the
  //    poster is satisfied with the delivered work — i.e. trust-after-review,
  //    not trustless escrow. For the "gold-plated" version, replace steps 4-6
  //    with sphere.swap's atomic-swap escrow (lock funds *before* work starts,
  //    release only on delivery) — check docs/API.md in sphere-sdk for the
  //    current swap method signatures before wiring it in.
  console.log('[poster] Waiting for delivery...');
  await new Promise<void>((resolve) => {
    const unsub = sphere.communications.onDirectMessage(async (msg) => {
      const parsed = parseGuildMessage(msg.content);
      if (parsed?.tag === 'GUILD_DELIVERY' && parsed.jobId === job.jobId) {
        console.log(`[poster] Delivery received: ${parsed.resultUrl}`);
        const pay = await sphere.payments.send({
          recipient: `@${winner.bidder}`,
          amount: winner.price,
          coinId: job.coinId,
        });
        const ok = pay.status === 'completed';
        console.log(`[poster] Payment ${ok ? 'settled ✅' : 'still pending: ' + pay.status} (delivery: ${pay.deliveryState})`);
        unsub();
        resolve();
      }
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
