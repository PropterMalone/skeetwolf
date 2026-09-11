# Repeated stall warnings, 2026-09-11

After six hours of failed role DM delivery, an empty replacement queue caused
`tickDmRetries` to post the same public warning on every 30-second tick. The
expired player stayed in the retry list with no warning deduplication.

The engine was stopped first. A complete repository post scan found 25 identical
stall warnings for game `mtw2ddor`; those exact records were backed up and deleted
using their CIDs as deletion preconditions. Other posts were preserved.

The fix stores a `dm_stall_warning:<gameId>:<did>` claim in SQLite `bot_state`
before attempting the warning. This survives restarts and suppresses retries
when a posting response is lost. A failed first warning may remain unpublished;
avoiding repeated public mentions takes precedence. Pending players remain
eligible for queue replacement. The incident's existing warning was marked
claimed in production after a database backup.

Validation: all 240 tests, full `npm run validate`, and `npm run build` passed.
The new regression tests use real SQLite and cover repeated ticks, manager
recreation, and posting failures.

Production predates the shared Bluesky kit migration in this checkout. To limit
incident scope, the deployed image was derived from its existing image with only
the compiled game manager's matching warning guard and database imports patched.
The resulting image also passed an isolated, network-disabled regression check
for repeated ticks, restarts, and lost responses.

- Previous image: `skeetwolf-engine:pre-spam-20260911`
- Fixed image: `skeetwolf-engine:stall-fix-20260911`
- Fixed image ID: `sha256:14df00845731bb4bd3afa72ed66210a0be404abc1fe0390cd8e3e300615c49e1`
- Production container recreated using `docker compose up -d --no-deps --no-build engine`.
- Local incident evidence: `/tmp/skeetwolf-incident/` (post backup, database backup,
  patched module, Dockerfile, image regression script, and validation logs).

Follow-up: repair and verify the normal Docker build for the checkout's sibling
`propter-bsky-kit` file dependency before deploying the newer application release.
The current Dockerfile copies only this repository, so that sibling dependency
is absent from its build context. Do not replace the tested incident image with
an unverified full rebuild.

## Timeout persistence follow-up

Restart hydration also reset every pending player's six-hour timeout. Game state
now persists `pendingDmStartedAt` per player on initial failure and after retries
or replacement. Hydration reuses those timestamps; legacy states fall back to
Night 0's `phaseStartedAt`. Successful completion clears the saved timers.
Replacement players receive their own six-hour window, preserved across restarts.

All 243 tests, full validation, and build passed. Three new real-SQLite regression
cases cover the original deadline, legacy saves, and a replacement's deadline.
The production image passed separate network-disabled tests for those deadlines
and for the previous warning deduplication fix.

Deployed image: `skeetwolf-engine:timeout-fix-20260911`, ID
`sha256:b03524a0a3a36414b6a9392601855bae4c012fbac1229e895782194bf21995f3`.
As with the initial incident fix, only the matching compiled manager changes were
applied to the existing production release. Evidence and database backup are in
`/tmp/skeetwolf-timeout-fix/`. The live game's persisted timeout was verified as
already expired, with no replacement queued; the next queued replacement can be
selected without another six-hour wait.
