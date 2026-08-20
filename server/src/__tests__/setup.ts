// kvStore.ts opens its SQLite database at import time from SQLITE_PATH.
// Point it at a throwaway file per test run so tests never read or write the
// real data.db (which in production holds the live leaderboard).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.SQLITE_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'shadowcipher-test-')), 'test.db');
