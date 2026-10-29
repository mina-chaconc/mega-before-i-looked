# Morning Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each worker owns one issue on an isolated branch or worktree.

**Goal:** Turn the existing nightly JSONL fixtures into matching HTML/JSON digests, link them from the board, and deliver a temporary public review copy.

**Architecture:** A synchronous validated reader owns aggregation, ordering and counts. Hono routes and JSX views consume its result. Preserve the existing server-rendered layout and inline stylesheet.

**Tech Stack:** Node 22+, TypeScript strict, Hono JSX, Vitest, pnpm.

**Spec:** `../../plans/done/morning-digest.md`, `../../vision.md`, `../../styleguide.md`, `../../adr/`. The user approved the seven issue split and issue fields before repository creation.

## Global Constraints

- No client JS. Keep `runs/` read-only. No `any`.
- Preserve timestamp offsets for display. Display null owners as the project's missing-value dash.
- Never commit `.env`, tokens or previews. Public preview contains only sample fixture data and its course marker.
- One issue per worker; its own branch or worktree. Strongest model for reader logic, cheaper model for view/API/tests.
- Commit the types contract first, before the four section 2 tasks start.
- Section 2 tasks may start from the contract, but cannot be closed before their end-to-end Done when checks pass.
- Every closing comment has exactly three lines: `done: ...`, `worker: <harness> · <model> · <effort>`, `commit: <sha or "none">`.
- The public repository and issue work are approved. Preview publication and later marker removal each require separate approval. Cleanup waits for the review to arrive.

## Shared contract and rulings

`src/digest/types.ts`: `DigestStatus = 'ok' | 'retry' | 'fail'`; `DigestRow` contains `job: string`, `owner: string | null`, `runs: number`, `retries: number`, `lastStatus: DigestStatus`, `lastError: string | null`, `firstAt: string`, `lastAt: string`, `hasFailure: boolean`. `NightDigest` contains `night: string`, `rows: DigestRow[]`, `badLines: number`, `counts: Record<DigestStatus, number>`. Export `ReadNight = (runsDir: string, night: string) => NightDigest | null` as the readNight signature. The implementation exports `readNight: ReadNight` from `src/digest/read-night.ts`.

Runs count valid events including retries. Retries count retry events. Counts are event counts, not final job states. Sort rows by job with deterministic lexical order. First/last and latest status/owner use chronological instants, preserving source timestamp strings; ties use source order. Last error is the most recent event carrying an error, retained after recovery. `hasFailure` records any fail event. Blank lines are ignored; invalid JSON or invalid required fields count toward badLines. Missing files or invalid night identifiers return null, while other I/O errors propagate. A night identifier must match YYYY-MM-DD and cannot traverse directories.

These are implementation rulings for unspecified details, not new product features. Revisit only if actual evidence contradicts the plan.

## Review Focus

- Malformed JSON and structurally invalid events must count as bad lines and preserve valid jobs: reader tests.
- A recovered retry/failure must retain its error history and warning state: reader/view tests.
- Null owner and HTML metacharacters must remain visible and safely escaped: page tests.
- A missing file differs from an empty or all-invalid file: reader and route tests.
- Traversal-like night input must never read outside the configured runs directory: reader and route tests.

### Task 1: Run log reader (issue 1)

**Files:** Create `src/digest/types.ts`, `src/digest/read-night.ts`, `test/digest-reader.test.ts`.

**Interfaces:** Produces the shared contract above and `readNight: ReadNight`.

- [ ] Commit `types.ts` alone first and report its SHA immediately; do not wait for the reader to finish.
- [ ] Write reader tests. Fixture expectations: 5 rows, 1 bad line, counts `{ok: 10, retry: 4, fail: 1}`; fixtures/refresh has 4 runs, 3 retries, lastStatus ok and lastError upstream 503; notes/backup hasFailure true; digest/render owner null. Assert empty vs missing, malformed shapes, offsets, chronological ordering, and traversal rejection.
- [ ] Run focused tests and record the expected failure before implementation.
- [ ] Implement `readNight` with validation at the parsing boundary, no fixture changes, and no extra filesystem abstraction.
- [ ] Run focused tests, full suite, and typecheck. Commit reader changes linked to issue 1 and report evidence.

### Task 2: Digest page (issue 2)

**Files:** Create `src/views/digest.tsx`, `src/digest/page-route.tsx`, `test/digest-page.test.tsx`; modify `src/app.tsx` only to register its route.

**Interfaces:** Consumes `NightDigest` and `readNight`. Export `DigestPage({digest}: {digest: NightDigest})` and `registerDigestPage(app: Hono, config: RigConfig): void`.

- [ ] Write failing view tests with an explicit NightDigest fixture: job order, null owner, escaped job/error, full offsets, >=3 retries, historical fail, and empty state.
- [ ] Implement one table using existing Layout via `GET /digest/:night`; include job, owner, runs, retries, last status/error, first/last time and a readable bad-line count. Warn qualifying rows; empty renders exact text `nothing ran`. Missing returns 404.
- [ ] Register the route in `createApp`; no client scripts or new styling system.
- [ ] Run focused tests; once the reader lands, run full tests and typecheck. Commit linked to issue 2.

### Task 3: Digest JSON (issue 3)

**Files:** Create `src/digest/json-route.ts`, `test/digest-json.test.ts`; modify `src/app.tsx` only to register its route.

**Interfaces:** Consumes `readNight`. Export `registerDigestJson(app: Hono, config: RigConfig): void`.

- [ ] Write failing API tests: sample returns the reader's complete NightDigest JSON object; missing returns 404; empty returns 200 with rows []; ordering equals reader ordering.
- [ ] Implement `GET /api/digest/:night` by serializing the same reader result. Do not duplicate sorting/aggregation.
- [ ] Register route, run tests and typecheck when reader is available, and commit linked to issue 3.

### Task 4: Status board links (issue 4)

**Files:** Modify `src/status.ts`, `src/views/status.tsx`; create `test/digest-board.test.tsx`.

**Interfaces:** Consumes `readNight` and existing `nightsOnDisk`. Preserve existing Status consumers; extend with per-night counts as needed.

- [ ] Write failing board tests for both fixture nights, correct hrefs and event counts, and empty runs directory.
- [ ] Add digest links and ok/retry/fail event counts using the reader result. Keep newest-first night order and current board content.
- [ ] Run tests and typecheck; verify both linked digests return 200 after page integration. Commit linked to issue 4.

### Task 5: Route regression tests (issue 5)

**Files:** Create `test/digest-routes.test.tsx` only, unless a concrete defect requires a report to its owner.

**Interfaces:** Consumes `createApp(config)` with a temporary runsDir, HTML route, JSON route.

- [ ] Cover both representations for normal 200, missing 404, empty night, malformed line and all-invalid night. Compare job order and values using real responses; no mocked reader.
- [ ] Cover null owners, escaped HTML and invalid/traversal night names. Restore environment and remove temporary files after tests.
- [ ] Run full tests and typecheck after implementations land; verify `git diff -- runs/` is empty. Commit linked to issue 5.

### Task 6: Review preview (issue 6)

**Files:** No preview HTML in repository. Use the private challenge artifact directory.

- [ ] Run the service locally with the private marker in ignored `.env` and save `/digest/2026-10-28` via HTTP command to one HTML file.
- [ ] Check sample rows, inline CSS, banner and absence of client scripts; visually inspect the page if tooling permits.
- [ ] Propose a specific replaceable public HTTPS host and obtain publication approval before any public deployment.
- [ ] Publish the exact HTML; fetch and compare it, then submit repo and preview with claim_challenge. Preserve all responses privately and follow the returned review instructions.

### Task 7: Cleanup (issue 7)

- [ ] Wait until the review is in. Obtain separate approval before public replacement.
- [ ] Export again with LANE_MARKER unset; verify `no marker set`, then replace the same URL and verify original marker absence.
- [ ] Archive plan.md under docs/plans/done with actual issue URLs. Commit and push the archive only when cleanup Done when holds.
- [ ] Follow course claim instructions and debrief only after the course accepts the solve.
