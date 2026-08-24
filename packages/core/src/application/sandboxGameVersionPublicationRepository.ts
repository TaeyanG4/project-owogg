import type { SandboxGameRepository } from "../ports/sandboxGames.js";
import type {
  GamePublicationFacts,
  GamePublicationTarget,
  GameVersionPublicationRepository,
} from "../modules/game/ports/gameVersionPublicationRepository.js";

/** USER compatibility adapter. Review status stays entirely in SandboxGameRepository. */
export class SandboxGameVersionPublicationRepository implements GameVersionPublicationRepository {
  constructor(private readonly sandboxGames: SandboxGameRepository) {}

  async markPublishing(target: GamePublicationTarget): Promise<void> {
    await this.requireTarget(target);
    const updated = await this.sandboxGames.setVersionPublishState(target.versionId, {
      publishStatus: "PUBLISHING",
      publishError: null,
      publishedAt: null,
      manifestKey: null,
      publishedSizeBytes: null,
      fileCount: null,
    });
    assertTarget(updated, target);
  }

  async markReady(target: GamePublicationTarget, facts: GamePublicationFacts): Promise<void> {
    await this.requireTarget(target);
    const updated = await this.sandboxGames.setVersionPublishState(target.versionId, {
      publishStatus: "READY",
      publishError: null,
      publishedAt: facts.publishedAt,
      manifestKey: facts.manifestKey,
      publishedSizeBytes: facts.publishedSizeBytes,
      fileCount: facts.fileCount,
    });
    assertTarget(updated, target);
  }

  async markFailed(target: GamePublicationTarget, safeReason: string): Promise<void> {
    await this.requireTarget(target);
    const updated = await this.sandboxGames.setVersionPublishState(target.versionId, {
      publishStatus: "FAILED",
      publishError: safeReason,
      publishedAt: null,
      manifestKey: null,
      publishedSizeBytes: null,
      fileCount: null,
    });
    assertTarget(updated, target);
  }

  async markGarbageCollected(target: GamePublicationTarget, marker: string): Promise<void> {
    await this.requireTarget(target);
    const updated = await this.sandboxGames.setVersionPublishState(target.versionId, {
      publishStatus: "FAILED",
      publishError: marker,
      publishedAt: null,
      manifestKey: null,
      publishedSizeBytes: null,
      fileCount: null,
    });
    assertTarget(updated, target);
  }

  private async requireTarget(target: GamePublicationTarget): Promise<void> {
    const version = await this.sandboxGames.findVersionById(target.versionId);
    if (!version) throw new Error(`Game publication version ${target.versionId} does not exist`);
    assertTarget(version, target);
  }
}

function assertTarget(
  version: { id: number; gameId: number; contentHash: string },
  target: GamePublicationTarget,
): void {
  if (
    version.id !== target.versionId ||
    version.gameId !== target.gameId ||
    version.contentHash !== target.contentHash
  ) {
    throw new Error(`Game publication target mismatch for version ${target.versionId}`);
  }
}
