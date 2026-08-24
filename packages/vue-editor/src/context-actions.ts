import type { Point } from "@iriograph/core";

export type DiagramContextTargetKind = "node" | "edge" | "container" | "region" | "blank";

export type DiagramContextMenuRequest = {
  kind: DiagramContextTargetKind;
  elementId?: string;
  clientX: number;
  clientY: number;
  canvasPosition?: Point;
};

export type EditorContextActionId =
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

export type EditorContextAction = {
  id: EditorContextActionId;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
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
