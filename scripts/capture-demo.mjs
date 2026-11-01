#!/usr/bin/env node
// Records the hosted build as the README's looping WebP: after adding the example tasks, capture a
// task, start it, finish it, then open the shortcut list.
// Usage: node scripts/capture-demo.mjs [--url http://localhost:4173] [--out docs/media/demo.webp]
// Needs agent-browser (with its browser installed) and FFmpeg on the PATH. Serve the build first,
// for example `pnpm build:hosted && pnpm exec vite preview --outDir dist/hosted`.
import { parseArgs } from "node:util";
import { record } from "@soleone/showcase/capture";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://tasks.soleone.xyz" },
    out: { type: "string", default: "docs/media/demo.webp" },
  },
});

const newTask = "Ship the web demo";

await record({
  url: values.url,
  out: values.out,
  viewport: { width: 1280, height: 760 },
  width: 1280,
  async start(page) {
    await page.waitFor(`document.body.innerText.includes("0 active tasks")`, { timeoutMs: 30_000 });
    await page.click("Add example tasks");
    await page.waitFor(`document.body.innerText.includes("13 active tasks")`);
    // Pausing the first quest leaves a toast for a few seconds; the clip starts once it is gone.
    await page.click("Later");
    await page.waitFor(`!document.body.innerText.includes("Quest paused")`, { timeoutMs: 15_000 });
  },
  async drive(page) {
    const startAt = await page.now();
    await page.sleep(1200);
    await page.run("press", "c");
    await page.sleep(500);
    for (const word of `${newTask} @launch #demo !today`.split(" ")) {
      await page.run("keyboard", "type", `${word} `);
    }
    await page.sleep(700);
    await page.run("press", "Enter");
    await page.sleep(1500);
    // The new task is selected; Space moves it to in progress, then to done.
    await page.run("press", "Space");
    await page.sleep(1200);
    await page.run("press", "Space");
    await page.sleep(2200);
    await page.run("press", "Control+k");
    await page.sleep(2500);
    await page.run("press", "Escape");
    await page.sleep(1000);
    return { startAt, endAt: await page.now() };
  },
  // The new task was added and finished, so the active count is back where it started.
  async verify(page) {
    if (!(await page.eval(`document.body.innerText.includes("13 active tasks")`)))
      return "the new task did not reach done";
  },
  attempts: 3,
});
