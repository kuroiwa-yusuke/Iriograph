import type { ElementGeometry, Point } from "./model";

export const STANDARD_LAYOUT_REFS = {
  hierarchicalLr: "urn:iriograph:layout:hierarchical-lr:1",
  hierarchicalTb: "urn:iriograph:layout:hierarchical-tb:1",
} as const;

export type LayoutDirection = "LR" | "TB";
export type LayoutMode = "incremental" | "full";

export type LayoutElement = {
  elementId: string;
  structuralKind: "node" | "container";
  parentElementId?: string;
  geometry?: ElementGeometry;
  size?: { width: number; height: number };
  pinned?: boolean;
  placement?: "generated" | "user";
};

export type LayoutEdge = {
  elementId: string;
  sourceElementId: string;
  targetElementId: string;
  waypoints?: readonly Point[];
  routingPlacement?: "generated" | "user";
};

/**
 * Minimal structural boundary accepted by layout adapters. Projection can add
 * arbitrary provenance/appearance fields without coupling them to layout.
 */
export type LayoutProjectedScene<
  TElement extends LayoutElement = LayoutElement,
  TEdge extends LayoutEdge = LayoutEdge,
> = {
  elements: readonly TElement[];
  edges: readonly TEdge[];
};

export type LayoutSpacing = {
  margin: number;
  rankGap: number;
  itemGap: number;
  containerPadding: number;
  containerHeader: number;
};

export type LayoutRequest = {
  layoutRef: string;
  scene: LayoutProjectedScene;
  mode?: LayoutMode;
  spacing?: Partial<LayoutSpacing>;
};

export type LayoutDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  layoutRef?: string;
  elementId?: string;
  edgeId?: string;
};

export type LayoutResult = {
  layoutRef: string;
  geometries: Record<string, ElementGeometry>;
  routes: Record<string, Point[]>;
  width: number;
  height: number;
  diagnostics: LayoutDiagnostic[];
};

export interface LayoutAdapter {
  readonly layoutRef: string;
  layout(request: LayoutRequest): Promise<LayoutResult>;
}

export type LayoutAdapterResolution =
  | { resolved: true; adapter: LayoutAdapter; diagnostics: [] }
  | { resolved: false; diagnostics: [LayoutDiagnostic] };

const DEFAULT_SPACING: LayoutSpacing = {
  margin: 48,
  rankGap: 104,
  itemGap: 48,
  containerPadding: 28,
  containerHeader: 36,
};

const ROOT_GROUP = "\u0000root";

export class LayoutAdapterRegistry {
  readonly #adapters = new Map<string, LayoutAdapter>();

  constructor(adapters: Iterable<LayoutAdapter> = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: LayoutAdapter): void {
    if (this.#adapters.has(adapter.layoutRef)) {
      throw new Error(`layoutRef is already registered: ${adapter.layoutRef}`);
    }
    this.#adapters.set(adapter.layoutRef, adapter);
  }

  resolve(layoutRef: string): LayoutAdapterResolution {
    const adapter = this.#adapters.get(layoutRef);
    if (adapter) return { resolved: true, adapter, diagnostics: [] };
    return {
      resolved: false,
      diagnostics: [{
        severity: "error",
        code: "layout-adapter-unresolved",
        message: `layout adapter is not registered: ${layoutRef}`,
        layoutRef,
      }],
    };
  }
}

export function createStandardLayoutRegistry(): LayoutAdapterRegistry {
  return new LayoutAdapterRegistry([
    new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalLr, "LR"),
    new StandardLightweightLayoutAdapter(STANDARD_LAYOUT_REFS.hierarchicalTb, "TB"),
  ]);
}

/** Resolves exactly the requested adapter. Unknown references never use a default. */
export async function layoutProjectedScene(
  request: LayoutRequest,
  registry: LayoutAdapterRegistry,
): Promise<LayoutResult> {
  const resolution = registry.resolve(request.layoutRef);
  if (!resolution.resolved) return emptyResult(request.layoutRef, resolution.diagnostics);
  try {
    const result = await resolution.adapter.layout(request);
    const invalid = validateAdapterResult(request, result);
    return invalid.length > 0
      ? emptyResult(request.layoutRef, [...result.diagnostics, ...invalid])
      : result;
  } catch (cause) {
    return emptyResult(request.layoutRef, [{
      severity: "error",
      code: "layout-adapter-failed",
      message: cause instanceof Error ? cause.message : String(cause),
      layoutRef: request.layoutRef,
    }]);
  }
}

function validateAdapterResult(request: LayoutRequest, result: LayoutResult): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  if (result.layoutRef !== request.layoutRef) {
    diagnostics.push(invalidResult(request, `result layoutRef does not match: ${result.layoutRef}`));
  }
  if (!isFiniteNonnegative(result.width) || !isFiniteNonnegative(result.height)) {
    diagnostics.push(invalidResult(request, "result bounds must be finite nonnegative numbers"));
  }
  const expectedIds = new Set(request.scene.elements.map((element) => element.elementId));
  for (const element of request.scene.elements) {
    const geometry = result.geometries[element.elementId];
    if (!geometry || !isValidGeometry(geometry)) {
      diagnostics.push(invalidResult(request, `geometry is missing or invalid: ${element.elementId}`, element.elementId));
      continue;
    }
    if (isFixed(element) && element.geometry && !sameGeometry(geometry, element.geometry)) {
      diagnostics.push(invalidResult(request, `fixed geometry changed: ${element.elementId}`, element.elementId));
    }
  }
  for (const elementId of Object.keys(result.geometries)) {
    if (!expectedIds.has(elementId)) {
      diagnostics.push(invalidResult(request, `geometry refers to an unknown element: ${elementId}`, elementId));
    }
  }
  for (const [edgeId, points] of Object.entries(result.routes)) {
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      diagnostics.push({
        ...invalidResult(request, `route contains a non-finite point: ${edgeId}`),
        edgeId,
      });
    }
  }
  return diagnostics;
}

function invalidResult(
  request: LayoutRequest,
  message: string,
  elementId?: string,
): LayoutDiagnostic {
  return {
    severity: "error",
    code: "layout-result-invalid",
    message,
    layoutRef: request.layoutRef,
    elementId,
  };
}

function isValidGeometry(value: ElementGeometry): boolean {
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function sameGeometry(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

export class StandardLightweightLayoutAdapter implements LayoutAdapter {
  constructor(
    readonly layoutRef: string,
    readonly direction: LayoutDirection,
  ) {}

  async layout(request: LayoutRequest): Promise<LayoutResult> {
    if (request.layoutRef !== this.layoutRef) {
      return emptyResult(request.layoutRef, [{
        severity: "error",
        code: "layout-adapter-ref-mismatch",
        message: `adapter ${this.layoutRef} cannot handle ${request.layoutRef}`,
        layoutRef: request.layoutRef,
      }]);
    }
    return runStandardLayout(request, this.direction);
  }
}

type LayoutState = {
  request: LayoutRequest;
  direction: LayoutDirection;
  spacing: LayoutSpacing;
  elements: Map<string, LayoutElement>;
  edges: LayoutEdge[];
  parents: Map<string, string>;
  children: Map<string, string[]>;
  measured: Map<string, { width: number; height: number }>;
  geometries: Record<string, ElementGeometry>;
  diagnostics: LayoutDiagnostic[];
};

function runStandardLayout(request: LayoutRequest, direction: LayoutDirection): LayoutResult {
  const diagnostics: LayoutDiagnostic[] = [];
  const elements = indexElements(request.scene.elements, request.layoutRef, diagnostics);
  if (diagnostics.some((item) => item.severity === "error")) {
    return emptyResult(request.layoutRef, diagnostics);
  }
  const edges = [...request.scene.edges].sort(compareEdge);
  const parents = resolveParents(elements, request.layoutRef, diagnostics);
  const state: LayoutState = {
    request,
    direction,
    spacing: { ...DEFAULT_SPACING, ...request.spacing },
    elements,
    edges,
    parents,
    children: childrenByParent(elements, parents),
    measured: new Map(),
    geometries: {},
    diagnostics,
  };

  for (const id of state.children.get(ROOT_GROUP) ?? []) measureElement(id, state);
  placeGroup(ROOT_GROUP, { x: state.spacing.margin, y: state.spacing.margin }, state);
  const routes = routeEdges(state);
  const bounds = sceneBounds(Object.values(state.geometries), state.spacing.margin);

  return {
    layoutRef: request.layoutRef,
    geometries: state.geometries,
    routes,
    width: bounds.width,
    height: bounds.height,
    diagnostics,
  };
}

function indexElements(
  input: readonly LayoutElement[],
  layoutRef: string,
  diagnostics: LayoutDiagnostic[],
): Map<string, LayoutElement> {
  const result = new Map<string, LayoutElement>();
  for (const element of [...input].sort((left, right) => compareText(left.elementId, right.elementId))) {
    if (result.has(element.elementId)) {
      diagnostics.push({
        severity: "error",
        code: "layout-duplicate-element-id",
        message: `duplicate elementId: ${element.elementId}`,
        layoutRef,
        elementId: element.elementId,
      });
    } else {
      result.set(element.elementId, element);
    }
  }
  return result;
}

function resolveParents(
  elements: Map<string, LayoutElement>,
  layoutRef: string,
  diagnostics: LayoutDiagnostic[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const element of elements.values()) {
    if (!element.parentElementId) continue;
    const parent = elements.get(element.parentElementId);
    if (!parent || parent.structuralKind !== "container") {
      diagnostics.push({
        severity: "warning",
        code: "layout-parent-invalid",
        message: `parent is missing or is not a container: ${element.parentElementId}`,
        layoutRef,
        elementId: element.elementId,
      });
      continue;
    }
    result.set(element.elementId, parent.elementId);
  }

  // Break each containment cycle at its smallest identity. This preserves a
  // deterministic forest even for an invalid projected input.
  for (;;) {
    const cycle = findParentCycle([...elements.keys()].sort(compareText), result);
    if (!cycle) break;
    const cut = [...cycle].sort(compareText)[0]!;
    result.delete(cut);
    diagnostics.push({
      severity: "warning",
      code: "layout-containment-cycle",
      message: `containment cycle was cut at ${cut}`,
      layoutRef,
      elementId: cut,
    });
  }
  return result;
}

function findParentCycle(ids: string[], parents: Map<string, string>): string[] | undefined {
  for (const start of ids) {
    const path: string[] = [];
    const index = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined) {
      const at = index.get(current);
      if (at !== undefined) return path.slice(at);
      index.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
  }
  return undefined;
}

function childrenByParent(
  elements: Map<string, LayoutElement>,
  parents: Map<string, string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const id of elements.keys()) {
    const parent = parents.get(id) ?? ROOT_GROUP;
    const children = result.get(parent) ?? [];
    children.push(id);
    result.set(parent, children);
  }
  for (const children of result.values()) children.sort(compareText);
  return result;
}

function measureElement(elementId: string, state: LayoutState): { width: number; height: number } {
  const cached = state.measured.get(elementId);
  if (cached) return cached;
  const element = state.elements.get(elementId)!;
  const explicit = element.size ?? element.geometry;
  let size = explicit
    ? { width: explicit.width, height: explicit.height }
    : element.structuralKind === "container"
      ? { width: 360, height: 180 }
      : { width: 160, height: 72 };

  if (element.structuralKind === "container") {
    const childIds = state.children.get(elementId) ?? [];
    if (childIds.length > 0) {
      for (const childId of childIds) measureElement(childId, state);
      const natural = naturalGroupLayout(elementId, state).bounds;
      size = {
        width: Math.max(size.width, natural.width + state.spacing.containerPadding * 2),
        height: Math.max(
          size.height,
          natural.height + state.spacing.containerHeader + state.spacing.containerPadding * 2,
        ),
      };
    }
  }
  state.measured.set(elementId, size);
  return size;
}

function placeGroup(groupId: string, origin: Point, state: LayoutState): void {
  const layout = naturalGroupLayout(groupId, state);
  const occupied: ElementGeometry[] = [];
  const children = state.children.get(groupId) ?? [];

  for (const childId of children) {
    const element = state.elements.get(childId)!;
    if (isFixed(element) && element.geometry) occupied.push(copyGeometry(element.geometry));
  }
  for (const childId of children) {
    const element = state.elements.get(childId)!;
    const natural = layout.placements.get(childId)!;
    let geometry: ElementGeometry;
    if (isFixed(element) && element.geometry) {
      geometry = copyGeometry(element.geometry);
    } else {
      if (isFixed(element)) {
        state.diagnostics.push({
          severity: "error",
          code: "layout-fixed-geometry-missing",
          message: `fixed element has no geometry: ${childId}`,
          layoutRef: state.request.layoutRef,
          elementId: childId,
        });
      }
      geometry = {
        x: origin.x + natural.x,
        y: origin.y + natural.y,
        width: natural.width,
        height: natural.height,
      };
      geometry = avoidOccupiedGeometry(geometry, occupied, state.direction, state.spacing.itemGap);
      occupied.push(copyGeometry(geometry));
    }
    state.geometries[childId] = geometry;

    if (element.structuralKind === "container") {
      placeGroup(childId, {
        x: geometry.x + state.spacing.containerPadding,
        y: geometry.y + state.spacing.containerHeader + state.spacing.containerPadding,
      }, state);
      if (!isFixed(element)) expandGeneratedContainer(childId, state);
    }
  }
}

function naturalGroupLayout(
  groupId: string,
  state: LayoutState,
): { placements: Map<string, ElementGeometry>; bounds: { width: number; height: number } } {
  const ids = state.children.get(groupId) ?? [];
  const ranks = hierarchicalRanks(ids, groupId, state);
  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const rank = ranks.get(id) ?? 0;
    const members = byRank.get(rank) ?? [];
    members.push(id);
    byRank.set(rank, members);
  }
  for (const members of byRank.values()) members.sort(compareText);

  const placements = new Map<string, ElementGeometry>();
  let primary = 0;
  let maxCross = 0;
  for (const rank of [...byRank.keys()].sort((left, right) => left - right)) {
    const members = byRank.get(rank)!;
    const rankPrimary = Math.max(...members.map((id) => primarySize(state.measured.get(id)!, state.direction)));
    let cross = 0;
    for (const id of members) {
      const size = state.measured.get(id)!;
      const geometry = state.direction === "LR"
        ? { x: primary, y: cross, width: size.width, height: size.height }
        : { x: cross, y: primary, width: size.width, height: size.height };
      placements.set(id, geometry);
      cross += crossSize(size, state.direction) + state.spacing.itemGap;
    }
    maxCross = Math.max(maxCross, Math.max(0, cross - state.spacing.itemGap));
    primary += rankPrimary + state.spacing.rankGap;
  }
  const primaryExtent = Math.max(0, primary - state.spacing.rankGap);
  return {
    placements,
    bounds: state.direction === "LR"
      ? { width: primaryExtent, height: maxCross }
      : { width: maxCross, height: primaryExtent },
  };
}

function hierarchicalRanks(ids: string[], groupId: string, state: LayoutState): Map<string, number> {
  const idSet = new Set(ids);
  const pairs = new Set<string>();
  for (const edge of state.edges) {
    const source = immediateChildInGroup(edge.sourceElementId, groupId, state.parents);
    const target = immediateChildInGroup(edge.targetElementId, groupId, state.parents);
    if (source && target && source !== target && idSet.has(source) && idSet.has(target)) {
      pairs.add(`${source}\u0000${target}`);
    }
  }
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const pair of [...pairs].sort(compareText)) {
    const [source, target] = pair.split("\u0000") as [string, string];
    adjacency.get(source)!.push(target);
  }
  const components = stronglyConnectedComponents(ids, adjacency);
  const componentById = new Map<string, number>();
  components.forEach((component, index) => component.forEach((id) => componentById.set(id, index)));
  const componentKeys = components.map((component) => component[0]!);
  const outgoing = new Map(components.map((_, index) => [index, new Set<number>()]));
  const indegree = new Map(components.map((_, index) => [index, 0]));
  for (const [source, targets] of adjacency) {
    for (const target of targets) {
      const from = componentById.get(source)!;
      const to = componentById.get(target)!;
      if (from === to || outgoing.get(from)!.has(to)) continue;
      outgoing.get(from)!.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    }
  }
  const ranks = new Map(components.map((_, index) => [index, 0]));
  const ready = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([index]) => index)
    .sort((left, right) => compareText(componentKeys[left]!, componentKeys[right]!));
  while (ready.length > 0) {
    const current = ready.shift()!;
    const targets = [...outgoing.get(current)!]
      .sort((left, right) => compareText(componentKeys[left]!, componentKeys[right]!));
    for (const target of targets) {
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(current)! + 1));
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) {
        ready.push(target);
        ready.sort((left, right) => compareText(componentKeys[left]!, componentKeys[right]!));
      }
    }
  }
  return new Map(ids.map((id) => [id, ranks.get(componentById.get(id)!)!]));
}

function stronglyConnectedComponents(ids: string[], adjacency: Map<string, string[]>): string[][] {
  let nextIndex = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string): void => {
    index.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    onStack.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, index.get(target)!));
      }
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort(compareText));
  };

  for (const id of [...ids].sort(compareText)) if (!index.has(id)) visit(id);
  return components.sort((left, right) => compareText(left[0]!, right[0]!));
}

function immediateChildInGroup(
  elementId: string,
  groupId: string,
  parents: Map<string, string>,
): string | undefined {
  let current = elementId;
  for (;;) {
    const parent = parents.get(current);
    if ((parent ?? ROOT_GROUP) === groupId) return current;
    if (!parent) return undefined;
    current = parent;
  }
}

function expandGeneratedContainer(containerId: string, state: LayoutState): void {
  const geometry = state.geometries[containerId]!;
  const childGeometries = (state.children.get(containerId) ?? [])
    .map((id) => state.geometries[id])
    .filter((value): value is ElementGeometry => value !== undefined);
  if (childGeometries.length === 0) return;
  const left = Math.min(geometry.x, ...childGeometries.map((item) => item.x - state.spacing.containerPadding));
  const top = Math.min(
    geometry.y,
    ...childGeometries.map((item) => item.y - state.spacing.containerPadding - state.spacing.containerHeader),
  );
  const right = Math.max(
    geometry.x + geometry.width,
    ...childGeometries.map((item) => item.x + item.width + state.spacing.containerPadding),
  );
  const bottom = Math.max(
    geometry.y + geometry.height,
    ...childGeometries.map((item) => item.y + item.height + state.spacing.containerPadding),
  );
  state.geometries[containerId] = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function routeEdges(state: LayoutState): Record<string, Point[]> {
  const routes: Record<string, Point[]> = {};
  for (const edge of state.edges) {
    if (edge.routingPlacement === "user" && edge.waypoints) {
      routes[edge.elementId] = edge.waypoints.map(copyPoint);
      continue;
    }
    const source = state.geometries[edge.sourceElementId];
    const target = state.geometries[edge.targetElementId];
    if (!source || !target) {
      state.diagnostics.push({
        severity: "warning",
        code: "layout-edge-endpoint-missing",
        message: `edge endpoint is not present: ${edge.elementId}`,
        layoutRef: state.request.layoutRef,
        edgeId: edge.elementId,
      });
      continue;
    }
    routes[edge.elementId] = orthogonalRoute(source, target, state.direction);
  }
  return routes;
}

function orthogonalRoute(source: ElementGeometry, target: ElementGeometry, direction: LayoutDirection): Point[] {
  if (source === target) return [];
  if (direction === "LR") {
    const start = { x: source.x + source.width, y: source.y + source.height / 2 };
    const end = { x: target.x, y: target.y + target.height / 2 };
    const middle = (start.x + end.x) / 2;
    return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
  }
  const start = { x: source.x + source.width / 2, y: source.y + source.height };
  const end = { x: target.x + target.width / 2, y: target.y };
  const middle = (start.y + end.y) / 2;
  return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
}

function avoidOccupiedGeometry(
  input: ElementGeometry,
  occupied: ElementGeometry[],
  direction: LayoutDirection,
  gap: number,
): ElementGeometry {
  const result = copyGeometry(input);
  for (const obstacle of occupied) {
    while (intersects(result, obstacle)) {
      if (direction === "LR") result.y = obstacle.y + obstacle.height + gap;
      else result.x = obstacle.x + obstacle.width + gap;
    }
  }
  return result;
}

function intersects(left: ElementGeometry, right: ElementGeometry): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function sceneBounds(geometries: ElementGeometry[], margin: number): { width: number; height: number } {
  if (geometries.length === 0) return { width: margin * 2, height: margin * 2 };
  return {
    width: Math.max(...geometries.map((item) => item.x + item.width)) + margin,
    height: Math.max(...geometries.map((item) => item.y + item.height)) + margin,
  };
}

function emptyResult(layoutRef: string, diagnostics: LayoutDiagnostic[]): LayoutResult {
  return { layoutRef, geometries: {}, routes: {}, width: 0, height: 0, diagnostics };
}

function isFixed(element: LayoutElement): boolean {
  return element.pinned === true || element.placement === "user";
}

function primarySize(size: { width: number; height: number }, direction: LayoutDirection): number {
  return direction === "LR" ? size.width : size.height;
}

function crossSize(size: { width: number; height: number }, direction: LayoutDirection): number {
  return direction === "LR" ? size.height : size.width;
}

function copyGeometry(value: ElementGeometry): ElementGeometry {
  return { ...value };
}

function copyPoint(value: Point): Point {
  return { ...value };
}

function compareEdge(left: LayoutEdge, right: LayoutEdge): number {
  return compareText(left.elementId, right.elementId)
    || compareText(left.sourceElementId, right.sourceElementId)
    || compareText(left.targetElementId, right.targetElementId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
