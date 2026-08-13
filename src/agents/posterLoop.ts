import 'dotenv/config';
import { Sphere, randomUUID, getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { JobPosting, JobBid, JobDelivery, parseGuildMessage } from '../types.js';

const JOB_BUDGET = '2000000';
const JOB_COIN = 'UCT';
const BID_WINDOW_MS = 30_000;
const POST_INTERVAL_MS = 10 * 60 * 1000;
const TOPUP_AMOUNT = 10_000_000n;

const JOB_TEMPLATES = [
  'Summarize 50 news articles into 3 bullet points each',
  'Translate a 500-word product description to Spanish',
  'Classify 100 support tickets by urgency',
  'Extract structured data from 20 invoices',
];

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
    groupChat: true,
  });

  if (created && generatedMnemonic) {
    console.log('NEW POSTER WALLET - save to .env as POSTER_MNEMONIC:');
    console.log(`  ${generatedMnemonic}`);
  }
  console.log(`[poster-loop] ready -> @${sphere.identity?.nametag}`);

  const gc = sphere.groupChat!;
  await gc.connect();

  let groupId = process.env.GUILD_GROUP_ID;
  if (!groupId) {
    const group = await gc.createGroup({ name: 'Agent Guild Hall', description: 'Job board for autonomous agents.' });
    groupId = group.id;
    console.log(`[poster-loop] Created Guild Hall: ${groupId} (save as GUILD_GROUP_ID)`);
  } else {
    await gc.joinGroup(groupId);
  }

  const coinId = getCoinIdBySymbol(JOB_COIN);

  async function topUp() {
    if (!coinId) return;
    try {
      const result = await sphere.payments.mintFungibleToken(coinId, TOPUP_AMOUNT);
      if (result.success) {
        console.log(`[poster-loop] Topped up wallet: +${TOPUP_AMOUNT} ${JOB_COIN}`);
      } else {
        console.error('[poster-loop] Top-up mint failed:', result.error);
      }
    } catch (err) {
      console.error('[poster-loop] Top-up mint threw:', err);
    }
  }

  async function postOneJob() {
    // Testnet tokens are free - top up before every job so the demo
    // never runs dry, regardless of how many jobs have paid out already.
    await topUp();

    const title = JOB_TEMPLATES[Math.floor(Math.random() * JOB_TEMPLATES.length)];
    const job: JobPosting = {
      tag: 'GUILD_JOB',
      jobId: randomUUID(),
      title,
      description: 'Auto-posted by Agent Guild to keep the Guild Hall active for visiting builders.',
      budget: JOB_BUDGET,
      coinId: JOB_COIN,
      deadlineTs: Math.floor(Date.now() / 1000) + 3600,
      postedBy: sphere.identity!.nametag!,
    };

    const bids: JobBid[] = [];
    const unsubBids = sphere.communications.onDirectMessage((msg) => {
      const parsed = parseGuildMessage(msg.content);
      if (parsed?.tag === 'GUILD_BID' && parsed.jobId === job.jobId) bids.push(parsed);
    });

    await gc.sendMessage(groupId!, JSON.stringify(job));
    console.log(`[poster-loop] Posted "${title}" (${job.jobId}). Waiting ${BID_WINDOW_MS / 1000}s for bids...`);

    await new Promise((res) => setTimeout(res, BID_WINDOW_MS));
    unsubBids();

    if (bids.length === 0) {
      console.log('[poster-loop] No bids this round.');
      return;
    }

    const winner = [...bids].sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)))[0];
    console.log(`[poster-loop] Awarding to @${winner.bidder} at ${winner.price} ${job.coinId}`);
    await sphere.communications.sendDM(`@${winner.bidder}`, JSON.stringify({ tag: 'GUILD_AWARD', jobId: job.jobId, winner: winner.bidder }));

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { unsub(); resolve(); }, 60_000);
      const unsub = sphere.communications.onDirectMessage(async (msg) => {
        const parsed = parseGuildMessage(msg.content);
        if (parsed?.tag !== 'GUILD_DELIVERY' || parsed.jobId !== job.jobId) return;
        clearTimeout(timeout);
        console.log(`[poster-loop] Delivery received: ${(parsed as JobDelivery).resultUrl}`);
        try {
          const pay = await sphere.payments.send({ recipient: `@${winner.bidder}`, amount: winner.price, coinId: job.coinId });
          console.log(`[poster-loop] Payment ${pay.status === 'completed' ? 'SETTLED' : pay.status}`);
        } catch (err) {
          console.error('[poster-loop] Payment failed (will retry next cycle with fresh top-up):', err instanceof Error ? err.message : err);
        }
        unsub();
        resolve();
      });
    });
  }

  while (true) {
    try {
      await postOneJob();
    } catch (err) {
      console.error('[poster-loop] error in job cycle (continuing):', err instanceof Error ? err.message : err);
    }
    await new Promise((res) => setTimeout(res, POST_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});