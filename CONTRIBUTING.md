# Team rules

1. **Commit under your own GitHub account.** No co-author trailers or tool signatures in commit messages.
2. **Small commits, plain messages**: "Add econ price band", not "Update files".
3. **Keys only in `.env`.** Never in code, commits, screenshots or chat.
4. **No CoStar / Matterport / Vexcel data in git.** It lives in `data/` and `work/`, which are ignored. The data license ends with the hackathon.
5. **Numbers come from tools, never from the LLM.** If the UI or a memo shows a number, it has to exist in `work/<id>/*.json`.
6. **You must be able to explain every line you commit.** Judges can ask any of us how any part works (hackathon rule). If you don't understand something, ask or rewrite it before committing.
7. **`config.py` is frozen at H8.** After that, a parameter change gets a line in `docs/preregistration.md` with the reason, before any test is re-run.
8. **Scope is in `docs/spec.md` §2 (Must / Should / Won't).** Pull from Must first. New ideas go into a GitHub issue, not the code.
9. **Run `pytest` before you push.**
