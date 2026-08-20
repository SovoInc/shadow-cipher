# QA Test Report — Shadow Cipher

**Date:** 2026-08-20
**Baseline reviewed:** `9aa28622`; the fixes recorded below are included in this revision.
**Environment:** local checkout; static analysis and code review. No live mainnet session was played against the deployed EC2 instance.

> **Status:** the High-severity leaderboard defects (Issues 1 and 2), the pool-stalling
> session leak (Issue 3), the stale ZK keys (Issue 7), and the misleading root
> documentation (Issue 6) have been resolved. Each is marked **Resolved** below with the
> fix applied. A unit-test suite and a CI quality gate have also been added, closing the
> zero-coverage finding in §2. Remaining open issues are Medium and Low.

---

## 1. Summary

Shadow Cipher is a Mastermind variant on Midnight: crack a 4-position, 6-colour secret code within 10 attempts. The code is committed on-chain at game start and the final solving guess is verified by a ZK proof. A sponsor server holds the wallet and pays all fees; the browser never touches the chain.

The core design is solid: **the server is authoritative for game logic.** Peg feedback is computed server-side from the stored code (`sponsor-server.ts:206`), the secret never reaches the browser, and the attempt cap is enforced on the server. Code generation uses `crypto.randomInt`, not `Math.random`.

| Area | Status |
|---|---|
| Contract design (commit/reveal) | Sound |
| Server-authoritative game logic | Good |
| Leaderboard integrity | Fixed — single server-side write path |
| Automated tests | 28 tests covering the core game rule, the scoring path, and API compatibility |
| CI quality gate | Tests and typecheck gate the deploy |
| Root documentation | Rewritten to match the shipped app |

**Recommendation:** the leaderboard and documentation blockers are resolved, the game logic is in good shape, and a regression in either the peg calculation or the scoring path now fails CI before it can deploy. The contract circuits remain unverified by tests (they need a simulator harness), and the leaderboard's historical rows still carry the pre-fix inflation described in Issue 1 — that data cleanup is the one action outstanding before the leaderboard can be presented as accurate.

---

## 2. Test coverage

The repository previously contained **no tests of any kind** — a search across all three workspaces for `*.test.*`, `*.spec.*`, `test/`, `tests/`, and `__tests__/` returned nothing, the declared `test` scripts pointed at no files, and the root `package.json` had no `test` script at all, so `npm test` failed outright.

**A unit-test suite now covers the highest-risk paths — 28 tests, all passing (`npm test`):**

| Suite | Covers |
|---|---|
| `server/src/__tests__/calculatePegs.test.ts` | The core game rule: exact and empty cases, mixed positions, and the duplicate-colour counting that breaks silently (a repeated guess colour must not score twice against one occurrence; black pegs must win over white for the same colour). Includes symmetry and "four black pegs only for an identical code" invariants swept over the domain. |
| `server/src/__tests__/scoring.test.ts` | The scoring path: one game counts once, losses never count as wins, one row per address, best-score tracking across wins and losses, and that `updateDisplayName` renames a row without touching any counter or creating one. Ends with the real declare-then-name demo flow, asserting one game yields one row. |

| `server/src/__tests__/apiCompat.test.ts` | That every endpoint consumed by the external site stays mounted (`/metrics`, `/metrics/users/:address`, `/metrics/:channel`, both `/achievements/*` paths, and `POST /metrics/scores`), and that the specific `/metrics` paths are registered before the `/metrics/:channel` catch-all that would otherwise swallow them. |

The suite runs against a throwaway SQLite database (`setup.ts` redirects `SQLITE_PATH` to a temp file), so it never touches the live `data.db`.

Both suites were verified to fail on the defects they guard: reintroducing the double-increment fails the accumulation test, and breaking duplicate-colour handling fails the peg tests.

**Still uncovered:**

| Target | Why it matters |
|---|---|
| Contract circuits via a simulator | `create_game` / `submit_guess` / `delete_game` remain entirely unverified |
| `/api/guess` attempt-cap enforcement | Server-side rule; needs an HTTP-level or extracted-handler test |
| The `/api/declare` handler end to end | The scoring inputs are tested; the handler wiring around them is not |

**CI.** `.github/workflows/deploy.yml` now runs a `test` job — unit tests plus server and contract typechecks — and the `deploy` job declares `needs: test`, so a failing test or a new type error stops the release rather than reaching production.

Two limitations remain in the pipeline:

- The build **deletes `package-lock.json`** (`deploy.yml:20-23`) to work around an npm optional-deps bug, so CI and production install from an unpinned dependency graph. Builds are not reproducible.
- The health check only greps PM2 for `online|launched`, and the comment explains why it cannot do better: *"We don't curl /api/status here because the sponsor wallet SDK syncs dust on startup, which can take several minutes before :3003 is bound."* Combined with `sleep 5` and `max_restarts: 10`, a crash-looping server passes the check and the deploy reports green while the API is unreachable.

### Deployment status

The unpinned install above is not a theoretical risk — **it is currently breaking the production build.** The frontend build fails in CI with:

```
error during build:
[vite-plugin-top-level-await] missing field `type`
    at Compiler.printSync (node_modules/@swc/core/index.js:257:29)
```

The same build succeeded locally against the committed lockfile, so CI had resolved a newer `@swc/core` (1.16.1) that `vite-plugin-top-level-await` cannot consume, while the lockfile pins 1.15.8. Because the workflow deletes `package-lock.json` before installing, the pipeline picked up that incompatible version on its own, with no code change involved.

**Fixed** by pinning `@swc/core` to 1.15.8 in the root `overrides`, which holds even when the lockfile is deleted. Verified by reproducing CI's conditions exactly — cloning the repo, deleting `package-lock.json`, installing, and running `build-production`, which now succeeds. The build step passes in CI.

Restoring lockfile-based installs remains the better long-term fix, since the override treats one symptom of an unpinned graph. The npm optional-deps bug the deletion works around is better handled by committing a lockfile that includes the Linux rollup binary (`npm install --os=linux --cpu=x64`, or an `optionalDependencies` entry) than by discarding version pinning entirely.

**The deploy is now blocked one step later, at the EC2 connection:**

```
ssh: connect to host *** port 22: Connection timed out
```

**The instance itself is healthy** — the sibling deployment on the same box answers HTTPS `200` and port 443 accepts connections, while port 22 times out from GitHub Actions runners and from a local machine alike. That points at **SSH ingress** (most likely a security-group rule that no longer admits the runners) rather than a stopped instance or a stale `EC2_HOST`. The same failure blocks the sibling guess-who repository, so one infrastructure fix covers both.

Suggested fix, in order of likelihood: confirm port 22 ingress on the instance's security group; if it was restricted to specific addresses, either widen it to GitHub's published Actions ranges or switch the deploy to a self-hosted runner, AWS SSM Session Manager, or a bastion. **Until then the live site does not reflect any of the fixes in this report.**

The `test` job runs before the deploy job and passes, so the quality gate is not what is blocking the release.

---

## 3. Known issues

Ordered by impact.

### Issue 1 — Every game is counted twice on the leaderboard (High) — **Resolved**

Two independent code paths called `recordScore()` for a single game:

1. `POST /api/declare` calls it server-side (`sponsor-server.ts:266`).
2. The client then *also* calls `submitScore` (`pages/shadowcipher/index.tsx:207`, or `:307` via the name-entry overlay), which POSTs `/api/metrics/scores` → `recordScore()` again (`leaderboardRoutes.ts:37`).

`recordScore` increments unconditionally (`kvStore.ts:253`):

```js
gamesPlayed: current.gamesPlayed + 1,
gamesWon: current.gamesWon + (won ? 1 : 0),
```

So one game added 2 to `gamesPlayed`, and a win added 2 to `gamesWon`.

Worse, the two paths keyed on **different addresses**: the server used `address || \`DMO_${displayName}\`` (`sponsor-server.ts:264`) while the client sent `displayAddress.slice(0, 16)` (`index.tsx:278-280`), so a single player could be split across two leaderboard rows.

**Fix.** `POST /api/declare` is now the only path that touches `gamesPlayed`, `gamesWon`, or `bestScore`. The client's score-reporting call is gone. Where no wallet address exists the row is keyed by session (`DMO_<first-8-of-sessionId>`) rather than by display name, so the key is stable and known before the player types a name.

**Leaderboard data.** Figures accumulated before this fix remain inflated (roughly 2× on games played and won, with some players split across rows). The counters are not self-correcting, so the `players` table should be reset — or halved — before the leaderboard is presented as accurate.

### Issue 2 — Score submission is unauthenticated and client-trusted (High, security) — **Resolved**

`POST /api/metrics/scores` accepted a result from anyone. The route's own comment conceded the point (`leaderboardRoutes.ts:30`):

```js
// POST /api/metrics/scores — record a game result (client-reported, trusted-ish)
```

Validation was limited to `attempts` being 1-10 and `won` being a boolean. There was no session check, no auth, and no rate limit — anyone could curl a perfect score onto the leaderboard for any address. This was the one place the otherwise server-authoritative design was bypassed.

**Fix.** Scores are now recorded only by `/api/declare`, from the server's own evaluation of the guess against the stored secret code.

`POST /api/metrics/scores` is **retained as a compatibility endpoint**, since it is part of the published API that external callers use. It keeps its exact path and its `{ recorded, player }` response shape, and still answers 200, but it no longer writes the submitted result — it returns the player's already-recorded figures, so it can be called any number of times without inflating a counter. That closes both the forgery hole and the double-count without breaking an existing caller.

One behavioural difference for integrators: an address with no recorded game now answers `{ recorded: false, player: null }` rather than creating a row from the submitted values.

The arcade name-entry overlay (which runs *after* the game ends, so it cannot be folded into declare) uses a new endpoint, `POST /api/session/name`. It performs a rename only — `UPDATE players SET display_name … WHERE address = ?` — and can neither create rows nor alter any counter. It resolves the target row through a server-side session→address map with a 10-minute window, so a caller cannot rename an arbitrary player's row either.

**All read endpoints are unchanged** — `GET /api/metrics`, `/api/metrics/users/:address`, `/api/metrics/:channel`, `/api/achievements/public/list`, and `/api/achievements/wallet/:wallet` keep their paths and response shapes. Anything consuming the leaderboard or achievement data is unaffected.

### Issue 3 — Abandoned sessions permanently stall the game pool (Medium) — **Resolved**

`incrementActiveSessions()` was called at `sponsor-server.ts:148` and `:167`; `decrementActiveSessions()` only inside `/api/declare`. A player who closed the tab mid-game never decremented the counter, and the 1-hour TTL sweep deleted the session row without touching the in-memory counter.

Because `poolWorker.ts:32-36` pauses refill whenever `isGameSessionActive()` is true, a few abandoned games permanently disabled pool generation, quietly, with no error in the logs.

**Fix.** The TTL sweep now counts the expired sessions that hold a slot (`contract_addr IS NOT NULL`) before deleting them and releases one slot per session via a callback registered by the sponsor server, logging a warning as it does. The existing clamp in `decrementActiveSessions()` keeps the counter at or above zero.

A matching defect in the opposite direction was fixed alongside it: `/api/declare` decremented unconditionally, including for demo sessions that never incremented. The decrement is now conditional on `session.contractAddress`, so it mirrors the two increment sites exactly and the counter cannot drift low either.

### Issue 4 — On-chain failure is invisible to the player (Medium)

`sponsor-server.ts:272-275` catches a failed proof submission and only logs a warning; the response still returns `correct: won` with `onChain: null`. Client-side, `index.tsx:198-201` logs the transaction only when `declaration.onChain` is present, so a skipped proof passes silently while the player still sees a win.

A player in on-chain mode can win, be told they won, and have nothing recorded on-chain. Given that on-chain verification is the product's premise, this should be surfaced explicitly rather than degraded silently.

### Issue 5 — Proof progress indicators are fabricated (Medium, correctness of claims)

In local-fallback mode the UI simulates proving (`index.tsx:235-240`):

```js
const steps = ['Hashing input...', 'Applying constraints...', 'Satisfying R1CS...', 'Extracting Proof...'];
for (let i = 0; i < steps.length; i++) { addLog(steps[i], 'proof'); await sleep(400); setProgress((i + 1) * 25); }
```

followed by a plain JavaScript comparison. No proof is generated. In server mode the bar is likewise hardcoded `setProgress(25) → (75) → (100)` (`:179-189`) rather than reflecting real work. The R1CS/constraint vocabulary implies cryptographic work that is not happening.

### Issue 6 — Root documentation describes a different project (Medium) — **Resolved**

**`README.md`** was the unmodified **EDDA Midnight Starter Template** readme, titled "🚀 EDDA - Midnight Starter Template", linking a demo at `counter.nebula.builders` and documenting a structure of `counter-cli/`, `counter-contract/`, and `frontend-vite-react/` — only the last of which exists. It referenced `counter-cli/.env_template` and `npm run setup-standalone`, neither of which exist, and targeted the Preview network while the app is mainnet-only. Nothing in it mentioned Shadow Cipher, the server workspace, the game, or the sponsor model.

**`DEPLOYMENT_PROCEDURE.md`** documented a **Vercel** deployment end to end. The project was migrated to AWS EC2 (commit `9d93048f`) and deploys via SSH/rsync/PM2. Every path reference was to the counter template. **Following that document would not have deployed the application.**

**Fix.** Both are rewritten from the shipped code. The README now covers the game, the sponsor-server model, the real workspace layout, install/build/run steps, and a full environment-variable table (names and defaults only, no secret values) — every default verified against `config.ts`, `kvStore.ts`, `poolWorker.ts`, and `index.ts`. `DEPLOYMENT_PROCEDURE.md` is rewritten from `.github/workflows/deploy.yml` and documents the Actions trigger, the lockfile-deletion workaround and its unpinned-install consequence, the rsync/PM2 steps, the required repo secrets, the network-default caveat below, the health-check limitation, and the manual deploy path.

`docs/gameplay.md` and `docs/midnight-integration.md` were already accurate — verified against source — but untracked. They are now committed.

### Issue 7 — Stale ZK keys shipped to the browser (Medium) — **Resolved**

`frontend-vite-react/public/midnight/shadowcipher/` contained keys for five circuits: the three that exist plus orphaned **`initialize`** and **`record_guess`** from an earlier contract revision.

The cause was `copy-shadowcipher-keys` (`frontend-vite-react/package.json:11`), which used `cp -r` without clearing the target, so removed circuits were never pruned. This is precisely the mismatched-verifier-key failure mode the deployment procedure warns about.

**Fix.** The eight orphaned artifacts are deleted, and the copy step now does `rm -rf` on both destination directories before recreating and copying, so a removed circuit is pruned on every build. Verified after a full frontend build: `public/` and `dist/` contain exactly `create_game`, `submit_guess`, and `delete_game`.

### Issue 8 — `delete_game` is never called; ledger grows without bound (Medium)

The contract implements `delete_game` for storage reclamation (`shadowcipher.compact:87-101`) and `docs/midnight-integration.md:63` documents it. **It has zero callers** across the server, frontend, and contract workspaces. The `games` map grows monotonically. The circuit is compiled, keyed, shipped, and dead.

### Issue 9 — Preprod default on a mainnet-only application (Medium, deployment)

`docs/midnight-integration.md:121` states the game runs mainnet only. But `config.ts:42` and `deploy.yml:59` both default to **preprod** when `MIDNIGHT_NETWORK` is unset. A missing CI secret silently deploys against the wrong network rather than failing loudly.

Related: `leaderboardRoutes.ts:131,166` hardcode `caip2: 'midnight:preview'` in two API responses while the app runs mainnet — the wrong chain identifier is served to clients.

### Issue 10 — Contract does not constrain the guess domain (Low)

`submit_guess` accepts `Uint<8>` (0-255) per position while the game domain is 0-5, with no range assertion. Out-of-domain guesses simply prove false rather than being rejected. Harmless today because the server constructs the guess, but the circuit does not enforce the rule it appears to.

Similarly, the contract holds no attempt counter — the 10-attempt cap exists only on the server (`sponsor-server.ts:219`). The chain sees only the final winning guess.

### Issue 11 — Documented achievement not implemented (Low)

`docs/gameplay.md:101` documents a "Speed Run" achievement. `getPlayerAchievements` (`leaderboardStore.ts:47-54`) awards only `first_crack`, `perfect_solver`, `on_chain_player`, and `persistence`; no timing data is stored anywhere. Because it remains in the catalogue (`leaderboardStore.ts:35`), it will permanently report 0% completion.

### Issue 12 — Proof-server health check always passes (Low)

`wallet-widget/utils/proofServer/utils.ts:13-18` has its actual assertion commented out and returns unconditionally:

```js
// if (text.includes("We're alive 🎉!")) {
//   return true;
// }
// return false;
return true;
```

Any 2xx response is treated as a healthy proof server.

### Issue 13 — Unbounded transaction queue (Low)

`onChainQueue.ts:12` is a plain array with no maximum length and no per-entry timeout, re-sorted on every iteration (`:20`). A hung chain call stalls every queued player indefinitely with no backpressure. Given the single-DUST-coin serialisation documented in `docs/midnight-integration.md:102-110`, throughput is already capped at one transaction at a time.

### Issue 14 — Operational and hygiene notes (Low)

- `.env` at the repo root holds a plaintext **mainnet `WALLET_SEED`**. It is correctly untracked and gitignored (`.gitignore:42`), so this is not a repository leak — but the live sponsor wallet seed sits unencrypted on disk and should be handled as a secret.
- `server/src/api.ts:469-470` prints *"Fund your wallet with tNight from the Preprod faucet"* regardless of network, including on mainnet. Misleading operator output.
- The per-step timing instrumentation added in commit `7da10971` covers only `createOnChainGame` (`api.ts:114-140`). The player-facing `submitGuessOnChain` (`:142-162`) has no timing and no try/catch — the path users actually wait on is uninstrumented.
- `frontend-vite-react/public/diagnostic.html` ships a debug page in the production bundle.
- `server/src/api.ts:1` disables `no-explicit-any` for all 546 lines; `api.ts:137` casts the returned `game_id` off an `any` without checking.
- Max attempts `10` is hardcoded in four separate places and the colour count `6` in three, with no shared constant.

---

## 4. Silent failure paths

Collected because they make the above harder to diagnose in production:

- ~~`index.tsx:218` — `} catch { /* ignore */ }` around the **loss-path** `declareAnswer`. A failed call means the game is silently unrecorded.~~ **Fixed** — the failure is now surfaced in the player-visible log.
- `index.tsx:462` — `.catch(() => {}); // Silently fail if API unavailable`
- `api.ts:479`, `:516` — dust-cache save failures swallowed, firing every 15 s and 30 s.
- `api.ts:405-407` — corrupt wallet-cache JSON silently treated as "no cache".
- `kvStore.ts:143` — the expired-session sweep swallows all errors and can fail permanently unnoticed. (The sweep now also releases active-session slots per Issue 3, so a silent failure there stalls pool refill as well.)
- `sponsor-server.ts:357` — a failed `getPoolSize()` is flattened to `0`, so a database error is reported to clients as an empty pool.

---

## 5. What is working well

Worth recording, since the issue list above is necessarily one-sided:

- **The server is authoritative.** Peg feedback, the secret code, and the attempt cap all live server-side; the browser never receives the answer. This is the right architecture and is implemented correctly.
- **Cryptographically sound randomness** — `randomUUID`, `randomBytes`, and `randomInt` from `node:crypto` throughout `kvStore.ts`.
- **The commit-then-reveal contract design is correct.** The commitment is computed inside the circuit from the private witnesses, so it cannot diverge from what `submit_guess` verifies.
- **`docs/gameplay.md` and `docs/midnight-integration.md` are genuinely good** — accurate, current, and honest about limitations such as the single-DUST-coin throughput ceiling. They should be committed to git.

---

## 6. Suggested priorities

Resolved in this revision: Issues 1, 2, 3, 6, and 7 (see each entry above), plus the zero test coverage and missing CI gate from §2.

Remaining, in recommended order:

1. **Reset or halve the `players` table** before presenting the leaderboard as accurate — the Issue 1 fix stops further inflation but does not repair rows already double-counted. This is the only outstanding item that affects what the client sees.
2. Surface on-chain failure in the UI instead of degrading silently (Issue 4).
3. Replace the fabricated proof-progress vocabulary with honest status text (Issue 5).
4. Set `MIDNIGHT_NETWORK` explicitly in CI and fail loudly rather than defaulting to preprod on a mainnet app (Issue 9).
5. Restore lockfile-based installs so production builds are reproducible (`deploy.yml` deletes `package-lock.json`).
6. Add a contract-simulator test suite for the three circuits — the largest remaining coverage gap.
7. Wire up `delete_game` or drop it from the shipped circuits (Issue 8).
8. Restore the real assertion in the proof-server health check (Issue 12).
