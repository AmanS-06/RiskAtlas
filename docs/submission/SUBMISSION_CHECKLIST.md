# Submission checklist (ordered, from today to Submit)

Today is **2026-10-04**. Legend: **[HUMAN]** only a person can do it (accounts, forms, recording, pressing Submit).
**[AI]** an AI agent can do it. **[BOTH]** AI prepares, a human verifies. Tick a box only after you have *seen* the result
yourself, not after someone says it is done.

Official source for requirements: the three PDFs (Track A, Submission Guidelines, Problem Statements), re-read for this
list. The prior auditor's file `requirements_audit.md` was not found at the path given, so everything here was checked
against the PDFs directly.

## Dates

| Date | Milestone | Notes |
|---|---|---|
| Sun 2026-10-04 | Today. Models and app integrated and merged to `main`. Submission pack drafted | |
| Mon 10-05 | Decisions made: project name, submission repo, licence, team names and Devpost accounts | section 1 |
| Sat 10-10 | **Feature freeze.** Models retrained from a clean commit if at all. Only fixes after this | `TEAM_STANDARD.md` says 12 Oct for deploy and freeze; the earlier date here leaves room for the video. Team decides |
| Sun 10-11 | Documentation PDF (max 6 pages) done, README final, repo hygiene pass | |
| Mon 10-12 | **Video recorded**, uploaded to YouTube (Unlisted), captions proofread | `DEMO_SCRIPT.md` |
| Tue 10-13 | Devpost project filled in as a **draft**, every teammate added, all links tested logged out | |
| Wed 10-14 | Buffer in the morning. Final checks. **Press Submit in the evening (IST).** Aim to be done by about 21:00 IST | |
| Thu 10-15 00:15 IST | Deadline per `docs/TEAM_STANDARD.md`. **Not verified against Devpost** (AI cannot open Devpost). Section 2 | Do not submit in the last 30 minutes. Servers slow down near deadlines |

Also on the calendar: **ForgeHacks Online, Oct 3 to 10** (second hackathon the team is registered in): see section 12.

## What the official rules require (the four components) and where this list covers each

| # | Official component (Submission Guidelines) | Covered in |
|---|---|---|
| 1 | Project description on the Devpost project page: what you built, the problem it solves, how it works | sections 8 and 10, text in `DEVPOST_STORY.md` |
| 2 | Link to a **public** GitHub repo with source code and documentation. README with setup instructions, prerequisites/dependencies, and run instructions | sections 3 to 5 |
| 3 | Demo video, **3 to 10 minutes**, YouTube, Unlisted fine, **Private is not**. Shows the project running and explains the approach. English audio or English subtitles | sections 7 and 10, script in `DEMO_SCRIPT.md` |
| 4 | Team info: every member's **real full name**; every teammate has a **Devpost account** and is **added to the submission** (otherwise not shown on the project page and may not get a certificate) | sections 1 and 9 |

Track A deliverables (Track A PDF) and where they live:

| Track A deliverable | Where it is | Status today |
|---|---|---|
| Working software prototype (web app, 3D viewer integrated with the ML backend) | `web/` + `api/` + `models/` | Built, tests run here (section 4) |
| Trained prediction pipeline (clean code and model weights) | `pipeline/`, `models/*.joblib` | Built, committed |
| Clinical explanation dashboard (metrics, SHAP/LIME, physiological breakdowns) | `web/src/dashboard/` | Built. Metrics (AUC etc.) are in `docs/ml_results.md` only, not inside the app (known gap, `docs/web_findings.md` item 3) |
| Project documentation, **max 6 pages**: preprocessing, model architecture, 3D pipeline setup, usage instructions, evaluation results | **Not yet a 6-page document.** Material exists in `docs/*.md`, no PDF exists | **Open, section 6** |
| Demonstration video: working system, feature input workflow, 3D interactions, technical implementation | | **Open, section 7** |
| Required in Track A text: disclaimer visible in the UI | Banner "NOT FOR CLINICAL USE" at the top of the page | Done. Verified in the browser |
| Exclude LAD, LCX, RCA and Cath from inputs; metrics accuracy, precision, recall, F1, ROC-AUC | `docs/leakage_audit.md`, `docs/ml_results.md` | Done |

---

## 1. Decisions to make now (Oct 4 to 5)

- [ ] **[HUMAN]** **Project name.** Devpost says "BuriBuri Zaemon", the repo and app say "RiskAtlas". Pick one. Recommendation and the list of files to change if you keep the old name: `DEVPOST_STORY.md` section 0. Decide before the video is recorded.
- [ ] **[HUMAN]** **Which GitHub repo is the submission repo.** The local clone has two remotes: `origin` = `https://github.com/AmanS-06/riskatlas` and `fork` = `https://github.com/Anhad23mahajan/riskatlas`. Choose one, make it **public**, and use only that URL everywhere. Write it here: `________________`.
- [ ] **[HUMAN]** **The final code must be on that repo's default branch.** Judges open the default branch. Confirm in a logged-out browser that the README on the default branch is the final one and that it contains the latest merged work.
- [ ] **[HUMAN]** **Team list.** Write down each member's real full name exactly as on their ID: 1) `________` 2) `________` 3) `________` 4) `________`. Teams are 1 to 4 people.
- [ ] **[HUMAN]** **Each teammate creates a Devpost account now** (if not done) and sets their profile name to their **real full name** (not a nickname). Share the Devpost username of each.
- [ ] **[HUMAN]** **Licence.** There is **no `LICENSE` file** in the repo. Decide (for example MIT or Apache-2.0 for the code) and add a `LICENSE` file at the repo root. The two `.glb` model files are CC BY-SA 4.0 (ShareAlike), see `web/public/models3d/LICENSE-models.md` and `ASSETS_AND_LICENSES.md`: state in the README that the code licence does not cover those files. The repo's own notes say the "separate work" reading is common but untested and not legal advice. [AI] can draft the file once the choice is made. (This task was not allowed to touch the repo root.)
- [ ] **[HUMAN]** Re-check the upstream licence chain of the 3D model against the upstream pages (Z-Anatomy repo and BodyParts3D site), as `ASSETS_AND_LICENSES.md` asks ("Re-check ... before the final submission"). The packager's own audit is marked "pending" and the pages were unreachable from the build environment. If it differs, update `ATTRIBUTIONS.md` and the README.
- [ ] **[HUMAN]** Decide who is **recorder/driver**, who is **narrator** for the video, and book a quiet 2-hour slot for Oct 12.

## 2. Confirm the deadline and the rules on Devpost (AI cannot do this)

- [ ] **[HUMAN]** Open the hackathon's Devpost page, tab **Schedule** (or Overview): write down the **exact submission deadline, date, time and time zone**: `________________`. The team standard says **15 Oct 2026 00:15 IST**. If Devpost shows another time zone, convert it. If it differs, update `docs/TEAM_STANDARD.md` and this list.
- [ ] **[HUMAN]** On the same page read **Rules**, **Prizes/Eligibility** and **Resources/Updates**: check team size, eligibility (student status, country), whether a project may be reused from another hackathon, any extra required field (for example a documentation upload, a "built with" requirement, a pitch deck) and any rule about pre-existing code. Paste anything unexpected into the group chat.
- [ ] **[HUMAN]** Check how the Devpost submission form asks for the **Track** and the documentation (the 6-page document). If there is no upload field, plan to put the PDF in the repo and link it (section 6).
- [ ] **[HUMAN]** Check Devpost says edits are allowed until the deadline and what "Submitted" versus "Draft" looks like on your project page.

## 3. Repository content (public GitHub repo)

- [ ] **[BOTH]** README at the repo root has: what it is, **prerequisites** (Python 3.11, Node 20.19+ or 22.12+), **setup** (venv and `pip install -r requirements.txt`; `cd web && npm ci`), **how to run** (train/skip training, start the API, start the web app), where the demo data is, the disclaimer, the dataset and 3D-model attribution, the licence, the team (real names). The README on the integration branch is **stale** (it still says "Frontend in progress", "Not deployed yet", team "TBD", lists React Three Fiber, and has no frontend setup). The ready-to-paste Frontend section is at the end of `docs/web.md`. The documentation agent is working on it. **Verify it yourself in section 5.**
- [ ] **[AI]** Fix README details found in this review (list at the end of this file): remove "React Three Fiber" (not used), fix the "Status" lines, add the team names once decided.
- [ ] **[HUMAN]** `LICENSE` file present (section 1).
- [ ] **[BOTH]** Reconcile the **disclaimer wording**: web app (`web/src/shared/constants.ts`), README and API (`api/schemas.py`) differ slightly (`docs/web_findings.md` item 2). Pick one and use it everywhere. Not blocking, but a judge may notice.
- [ ] **[BOTH]** `ASSETS_AND_LICENSES.md` still has a "Fonts" row with "TBD". Remove it: `web/src/shared/theme.css` uses only system fonts (`system-ui`, etc.), so no font asset needs a licence entry.
- [ ] **[AI]** Retrain from a **clean commit** before the freeze so `models/metadata.json` shows a clean git SHA. Today's model records `10eadccccb...-dirty` (uncommitted changes when trained), which shows up in the app's About tab as "(with uncommitted changes)". After a retrain regenerate `docs/ml_results.md`, then re-run `scripts/submission/demo_patients.py` and update every number in `DEMO_DATA.md`, `DEMO_SCRIPT.md` and `DEVPOST_STORY.md`. **Skip the retrain if there is no strong reason: it changes all the numbers.**
- [ ] **[AI]** Architecture diagram: the README layout mentions one under `docs/`, no diagram file exists. Needed for the 6-page document (section 6) and good for the Devpost gallery.

## 4. Repo hygiene (do on the final commit)

- [ ] **[AI]** No secrets: search for keys/tokens (`git grep -nEi "api[_-]?key|secret|token|password|BEGIN .*PRIVATE"`). On the current tree the only hits are documentation and a test string. `.env` files are ignored; `.env.example` and `web/.env.example` contain no secrets. Repeat on the final commit.
- [ ] **[AI]** No big or private data committed. Today: pack size about 2 MB, 246 tracked files, the largest are the `.glb` files (about 0.5 MB) and the models (about 0.19 MB each). `data/raw/` and `data/external/` are git-ignored (the dataset downloads on demand). `data/processed/holdout_ids.json` is committed on purpose. Check that no `.xlsx`, `.zip`, `.env`, `node_modules`, `__pycache__` or notebook outputs are tracked: `git ls-files | grep -E "\.(xlsx|zip|ipynb)$|node_modules|\.env$"`.
- [ ] **[HUMAN]** Look at the GitHub repo **Insights** and **Settings** pages: Visibility = Public.
- [ ] **[HUMAN]** Do a **fresh clone test** on a machine (or a clean folder) that never had the project: `git clone <public URL>`, follow the README exactly, copy-paste each command, and confirm `uvicorn` starts, `npm run dev` starts, and a preset gives a real (not mock) result. Write down every place you had to guess. Fix the README for each.
- [ ] **[HUMAN]** The repo works without the local-only files: no absolute paths like `/home/user/...` in docs the reader must follow (check README and docs/web.md).
- [ ] **[AI]** Run all tests on the final commit: `python -m pytest -q` (last run here: 97 passed, 3 skipped), `cd web && npm ci && npm run typecheck && npm test` (last run here: typecheck clean, 182 passed), `npm run build` (succeeded here). Optional: `npm run e2e`.

## 5. Public check of the repo (logged out)

- [ ] **[HUMAN]** Open the repo URL in a **private/incognito window** (not signed in to GitHub). The repo loads. The README renders (tables, code blocks, images). Links in the README work (docs, ASSETS_AND_LICENSES.md). The LICENSE is detected by GitHub ("MIT License" or similar shown in the sidebar).
- [ ] **[HUMAN]** The default branch shown is the final one and the latest commit is the freeze commit.
- [ ] **[HUMAN]** `models/*.joblib` and `reports/` are present (Track A asks for model weights).

## 6. Project documentation (max 6 pages)

Track A: "Overview of dataset preprocessing, model architecture, 3D pipeline setup, usage instructions, and evaluation results (max. 6 pages)". No such document exists yet: the material is spread over `docs/ml_methods.md`, `ml_results.md`, `leakage_audit.md`, `viewer.md`, `web.md`, `api.md`.

- [ ] **[BOTH]** Assemble one document of **at most 6 pages** (PDF) with: dataset and preprocessing (leakage guard); models and validation (cross-validated table with intervals, the 61-patient holdout disclosure, external validation); explanation methods (SHAP additivity, LIME check); 3D pipeline (mesh source, node names, colouring, uncertainty, fallbacks); system architecture diagram; usage instructions; limitations; credits. Every number must appear in `docs/ml_results.md` (the leakage audit's reviewer checklist requires this).
- [ ] **[HUMAN]** Open the PDF and **count the pages: 6 or fewer**, including figures and any title page. Check the fonts render, tables are not cut off, and the images are readable.
- [ ] **[HUMAN]** Put the PDF in the repo (for example `docs/RiskAtlas_documentation.pdf`) and link it from the README. If the Devpost form has a file or link field for documentation, add it there too (check section 2).
- [ ] **[HUMAN]** Every teammate reviews the leakage audit (`docs/leakage_audit.md` says everyone does before submission) and ticks its reviewer checklist.

## 7. Demo video (3 to 10 minutes)

Follow `DEMO_SCRIPT.md` (about 6 minutes). The pre-recording checklist is in that file.

- [ ] **[HUMAN]** Backend running with real models, no MOCK banner, browser at 80% zoom, groups collapsed, 1080p, headset microphone tested (see the checklist in `DEMO_SCRIPT.md`).
- [ ] **[HUMAN]** Record. Watch the **whole recording** yourself, once, at normal speed. Check: length is between 3:00 and 10:00; the disclaimer banner is visible; no mock banner; no private info; audio is clear; all four Track A things are shown (working system, feature input, 3D interactions, technical implementation).
- [ ] **[HUMAN]** Check every number spoken against `DEMO_DATA.md` and `docs/ml_results.md`.
- [ ] **[HUMAN]** Upload to YouTube: **Unlisted, not Private** (steps in `DEMO_SCRIPT.md`). Paste the description block from `ATTRIBUTIONS.md` section 6 (replace the three placeholders).
- [ ] **[HUMAN]** English captions: auto-generate, then proofread (LAD, LCX, RCA, SHAP, Z-Alizadeh Sani, BodyParts3D...).
- [ ] **[HUMAN]** Open the YouTube link **logged out** (incognito). It plays, has sound, is not age-restricted, shows English captions with CC on, and its length is 3 to 10 minutes. Write the link here: `________________`.

## 8. Devpost project page (draft on Oct 13, final on Oct 14)

Text for every field: `DEVPOST_STORY.md`.

- [ ] **[HUMAN]** Project name set (section 1). Elevator pitch pasted (189 characters, limit 200; re-count if edited).
- [ ] **[HUMAN]** Project story pasted (what you built, the problem it solves, how it works), Markdown headings render. Limitations section kept in.
- [ ] **[HUMAN]** "Built with" tags entered (from `DEVPOST_STORY.md` section 4; remove react-three-fiber, OCR, and LLM tags, they are not true).
- [ ] **[HUMAN]** "Try it out" links: GitHub URL (public). Live demo URL only if one really exists.
- [ ] **[HUMAN]** Video link pasted (YouTube, Unlisted).
- [ ] **[HUMAN]** Image gallery: 3 to 5 images of the real dashboard (real backend, no mock banner), thumbnail chosen. Do not use screenshots that show the mock banner.
- [ ] **[HUMAN]** Track A selected (confirm the exact wording on the form). Documentation link/upload added if there is a field.
- [ ] **[HUMAN]** Re-read the Devpost text once for claims the repo does not support. Use the "Not built" row of the facts sheet in `DEVPOST_STORY.md`.

## 9. Team members on Devpost (component 4: the one most often missed)

- [ ] **[HUMAN]** Every teammate has a Devpost account and has **joined the hackathon** on Devpost (some hackathons require registration on the event page before being added: check).
- [ ] **[HUMAN]** The project owner opens the project, **Edit project, Team** (wording may differ), and **adds every teammate by username or email**. Each teammate must **accept the invitation** (email or Devpost notification). Pending invitations do not count.
- [ ] **[HUMAN]** Each member's Devpost **profile name is the real full name**. Fix it in the profile if it is a nickname.
- [ ] **[HUMAN]** On the saved project page, all members' names and avatars appear. Count them: ______ of ______.

## 10. Final verification (Oct 14, before pressing Submit)

- [ ] **[HUMAN]** Open the **Devpost project page in a logged-out window**. Check: name, pitch, story renders, video plays (the embedded YouTube plays), GitHub link opens the public repo, **all teammates appear with real full names**, images load.
- [ ] **[HUMAN]** Open the YouTube link logged out one more time. Still plays. Still Unlisted (not Private, not deleted).
- [ ] **[HUMAN]** Open the GitHub README logged out one more time. Default branch is final. LICENSE present. No secrets in the file list. No `data/raw` dataset files. Documentation PDF opens and is at most 6 pages.
- [ ] **[HUMAN]** Re-check the **deadline** on the Devpost Schedule tab (section 2). Write the current time in IST next to it.
- [ ] **[HUMAN]** Everyone reads the final Devpost text and the disclaimer once more. Nobody has added a claim that is not backed by `docs/ml_results.md`.
- [ ] **[HUMAN]** Confirm there is a **second person on call** in case the submit step fails (so two accounts can check).

## 11. Press Submit (Oct 14 evening IST, target done by about 21:00)

- [ ] **[HUMAN]** On Devpost, click **Submit** (the wording may be "Submit project" or "Submit to hackathon"). If a screen asks you to tick rules/terms, read and tick it.
- [ ] **[HUMAN]** After submitting, open the project page and confirm the status says **Submitted**, **not Draft**. Take a screenshot with the date visible and share it in the team chat.
- [ ] **[HUMAN]** Check your email for the confirmation, if Devpost sends one (not verified).
- [ ] **[HUMAN]** Do not change the video, repo default branch or Devpost links after submitting unless you re-verify everything. If you edit the Devpost text, check the status is still Submitted.
- [ ] **[HUMAN]** After the deadline, leave the GitHub repo public and the YouTube video available for the judging period.

## 12. ForgeHacks side-note (do not plan beyond this)

The team is also registered in **ForgeHacks Online (Oct 3 to 10)**, which needs a **2 to 4 minute demo video** and a GitHub repo, with teams of 1 to 4 students. The author of this checklist does not know its rules.

- [ ] **[HUMAN]** **Before submitting this same work there, read ForgeHacks' rules on reusing a project** (and on submitting the same project to multiple hackathons, pre-existing work, and team eligibility). Submit there only if the rules allow it. The 2 to 4 minute length differs from the 3 to 10 minute rule here, so the same video would not necessarily fit both. Nothing in this pack plans for it.

---

## Discrepancies and open issues found while preparing this pack

For the owners of those files. None was changed by this task (it may only touch `docs/submission/` and `scripts/submission/`).

1. **README is stale** on the integration branch: "Frontend in progress", "Not deployed yet", team "TBD", "React Three Fiber" in the stack, "Frontend setup will be added here". The paste-ready Frontend section is in `docs/web.md`. (The documentation agent was working on it at the same time.)
2. **No `LICENSE` file** at the repo root.
3. **Disclaimer wording** differs between the web app and README/API (`docs/web_findings.md` item 2).
4. **`ASSETS_AND_LICENSES.md`**: a Fonts row still says TBD; the upstream 3D licence chain is unconfirmed (flagged in the file itself).
5. **No 6-page documentation and no architecture diagram** exist yet.
6. **Models were trained from a dirty working tree** (`git_sha ...-dirty`). Visible in the About tab.
7. **Submission branch**: check that the final work is on the default branch (`main`).
8. **The prior auditor's `requirements_audit.md` was not found** at the stated scratchpad path.
9. **`TEAM_STANDARD.md` dates** (freeze 12 Oct, video 13 Oct) differ from the suggested internal milestones in this list (freeze 10 Oct, video 12 Oct).
10. **Presets**: the app has no preset where vessels clearly differ. The models also cannot produce "LAD high and RCA low" (`DEMO_DATA.md` section 2). A two-field edit of Case C gives the LAD-dominant pattern.
11. **"Full prediction in 0 ms"** shows in the results panel for answers served from the API cache. Cosmetic but odd on camera.
12. **The 3D arteries are thin** at the default zoom. At 80% browser zoom the colours of the three arteries are hard to see without zooming in or selecting the vessel. The viewer-polish agent may be improving this.
13. **The default risk colours are weak for protanopia/deuteranopia** (`docs/web_findings.md` item 1). The app has a colour-blind safe palette switch.
14. **Page layout is not sticky**: scrolling to the lower form groups scrolls the heart out of view. Collapse the groups before recording.
15. **Tested only in headless Chromium** (software rendering). Not on a real GPU, Safari, Firefox, or a real screen reader.
