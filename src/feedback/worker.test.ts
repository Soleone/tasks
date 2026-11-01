import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import worker from "./worker";

function env(allowed = true) {
  return { GITHUB_TOKEN: "token", LIMITER: { limit: async () => ({ success: allowed }) } };
}

function post(body: unknown): Request {
  return new Request("https://feedback.test", { method: "POST", body: JSON.stringify(body) });
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
    const github = vi.fn(async () =>
      Response.json({ html_url: "https://github.com/Soleone/tasks/issues/9" }, { status: 201 }),
    );
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

  it("refuses an address that sends too fast", async () => {
    const response = await worker.fetch(post(report), env(false));

    expect(response.status).toBe(429);
  });
});
