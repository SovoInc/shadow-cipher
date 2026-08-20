# QA Test Report — Shadow Cipher

**Date:** 2026-08-06
**Commit under test:** `707f4c7f`
**Environment:** local checkout; static analysis and code review. No live mainnet session was played against the deployed EC2 instance.

---

## 1. Summary

Shadow Cipher is a Mastermind variant on Midnight: crack a 4-position, 6-colour secret code within 10 attempts. The code is committed on-chain at game start and the final solving guess is verified by a ZK proof. A sponsor server holds the wallet and pays all fees; the browser never touches the chain.

The core design is solid: **the server is authoritative for game logic.** Peg feedback is computed server-side from the stored code (`sponsor-server.ts:206`), the secret never reaches the browser, and the attempt cap is enforced on the server. Code generation uses `crypto.randomInt`, not `Math.random`.

Against that, **the repository contains no tests of any kind**, two of the four documents describe a different project entirely, and the leaderboard double-counts every game.

| Area | Status |
|---|---|
| Contract design (commit/reveal) | Sound |
| Server-authoritative game logic | Good |
| Automated tests | **None — zero test files repo-wide** |
| CI quality gate | **None** — deploys unverified |
| Root documentation | **Stale — describes the counter template** |

**Recommendation:** the game logic is in reasonable shape, but the leaderboard is not trustworthy (Issue 1) and the deployment documentation would not successfully deploy the app (Issue 6). Both should be addressed before wider release.

---

## 2. Test coverage

**Zero. There are no test files anywhere in the repository.**

A search across all three workspaces for `*.test.*`, `*.spec.*`, `test/`, `tests/`, `__tests__/`, `vitest.config.*`, and `jest.config.*` returned nothing. Nothing asserts anything, so there is nothing to quote.

Test infrastructure is declared but non-functional:

| Location | Declared | Reality |
|---|---|---|
| `shadowcipher-contract/package.json:20` | `"test": "vitest run"` | No test files and no vitest config — exits "No test files found" |
| `shadowcipher-contract/package.json:21` | `"test:compile"` | Same |
| `turbo.json:13-15` | `"test"` task defined | Never invoked |
| root `package.json` | — | **No `test` script**, so `turbo run test` is unreachable and `npm test` fails |
| `server/package.json` | — | No test script |
| `frontend-vite-react/package.json` | — | No test script |

`vitest ^3.2.0` is installed as a root devDependency and unused.

**Highest-value targets, none currently covered:**

| Target | Why |
|---|---|
| `calculatePegs()` (`kvStore.ts:300-328`) | The core game rule. Pure function; duplicate-colour peg counting is exactly the logic that breaks silently |
| `recordScore()` (`kvStore.ts:240+`) | Where Issue 1 lives — non-idempotent by construction |
| Contract circuits via a simulator | `create_game` / `submit_guess` / `delete_game` are entirely unverified |
| `/api/guess` attempt-cap enforcement | Server-side rule with no regression test |

**CI.** `.github/workflows/deploy.yml` is the only workflow and has no test or lint step. It deploys to production on every push to `main`.

Two aggravating details:

- The build **deletes `package-lock.json`** (`deploy.yml:20-23`) to work around an npm optional-deps bug, so CI and production install from an unpinned dependency graph. Builds are not reproducible.
- The health check only greps PM2 for `online|launched`, and the comment explains why it cannot do better: *"We don't curl /api/status here because the sponsor wallet SDK syncs dust on startup, which can take several minutes before :3003 is bound."* Combined with `sleep 5` and `max_restarts: 10`, a crash-looping server passes the check and the deploy reports green while the API is unreachable.

---

## 3. Known issues

Ordered by impact.

### Issue 1 — Every game is counted twice on the leaderboard (High)

Two independent code paths call `recordScore()` for a single game:

1. `POST /api/declare` calls it server-side (`sponsor-server.ts:266`).
2. The client then *also* calls `submitScore` (`pages/shadowcipher/index.tsx:207`, or `:307` via the name-entry overlay), which POSTs `/api/metrics/scores` → `recordScore()` again (`leaderboardRoutes.ts:37`).

`recordScore` increments unconditionally (`kvStore.ts:253`):

```js
gamesPlayed: current.gamesPlayed + 1,
gamesWon: current.gamesWon + (won ? 1 : 0),
```

So one game adds 2 to `gamesPlayed`, and a win adds 2 to `gamesWon`.

Worse, the two paths key on **different addresses**: the server uses `address || \`DMO_${displayName}\`` (`sponsor-server.ts:264`) while the client sends `displayAddress.slice(0, 16)` (`index.tsx:278-280`). A single player can therefore be split across two leaderboard rows. All current leaderboard figures should be treated as unreliable.

### Issue 2 — Score submission is unauthenticated and client-trusted (High, security)

`POST /api/metrics/scores` accepts a result from anyone. The route's own comment concedes the point (`leaderboardRoutes.ts:30`):

```js
// POST /api/metrics/scores — record a game result (client-reported, trusted-ish)
```

Validation is limited to `attempts` being 1-10 and `won` being a boolean (lines 33-35). There is no session check, no auth, and no rate limit — anyone can curl a perfect score onto the leaderboard for any address.

This is the one place the otherwise server-authoritative design is bypassed. Since `/api/declare` already records the true result, this endpoint is largely redundant; removing it would fix Issue 1 and Issue 2 together.

### Issue 3 — Abandoned sessions permanently stall the game pool (Medium)

`incrementActiveSessions()` is called at `sponsor-server.ts:148` and `:167`; `decrementActiveSessions()` only at `:269`, inside `/api/declare`. A player who closes the tab mid-game never decrements the counter. The 1-hour TTL sweep (`kvStore.ts:126`) deletes the session row but **does not touch the in-memory counter**.

`poolWorker.ts:32-36` pauses refill whenever `isGameSessionActive()` is true, so a few abandoned games permanently disable pool generation. Subsequent players fall through to on-demand creation or demo mode. This degrades quietly, with no error in the logs.

### Issue 4 — On-chain failure is invisible to the player (Medium)

`sponsor-server.ts:256-259` catches a failed proof submission and only logs a warning; the response still returns `correct: won` with `onChain: null`. Client-side, `index.tsx:200-202` turns that into a log line while the player still sees a win.

A player in on-chain mode can win, be told they won, and have nothing recorded on-chain. Given that on-chain verification is the product's premise, this should be surfaced explicitly rather than degraded silently.

### Issue 5 — Proof progress indicators are fabricated (Medium, correctness of claims)

In local-fallback mode the UI simulates proving (`index.tsx:234-239`):

```js
const steps = ['Hashing input...', 'Applying constraints...', 'Satisfying R1CS...', 'Extracting Proof...'];
for (let i = 0; i < steps.length; i++) { addLog(steps[i], 'proof'); await sleep(400); setProgress((i + 1) * 25); }
```

followed by a plain JavaScript comparison. No proof is generated. In server mode the bar is likewise hardcoded `setProgress(25) → (75) → (100)` (`:181-190`) rather than reflecting real work. The R1CS/constraint vocabulary implies cryptographic work that is not happening.

### Issue 6 — Root documentation describes a different project (Medium)

**`README.md`** is the unmodified **EDDA Midnight Starter Template** readme. It is titled "🚀 EDDA - Midnight Starter Template", links a demo at `counter.nebula.builders`, and documents a project structure of `counter-cli/`, `counter-contract/`, and `frontend-vite-react/` — only the last of which exists. It references `counter-cli/.env_template` and `npm run setup-standalone`, neither of which exist, and targets the Preview network with a Preview faucet while the app is mainnet-only. Nothing in it mentions Shadow Cipher, the server workspace, the game, or the sponsor model.

**`DEPLOYMENT_PROCEDURE.md`** documents a **Vercel** deployment end to end. The project was migrated to AWS EC2 (commit `9d93048f`) and now deploys via SSH/rsync/PM2. There is no `vercel.json` in the tree. Every path reference is to the counter template (`counter-contract`, `/midnight/counter/keys/increment.verifier`). **Following this document would not deploy the application.**

By contrast, `docs/gameplay.md` and `docs/midnight-integration.md` are accurate, current, and detailed — I verified their claims against source and they match. Note that `git status` shows `?? docs/`: **the two good documents are untracked and uncommitted**, while the two misleading ones are tracked.

### Issue 7 — Stale ZK keys shipped to the browser (Medium)

`frontend-vite-react/public/midnight/shadowcipher/zkir/` contains keys for five circuits: the three that exist plus orphaned **`initialize`** and **`record_guess`** from an earlier contract revision. The contract source defines only three, and `shadowcipher-contract/src/managed/shadowcipher/zkir/` correctly has three.

The cause is `copy-shadowcipher-keys` (`frontend-vite-react/package.json:11`), which uses `cp -r` without clearing the target, so removed circuits are never pruned. This is precisely the mismatched-verifier-key failure mode that `DEPLOYMENT_PROCEDURE.md:109` warns about. The copy step should `rm -rf` the destination first.

### Issue 8 — `delete_game` is never called; ledger grows without bound (Medium)

The contract implements `delete_game` for storage reclamation (`shadowcipher.compact:87-101`) and `docs/midnight-integration.md:63` documents it. **It has zero callers** across the server, frontend, and contract workspaces. The `games` map grows monotonically. The circuit is compiled, keyed, shipped, and dead.

### Issue 9 — Preprod default on a mainnet-only application (Medium, deployment)

`docs/midnight-integration.md:121` states the game runs mainnet only. But `config.ts:42` and `deploy.yml:59` both default to **preprod** when `MIDNIGHT_NETWORK` is unset. A missing CI secret silently deploys against the wrong network rather than failing loudly.

Related: `leaderboardRoutes.ts:153,192` hardcode `caip2: 'midnight:preview'` in two API responses while the app runs mainnet — the wrong chain identifier is served to clients.

### Issue 10 — Contract does not constrain the guess domain (Low)

`submit_guess` accepts `Uint<8>` (0-255) per position while the game domain is 0-5, with no range assertion. Out-of-domain guesses simply prove false rather than being rejected. Harmless today because the server constructs the guess, but the circuit does not enforce the rule it appears to.

Similarly, the contract holds no attempt counter — the 10-attempt cap exists only on the server (`sponsor-server.ts:202-204`). The chain sees only the final winning guess.

### Issue 11 — Documented achievement not implemented (Low)

`docs/gameplay.md:101` documents a "Speed Run" achievement. `getPlayerAchievements` (`leaderboardStore.ts:47-54`) awards only `first_crack`, `perfect_solver`, `on_chain_player`, and `persistence`; no timing data is stored anywhere. Because it remains in the catalogue (`leaderboardStore.ts:35`), it will permanently report 0% completion.

### Issue 12 — Proof-server health check always passes (Low)

`wallet-widget/utils/proofServer/utils.ts:11-16` has its actual assertion commented out and returns unconditionally:

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

- `index.tsx:218` — `} catch { /* ignore */ }` around the **loss-path** `declareAnswer`. A failed call means the game is silently unrecorded.
- `index.tsx:466` — `.catch(() => {}); // Silently fail if API unavailable`
- `api.ts:479`, `:516` — dust-cache save failures swallowed, firing every 15 s and 30 s.
- `api.ts:405-407` — corrupt wallet-cache JSON silently treated as "no cache".
- `kvStore.ts:127` — the expired-session sweep swallows all errors and can fail permanently unnoticed.
- `sponsor-server.ts:304` — a database error is reported to clients as "pool is empty".

---

## 5. What is working well

Worth recording, since the issue list above is necessarily one-sided:

- **The server is authoritative.** Peg feedback, the secret code, and the attempt cap all live server-side; the browser never receives the answer. This is the right architecture and is implemented correctly.
- **Cryptographically sound randomness** — `randomUUID`, `randomBytes`, and `randomInt` from `node:crypto` throughout `kvStore.ts`.
- **The commit-then-reveal contract design is correct.** The commitment is computed inside the circuit from the private witnesses, so it cannot diverge from what `submit_guess` verifies.
- **`docs/gameplay.md` and `docs/midnight-integration.md` are genuinely good** — accurate, current, and honest about limitations such as the single-DUST-coin throughput ceiling. They should be committed to git.

---

## 6. Suggested priorities

1. Remove the client-side `submitScore` path, or make `recordScore` idempotent per session — fixes Issues 1 and 2 together.
2. Decrement `activeGameSessions` in the TTL sweep (Issue 3).
3. Replace `README.md` and `DEPLOYMENT_PROCEDURE.md`, and commit `docs/` (Issue 6).
4. Add `rm -rf` to the key-copy step (Issue 7).
5. Add a CI job running typecheck and lint before deploy, and restore lockfile-based installs.
6. Surface on-chain failure in the UI instead of degrading silently (Issue 4).
7. Add tests for `calculatePegs` and `recordScore` — both are pure and cheap to cover.
