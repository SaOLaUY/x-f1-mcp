import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`[x-f1-mcp] Missing env var: ${key}`);
    process.exit(1);
  }
  return value;
}

const BEARER_TOKEN = getEnv("X_BEARER_TOKEN");

const BASE = "https://api.twitter.com/2";
const TWEET_FIELDS = "tweet.fields=id,text,created_at,public_metrics,author_id";
const USER_FIELDS = "user.fields=id,name,username,verified,public_metrics,description";
const EXPANSIONS = "expansions=author_id";

async function xFetch(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${res.status}: ${body}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
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
};

function buildTweetSummaries(data: Record<string, unknown>): TweetSummary[] {
  const tweets = (data.data as Record<string, unknown>[] | undefined) ?? [];
  const users: Record<string, Record<string, unknown>> = {};
  const includes = data.includes as Record<string, unknown> | undefined;
  if (includes?.users) {
    for (const u of includes.users as Record<string, unknown>[]) {
      users[String(u.id)] = u;
    }
  }
  return tweets.map((t) => {
    const metrics = (t.public_metrics as Record<string, unknown>) ?? {};
    const author = users[String(t.author_id)] ?? {};
    return {
      id: String(t.id),
      text: String(t.text),
      username: String(author.username ?? t.author_id ?? ""),
      name: String(author.name ?? ""),
      createdAt: String(t.created_at ?? ""),
      likes: Number(metrics.like_count ?? 0),
      retweets: Number(metrics.retweet_count ?? 0),
      replies: Number(metrics.reply_count ?? 0),
      url: `https://x.com/i/web/status/${t.id}`,
    };
  });
}

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

const F1_ACCOUNTS_IDS: Record<string, string> = {
  F1: "137281651",
  francocolapinto: "863246462887038976",
  AlpineF1Team: "216965337",
  MercedesAMGF1: "254139519",
  ScuderiaFerrari: "167927943",
  McLarenF1: "11337195",
  redbullracing: "95662911",
  WilliamsRacing: "26462491",
};

export async function createServer(): Promise<McpServer> {
  console.log("[x-f1-mcp] Starting with X API v2 Bearer Token auth \u2713");

  const server = new McpServer({ name: "x-f1-mcp", version: "0.1.0" });

  server.registerTool(
    "search_tweets",
    {
      description: "Search recent tweets (last 7 days) by keyword or phrase. Perfect for live F1 events, qualifying, race results and paddock news.",
      inputSchema: {
        query: z.string().describe("Search query. Example: 'Monaco GP 2026' or '#MonacoGP'"),
        limit: z.number().min(1).max(100).default(20),
        sort: z.enum(["recency", "relevancy"]).default("recency"),
      },
    },
    async ({ query, limit, sort }) =>
      safeTool(async () => {
        const params = new URLSearchParams({
          query: `${query} -is:retweet lang:es`,
          max_results: String(Math.max(10, Math.min(limit, 100))),
          sort_order: sort,
        });
        const data = await xFetch(`/tweets/search/recent?${params}&${TWEET_FIELDS}&${EXPANSIONS}`);
        const tweets = buildTweetSummaries(data);
        return jsonContent({ query, sort, count: tweets.length, tweets });
      })
  );

  server.registerTool(
    "search_tweets_global",
    {
      description: "Search recent tweets in any language (no language filter). Use for global F1 trending topics.",
      inputSchema: {
        query: z.string().describe("Search query. Example: 'Colapinto Monaco' or '#F1'"),
        limit: z.number().min(1).max(100).default(20),
        sort: z.enum(["recency", "relevancy"]).default("relevancy"),
      },
    },
    async ({ query, limit, sort }) =>
      safeTool(async () => {
        const params = new URLSearchParams({
          query: `${query} -is:retweet`,
          max_results: String(Math.max(10, Math.min(limit, 100))),
          sort_order: sort,
        });
        const data = await xFetch(`/tweets/search/recent?${params}&${TWEET_FIELDS}&${EXPANSIONS}`);
        const tweets = buildTweetSummaries(data);
        return jsonContent({ query, sort, count: tweets.length, tweets });
      })
  );

  server.registerTool(
    "get_user_tweets",
    {
      description: "Get the most recent tweets from a specific X account by username.",
      inputSchema: {
        username: z.string().describe("X username without @. Example: francocolapinto"),
        limit: z.number().min(1).max(100).default(10),
      },
    },
    async ({ username, limit }) =>
      safeTool(async () => {
        const userdata = await xFetch(`/users/by/username/${username}?${USER_FIELDS}`);
        const user = userdata.data as Record<string, unknown>;
        if (!user) throw new Error(`User @${username} not found`);
        const params = new URLSearchParams({
          max_results: String(Math.max(5, Math.min(limit, 100))),
          exclude: "retweets,replies",
        });
        const data = await xFetch(`/users/${user.id}/tweets?${params}&${TWEET_FIELDS}`);
        const rawTweets = ((data.data as Record<string, unknown>[] | undefined) ?? []).map((t) => ({
          id: String(t.id),
          text: String(t.text),
          username: String(user.username),
          name: String(user.name),
          createdAt: String(t.created_at ?? ""),
          likes: Number((t.public_metrics as Record<string, unknown>)?.like_count ?? 0),
          retweets: Number((t.public_metrics as Record<string, unknown>)?.retweet_count ?? 0),
          replies: Number((t.public_metrics as Record<string, unknown>)?.reply_count ?? 0),
          url: `https://x.com/i/web/status/${t.id}`,
        }));
        return jsonContent({ username, count: rawTweets.length, tweets: rawTweets });
      })
  );

  server.registerTool(
    "get_user_profile",
    {
      description: "Get public profile information for any X account.",
      inputSchema: {
        username: z.string().describe("X username without @."),
      },
    },
    async ({ username }) =>
      safeTool(async () => {
        const data = await xFetch(`/users/by/username/${username}?${USER_FIELDS}`);
        const user = data.data as Record<string, unknown>;
        if (!user) throw new Error(`User @${username} not found`);
        const metrics = (user.public_metrics as Record<string, unknown>) ?? {};
        return jsonContent({
          username: user.username,
          name: user.name,
          bio: user.description ?? "",
          followersCount: metrics.followers_count ?? 0,
          followingCount: metrics.following_count ?? 0,
          tweetsCount: metrics.tweet_count ?? 0,
          verified: user.verified ?? false,
          url: `https://x.com/${username}`,
        });
      })
  );

  server.registerTool(
    "get_trending_f1",
    {
      description: "Get top trending F1 tweets right now sorted by engagement (likes + retweets).",
      inputSchema: {
        focus: z.enum(["global", "colapinto", "monaco"]).default("global"),
        limit: z.number().min(1).max(100).default(20),
      },
    },
    async ({ focus, limit }) =>
      safeTool(async () => {
        const queries: Record<string, string> = {
          global: "(F1 OR \"Formula 1\") -is:retweet",
          colapinto: "Colapinto -is:retweet",
          monaco: "(MonacoGP OR \"Monaco GP\") -is:retweet",
        };
        const params = new URLSearchParams({
          query: queries[focus],
          max_results: String(Math.max(10, Math.min(limit, 100))),
          sort_order: "relevancy",
        });
        const data = await xFetch(`/tweets/search/recent?${params}&${TWEET_FIELDS}&${EXPANSIONS}`);
        const tweets = buildTweetSummaries(data)
          .sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));
        return jsonContent({ focus, count: tweets.length, tweets });
      })
  );

  server.registerTool(
    "monitor_f1_accounts",
    {
      description: "Get latest tweets from key F1 official accounts: F1, Colapinto, Alpine, Mercedes, Ferrari, McLaren, Red Bull, Williams.",
      inputSchema: {
        limit_per_account: z.number().min(1).max(10).default(3),
      },
    },
    async ({ limit_per_account }) =>
      safeTool(async () => {
        const feed: Array<Record<string, unknown>> = [];
        const entries = Object.entries(F1_ACCOUNTS_IDS);
        await Promise.all(
          entries.map(async ([username, userId]) => {
            try {
              const params = new URLSearchParams({
                max_results: String(Math.max(5, limit_per_account)),
                exclude: "retweets,replies",
              });
              const data = await xFetch(`/users/${userId}/tweets?${params}&${TWEET_FIELDS}`);
              const tweets = ((data.data as Record<string, unknown>[] | undefined) ?? []).map((t) => ({
                id: String(t.id),
                text: String(t.text),
                username,
                createdAt: String(t.created_at ?? ""),
                likes: Number((t.public_metrics as Record<string, unknown>)?.like_count ?? 0),
                retweets: Number((t.public_metrics as Record<string, unknown>)?.retweet_count ?? 0),
                url: `https://x.com/i/web/status/${t.id}`,
              }));
              feed.push(...tweets);
            } catch {
              // skip failed accounts silently
            }
          })
        );
        return jsonContent({ accountsMonitored: entries.length, count: feed.length, feed });
      })
  );

  server.registerTool(
    "get_tweet_by_id",
    {
      description: "Fetch a single tweet by its ID or full URL.",
      inputSchema: {
        tweetId: z.string().describe("Tweet ID or full x.com URL."),
      },
    },
    async ({ tweetId }) =>
      safeTool(async () => {
        const id = tweetId.includes("x.com") || tweetId.includes("twitter.com")
          ? tweetId.split("/").pop()!
          : tweetId;
        const data = await xFetch(`/tweets/${id}?${TWEET_FIELDS}`);
        return jsonContent(data.data ?? { error: true, message: "Tweet not found" });
      })
  );

  return server;
}
