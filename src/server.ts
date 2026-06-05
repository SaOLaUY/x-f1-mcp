import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Scraper, SearchMode } from "agent-twitter-client";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
  return value;
}

async function buildScraper(): Promise<Scraper> {
  const scraper = new Scraper();

  const authToken = getEnv("X_AUTH_TOKEN");
  const ct0 = getEnv("X_CT0");

  // X operates on x.com — both domains needed for full auth
  await scraper.setCookies([
    `auth_token=${authToken}; Domain=.x.com; Path=/; Secure; HttpOnly; SameSite=None`,
    `auth_token=${authToken}; Domain=.twitter.com; Path=/; Secure; HttpOnly; SameSite=None`,
    `ct0=${ct0}; Domain=.x.com; Path=/; Secure; SameSite=Lax`,
    `ct0=${ct0}; Domain=.twitter.com; Path=/; Secure; SameSite=Lax`,
  ]);

  console.log("[x-f1-mcp] Cookies set, scraper ready ✓");
  return scraper;
}

// ─── Shared types ─────────────────────────────────────────────────────────────

type TweetSummary = {
  id: string;
  text: string;
  username: string;
  name: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  url: string;
  isVerified: boolean;
};

type ProfileSummary = {
  username: string;
  name: string;
  bio: string;
  followersCount: number;
  followingCount: number;
  tweetsCount: number;
  verified: boolean;
  url: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
  };
}

async function safeTool<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonContent({ error: true, message });
  }
}

function mapTweet(tweet: Record<string, unknown>): TweetSummary {
  return {
    id: String(tweet.id ?? ""),
    text: String(tweet.text ?? tweet.fullText ?? ""),
    username: String((tweet.user as Record<string, unknown>)?.username ?? tweet.username ?? ""),
    name: String((tweet.user as Record<string, unknown>)?.name ?? tweet.name ?? ""),
    createdAt: String(tweet.timeParsed ?? tweet.createdAt ?? ""),
    likes: Number(tweet.likes ?? tweet.favoriteCount ?? 0),
    retweets: Number(tweet.retweets ?? tweet.retweetCount ?? 0),
    replies: Number(tweet.replies ?? tweet.replyCount ?? 0),
    url: tweet.permanentUrl
      ? String(tweet.permanentUrl)
      : `https://x.com/i/web/status/${tweet.id}`,
    isVerified: Boolean((tweet.user as Record<string, unknown>)?.isBlueVerified ?? false)
  };
}

async function collectTweets(
  gen: AsyncGenerator<unknown>,
  limit: number
): Promise<TweetSummary[]> {
  const results: TweetSummary[] = [];
  for await (const tweet of gen) {
    results.push(mapTweet(tweet as Record<string, unknown>));
    if (results.length >= limit) break;
  }
  return results;
}

// ─── F1 context ───────────────────────────────────────────────────────────────

const F1_ACCOUNTS = [
  "F1",
  "AlpineF1Team",
  "francocolapinto",
  "PierreGASLY",
  "MercedesAMGF1",
  "ScuderiaFerrari",
  "McLarenF1",
  "redbullracing",
  "WilliamsRacing",
  "F1Bites",
  "autosport",
  "motorsport",
  "SkySportsF1",
  "F1i_fr",
  "RacingNews365"
];

const F1_QUALIFYING_KEYWORDS = [
  "qualy", "qualifying", "clasificacion", "pole position",
  "Q1", "Q2", "Q3", "fastest lap", "vuelta rapida",
  "tiempos", "sector", "grid"
];

// ─── Server factory ───────────────────────────────────────────────────────────

export async function createServer(): Promise<McpServer> {
  const scraper = await buildScraper();

  const server = new McpServer({
    name: "x-f1-mcp",
    version: "0.1.0"
  });

  // ── TOOL: search_tweets ───────────────────────────────────────────────────
  server.registerTool(
    "search_tweets",
    {
      description:
        "Search recent tweets by keyword or phrase. Perfect for monitoring live F1 events, qualifying times, race results, and paddock news in real time.",
      inputSchema: {
        query: z.string().describe(
          "Search query. Examples: 'colapinto monaco qualy', 'alpine F1 monaco 2026', '#MonacoGP'"
        ),
        limit: z.number().min(1).max(50).default(20).describe(
          "Max tweets to return (1-50). Default 20."
        ),
        mode: z.enum(["latest", "top"]).default("latest").describe(
          "'latest' for real-time monitoring during live events. 'top' for most engaged posts."
        )
      }
    },
    async ({ query, limit, mode }) =>
      safeTool(async () => {
        const searchMode = mode === "top" ? SearchMode.Top : SearchMode.Latest;
        const gen = scraper.searchTweets(query, limit, searchMode);
        const tweets = await collectTweets(gen as AsyncGenerator<unknown>, limit);
        return jsonContent({ query, mode, count: tweets.length, tweets });
      })
  );

  // ── TOOL: get_user_tweets ─────────────────────────────────────────────────
  server.registerTool(
    "get_user_tweets",
    {
      description:
        "Get the most recent tweets from a specific X account. Useful for monitoring @F1, @AlpineF1Team, @francocolapinto, or rival YouTube channels that announce their videos on X.",
      inputSchema: {
        username: z.string().describe(
          "X username without @. Examples: 'F1', 'AlpineF1Team', 'francocolapinto'"
        ),
        limit: z.number().min(1).max(50).default(10).describe(
          "Max tweets to return (1-50). Default 10."
        )
      }
    },
    async ({ username, limit }) =>
      safeTool(async () => {
        const gen = scraper.getTweets(username, limit);
        const tweets = await collectTweets(gen as AsyncGenerator<unknown>, limit);
        return jsonContent({ username, count: tweets.length, tweets });
      })
  );

  // ── TOOL: get_user_profile ────────────────────────────────────────────────
  server.registerTool(
    "get_user_profile",
    {
      description:
        "Get public profile information for any X account: bio, follower count, tweet count, and verification status.",
      inputSchema: {
        username: z.string().describe("X username without @.")
      }
    },
    async ({ username }) =>
      safeTool(async () => {
        const profile = await scraper.getProfile(username);
        const summary: ProfileSummary = {
          username: profile.username ?? username,
          name: profile.name ?? "",
          bio: profile.biography ?? "",
          followersCount: profile.followersCount ?? 0,
          followingCount: profile.followingCount ?? 0,
          tweetsCount: profile.tweetsCount ?? 0,
          verified: profile.isBlueVerified ?? false,
          url: `https://x.com/${username}`
        };
        return jsonContent(summary);
      })
  );

  // ── TOOL: monitor_f1_live ─────────────────────────────────────────────────
  server.registerTool(
    "monitor_f1_live",
    {
      description:
        "Monitor live F1 session tweets from official accounts and journalists. Returns the latest tweets from key F1 accounts filtered by session-related keywords. Ideal during qualifying, practice, or race.",
      inputSchema: {
        session: z.string().describe(
          "Session name for context. Examples: 'Monaco GP Qualifying 2026', 'Monaco FP2', 'Monaco GP Race'"
        ),
        limit: z.number().min(1).max(30).default(15).describe(
          "Max tweets per account (1-30). Default 15."
        ),
        accounts: z.array(z.string()).optional().describe(
          "Override the default F1 account list. Omit to use all default accounts."
        )
      }
    },
    async ({ session, limit, accounts }) =>
      safeTool(async () => {
        const targetAccounts = accounts ?? F1_ACCOUNTS;
        const keywordFilter = [...F1_QUALIFYING_KEYWORDS, session.toLowerCase()];

        const results = await Promise.allSettled(
          targetAccounts.map(async (username) => {
            const gen = scraper.getTweets(username, limit);
            const tweets = await collectTweets(gen as AsyncGenerator<unknown>, limit);
            const filtered = tweets.filter((t) =>
              keywordFilter.some((kw) => t.text.toLowerCase().includes(kw.toLowerCase()))
            );
            return { username, filtered };
          })
        );

        const feed = results
          .filter((r): r is PromiseFulfilledResult<{ username: string; filtered: TweetSummary[] }> =>
            r.status === "fulfilled"
          )
          .flatMap((r) => r.value.filtered)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return jsonContent({ session, accountsMonitored: targetAccounts.length, count: feed.length, feed });
      })
  );

  // ── TOOL: search_competitor_content ───────────────────────────────────────
  server.registerTool(
    "search_competitor_content",
    {
      description:
        "Search what competitor YouTube channels are posting about on X. Detects uncovered topics by comparing competitor announcements with a given subject.",
      inputSchema: {
        topic: z.string().describe(
          "Topic to check coverage for. Examples: 'colapinto monaco qualifying', 'alpine FIA restriction monaco'"
        ),
        competitorAccounts: z.array(z.string()).default([
          "F1conMate", "MotorlandF1", "f1noticias_es", "RacingNews365", "autosport"
        ]).describe(
          "X handles of competitor channels/accounts to scan."
        ),
        limit: z.number().min(1).max(20).default(10).describe(
          "Max tweets per account."
        )
      }
    },
    async ({ topic, competitorAccounts, limit }) =>
      safeTool(async () => {
        const topicWords = topic.toLowerCase().split(" ");

        const results = await Promise.allSettled(
          competitorAccounts.map(async (username) => {
            const gen = scraper.getTweets(username, limit);
            const tweets = await collectTweets(gen as AsyncGenerator<unknown>, limit);
            const covered = tweets.filter((t) =>
              topicWords.some((word) => t.text.toLowerCase().includes(word))
            );
            return { username, covered, total: tweets.length };
          })
        );

        const coverage = results
          .filter((r): r is PromiseFulfilledResult<{ username: string; covered: TweetSummary[]; total: number }> =>
            r.status === "fulfilled"
          )
          .map((r) => ({
            account: r.value.username,
            hasCovered: r.value.covered.length > 0,
            coverageCount: r.value.covered.length,
            relevantTweets: r.value.covered
          }));

        const uncoveredBy = coverage.filter((c) => !c.hasCovered).map((c) => c.account);
        const coveredBy = coverage.filter((c) => c.hasCovered).map((c) => c.account);

        return jsonContent({
          topic,
          uncoveredBy,
          coveredBy,
          gapDetected: uncoveredBy.length > 0,
          details: coverage
        });
      })
  );

  // ── TOOL: get_trending_f1 ─────────────────────────────────────────────────
  server.registerTool(
    "get_trending_f1",
    {
      description:
        "Search top trending tweets about F1 right now. Returns the most liked/retweeted F1 posts to detect hot topics for video ideas.",
      inputSchema: {
        region: z.enum(["global", "argentina", "spain"]).default("argentina").describe(
          "Region focus for trend detection."
        ),
        limit: z.number().min(1).max(30).default(20).describe(
          "Max tweets to return."
        )
      }
    },
    async ({ region, limit }) =>
      safeTool(async () => {
        const queries: Record<string, string> = {
          global: "F1 OR \"Formula 1\" OR Colapinto",
          argentina: "Colapinto OR \"F1 argentina\" OR \"formula 1\" -filter:retweets",
          spain: "F1 OR \"Formula 1\" OR Colapinto lang:es -filter:retweets"
        };

        const query = queries[region];
        const gen = scraper.searchTweets(query, limit, SearchMode.Top);
        const tweets = await collectTweets(gen as AsyncGenerator<unknown>, limit);

        const sorted = tweets.sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));

        return jsonContent({ region, query, count: sorted.length, tweets: sorted });
      })
  );

  // ── TOOL: get_tweet_by_id ─────────────────────────────────────────────────
  server.registerTool(
    "get_tweet_by_id",
    {
      description: "Fetch a single tweet by its ID or full URL.",
      inputSchema: {
        tweetId: z.string().describe(
          "Tweet ID (numeric string) or full x.com/twitter.com URL."
        )
      }
    },
    async ({ tweetId }) =>
      safeTool(async () => {
        const id = tweetId.includes("x.com") || tweetId.includes("twitter.com")
          ? tweetId.split("/").pop()!
          : tweetId;
        const tweet = await scraper.getTweet(id);
        if (!tweet) return jsonContent({ error: true, message: "Tweet not found" });
        return jsonContent(mapTweet(tweet as unknown as Record<string, unknown>));
      })
  );

  return server;
}
