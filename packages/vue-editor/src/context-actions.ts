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
    return [
      editable({ id: "edit-name", label: "名前を編集" }),
      editable({ id: "edit-details", label: "詳細・属性を編集" }),
      editable({ id: "create-relation", label: "この要素から関係を作成" }),
      editable({ id: "edit-containment", label: "領域へ含める" }),
      editable({ id: "edit-appearance", label: "見た目を調整" }),
      editable({ id: "delete-resource", label: "要素を削除…", destructive: true }),
    ];
  }
  if (target === "edge") {
    return [
      { id: "inspect-edge", label: "関係の詳細", disabled: undefined },
      editable({ id: "edit-endpoints", label: "接点を調整" }),
      editable({ id: "edit-routing", label: "経路を調整" }),
      editable({ id: "delete-relation", label: "関係を削除…", destructive: true }),
    ];
  }
  if (target === "container" || target === "region") {
    return [
      editable({ id: "edit-details", label: "領域の詳細・属性を編集" }),
      editable({ id: "add-contained-element", label: "この領域へ要素を追加" }),
      editable({ id: "edit-appearance", label: "領域の見た目を調整" }),
      editable({ id: "delete-resource", label: "領域を削除…", destructive: true }),
    ];
  }
  return [
    editable({ id: "create-node", label: "新しい要素を置く" }),
    editable({ id: "create-region", label: "新しい領域を置く" }),
  ];
}
