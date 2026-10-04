import path from "node:path";

export function devWebOptions(argv) {
  const separator = argv.indexOf("--");
  const backendOptions = separator === -1 ? argv : argv.slice(0, separator);
  const viteArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const values = new Map();
  for (let index = 0; index < backendOptions.length; index += 2) {
    const name = backendOptions[index];
    const value = backendOptions[index + 1];
    if (!["--v2-root", "--database"].includes(name) || values.has(name) || !value?.trim() || value.startsWith("--")) {
      throw new Error("Use --v2-root PATH --database CACHE_OUTSIDE_ROOT before --; put Vite flags after --.");
    }
    values.set(name, path.resolve(value));
  }
  const v2 = values.has("--v2-root");
  if (v2 && !values.has("--database")) {
    throw new Error("v2 requires explicit --database CACHE_OUTSIDE_ROOT; no environment/default fallback");
  }
  return { backendArgs: [...values].flat(), viteArgs, v2 };
}
