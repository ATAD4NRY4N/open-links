"use client";

import { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";

type EntityType = "person" | "place" | "item" | "event" | "claim";
type SourceType = "x" | "article" | "document" | "video" | "other";
type ReliabilityLevel = "low" | "medium" | "high";
type ReportTargetType = "entity" | "link" | "evidence";
type DisputeStatus = "open" | "countered" | "resolved";

type Entity = {
  id: string;
  type: EntityType;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
};

type CounterEvidence = {
  url: string;
  note: string;
};

type Dispute = {
  id: string;
  reporter: string;
  reason: string;
  createdAt: string;
  status: DisputeStatus;
  counterEvidence: CounterEvidence | null;
  resolutionNote: string;
  resolvedAt: string | null;
};

type XPostMetadata = {
  authorHandle: string;
  postId: string;
  canonicalUrl: string;
};

type Evidence = {
  id: string;
  url: string;
  canonicalUrl: string;
  note: string;
  citation: string;
  submitter: string;
  addedAt: string;
  publishedAt: string;
  capturedAt: string;
  votes: number;
  sourceType: SourceType;
  reliability: ReliabilityLevel;
  archiveNote: string;
  xPost: XPostMetadata | null;
  disputes: Dispute[];
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
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  createdAt: string;
};

type AuditEntry = {
  id: string;
  targetType: ReportTargetType | "audit";
  targetId: string;
  action: string;
  detail: string;
  timestamp: string;
  prevHash: string;
  hash: string;
};

type BoardData = {
  entities: Entity[];
  links: Link[];
  reports: Report[];
  auditTrail: AuditEntry[];
};

type Position = {
  x: number;
  y: number;
};

type VisibleLink = {
  link: Link;
  evidence: Evidence[];
  metrics: ReturnType<typeof computeLinkMetrics>;
};

const STORAGE_KEY = "open-links-board-v2";
const DAY_IN_MS = 1000 * 60 * 60 * 24;
const ENTITY_TYPE_OPTIONS: EntityType[] = ["person", "place", "item", "event", "claim"];
const SOURCE_TYPE_OPTIONS: SourceType[] = ["x", "article", "document", "video", "other"];
const RELIABILITY_OPTIONS: ReliabilityLevel[] = ["low", "medium", "high"];
const ENTITY_COLORS: Record<EntityType, string> = {
  person: "#0f766e",
  place: "#7c3aed",
  item: "#2563eb",
  event: "#dc2626",
  claim: "#d97706",
};
const defaultData: BoardData = {
  entities: [],
  links: [],
  reports: [],
  auditTrail: [],
};

function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashValue(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function appendAuditEntry(
  auditTrail: AuditEntry[],
  targetType: AuditEntry["targetType"],
  targetId: string,
  action: string,
  detail: string,
) {
  const timestamp = new Date().toISOString();
  const prevHash = auditTrail.at(-1)?.hash ?? "genesis";
  const hash = hashValue(`${prevHash}|${targetType}|${targetId}|${action}|${detail}|${timestamp}`);
  return [
    ...auditTrail,
    {
      id: uid("audit"),
      targetType,
      targetId,
      action,
      detail,
      timestamp,
      prevHash,
      hash,
    },
  ];
}

function reliabilityScore(level: ReliabilityLevel) {
  switch (level) {
    case "high":
      return 0.95;
    case "medium":
      return 0.72;
    case "low":
      return 0.48;
    default:
      return 0.6;
  }
}

function sourceTypeScore(sourceType: SourceType) {
  switch (sourceType) {
    case "document":
      return 0.92;
    case "x":
      return 0.78;
    case "article":
      return 0.74;
    case "video":
      return 0.68;
    case "other":
      return 0.6;
    default:
      return 0.6;
  }
}

function recencyScore(publishedAt: string, now = Date.now()) {
  const ageDays = Math.max(0, (now - new Date(publishedAt).getTime()) / DAY_IN_MS);
  if (ageDays <= 30) return 1.1;
  if (ageDays <= 180) return 1;
  if (ageDays <= 365) return 0.84;
  if (ageDays <= 730) return 0.68;
  return 0.52;
}

function disputePenalty(disputes: Dispute[]) {
  if (disputes.length === 0) return 1;
  if (disputes.some((dispute) => dispute.status === "open")) return 0.68;
  if (disputes.some((dispute) => dispute.status === "countered")) return 0.82;
  return 0.92;
}

function evidenceStrength(evidence: Evidence, now = Date.now()) {
  const voteFactor = clamp(1 + evidence.votes * 0.08, 0.5, 1.4);
  return reliabilityScore(evidence.reliability) * sourceTypeScore(evidence.sourceType) * recencyScore(evidence.publishedAt, now) * disputePenalty(evidence.disputes) * voteFactor;
}

function computeLinkMetrics(link: Link, evidence: Evidence[], now = Date.now()) {
  if (evidence.length === 0) {
    return {
      strength: 0,
      scorePercent: 0,
      strokeWidth: 1,
      opacity: 0.12,
      contested: false,
      averageEvidenceScore: 0,
      evidenceCount: 0,
      recencyBoost: 0,
    };
  }

  const evidenceScores = evidence.map((entry) => evidenceStrength(entry, now));
  const averageEvidenceScore = evidenceScores.reduce((sum, score) => sum + score, 0) / evidenceScores.length;
  const countFactor = Math.min(1.65, 0.72 + Math.log2(evidence.length + 1) * 0.35);
  const confidenceFactor = 0.65 + link.confidenceLevel * 0.12;
  const freshEvidence = evidence.filter((entry) => now - new Date(entry.publishedAt).getTime() <= 180 * DAY_IN_MS).length;
  const recencyBoost = freshEvidence / evidence.length;
  const strength = clamp(averageEvidenceScore * countFactor * confidenceFactor, 0, 2.4);

  return {
    strength,
    scorePercent: Math.round((strength / 2.4) * 100),
    strokeWidth: 1.5 + strength * 3.2,
    opacity: clamp(0.18 + strength * 0.32, 0.18, 0.98),
    contested: evidence.some((entry) => entry.disputes.some((dispute) => dispute.status !== "resolved")),
    averageEvidenceScore,
    evidenceCount: evidence.length,
    recencyBoost,
  };
}

function parseXPost(url: string) {
  try {
    const parsed = new URL(url);
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(parsed.hostname)) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const statusIndex = segments.findIndex((segment) => segment === "status");
    if (statusIndex <= 0 || statusIndex === segments.length - 1) return null;
    const authorHandle = segments[statusIndex - 1].replace(/^@/, "");
    const postId = segments[statusIndex + 1];
    if (!authorHandle || !postId) return null;
    return {
      authorHandle,
      postId,
      canonicalUrl: `https://x.com/${authorHandle}/status/${postId}`,
    } satisfies XPostMetadata;
  } catch {
    return null;
  }
}

function normalizeEvidenceInput(url: string, sourceType: SourceType) {
  const trimmedUrl = url.trim();
  const xPost = parseXPost(trimmedUrl);
  if (xPost) {
    return {
      url: trimmedUrl,
      canonicalUrl: xPost.canonicalUrl,
      sourceType: "x" as const,
      xPost,
    };
  }
  return {
    url: trimmedUrl,
    canonicalUrl: trimmedUrl,
    sourceType,
    xPost: null,
  };
}

function hydrateEvidence(rawEvidence: Partial<Evidence> & { timestamp?: string }): Evidence {
  const fallbackTimestamp = rawEvidence.timestamp ?? rawEvidence.addedAt ?? new Date().toISOString();
  return {
    id: rawEvidence.id ?? uid("evidence"),
    url: rawEvidence.url ?? "",
    canonicalUrl: rawEvidence.canonicalUrl ?? rawEvidence.url ?? "",
    note: rawEvidence.note ?? "",
    citation: rawEvidence.citation ?? "",
    submitter: rawEvidence.submitter ?? "anonymous",
    addedAt: rawEvidence.addedAt ?? fallbackTimestamp,
    publishedAt: rawEvidence.publishedAt ?? fallbackTimestamp,
    capturedAt: rawEvidence.capturedAt ?? fallbackTimestamp,
    votes: rawEvidence.votes ?? 0,
    sourceType: rawEvidence.sourceType ?? (parseXPost(rawEvidence.url ?? "") ? "x" : "other"),
    reliability: rawEvidence.reliability ?? "medium",
    archiveNote: rawEvidence.archiveNote ?? "",
    xPost: rawEvidence.xPost ?? parseXPost(rawEvidence.canonicalUrl ?? rawEvidence.url ?? ""),
    disputes: Array.isArray(rawEvidence.disputes)
      ? rawEvidence.disputes.map((dispute) => ({
          id: dispute.id ?? uid("dispute"),
          reporter: dispute.reporter ?? "anonymous",
          reason: dispute.reason ?? "",
          createdAt: dispute.createdAt ?? fallbackTimestamp,
          status: dispute.status ?? "open",
          counterEvidence: dispute.counterEvidence ?? null,
          resolutionNote: dispute.resolutionNote ?? "",
          resolvedAt: dispute.resolvedAt ?? null,
        }))
      : [],
  };
}

function hydrateBoard(raw: string | null): BoardData {
  if (!raw) return defaultData;
  try {
    const parsed = JSON.parse(raw) as Partial<BoardData>;
    return {
      entities: Array.isArray(parsed.entities)
        ? parsed.entities.map((entity) => ({
            id: entity.id ?? uid("entity"),
            type: entity.type ?? "person",
            name: entity.name ?? "Untitled entity",
            description: entity.description ?? "",
            tags: Array.isArray(entity.tags) ? entity.tags : [],
            createdAt: entity.createdAt ?? new Date().toISOString(),
          }))
        : [],
      links: Array.isArray(parsed.links)
        ? parsed.links.map((link) => ({
            id: link.id ?? uid("link"),
            sourceEntityId: link.sourceEntityId ?? "",
            targetEntityId: link.targetEntityId ?? "",
            relationshipType: link.relationshipType ?? "related to",
            confidenceLevel: clamp(link.confidenceLevel ?? 3, 1, 5),
            createdAt: link.createdAt ?? new Date().toISOString(),
            evidence: Array.isArray(link.evidence) ? link.evidence.map((evidence) => hydrateEvidence(evidence)) : [],
          }))
        : [],
      reports: Array.isArray(parsed.reports)
        ? parsed.reports.map((report) => ({
            id: report.id ?? uid("report"),
            targetType: report.targetType ?? "entity",
            targetId: report.targetId ?? "",
            reason: report.reason ?? "",
            createdAt: report.createdAt ?? new Date().toISOString(),
          }))
        : [],
      auditTrail: Array.isArray(parsed.auditTrail)
        ? parsed.auditTrail.map((entry) => ({
            id: entry.id ?? uid("audit"),
            targetType: entry.targetType ?? "audit",
            targetId: entry.targetId ?? "",
            action: entry.action ?? "unknown",
            detail: entry.detail ?? "",
            timestamp: entry.timestamp ?? new Date().toISOString(),
            prevHash: entry.prevHash ?? "genesis",
            hash: entry.hash ?? hashValue(JSON.stringify(entry)),
          }))
        : [],
    };
  } catch {
    return defaultData;
  }
}

function entityLabel(entityId: string, entities: Entity[]) {
  return entities.find((entity) => entity.id === entityId)?.name ?? "Unknown entity";
}

function isoFromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function ageInDays(timestamp: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / DAY_IN_MS));
}

function buildEntityPositions(entities: Entity[], current: Record<string, Position>) {
  const next: Record<string, Position> = {};
  entities.forEach((entity, index) => {
    if (current[entity.id]) {
      next[entity.id] = current[entity.id];
      return;
    }
    const angle = (Math.PI * 2 * index) / Math.max(entities.length, 1);
    const radius = 180 + (index % 5) * 30;
    next[entity.id] = {
      x: 320 + Math.cos(angle) * radius,
      y: 250 + Math.sin(angle) * radius,
    };
  });
  return { ...current, ...next };
}

export default function Home() {
  const [board, setBoard] = useState<BoardData>(() => {
    if (typeof window === "undefined") return defaultData;
    return hydrateBoard(localStorage.getItem(STORAGE_KEY));
  });
  const [positions, setPositions] = useState<Record<string, Position>>({});
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
  const [evidenceSourceType, setEvidenceSourceType] = useState<SourceType>("article");
  const [evidenceReliability, setEvidenceReliability] = useState<ReliabilityLevel>("medium");
  const [evidencePublishedAt, setEvidencePublishedAt] = useState("");
  const [evidenceArchiveNote, setEvidenceArchiveNote] = useState("");
  const [reportTargetType, setReportTargetType] = useState<ReportTargetType>("entity");
  const [reportTargetId, setReportTargetId] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [neighborhoodDepth, setNeighborhoodDepth] = useState("all");
  const [minConfidenceFilter, setMinConfidenceFilter] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<SourceType | "all">("all");
  const [recencyDaysFilter, setRecencyDaysFilter] = useState("all");
  const [contestedOnly, setContestedOnly] = useState(false);
  const [timelineProgress, setTimelineProgress] = useState(100);
  const [disputeTargetId, setDisputeTargetId] = useState("");
  const [disputeReporter, setDisputeReporter] = useState("community-review");
  const [disputeReason, setDisputeReason] = useState("");
  const [counterEvidenceUrl, setCounterEvidenceUrl] = useState("");
  const [counterEvidenceNote, setCounterEvidenceNote] = useState("");
  const [resolutionTargetId, setResolutionTargetId] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<
    | { type: "node"; entityId: string }
    | { type: "pan"; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
    | null
  >(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  }, [board]);

  useEffect(() => {
    setPositions((current) => buildEntityPositions(board.entities, current));
  }, [board.entities]);

  useEffect(() => {
    if (!selectedEntityId && board.entities[0]) {
      setSelectedEntityId(board.entities[0].id);
    }
  }, [board.entities, selectedEntityId]);

  const evidenceTargets = useMemo(
    () =>
      board.links.flatMap((link) =>
        link.evidence.map((evidence) => ({
          linkId: link.id,
          evidenceId: evidence.id,
          label: `${entityLabel(link.sourceEntityId, board.entities)} → ${entityLabel(link.targetEntityId, board.entities)} • ${truncate(evidence.canonicalUrl, 50)}`,
        })),
      ),
    [board.entities, board.links],
  );

  const filteredEntities = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return board.entities;
    return board.entities.filter((entity) => {
      const haystack = `${entity.name} ${entity.description} ${entity.tags.join(" ")} ${entity.type}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [board.entities, query]);

  const timelineEvents = useMemo(() => {
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
        label: `Evidence attached: ${entityLabel(link.sourceEntityId, board.entities)} ↔ ${entityLabel(link.targetEntityId, board.entities)}`,
        timestamp: evidence.addedAt,
      })),
    );
    const disputeEvents = board.links.flatMap((link) =>
      link.evidence.flatMap((evidence) =>
        evidence.disputes.map((dispute) => ({
          id: dispute.id,
          type: "dispute" as const,
          label: `Dispute ${dispute.status}: ${truncate(dispute.reason, 80)}`,
          timestamp: dispute.createdAt,
        })),
      ),
    );
    const reportEvents = board.reports.map((report) => ({
      id: report.id,
      type: "report" as const,
      label: `Report filed on ${report.targetType}`,
      timestamp: report.createdAt,
    }));
    return [...entityEvents, ...linkEvents, ...evidenceEvents, ...disputeEvents, ...reportEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }, [board.entities, board.links, board.reports]);

  const timelineRange = useMemo(() => {
    if (timelineEvents.length === 0) {
      const now = Date.now();
      return { min: now, max: now, cutoff: now };
    }
    const min = new Date(timelineEvents[0].timestamp).getTime();
    const max = new Date(timelineEvents.at(-1)?.timestamp ?? timelineEvents[0].timestamp).getTime();
    return {
      min,
      max,
      cutoff: min + (max - min) * (timelineProgress / 100),
    };
  }, [timelineEvents, timelineProgress]);

  const visibleLinks = useMemo<VisibleLink[]>(() => {
    const matchingEntityIds = new Set(filteredEntities.map((entity) => entity.id));
    const recencyDays = recencyDaysFilter === "all" ? Infinity : Number(recencyDaysFilter);

    return board.links
      .filter((link) => link.confidenceLevel >= minConfidenceFilter)
      .map((link) => {
        const evidence = link.evidence.filter((entry) => {
          const publishedMs = new Date(entry.publishedAt).getTime();
          if (publishedMs > timelineRange.cutoff) return false;
          if (sourceFilter !== "all" && entry.sourceType !== sourceFilter) return false;
          if (recencyDays !== Infinity && ageInDays(entry.publishedAt) > recencyDays) return false;
          if (contestedOnly && !entry.disputes.some((dispute) => dispute.status !== "resolved")) return false;
          return true;
        });
        return {
          link,
          evidence,
          metrics: computeLinkMetrics(link, evidence),
        };
      })
      .filter(({ link, evidence }) => {
        if (evidence.length === 0) return false;
        if (!query.trim()) return true;
        return matchingEntityIds.has(link.sourceEntityId) || matchingEntityIds.has(link.targetEntityId);
      });
  }, [board.links, contestedOnly, filteredEntities, minConfidenceFilter, query, recencyDaysFilter, sourceFilter, timelineRange.cutoff]);

  const visibleEntityIds = useMemo(() => {
    const ids = new Set<string>();
    visibleLinks.forEach(({ link }) => {
      ids.add(link.sourceEntityId);
      ids.add(link.targetEntityId);
    });
    if (query.trim()) {
      filteredEntities.forEach((entity) => ids.add(entity.id));
    }
    if (!selectedEntityId || neighborhoodDepth === "all") return ids;

    const depth = Number(neighborhoodDepth);
    const adjacency = new Map<string, Set<string>>();
    visibleLinks.forEach(({ link }) => {
      adjacency.set(link.sourceEntityId, adjacency.get(link.sourceEntityId) ?? new Set());
      adjacency.set(link.targetEntityId, adjacency.get(link.targetEntityId) ?? new Set());
      adjacency.get(link.sourceEntityId)?.add(link.targetEntityId);
      adjacency.get(link.targetEntityId)?.add(link.sourceEntityId);
    });

    const focused = new Set<string>([selectedEntityId]);
    let frontier = [selectedEntityId];
    for (let step = 0; step < depth; step += 1) {
      const next: string[] = [];
      frontier.forEach((entityId) => {
        adjacency.get(entityId)?.forEach((neighborId) => {
          if (!focused.has(neighborId)) {
            focused.add(neighborId);
            next.push(neighborId);
          }
        });
      });
      frontier = next;
    }
    return focused;
  }, [filteredEntities, neighborhoodDepth, query, selectedEntityId, visibleLinks]);

  const graphLinks = useMemo(
    () =>
      visibleLinks.filter(({ link }) => visibleEntityIds.has(link.sourceEntityId) && visibleEntityIds.has(link.targetEntityId)),
    [visibleEntityIds, visibleLinks],
  );

  const visibleEntities = useMemo(
    () => board.entities.filter((entity) => visibleEntityIds.has(entity.id)),
    [board.entities, visibleEntityIds],
  );

  const selectedCaseLinks = useMemo(
    () =>
      graphLinks.filter(
        ({ link }) => selectedEntityId && (link.sourceEntityId === selectedEntityId || link.targetEntityId === selectedEntityId),
      ),
    [graphLinks, selectedEntityId],
  );

  const clusterOverlays = useMemo(() => {
    return ENTITY_TYPE_OPTIONS.flatMap((type) => {
      const nodes = visibleEntities.filter((entity) => entity.type === type && positions[entity.id]);
      if (nodes.length === 0) return [];
      const centroid = nodes.reduce(
        (accumulator, entity) => ({
          x: accumulator.x + positions[entity.id].x,
          y: accumulator.y + positions[entity.id].y,
        }),
        { x: 0, y: 0 },
      );
      const center = {
        x: centroid.x / nodes.length,
        y: centroid.y / nodes.length,
      };
      const radius = Math.max(
        70,
        ...nodes.map((entity) => {
          const dx = positions[entity.id].x - center.x;
          const dy = positions[entity.id].y - center.y;
          return Math.sqrt(dx * dx + dy * dy) + 48;
        }),
      );
      return [{ type, center, radius, count: nodes.length }];
    });
  }, [positions, visibleEntities]);

  const stats = useMemo(() => {
    const supportedLinks = board.links.filter((link) => link.evidence.length > 0).length;
    const contestedEvidence = board.links.flatMap((link) => link.evidence).filter((evidence) => evidence.disputes.length > 0).length;
    const xEvidence = board.links.flatMap((link) => link.evidence).filter((evidence) => evidence.sourceType === "x").length;
    return {
      entityCount: board.entities.length,
      supportedLinks,
      contestedEvidence,
      xEvidence,
      auditEntries: board.auditTrail.length,
    };
  }, [board.auditTrail.length, board.entities.length, board.links]);

  const availableReportTargets =
    reportTargetType === "entity"
      ? board.entities.map((entity) => ({ id: entity.id, label: `${entity.name} (${entity.type})` }))
      : reportTargetType === "link"
        ? board.links.map((link) => ({
            id: link.id,
            label: `${entityLabel(link.sourceEntityId, board.entities)} → ${entityLabel(link.targetEntityId, board.entities)}`,
          }))
        : evidenceTargets.map((target) => ({ id: target.evidenceId, label: target.label }));

  const openDisputes = useMemo(
    () =>
      board.links.flatMap((link) =>
        link.evidence.flatMap((evidence) =>
          evidence.disputes
            .filter((dispute) => dispute.status !== "resolved")
            .map((dispute) => ({
              disputeId: dispute.id,
              linkId: link.id,
              evidenceId: evidence.id,
              label: `${entityLabel(link.sourceEntityId, board.entities)} → ${entityLabel(link.targetEntityId, board.entities)} • ${truncate(dispute.reason, 60)}`,
            })),
        ),
      ),
    [board.entities, board.links],
  );

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

    setBoard((prev) => ({
      ...prev,
      entities: [nextEntity, ...prev.entities],
      auditTrail: appendAuditEntry(prev.auditTrail, "entity", nextEntity.id, "entity.created", `${nextEntity.type}:${nextEntity.name}`),
    }));
    setEntityName("");
    setEntityDescription("");
    setEntityTags("");
    setSelectedEntityId(nextEntity.id);
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
      confidenceLevel: clamp(confidenceLevel, 1, 5),
      createdAt: new Date().toISOString(),
      evidence: [],
    };

    setBoard((prev) => ({
      ...prev,
      links: [nextLink, ...prev.links],
      auditTrail: appendAuditEntry(
        prev.auditTrail,
        "link",
        nextLink.id,
        "link.created",
        `${entityLabel(sourceEntityId, prev.entities)}→${entityLabel(targetEntityId, prev.entities)}:${nextLink.relationshipType}`,
      ),
    }));
    setRelationshipType("");
    setConfidenceLevel(3);
    setLinkForEvidence(nextLink.id);
  }

  function addEvidence(event: FormEvent) {
    event.preventDefault();
    if (!linkForEvidence || !evidenceUrl.trim()) return;

    const normalized = normalizeEvidenceInput(evidenceUrl, evidenceSourceType);
    const now = new Date().toISOString();
    const nextEvidence: Evidence = {
      id: uid("evidence"),
      url: normalized.url,
      canonicalUrl: normalized.canonicalUrl,
      note: evidenceNote.trim(),
      citation: evidenceCitation.trim(),
      submitter: evidenceSubmitter.trim() || "anonymous",
      addedAt: now,
      publishedAt: isoFromLocalInput(evidencePublishedAt),
      capturedAt: now,
      votes: 0,
      sourceType: normalized.sourceType,
      reliability: evidenceReliability,
      archiveNote: evidenceArchiveNote.trim(),
      xPost: normalized.xPost,
      disputes: [],
    };

    setBoard((prev) => ({
      ...prev,
      links: prev.links.map((link) => {
        if (link.id !== linkForEvidence) return link;
        return { ...link, evidence: [nextEvidence, ...link.evidence] };
      }),
      auditTrail: appendAuditEntry(
        prev.auditTrail,
        "evidence",
        nextEvidence.id,
        "evidence.attached",
        `${nextEvidence.sourceType}:${truncate(nextEvidence.canonicalUrl, 90)}`,
      ),
    }));

    setEvidenceUrl("");
    setEvidenceNote("");
    setEvidenceCitation("");
    setEvidencePublishedAt("");
    setEvidenceArchiveNote("");
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
      auditTrail: appendAuditEntry(prev.auditTrail, "evidence", evidenceId, "evidence.voted", delta > 0 ? "upvote" : "downvote"),
    }));
  }

  function fileDispute(event: FormEvent) {
    event.preventDefault();
    if (!disputeTargetId || !disputeReason.trim()) return;

    const dispute: Dispute = {
      id: uid("dispute"),
      reporter: disputeReporter.trim() || "community-review",
      reason: disputeReason.trim(),
      createdAt: new Date().toISOString(),
      status: counterEvidenceUrl.trim() ? "countered" : "open",
      counterEvidence: counterEvidenceUrl.trim()
        ? {
            url: counterEvidenceUrl.trim(),
            note: counterEvidenceNote.trim(),
          }
        : null,
      resolutionNote: "",
      resolvedAt: null,
    };

    setBoard((prev) => ({
      ...prev,
      links: prev.links.map((link) => ({
        ...link,
        evidence: link.evidence.map((evidence) =>
          evidence.id === disputeTargetId ? { ...evidence, disputes: [dispute, ...evidence.disputes] } : evidence,
        ),
      })),
      auditTrail: appendAuditEntry(prev.auditTrail, "evidence", disputeTargetId, "evidence.disputed", truncate(dispute.reason, 120)),
    }));

    setDisputeTargetId("");
    setDisputeReason("");
    setCounterEvidenceUrl("");
    setCounterEvidenceNote("");
  }

  function resolveDispute(event: FormEvent) {
    event.preventDefault();
    if (!resolutionTargetId || !resolutionNote.trim()) return;

    setBoard((prev) => ({
      ...prev,
      links: prev.links.map((link) => ({
        ...link,
        evidence: link.evidence.map((evidence) => ({
          ...evidence,
          disputes: evidence.disputes.map((dispute) =>
            dispute.id === resolutionTargetId
              ? {
                  ...dispute,
                  status: "resolved",
                  resolutionNote: resolutionNote.trim(),
                  resolvedAt: new Date().toISOString(),
                }
              : dispute,
          ),
        })),
      })),
      auditTrail: appendAuditEntry(prev.auditTrail, "evidence", resolutionTargetId, "dispute.resolved", truncate(resolutionNote.trim(), 120)),
    }));

    setResolutionTargetId("");
    setResolutionNote("");
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

    setBoard((prev) => ({
      ...prev,
      reports: [nextReport, ...prev.reports],
      auditTrail: appendAuditEntry(prev.auditTrail, "audit", nextReport.id, "report.filed", `${nextReport.targetType}:${truncate(nextReport.reason, 120)}`),
    }));
    setReportReason("");
  }

  function handleNodeDragStart(entityId: string, event: ReactMouseEvent<SVGCircleElement>) {
    event.stopPropagation();
    dragRef.current = { type: "node", entityId };
    setSelectedEntityId(entityId);
  }

  function handleGraphMouseDown(event: ReactMouseEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    dragRef.current = {
      type: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
  }

  function handleGraphMouseMove(event: ReactMouseEvent<SVGSVGElement>) {
    if (!dragRef.current || !svgRef.current) return;
    if (dragRef.current.type === "pan") {
      setPan({
        x: dragRef.current.startPanX + (event.clientX - dragRef.current.startClientX),
        y: dragRef.current.startPanY + (event.clientY - dragRef.current.startClientY),
      });
      return;
    }

    const rect = svgRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left - pan.x) / zoom;
    const y = (event.clientY - rect.top - pan.y) / zoom;
    setPositions((current) => ({
      ...current,
      [dragRef.current?.entityId ?? ""]: { x, y },
    }));
  }

  function clearDrag() {
    dragRef.current = null;
  }

  return (
    <main style={styles.main}>
      <section style={styles.hero}>
        <div>
          <span style={styles.eyebrow}>Evidence-first investigative graph</span>
          <h1>Open Links Investigative Graph</h1>
          <p style={styles.heroText}>
            Build source-backed entity maps with weighted connections, contested evidence chains, X.com normalization, and a tamper-evident audit trail.
          </p>
        </div>
        <div style={styles.heroStats}>
          <StatCard label="Entities" value={stats.entityCount} />
          <StatCard label="Supported links" value={stats.supportedLinks} />
          <StatCard label="Contested evidence" value={stats.contestedEvidence} />
          <StatCard label="X posts captured" value={stats.xEvidence} />
          <StatCard label="Audit entries" value={stats.auditEntries} />
        </div>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2>Create Entity</h2>
          <form onSubmit={createEntity} style={styles.form}>
            <label>
              Type
              <select value={entityType} onChange={(event) => setEntityType(event.target.value as EntityType)}>
                {ENTITY_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input value={entityName} onChange={(event) => setEntityName(event.target.value)} placeholder="Entity name" />
            </label>
            <label>
              Description
              <textarea value={entityDescription} onChange={(event) => setEntityDescription(event.target.value)} placeholder="Why this entity matters to the case" />
            </label>
            <label>
              Tags (comma-separated)
              <input value={entityTags} onChange={(event) => setEntityTags(event.target.value)} placeholder="investigation, campaign, witness" />
            </label>
            <button type="submit">Add entity</button>
          </form>
        </article>

        <article style={styles.card}>
          <h2>Create Link</h2>
          <p style={styles.muted}>Links enter the graph immediately, but they only gain strength and visibility once evidence is attached.</p>
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
              <input value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)} placeholder="financed, appeared with, amplified" />
            </label>
            <label>
              Confidence level (1-5)
              <input type="number" min={1} max={5} value={confidenceLevel} onChange={(event) => setConfidenceLevel(Number(event.target.value))} />
            </label>
            <button type="submit">Create investigative link</button>
          </form>
        </article>

        <article style={styles.card}>
          <h2>Attach Evidence</h2>
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
              <input type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://x.com/user/status/123" />
            </label>
            <label>
              Source type
              <select value={evidenceSourceType} onChange={(event) => setEvidenceSourceType(event.target.value as SourceType)}>
                {SOURCE_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reliability label
              <select value={evidenceReliability} onChange={(event) => setEvidenceReliability(event.target.value as ReliabilityLevel)}>
                {RELIABILITY_OPTIONS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source published at
              <input type="datetime-local" value={evidencePublishedAt} onChange={(event) => setEvidencePublishedAt(event.target.value)} />
            </label>
            <label>
              What this evidence supports
              <textarea value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} placeholder="Explain how the source supports the relationship" />
            </label>
            <label>
              Citation metadata
              <input value={evidenceCitation} onChange={(event) => setEvidenceCitation(event.target.value)} placeholder="Publisher, author, date, title" />
            </label>
            <label>
              X/thread fallback or archive note
              <textarea value={evidenceArchiveNote} onChange={(event) => setEvidenceArchiveNote(event.target.value)} placeholder="Snapshot note for deleted or locked posts" />
            </label>
            <label>
              Submitter
              <input value={evidenceSubmitter} onChange={(event) => setEvidenceSubmitter(event.target.value)} placeholder="anonymous" />
            </label>
            <button type="submit">Attach source-backed evidence</button>
          </form>
        </article>
      </section>

      <section style={styles.card}>
        <div style={styles.sectionHeader}>
          <div>
            <h2>Interactive Investigative Graph</h2>
            <p style={styles.muted}>Drag nodes, drag the background to pan, and zoom to inspect how links harden as evidence quality improves.</p>
          </div>
          <div style={styles.rowWrap}>
            <button type="button" onClick={() => setZoom((current) => clamp(current + 0.15, 0.6, 2.4))}>
              Zoom in
            </button>
            <button type="button" onClick={() => setZoom((current) => clamp(current - 0.15, 0.6, 2.4))}>
              Zoom out
            </button>
            <button type="button" onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}>
              Reset view
            </button>
          </div>
        </div>

        <div style={styles.filtersGrid}>
          <label>
            Search entities
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="name, tag, claim, witness" />
          </label>
          <label>
            Case focus
            <select value={selectedEntityId} onChange={(event) => setSelectedEntityId(event.target.value)}>
              <option value="">No focus</option>
              {board.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Neighborhood depth
            <select value={neighborhoodDepth} onChange={(event) => setNeighborhoodDepth(event.target.value)}>
              <option value="all">All visible</option>
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
              <option value="3">3 hops</option>
            </select>
          </label>
          <label>
            Minimum confidence
            <input type="range" min={1} max={5} value={minConfidenceFilter} onChange={(event) => setMinConfidenceFilter(Number(event.target.value))} />
            <span>{minConfidenceFilter}/5</span>
          </label>
          <label>
            Source type
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceType | "all")}>
              <option value="all">All sources</option>
              {SOURCE_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date range
            <select value={recencyDaysFilter} onChange={(event) => setRecencyDaysFilter(event.target.value)}>
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last year</option>
              <option value="730">Last 2 years</option>
            </select>
          </label>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={contestedOnly} onChange={(event) => setContestedOnly(event.target.checked)} />
            Only contested evidence
          </label>
          <label>
            Timeline playback
            <input type="range" min={0} max={100} value={timelineProgress} onChange={(event) => setTimelineProgress(Number(event.target.value))} />
            <span>{formatDate(new Date(timelineRange.cutoff).toISOString())}</span>
          </label>
        </div>

        <div style={styles.graphShell}>
          <svg
            ref={svgRef}
            viewBox="0 0 760 520"
            style={styles.graphCanvas}
            onMouseDown={handleGraphMouseDown}
            onMouseMove={handleGraphMouseMove}
            onMouseUp={clearDrag}
            onMouseLeave={clearDrag}
          >
            <rect x={0} y={0} width={760} height={520} fill="#03111f" rx={18} />
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {clusterOverlays.map((cluster) => (
                <g key={cluster.type}>
                  <circle cx={cluster.center.x} cy={cluster.center.y} r={cluster.radius} fill={ENTITY_COLORS[cluster.type]} opacity={0.08} />
                  <text x={cluster.center.x} y={cluster.center.y - cluster.radius - 10} fill="#cbd5f5" textAnchor="middle" fontSize="12">
                    {cluster.type} cluster ({cluster.count})
                  </text>
                </g>
              ))}

              {graphLinks.map(({ link, metrics }) => {
                const source = positions[link.sourceEntityId];
                const target = positions[link.targetEntityId];
                if (!source || !target) return null;
                const midX = (source.x + target.x) / 2;
                const midY = (source.y + target.y) / 2;
                return (
                  <g key={link.id}>
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={metrics.contested ? "#f59e0b" : "#7dd3fc"}
                      strokeWidth={metrics.strokeWidth}
                      strokeOpacity={metrics.opacity}
                      strokeDasharray={metrics.contested ? "10 8" : "0"}
                    />
                    <text x={midX} y={midY - 8} fill="#dbeafe" fontSize="11" textAnchor="middle">
                      {link.relationshipType} • {metrics.scorePercent}%
                    </text>
                  </g>
                );
              })}

              {visibleEntities.map((entity) => {
                const position = positions[entity.id];
                if (!position) return null;
                const selected = entity.id === selectedEntityId;
                return (
                  <g key={entity.id}>
                    <circle
                      cx={position.x}
                      cy={position.y}
                      r={selected ? 22 : 18}
                      fill={ENTITY_COLORS[entity.type]}
                      stroke={selected ? "#f8fafc" : "#94a3b8"}
                      strokeWidth={selected ? 3 : 1.5}
                      onMouseDown={(event) => handleNodeDragStart(entity.id, event)}
                      onClick={() => setSelectedEntityId(entity.id)}
                    />
                    <text x={position.x} y={position.y + 34} fill="#f8fafc" fontSize="12" textAnchor="middle">
                      {truncate(entity.name, 18)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          <div style={styles.sidePanel}>
            <h3>Case view</h3>
            {selectedEntityId ? (
              <>
                <p>
                  Focused entity: <strong>{entityLabel(selectedEntityId, board.entities)}</strong>
                </p>
                <p style={styles.muted}>Neighborhood expansion lets investigators isolate one claim or entity and expand outward step by step.</p>
                <ul style={styles.listPlain}>
                  {selectedCaseLinks.map(({ link, metrics }) => (
                    <li key={link.id} style={styles.metricItem}>
                      <strong>{entityLabel(link.sourceEntityId, board.entities)} → {entityLabel(link.targetEntityId, board.entities)}</strong>
                      <span>{link.relationshipType}</span>
                      <span>Strength: {metrics.scorePercent}%</span>
                      <span>Evidence: {metrics.evidenceCount}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p style={styles.muted}>Select an entity to inspect its local case graph.</p>
            )}

            <h3>Timeline playback</h3>
            <p style={styles.muted}>Current cutoff: {formatDate(new Date(timelineRange.cutoff).toISOString())}</p>
            <ul style={styles.listPlain}>
              {timelineEvents
                .filter((item) => new Date(item.timestamp).getTime() <= timelineRange.cutoff)
                .slice()
                .reverse()
                .slice(0, 8)
                .map((item) => (
                  <li key={item.id} style={styles.metricItem}>
                    <strong>{item.type}</strong>
                    <span>{item.label}</span>
                    <span>{formatDate(item.timestamp)}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </section>

      <section style={styles.gridLarge}>
        <article style={styles.card}>
          <h2>Provenance & Weighted Links</h2>
          <p style={styles.muted}>Every visible edge is explained by evidence count, votes, reliability, source type, and temporal decay.</p>
          <ul style={styles.listPlain}>
            {graphLinks.map(({ link, evidence, metrics }) => (
              <li key={link.id} style={styles.linkCard}>
                <div style={styles.linkHeader}>
                  <div>
                    <strong>{entityLabel(link.sourceEntityId, board.entities)} → {entityLabel(link.targetEntityId, board.entities)}</strong>
                    <div style={styles.muted}>{link.relationshipType}</div>
                  </div>
                  <span style={badgeStyle(metrics.contested ? "#f59e0b" : "#0f766e")}>{metrics.scorePercent}% hardened</span>
                </div>
                <div style={styles.metaGrid}>
                  <span>Confidence: {link.confidenceLevel}/5</span>
                  <span>Evidence count: {metrics.evidenceCount}</span>
                  <span>Average evidence score: {metrics.averageEvidenceScore.toFixed(2)}</span>
                  <span>Recent evidence ratio: {Math.round(metrics.recencyBoost * 100)}%</span>
                </div>
                <details>
                  <summary>Why this link exists</summary>
                  <ul style={styles.listPlain}>
                    {evidence.map((item) => (
                      <li key={item.id} style={styles.evidenceCard}>
                        <div style={styles.linkHeader}>
                          <a href={item.canonicalUrl} target="_blank" rel="noreferrer">
                            {truncate(item.canonicalUrl, 72)}
                          </a>
                          <div style={styles.rowWrap}>
                            <span style={badgeStyle("#2563eb")}>{item.sourceType}</span>
                            <span style={badgeStyle(item.reliability === "high" ? "#0f766e" : item.reliability === "medium" ? "#d97706" : "#b91c1c")}>
                              {item.reliability}
                            </span>
                            <span style={badgeStyle(item.disputes.some((dispute) => dispute.status !== "resolved") ? "#f59e0b" : "#475569")}>
                              {item.disputes.some((dispute) => dispute.status !== "resolved") ? "contested" : "clear"}
                            </span>
                          </div>
                        </div>
                        <div>{item.note || "No explanatory note provided."}</div>
                        <div>{item.citation || "No citation metadata provided."}</div>
                        <div style={styles.metaGrid}>
                          <span>Published: {formatDate(item.publishedAt)}</span>
                          <span>Captured: {formatDate(item.capturedAt)}</span>
                          <span>Votes: {item.votes}</span>
                          <span>Strength contribution: {evidenceStrength(item).toFixed(2)}</span>
                        </div>
                        {item.xPost ? (
                          <div style={styles.metaGrid}>
                            <span>Handle: @{item.xPost.authorHandle}</span>
                            <span>Post ID: {item.xPost.postId}</span>
                            <a href={item.xPost.canonicalUrl} target="_blank" rel="noreferrer">
                              Open source thread on X
                            </a>
                          </div>
                        ) : null}
                        {item.archiveNote ? <div style={styles.archiveBox}>Fallback note: {item.archiveNote}</div> : null}
                        <div style={styles.rowWrap}>
                          <button type="button" onClick={() => voteEvidence(link.id, item.id, 1)}>
                            Upvote
                          </button>
                          <button type="button" onClick={() => voteEvidence(link.id, item.id, -1)}>
                            Downvote
                          </button>
                        </div>
                        {item.disputes.length > 0 ? (
                          <details>
                            <summary>Disputes ({item.disputes.length})</summary>
                            <ul style={styles.listPlain}>
                              {item.disputes.map((dispute) => (
                                <li key={dispute.id} style={styles.metricItem}>
                                  <strong>{dispute.status}</strong>
                                  <span>{dispute.reason}</span>
                                  <span>Reporter: {dispute.reporter}</span>
                                  {dispute.counterEvidence ? <span>Counter-evidence: {truncate(dispute.counterEvidence.url, 60)}</span> : null}
                                  {dispute.resolutionNote ? <span>Resolution: {dispute.resolutionNote}</span> : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </article>

        <article style={styles.card}>
          <h2>Disputes, Reports & Audit Trail</h2>
          <div style={styles.subsection}>
            <h3>Challenge evidence</h3>
            <form onSubmit={fileDispute} style={styles.form}>
              <label>
                Evidence target
                <select value={disputeTargetId} onChange={(event) => setDisputeTargetId(event.target.value)}>
                  <option value="">Select evidence</option>
                  {evidenceTargets.map((target) => (
                    <option key={target.evidenceId} value={target.evidenceId}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reporter
                <input value={disputeReporter} onChange={(event) => setDisputeReporter(event.target.value)} placeholder="community-review" />
              </label>
              <label>
                Challenge reason
                <textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} placeholder="Explain what is incomplete, misleading, or contradicted" />
              </label>
              <label>
                Counter-evidence URL
                <input type="url" value={counterEvidenceUrl} onChange={(event) => setCounterEvidenceUrl(event.target.value)} placeholder="https://source.example/counter" />
              </label>
              <label>
                Counter-evidence note
                <textarea value={counterEvidenceNote} onChange={(event) => setCounterEvidenceNote(event.target.value)} placeholder="What the counter-evidence changes" />
              </label>
              <button type="submit">File dispute</button>
            </form>
          </div>

          <div style={styles.subsection}>
            <h3>Moderator resolution log</h3>
            <form onSubmit={resolveDispute} style={styles.form}>
              <label>
                Open dispute
                <select value={resolutionTargetId} onChange={(event) => setResolutionTargetId(event.target.value)}>
                  <option value="">Select dispute</option>
                  {openDisputes.map((dispute) => (
                    <option key={dispute.disputeId} value={dispute.disputeId}>
                      {dispute.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Resolution note
                <textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Describe the moderation outcome" />
              </label>
              <button type="submit">Resolve dispute</button>
            </form>
          </div>

          <div style={styles.subsection}>
            <h3>Moderation reports</h3>
            <form onSubmit={fileReport} style={styles.form}>
              <label>
                Target type
                <select
                  value={reportTargetType}
                  onChange={(event) => {
                    const next = event.target.value as ReportTargetType;
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
                <textarea value={reportReason} onChange={(event) => setReportReason(event.target.value)} placeholder="False info, abuse, doxxing, manipulation" />
              </label>
              <button type="submit">Submit report</button>
            </form>
          </div>

          <div style={styles.subsection}>
            <h3>Tamper-evident audit trail</h3>
            <ul style={styles.listPlain}>
              {board.auditTrail.slice().reverse().slice(0, 10).map((entry) => (
                <li key={entry.id} style={styles.auditItem}>
                  <strong>{entry.action}</strong>
                  <span>{entry.detail}</span>
                  <span>{formatDate(entry.timestamp)}</span>
                  <span>prev: {entry.prevHash}</span>
                  <span>hash: {entry.hash}</span>
                </li>
              ))}
            </ul>
          </div>
        </article>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2>Investigative positioning</h2>
          <p>
            Open Links is not just a visual mapper. It is an evidence-first investigation workspace where links stay legible, contestable, and fully sourced.
          </p>
        </article>
        <article style={styles.card}>
          <h2>Why it competes with Kumu</h2>
          <p>
            The moat is truth maintenance: evidence weighting, provenance, dispute handling, and auditability. Visualization supports investigation rather than replacing it.
          </p>
        </article>
        <article style={styles.card}>
          <h2>X.com support</h2>
          <p>
            X post URLs are normalized into canonical threads with handle and post ID capture, while archive notes preserve context for deleted or locked posts.
          </p>
        </article>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.statCard}>
      <strong style={styles.statValue}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function badgeStyle(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.2rem 0.55rem",
    borderRadius: "999px",
    background: `${color}18`,
    color,
    fontSize: "0.78rem",
    fontWeight: 700,
  };
}

const styles: Record<string, CSSProperties> = {
  main: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    padding: "1rem",
    maxWidth: "1480px",
    margin: "0 auto",
    fontFamily: "Arial, sans-serif",
  },
  hero: {
    display: "grid",
    gap: "1rem",
    gridTemplateColumns: "1.2fr 1fr",
    padding: "1.25rem",
    border: "1px solid #1e293b",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #020617 0%, #111827 45%, #0f172a 100%)",
    color: "#f8fafc",
  },
  eyebrow: {
    display: "inline-flex",
    padding: "0.25rem 0.6rem",
    borderRadius: "999px",
    background: "rgba(125, 211, 252, 0.12)",
    color: "#7dd3fc",
    fontSize: "0.78rem",
    fontWeight: 700,
    marginBottom: "0.75rem",
  },
  heroText: {
    marginTop: "0.75rem",
    maxWidth: "760px",
    color: "#cbd5e1",
    lineHeight: 1.6,
  },
  heroStats: {
    display: "grid",
    gap: "0.8rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "0.35rem",
    padding: "0.9rem",
    borderRadius: "14px",
    background: "rgba(15, 23, 42, 0.75)",
    border: "1px solid rgba(148, 163, 184, 0.22)",
  },
  statValue: {
    fontSize: "1.4rem",
  },
  grid: {
    display: "grid",
    gap: "1rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  },
  gridLarge: {
    display: "grid",
    gap: "1rem",
    gridTemplateColumns: "1.4fr 1fr",
  },
  card: {
    border: "1px solid #d4d4d8",
    borderRadius: "16px",
    padding: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.8rem",
    background: "#fff",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "0.65rem",
  },
  muted: {
    color: "#475569",
    lineHeight: 1.5,
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  rowWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    alignItems: "center",
  },
  filtersGrid: {
    display: "grid",
    gap: "0.8rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    alignItems: "end",
  },
  checkboxLabel: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    alignSelf: "center",
  },
  graphShell: {
    display: "grid",
    gap: "1rem",
    gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
    alignItems: "start",
  },
  graphCanvas: {
    width: "100%",
    minHeight: "520px",
    borderRadius: "18px",
    border: "1px solid #0f172a",
    cursor: "grab",
  },
  sidePanel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.9rem",
    padding: "0.8rem",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },
  listPlain: {
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    margin: 0,
    padding: 0,
  },
  metricItem: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.7rem",
    borderRadius: "12px",
    background: "#fff",
    border: "1px solid #e2e8f0",
  },
  linkCard: {
    display: "flex",
    flexDirection: "column",
    gap: "0.65rem",
    padding: "0.9rem",
    borderRadius: "14px",
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
  },
  linkHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "0.75rem",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  metaGrid: {
    display: "grid",
    gap: "0.45rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    color: "#334155",
    fontSize: "0.92rem",
  },
  evidenceCard: {
    display: "flex",
    flexDirection: "column",
    gap: "0.55rem",
    padding: "0.8rem",
    borderRadius: "12px",
    background: "#fff",
    border: "1px solid #e2e8f0",
  },
  archiveBox: {
    padding: "0.7rem",
    borderRadius: "10px",
    background: "#fff7ed",
    border: "1px solid #fdba74",
    color: "#9a3412",
  },
  subsection: {
    display: "flex",
    flexDirection: "column",
    gap: "0.65rem",
    paddingTop: "0.2rem",
  },
  auditItem: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.75rem",
    borderRadius: "12px",
    background: "#0f172a",
    color: "#e2e8f0",
  },
};
