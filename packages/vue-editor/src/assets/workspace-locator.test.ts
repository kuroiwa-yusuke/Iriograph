import { describe, expect, it } from "vitest";

import { createStaticWorkspaceLocator } from "./workspace-locator";

const locator = createStaticWorkspaceLocator([
  { path: "assets/icons/task.svg", assetRef: "urn:asset:task", label: "Task" },
  { path: "assets/icons/timer.svg", assetRef: "urn:asset:timer" },
  { path: "models/assets/local.png", assetRef: "urn:asset:local" },
]);

describe("workspace locator", () => {
  it("root、absolute、document-relative pathを同じstable assetRefへ解決する", () => {
    expect(locator.resolve({ documentPath: "models/flow.iriograph", input: "assets/icons/task.svg" })).toEqual({
      status: "resolved", assetRef: "urn:asset:task", path: "assets/icons/task.svg",
    });
    expect(locator.resolve({ documentPath: "models/flow.iriograph", input: "/assets/icons/task.svg" })).toEqual({
      status: "resolved", assetRef: "urn:asset:task", path: "assets/icons/task.svg",
    });
    expect(locator.resolve({ documentPath: "models/flow.iriograph", input: "./assets/local.png" })).toEqual({
      status: "resolved", assetRef: "urn:asset:local", path: "models/assets/local.png",
    });
    expect(locator.resolve({ documentPath: "models/flow.iriograph", input: "../assets/icons/task.svg" })).toEqual({
      status: "resolved", assetRef: "urn:asset:task", path: "assets/icons/task.svg",
    });
  });

  it("Workspace escape、folder、not-found、曖昧pathを拒否する", () => {
    expect(locator.resolve({ documentPath: "flow.iriograph", input: "../secret.svg" })).toMatchObject({
      status: "rejected", reason: "workspace-escape",
    });
    expect(locator.resolve({ documentPath: "models/flow.iriograph", input: "/assets/icons/" })).toMatchObject({
      status: "rejected", reason: "not-asset",
    });
    expect(locator.resolve({ documentPath: "models/flow.iriograph", input: "missing.svg" })).toMatchObject({
      status: "rejected", reason: "not-found",
    });
    const ambiguous = createStaticWorkspaceLocator([
      { path: "assets/a.svg", assetRef: "urn:asset:a" },
      { path: "assets/a.svg", assetRef: "urn:asset:b" },
    ]);
    expect(ambiguous.resolve({ documentPath: "models/flow.iriograph", input: "assets/a.svg" })).toMatchObject({
      status: "rejected", reason: "ambiguous",
    });
  });

  it("host metadata自身がWorkspace rootをescapeする場合はindex生成を拒否する", () => {
    expect(() => createStaticWorkspaceLocator([
      { path: "../secret.svg", assetRef: "urn:asset:secret" },
    ])).toThrow("escapes root");
    expect(() => createStaticWorkspaceLocator([
      { path: "assets/../../secret.svg", assetRef: "urn:asset:secret" },
    ])).toThrow("escapes root");
  });

  it("現在segmentだけのfolder/file候補とbreadcrumbを返す", () => {
    expect(locator.suggest({ documentPath: "models/flow.iriograph", input: "assets/i" })).toEqual([
      { kind: "folder", label: "icons/", path: "assets/icons", input: "assets/icons/" },
    ]);
    expect(locator.suggest({ documentPath: "models/flow.iriograph", input: "/assets/icons/t" })).toEqual([
      { kind: "asset", label: "Task", path: "assets/icons/task.svg", input: "/assets/icons/task.svg", assetRef: "urn:asset:task" },
      { kind: "asset", label: "timer.svg", path: "assets/icons/timer.svg", input: "/assets/icons/timer.svg", assetRef: "urn:asset:timer" },
    ]);
    expect(locator.breadcrumbs({ documentPath: "models/flow.iriograph", input: "/assets/icons/t" }))
      .toEqual([
        { label: "workspace", path: "", input: "/" },
        { label: "assets", path: "assets", input: "/assets/" },
        { label: "icons", path: "assets/icons", input: "/assets/icons/" },
      ]);
  });
});
