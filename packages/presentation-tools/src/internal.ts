import type {
  PresentationDiagnostic,
  PresentationElementKind,
  PresentationJsonValue,
  PresentationSceneBinding,
} from "./model.js";

export const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/u;
export const SAFE_COLOR = /^(?:none|transparent|black|silver|gray|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/iu;
export const SAFE_DASH = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[ ,]+(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)*$/u;

export const ELEMENT_KINDS: readonly PresentationElementKind[] = [
  "node",
  "container",
  "region",
  "edge",
  "annotation",
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function diagnose(
  diagnostics: PresentationDiagnostic[],
  code: PresentationDiagnostic["code"],
  message: string,
  path?: string,
): void {
  diagnostics.push({ code, message, ...(path ? { path } : {}) });
}

export function requireRecord(
  value: unknown,
  diagnostics: PresentationDiagnostic[],
  path: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    diagnose(diagnostics, "invalid-value", "Expected an object.", path);
    return undefined;
  }
  return value;
}

export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  diagnostics: PresentationDiagnostic[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value).sort(compareCodePoints)) {
    if (!allowedSet.has(key)) {
      diagnose(
        diagnostics,
        "unknown-field",
        `Field is outside the closed presentation contract: ${key}`,
        `${path}/${escapePointer(key)}`,
      );
    }
  }
}

export function requiredString(
  value: unknown,
  diagnostics: PresentationDiagnostic[],
  path: string,
  options: { opaque?: boolean; maxLength?: number } = {},
): string | undefined {
  const maxLength = options.maxLength ?? 200;
  if (typeof value !== "string" || value.length === 0 || [...value].length > maxLength) {
    diagnose(diagnostics, "invalid-value", `Expected a non-empty string up to ${maxLength} characters.`, path);
    return undefined;
  }
  if (options.opaque && !OPAQUE_ID.test(value)) {
    diagnose(
      diagnostics,
      "unsafe-value",
      "Expected an opaque ID; URL/IRI-like values are not accepted by this boundary.",
      path,
    );
    return undefined;
  }
  return value;
}

export function finiteNumber(
  value: unknown,
  diagnostics: PresentationDiagnostic[],
  path: string,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnose(diagnostics, "invalid-value", "Expected a finite number.", path);
    return undefined;
  }
  return value;
}

export function integer(
  value: unknown,
  diagnostics: PresentationDiagnostic[],
  path: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    diagnose(diagnostics, "invalid-value", `Expected a safe integer from ${min} to ${max}.`, path);
    return undefined;
  }
  return value as number;
}

export function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
  diagnostics: PresentationDiagnostic[],
  path: string,
): T | undefined {
  if (typeof value !== "string" || !values.includes(value as T)) {
    diagnose(diagnostics, "invalid-value", `Expected one of: ${values.join(", ")}.`, path);
    return undefined;
  }
  return value as T;
}

export function parseBinding(
  value: unknown,
  diagnostics: PresentationDiagnostic[],
  path: string,
): PresentationSceneBinding | undefined {
  const record = requireRecord(value, diagnostics, path);
  if (!record) return undefined;
  rejectUnknownKeys(record, ["documentRevision", "contextRevision", "viewId"], diagnostics, path);
  const documentRevision = requiredString(record.documentRevision, diagnostics, `${path}/documentRevision`);
  const contextRevision = requiredString(record.contextRevision, diagnostics, `${path}/contextRevision`);
  const viewId = requiredString(record.viewId, diagnostics, `${path}/viewId`, { opaque: true });
  if (!documentRevision || !contextRevision || !viewId) return undefined;
  return { documentRevision, contextRevision, viewId };
}

export function bindingDiagnostics(
  actual: PresentationSceneBinding | undefined,
  expected: PresentationSceneBinding,
): PresentationDiagnostic[] {
  if (!actual) return [{ code: "invalid-request", message: "A revision binding is required.", path: "/binding" }];
  const diagnostics: PresentationDiagnostic[] = [];
  if (actual.documentRevision !== expected.documentRevision) {
    diagnose(diagnostics, "stale-document-revision", "The candidate document revision is stale.", "/binding/documentRevision");
  }
  if (actual.contextRevision !== expected.contextRevision) {
    diagnose(diagnostics, "stale-context-revision", "The candidate capability context revision is stale.", "/binding/contextRevision");
  }
  if (actual.viewId !== expected.viewId) {
    diagnose(diagnostics, "view-mismatch", "The candidate targets a different view.", "/binding/viewId");
  }
  return diagnostics;
}

export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function jsonByteLength(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(encoded).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function truncate(value: string, maxCharacters: number): string {
  const characters = [...value];
  if (characters.length <= maxCharacters) return value;
  if (maxCharacters <= 1) return "…";
  return `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

export function jsonValue(value: unknown): PresentationJsonValue {
  return clone(value) as PresentationJsonValue;
}

export function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
