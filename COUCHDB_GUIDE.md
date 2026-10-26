# Where your data lives

The normal `.env` configuration selects `STORE=couchdb`. Start it with `node --env-file=.env server.js`. The separate `.env.demo` selects memory storage and is only for disposable demonstrations.

## Files

An upload sends `PUT /colledocs/document:<groupId>:<version>` to CouchDB. The JSON contains title, subject, department, category, semester, owner and review status. `_attachments.file` contains the uploaded bytes encoded for transport; CouchDB stores the actual attachment with the document. Downloads retrieve `GET /colledocs/<documentId>/file` through Express after checking the user's permissions.

The Docker volume `colledocs_couchdb-data` holds CouchDB's persistent database files. Stopping or restarting the application or container retains this data. Removing that volume deletes it.

## Student searches

Each library request in CouchDB mode executes `POST /colledocs/_find`. For a student searching `BDT` in department `CSE`, the server sends a Mango selector equivalent to:

```json
{
  "selector": {
    "type": "document",
    "status": "approved",
    "department": "CSE",
    "$and": [{"$or": [
      {"title": {"$regex": "(?i)bdt"}},
      {"subject": {"$regex": "(?i)bdt"}},
      {"description": {"$regex": "(?i)bdt"}}
    ]}]
  },
  "limit": 200
}
```

CouchDB performs text matching, metadata filtering and approval filtering. Express groups returned versions into the newest accessible result and checks permissions again. User text is escaped so regular expression syntax is treated literally. Browser users never receive the CouchDB administrator password or send arbitrary database commands.

This searches metadata, not the contents of PDF/Office files. Regex queries execute inside CouchDB but are not an indexed full-text solution for large datasets. See the [CouchDB Mango documentation](https://docs.couchdb.org/en/stable/ddocs/mango.html).

## Credentials

Student, faculty and application administrator accounts are stored in the `colledocs` database as records such as:

```json
{
  "_id": "user:student@college.edu",
  "type": "user",
  "email": "student@college.edu",
  "name": "Student account",
  "role": "student",
  "password": "<random salt>:<scrypt hash>"
}
```

The database record holds a salted password hash, not the original password. Login looks up the account in CouchDB and compares the computed hash. Session tokens currently live in Express memory and the HTTP-only browser cookie; restarting Express signs users out but retains their accounts.

There are two different administrator accounts: `admin@college.edu` is the application's administrator, while `colledocs_admin` is CouchDB's service administrator. The latter is configured in the local `.env` and supplied to Docker. `.env` is excluded from Git.

For this local project setup, `DEMO_SEED=true` also creates the previously shown faculty/student accounts **in CouchDB** on first startup. Their demonstration passwords originate in the seed code in `server.js`; the administrator's initial password originates in `.env`. Disable seeding and use fresh accounts before any public deployment. Changing `ADMIN_PASSWORD` after account creation does not reset the existing account's stored hash.

## Inspect CouchDB

Open http://localhost:5984/_utils/ and sign in with `COUCHDB_USER` and `COUCHDB_PASSWORD` from your local `.env`. Select `colledocs` to inspect user records, uploaded document records, `_attachments`, design views and Mango indexes. Keep these service credentials on your own computer.
