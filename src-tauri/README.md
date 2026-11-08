# Tauri shell

The desktop shell loads the Vite frontend and runs the packaged `tasks-cli` sidecar with `--stdio` through the shell plugin. It is the same executable people and agents run as the CLI. Windows builds only the NSIS installer (`tauri.windows.conf.json`), the one that runs the uninstall hook. Native icons come from `app-icon/`: after changing those SVGs, run `pnpm tauri icon src-tauri/app-icon/manifest.json` from the repo root and commit the result.
