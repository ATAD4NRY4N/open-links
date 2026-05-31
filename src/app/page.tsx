"use client";

import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";

type EntityType = "person" | "place" | "item" | "event" | "claim";

type Entity = {
  id: string;
  type: EntityType;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
};

type Evidence = {
  id: string;
  url: string;
  note: string;
  citation: string;
  submitter: string;
  timestamp: string;
  votes: number;
};

type Link = {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  confidenceLevel: number;
  createdAt: string;
  evidence: Evidence[];
};

type Report = {
  id: string;
  targetType: "entity" | "link" | "evidence";
  targetId: string;
  reason: string;
  createdAt: string;
};

type BoardData = {
  entities: Entity[];
  links: Link[];
  reports: Report[];
};

const STORAGE_KEY = "open-links-board-v1";

const defaultData: BoardData = {
  entities: [],
  links: [],
  reports: [],
};

function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function Home() {
  const [board, setBoard] = useState<BoardData>(() => {
    if (typeof window === "undefined") return defaultData;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData;
    try {
      return JSON.parse(raw) as BoardData;
    } catch {
      return defaultData;
    }
  });
  const [query, setQuery] = useState("");

  const [entityType, setEntityType] = useState<EntityType>("person");
  const [entityName, setEntityName] = useState("");
  const [entityDescription, setEntityDescription] = useState("");
  const [entityTags, setEntityTags] = useState("");

  const [sourceEntityId, setSourceEntityId] = useState("");
  const [targetEntityId, setTargetEntityId] = useState("");
  const [relationshipType, setRelationshipType] = useState("");
  const [confidenceLevel, setConfidenceLevel] = useState(3);

  const [linkForEvidence, setLinkForEvidence] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceCitation, setEvidenceCitation] = useState("");
  const [evidenceSubmitter, setEvidenceSubmitter] = useState("anonymous");

  const [reportTargetType, setReportTargetType] = useState<Report["targetType"]>("entity");
  const [reportTargetId, setReportTargetId] = useState("");
  const [reportReason, setReportReason] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  }, [board]);

  const filteredEntities = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return board.entities;

    return board.entities.filter((entity) => {
      const haystack = `${entity.name} ${entity.description} ${entity.tags.join(" ")} ${entity.type}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [board.entities, query]);

  const activityTimeline = useMemo(() => {
    const entityEvents = board.entities.map((entity) => ({
      id: entity.id,
      type: "entity" as const,
      label: `Entity created: ${entity.name}`,
      timestamp: entity.createdAt,
    }));
    const linkEvents = board.links.map((link) => ({
      id: link.id,
      type: "link" as const,
      label: `Link created: ${entityLabel(link.sourceEntityId, board.entities)} → ${entityLabel(link.targetEntityId, board.entities)}`,
      timestamp: link.createdAt,
    }));
    const evidenceEvents = board.links.flatMap((link) =>
      link.evidence.map((evidence) => ({
        id: evidence.id,
        type: "evidence" as const,
        label: `Evidence added by ${evidence.submitter} on ${entityLabel(link.sourceEntityId, board.entities)} ↔ ${entityLabel(link.targetEntityId, board.entities)}`,
        timestamp: evidence.timestamp,
      })),
    );

    return [...entityEvents, ...linkEvents, ...evidenceEvents].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [board.entities, board.links]);

  function createEntity(event: FormEvent) {
    event.preventDefault();
    const name = entityName.trim();
    if (!name) return;

    const now = new Date().toISOString();
    const nextEntity: Entity = {
      id: uid("entity"),
      type: entityType,
      name,
      description: entityDescription.trim(),
      tags: entityTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      createdAt: now,
    };

    setBoard((prev) => ({ ...prev, entities: [nextEntity, ...prev.entities] }));
    setEntityName("");
    setEntityDescription("");
    setEntityTags("");
  }

  function createLink(event: FormEvent) {
    event.preventDefault();
    if (!sourceEntityId || !targetEntityId || !relationshipType.trim()) return;
    if (sourceEntityId === targetEntityId) return;

    const nextLink: Link = {
      id: uid("link"),
      sourceEntityId,
      targetEntityId,
      relationshipType: relationshipType.trim(),
      confidenceLevel,
      createdAt: new Date().toISOString(),
      evidence: [],
    };

    setBoard((prev) => ({ ...prev, links: [nextLink, ...prev.links] }));
    setRelationshipType("");
    setConfidenceLevel(3);
  }

  function addEvidence(event: FormEvent) {
    event.preventDefault();
    if (!linkForEvidence || !evidenceUrl.trim()) return;

    const nextEvidence: Evidence = {
      id: uid("evidence"),
      url: evidenceUrl.trim(),
      note: evidenceNote.trim(),
      citation: evidenceCitation.trim(),
      submitter: evidenceSubmitter.trim() || "anonymous",
      timestamp: new Date().toISOString(),
      votes: 0,
    };

    setBoard((prev) => ({
      ...prev,
      links: prev.links.map((link) => {
        if (link.id !== linkForEvidence) return link;
        return { ...link, evidence: [nextEvidence, ...link.evidence] };
      }),
    }));

    setEvidenceUrl("");
    setEvidenceNote("");
    setEvidenceCitation("");
  }

  function voteEvidence(linkId: string, evidenceId: string, delta: 1 | -1) {
    setBoard((prev) => ({
      ...prev,
      links: prev.links.map((link) => {
        if (link.id !== linkId) return link;
        return {
          ...link,
          evidence: link.evidence.map((evidence) =>
            evidence.id === evidenceId ? { ...evidence, votes: evidence.votes + delta } : evidence,
          ),
        };
      }),
    }));
  }

  function fileReport(event: FormEvent) {
    event.preventDefault();
    if (!reportTargetId || !reportReason.trim()) return;

    const nextReport: Report = {
      id: uid("report"),
      targetType: reportTargetType,
      targetId: reportTargetId,
      reason: reportReason.trim(),
      createdAt: new Date().toISOString(),
    };

    setBoard((prev) => ({ ...prev, reports: [nextReport, ...prev.reports] }));
    setReportReason("");
  }

  const availableReportTargets =
    reportTargetType === "entity"
      ? board.entities.map((entity) => ({ id: entity.id, label: `${entity.name} (${entity.type})` }))
      : reportTargetType === "link"
        ? board.links.map((link) => ({
            id: link.id,
            label: `${entityLabel(link.sourceEntityId, board.entities)} → ${entityLabel(link.targetEntityId, board.entities)}`,
          }))
        : board.links.flatMap((link) =>
            link.evidence.map((evidence) => ({
              id: evidence.id,
              label: `${evidence.submitter}: ${truncate(evidence.url, 40)}`,
            })),
          );

  return (
    <main style={styles.main}>
      <section style={styles.hero}>
        <h1>Open Links Evidence Board</h1>
        <p>
          Community-driven board for documenting entities, linking claims, and attaching evidence with traceable history.
        </p>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2>Create Entity</h2>
          <form onSubmit={createEntity} style={styles.form}>
            <label>
              Type
              <select value={entityType} onChange={(event) => setEntityType(event.target.value as EntityType)}>
                <option value="person">Person</option>
                <option value="place">Place</option>
                <option value="item">Item</option>
                <option value="event">Event</option>
                <option value="claim">Claim</option>
              </select>
            </label>
            <label>
              Name
              <input value={entityName} onChange={(event) => setEntityName(event.target.value)} placeholder="Entity name" />
            </label>
            <label>
              Description
              <textarea
                value={entityDescription}
                onChange={(event) => setEntityDescription(event.target.value)}
                placeholder="Short context"
              />
            </label>
            <label>
              Tags (comma-separated)
              <input value={entityTags} onChange={(event) => setEntityTags(event.target.value)} placeholder="justice, policy" />
            </label>
            <button type="submit">Add entity</button>
          </form>
        </article>

        <article style={styles.card}>
          <h2>Create Link</h2>
          <form onSubmit={createLink} style={styles.form}>
            <label>
              Source entity
              <select value={sourceEntityId} onChange={(event) => setSourceEntityId(event.target.value)}>
                <option value="">Select source</option>
                {board.entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name} ({entity.type})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target entity
              <select value={targetEntityId} onChange={(event) => setTargetEntityId(event.target.value)}>
                <option value="">Select target</option>
                {board.entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name} ({entity.type})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Relationship type
              <input
                value={relationshipType}
                onChange={(event) => setRelationshipType(event.target.value)}
                placeholder="associated with"
              />
            </label>
            <label>
              Confidence level (1-5)
              <input
                type="number"
                min={1}
                max={5}
                value={confidenceLevel}
                onChange={(event) => setConfidenceLevel(Number(event.target.value))}
              />
            </label>
            <button type="submit">Create link</button>
          </form>
        </article>

        <article style={styles.card}>
          <h2>Add Evidence</h2>
          <form onSubmit={addEvidence} style={styles.form}>
            <label>
              Link
              <select value={linkForEvidence} onChange={(event) => setLinkForEvidence(event.target.value)}>
                <option value="">Select link</option>
                {board.links.map((link) => (
                  <option key={link.id} value={link.id}>
                    {entityLabel(link.sourceEntityId, board.entities)} ↔ {entityLabel(link.targetEntityId, board.entities)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evidence URL
              <input
                type="url"
                value={evidenceUrl}
                onChange={(event) => setEvidenceUrl(event.target.value)}
                placeholder="https://source.example"
              />
            </label>
            <label>
              Source note
              <textarea
                value={evidenceNote}
                onChange={(event) => setEvidenceNote(event.target.value)}
                placeholder="What this source supports"
              />
            </label>
            <label>
              Citation metadata
              <input
                value={evidenceCitation}
                onChange={(event) => setEvidenceCitation(event.target.value)}
                placeholder="Publisher, date, title"
              />
            </label>
            <label>
              Submitter
              <input
                value={evidenceSubmitter}
                onChange={(event) => setEvidenceSubmitter(event.target.value)}
                placeholder="anonymous"
              />
            </label>
            <button type="submit">Attach evidence</button>
          </form>
        </article>

        <article style={styles.card}>
          <h2>Search Entities</h2>
          <label style={styles.formLabel}>
            Query
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="name, tag, type" />
          </label>
          <ul style={styles.list}>
            {filteredEntities.map((entity) => (
              <li key={entity.id}>
                <strong>{entity.name}</strong> ({entity.type}) — {entity.tags.join(", ") || "no tags"}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2>Graph View (Link Map)</h2>
          <ul style={styles.list}>
            {board.links.map((link) => (
              <li key={link.id} style={styles.linkCard}>
                <div>
                  <strong>{entityLabel(link.sourceEntityId, board.entities)}</strong> →{" "}
                  <strong>{entityLabel(link.targetEntityId, board.entities)}</strong>
                </div>
                <div>
                  Relationship: {link.relationshipType} | Confidence: {link.confidenceLevel}/5
                </div>
                <div>Created: {formatDate(link.createdAt)}</div>
                <details>
                  <summary>Evidence ({link.evidence.length})</summary>
                  <ul style={styles.list}>
                    {link.evidence.map((evidence) => (
                      <li key={evidence.id} style={styles.evidenceCard}>
                        <a href={evidence.url} target="_blank" rel="noreferrer">
                          {truncate(evidence.url, 60)}
                        </a>
                        <div>{evidence.note}</div>
                        <div>{evidence.citation}</div>
                        <div>
                          By {evidence.submitter} • {formatDate(evidence.timestamp)} • Votes: {evidence.votes}
                        </div>
                        <div style={styles.row}>
                          <button type="button" onClick={() => voteEvidence(link.id, evidence.id, 1)}>
                            Upvote
                          </button>
                          <button type="button" onClick={() => voteEvidence(link.id, evidence.id, -1)}>
                            Downvote
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </article>

        <article style={styles.card}>
          <h2>Activity Timeline</h2>
          <ul style={styles.list}>
            {activityTimeline.map((item) => (
              <li key={item.id}>
                <strong>{item.type}</strong> — {item.label}
                <div>{formatDate(item.timestamp)}</div>
              </li>
            ))}
          </ul>
        </article>

        <article style={styles.card}>
          <h2>Moderation & Reporting</h2>
          <form onSubmit={fileReport} style={styles.form}>
            <label>
              Target type
              <select
                value={reportTargetType}
                onChange={(event) => {
                  const next = event.target.value as Report["targetType"];
                  setReportTargetType(next);
                  setReportTargetId("");
                }}
              >
                <option value="entity">Entity</option>
                <option value="link">Link</option>
                <option value="evidence">Evidence</option>
              </select>
            </label>
            <label>
              Target
              <select value={reportTargetId} onChange={(event) => setReportTargetId(event.target.value)}>
                <option value="">Select target</option>
                {availableReportTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason
              <textarea
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
                placeholder="False info, abuse, doxxing, etc."
              />
            </label>
            <button type="submit">Submit report</button>
          </form>

          <h3>Moderation Queue</h3>
          <ul style={styles.list}>
            {board.reports.map((report) => (
              <li key={report.id}>
                [{report.targetType}] {report.targetId}: {report.reason}
                <div>Filed: {formatDate(report.createdAt)}</div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2>Defamation & Harassment Policy</h2>
          <p>
            Do not post accusations without verifiable evidence. Harassment, threats, and targeted abuse are disallowed.
            Repeat abuse may result in account and content removal.
          </p>
        </article>

        <article style={styles.card}>
          <h2>PII Redaction Rules</h2>
          <p>
            Do not publish personal addresses, phone numbers, private identifiers, or other doxxing material. Reports are
            prioritized for potential PII.
          </p>
        </article>

        <article style={styles.card}>
          <h2>Takedown Process</h2>
          <p>
            Affected parties can request review through moderation. Verified legal or policy violations are removed and
            logged in the moderation history.
          </p>
        </article>
      </section>
    </main>
  );
}

function entityLabel(entityId: string, entities: Entity[]) {
  return entities.find((entity) => entity.id === entityId)?.name ?? "Unknown entity";
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

const styles: Record<string, CSSProperties> = {
  main: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    padding: "1rem",
    maxWidth: "1280px",
    margin: "0 auto",
    fontFamily: "Arial, sans-serif",
  },
  hero: {
    padding: "1rem",
    border: "1px solid #d4d4d8",
    borderRadius: "8px",
    background: "#fafafa",
  },
  grid: {
    display: "grid",
    gap: "1rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  },
  card: {
    border: "1px solid #d4d4d8",
    borderRadius: "8px",
    padding: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    background: "#fff",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  formLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    margin: 0,
    paddingLeft: "1.1rem",
  },
  row: {
    display: "flex",
    gap: "0.4rem",
  },
  linkCard: {
    border: "1px solid #e4e4e7",
    borderRadius: "6px",
    padding: "0.6rem",
    listStyle: "none",
  },
  evidenceCard: {
    border: "1px solid #f4f4f5",
    borderRadius: "6px",
    padding: "0.5rem",
    listStyle: "none",
  },
};
