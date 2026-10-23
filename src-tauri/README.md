# Tauri shell

The desktop shell loads the Vite frontend and runs the packaged `tasks-cli` sidecar with `--stdio` through the shell plugin. It is the same executable people and agents run as the CLI. Windows builds only the NSIS installer (`tauri.windows.conf.json`), the one that runs the uninstall hook. Generate native icons from `../assets/branding/ai-todo-icon-two-color-v8.png` with `pnpm tauri icon ../assets/branding/ai-todo-icon-two-color-v8.png` before a distributable build.
