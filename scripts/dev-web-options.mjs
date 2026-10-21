import path from "node:path";

export function devWebOptions(argv) {
  const separator = argv.indexOf("--");
  const backendOptions = separator === -1 ? argv : argv.slice(0, separator);
  const viteArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const usage = "Use --home PATH, or --real [--refresh], before --; put Vite flags after --.";
  let home;
  const flags = new Set();
  for (let index = 0; index < backendOptions.length; index++) {
    const name = backendOptions[index];
    if (["--real", "--refresh"].includes(name) && !flags.has(name)) {
      flags.add(name);
      continue;
    }
    const value = backendOptions[++index];
    if (name !== "--home" || home !== undefined || !value?.trim() || value.startsWith("--"))
      throw new Error(usage);
    home = path.resolve(value);
  }
  const real = flags.has("--real");
  const refresh = flags.has("--refresh");
  if ((real && home !== undefined) || (refresh && !real)) throw new Error(usage);
  return { backendArgs: home === undefined ? [] : ["--home", home], viteArgs, real, refresh };
}
