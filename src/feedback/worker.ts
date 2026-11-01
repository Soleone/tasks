/**
 * A Cloudflare Worker that turns in-app feedback into a GitHub issue, so people can report without
 * a GitHub account. The token stays here as a secret; the app only knows this Worker's URL.
 * Deploy with `pnpm release:feedback`.
 */

export type FeedbackKind = "bug" | "idea";

export type FeedbackReport = {
  kind: FeedbackKind;
  title: string;
  description: string;
  /** Where it was sent from, e.g. "Tasks 0.3.8 on Windows". */
  source: string;
};

type Env = {
  GITHUB_TOKEN: string;
  LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  COUNTS: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  };
};

const REPOSITORY = "Soleone/tasks";
/** Caps that the per-minute limit misses: one address sending slowly, or many addresses at once. */
const DAILY_PER_ADDRESS = 10;
const DAILY_TOTAL = 30;
const LABELS: Record<FeedbackKind, string> = { bug: "bug", idea: "enhancement" };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
};

function reply(status: number, body: object): Response {
  return Response.json(body, { status, headers: CORS });
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value.trim()
    : null;
}

/** Null unless every field is present and short enough. */
function parseReport(body: unknown): FeedbackReport | null {
  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const kind = fields.kind;
  const title = text(fields.title, 200);
  const description = text(fields.description, 10_000);
  const source = text(fields.source, 100);
  if ((kind !== "bug" && kind !== "idea") || !title || !description || !source) return null;
  return { kind, title, description, source };
}

/** Breaks @mentions, so a public report can't make the repository's account ping strangers. */
function unmention(value: string): string {
  return value.replaceAll("@", "@​");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return reply(405, { error: "Send feedback with POST." });

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await env.LIMITER.limit({ key: ip })).success)
      return reply(429, { error: "Too many reports at once. Try again in a minute." });

    const report = parseReport(await request.json().catch(() => null));
    if (!report) return reply(400, { error: "A title and a description are needed." });

    const day = new Date().toISOString().slice(0, 10);
    const keys = [`${day}:${ip}`, day];
    const [fromAddress, total] = await Promise.all(
      keys.map(async (key) => Number(await env.COUNTS.get(key))),
    );
    if (fromAddress >= DAILY_PER_ADDRESS || total >= DAILY_TOTAL)
      return reply(429, { error: "Too many reports today. Try again tomorrow." });

    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "tasks-feedback",
      },
      body: JSON.stringify({
        title: unmention(report.title),
        body: `${unmention(report.description)}\n\n---\nSent from ${unmention(report.source)}`,
        labels: [LABELS[report.kind]],
      }),
    });
    if (!response.ok) {
      console.error("GitHub refused the issue", response.status, await response.text());
      return reply(502, { error: "GitHub didn't take the report. Try again later." });
    }
    // Counted only once filed, so a GitHub outage doesn't use up anyone's reports.
    await Promise.all(
      [fromAddress, total].map((count, index) =>
        env.COUNTS.put(keys[index], String(count + 1), { expirationTtl: 2 * 24 * 60 * 60 }),
      ),
    );
    const issue = (await response.json()) as { html_url: string };
    return reply(201, { url: issue.html_url });
  },
};
