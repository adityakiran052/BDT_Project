# COLLEDOCS

A working first prototype for the Big Data Technologies project: a college document repository using Node.js, Express and Apache CouchDB, with a responsive browser interface.

## Try the demo

Open PowerShell in this folder and run:

```powershell
node --env-file=.env.demo server.js
```

Open http://localhost:3000. Dependencies are already installed on this computer. On another machine, install Node.js 24 and run `npm install` first (or `pnpm install --frozen-lockfile` to use the included lockfile).

| Role | Email | Password |
| --- | --- | --- |
| Administrator | admin@college.edu | AdminDemo123! |
| Faculty | faculty@college.edu | CollegeDemo123! |
| Student | student@college.edu | CollegeDemo123! |

Demo mode uses memory, not CouchDB, and loses all data when the process stops. It is for trying the interface and workflow only.

## Run with CouchDB for the BDT submission

1. Start Docker Desktop and wait for the Linux engine to be ready.
2. Copy `.env.example` to `.env`. Replace both passwords with different, strong passwords. Keep `STORE=couchdb`.
3. Run `docker compose up -d` from this folder.
4. Run `node --env-file=.env server.js`.
5. Open http://localhost:3000 and sign in with the administrator email/password in `.env`.
6. Use **Create a college account** to create faculty and student accounts. Demo users are created only when `DEMO_SEED=true`. The local `.env` on this computer enables seeding so the previously supplied logins also work in CouchDB.

The database, design document, views and Mango indexes are initialized by the server. CouchDB persists data in a Docker volume and is bound to localhost. The browser accesses only Express. Do not expose port 5984 publicly.

## Demonstrate the project

1. Sign in as faculty. Upload notes with department, subject, semester and category.
2. Sign in as student: the pending document is absent and its download is blocked.
3. Sign in as administrator. Open **Approval queue** and approve the upload.
4. Sign in as student. Search/filter the library and download the approved file.
5. As faculty, choose **Submit new version**. Upload a revised file.
6. Reject the new version as administrator, with remarks. The approved previous version stays visible to students.
7. Resubmit as faculty and approve the next version. Use **Versions** to show application version history.

## Administrator password resets

The administrator can search by name, email or role and select a faculty or student account in **Reset faculty or student password**, then confirm **Reset password to Test@123**. The reset stores a new salted hash in CouchDB, records the administrator and time, signs out the affected account, and clears its password-change attempt limit. It does not reset another administrator account. Users can sign in with Test@123 and choose a new password through Change password.

## Architecture and data model

Administrators can select **Delete account** in the account management panel. Deleted faculty/student accounts cannot sign in and their active sessions are invalidated. Account records are deleted through the CouchDB DELETE API, so they disappear from normal database listings. CouchDB retains its deletion tombstone; demo seeding checks this marker to avoid automatically recreating deleted accounts. An administrator can explicitly create a new account with the same email and password. Accounts soft-deleted by earlier versions are converted to normal deletions on startup. Previously uploaded documents remain available until an administrator deletes them separately.

Each document card has an administrator-only **Delete document** action. After confirmation, all application versions in that document group are deleted using CouchDB's `DELETE` API with `_rev` conflict checks. The library, downloads and history no longer expose those records or attachments. This is a normal CouchDB deletion, not a database purge; CouchDB retains deletion tombstones and storage is reclaimed through its compaction lifecycle. COLLEDOCS has no undo action.

Administrators, faculty and students can select **Change password** in the sidebar. They enter their current password and confirm a new password of 8 to 200 characters, including a capital letter, a number and a special character. The new salted scrypt hash is saved to the account record in CouchDB. All sessions for that account are invalidated, and the user signs in again with the new password. Seed users are created only when absent; server restarts do not overwrite changed passwords.

Browser → Express API → CouchDB REST API. Cookies are HTTP-only with SameSite Strict. Passwords use scrypt with random salts. Only administrators create accounts; role assignment is never available during public signup. Sessions expire after eight hours and reset on server restart.

Each upload creates a record `document:<groupId>:<version>` containing metadata and a `file` attachment. Version numbers identify application history. `_rev` is used only for CouchDB conflict detection. Concurrent uploads of the same next version receive a conflict and should be retried. Approval updates a version's review metadata; its attachment is retained.

Students see approved versions only. Faculty can also access their own pending/rejected versions. Administrators review all documents. Authorization applies to lists, downloads and history. The library shows the newest version that the current user is allowed to see.

Fixed filters use CouchDB views (`by_department`, `by_category`, `by_semester`, `by_owner`, `by_groupId`). Mango indexes support user lookups and flexible metadata selections. Free-text search executes case-insensitive Mango regex selectors inside CouchDB, **not** an indexed full-text search engine. Do not claim large-scale full-text performance from this implementation.

## Validation

```powershell
node --test
```

The integration test checks sign-in, role restrictions, upload, pending-download protection, approval, attachment download, rejection remarks, version visibility, search and logout. It passed with both memory storage and real CouchDB. To run it against CouchDB, set `$env:TEST_COUCHDB='true'` and run `node --env-file=.env --test`. It uses and removes its own temporary test database.

## Limits and next work

This is a local academic prototype. Files are capped at 10 MB and basic file signatures are checked; Office ZIP contents and malware are not inspected. Current list queries collect matching metadata before filtering and have no UI pagination. Before deploying for a real college, add HTTPS/reverse proxy configuration, persistent sessions, forgotten-password recovery/account disabling, antivirus scanning, pagination, audit events, backups and restore testing.

For the BDT evaluation, record query latency on real CouchDB with increasing dataset sizes (e.g. 100, 1,000 and 10,000 metadata records), report cold/warm view queries separately, and describe the test hardware. This prototype has no measured scalability or usability results yet.

## Project files

- `server.js`: authentication, roles, validation and document workflow.
- `store.js`: CouchDB adapter and isolated memory demo adapter.
- `public/`: browser interface.
- `test/workflow.test.js`: workflow and access-control integration test.
- `compose.yaml`, `couchdb.ini`: local persistent CouchDB setup.
- `PROJECT_REVIEW.md`: changes and submission guidance.

References: [CouchDB attachments](https://docs.couchdb.org/en/stable/api/document/common.html), [views](https://docs.couchdb.org/en/stable/api/ddoc/views.html), [Mango](https://docs.couchdb.org/en/stable/ddocs/mango.html).
