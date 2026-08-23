import {
  compareCodePoints,
  type DiagramScene,
  type ElementGeometry,
  type SceneContainer,
  type SceneNode,
} from "@iriograph/core";

import { diagramContainerContentBounds } from "./selection";

export type ContainmentConsistencyElementKind = "node" | "container";

export type ContainmentConsistencyAction =
  | {
    kind: "add-semantic-containment";
    elementId: string;
    containerElementId: string;
  }
  | {
    kind: "move-outside-visual-container";
    elementId: string;
    containerElementId: string;
  }
  | {
    kind: "move-inside-semantic-container";
    elementId: string;
    containerElementId: string;
  }
  | {
    kind: "remove-semantic-containment";
    elementId: string;
    containerElementId: string;
  }
  | {
    kind: "replace-semantic-containment";
    elementId: string;
    fromContainerElementId: string;
    toContainerElementId: string;
  };

export type VisualOnlyContainmentWarning = {
  diagnosticId: string;
  kind: "visual-only";
  elementId: string;
  elementKind: ContainmentConsistencyElementKind;
  visualContainerId: string;
  semanticContainerId?: undefined;
  actions: readonly [
    Extract<ContainmentConsistencyAction, { kind: "add-semantic-containment" }>,
    Extract<ContainmentConsistencyAction, { kind: "move-outside-visual-container" }>,
  ];
};

export type SemanticOnlyContainmentWarning = {
  diagnosticId: string;
  kind: "semantic-only";
  elementId: string;
  elementKind: ContainmentConsistencyElementKind;
  visualContainerId?: string;
  semanticContainerId: string;
  centerInsideSemanticContainer: boolean;
  geometryInsideSemanticContainer: boolean;
  actions: readonly ContainmentConsistencyAction[];
};

export type ContainmentConsistencyWarning =
  | VisualOnlyContainmentWarning
  | SemanticOnlyContainmentWarning;

export type ContainmentPresentationMove = Extract<
  ContainmentConsistencyAction,
  { kind: "move-outside-visual-container" | "move-inside-semantic-container" }
>;

type GeometryElement = SceneNode | SceneContainer;

/**
 * Reports disagreement between derived semantic containment and the current
 * presentation geometry. This function is read-only: it never infers a
 * membership statement or mutates the Scene.
 */
export function findContainmentConsistencyWarnings(
  scene: DiagramScene,
): ContainmentConsistencyWarning[] {
  const elements = geometryElements(scene);
  const elementIndex = new Map(elements.map((element) => [element.elementId, element]));
  const containers = scene.containers
    .filter(hasUsableGeometry)
    .map((container) => ({
      container,
      content: diagramContainerContentBounds(container),
      area: container.geometry.width * container.geometry.height,
    }));
  const warnings: ContainmentConsistencyWarning[] = [];

  for (const element of elements) {
    if (!hasUsableGeometry(element)) continue;
    const visualContainer = smallestVisualContainer(
      element,
      containers,
      elementIndex,
    );

    if (!element.parentElementId) {
      if (!visualContainer) continue;
      warnings.push(visualOnlyWarning(element, visualContainer.elementId));
      continue;
    }

    const semanticContainer = elementIndex.get(element.parentElementId);
    if (
      semanticContainer?.structuralKind !== "container"
      || !hasUsableGeometry(semanticContainer)
    ) {
      continue;
    }
    const semanticContent = diagramContainerContentBounds(semanticContainer);
    const centerInsideSemanticContainer = pointInside(
      geometryCenter(element.geometry),
      semanticContent,
    );
    const geometryInsideSemanticContainer = geometryInside(
      element.geometry,
      semanticContent,
    );
    if (centerInsideSemanticContainer && geometryInsideSemanticContainer) continue;

    warnings.push(semanticOnlyWarning(
      element,
      semanticContainer.elementId,
      visualContainer?.elementId,
      centerInsideSemanticContainer,
      geometryInsideSemanticContainer,
    ));
  }

  return warnings.sort((left, right) => compareCodePoints(left.diagnosticId, right.diagnosticId));
}

/**
 * Returns the smallest deterministic presentation-only translation requested
 * by a containment warning. The caller owns the overlay transaction; this
 * helper never mutates the Scene and never creates or removes RDF statements.
 */
export function containmentPresentationTranslation(
  scene: DiagramScene,
  action: ContainmentPresentationMove,
): { x: number; y: number } | undefined {
  const element = geometryElements(scene).find((candidate) => (
    candidate.elementId === action.elementId
  ));
  const container = scene.containers.find((candidate) => (
    candidate.elementId === action.containerElementId
  ));
  if (!element || !container || !hasUsableGeometry(element) || !hasUsableGeometry(container)) {
    return undefined;
  }
  const content = diagramContainerContentBounds(container);
  if (action.kind === "move-inside-semantic-container") {
    if (element.geometry.width > content.width || element.geometry.height > content.height) {
      return undefined;
    }
    const target = {
      x: clamp(element.geometry.x, content.x, content.x + content.width - element.geometry.width),
      y: clamp(element.geometry.y, content.y, content.y + content.height - element.geometry.height),
    };
    return nonzeroTranslation(element.geometry, target);
  }

  const sceneInset = 8;
  const minimumX = sceneInset;
  const maximumX = Math.max(minimumX, scene.width - sceneInset - element.geometry.width);
  const minimumY = sceneInset;
  const maximumY = Math.max(minimumY, scene.height - sceneInset - element.geometry.height);
  const candidates = [
    { side: "left", x: content.x - element.geometry.width / 2 - 1, y: element.geometry.y },
    { side: "right", x: content.x + content.width - element.geometry.width / 2 + 1, y: element.geometry.y },
    { side: "top", x: element.geometry.x, y: content.y - element.geometry.height / 2 - 1 },
    { side: "bottom", x: element.geometry.x, y: content.y + content.height - element.geometry.height / 2 + 1 },
  ].map((candidate) => ({
    ...candidate,
    x: clamp(candidate.x, minimumX, maximumX),
    y: clamp(candidate.y, minimumY, maximumY),
  })).filter((candidate) => !pointInside({
    x: candidate.x + element.geometry.width / 2,
    y: candidate.y + element.geometry.height / 2,
  }, content)).sort((left, right) => (
    squaredDistance(left, element.geometry) - squaredDistance(right, element.geometry)
    || compareCodePoints(left.side, right.side)
  ));
  const target = candidates[0];
  return target ? nonzeroTranslation(element.geometry, target) : undefined;
}

function geometryElements(scene: DiagramScene): GeometryElement[] {
  return [...scene.nodes, ...scene.containers].sort((left, right) => (
    compareCodePoints(left.elementId, right.elementId)
    || compareCodePoints(left.structuralKind, right.structuralKind)
  ));
}

function smallestVisualContainer(
  element: GeometryElement & { geometry: ElementGeometry },
  candidates: readonly {
    container: SceneContainer & { geometry: ElementGeometry };
    content: ElementGeometry;
    area: number;
  }[],
  elementIndex: ReadonlyMap<string, GeometryElement>,
): SceneContainer | undefined {
  const center = geometryCenter(element.geometry);
  return candidates
    .filter(({ container, content }) => (
      container.elementId !== element.elementId
      && !isSemanticDescendant(container.elementId, element.elementId, elementIndex)
      && pointInside(center, content)
    ))
    .sort((left, right) => (
      left.area - right.area
      || compareCodePoints(left.container.elementId, right.container.elementId)
    ))[0]?.container;
}

function isSemanticDescendant(
  candidateContainerId: string,
  elementId: string,
  elementIndex: ReadonlyMap<string, GeometryElement>,
): boolean {
  const visited = new Set<string>();
  let parentId = elementIndex.get(candidateContainerId)?.parentElementId;
  while (parentId && !visited.has(parentId)) {
    if (parentId === elementId) return true;
    visited.add(parentId);
    parentId = elementIndex.get(parentId)?.parentElementId;
  }
  return false;
}

function visualOnlyWarning(
  element: GeometryElement,
  visualContainerId: string,
): VisualOnlyContainmentWarning {
  return {
    diagnosticId: containmentDiagnosticId("visual-only", [
      element.elementId,
      visualContainerId,
    ]),
    kind: "visual-only",
    elementId: element.elementId,
    elementKind: element.structuralKind,
    visualContainerId,
    actions: [
      {
        kind: "add-semantic-containment",
        elementId: element.elementId,
        containerElementId: visualContainerId,
      },
      {
        kind: "move-outside-visual-container",
        elementId: element.elementId,
        containerElementId: visualContainerId,
      },
    ],
  };
}

function semanticOnlyWarning(
  element: GeometryElement,
  semanticContainerId: string,
  visualContainerId: string | undefined,
  centerInsideSemanticContainer: boolean,
  geometryInsideSemanticContainer: boolean,
): SemanticOnlyContainmentWarning {
  const actions: ContainmentConsistencyAction[] = [
    {
      kind: "move-inside-semantic-container",
      elementId: element.elementId,
      containerElementId: semanticContainerId,
    },
    {
      kind: "remove-semantic-containment",
      elementId: element.elementId,
      containerElementId: semanticContainerId,
    },
  ];
  if (visualContainerId && visualContainerId !== semanticContainerId) {
    actions.push({
      kind: "replace-semantic-containment",
      elementId: element.elementId,
      fromContainerElementId: semanticContainerId,
      toContainerElementId: visualContainerId,
    });
  }
  return {
    diagnosticId: containmentDiagnosticId("semantic-only", [
      element.elementId,
      semanticContainerId,
    ]),
    kind: "semantic-only",
    elementId: element.elementId,
    elementKind: element.structuralKind,
    visualContainerId,
    semanticContainerId,
    centerInsideSemanticContainer,
    geometryInsideSemanticContainer,
    actions,
  };
}

function containmentDiagnosticId(
  kind: ContainmentConsistencyWarning["kind"],
  identityParts: readonly string[],
): string {
  return `urn:iriograph:diagnostic:containment:v1:${kind}:${JSON.stringify(identityParts)}`;
}

function hasUsableGeometry<T extends GeometryElement>(
  element: T,
): element is T & { geometry: ElementGeometry } {
  const geometry = (element as T & { geometry?: ElementGeometry }).geometry;
  return geometry !== undefined
    && Number.isFinite(geometry.x)
    && Number.isFinite(geometry.y)
    && Number.isFinite(geometry.width)
    && Number.isFinite(geometry.height)
    && geometry.width >= 0
    && geometry.height >= 0;
}

function geometryCenter(geometry: ElementGeometry): { x: number; y: number } {
  return {
    x: geometry.x + geometry.width / 2,
    y: geometry.y + geometry.height / 2,
  };
}

function nonzeroTranslation(
  geometry: ElementGeometry,
  target: { x: number; y: number },
): { x: number; y: number } | undefined {
  const translation = { x: target.x - geometry.x, y: target.y - geometry.y };
  return translation.x === 0 && translation.y === 0 ? undefined : translation;
}

function squaredDistance(
  target: { x: number; y: number },
  geometry: ElementGeometry,
): number {
  return (target.x - geometry.x) ** 2 + (target.y - geometry.y) ** 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pointInside(
  point: { x: number; y: number },
  bounds: ElementGeometry,
): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function geometryInside(geometry: ElementGeometry, bounds: ElementGeometry): boolean {
  return geometry.x >= bounds.x
    && geometry.x + geometry.width <= bounds.x + bounds.width
    && geometry.y >= bounds.y
    && geometry.y + geometry.height <= bounds.y + bounds.height;
}
