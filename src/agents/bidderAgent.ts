import 'dotenv/config';
import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { JobPosting, JobAward, parseGuildMessage } from '../types.js';
import { mintReputationPoint } from '../reputation.js';

async function main() {
  const apiKey = process.env.SPHERE_TESTNET_API_KEY;
  if (!apiKey) throw new Error('Set SPHERE_TESTNET_API_KEY in .env');
  const groupId = process.env.GUILD_GROUP_ID;
  if (!groupId) throw new Error('Set GUILD_GROUP_ID in .env (run the poster agent first)');

  const providers = createNodeProviders({
    network: 'testnet',
    dataDir: './.wallets/bidder',
    tokensDir: './.wallets/bidder/tokens',
    oracle: { apiKey },
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: 'testnet',
    autoGenerate: true,
    mnemonic: process.env.BIDDER_MNEMONIC,
    nametag: process.env.BIDDER_NAMETAG || 'guild-bidder-01',
    groupChat: true,
  });

  if (created && generatedMnemonic) {
    console.log('NEW BIDDER WALLET — save to .env as BIDDER_MNEMONIC:');
    console.log(`  ${generatedMnemonic}`);
  }
  console.log(`[bidder] ready → @${sphere.identity?.nametag} · ${sphere.identity?.directAddress}`);

  const gc = sphere.groupChat!;
  await gc.connect();
  await gc.joinGroup(groupId);
  console.log('[bidder] Watching Guild Hall for jobs...');

  gc.onMessage(async (message) => {
    const parsed = parseGuildMessage(message.content);
    if (parsed?.tag !== 'GUILD_JOB') return;
    const job = parsed as JobPosting;

    // Simple bidding strategy: undercut the budget by 10%. Swap this for
    // real reasoning (LLM call, cost model, current workload) as your
    // "gold-plated" upgrade.
    const price = (BigInt(job.budget) * 90n / 100n).toString();
    console.log(`[bidder] New job "${job.title}" — bidding ${price} ${job.coinId}`);
    await sphere.communications.sendDM(`@${job.postedBy}`, JSON.stringify({
      tag: 'GUILD_BID',
      jobId: job.jobId,
      bidder: sphere.identity!.nametag!,
      price,
      etaSeconds: 300,
    }));
  });

  sphere.communications.onDirectMessage(async (msg) => {
    const parsed = parseGuildMessage(msg.content);
    if (parsed?.tag !== 'GUILD_AWARD') return;
    const award = parsed as JobAward;
    console.log(`[bidder] Won job ${award.jobId}! Doing the work...`);

    // Simulate doing the work.
    await new Promise((res) => setTimeout(res, 3000));

    await sphere.communications.sendDM(msg.senderNametag ? `@${msg.senderNametag}` : msg.senderPubkey, JSON.stringify({
      tag: 'GUILD_DELIVERY',
      jobId: award.jobId,
      resultUrl: 'https://example.com/results/' + award.jobId,
      note: 'Done — 50/50 summaries complete.',
    }));
    console.log('[bidder] Delivery sent. Waiting to get paid...');

    // Self-mint a reputation point once work is out the door. See
    // reputation.ts for why this is a placeholder, not the hardened version.
    const coin = process.env.REPUTATION_COIN_ID;
    if (coin) await mintReputationPoint(sphere, coin);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
