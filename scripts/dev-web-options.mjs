import path from "node:path";

export function devWebOptions(argv) {
  const separator = argv.indexOf("--");
  const backendOptions = separator === -1 ? argv : argv.slice(0, separator);
  const viteArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const usage = "Use --root PATH --database CACHE_OUTSIDE_ROOT before --; put Vite flags after --.";
  const values = new Map();
  for (let index = 0; index < backendOptions.length; index++) {
    const name = backendOptions[index];
    const value = backendOptions[++index];
    if (
      !["--root", "--database"].includes(name) ||
      values.has(name) ||
      !value?.trim() ||
      value.startsWith("--")
    )
      throw new Error(usage);
    values.set(name, path.resolve(value));
  }
  if (values.size === 1) {
    throw new Error("dev:web takes --root PATH and --database CACHE_OUTSIDE_ROOT together");
  }
  return { backendArgs: [...values].flat(), viteArgs };
}
