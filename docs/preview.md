# Digest preview

Preparation for issue #6. A preview is public and temporary (ADR 0003). Do not commit
generated HTML, attach it to an issue/chat, or paste its contents into logs. Keep issue #6
open until the reviewer has received the preview link and the plan's issue links.

## Local export

From the repository root, with dependencies installed and the digest route integrated:

```sh
PATH="$HOME/.local/bin:$PATH" pnpm exec tsx --env-file-if-exists=.env scripts/export-preview.ts var/preview
```

The command calls `createApp()`, listens on `127.0.0.1` with an ephemeral port, waits for
listening, fetches `/digest/2026-10-28`, saves `var/preview/index.html`, then closes the
server. It never imports `src/server.ts`, starts the heartbeat, or edits `runs/`. The
server's layout supplies the lane banner and inline CSS; no client JavaScript is added.
An unavailable route or non-HTML response fails the export rather than saving an error page.

The first argument chooses the output directory; otherwise `PREVIEW_DIR`, then
`var/preview`, is used. Always choose an ignored directory, never a tracked path.
`PREVIEW_NIGHT` selects another night (format `YYYY-MM-DD`). `LANE_MARKER` controls the
banner; the local command above optionally loads the ignored `.env` file. Never commit it.

For a marker-free local copy, do **not** load `.env`:

```sh
PATH="$HOME/.local/bin:$PATH" LANE_MARKER='' pnpm exec tsx scripts/export-preview.ts var/preview
```

## Publish only after human approval

No publication is authorized by these files. Before pushing, enabling Pages, or dispatching
the workflow, ask the human for approval covering those actions in this repository. Explain
that the digest and its lane marker will be visible to anyone at the public URL, and that
cleanup replaces that page at the same URL with a marker-free copy. Public copies or caches
cannot be recalled. No secrets are needed or passed to the exporter.

After approval, the publication owner can:

1. Integrate the digest route and these preparation files; push the approved branch.
2. Set repository **Settings → Pages → Build and deployment → Source** to **GitHub Actions**
   if it is not already configured (this also needs approval).
3. Open **Actions → Digest preview → Run workflow**, select the approved ref, set `night`
   to `2026-10-28`, and enter the lane marker in `marker`.
4. Wait for tests, typecheck, export, artifact upload, and deployment to succeed. Verify
   the page and banner, then send the reviewer the URL and this plan's issue links.

Expected URL (not proof of an existing deployment):
<https://ddabrowski93.github.io/mega-s01e04-rig/>.

The workflow is manual-only: no push, pull-request, or scheduled trigger. It uses Node 24,
pnpm 10, a frozen lockfile, and only `contents: read`, `pages: write`, and `id-token: write`
permissions with the `github-pages` environment. Deployments share a concurrency group and
do not cancel an in-progress deployment. Official action majors were checked against
GitHub's read-only releases API when preparing this workflow.

## Cleanup after review

With approval for the replacement deployment, run the **same workflow** on the same code
and night with `marker` left **blank**. The export step explicitly receives a blank
`LANE_MARKER` and does not load `.env`; it uploads a newly generated artifact and replaces
the page at the same URL. Check that the banner reads **no marker set** before marking
cleanup done. Do not archive a marker-bearing HTML copy in git, issues, or attachments.
The uploaded Pages artifact has a one-day retention; deployment replacement, not artifact
expiry, is what removes the marker from the live page.
