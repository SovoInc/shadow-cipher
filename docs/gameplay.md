# How to Play Shadow Cipher

Shadow Cipher is a code-breaking game — a Mastermind variant — where you crack a
hidden 4-color secret code within 10 attempts. Each guess earns you feedback,
and you use that feedback to deduce the code. On-chain, the secret is committed
with a zero-knowledge proof, so the game can verify your guesses without ever
revealing the code until you've solved it.

## The Goal

Crack the **4-position secret code** in **10 attempts or fewer**. Each position
is one of **6 colors** (RED, BLUE, YELLOW, GREEN, PURPLE, ORANGE). The secret is
generated randomly (cryptographically secure) at game start and stored
server-side — it is never sent to your browser.

## Modes

| Mode | Description |
|---|---|
| **On-chain** | Plays against a pre-generated game committed on the Midnight chain; your solving guess is verified by a ZK proof. |
| **Demo** | A local game (no wallet, no chain). Used as the fallback if the on-chain pool is empty. |

See [midnight-integration.md](./midnight-integration.md) for the on-chain side.

## A Turn (Guess Cycle)

1. **Build a guess** — click the 4 input circles to cycle each through the 6
   colors.
2. **Submit** — press SUBMIT. The game shows a proving progress bar while the
   guess is checked.
3. **Read the feedback** — each guess returns two counts (Mastermind "pegs"):

   | Feedback | Meaning |
   |---|---|
   | **Black peg** `✓` (green) | Right color **and** right position. |
   | **White peg** `~` (yellow) | Right color, **wrong** position. |

4. **Deduce and repeat** — use the pegs to refine your next guess.

Feedback is computed with the standard Mastermind algorithm: exact (black)
matches are counted first and removed, then remaining colors are matched for
position-independent (white) pegs. So black + white never exceeds 4.

## Winning and Losing

| Outcome | Condition |
|---|---|
| **Win** | A guess returns **4 black pegs** — all colors in the right positions ("CIPHER_CRACKED"). |
| **Lose** | You reach **10 attempts** without solving ("ACCESS_REVOKED"). |

After the game ends (win or loss at attempt 10), an arcade-style **3-character
name entry** overlay appears so you can record your result to the leaderboard.

## Limits

| Limit | Value |
|---|---|
| Code length | **4 positions** |
| Colors per position | **6** |
| Maximum attempts | **10** |
| Session lifetime | **1 hour** (3600s) |

## Scoring

Shadow Cipher scores by **efficiency, not points** — your score is the **number
of attempts** it took you to win, and **lower is better**. There are no
multipliers, streaks, or time bonuses; only the attempt count matters, and a
loss is not scored toward your best.

### What's tracked per player

| Field | Meaning |
|---|---|
| `best_score` | Fewest attempts in any winning game (0 if never won). |
| `games_played` | Total games played. |
| `games_won` | Total wins. |

A new best is recorded only when you **win** and either have no best yet or beat
your previous attempt count.

### Leaderboards

Two ranked channels:

1. **Fewest Attempts** — winners ranked by `best_score` ascending (fewest first).
   Unit: "Attempts".
2. **Games Played** — all players ranked by `games_played` descending. Unit:
   "Games".

A score record includes your wallet address (or `DMO_<name>` in demo mode),
display name, attempts (1–10), win/loss, and mode (`on-chain` / `demo`).

### Achievements

| Achievement | Unlocks when |
|---|---|
| **First Crack** | Win any game. |
| **Perfect Solver** | Win in ≤ 4 attempts. |
| **On-Chain Player** | Complete a game in on-chain mode. |
| **Persistence** | Play 10+ games. |
| **Speed Run** | Solve in under 60 seconds. |

## Game Flow at a Glance

```
Boot screen → choose mode (on-chain or demo)
   → terminal boot sequence → start session
   → [guess: pick 4 colors → SUBMIT → read black/white pegs]
   → repeat (up to 10 attempts)
       ↳ 4 black pegs        → WIN  ("CIPHER_CRACKED")
       ↳ 10 attempts, no win → LOSE ("ACCESS_REVOKED")
   → arcade name entry → score + achievements recorded → leaderboard
```
