import { parseSemanticGraph, type IriographDocument } from "@iriograph/core";
import type { Literal, Quad, Term } from "n3";

import type {
  AliasKind,
  HierarchyRelation,
  LocalizedText,
  MembershipQuery,
  NeighborQuery,
  RevisionAlias,
  SemanticAccessOptions,
  SemanticMembership,
  SemanticPredicateSearchMatch,
  SemanticPredicateSummary,
  SemanticRelation,
  SemanticResourceDescription,
  SemanticResourceSummary,
  SemanticSearchMatch,
  SemanticSubgraph,
  SubgraphQuery,
} from "./model.js";
import {
  RDF_ORDINAL_PREFIX,
  RDF_PROPERTY,
  RDF_TYPE,
  RDFS_COMMENT,
  RDFS_LABEL,
  RDFS_MEMBER,
  RDFS_SUBCLASS_OF,
  RDFS_SUBPROPERTY_OF,
  SKOS_ALT_LABEL,
  SKOS_PREF_LABEL,
} from "./vocabulary.js";
import { StaleSemanticRevisionError, UnknownSemanticAliasError } from "./model.js";

type ResourceRecord = {
  iri: string;
  labels: LocalizedText[];
  comments: LocalizedText[];
  types: string[];
};

type SearchCandidate = {
  score: number;
  matchedField: SemanticSearchMatch["matchedField"];
  matchedText: string;
};

type MembershipClassification = {
  distance: number;
  kind: SemanticMembership["kind"];
};

const DEFAULT_LIMIT = 25;
const DEFAULT_SUBGRAPH_LIMIT = 500;

/**
 * Immutable, revision-bound read index over one Iriograph semantic snapshot.
 * Labels aid discovery only: every result and operation remains IRI-backed.
 */
export class SemanticAccessIndex {
  readonly revision: string;
  readonly document: IriographDocument;

  readonly #locales: readonly string[];
  readonly #records: ReadonlyMap<string, ResourceRecord>;
  readonly #resourceIris: readonly string[];
  readonly #predicateIris: readonly string[];
  readonly #resourceAliases: ReadonlyMap<string, string>;
  readonly #resourceIrisByAlias: ReadonlyMap<string, string>;
  readonly #predicateAliases: ReadonlyMap<string, string>;
  readonly #predicateIrisByAlias: ReadonlyMap<string, string>;
  readonly #quads: readonly Quad[];
  readonly #superClasses: ReadonlyMap<string, readonly string[]>;
  readonly #superProperties: ReadonlyMap<string, readonly string[]>;
  readonly #membershipClassifications: ReadonlyMap<string, MembershipClassification>;
  readonly #predicateUsage: ReadonlyMap<string, number>;

  constructor(document: IriographDocument, revision: string, options: SemanticAccessOptions = {}) {
    if (!revision) throw new TypeError("Semantic access revision must not be empty.");
    // Portable documents are JSON values. A JSON boundary also unwraps Vue
    // reactive proxies, which structuredClone rejects with DataCloneError.
    this.document = deepFreeze(clonePortableDocument(document));
    this.revision = revision;
    this.#locales = normalizeLocales(options.locales ?? []);

    const preferredPredicates = unique([
      RDFS_LABEL,
      SKOS_PREF_LABEL,
      ...(options.preferredLabelPredicates ?? []),
    ]);
    const alternativePredicates = unique([
      SKOS_ALT_LABEL,
      ...(options.alternativeLabelPredicates ?? []),
    ]);
    const commentPredicates = unique([
      RDFS_COMMENT,
      ...(options.commentPredicates ?? []),
    ]);
    const preferredSet = new Set(preferredPredicates);
    const alternativeSet = new Set(alternativePredicates);
    const commentSet = new Set(commentPredicates);

    const graph = parseSemanticGraph(document);
    this.#quads = graph.quads;
    const resourceIris = new Set<string>();
    const predicateIris = new Set<string>();
    const predicateUsage = new Map<string, number>();
    const mutableRecords = new Map<string, ResourceRecord>();
    const superClasses = new Map<string, Set<string>>();
    const superProperties = new Map<string, Set<string>>();

    const recordFor = (iri: string): ResourceRecord => {
      let record = mutableRecords.get(iri);
      if (!record) {
        record = { iri, labels: [], comments: [], types: [] };
        mutableRecords.set(iri, record);
      }
      return record;
    };

    for (const quad of graph.quads) {
      predicateIris.add(quad.predicate.value);
      predicateUsage.set(quad.predicate.value, (predicateUsage.get(quad.predicate.value) ?? 0) + 1);
      if (quad.subject.termType === "NamedNode") {
        resourceIris.add(quad.subject.value);
        recordFor(quad.subject.value);
      }
      if (quad.object.termType === "NamedNode") {
        resourceIris.add(quad.object.value);
        recordFor(quad.object.value);
      }
      if (quad.subject.termType !== "NamedNode") continue;

      const subjectIri = quad.subject.value;
      if (quad.object.termType === "Literal") {
        if (preferredSet.has(quad.predicate.value)) {
          recordFor(subjectIri).labels.push(localizedText(quad.object, quad.predicate.value, "preferred"));
        } else if (alternativeSet.has(quad.predicate.value)) {
          recordFor(subjectIri).labels.push(localizedText(quad.object, quad.predicate.value, "alternative"));
        } else if (commentSet.has(quad.predicate.value)) {
          recordFor(subjectIri).comments.push(localizedText(quad.object, quad.predicate.value, "comment"));
        }
        continue;
      }
      if (quad.object.termType !== "NamedNode") continue;
      if (quad.predicate.value === RDF_TYPE) {
        recordFor(subjectIri).types.push(quad.object.value);
        if (quad.object.value === RDF_PROPERTY) predicateIris.add(subjectIri);
      } else if (quad.predicate.value === RDFS_SUBCLASS_OF) {
        addAdjacency(superClasses, subjectIri, quad.object.value);
      } else if (quad.predicate.value === RDFS_SUBPROPERTY_OF) {
        addAdjacency(superProperties, subjectIri, quad.object.value);
        predicateIris.add(subjectIri);
        predicateIris.add(quad.object.value);
      }
    }

    for (const predicateIri of predicateIris) {
      // RDF predicates are resources too. Keeping them in both alias spaces
      // allows describe() and object-valued authoring without conflating pN
      // with the resource identity rN.
      resourceIris.add(predicateIri);
      recordFor(predicateIri);
    }
    for (const record of mutableRecords.values()) {
      record.labels.sort(compareLocalizedText);
      record.comments.sort(compareLocalizedText);
      record.types = unique(record.types);
    }

    this.#resourceIris = [...resourceIris].sort(compareCodePoints);
    this.#predicateIris = [...predicateIris].sort(compareCodePoints);
    this.#resourceAliases = aliasMap(this.#resourceIris, "r");
    this.#resourceIrisByAlias = invertMap(this.#resourceAliases);
    this.#predicateAliases = aliasMap(this.#predicateIris, "p");
    this.#predicateIrisByAlias = invertMap(this.#predicateAliases);
    this.#records = new Map(
      [...mutableRecords].sort(([left], [right]) => compareCodePoints(left, right)),
    );
    this.#superClasses = freezeAdjacency(superClasses);
    this.#superProperties = freezeAdjacency(superProperties);
    this.#membershipClassifications = membershipClassifications(
      this.#predicateIris,
      this.#superProperties,
    );
    this.#predicateUsage = new Map(
      [...predicateUsage].sort(([left], [right]) => compareCodePoints(left, right)),
    );
  }

  resourceAlias(iri: string): RevisionAlias | undefined {
    const alias = this.#resourceAliases.get(iri);
    return alias ? { alias, revision: this.revision } : undefined;
  }

  predicateAlias(iri: string): RevisionAlias | undefined {
    const alias = this.#predicateAliases.get(iri);
    return alias ? { alias, revision: this.revision } : undefined;
  }

  resolveAlias(reference: RevisionAlias, kind: AliasKind): string {
    this.assertRevision(reference.revision);
    const iri = kind === "resource"
      ? this.#resourceIrisByAlias.get(reference.alias)
      : this.#predicateIrisByAlias.get(reference.alias);
    if (!iri) throw new UnknownSemanticAliasError(reference.alias, kind);
    return iri;
  }

  assertRevision(revision: string): void {
    if (revision !== this.revision) {
      throw new StaleSemanticRevisionError(this.revision, revision);
    }
  }

  searchResources(query: string, options: { limit?: number } = {}): SemanticSearchMatch[] {
    const normalizedQuery = normalizeSearch(query, this.#locales[0]);
    return this.#resourceIris
      .map((iri) => this.#searchMatch(iri, normalizedQuery))
      .filter((match): match is SemanticSearchMatch => Boolean(match))
      .sort(compareSearchMatches)
      .slice(0, normalizedLimit(options.limit, DEFAULT_LIMIT));
  }

  searchPredicates(query: string, options: { limit?: number } = {}): SemanticPredicateSearchMatch[] {
    const normalizedQuery = normalizeSearch(query, this.#locales[0]);
    return this.#predicateIris
      .map((iri): SemanticPredicateSearchMatch | undefined => {
        const match = this.#searchMatch(iri, normalizedQuery);
        const predicateAlias = this.#predicateAliases.get(iri);
        if (!match || !predicateAlias) return undefined;
        return {
          ...match,
          predicateAlias,
          predicateReference: { alias: predicateAlias, revision: this.revision },
          usageCount: this.#predicateUsage.get(iri) ?? 0,
        };
      })
      .filter((match): match is SemanticPredicateSearchMatch => Boolean(match))
      .sort(compareSearchMatches)
      .slice(0, normalizedLimit(options.limit, DEFAULT_LIMIT));
  }

  /** Alias for callers that use relation terminology. */
  searchRelations(query: string, options: { limit?: number } = {}): SemanticPredicateSearchMatch[] {
    return this.searchPredicates(query, options);
  }

  describe(resource: RevisionAlias): SemanticResourceDescription {
    const iri = this.resolveAlias(resource, "resource");
    const record = this.#records.get(iri) ?? emptyRecord(iri);
    const summary = this.#resourceSummary(iri);
    const predicateAlias = this.#predicateAliases.get(iri);
    return {
      ...summary,
      labels: [...record.labels],
      comments: [...record.comments],
      superClasses: this.#hierarchy(iri, this.#superClasses, "resource"),
      superProperties: this.#hierarchy(iri, this.#superProperties, "predicate"),
      incomingCount: this.#quads.filter((quad) => namedValue(quad.object) === iri).length,
      outgoingCount: this.#quads.filter((quad) => namedValue(quad.subject) === iri).length,
      isPredicate: Boolean(predicateAlias),
      ...(predicateAlias ? { predicateAlias } : {}),
    };
  }

  neighbors(query: NeighborQuery): SemanticRelation[] {
    const iri = this.resolveAlias(query.resource, "resource");
    const direction = query.direction ?? "both";
    const predicateIri = query.predicate
      ? this.resolveAlias(query.predicate, "predicate")
      : undefined;
    const relations: SemanticRelation[] = [];
    for (const quad of this.#quads) {
      if (quad.subject.termType !== "NamedNode" || quad.object.termType !== "NamedNode") continue;
      if (predicateIri && quad.predicate.value !== predicateIri) continue;
      const outgoing = quad.subject.value === iri;
      const incoming = quad.object.value === iri;
      if (
        (direction === "outgoing" && !outgoing)
        || (direction === "incoming" && !incoming)
        || (direction === "both" && !outgoing && !incoming)
      ) continue;
      relations.push(this.#relation(quad.subject.value, quad.predicate.value, quad.object.value));
    }
    return relations.sort(compareRelations).slice(0, normalizedLimit(query.limit, DEFAULT_LIMIT));
  }

  subgraph(query: SubgraphQuery): SemanticSubgraph {
    const rootIri = this.resolveAlias(query.root, "resource");
    const depth = normalizedDepth(query.depth);
    const direction = query.direction ?? "both";
    const predicateFilter = query.predicates
      ? new Set(query.predicates.map((predicate) => this.resolveAlias(predicate, "predicate")))
      : undefined;
    const maxRelations = normalizedLimit(query.maxRelations, DEFAULT_SUBGRAPH_LIMIT);
    const visited = new Map<string, number>([[rootIri, 0]]);
    const queue = [rootIri];
    const relationMap = new Map<string, SemanticRelation>();
    let truncated = false;

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      const currentDepth = visited.get(current)!;
      if (currentDepth >= depth) continue;
      for (const quad of this.#quads) {
        if (quad.subject.termType !== "NamedNode" || quad.object.termType !== "NamedNode") continue;
        if (predicateFilter && !predicateFilter.has(quad.predicate.value)) continue;
        const followsOutgoing = direction !== "incoming" && quad.subject.value === current;
        const followsIncoming = direction !== "outgoing" && quad.object.value === current;
        if (!followsOutgoing && !followsIncoming) continue;
        const key = `${quad.subject.value}\u0000${quad.predicate.value}\u0000${quad.object.value}`;
        if (!relationMap.has(key)) {
          if (relationMap.size >= maxRelations) {
            truncated = true;
            continue;
          }
          relationMap.set(
            key,
            this.#relation(quad.subject.value, quad.predicate.value, quad.object.value),
          );
        }
        const next = followsOutgoing ? quad.object.value : quad.subject.value;
        if (!visited.has(next)) {
          visited.set(next, currentDepth + 1);
          queue.push(next);
        }
      }
    }

    const resources = [...visited.keys()].sort(compareCodePoints).map((iri) => this.#resourceSummary(iri));
    return {
      revision: this.revision,
      roots: [this.#resourceSummary(rootIri)],
      resources,
      relations: [...relationMap.values()].sort(compareRelations),
      truncated,
    };
  }

  memberships(query: MembershipQuery = {}): SemanticMembership[] {
    const resourceIri = query.resource ? this.resolveAlias(query.resource, "resource") : undefined;
    const role = query.role ?? "either";
    const memberships: SemanticMembership[] = [];
    for (const quad of this.#quads) {
      if (quad.subject.termType !== "NamedNode" || quad.object.termType !== "NamedNode") continue;
      const classification = this.#membershipClassifications.get(quad.predicate.value);
      if (!classification) continue;
      if (query.includeOrdinals === false && classification.kind === "ordinal-membership") continue;
      if (resourceIri) {
        const matches = role === "container"
          ? quad.subject.value === resourceIri
          : role === "member"
            ? quad.object.value === resourceIri
            : quad.subject.value === resourceIri || quad.object.value === resourceIri;
        if (!matches) continue;
      }
      memberships.push({
        container: this.#resourceSummary(quad.subject.value),
        member: this.#resourceSummary(quad.object.value),
        predicate: this.#predicateSummary(quad.predicate.value),
        subpropertyDistance: classification.distance,
        kind: classification.kind,
      });
    }
    return memberships.sort(compareMemberships);
  }

  #searchMatch(iri: string, query: string): SemanticSearchMatch | undefined {
    const summary = this.#resourceSummary(iri);
    if (!query) {
      return { ...summary, score: 0, matchedField: "iri", matchedText: iri };
    }
    const record = this.#records.get(iri) ?? emptyRecord(iri);
    const candidates: SearchCandidate[] = [];
    for (const label of record.labels) {
      const match = lexicalMatch(label.value, query, label.kind === "preferred" ? 1_000 : 850, this.#locales[0]);
      if (match) candidates.push({
        score: match.score,
        matchedField: label.kind === "preferred" ? "preferred-label" : "alternative-label",
        matchedText: label.value,
      });
    }
    for (const comment of record.comments) {
      const match = lexicalMatch(comment.value, query, 650, this.#locales[0]);
      if (match) candidates.push({
        score: match.score,
        matchedField: "comment",
        matchedText: comment.value,
      });
    }
    const iriMatch = lexicalMatch(iri, query, 400, this.#locales[0]);
    if (iriMatch) candidates.push({ score: iriMatch.score, matchedField: "iri", matchedText: iri });
    candidates.sort(compareSearchCandidates);
    const best = candidates[0];
    return best ? { ...summary, ...best } : undefined;
  }

  #resourceSummary(iri: string): SemanticResourceSummary {
    const record = this.#records.get(iri) ?? emptyRecord(iri);
    const selectedPreferred = selectLocalized(
      record.labels.filter((label) => label.kind === "preferred"),
      this.#locales,
    );
    const selectedAlternative = selectLocalized(
      record.labels.filter((label) => label.kind === "alternative"),
      this.#locales,
    );
    const selected = selectedPreferred ?? selectedAlternative;
    const description = selectLocalized(record.comments, this.#locales)?.value;
    return {
      iri,
      alias: this.#resourceAliases.get(iri) ?? "",
      reference: {
        alias: this.#resourceAliases.get(iri) ?? "",
        revision: this.revision,
      },
      label: selected?.value ?? compactIri(iri),
      labelSource: selectedPreferred ? "preferred" : selectedAlternative ? "alternative" : "iri",
      ...(description ? { description } : {}),
      types: [...record.types],
    };
  }

  #predicateSummary(iri: string): SemanticPredicateSummary {
    const predicateAlias = this.#predicateAliases.get(iri);
    if (!predicateAlias) throw new UnknownSemanticAliasError(iri, "predicate");
    return {
      ...this.#resourceSummary(iri),
      predicateAlias,
      predicateReference: { alias: predicateAlias, revision: this.revision },
      usageCount: this.#predicateUsage.get(iri) ?? 0,
    };
  }

  #relation(subjectIri: string, predicateIri: string, objectIri: string): SemanticRelation {
    return {
      subject: this.#resourceSummary(subjectIri),
      predicate: this.#predicateSummary(predicateIri),
      object: this.#resourceSummary(objectIri),
    };
  }

  #hierarchy(
    iri: string,
    adjacency: ReadonlyMap<string, readonly string[]>,
    aliasKind: AliasKind,
  ): HierarchyRelation[] {
    return [...ancestorDistances(iri, adjacency).entries()]
      .filter(([ancestor]) => ancestor !== iri)
      .map(([ancestor, distance]) => {
        const alias = aliasKind === "resource"
          ? this.#resourceAliases.get(ancestor)
          : this.#predicateAliases.get(ancestor);
        return {
          iri: ancestor,
          ...(alias ? { alias, reference: { alias, revision: this.revision } } : {}),
          distance,
        };
      })
      .sort((left, right) => left.distance - right.distance || compareCodePoints(left.iri, right.iri));
  }
}

function clonePortableDocument(document: IriographDocument): IriographDocument {
  return JSON.parse(JSON.stringify(document)) as IriographDocument;
}

function localizedText(
  literal: Literal,
  predicateIri: string,
  kind: LocalizedText["kind"],
): LocalizedText {
  return {
    value: literal.value.normalize("NFC"),
    ...(literal.language ? { language: literal.language.toLowerCase() } : {}),
    predicateIri,
    kind,
  };
}

function emptyRecord(iri: string): ResourceRecord {
  return { iri, labels: [], comments: [], types: [] };
}

function namedValue(term: Term): string | undefined {
  return term.termType === "NamedNode" ? term.value : undefined;
}

function addAdjacency(map: Map<string, Set<string>>, child: string, parent: string): void {
  const parents = map.get(child) ?? new Set<string>();
  parents.add(parent);
  map.set(child, parents);
}

function freezeAdjacency(map: Map<string, Set<string>>): ReadonlyMap<string, readonly string[]> {
  return new Map(
    [...map.entries()]
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([child, parents]) => [child, [...parents].sort(compareCodePoints)]),
  );
}

function ancestorDistances(
  start: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const child = queue[index]!;
    const distance = distances.get(child)! + 1;
    for (const parent of adjacency.get(child) ?? []) {
      if (distances.has(parent)) continue;
      distances.set(parent, distance);
      queue.push(parent);
    }
  }
  return distances;
}

function membershipClassifications(
  predicateIris: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, MembershipClassification> {
  const classifications = new Map<string, MembershipClassification>();
  for (const predicate of predicateIris) {
    if (predicate === RDFS_MEMBER) {
      classifications.set(predicate, { distance: 0, kind: "generic-membership" });
      continue;
    }
    const visited = new Map<string, number>([[predicate, 0]]);
    const queue = [predicate];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      const distance = visited.get(current)!;
      if (isOrdinalPredicate(current)) {
        classifications.set(predicate, {
          distance: distance + 1,
          kind: "ordinal-membership",
        });
        break;
      }
      let found = false;
      for (const parent of adjacency.get(current) ?? []) {
        if (parent === RDFS_MEMBER) {
          classifications.set(predicate, {
            distance: distance + 1,
            kind: "generic-membership",
          });
          found = true;
          break;
        }
        if (!visited.has(parent)) {
          visited.set(parent, distance + 1);
          queue.push(parent);
        }
      }
      if (found) break;
    }
  }
  return classifications;
}

function isOrdinalPredicate(iri: string): boolean {
  const suffix = iri.slice(RDF_ORDINAL_PREFIX.length);
  return iri.startsWith(RDF_ORDINAL_PREFIX) && /^[1-9][0-9]*$/.test(suffix);
}

function aliasMap(iris: readonly string[], prefix: string): ReadonlyMap<string, string> {
  return new Map(iris.map((iri, index) => [iri, `${prefix}${index + 1}`]));
}

function invertMap(map: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  return new Map([...map].map(([iri, alias]) => [alias, iri]));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

function normalizeLocales(locales: readonly string[]): string[] {
  return [...new Set(locales.map((locale) => locale.trim().replaceAll("_", "-").toLowerCase()).filter(Boolean))];
}

function selectLocalized(values: readonly LocalizedText[], locales: readonly string[]): LocalizedText | undefined {
  return [...values].sort((left, right) => (
    compareLanguagePreference(left.language, right.language, locales)
    || compareLocalizedText(left, right)
  ))[0];
}

function compareLanguagePreference(
  left: string | undefined,
  right: string | undefined,
  locales: readonly string[],
): number {
  return languageRank(left, locales) - languageRank(right, locales);
}

function languageRank(language: string | undefined, locales: readonly string[]): number {
  if (!language) return locales.length * 2;
  const normalized = language.toLowerCase();
  for (let index = 0; index < locales.length; index += 1) {
    const locale = locales[index]!;
    if (normalized === locale) return index * 2;
    if (normalized.split("-")[0] === locale.split("-")[0]) return index * 2 + 1;
  }
  return locales.length * 2 + 1;
}

function compareLocalizedText(left: LocalizedText, right: LocalizedText): number {
  return compareCodePoints(left.language ?? "", right.language ?? "")
    || compareCodePoints(left.value, right.value)
    || compareCodePoints(left.predicateIri, right.predicateIri)
    || compareCodePoints(left.kind, right.kind);
}

function lexicalMatch(
  value: string,
  query: string,
  baseScore: number,
  locale?: string,
): { score: number } | undefined {
  const normalized = normalizeSearch(value, locale);
  if (normalized === query) return { score: baseScore };
  if (normalized.startsWith(query)) return { score: baseScore - 100 };
  if (normalized.includes(query)) return { score: baseScore - 200 };
  return undefined;
}

function normalizeSearch(value: string, _locale?: string): string {
  const normalized = value.normalize("NFKC").trim();
  // Language preference controls which lexical form is selected. Case folding
  // stays locale-independent so an untrusted/unsupported locale cannot throw.
  return normalized.toLowerCase();
}

function compareSearchCandidates(left: SearchCandidate, right: SearchCandidate): number {
  return right.score - left.score
    || compareCodePoints(left.matchedField, right.matchedField)
    || compareCodePoints(left.matchedText, right.matchedText);
}

function compareSearchMatches(left: SemanticSearchMatch, right: SemanticSearchMatch): number {
  return right.score - left.score
    || compareCodePoints(left.label, right.label)
    || compareCodePoints(left.iri, right.iri)
    || compareCodePoints(left.matchedField, right.matchedField);
}

function compareRelations(left: SemanticRelation, right: SemanticRelation): number {
  return compareCodePoints(left.subject.iri, right.subject.iri)
    || compareCodePoints(left.predicate.iri, right.predicate.iri)
    || compareCodePoints(left.object.iri, right.object.iri);
}

function compareMemberships(left: SemanticMembership, right: SemanticMembership): number {
  return compareCodePoints(left.container.iri, right.container.iri)
    || compareCodePoints(left.member.iri, right.member.iri)
    || compareCodePoints(left.predicate.iri, right.predicate.iri);
}

function compactIri(iri: string): string {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const colon = iri.lastIndexOf(":");
  const index = Math.max(hash, slash, colon);
  return index >= 0 && index < iri.length - 1 ? iri.slice(index + 1) : iri;
}

function normalizedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Limit must be a positive integer.");
  return value;
}

function normalizedDepth(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 0 || value > 10) {
    throw new RangeError("Subgraph depth must be an integer between 0 and 10.");
  }
  return value;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
