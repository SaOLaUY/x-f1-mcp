import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Scraper, SearchMode } from "agent-twitter-client";

function getEnv(key: string, required = true): string {
  const value = process.env[key];
  if (!value && required) {
    console.error(`[x-f1-mcp] Missing env var: ${key}`);
    process.exit(1);
  }
  return value ?? "";
}

async function buildScraper(): Promise<Scraper> {
  const scraper = new Scraper();

  const authToken = getEnv("X_AUTH_TOKEN");
  const ct0 = getEnv("X_CT0");
  const twid = getEnv("X_TWID");
  const twitterSess = getEnv("X_TWITTER_SESS", false);
  const lang = getEnv("X_LANG", false) || "es";

  // Pass cookies as objects — tough-cookie stores them correctly for both
  // twitter.com and the internal getCookieValue('ct0') lookup that builds x-csrf-token
  const cookies = [
    { key: "auth_token", value: authToken, domain: "twitter.com", path: "/", secure: true, httpOnly: true },
    { key: "ct0",        value: ct0,       domain: "twitter.com", path: "/", secure: true, httpOnly: false },
    { key: "twid",       value: twid,      domain: "twitter.com", path: "/", secure: true, httpOnly: true },
    { key: "lang",       value: lang,      domain: "twitter.com", path: "/", secure: true, httpOnly: false },
  ] as Parameters<typeof scraper.setCookies>[0];

  if (twitterSess) {
    (cookies as Array<Record<string, unknown>>).push(
      { key: "_twitter_sess", value: twitterSess, domain: "twitter.com", path: "/", secure: true, httpOnly: true }
    );
  }

  await scraper.setCookies(cookies);

  try {
    const isLoggedIn = await scraper.isLoggedIn();
    console.log(`[x-f1-mcp] Cookies set, loggedIn=${isLoggedIn} ✓`);
  } catch (error) {
    console.warn("[x-f1-mcp] isLoggedIn check failed:", error);
  }

  return scraper;
}

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

function jsonContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
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
    url: tweet.permanentUrl ? String(tweet.permanentUrl) : `https://x.com/i/web/status/${tweet.id}`,
    isVerified: Boolean((tweet.user as Record<string, unknown>)?.isBlueVerified ?? false)
  };
}

async function collectTweets(gen: AsyncGenerator<unknown>, limit: number): Promise<TweetSummary[]> {
  const results: TweetSummary[] = [];
  for await (const tweet of gen) {
    results.push(mapTweet(tweet as Record<string, unknown>));
    if (results.length >= limit) break;
  }
  return results;
}

const F1_ACCOUNTS = [
  "F1", "AlpineF1Team", "francocolapinto", "PierreGASLY",
  "MercedesAMGF1", "ScuderiaFerrari", "McLarenF1", "redbullracing",
  "WilliamsRacing", "F1Bites", "autosport", "motorsport",
  "SkySportsF1", "F1i_fr", "RacingNews365"
];

const F1_QUALIFYING_KEYWORDS = [
  "qualy", "qualifying", "clasificacion", "pole position",
  "Q1", "Q2", "Q3", "fastest lap", "vuelta rapida", "tiempos", "sector", "grid"
];

export async function createServer(): Promise<McpServer> {
  const scraper = await buildScraper();
  const server = new McpServer({ name: "x-f1-mcp", version: "0.1.0" });

  server.registerTool(
    "search_tweets",
    {
      description: "Search recent tweets by keyword or phrase. Perfect for monitoring live F1 events, qualifying times, race results, and paddock news in real time.",
      inputSchema: {
        query: z.string().describe("Search query. Examples: 'colapinto monaco qualy', '#MonacoGP'"),
        limit: z.number().min(1).max(50).default(20),
        mode: z.enum(["latest", "top"]).default("latest")
      }
    },
    async ({ query, limit, mode }) =>
      safeTool(async () => {
        const searchMode = mode === "top" ? SearchMode.Top : SearchMode.Latest;
        const tweets = await collectTweets(scraper.searchTweets(query, limit, searchMode) as AsyncGenerator<unknown>, limit);
        return jsonContent({ query, mode, count: tweets.length, tweets });
      })
  );

  server.registerTool(
    "get_user_tweets",
    {
      description: "Get the most recent tweets from a specific X account.",
      inputSchema: {
        username: z.string().describe("X username without @."),
        limit: z.number().min(1).max(50).default(10)
      }
    },
    async ({ username, limit }) =>
      safeTool(async () => {
        const tweets = await collectTweets(scraper.getTweets(username, limit) as AsyncGenerator<unknown>, limit);
        return jsonContent({ username, count: tweets.length, tweets });
      })
  );

  server.registerTool(
    "get_user_profile",
    {
      description: "Get public profile information for any X account.",
      inputSchema: { username: z.string().describe("X username without @.") }
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

  server.registerTool(
    "monitor_f1_live",
    {
      description: "Monitor live F1 session tweets from official accounts filtered by session keywords.",
      inputSchema: {
        session: z.string().describe("Session name. Example: 'Monaco GP Qualifying 2026'"),
        limit: z.number().min(1).max(30).default(15),
        accounts: z.array(z.string()).optional()
      }
    },
    async ({ session, limit, accounts }) =>
      safeTool(async () => {
        const targetAccounts = accounts ?? F1_ACCOUNTS;
        const keywordFilter = [...F1_QUALIFYING_KEYWORDS, session.toLowerCase()];
        const results = await Promise.allSettled(
          targetAccounts.map(async (username) => {
            const tweets = await collectTweets(scraper.getTweets(username, limit) as AsyncGenerator<unknown>, limit);
            const filtered = tweets.filter((t) =>
              keywordFilter.some((kw) => t.text.toLowerCase().includes(kw.toLowerCase()))
            );
            return { username, filtered };
          })
        );
        const feed = results
          .filter((r): r is PromiseFulfilledResult<{ username: string; filtered: TweetSummary[] }> => r.status === "fulfilled")
          .flatMap((r) => r.value.filtered)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return jsonContent({ session, accountsMonitored: targetAccounts.length, count: feed.length, feed });
      })
  );

  server.registerTool(
    "get_trending_f1",
    {
      description: "Search top trending tweets about F1 right now.",
      inputSchema: {
        region: z.enum(["global", "argentina", "spain"]).default("argentina"),
        limit: z.number().min(1).max(30).default(20)
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
        const tweets = await collectTweets(scraper.searchTweets(query, limit, SearchMode.Top) as AsyncGenerator<unknown>, limit);
        const sorted = tweets.sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));
        return jsonContent({ region, query, count: sorted.length, tweets: sorted });
      })
  );

  server.registerTool(
    "get_tweet_by_id",
    {
      description: "Fetch a single tweet by its ID or full URL.",
      inputSchema: { tweetId: z.string().describe("Tweet ID or full x.com URL.") }
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
