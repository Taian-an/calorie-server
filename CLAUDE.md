# calorie-server

Back end for Calorie Tracks (Express + MongoDB + Redis/BullMQ, Gemini for food recognition) plus the `/admin` panel. Production runs on an Azure VM under PM2; see `ops/README.md`. Deploy with `./deploy.sh` from the parent `SP/` folder.

## Working rules

- Only one Claude conversation edits this repo at a time.
- Before changing anything, run `git status`. If there are changes you didn't make, stop and ask before touching or committing them.
- Commit each finished piece of work right away; don't leave uncommitted changes for the next conversation.
- Production is separate from local: changes here reach users only after `./deploy.sh`.

## Domain language

The shared glossary for the app and the back end lives in the Expo repo: `calorie-app/GLOSSARY.md` (GitHub `Taian-an/calorie-app`). Use its terms; add new terms there, not here.
