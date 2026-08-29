import { PresentationContractError, capabilityFieldSet } from "./contracts.js";
import {
  bindingDiagnostics,
  clone,
  compareCodePoints,
  deepFreeze,
  truncate,
} from "./internal.js";
import type {
  PresentationCapabilitySet,
  PresentationContextSummary,
  PresentationElementKind,
  PresentationOption,
  PresentationOptionSummary,
  PresentationSceneBinding,
  PresentationSceneElement,
  PresentationSceneSnapshot,
  PresentationToolPolicy,
  PresentationToolResult,
} from "./model.js";
import { definePresentationCapabilities, definePresentationSceneSnapshot, definePresentationToolPolicy } from "./contracts.js";

/** Immutable, revision-bound read index over one renderer-neutral Scene. */
export class PresentationSceneIndex {
  readonly binding: Readonly<PresentationSceneBinding>;
  readonly #snapshot: Readonly<PresentationSceneSnapshot>;
  readonly #elements: ReadonlyMap<string, Readonly<PresentationSceneElement>>;

  constructor(snapshot: unknown) {
    this.#snapshot = definePresentationSceneSnapshot(snapshot);
    this.binding = this.#snapshot.binding;
    this.#elements = new Map(this.#snapshot.elements.map((element) => [element.elementId, element]));
  }

  get size(): number {
    return this.#elements.size;
  }

  has(elementId: string): boolean {
    return this.#elements.has(elementId);
  }

  get(elementId: string): Readonly<PresentationSceneElement> | undefined {
    const element = this.#elements.get(elementId);
    return element ? deepFreeze(clone(element)) : undefined;
  }

  snapshot(): PresentationSceneSnapshot {
    return clone(this.#snapshot);
  }

  assertBinding(binding: PresentationSceneBinding): void {
    const diagnostics = bindingDiagnostics(binding, this.binding);
    if (diagnostics.length > 0) throw new PresentationContractError("Stale presentation Scene binding.", diagnostics);
  }

  summarize(
    binding: PresentationSceneBinding,
    targetElementIds: readonly string[],
    capabilityInput: unknown,
    policyInput: unknown,
  ): PresentationToolResult<PresentationContextSummary> {
    const bindingProblems = bindingDiagnostics(binding, this.binding);
    if (bindingProblems.length > 0) return { accepted: false, diagnostics: bindingProblems };
    let capabilities: Readonly<PresentationCapabilitySet>;
    let policy: Readonly<PresentationToolPolicy>;
    try {
      capabilities = definePresentationCapabilities(capabilityInput);
      policy = definePresentationToolPolicy(policyInput);
    } catch (cause) {
      if (cause instanceof PresentationContractError) return { accepted: false, diagnostics: [...cause.diagnostics] };
      throw cause;
    }
    if (capabilities.contextRevision !== this.binding.contextRevision) {
      return {
        accepted: false,
        diagnostics: [{
          code: "stale-context-revision",
          message: "Capabilities do not match the indexed context revision.",
          path: "/capabilities/contextRevision",
        }],
      };
    }
    const seen = new Set<string>();
    for (const [index, elementId] of targetElementIds.entries()) {
      if (!this.#elements.has(elementId)) {
        return { accepted: false, diagnostics: [{ code: "target-unresolved", message: `Scene element is unresolved: ${elementId}`, path: `/targetElementIds/${index}` }] };
      }
      if (seen.has(elementId)) {
        return { accepted: false, diagnostics: [{ code: "duplicate-target", message: `Scene element is repeated: ${elementId}`, path: `/targetElementIds/${index}` }] };
      }
      seen.add(elementId);
    }
    const requested = targetElementIds.length > 0
      ? targetElementIds.map((elementId) => this.#elements.get(elementId)!)
      : [...this.#elements.values()].sort((left, right) => compareCodePoints(left.elementId, right.elementId));
    const selected = requested.slice(0, policy.maxTargetsPerSummary);
    const kinds = new Set(selected.map((element) => element.kind));
    const allOptions = [
      ...applicableOptions(capabilities.templates, kinds).sort((left, right) => compareCodePoints(left.optionId, right.optionId)),
      ...applicableOptions(capabilities.icons, kinds).sort((left, right) => compareCodePoints(left.optionId, right.optionId)),
      ...applicableOptions(capabilities.styles, kinds).sort((left, right) => compareCodePoints(left.optionId, right.optionId)),
    ];
    const optionIds = new Set(allOptions
      .slice(0, policy.maxOptionsPerSummary)
      .map((option) => option.optionId));
    const summary: PresentationContextSummary = {
      binding: clone(this.binding),
      scene: {
        width: this.#snapshot.width,
        height: this.#snapshot.height,
        counts: countKinds(this.#snapshot.elements),
      },
      targets: selected.map((element) => ({
        elementId: element.elementId,
        kind: element.kind,
        label: truncate(element.label, policy.maxLabelCharacters),
        ...(element.presentation.geometry ? { geometry: clone(element.presentation.geometry) } : {}),
        ...(element.parentElementId ? { parentElementId: element.parentElementId } : {}),
        ...(element.sourceElementId ? { sourceElementId: element.sourceElementId } : {}),
        ...(element.targetElementId ? { targetElementId: element.targetElementId } : {}),
        availableFields: [...capabilityFieldSet(capabilities, element.kind)],
      })),
      omittedTargetCount: requested.length - selected.length,
      capabilities: {
        templates: summarizeOptions(capabilities.templates, kinds, optionIds, policy),
        icons: summarizeOptions(capabilities.icons, kinds, optionIds, policy),
        styles: summarizeOptions(capabilities.styles, kinds, optionIds, policy),
        routeModes: kinds.has("edge") ? [...(capabilities.routeModes ?? [])] : [],
        markers: kinds.has("edge") ? [...(capabilities.markers ?? [])] : [],
        omittedOptionCount: allOptions.length - optionIds.size,
      },
    };
    return { accepted: true, value: deepFreeze(summary) };
  }
}

function applicableOptions(
  options: readonly PresentationOption[] | undefined,
  kinds: ReadonlySet<PresentationElementKind>,
): PresentationOption[] {
  return (options ?? []).filter((option) => option.elementKinds.some((kind) => kinds.has(kind)));
}

function summarizeOptions(
  options: readonly PresentationOption[] | undefined,
  kinds: ReadonlySet<PresentationElementKind>,
  included: ReadonlySet<string>,
  policy: PresentationToolPolicy,
): PresentationOptionSummary[] {
  return applicableOptions(options, kinds)
    .filter((option) => included.has(option.optionId))
    .sort((left, right) => compareCodePoints(left.optionId, right.optionId))
    .map((option) => ({
      optionId: option.optionId,
      label: truncate(option.label, policy.maxLabelCharacters),
      ...(option.summary ? { summary: truncate(option.summary, policy.maxLabelCharacters) } : {}),
    }));
}

function countKinds(elements: readonly PresentationSceneElement[]): Record<PresentationElementKind, number> {
  const counts: Record<PresentationElementKind, number> = {
    node: 0,
    container: 0,
    region: 0,
    edge: 0,
    annotation: 0,
  };
  for (const element of elements) counts[element.kind] += 1;
  return counts;
}
