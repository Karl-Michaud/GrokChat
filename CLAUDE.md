# CLAUDE.md — GrokChat

GrokChat is a Project Asterion repo (`github.com/Project-Asterion/GrokChat`). The team's shared agent instructions live in the `Agents` repo and are imported here:

@../Agents/CLAUDE.md

- **Where to launch.** Clone this repo next to `Admin`, `Asterion`, `Jevson` and `Agents` in `project-asterion/`, and launch `claude` from `project-asterion/` so the shared hooks, MCP servers and skills load (see `Agents/CLAUDE.md` §2). If `../Agents` is missing (a cloud session, for example), clone `github.com/Project-Asterion/Agents` beside this repo and read its `CLAUDE.md` before working.
- **What applies here.** The Asterion engine sections of `Agents/CLAUDE.md` (§3–§6, the engine invariants) are about the engine, not this repo. The conventions apply as written: secrets only in Infisical (§2), git and the two-tier branch flow (§7.2), the Plane board rules (§7.3), how agents work (§8), and memory (§9).
- **Plane.** GrokChat has its own Plane project, **GrokChat** (identifier `GROKCHAT`), in the workspace `project-asterion`. Tickets are `GROKCHAT-N`. Its ids are in `.claude/plane-workflow.json`, and the `plane-workflow` skill reads them from there.
- **Branches.** `staging` is the default branch, `main` is production:

  ```text
  Plane ticket GROKCHAT-N → <feature|fix|chore|hotfix>/GROKCHAT-N-slug, cut from staging
    → PR into staging (squash) → tested on staging → release PR staging → main (merge commit)
  ```

  Run `git config core.hooksPath .githooks` once per clone (`Agents/scripts/bootstrap.sh` does it).
