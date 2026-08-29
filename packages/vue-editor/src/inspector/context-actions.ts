import type { Point } from "@iriograph/core";

export type DiagramContextTargetKind = "node" | "edge" | "container" | "region" | "blank";

export type DiagramContextMenuRequest = {
  kind: DiagramContextTargetKind;
  elementId?: string;
  origin?: "pointer" | "keyboard";
  guide?: {
    guideId: string;
    groupElementId: string;
    kind: "sequence-order" | "alternative-candidate";
  };
  clientX: number;
  clientY: number;
  canvasPosition?: Point;
};

export type LegacyEditorContextActionId =
  | "edit-name"
  | "edit-details"
  | "create-relation"
  | "edit-containment"
  | "edit-appearance"
  | "delete-resource"
  | "inspect-edge"
  | "edit-endpoints"
  | "edit-routing"
  | "delete-relation"
  | "add-contained-element"
  | "create-node"
  | "create-region";

/**
 * The menu renderer is intentionally generic. Legacy callers retain their
 * literal IDs, while target-specific adapters may use their own stable IDs.
 */
export type EditorContextActionId = LegacyEditorContextActionId | (string & {});

export type EditorContextAction = {
  id: EditorContextActionId;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  iconToken?: string;
};

export function contextActionsFor(
  target: DiagramContextTargetKind,
  readOnly: boolean,
): EditorContextAction[] {
  const editable = (action: Omit<EditorContextAction, "disabled">): EditorContextAction => ({
    ...action,
    disabled: readOnly,
  });
  if (target === "node") {
    return [editable({ id: "edit-appearance", label: "ビューを編集" })];
  }
  if (target === "edge") {
    return [editable({ id: "edit-appearance", label: "線のビューを編集" })];
  }
  if (target === "container" || target === "region") {
    return [editable({ id: "edit-appearance", label: "領域のビューを編集" })];
  }
  return [];
}
