import {
  parseGameCanonicalDocument,
  serializeGameCanonicalDocument,
} from "../domain/gameCanonicalDocument.js";
import type { RuntimeGame } from "../domain/runtimeGame.js";
import type { GameIdentity } from "../domain/gameIdentity.js";
import type { GameCanonicalRepository } from "../ports/gameCanonicalRepository.js";
import type { GameIdentityRepository } from "../ports/gameIdentityRepository.js";
import type { RuntimeGameRegistry } from "../ports/runtimeGameRegistry.js";
import type { GameVersionRepository } from "../ports/gameVersionRepository.js";

/**
 * Joins generic D1 identity/live-version state with the generic canonical document. There is no
 * publisher branch: OWOGG and USER games pass through exactly the same invariants.
 */
export class ComposedRuntimeGameRegistry implements RuntimeGameRegistry {
  constructor(
    private readonly identities: GameIdentityRepository,
    private readonly versions: GameVersionRepository,
    private readonly canonicals: GameCanonicalRepository,
  ) {}

  async findBySlug(slug: string): Promise<RuntimeGame | null> {
    try {
      const identity = await this.identities.findBySlug(slug);
      if (
        identity === null ||
        identity.deletedAt !== null ||
        identity.visibility !== "PUBLIC" ||
        identity.liveVersionId === null
      ) {
        return null;
      }

      const liveVersion = await this.versions.findById(identity.liveVersionId);
      if (
        liveVersion === null ||
        liveVersion.gameId !== identity.id ||
        liveVersion.publishStatus !== "READY"
      ) {
        return null;
      }

      const storedCanonical = await this.canonicals.findBySlug(identity.slug);
      if (storedCanonical === null) return null;

      // The production adapter already parses strictly. Re-parse at this boundary as defense in
      // depth so a malformed alternate adapter or test double cannot bypass runtime validation.
      const canonical = parseGameCanonicalDocument(
        serializeGameCanonicalDocument(storedCanonical),
        identity.slug,
      );

      return { identity, liveVersion, canonical };
    } catch {
      // Storage failures and malformed rows/documents are all unavailable runtime state. The
      // public resolver deliberately exposes the same null result as an unknown slug.
      return null;
    }
  }

  async listPublic(): Promise<readonly RuntimeGame[]> {
    let identities: readonly GameIdentity[];
    try {
      identities = await this.identities.listAll();
    } catch {
      // A failed or malformed identity enumeration cannot produce a trustworthy partial public
      // catalog. Return no candidates rather than falling back to a legacy registry.
      return [];
    }
    const candidates = identities.filter(
      (identity) =>
        identity.deletedAt === null &&
        identity.visibility === "PUBLIC" &&
        identity.liveVersionId !== null,
    );

    // B2 canonical reads are independent per game. Awaiting them in a loop made a cold catalog's
    // latency grow linearly with the number of games (four ~1s reads became a ~4s first page).
    // Promise.all preserves candidate order while making total latency approach the slowest one.
    const resolved = await Promise.all(
      candidates.map(async (identity): Promise<RuntimeGame | null> => {
        try {
          const liveVersionId = identity.liveVersionId;
          if (liveVersionId === null) return null;
          const liveVersion = await this.versions.findById(liveVersionId);
          if (
            liveVersion === null ||
            liveVersion.gameId !== identity.id ||
            liveVersion.publishStatus !== "READY"
          ) {
            return null;
          }

          const storedCanonical = await this.canonicals.findBySlug(identity.slug);
          if (storedCanonical === null) return null;
          const canonical = parseGameCanonicalDocument(
            serializeGameCanonicalDocument(storedCanonical),
            identity.slug,
          );
          return { identity, liveVersion, canonical };
        } catch {
          // A malformed/incomplete entry must not make the rest of the public catalog appear
          // unavailable, and must never fall back to legacy publisher-specific metadata.
          return null;
        }
      }),
    );

    return resolved.filter((runtime): runtime is RuntimeGame => runtime !== null);
  }
}
