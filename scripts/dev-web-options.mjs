import path from "node:path";

export function devWebOptions(argv) {
  const separator = argv.indexOf("--");
  const backendOptions = separator === -1 ? argv : argv.slice(0, separator);
  const viteArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const values = new Map();
  for (let index = 0; index < backendOptions.length; index++) {
    const name = backendOptions[index];
    if (name === "--v2-edit" && !values.has(name)) { values.set(name, null); continue; }
    const value = backendOptions[++index];
    if (!["--v2-root", "--database"].includes(name) || values.has(name) || !value?.trim() || value.startsWith("--")) {
      throw new Error("Use --v2-root PATH --database CACHE_OUTSIDE_ROOT and optional --v2-edit before --; put Vite flags after --.");
    }
    values.set(name, path.resolve(value));
  }
  const v2 = values.has("--v2-root");
  if (v2 && !values.has("--database")) {
    throw new Error("v2 requires explicit --database CACHE_OUTSIDE_ROOT; no environment/default fallback");
  }
  if (values.has("--v2-edit") && !v2) throw new Error("--v2-edit requires explicit --v2-root and --database");
  return { backendArgs: [...values].flatMap(([name, value]) => value === null ? [name] : [name, value]), viteArgs, v2, ...(values.has("--v2-edit") ? { v2Edit: true } : {}) };
}
