# Moving a task folder into a home

Before Tasks homes, tasks lived in a plain folder. That folder moves into a home by copying. Do this once on each device:

1. Create the home in setup, then close Tasks and the CLI and pause the folder in Syncthing.
2. Copy `workspace.json` and `tasks/` from the old folder into the home's `sync/` folder and open Tasks again. The tasks come over; undo and activity history from before the move don't.
3. Syncthing can't change a folder's path, so remove the folder there (its files stay) and add it again with the same folder ID, pointing at the new home's `sync/` folder, shared with the same devices. It finds the files already in sync.
