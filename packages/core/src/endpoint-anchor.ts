import type {
  EdgeEndpointAnchor,
  EdgeEndpointShape,
  ElementGeometry,
  Point,
} from "./model";

const FULL_TURN = Math.PI * 2;
const ROUNDED_RECTANGLE_RADIUS = 12;
const EPSILON = 1e-12;

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
  return { position: raw < 0 ? raw + 1 : raw >= 1 ? raw - 1 : raw };
}

/** Resolves a normalized direction to the real boundary of the rendered shape. */
export function edgeEndpointAnchorPoint(
  geometry: ElementGeometry,
  shape: EdgeEndpointShape,
  anchor: EdgeEndpointAnchor,
): Point {
  if (!isValidEdgeEndpointAnchor(anchor)) {
    throw new RangeError("edge endpoint anchor position must be finite and in [0, 1)");
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

function snapZero(value: number): number {
  return Math.abs(value) < EPSILON ? 0 : value;
}
