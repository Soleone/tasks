#!/usr/bin/env node
// Links spec rules to tests. A rule is a backticked slug in the first column
// of a spec table headed "Rule". Tests cite a rule by starting their title
// with "slug:". Fails on duplicate rules and on citations of unknown rules.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const slugPattern = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
const testTitle = /\b(?:test|it|describe)\(\s*["'`]([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+):/g;

function listFiles(dir, include) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : listFiles(path, include);
    return include(path) ? [path] : [];
  });
}

function cells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function slugIn(cell) {
  const match = /^`([^`]+)`$/.exec(cell);
  return match && slugPattern.test(match[1]) ? match[1] : null;
}

// Rule definitions (first "Rule" column) and citations (any later "Rule" column).
function readSpecTables(path) {
  const definitions = [], citations = [];
  let ruleColumns = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim().startsWith("|")) { ruleColumns = null; continue; }
    const row = cells(line);
    if (ruleColumns === null) {
      ruleColumns = row.flatMap((cell, index) => (cell === "Rule" ? [index] : []));
      continue;
    }
    if (row.every((cell) => /^-+$/.test(cell))) continue;
    for (const index of ruleColumns) {
      const slugs = row[index]?.split(",").map((part) => slugIn(part.trim())).filter(Boolean) ?? [];
      (index === 0 ? definitions : citations).push(...slugs);
    }
  }
  return { definitions, citations };
}

const specRoot = join(root, "spec");
const specFiles = listFiles(specRoot, (path) => path.endsWith(".md") && path !== join(specRoot, "README.md"));
const rules = new Map();
const problems = [];
const specCitations = [];
for (const path of specFiles) {
  const { definitions, citations } = readSpecTables(path);
  for (const slug of definitions) {
    if (rules.has(slug)) problems.push(`duplicate rule ${slug} in ${relative(root, path)} and ${rules.get(slug)}`);
    else rules.set(slug, relative(root, path));
  }
  specCitations.push(...citations.map((slug) => [slug, relative(root, path)]));
}
for (const [slug, path] of specCitations) {
  if (!rules.has(slug)) problems.push(`${path} cites unknown rule ${slug}`);
}

const testFiles = [
  ...listFiles(join(root, "src"), (path) => /\.test\.tsx?$/.test(path)),
  ...listFiles(join(root, "scripts"), (path) => path.endsWith(".test.mjs")),
];
const cited = new Set();
for (const path of testFiles) {
  for (const match of readFileSync(path, "utf8").matchAll(testTitle)) {
    if (rules.has(match[1])) cited.add(match[1]);
    else problems.push(`${relative(root, path)} cites unknown rule ${match[1]}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
if (process.argv.includes("--uncited")) {
  for (const [slug, path] of rules) if (!cited.has(slug)) console.log(`${slug}\t${path}`);
}
console.log(`spec rules: ${rules.size}, cited by tests: ${cited.size}`);
