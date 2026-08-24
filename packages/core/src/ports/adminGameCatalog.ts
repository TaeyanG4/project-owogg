import type { GameIdentity } from "../modules/game/domain/gameIdentity.js";
import type { GameSettingRecord } from "./repositories.js";

export interface AdminGameCatalogPageItem {
  identity: GameIdentity;
  /** Latest source archive receipt time recorded by the server in game_versions.uploaded_at. */
  latestUploadedAt: string | null;
  setting: GameSettingRecord | null;
}

export interface AdminGameCatalogPage {
  items: AdminGameCatalogPageItem[];
  total: number;
}

/** Paged admin read model. Runtime catalog ports deliberately remain unpaginated and independent
 * from operational list concerns; this query boundary exists only for the growing admin table. */
export interface AdminGameCatalogRepository {
  listPage(input: {
    publisherType: "OWOGG" | "USER";
    limit: number;
    offset: number;
  }): Promise<AdminGameCatalogPage>;
}
