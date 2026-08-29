import type {
  EdgeEndpointAnchor,
  EdgeEndpointShape,
  ElementGeometry,
  Point,
} from "../document/model.js";

const FULL_TURN = Math.PI * 2;
const ROUNDED_RECTANGLE_RADIUS = 12;
const EPSILON = 1e-12;

export type EdgeEndpointHaloGeometry = {
  boundaryPoint: Point;
  /** Unit outward normal in canvas coordinates. */
  normal: Point;
  haloPoint: Point;
  stub: { from: Point; to: Point };
};

export function isValidEdgeEndpointAnchor(
  anchor: EdgeEndpointAnchor | undefined,
): anchor is EdgeEndpointAnchor {
  return anchor !== undefined
    && Number.isFinite(anchor.position)
    && anchor.position >= 0
    && anchor.position < 1;
}

/** Converts a pointer direction around the element center to the sparse anchor value. */
export function edgeEndpointAnchorFromPoint(
  geometry: ElementGeometry,
  point: Point,
): EdgeEndpointAnchor {
  const center = geometryCenter(geometry);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return { position: 0 };
  const raw = (Math.atan2(dy, dx) + Math.PI / 2) / FULL_TURN;
  const wrapped = raw < 0 ? raw + 1 : raw >= 1 ? raw - 1 : raw;
  // A direction infinitesimally to the left of 12 o'clock can produce a
  // negative sub-ULP value. Adding one then rounds to exactly 1, even though
  // the normalized endpoint contract is half-open [0, 1).
  return { position: wrapped >= 1 || Object.is(wrapped, -0) ? 0 : wrapped };
}

/** Resolves a normalized direction to the real boundary of the rendered shape. */
export function edgeEndpointAnchorPoint(
  geometry: ElementGeometry,
  shape: EdgeEndpointShape,
  anchor: EdgeEndpointAnchor,
): Point {
  const position = anchor.position;
  if (!isValidEdgeEndpointAnchor(anchor)) {
    throw new RangeError(
      `edge endpoint anchor position must be finite and in [0, 1); received ${String(position)}`,
    );
  }
  const angle = anchor.position * FULL_TURN - Math.PI / 2;
  const direction = {
    x: snapZero(Math.cos(angle)),
    y: snapZero(Math.sin(angle)),
  };
  const halfWidth = geometry.width / 2;
  const halfHeight = geometry.height / 2;
  const distance = shape === "circle"
    ? ellipseDistance(direction, halfWidth, halfHeight)
    : shape === "diamond"
      ? diamondDistance(direction, halfWidth, halfHeight)
      : shape === "rounded-rectangle"
        ? roundedRectangleDistance(direction, halfWidth, halfHeight)
        : rectangleDistance(direction, halfWidth, halfHeight);
  const center = geometryCenter(geometry);
  return {
    x: snapZero(center.x + direction.x * distance),
    y: snapZero(center.y + direction.y * distance),
  };
}

/**
 * Resolves a zoom-independent interaction halo outside the real shape. The
 * persisted anchor stays the same normalized perimeter value; callers choose
 * canvas-unit distances appropriate for their renderer/input modality.
 */
export function edgeEndpointAnchorHaloGeometry(
  geometry: ElementGeometry,
  shape: EdgeEndpointShape,
  anchor: EdgeEndpointAnchor,
  haloDistance: number,
  stubLength = haloDistance,
): EdgeEndpointHaloGeometry {
  if (!Number.isFinite(haloDistance) || haloDistance < 0) {
    throw new RangeError("haloDistance must be a finite nonnegative canvas-unit value");
  }
  if (!Number.isFinite(stubLength) || stubLength < 0) {
    throw new RangeError("stubLength must be a finite nonnegative canvas-unit value");
  }
  if (!(geometry.width > 0) || !(geometry.height > 0)) {
    throw new RangeError("endpoint geometry must have positive width and height");
  }
  const boundaryPoint = edgeEndpointAnchorPoint(geometry, shape, anchor);
  const normal = boundaryNormal(geometry, shape, boundaryPoint);
  return {
    boundaryPoint,
    normal,
    haloPoint: offsetPoint(boundaryPoint, normal, haloDistance),
    stub: {
      from: { ...boundaryPoint },
      to: offsetPoint(boundaryPoint, normal, stubLength),
    },
  };
}

function geometryCenter(geometry: ElementGeometry): Point {
  return {
    x: geometry.x + geometry.width / 2,
    y: geometry.y + geometry.height / 2,
  };
}

function rectangleDistance(direction: Point, halfWidth: number, halfHeight: number): number {
  const xDistance = direction.x === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(direction.x);
  const yDistance = direction.y === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(direction.y);
  return Math.min(xDistance, yDistance);
}

function ellipseDistance(direction: Point, halfWidth: number, halfHeight: number): number {
  return 1 / Math.sqrt(
    direction.x ** 2 / halfWidth ** 2 + direction.y ** 2 / halfHeight ** 2,
  );
}

function diamondDistance(direction: Point, halfWidth: number, halfHeight: number): number {
  return 1 / (Math.abs(direction.x) / halfWidth + Math.abs(direction.y) / halfHeight);
}

function roundedRectangleDistance(
  direction: Point,
  halfWidth: number,
  halfHeight: number,
): number {
  const radius = Math.min(ROUNDED_RECTANGLE_RADIUS, halfWidth, halfHeight);
  const rectangle = rectangleDistance(direction, halfWidth, halfHeight);
  const x = Math.abs(direction.x * rectangle);
  const y = Math.abs(direction.y * rectangle);
  if (x <= halfWidth - radius || y <= halfHeight - radius || radius === 0) return rectangle;

  const cornerX = halfWidth - radius;
  const cornerY = halfHeight - radius;
  const absoluteDirection = { x: Math.abs(direction.x), y: Math.abs(direction.y) };
  const projection = absoluteDirection.x * cornerX + absoluteDirection.y * cornerY;
  const cornerSquared = cornerX ** 2 + cornerY ** 2;
  const discriminant = Math.max(0, projection ** 2 - cornerSquared + radius ** 2);
  return projection + Math.sqrt(discriminant);
}

function boundaryNormal(
  geometry: ElementGeometry,
  shape: EdgeEndpointShape,
  boundary: Point,
): Point {
  const center = geometryCenter(geometry);
  const x = boundary.x - center.x;
  const y = boundary.y - center.y;
  const halfWidth = geometry.width / 2;
  const halfHeight = geometry.height / 2;
  if (shape === "circle") return normalize({ x: x / halfWidth ** 2, y: y / halfHeight ** 2 });
  if (shape === "diamond") {
    // A vertex has two valid face normals. Use the radial direction there so
    // the interaction halo does not jump arbitrarily to one side.
    if (Math.abs(x) < EPSILON) return { x: 0, y: signedUnit(y) };
    if (Math.abs(y) < EPSILON) return { x: signedUnit(x), y: 0 };
    return normalize({
      x: signedUnit(x) / halfWidth,
      y: signedUnit(y) / halfHeight,
    });
  }
  if (shape === "rounded-rectangle") {
    const radius = Math.min(ROUNDED_RECTANGLE_RADIUS, halfWidth, halfHeight);
    const cornerX = halfWidth - radius;
    const cornerY = halfHeight - radius;
    if (Math.abs(x) > cornerX && Math.abs(y) > cornerY && radius > 0) {
      return normalize({
        x: x - signedUnit(x) * cornerX,
        y: y - signedUnit(y) * cornerY,
      });
    }
  }
  const horizontalDistance = Math.abs(Math.abs(x) - halfWidth);
  const verticalDistance = Math.abs(Math.abs(y) - halfHeight);
  if (Math.abs(horizontalDistance - verticalDistance) < EPSILON) return normalize({ x, y });
  return horizontalDistance < verticalDistance
    ? { x: signedUnit(x), y: 0 }
    : { x: 0, y: signedUnit(y) };
}

function signedUnit(value: number): number {
  return value < 0 ? -1 : 1;
}

function normalize(point: Point): Point {
  const length = Math.hypot(point.x, point.y);
  return length < EPSILON ? { x: 0, y: -1 } : {
    x: snapZero(point.x / length),
    y: snapZero(point.y / length),
  };
}

function offsetPoint(point: Point, normal: Point, distance: number): Point {
  return {
    x: snapZero(point.x + normal.x * distance),
    y: snapZero(point.y + normal.y * distance),
  };
}

function snapZero(value: number): number {
  return Math.abs(value) < EPSILON ? 0 : value;
}
