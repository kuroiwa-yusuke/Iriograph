import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import StructuredElementDetailsDialog from "./StructuredElementDetailsDialog.vue";

const groupKinds = [
  { groupKind: "classification" as const, label: "分類グループ", description: "分類", role: "group" as const, enabled: true },
  { groupKind: "membership" as const, label: "包含グループ", description: "包含", role: "group" as const, enabled: true },
  { groupKind: "sequence" as const, label: "順序付きグループ", description: "順序", role: "group" as const, enabled: true },
  { groupKind: "alternative" as const, label: "候補グループ", description: "候補", role: "group" as const, enabled: true },
];

describe("StructuredElementDetailsDialog", () => {
  it("別名・複数説明の追加と既存値の明示削除を一saveへまとめる", async () => {
    const wrapper = mountDialog({
      fields: [
        { field: "label", label: "名前", values: [{ valueId: "label-main", value: "主名称", localeKind: "default" }] },
        { field: "comment", label: "説明", values: [] },
      ],
    });
    await click(wrapper, "別名を追加");
    await click(wrapper, "説明を追加");
    const additions = wrapper.findAll("textarea[data-new-text]");
    await additions[0]!.setValue("別名\n二行目");
    await additions[1]!.setValue("説明1\n説明2");
    await click(wrapper, "削除");
    await click(wrapper, "変更を保存");

    expect(wrapper.emitted("save")?.[0]?.[0]).toEqual({
      text: [
        { operation: "add", field: "label", value: "別名\n二行目" },
        { operation: "add", field: "comment", value: "説明1\n説明2" },
        { operation: "remove", field: "label", valueId: "label-main" },
      ],
    });
    expect(wrapper.html()).not.toMatch(/https?:\/\/|rdfs:|rdf:type|IRI|@ja/u);
  });

  it("説明の空文字更新と削除を別operationとして扱う", async () => {
    const base = {
      fields: [
        { field: "label" as const, label: "名前", values: [{ valueId: "label-main", value: "名称", localeKind: "default" as const }] },
        { field: "comment" as const, label: "説明", values: [{ valueId: "comment-main", value: "説明", localeKind: "typed" as const }] },
      ],
    };
    const update = mountDialog(base);
    const comment = update.findAll("textarea")[1]!;
    await comment.setValue("");
    await click(update, "変更を保存");
    expect(update.emitted("save")?.[0]?.[0]).toMatchObject({
      text: [{ operation: "update", field: "comment", valueId: "comment-main", value: "" }],
    });

    const remove = mountDialog(base);
    const deleteButtons = remove.findAll("button").filter((button) => button.text() === "削除");
    await deleteButtons[1]!.trigger("click");
    await click(remove, "変更を保存");
    expect(remove.emitted("save")?.[0]?.[0]).toMatchObject({
      text: [{ operation: "remove", field: "comment", valueId: "comment-main" }],
    });
  });

  it("空Groupだけ種類変更を許し、memberがあるGroupは理由と専用editor導線を示す", async () => {
    const empty = mountDialog({ currentGroupKind: "membership", groupKinds });
    await empty.get("input[value='sequence']").setValue(true);
    await click(empty, "変更を保存");
    expect(empty.emitted("save")?.[0]?.[0]).toEqual({ text: [], groupKind: "sequence" });

    const populated = mountDialog({
      currentGroupKind: "sequence",
      groupKinds,
      memberships: [membership("ordered-1", "工程A", "sequence-member", false, 1)],
    });
    expect(populated.text()).toContain("要素を含むグループの種類は変更できません");
    expect(populated.find("[role='radiogroup']").exists()).toBe(false);
    await click(populated, "所属・順序を編集");
    expect(populated.emitted("editMembership")?.[0]).toEqual(["group-1"]);
    await click(populated, "専用編集を開く");
    expect(populated.emitted("editMembership")?.[1]).toEqual(["group-1"]);
  });

  it("opaque exact membershipを個別・複数選択し、Seq/Altは直接解除しない", async () => {
    const wrapper = mountDialog({
      memberships: [
        membership("membership-one", "グループA", "membership", true),
        membership("membership-two", "グループB", "membership", true),
        membership("membership-ordered", "順序C", "sequence-member", false, 2),
      ],
    });
    const checkboxes = wrapper.findAll(".iriograph-structured-memberships input[type='checkbox']");
    expect(checkboxes).toHaveLength(2);
    await checkboxes[0]!.setValue(true);
    await checkboxes[1]!.setValue(true);
    await click(wrapper, "変更を保存");
    expect(wrapper.emitted("save")?.[0]?.[0]).toEqual({
      text: [],
      removeMembershipIds: ["membership-one", "membership-two"],
    });
    expect(wrapper.html()).not.toContain("urn:test:");
    expect(wrapper.text()).toContain("並び順編集から解除してください");
  });
});

function mountDialog(overrides: Record<string, unknown> = {}) {
  return mount(StructuredElementDetailsDialog, {
    props: {
      title: "対象",
      fields: [
        { field: "label", label: "名前", values: [{ valueId: "label-main", value: "対象", localeKind: "default" }] },
        { field: "comment", label: "説明", values: [] },
      ],
      nodeRoles: [],
      memberships: [],
      ...overrides,
    },
  });
}

function membership(
  membershipId: string,
  relatedLabel: string,
  role: "membership" | "sequence-member" | "alternative-member",
  removable: boolean,
  ordinal?: number,
) {
  return {
    membershipId,
    direction: "contains" as const,
    relatedElementId: `element-${membershipId}`,
    relatedLabel,
    groupElementId: "group-1",
    groupLabel: "グループ",
    groupKind: role === "membership" ? "membership" as const : role === "sequence-member" ? "sequence" as const : "alternative" as const,
    role,
    ordinal,
    removable,
    ...(!removable ? { disabledReason: role === "sequence-member" ? "並び順編集から解除してください。" : "候補編集から解除してください。" } : {}),
  };
}

async function click(wrapper: VueWrapper, text: string): Promise<void> {
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === text);
  if (!button) throw new Error(`button not found: ${text}`);
  await button.trigger("click");
}
