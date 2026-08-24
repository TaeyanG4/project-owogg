export interface GamePublicationFacts {
  readonly publishedAt: string;
  readonly manifestKey: string;
  readonly publishedSizeBytes: number;
  readonly fileCount: number;
}

/** Immutable identity of the already-allocated version whose bytes are being published. */
export interface GamePublicationTarget {
  readonly gameId: number;
  readonly versionId: number;
  readonly contentHash: string;
}

/**
 * Narrow command port used while publishing one already-allocated numeric game version.
 * Publisher-specific identity, authorization and review lifecycle never cross this boundary.
 */
export interface GameVersionPublicationRepository {
  markPublishing(target: GamePublicationTarget): Promise<void>;
  markReady(target: GamePublicationTarget, facts: GamePublicationFacts): Promise<void>;
  markFailed(target: GamePublicationTarget, safeReason: string): Promise<void>;
  /** Destructive lifecycle transition after every published object was removed. Unlike an
   * ordinary publication failure this must also be able to retire a previously READY version,
   * which makes a later cross-store cleanup retry independent of an already-deleted manifest. */
  markGarbageCollected(target: GamePublicationTarget, marker: string): Promise<void>;
}
