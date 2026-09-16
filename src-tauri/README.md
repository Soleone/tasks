# Tauri shell

The desktop shell loads the Vite frontend and runs the packaged `tasks-backend` sidecar through the shell plugin. The same SEA pipeline also packages the standalone `tasks-cli` agent CLI as a second `externalBin`. Generate native icons from `../assets/branding/ai-todo-icon-two-color-v8.png` with `pnpm tauri icon ../assets/branding/ai-todo-icon-two-color-v8.png` before a distributable build.
