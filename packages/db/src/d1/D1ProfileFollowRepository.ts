import type {
  ProfileFollowConnection,
  ProfileFollowConnectionPage,
  ProfileFollowRepository,
  ProfileFollowSummary,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

interface FollowConnectionRow extends Record<string, unknown> {
  user_id: number;
  nickname: string;
  avatar_url: string | null;
  country: string | null;
  followed_at: string;
}

function mapConnection(row: FollowConnectionRow): ProfileFollowConnection {
  return {
    userId: Number(row.user_id),
    nickname: String(row.nickname),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    country: row.country ? String(row.country) : null,
    followedAt: String(row.followed_at),
  };
}

export class D1ProfileFollowRepository implements ProfileFollowRepository {
  constructor(private readonly db: D1Database) {}

  async getSummary(userId: number, viewerId: number | null): Promise<ProfileFollowSummary> {
    const row = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM user_follows WHERE followed_user_id = ?) AS follower_count,
           (SELECT COUNT(*) FROM user_follows WHERE follower_user_id = ?) AS following_count,
           CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
             SELECT 1 FROM user_follows
              WHERE follower_user_id = ? AND followed_user_id = ?
           ) END AS viewer_is_following`,
      )
      .bind(userId, userId, viewerId, viewerId, userId)
      .first<Record<string, unknown>>();

    return {
      followerCount: Number(row?.follower_count ?? 0),
      followingCount: Number(row?.following_count ?? 0),
      viewerIsFollowing: Boolean(Number(row?.viewer_is_following ?? 0)),
    };
  }

  async follow(followerUserId: number, followedUserId: number, createdAt: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO user_follows
           (follower_user_id, followed_user_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .bind(followerUserId, followedUserId, createdAt)
      .run();
  }

  async unfollow(followerUserId: number, followedUserId: number): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM user_follows
          WHERE follower_user_id = ? AND followed_user_id = ?`,
      )
      .bind(followerUserId, followedUserId)
      .run();
  }

  async listFollowers(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<ProfileFollowConnectionPage> {
    const [countRow, rows] = await Promise.all([
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM user_follows WHERE followed_user_id = ?`)
        .bind(userId)
        .first<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT user.id AS user_id, user.nickname, user.avatar_url, user.country,
                  follow.created_at AS followed_at
             FROM user_follows follow
             JOIN users user ON user.id = follow.follower_user_id
            WHERE follow.followed_user_id = ?
            ORDER BY follow.created_at DESC, follow.follower_user_id DESC
            LIMIT ? OFFSET ?`,
        )
        .bind(userId, pageSize, (page - 1) * pageSize)
        .all<FollowConnectionRow>(),
    ]);
    return {
      items: rows.results.map(mapConnection),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    };
  }

  async listFollowing(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<ProfileFollowConnectionPage> {
    const [countRow, rows] = await Promise.all([
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM user_follows WHERE follower_user_id = ?`)
        .bind(userId)
        .first<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT user.id AS user_id, user.nickname, user.avatar_url, user.country,
                  follow.created_at AS followed_at
             FROM user_follows follow
             JOIN users user ON user.id = follow.followed_user_id
            WHERE follow.follower_user_id = ?
            ORDER BY follow.created_at DESC, follow.followed_user_id DESC
            LIMIT ? OFFSET ?`,
        )
        .bind(userId, pageSize, (page - 1) * pageSize)
        .all<FollowConnectionRow>(),
    ]);
    return {
      items: rows.results.map(mapConnection),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    };
  }
}
