# open-links

Free, community-driven evidence board for linking entities (people, places, items, events, claims) with source-backed relationships.

## MVP Features Implemented

- Create and search entities with type, description, and tags.
- Create links between two entities with relationship type and confidence level.
- Attach evidence records to links (URL, note, citation metadata, submitter, timestamp).
- Vote evidence quality (upvote/downvote).
- View a lightweight graph-style link map and chronological activity timeline.
- File moderation reports on entities, links, or evidence.
- View a moderation queue with report history.
- Built-in trust/safety policy sections:
  - Defamation & harassment policy
  - PII redaction rules
  - Takedown process

## Data Model (Client-side MVP)

- **Entity**: `type`, `name`, `description`, `tags`, `createdAt`
- **Link**: `sourceEntityId`, `targetEntityId`, `relationshipType`, `confidenceLevel`, `createdAt`, `evidence[]`
- **Evidence**: `url`, `note`, `citation`, `submitter`, `timestamp`, `votes`
- **Report**: `targetType`, `targetId`, `reason`, `createdAt`

Data is persisted in browser `localStorage` for this MVP.

## Architecture

- Frontend: Next.js (React, App Router)
- Persistence (MVP): Local browser storage
- Future backend target: Postgres + graph layer and object storage
- Auth direction: optional pseudonymous accounts + rate limiting

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validation

```bash
npm run lint
npm run build
```

## Launch Phases (Roadmap)

1. Private alpha
2. Invite-only community moderation
3. Public release with stronger policy enforcement

## Alternatives to Compare

- Kumu
- Obsidian graph/public canvas workflows
- Investigative link-analysis tools

Positioning: open, evidence-first, and community-moderated.
