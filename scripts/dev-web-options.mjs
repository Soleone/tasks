import path from "node:path";

export function devWebOptions(argv) {
  const separator = argv.indexOf("--");
  const backendOptions = separator === -1 ? argv : argv.slice(0, separator);
  const viteArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const usage =
    "Use --root PATH --database CACHE_OUTSIDE_ROOT, or --real [--refresh], before --; put Vite flags after --.";
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < backendOptions.length; index++) {
    const name = backendOptions[index];
    if (["--real", "--refresh"].includes(name) && !flags.has(name)) {
      flags.add(name);
      continue;
    }
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
  const real = flags.has("--real");
  const refresh = flags.has("--refresh");
  if ((real && values.size > 0) || (refresh && !real)) throw new Error(usage);
  return { backendArgs: [...values].flat(), viteArgs, real, refresh };
}
