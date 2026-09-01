import type {
  ProfileFollowConnectionPage,
  ProfileFollowRepository,
  ProfileFollowSummary,
  UserRepository,
} from "../ports/repositories.js";

export type ProfileFollowMutationResult =
  | { ok: true; summary: ProfileFollowSummary }
  | { ok: false; code: "USER_NOT_FOUND" | "SELF_FOLLOW_NOT_ALLOWED" };

export type ProfileFollowListResult =
  | { ok: true; user: { id: number; nickname: string }; page: ProfileFollowConnectionPage }
  | { ok: false; code: "USER_NOT_FOUND" };

export class ProfileFollowUseCases {
  constructor(
    private readonly users: UserRepository,
    private readonly follows: ProfileFollowRepository,
  ) {}

  getSummary(userId: number, viewerId: number | null): Promise<ProfileFollowSummary> {
    return this.follows.getSummary(userId, viewerId);
  }

  async follow(viewerId: number, targetUserId: number): Promise<ProfileFollowMutationResult> {
    if (viewerId === targetUserId) return { ok: false, code: "SELF_FOLLOW_NOT_ALLOWED" };
    if (!(await this.users.findById(targetUserId))) return { ok: false, code: "USER_NOT_FOUND" };
    await this.follows.follow(viewerId, targetUserId, new Date().toISOString());
    return { ok: true, summary: await this.follows.getSummary(targetUserId, viewerId) };
  }

  async unfollow(viewerId: number, targetUserId: number): Promise<ProfileFollowMutationResult> {
    if (viewerId === targetUserId) return { ok: false, code: "SELF_FOLLOW_NOT_ALLOWED" };
    if (!(await this.users.findById(targetUserId))) return { ok: false, code: "USER_NOT_FOUND" };
    await this.follows.unfollow(viewerId, targetUserId);
    return { ok: true, summary: await this.follows.getSummary(targetUserId, viewerId) };
  }

  async listFollowers(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<ProfileFollowListResult> {
    const user = await this.users.findById(userId);
    if (!user) return { ok: false, code: "USER_NOT_FOUND" };
    return {
      ok: true,
      user: { id: user.id, nickname: user.nickname },
      page: await this.follows.listFollowers(userId, page, pageSize),
    };
  }

  async listFollowing(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<ProfileFollowListResult> {
    const user = await this.users.findById(userId);
    if (!user) return { ok: false, code: "USER_NOT_FOUND" };
    return {
      ok: true,
      user: { id: user.id, nickname: user.nickname },
      page: await this.follows.listFollowing(userId, page, pageSize),
    };
  }
}
