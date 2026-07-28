/**
 * These are plain JSON payloads carried as the `content` string of
 * Sphere group-chat messages (job board) and DMs (negotiation).
 * Prefixing with a tag makes them easy to tell apart from normal chat.
 */

export interface JobPosting {
  tag: 'GUILD_JOB';
  jobId: string;
  title: string;
  description: string;
  budget: string;      // smallest-unit string, e.g. "5000000"
  coinId: string;       // e.g. 'UCT'
  deadlineTs: number;   // unix seconds
  postedBy: string;     // nametag of the poster
}

export interface JobBid {
  tag: 'GUILD_BID';
  jobId: string;
  bidder: string;       // nametag of the bidder
  price: string;        // smallest-unit string, must be <= job.budget
  etaSeconds: number;
  note?: string;
}

export interface JobAward {
  tag: 'GUILD_AWARD';
  jobId: string;
  winner: string;       // nametag of the winning bidder
}

export interface JobDelivery {
  tag: 'GUILD_DELIVERY';
  jobId: string;
  resultUrl: string;    // where the poster can inspect the work
  note?: string;
}

export function parseGuildMessage(content: string):
  | JobPosting | JobBid | JobAward | JobDelivery | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.tag === 'string' && parsed.tag.startsWith('GUILD_')) {
      return parsed;
    }
  } catch {
    // not a guild message — ignore
  }
  return null;
}
