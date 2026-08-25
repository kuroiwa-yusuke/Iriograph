import type { AssetMediaType } from "@iriograph/core";

/** Host-owned workspace mapping for the editor's label/path-first icon picker. */
export type EditorAssetOption = {
  assetRef: string;
  label?: string;
  path?: string;
  mediaType?: AssetMediaType;
};
