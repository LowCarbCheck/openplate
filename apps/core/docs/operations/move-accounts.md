# Moving accounts to another instance

This procedure moves accounts from one openplate-core database to another. The original database is the source. The destination database is the target. Each moved user keeps their password, their recovery code, and their diary. Only the address of the app changes.

Read this entire page before you run any command. The move changes the target's `SERVER_SECRET`. The order of the steps is critical.

## What the tool does

`node dist/move-accounts.js` is in the core image, next to `dist/server.js`. Run it on the database host in a temporary container of that image. This keeps the two secrets on the host.

- It reads the source in one read-only snapshot. It never writes to the source.
- It runs as a dry run unless you add `--apply`. A dry run also keeps the target read-only.
- It keeps every account id. It moves an account only when the target has the same id and address free. It rejects any other account and reports it. It never merges accounts, and it never assigns a new id.
- It writes each account in an isolated transaction. It then reads back the rows and compares them with the source. It compares row counts, a digest of each row, and a SHA-256 hash of each blob. Postgres calculates these hashes on both sides. The tool rolls back the account if it finds any difference.
- A second run with `--apply` detects existing work and writes nothing.
- It prints account ids and counts. It never prints a full address, secret, key, or database URL.

The header of `src/move-accounts.ts` lists each table. It explains why each table moves or stays. In short, the tool moves the account row and its key records. It moves all blob versions and AI usage days. It also moves feedback reports, photos, legal declarations, and study withdrawals. A share or research contribution moves only when both accounts move. Sessions, reset links, push subscriptions, invites, and instance totals stay on the source.

## Why the target takes the source's secret

Two items on an account row belong to one instance.

1. **The password verifier.** It is an HMAC under a key derived from `SERVER_SECRET`. The server never holds the input it needs to recalculate this value. Therefore, the target must run with the source's `SERVER_SECRET` after the move. Moved verifiers, recovery verifiers, and escrows copy without changes.
2. **The account id.** The app binds this id into the encryption of every blob. A new id makes the diary unreadable. Therefore, the tool keeps the ids.

An account already on the target was created under the target's old secret. The tool re-seals its escrowed recovery code under the new secret. It also recalculates its recovery verifier. It cannot recalculate its password verifier. **Each such account needs one mailed password reset after the switch.** The user clicks "forgot password" in the app. Their diary stays.

## The settings

The tool reads four values from the environment. It provides no command flag for these values:

| Variable                   | Value                                                  |
| -------------------------- | ------------------------------------------------------ |
| `SOURCE_DATABASE_URL`      | the source database. The tool only reads it.           |
| `TARGET_DATABASE_URL`      | the target database.                                   |
| `SOURCE_SERVER_SECRET`     | the source's `SERVER_SECRET`. The target adopts it.    |
| `TARGET_OLD_SERVER_SECRET` | the target's `SERVER_SECRET` today, before the switch. |

Flags: `--dry-run` (the default), `--apply`, `--skip-email <address>` (repeat it for more addresses), `--label <text>` (default `Beta supporter`), `--daily-ai-limit <n>` (default `10`).

Each moved account receives the daily AI limit, no allowance end date, no scan trial, and the label. The health-consent record remains unchanged.

Exit status: `0` means the proofs hold (dry run) or all planned tasks succeeded (apply). `1` means the tool refused the whole run, or an account rolled back. An account that the plan refuses (id or address taken) does not change the exit status. `2` means a usage error.

## Before the day

1. **Release the tool.** Create the core release that contains this page and `accounts.label` (migration 0024). Verify that its image tag exists on GHCR.
2. **Upgrade the target first.** Deploy that release to the target instance. It applies migration 0024 during boot. The tool rejects a target without `accounts.label`. The source can remain on 0.26.1.
3. **Make a canary on the source.** Invite a test address on the source instance using the normal process. Sign up in the source app with a saved passphrase. Log one food item so the account has a blob. Record the account id. You can also run `pnpm seed:test-account` in `apps/app` with `--url <source> --allow-remote`. This command uses the same invite and sign-up path.
4. **Know the owner address** if the owner has an account on both instances. Provide the address with `--skip-email`.

## The production sequence

Run every command on the database host. The examples use the container names `openplate-core` (source), `openplate-core-consumer` (target), and `postgres` on the Docker network `services`. Replace `<version>` with the release from step 1 above.

### 1. Back up both databases

```bash
umask 077
mkdir -p ~/move-backup && cd ~/move-backup
docker exec postgres pg_dump -U app -Fc openplate_sync > source-before-move.dump
docker exec postgres pg_dump -U app -Fc openplate_core_consumer > target-before-move.dump
ls -l
```

Store the target's current `SERVER_SECRET` with `target-before-move.dump`. You can restore that dump only under the old secret.

### 2. Stop the source core

```bash
docker stop openplate-core
```

Users cannot write to the source now. The source app displays a sync error until the accounts move.

### 3. Write the settings file into memory

Read the values from the two containers. This step also works on a stopped container. Read `TARGET_OLD_SERVER_SECRET` now, before the switch.

```bash
umask 077
ENVF=/dev/shm/move-accounts.env
{
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' openplate-core |
    sed -n 's/^DATABASE_URL=/SOURCE_DATABASE_URL=/p; s/^SERVER_SECRET=/SOURCE_SERVER_SECRET=/p'
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' openplate-core-consumer |
    sed -n 's/^DATABASE_URL=/TARGET_DATABASE_URL=/p; s/^SERVER_SECRET=/TARGET_OLD_SERVER_SECRET=/p'
} > "$ENVF"
cut -d= -f1 "$ENVF"
```

The last command must print only the four variable names.

### 4. Dry run

```bash
docker run --rm --network services --env-file "$ENVF" \
  ghcr.io/lowcarbcheck/openplate-core:<version> \
  node dist/move-accounts.js --dry-run --skip-email '<owner address>' \
  --label 'Beta supporter' --daily-ai-limit 10
```

Review the output line by line:

- Each source account displays `moves`, `skipped`, or `refused` with a reason.
- Each moving account displays `escrow opens under SOURCE_SERVER_SECRET`.
- Each retained target account displays that it re-seals, and shows `ONE MAILED RESET after the switch`.
- The id sequence advances past the highest source id.
- The last line is `result: every proof holds; nothing was written.`

Do not continue if the exit status is not `0`.

### 5. Apply, then apply again

```bash
docker run --rm --network services --env-file "$ENVF" \
  ghcr.io/lowcarbcheck/openplate-core:<version> \
  node dist/move-accounts.js --apply --skip-email '<owner address>' \
  --label 'Beta supporter' --daily-ai-limit 10
```

Each moved account displays `moved`, its counts, and `blob hashes match`. The final line displays `result: <n> accounts moved`. Run the same command a second time. It must display `result: 0 accounts moved`.

If an account displays `ROLLED BACK`, the message names the table. Fix the problem and run `--apply` again. The tool skips completed accounts.

### 6. Switch the target's secret

In the deployment configuration, set the target's `SERVER_SECRET` to the source's value. In a Bay deployment, point the target service's `SERVER_SECRET` to the source's vault key. Retain the old key in the vault for the backup dump. Commit and push the change.

Recreate the target container with your standard deploy command. Verify that both containers share the secret without printing it:

```bash
for c in openplate-core openplate-core-consumer; do
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c" |
    sed -n 's/^SERVER_SECRET=//p' | sha256sum | cut -c1-12
done
docker ps --format '{{.Names}} {{.Status}}' | grep openplate-core
```

The two hashes must match. A full deployment might start the stopped source core again. If `openplate-core` starts, stop it with `docker stop`. Retire the container in the deployment configuration.

### 7. Verify

1. Confirm that `curl -s https://<target api>/health` reports the new release.
2. Sign in to the target app with the canary address and passphrase. Confirm your food entry appears.
3. For each existing target account, select "forgot password". Open the email and set a new password. Confirm that the diary data appears.
4. Run `pnpm sync-api accounts list` against the target. Confirm it displays the moved accounts with their ids and the new daily limit.

### 8. Clean up

```bash
shred -u /dev/shm/move-accounts.env
```

Delete the canary account on the target with `pnpm sync-api accounts delete <id> --yes`. Retain the database backups until you verify stability, then remove them.

## If something goes wrong

- **Before the switch (step 6):** Restore the target from `target-before-move.dump` with `pg_restore --clean`. Start the source core again. The source data did not change.
- **After the switch:** Set the target's `SERVER_SECRET` back to its original value. Recreate the container. Restore `target-before-move.dump`. Start the source core again.
- **A refused account** remains on the source. The output identifies the conflict on the target. Resolve the conflict manually. Never give the account a new id.
