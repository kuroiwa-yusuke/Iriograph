import { hasBlockingDiagnostics, sortDiagnostics } from "./diagnostics.js";
import type {
  DiagramView,
  IriographDocument,
  ProjectionDiagnostic,
} from "./model.js";
import { reconcileIriographDocumentViews } from "./reconciliation.js";
import { isBcp47LanguageTag } from "./schema.js";
import {
  buildIriographView,
  type ProjectionRuntimeContext,
} from "./scene.js";

export type AddViewCommand = {
  command: "add";
  viewId: string;
  profileRef: string;
  layoutRef: string;
  locale?: string;
};

export type DuplicateViewCommand = {
  command: "duplicate";
  sourceViewId: string;
  viewId: string;
};

export type ConfigureViewCommand = {
  command: "configure";
  viewId: string;
  profileRef?: string;
  layoutRef?: string;
  /** null removes the optional locale. undefined keeps the current locale. */
  locale?: string | null;
};

export type DeleteViewCommand = {
  command: "delete";
  viewId: string;
};

export type ResetViewOverlayCommand = {
  command: "reset-overlay";
  viewId: string;
};

/**
 * One closed presentation command vocabulary. View identity is never editable:
 * add/duplicate allocate a new identity, while every other command targets one.
 */
export type ViewCommand =
  | AddViewCommand
  | DuplicateViewCommand
  | ConfigureViewCommand
  | DeleteViewCommand
  | ResetViewOverlayCommand;

export type ViewCommandResult = {
  accepted: boolean;
  document: IriographDocument;
  diagnostics: ProjectionDiagnostic[];
  affectedViewId?: string;
};

export type ViewCommandOptions = {
  signal?: AbortSignal;
};

/**
 * Applies one presentation-only view command atomically. Projection and layout
 * are limited to the affected view; semantic transactions continue to use the
 * all-view reconciliation pipeline.
 */
export async function applyViewCommand(
  document: IriographDocument,
  command: ViewCommand,
  context: ProjectionRuntimeContext,
  options: ViewCommandOptions = {},
): Promise<ViewCommandResult> {
  if (options.signal?.aborted) return aborted(document);
  const candidate = clone(document);

  if (command.command === "delete") {
    const index = candidate.views.findIndex((view) => view.viewId === command.viewId);
    if (index < 0) return rejected(document, "view-unresolved", `viewが存在しません: ${command.viewId}`);
    if (candidate.views.length === 1) {
      return rejected(document, "last-view-delete-rejected", "最後のviewは削除できません。", command.viewId);
    }
    // Deletion deliberately does not project the target or sibling views. This
    // keeps a broken named view removable without weakening semantic atomicity.
    candidate.views.splice(index, 1);
    return accepted(candidate, command.viewId);
  }

  if (command.command === "add") {
    const identityError = validateNewViewId(candidate, command.viewId);
    if (identityError) return rejected(document, identityError.code, identityError.message, command.viewId);
    const view: DiagramView = {
      viewId: command.viewId,
      kind: "node-link",
      profileRef: command.profileRef,
      layoutRef: command.layoutRef,
      ...(command.locale === undefined ? {} : { locale: command.locale }),
      overlay: {},
    };
    const shapeError = validateViewConfiguration(view);
    if (shapeError) return rejected(document, shapeError.code, shapeError.message, command.viewId);
    candidate.views.push(view);
    const generated = await regenerateTargetView(document, candidate, command.viewId, context, false);
    return options.signal?.aborted ? aborted(document) : generated;
  }

  if (command.command === "duplicate") {
    const source = candidate.views.find((view) => view.viewId === command.sourceViewId);
    if (!source) {
      return rejected(document, "view-unresolved", `複製元viewが存在しません: ${command.sourceViewId}`);
    }
    const identityError = validateNewViewId(candidate, command.viewId);
    if (identityError) return rejected(document, identityError.code, identityError.message, command.viewId);
    const duplicate = clone(source);
    duplicate.viewId = command.viewId;
    candidate.views.push(duplicate);
    const checked = await validateExactTargetView(document, candidate, command.viewId, context);
    return options.signal?.aborted ? aborted(document) : checked;
  }

  const current = candidate.views.find((view) => view.viewId === command.viewId);
  if (!current) return rejected(document, "view-unresolved", `viewが存在しません: ${command.viewId}`);

  if (command.command === "reset-overlay") {
    current.overlay = {};
    const generated = await regenerateTargetView(document, candidate, command.viewId, context, false);
    return options.signal?.aborted ? aborted(document) : generated;
  }

  const oldProfileRef = current.profileRef;
  const oldLayoutRef = current.layoutRef;
  const oldLocale = current.locale;
  if (command.profileRef !== undefined) current.profileRef = command.profileRef;
  if (command.layoutRef !== undefined) current.layoutRef = command.layoutRef;
  if (command.locale === null) delete current.locale;
  else if (command.locale !== undefined) current.locale = command.locale;
  const shapeError = validateViewConfiguration(current);
  if (shapeError) return rejected(document, shapeError.code, shapeError.message, command.viewId);

  const localeOnly = current.profileRef === oldProfileRef
    && current.layoutRef === oldLayoutRef
    && current.locale !== oldLocale;
  if (localeOnly || (
    current.profileRef === oldProfileRef
    && current.layoutRef === oldLayoutRef
    && current.locale === oldLocale
  )) {
    const checked = await validateExactTargetView(document, candidate, command.viewId, context);
    return options.signal?.aborted ? aborted(document) : checked;
  }

  const regenerated = await regenerateTargetView(document, candidate, command.viewId, context, true);
  return options.signal?.aborted ? aborted(document) : regenerated;
}

async function validateExactTargetView(
  previous: IriographDocument,
  candidate: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
): Promise<ViewCommandResult> {
  const scene = await buildIriographView(candidate, viewId, context, "incremental");
  if (hasBlockingDiagnostics(scene.diagnostics)) {
    return rejectedWithDiagnostics(previous, scene.diagnostics, viewId);
  }
  return {
    accepted: true,
    document: clone(candidate),
    diagnostics: sortDiagnostics(scene.diagnostics),
    affectedViewId: viewId,
  };
}

async function regenerateTargetView(
  previous: IriographDocument,
  candidate: IriographDocument,
  viewId: string,
  context: ProjectionRuntimeContext,
  preserveCompatibleOverlay: boolean,
): Promise<ViewCommandResult> {
  const target = candidate.views.find((view) => view.viewId === viewId)!;
  // A one-view transaction prevents unrelated or already-invalid sibling views
  // from being rebuilt by a presentation command.
  const candidateSlice = clone(candidate);
  candidateSlice.views = [clone(target)];
  const previousSlice = clone(previous);
  const previousTarget = previous.views.find((view) => view.viewId === viewId);
  previousSlice.views = preserveCompatibleOverlay && previousTarget
    ? [clone(previousTarget)]
    : [];
  const reconciled = await reconcileIriographDocumentViews(
    previousSlice,
    candidateSlice,
    context,
  );
  if (!reconciled.accepted) {
    return rejectedWithDiagnostics(previous, reconciled.diagnostics, viewId);
  }
  const regenerated = reconciled.document.views[0]!;
  const index = candidate.views.findIndex((view) => view.viewId === viewId);
  candidate.views[index] = regenerated;
  return {
    accepted: true,
    document: clone(candidate),
    diagnostics: sortDiagnostics(reconciled.diagnostics),
    affectedViewId: viewId,
  };
}

function validateNewViewId(
  document: IriographDocument,
  viewId: string,
): { code: string; message: string } | undefined {
  if (!viewId.trim()) return { code: "view-id-empty", message: "viewIdは空にできません。" };
  if (document.views.some((view) => view.viewId === viewId)) {
    return { code: "view-id-conflict", message: `viewIdが重複しています: ${viewId}` };
  }
  return undefined;
}

function validateViewConfiguration(
  view: DiagramView,
): { code: string; message: string } | undefined {
  if (!view.profileRef.trim()) return { code: "view-profile-empty", message: "profileRefは必須です。" };
  if (!view.layoutRef.trim()) return { code: "view-layout-empty", message: "layoutRefは必須です。" };
  if (view.locale !== undefined && !isBcp47LanguageTag(view.locale)) {
    return { code: "view-locale-invalid", message: `localeがBCP 47ではありません: ${view.locale}` };
  }
  return undefined;
}

function accepted(document: IriographDocument, affectedViewId: string): ViewCommandResult {
  return { accepted: true, document: clone(document), diagnostics: [], affectedViewId };
}

function rejected(
  document: IriographDocument,
  code: string,
  message: string,
  semanticRef?: string,
): ViewCommandResult {
  return rejectedWithDiagnostics(document, [{
    severity: "error",
    category: "projection",
    code,
    message,
    semanticRef,
  }], semanticRef);
}

function rejectedWithDiagnostics(
  document: IriographDocument,
  diagnostics: readonly ProjectionDiagnostic[],
  affectedViewId?: string,
): ViewCommandResult {
  return {
    accepted: false,
    document: clone(document),
    diagnostics: sortDiagnostics(diagnostics),
    affectedViewId,
  };
}

function aborted(document: IriographDocument): ViewCommandResult {
  return rejectedWithDiagnostics(document, [{
    severity: "info",
    category: "projection",
    code: "view-command-aborted",
    message: "view commandは中断されました。",
  }]);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
