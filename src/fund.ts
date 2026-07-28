import 'dotenv/config';
import { getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';
import { bootAgent } from './config.js';

async function main() {
  const agentId = process.argv[2];
  if (agentId !== 'poster' && agentId !== 'bidder') {
    throw new Error('Usage: npm run fund -- poster   OR   npm run fund -- bidder');
  }

  const mnemonic = agentId === 'poster' ? process.env.POSTER_MNEMONIC : process.env.BIDDER_MNEMONIC;
  const nametag = agentId === 'poster' ? process.env.POSTER_NAMETAG : process.env.BIDDER_NAMETAG;

  const sphere = await bootAgent({ agentId, nametag, mnemonic });

  const coinId = getCoinIdBySymbol('UCT');
  if (!coinId) throw new Error('Could not resolve coinId for UCT');

  const result = await sphere.payments.mintFungibleToken(coinId, 10_000_000n);
  if (result.success) {
    console.log(`[fund] Minted 10,000,000 UCT into ${agentId}'s wallet. Token: ${result.tokenId}`);
  } else {
    console.error('[fund] Mint failed:', result.error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});