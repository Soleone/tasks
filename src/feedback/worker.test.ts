import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import worker from "./worker";

function env({ allowed = true, counts = new Map<string, string>() } = {}) {
  return {
    GITHUB_TOKEN: "token",
    LIMITER: { limit: async () => ({ success: allowed }) },
    COUNTS: {
      get: async (key: string) => counts.get(key) ?? null,
      put: async (key: string, value: string) => void counts.set(key, value),
    },
  };
}

function post(body: unknown, ip = "203.0.113.5"): Request {
  return new Request("https://feedback.test", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });
}

function filed() {
  return vi.fn(async () =>
    Response.json({ html_url: "https://github.com/Soleone/tasks/issues/9" }, { status: 201 }),
  );
}

const report = {
  kind: "bug",
  title: "Save is slow",
  description: "Takes a second, cc @someone",
  source: "Tasks 0.3.8 on Windows",
};

afterEach(() => vi.unstubAllGlobals());

describe("feedback worker", () => {
  it("opens a labeled GitHub issue and returns its link", async () => {
    const github = filed();
    vi.stubGlobal("fetch", github);

    const response = await worker.fetch(post(report), env());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ url: "https://github.com/Soleone/tasks/issues/9" });
    const [url, init] = github.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/Soleone/tasks/issues");
    const issue = JSON.parse(String(init.body));
    expect(issue.labels).toEqual(["bug"]);
    expect(issue.body).toContain("cc @​someone");
    expect(issue.body).toContain("Sent from Tasks 0.3.8 on Windows");
  });

  it("refuses a report without a title", async () => {
    const github = vi.fn();
    vi.stubGlobal("fetch", github);

    const response = await worker.fetch(post({ ...report, title: " " }), env());

    expect(response.status).toBe(400);
    expect(github).not.toHaveBeenCalled();
  });

  it("stops an address after ten reports a day, and everyone after thirty", async () => {
    vi.stubGlobal("fetch", filed());
    const counts = new Map<string, string>();
    for (let sent = 0; sent < 10; sent++)
      expect((await worker.fetch(post(report), env({ counts }))).status).toBe(201);

    expect((await worker.fetch(post(report), env({ counts }))).status).toBe(429);
    for (let sent = 0; sent < 10; sent++)
      await worker.fetch(post(report, `198.51.100.${sent}`), env({ counts }));
    for (let sent = 0; sent < 10; sent++)
      await worker.fetch(post(report, `192.0.2.${sent}`), env({ counts }));
    expect((await worker.fetch(post(report, "192.0.2.200"), env({ counts }))).status).toBe(429);
  });

  it("refuses an address that sends too fast", async () => {
    const response = await worker.fetch(post(report), env({ allowed: false }));

    expect(response.status).toBe(429);
  });
});
