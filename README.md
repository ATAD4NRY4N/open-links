# open-links

Evidence-first investigative graph for linking entities (people, places, items, events, claims) with source-backed, contestable relationships.

## Positioning

Open Links is designed as an investigative workspace rather than a generic mapping tool:

- Weighted edges harden as evidence count, votes, source reliability, and recency improve.
- Every visible connection can be inspected through a provenance chain.
- Evidence can be disputed, countered, and resolved with a moderation log.
- X.com posts can be normalized into canonical thread evidence with archive fallback notes.
- A tamper-evident audit trail records investigative activity.

## Core MVP Features

- Create and search entities with type, description, and tags.
- Create links between entities with relationship type and confidence level.
- Attach evidence records to links with source type, reliability label, published date, archive note, and citation metadata.
- Normalize X.com/Twitter post URLs into canonical source records with handle and post ID capture.
- Vote evidence quality and watch link strength update visually.
- Explore an interactive investigative graph with drag, zoom, clustering, neighborhood expansion, and case-focused views.
- Filter by confidence, source type, date range, and contested evidence.
- Replay the investigation timeline to see how relationships formed.
- File evidence disputes, attach counter-evidence, and log moderator resolutions.
- File moderation reports on entities, links, or evidence.
- Inspect a tamper-evident audit trail.

## Data Model (Client-side MVP)

- **Entity**: `type`, `name`, `description`, `tags`, `createdAt`
- **Link**: `sourceEntityId`, `targetEntityId`, `relationshipType`, `confidenceLevel`, `createdAt`, `evidence[]`
- **Evidence**: `url`, `canonicalUrl`, `sourceType`, `reliability`, `publishedAt`, `capturedAt`, `archiveNote`, `votes`, `disputes[]`
- **Dispute**: `reason`, `counterEvidence`, `status`, `resolutionNote`, `resolvedAt`
- **Report**: `targetType`, `targetId`, `reason`, `createdAt`
- **AuditEntry**: `action`, `detail`, `timestamp`, `prevHash`, `hash`

Data is persisted in browser `localStorage` for this MVP.

## Architecture

- Frontend: Next.js (React, App Router)
- Persistence (MVP): Local browser storage
- Future backend target: Postgres + graph layer + object storage
- Auth direction: pseudonymous accounts, rate limiting, trust scoring

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

## Product Direction

1. Weighted investigative graph + source-backed case workflows
2. Trust, provenance, disputes, and reliability scoring
3. Collaboration, notifications, reputation, and transparency reporting
