import 'dotenv/config';
import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';

/**
 * Boots a Sphere-backed agent identity on testnet2.
 *
 * Each agent gets its own data directory (so multiple agents can run
 * side-by-side on one machine) and, if a mnemonic is supplied via env,
 * a stable identity across restarts (needed so its nametag doesn't get
 * "already taken" errors — see sphere-sdk README > Nametags).
 */
export async function bootAgent(opts: {
  agentId: string;       // e.g. "poster", "bidder-01" — used for the data dir
  nametag?: string;      // Unicity ID to register, e.g. "guild-poster"
  mnemonic?: string;     // fixed mnemonic from env, or omit to auto-generate
}) {
  const apiKey = process.env.SPHERE_TESTNET_API_KEY;
  if (!apiKey) {
    throw new Error('Set SPHERE_TESTNET_API_KEY in .env (see .env.example)');
  }

  const providers = createNodeProviders({
    network: 'testnet',
    dataDir: `./.wallets/${opts.agentId}`,
    tokensDir: `./.wallets/${opts.agentId}/tokens`,
    oracle: { apiKey },
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: 'testnet',
    autoGenerate: true,
    mnemonic: opts.mnemonic || undefined,
    nametag: opts.nametag,
  });

  if (created && generatedMnemonic) {
    console.log(`[${opts.agentId}] NEW WALLET — save this mnemonic in .env:`);
    console.log(`  ${generatedMnemonic}`);
  }

  console.log(`[${opts.agentId}] ready → ${sphere.identity?.nametag ?? '(no nametag)'} · ${sphere.identity?.directAddress}`);

  return sphere;
}
