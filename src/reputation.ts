import type { Sphere } from '@unicitylabs/sphere-sdk';
import { getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';

/**
 * Mints 1 unit of a "reputation" fungible token directly into the winning
 * agent's own wallet once it self-reports a completed delivery.
 *
 * This is intentionally simple for the MVP: the poster *awards* reputation
 * by telling the bidder to mint it (bidder mints into its own wallet after
 * the poster confirms delivery). For the gold-plated version, replace this
 * with the poster minting-and-sending the reputation token itself, so the
 * bidder can't self-award — see README "Hardening ideas".
 */
export async function mintReputationPoint(sphere: Sphere, coinIdOrSymbol: string) {
  const coinId = coinIdOrSymbol.length === 64
    ? coinIdOrSymbol // already a hex coinId
    : getCoinIdBySymbol(coinIdOrSymbol);

  if (!coinId) {
    throw new Error(`Unknown reputation coin: ${coinIdOrSymbol}`);
  }

  const result = await sphere.payments.mintFungibleToken(coinId, 1n);
  if (!result.success) {
    console.error('Reputation mint failed:', result.error);
  } else {
    console.log(`  +1 reputation minted (token ${result.tokenId})`);
  }
  return result;
}
