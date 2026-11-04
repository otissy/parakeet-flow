# Customization sync: setup

Optional. It keeps your customization the same on your own installs of Parakeet Flow, through a Supabase project you own.
Without it nothing changes: while the switch is off the app makes no network call for sync. What goes and what never goes: see "Sync your customization" in the [README](../README.md); the exact list is `src/sync/allowlist.js`.

The app and this repo contain no database address or key.

## One-time setup in Supabase

1. **Create a project** at <https://supabase.com/dashboard> (the free tier is enough). Pick a region close to you. The app never needs the database password.
2. **Enable anonymous sign-ins:** *Authentication* > *Sign In / Providers* > **Allow anonymous sign-ins**. Each install signs in anonymously once; that user is the install's identity. Keep the default rate limits (or add a CAPTCHA) so strangers cannot create unlimited users.
3. **Create the tables:** *SQL Editor* > *New query*, run [`supabase/migrations/0001_install_links.sql`](../supabase/migrations/0001_install_links.sql), then [`0002_customization.sql`](../supabase/migrations/0002_customization.sql). Both are safe to run again. A project that already has the tables of the sister tool parakeet-check needs only the second file.
4. **Copy the Project URL and the publishable key:** *Project Settings* > *API Keys*. The URL looks like `https://<ref>.supabase.co`, the key like `sb_publishable_...` (on older projects the legacy **anon** key works too).
   **Never use the secret / service_role key:** it bypasses every security rule, and the app refuses it.

## On each PC

Settings > Sync: paste the URL and key, **Save**, switch **Sync my customization** on. The install signs in and gets its ID. The URL, the key and the install's tokens are stored encrypted with Windows in `secrets.json`, never in `settings.json`. If Windows secure storage is not available, sync refuses to run.

## Linking

On the first PC press **Create link code**; on the second enter it under **Join with a code**. The code has 6 characters from an alphabet without look-alikes, works once and lasts 10 minutes. An install is in at most one group; joining moves it into the group of the code's creator. **Unlink** leaves the group and keeps everything on the PC; a group left with one member is removed along with its row.

Linked installs can read and change each other's customization, so link only your own. Any install that uses the same project and group can read the row, including a parakeet-check install you linked.

## How conflicts work

- Every key has its own timestamp, and the newest edit wins, per key. Editing a tone rule on one PC and a word on the other keeps both.
- A value still at its default never beats a customization, so a fresh install does not overwrite the others.
- Before the first pull from a project or group, your customization is copied to `%APPDATA%\parakeet-flow\sync-backups\`. **Restore backup** puts the latest copy back, as a new edit.
- When two PCs changed the same key since they last agreed, Settings > Sync shows the key and what was replaced.
- Times come from the PCs' clocks. A time more than 5 minutes in the future is treated as now, so a wrong clock cannot win forever.
- Offline, nothing changes for dictation. Changes wait in `sync-state.json` and are retried after 30 s, growing to 1 hour.

## The table

`public.customization` has one row per group, or per install while it is not linked: `doc` (JSON), `version`, `updated_at`, `updated_by`.

```json
{ "schema": 1, "keys": { "tone.enabled": { "v": true, "t": 1793750000000, "by": "<install id>" },
                         "word:rizz": { "v": { "term": "rizz", "bias": 75 }, "t": 1793750000000, "by": "<install id>" } } }
```

`v: null` marks a deleted word or row. An update names the `version` it read, so two writers cannot overwrite each other: the second one merges and tries again. A document is limited to 2 MB.

## How the security works

The app only holds the public key, which anyone could extract. That is fine because every table has Row Level Security, and the rules depend only on `auth.uid()`:

| Table | Read | Write |
|---|---|---|
| `customization` | own row, own group's row | insert and update `doc` of those rows; no delete; the database stamps `version`, `updated_at`, `updated_by` |
| `installs` | own and linked installs | own row only. The app sends its version and an empty machine. The name is empty unless the user typed one under This PC's name |
| `groups`, `group_members` | own group only | only through the functions below |
| `link_codes` | nobody | only through the functions below |

`create_link_code()` allows 20 codes per install per hour. `join_with_code()` refuses used, expired, unknown and own codes, and after 10 wrong codes in 10 minutes it refuses for a while, which makes guessing impractical (31^6 is about 887 million combinations). `leave_group()` and `list_group()` do what they say. These run as `SECURITY DEFINER` with an empty `search_path`, and check the caller themselves.

The Supabase security advisor lists these as warnings, and they are expected here: signed-in users can call those four functions (that is how linking works), and policies apply to anonymous users (every install is one).

## Removing your data

Switching sync off stops all calls but does not delete what was uploaded. To delete it: in *Table Editor* > `customization`, delete the row, or remove the install under *Authentication* > *Users*, which also removes its `installs` row and its private row. Deleting `secrets.json` entry `sync` (or the whole file, which also removes a saved Notion token) makes the PC start with a new identity.

## Testing against a real project

```
set PF_SYNC_TEST_URL=https://<ref>.supabase.co
set PF_SYNC_TEST_KEY=sb_publishable_...
set PF_SYNC_TEST_IDS=C:\some\scratch\ids.txt
node --test .tests/sync/l4-live.test.js
```

It creates three throw-away anonymous installs, links two, syncs a word, and checks that the third cannot read or change the row, that the public key alone gets nothing, and that a client cannot fake the version or delete the row. Without the first two variables it is skipped. Afterwards remove the users listed in the ids file, in the SQL editor:

```sql
delete from private.link_attempts where install_id in ('<id>', '<id>', '<id>');
delete from auth.users where id in ('<id>', '<id>', '<id>') and is_anonymous;
```
