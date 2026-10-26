# Proposal review and implementation decisions

The supplied proposal is a clear, achievable BDT project. Its central design is retained: three tiers, CouchDB metadata plus attachments, student/faculty/administrator roles, approval and application-level version history.

The original Word document has been preserved. These notes describe implementation clarifications rather than rewriting the proposal.

## Changes incorporated

- Account provisioning is administrator controlled. Faculty and student roles cannot be chosen by an unauthenticated visitor.
- Passwords are salted and hashed. Credentials and CouchDB access stay on the server.
- Pending and rejected files are protected on download and history endpoints as well as in the library.
- Every revision requires a new approval. An approved earlier version remains available while a replacement is pending or rejected.
- Rejection requires remarks. Faculty can resubmit with another version.
- PDF, DOCX, PPTX and TXT uploads are supported with a 10 MB cap and basic signature validation.
- CouchDB revision conflicts return a retryable error rather than overwriting changes.
- A separate memory demo enables workflow testing without Docker. It must not be described as the CouchDB evaluation.

## Suggested proposal clarifications

Add explicit scope: uploads are faculty-only, accounts are administrator-provisioned, students download approved versions, and the initial installation serves a single college. Specify file types and limits.

Describe search as metadata views and Mango queries with database-side Mango text matching. Full-text search, OCR and content indexing are future work. The current prototype does not implement distributed replication; CouchDB replication and partitioning can be discussed as future extensions after measuring the single-node system.

Distinguish implemented behavior from evaluation results. The statement that a prototype “will be implemented and evaluated” is appropriate until live database tests and a usability study are completed. Do not replace it with claims of proven scalability or security without evidence.

## Acceptance checklist for submission

- Run the CouchDB setup and confirm records survive server/database restarts.
- Test all three roles using real database storage.
- Verify approval/rejection, revisions, downloads and filtered searches.
- Capture UI screenshots, architecture and upload workflow diagrams.
- Show a JSON metadata record, attachment metadata, design views and Mango indexes in the database demonstration.
- Measure query response time at documented dataset sizes and report median and 95th percentile latency.
- Ask a small group to complete upload/search/download tasks; record completion time, errors and feedback with consent.

## Status

Core workflow tests passed with both memory storage and a real CouchDB container. They verify upload, attachment download, database-side Mango text searches, approval/rejection and role restrictions. The local application now uses CouchDB; accounts and files are persisted in its Docker volume. Formal performance measurements and browser interaction evaluation are still pending. This is a first project implementation, not a completed evaluation report.
