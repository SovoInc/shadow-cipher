# Deployment Procedure

Shadow Cipher deploys to a single **AWS EC2** instance via **GitHub Actions**
(`.github/workflows/deploy.yml`). There is no Vercel involved.

## Overview

**Trigger:** every push to `main`, or manually via **Actions → Deploy → Run workflow**
(`workflow_dispatch`).

The workflow has no test or lint gate — whatever lands on `main` goes straight to
production.

### Pipeline steps

1. **Checkout + Node 22** (`actions/setup-node`, npm cache).
2. **Install dependencies** — `package-lock.json` is deleted first and `npm install` is
   run. This works around an npm optional-deps bug (the lockfile was generated on
   darwin-arm64, so the Linux rollup native addon is missing from it —
   [npm/cli#4828](https://github.com/npm/cli/issues/4828)). Consequence: CI installs from
   an **unpinned** dependency graph; builds are not reproducible.
3. **Build** — `npm run build-production` (contract `tsc` build, then the frontend Vite
   build, which first copies the ZK key/zkir artifacts into
   `frontend-vite-react/public/midnight/shadowcipher/`). The frontend build receives
   `VITE_CONTRACT_ADDRESS` and `VITE_SPONSOR_URL` from repo secrets.
4. **Deploy to EC2** over SSH as `ec2-user`, into `/opt/shadow-cipher/`:
   - Writes a **fresh `.env`** on the box from repo secrets
     (`PORT=3003`, `WALLET_SEED`, `SHADOWCIPHER_CONTRACT_ADDRESS`, `MIDNIGHT_NETWORK`,
     `PROOF_SERVER_URL`, `SQLITE_PATH=/opt/shadow-cipher/data.db`, `POOL_TARGET_SIZE`).
   - `rsync --delete` the frontend build → `/opt/shadow-cipher/dist/` (served statically
     by nginx, which also reverse-proxies `/api` to the sponsor server).
   - `rsync --delete` the server TypeScript source → `/opt/shadow-cipher/server/`
     (no compile step — PM2 runs it directly with `tsx/esm`, see
     `server/ecosystem.config.cjs`).
   - `rsync --delete` the contract package → `/opt/shadow-cipher/shadowcipher-contract/`
     (the runtime needs `src/managed/` for ZK keys).
   - Copies root `package.json` / `package-lock.json` / `turbo.json`, then on the box:
     `rm -f package-lock.json && npm install` (dev deps included — tsx is a devDependency),
     then `pm2 reload shadow-cipher-sponsor --update-env || pm2 start server/ecosystem.config.cjs`
     and `pm2 save`.
   - Ensures the shared **proof server** systemd unit is active
     (`sudo systemctl start proof-server` — the unit is shared with other apps on the box).
5. **Health check** — see the limitation below.

## Required GitHub repo secrets

| Secret | Purpose |
|---|---|
| `EC2_HOST` | Hostname/IP of the EC2 instance |
| `EC2_SSH_KEY` | Private SSH key for `ec2-user` |
| `WALLET_SEED` | Sponsor wallet seed (mainnet — treat as highly sensitive) |
| `SHADOWCIPHER_CONTRACT_ADDRESS` | Deployed contract address (unset ⇒ server deploys a new contract on boot) |
| `MIDNIGHT_NETWORK` | Target network — **must be set to `mainnet`**, see caveat below |
| `PROOF_SERVER_URL` | Proof server endpoint (defaults to `http://localhost:6300`) |
| `POOL_TARGET_SIZE` | Game pool size (defaults to `20`) |
| `VITE_CONTRACT_ADDRESS` | Frontend build-time contract address (UI display) |
| `VITE_SPONSOR_URL` | Frontend build-time sponsor URL (blank ⇒ same-origin via nginx) |

### Network default caveat

If the `MIDNIGHT_NETWORK` secret is missing, the workflow writes
`MIDNIGHT_NETWORK=preprod` into the box's `.env` (`deploy.yml` uses
`${MIDNIGHT_NETWORK:-preprod}`), and `server/src/config.ts` likewise defaults to
`preprod`. The application is mainnet-only, so a missing secret **silently deploys
against the wrong network** instead of failing loudly. Always verify the secret is set.

## Health-check limitation

The final step only greps PM2 output:

```
pm2 status shadow-cipher-sponsor | grep -E "online|launched"
```

It deliberately does **not** curl `/api/status`, because on startup the sponsor wallet
SDK syncs DUST, which can take **several minutes** before port `:3003` is bound. Combined
with the `sleep 5` and PM2's `restart_delay: 5000` / `max_restarts: 10`, a crash-looping
server can still pass this check and the deploy can report green while the API is
unreachable.

**After every deploy**, watch the startup by hand:

```bash
ssh ec2-user@<EC2_HOST>
pm2 logs shadow-cipher-sponsor --lines 50   # watch dust sync progress
curl -s localhost:3003/api/status | jq      # once the port is bound
```

## Manual deployment

Two options:

1. **Re-run the pipeline:** the workflow declares `workflow_dispatch`, so trigger it from
   the GitHub UI (**Actions → Deploy → Run workflow**) without pushing a commit. This is
   the preferred manual path — it uses the exact same steps and secrets.
2. **By hand:** replicate the workflow — build locally
   (`npm install && npm run build-production` with the `VITE_*` vars exported), rsync
   `frontend-vite-react/dist/`, `server/` and `shadowcipher-contract/` to
   `/opt/shadow-cipher/` as above, ensure `/opt/shadow-cipher/.env` is correct, then on
   the box run `npm install` and `pm2 reload shadow-cipher-sponsor --update-env` (or
   `pm2 start server/ecosystem.config.cjs`). Do not edit files on the box directly — the
   next CI run rsyncs with `--delete` and will overwrite them.

## Runtime layout on the box

```
/opt/shadow-cipher/
├── .env                      # written by CI from secrets (contains WALLET_SEED)
├── data.db                   # SQLite: pool, sessions, players (SQLITE_PATH)
├── dist/                     # frontend static build (served by nginx)
├── server/                   # sponsor server TS source, run via tsx under PM2
│   ├── ecosystem.config.cjs  # PM2 app: shadow-cipher-sponsor
│   ├── scripts/              # operational scripts (leaderboard repair)
│   └── wallet-cache/         # derived wallet state — safe to delete, see below
└── shadowcipher-contract/    # contract package incl. src/managed ZK artifacts
```

The instance is shared with the sibling **guess-who** deployment at
`/opt/proof-of-spy/` (PM2 app `proof-of-spy`) and one `proof-server` systemd unit
serves both. Restarting the box affects both games.

## Operational runbook

### The deploy is green but the API does not answer

Expected during a normal restart: the sponsor wallet syncs DUST before binding its
port, which takes minutes. PM2 reports `online` throughout, and the deploy's health
check only greps PM2 — so a green deploy does **not** mean the API is serving.

```bash
curl -s localhost:3003/api/status            # the real check
pm2 logs shadow-cipher-sponsor --lines 40    # watch "Syncing dust: N%"
```

If the percentage climbs, wait. If it sits at `0% (<n>/0)` and the error log shows

```
values inserted non-linearly into dust generation tree;
expected to insert index 12848, but received 12839
```

the cached wallet state is stale — typically after the instance was stopped or lost
connectivity. The cache is derived data rebuilt from chain, so clearing it is safe
(the seed lives in `.env`); a full resync then takes a while:

```bash
pm2 stop shadow-cipher-sponsor
mkdir -p ~/wallet-cache-backup-$(date +%F-%H%M%S)
cp /opt/shadow-cipher/server/wallet-cache/mainnet-*.json ~/wallet-cache-backup-*/
rm -f /opt/shadow-cipher/server/wallet-cache/mainnet-*.json
pm2 restart shadow-cipher-sponsor --update-env
```

Do not restart again while the resync is running — it starts over from 0%.

### Bring the two wallets up one at a time

The box cannot sync both sponsor wallets at once. Each syncing wallet holds ~1.5 GB of
the t3.medium's 3.8 GB, and with both running there is no headroom: one app's sync
repeatedly drops its RPC connection and restarts from 0% while the other progresses.

The two apps use **different** wallet seeds, so the sync cannot be shared — each wallet
scans the chain for its own UTXOs and dust. (The `proof-server` on port 6300 *is* shared
by both, which is the expensive common component.)

**After any restart of both apps — which every deploy does — sequence them:**

```bash
pm2 stop shadow-cipher-sponsor              # or proof-of-spy, whichever can wait
free -m                                     # expect ~1.8 GB available

# wait for the running one to finish and bind its port
pm2 logs proof-of-spy --lines 20 --nostream --out | grep "Syncing dust"
curl -s localhost:3003/api/status            # shadow-cipher, once it is the live one

pm2 start shadow-cipher-sponsor              # only after the first is serving
```

### Reading sync progress correctly

Note the log filenames do **not** match the PM2 app names: the app is
`shadow-cipher-sponsor` but its logs are `~/.pm2/logs/shadow-cipher-{out,error}.log`
(the sibling app's are `proof-of-spy-{out,error}.log`, which does match). Resolve it with
a glob rather than guessing: `ls ~/.pm2/logs/*shadow*`.

**`pm2 logs ... | tail` lies about the percentage.** The progress line is written with
carriage returns rather than newlines, so the log tail shows a stale value that can
appear frozen for many minutes while the sync is advancing normally. Split on CR:

```bash
tail -c 4000 ~/.pm2/logs/shadow-cipher-out.log | tr '\r' '\n' \
  | grep -oE 'Syncing dust: [0-9]+% \([0-9]+/[0-9]+\)' | tail -1
```

Cross-check that the process is actually working — a wallet mid-sync sits well above
100% CPU:

```bash
ps -o pid,pcpu,etimes,rss -p $(pgrep -f shadow-cipher | head -1)
```

A full mainnet sync is slow, so allow plenty of time before concluding something is
wrong. A percentage climbing (`8% → 9% → 10%`) is healthy. A percentage that genuinely
resets to `0% (<n>/0)` and stays there points at a stale cache; one that merely looks
stuck in `pm2 logs` almost certainly is not.

**A healthy wallet cache makes restarts cheap.** Once a wallet finishes syncing it writes
its state to `server/wallet-cache/mainnet-<hash>.json` (roughly 500 KB when synced, versus
~8 KB for a fresh one). A later restart restores from that file instead of rescanning the
chain, so a routine deploy does *not* incur another full sync — only a cold start after
the cache has been deleted or invalidated does. This is why the cache should only be
cleared when it is genuinely corrupt (see the dust-tree error above), never as a
speculative fix.

### The instance is unreachable over SSH

Check the AWS status first; a failed *reachability* check is an AWS-side fault, not a
firewall or key problem:

```bash
aws ec2 describe-instance-status --region us-east-2 \
  --instance-ids i-0364549066b2aab49 \
  --query 'InstanceStatuses[].{Sys:SystemStatus.Status,Inst:InstanceStatus.Status}'
```

`impaired` with `reachability: failed` is cleared by a **stop/start**, which moves the
instance to different hardware; a plain reboot usually does not. The public address is
an Elastic IP, so it survives and no DNS change is needed. **Snapshot the root volume
first** — see below. Note that `games.sovo.com` resolves to CloudFront, so the site
answering `200` says nothing about the origin being healthy.

### Backups — action required

The root volume (`vol-01ca8f98b7bf06c19`) holds the SQLite database and the sponsor
wallet cache, and is flagged delete-on-termination. It had **no snapshots at all**
until `snap-0e32c606a5cd054d0` was taken manually during the August 2026 recovery.

There is still no recurring schedule, and this is the largest operational risk in the
deployment. Create one — either an AWS Backup plan, or a DLM policy (which needs the
`AWSDataLifecycleManagerDefaultRole` service role created first, as it does not yet
exist in this account):

```bash
aws dlm create-default-role --resource-type snapshot --region us-east-2
# then create a daily policy targeting the volume, with e.g. 7-day retention
```

A manual snapshot before any risky operation is the interim habit:

```bash
aws ec2 create-snapshot --region us-east-2 --volume-id vol-01ca8f98b7bf06c19 \
  --description "pre-change $(date +%F)"
```
