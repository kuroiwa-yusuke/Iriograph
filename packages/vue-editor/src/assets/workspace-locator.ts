import {
  translateEditorMessage,
  type EditorTranslator,
} from "../localization/editor-localization";

export type WorkspaceLocatorEntry = {
  path: string;
  assetRef: string;
  label?: string;
  mediaType?: string;
};

export type WorkspaceLocatorRequest = {
  documentPath: string;
  input: string;
};

export type WorkspaceLocatorSuggestion = {
  kind: "asset" | "folder";
  label: string;
  path: string;
  input: string;
  assetRef?: string;
};

export type WorkspaceLocatorBreadcrumb = {
  label: string;
  path: string;
  input: string;
};

export type WorkspaceLocatorResolution =
  | { status: "resolved"; assetRef: string; path: string }
  | {
      status: "rejected";
      reason: "empty" | "workspace-escape" | "not-found" | "ambiguous" | "not-asset";
      message: string;
    };

/**
 * Host-owned workspace index presented to the editor. Implementations only
 * expose metadata: fetching bytes, authorization and persistence remain host
 * responsibilities.
 */
export interface WorkspaceLocator {
  suggest(request: WorkspaceLocatorRequest): readonly WorkspaceLocatorSuggestion[];
  breadcrumbs(request: WorkspaceLocatorRequest): readonly WorkspaceLocatorBreadcrumb[];
  resolve(request: WorkspaceLocatorRequest): WorkspaceLocatorResolution;
}

export function createStaticWorkspaceLocator(
  entries: readonly WorkspaceLocatorEntry[],
  translator: EditorTranslator = defaultTranslator,
): WorkspaceLocator {
  const indexed = entries.map((entry) => ({ ...entry, path: normalizeEntryPath(entry.path) }));
  const byPath = new Map<string, WorkspaceLocatorEntry[]>();
  for (const entry of indexed) {
    const bucket = byPath.get(entry.path) ?? [];
    bucket.push(entry);
    byPath.set(entry.path, bucket);
  }

  return {
    suggest(request) {
      const parsed = parseInput(request);
      if (!parsed.accepted) return [];
      const directory = parsed.trailingSlash ? parsed.path : parentPath(parsed.path);
      const partial = parsed.trailingSlash ? "" : basename(parsed.path);
      const children = new Map<string, WorkspaceLocatorSuggestion>();
      for (const entry of indexed) {
        if (!pathIsWithin(entry.path, directory)) continue;
        const rest = directory ? entry.path.slice(directory.length + 1) : entry.path;
        if (!rest) continue;
        const [segment, ...remaining] = rest.split("/");
        if (!segment?.startsWith(partial)) continue;
        const candidatePath = joinPath(directory, segment);
        const folder = remaining.length > 0;
        const previous = children.get(candidatePath);
        if (previous?.kind === "folder") continue;
        children.set(candidatePath, {
          kind: folder ? "folder" : "asset",
          label: folder ? `${segment}/` : entry.label ?? segment,
          path: candidatePath,
          input: displayInput(candidatePath, request.documentPath, parsed.style, folder),
          ...(folder ? {} : { assetRef: entry.assetRef }),
        });
      }
      return [...children.values()].sort((left, right) => (
        (left.kind === right.kind ? 0 : left.kind === "folder" ? -1 : 1)
        || left.label.localeCompare(right.label, "ja")
      ));
    },
    breadcrumbs(request) {
      const parsed = parseInput(request);
      if (!parsed.accepted) return [];
      const directory = parsed.trailingSlash ? parsed.path : parentPath(parsed.path);
      const segments = directory ? directory.split("/") : [];
      const result: WorkspaceLocatorBreadcrumb[] = [{
        label: "workspace",
        path: "",
        input: displayInput("", request.documentPath, parsed.style, true),
      }];
      for (let index = 0; index < segments.length; index += 1) {
        const path = segments.slice(0, index + 1).join("/");
        result.push({
          label: segments[index]!,
          path,
          input: displayInput(path, request.documentPath, parsed.style, true),
        });
      }
      return result;
    },
    resolve(request) {
      if (!request.input.trim()) {
        return { status: "rejected", reason: "empty", message: translator("workspaceLocator.pathRequired") };
      }
      const parsed = parseInput(request);
      if (!parsed.accepted) {
        return {
          status: "rejected",
          reason: "workspace-escape",
          message: translator("workspaceLocator.outsideWorkspace"),
        };
      }
      if (parsed.trailingSlash || hasDescendant(indexed, parsed.path)) {
        return {
          status: "rejected",
          reason: "not-asset",
          message: translator("workspaceLocator.imageFileRequired"),
        };
      }
      const candidates = byPath.get(parsed.path) ?? [];
      if (candidates.length === 0) {
        return { status: "rejected", reason: "not-found", message: translator("workspaceLocator.notFound") };
      }
      const assetRefs = [...new Set(candidates.map((entry) => entry.assetRef))];
      if (assetRefs.length !== 1) {
        return {
          status: "rejected",
          reason: "ambiguous",
          message: translator("workspaceLocator.ambiguous"),
        };
      }
      return { status: "resolved", assetRef: assetRefs[0]!, path: parsed.path };
    },
  };
}

const defaultTranslator: EditorTranslator = (key, parameters) => (
  translateEditorMessage("en", key, parameters)
);

type ParsedInput =
  | { accepted: true; path: string; trailingSlash: boolean; style: "root" | "absolute" | "relative" }
  | { accepted: false };

function parseInput(request: WorkspaceLocatorRequest): ParsedInput {
  const source = request.input.trim().replaceAll("\\", "/");
  const style = source.startsWith("/")
    ? "absolute"
    : source === "." || source === ".." || source.startsWith("./") || source.startsWith("../")
      ? "relative"
      : "root";
  let documentDirectory = "";
  if (style === "relative") {
    try {
      documentDirectory = parentPath(normalizeEntryPath(request.documentPath));
    } catch {
      return { accepted: false };
    }
  }
  const base = style === "relative" ? documentDirectory : "";
  const raw = style === "absolute" ? source.slice(1) : source;
  const parts = base ? base.split("/") : [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return { accepted: false };
      parts.pop();
      continue;
    }
    if (part.includes("\0")) return { accepted: false };
    parts.push(part);
  }
  return {
    accepted: true,
    path: parts.join("/"),
    trailingSlash: source.endsWith("/") || source === "." || source === "..",
    style,
  };
}

function displayInput(
  targetPath: string,
  documentPath: string,
  style: "root" | "absolute" | "relative",
  folder: boolean,
): string {
  const suffix = folder && targetPath ? "/" : "";
  if (style === "absolute") return `/${targetPath}${suffix}`;
  if (style === "root") return `${targetPath}${suffix}`;
  const from = parentPath(normalizeEntryPath(documentPath)).split("/").filter(Boolean);
  const to = targetPath.split("/").filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  const relative = [
    ...Array.from({ length: from.length - common }, () => ".."),
    ...to.slice(common),
  ].join("/");
  const prefix = relative.startsWith("..") ? "" : "./";
  return `${prefix}${relative || "."}${suffix}`;
}

function normalizeEntryPath(path: string): string {
  const source = path.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  const parts: string[] = [];
  for (const part of source.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new Error(`Workspace entry escapes root: ${path}`);
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const normalized = parts.join("/");
  if (!normalized) throw new Error("Workspace entry path must not be empty.");
  return normalized;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? "";
}

function joinPath(left: string, right: string): string {
  return left ? `${left}/${right}` : right;
}

function pathIsWithin(path: string, directory: string): boolean {
  return !directory || path.startsWith(`${directory}/`);
}

function hasDescendant(entries: readonly WorkspaceLocatorEntry[], path: string): boolean {
  return entries.some((entry) => entry.path.startsWith(`${path}/`));
}
