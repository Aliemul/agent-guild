import 'dotenv/config';
import { Sphere, randomUUID } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { JobPosting, JobBid, JobAward, JobDelivery, parseGuildMessage } from './types.js';

const JOB_BUDGET = '2000000';
const JOB_COIN = 'UCT';
const BID_WINDOW_MS = 8_000; // shorter for a snappy demo recording

async function bootDemoAgent(agentId: 'poster' | 'bidder', nametag: string, mnemonic?: string) {
  const apiKey = process.env.SPHERE_TESTNET_API_KEY;
  if (!apiKey) throw new Error('Set SPHERE_TESTNET_API_KEY in .env');

  const providers = createNodeProviders({
    network: 'testnet',
    dataDir: `./.wallets/${agentId}`,
    tokensDir: `./.wallets/${agentId}/tokens`,
    oracle: { apiKey },
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: 'testnet',
    autoGenerate: true,
    mnemonic,
    nametag,
    groupChat: true,
    dmSince: Math.floor(Date.now() / 1000),
  });

  if (created && generatedMnemonic) {
    console.log(`[${agentId}] NEW WALLET — save to .env if you want it to persist:`);
    console.log(`  ${generatedMnemonic}`);
  }
  console.log(`[${agentId}] ready → @${sphere.identity?.nametag}`);
  return sphere;
}

async function main() {
  console.log('=== Agent Guild — live demo ===\n');
  const demoStartMs = Date.now();

  const bidder = await bootDemoAgent('bidder', process.env.BIDDER_NAMETAG || 'guild-bidder-01', process.env.BIDDER_MNEMONIC);
  const poster = await bootDemoAgent('poster', process.env.POSTER_NAMETAG || 'guild-poster', process.env.POSTER_MNEMONIC);

  const bidderGc = bidder.groupChat!;
  const posterGc = poster.groupChat!;
  await bidderGc.connect();
  await posterGc.connect();

  let groupId = process.env.GUILD_GROUP_ID;
  if (!groupId) {
    const group = await posterGc.createGroup({
      name: 'Agent Guild Hall',
      description: 'Job board for autonomous agents.',
    });
    groupId = group.id;
    console.log(`\n[poster] Created Guild Hall: ${groupId} (save as GUILD_GROUP_ID in .env)\n`);
  } else {
    await posterGc.joinGroup(groupId);
  }
  await bidderGc.joinGroup(groupId);

 const seenJobIds = new Set<string>();

  // --- Bidder: watch for jobs, bid, deliver ---
  bidderGc.onMessage(async (message) => {
    // Ignore stale messages replayed from group history — only react to
    // jobs posted after this demo run started.
    const tsMs = message.timestamp < 1e12 ? message.timestamp * 1000 : message.timestamp;
    if (tsMs < demoStartMs) return;

    const parsed = parseGuildMessage(message.content);
    if (parsed?.tag !== 'GUILD_JOB') return;
    const job = parsed as JobPosting;
    seenJobIds.add(job.jobId);
    const price = (BigInt(job.budget) * 90n / 100n).toString();
    console.log(`[bidder] Saw job "${job.title}" — bidding ${price} ${job.coinId}`);
    await bidder.communications.sendDM(`@${job.postedBy}`, JSON.stringify({
      tag: 'GUILD_BID', jobId: job.jobId, bidder: bidder.identity!.nametag!, price, etaSeconds: 60,
    } as JobBid));
  });

  bidder.communications.onDirectMessage(async (msg) => {
    const parsed = parseGuildMessage(msg.content);
    if (parsed?.tag !== 'GUILD_AWARD') return;
    const award = parsed as JobAward;
    if (!seenJobIds.has(award.jobId)) return; // stale award from an earlier session
    console.log(`[bidder] Won job ${award.jobId}! Working...`);
    await new Promise((res) => setTimeout(res, 2000));
    await bidder.communications.sendDM(`@${msg.senderNametag}`, JSON.stringify({
      tag: 'GUILD_DELIVERY', jobId: award.jobId, resultUrl: 'https://example.com/results/' + award.jobId,
    } as JobDelivery));
    console.log('[bidder] Delivered. Waiting to get paid...');
  });

  // --- Poster: post a job, collect bids, award, wait for delivery, pay ---
  const job: JobPosting = {
    tag: 'GUILD_JOB',
    jobId: randomUUID(),
    title: 'Summarize 50 news articles into 3 bullet points each',
    description: 'Demo job for the Sphere Call for Builders submission.',
    budget: JOB_BUDGET,
    coinId: JOB_COIN,
    deadlineTs: Math.floor(Date.now() / 1000) + 3600,
    postedBy: poster.identity!.nametag!,
  };

  const bids: JobBid[] = [];
  const unsubBids = poster.communications.onDirectMessage((msg) => {
    const parsed = parseGuildMessage(msg.content);
    if (parsed?.tag === 'GUILD_BID' && parsed.jobId === job.jobId) {
      console.log(`[poster] Bid from @${parsed.bidder}: ${parsed.price} ${job.coinId}`);
      bids.push(parsed);
    }
  });

  await posterGc.sendMessage(groupId, JSON.stringify(job));
  console.log(`\n[poster] Posted job ${job.jobId} — budget ${job.budget} ${job.coinId}. Collecting bids for ${BID_WINDOW_MS / 1000}s...\n`);

  await new Promise((res) => setTimeout(res, BID_WINDOW_MS));
  unsubBids();

  if (bids.length === 0) {
    console.log('[poster] No bids received — check both agents joined the same GUILD_GROUP_ID.');
    process.exit(1);
  }

  const winner = [...bids].sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)))[0];
  console.log(`\n[poster] Awarding job to @${winner.bidder} at ${winner.price} ${job.coinId}`);
  await poster.communications.sendDM(`@${winner.bidder}`, JSON.stringify({
    tag: 'GUILD_AWARD', jobId: job.jobId, winner: winner.bidder,
  } as JobAward));

  await new Promise<void>((resolve) => {
    const unsub = poster.communications.onDirectMessage(async (msg) => {
      const parsed = parseGuildMessage(msg.content);
      if (parsed?.tag !== 'GUILD_DELIVERY' || parsed.jobId !== job.jobId) return;
      console.log(`[poster] Delivery received: ${parsed.resultUrl}`);
      const pay = await poster.payments.send({ recipient: `@${winner.bidder}`, amount: winner.price, coinId: job.coinId });
      const ok = pay.status === 'completed';
      console.log(`\n[poster] Payment ${ok ? 'SETTLED ✅' : 'pending: ' + pay.status} — job complete end to end.\n`);
      unsub();
      resolve();
    });
  });

  console.log('=== Demo complete ===');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});