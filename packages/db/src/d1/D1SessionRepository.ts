import type { Session, SessionRepository, User } from "@owogg/core";
import { nextStreakState, todayServiceDateString } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

export async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class D1SessionRepository implements SessionRepository {
  constructor(private db: D1Database) {}

  private async querySessionRow(sessionId: string): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT s.id as session_id, s.user_id, s.created_at as session_created_at, s.expires_at,
                u.id as user_id, u.nickname, u.email, u.avatar_url, u.avatar_provider,
                u.created_at as user_created_at, u.updated_at,
                u.country, u.nickname_updated_at, u.country_updated_at, u.locale,
                u.current_streak, u.longest_streak, u.last_active_date,
                m.status as moderation_status, m.suspended_until, m.score_submission_blocked
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN user_moderation m ON m.user_id = u.id
         WHERE s.id = ?`,
      )
      .bind(sessionId)
      .first<Record<string, unknown>>();

    return row || null;
  }

  /** True if this session's user must be treated as logged out — a BANNED user, or a
   * currently-SUSPENDED one (an expired suspension no longer blocks; see migration 0023's
   * comment on `suspended_until`). Independent of `score_submission_blocked`, which still lets
   * the user through here and is enforced separately by the scores route. */
  private isLoginBlocked(row: Record<string, unknown>): boolean {
    const status = row.moderation_status ? String(row.moderation_status) : "ACTIVE";
    if (status === "BANNED") return true;
    if (status === "SUSPENDED") {
      const until = row.suspended_until ? String(row.suspended_until) : null;
      return !until || until > new Date().toISOString();
    }
    return false;
  }

  async createSession(userId: number, ttlDays = 30): Promise<Session> {
    const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const hashedToken = await hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    await this.db
      .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .bind(hashedToken, userId, createdAt, expiresAt)
      .run();

    return {
      id: rawToken,
      user_id: userId,
      created_at: createdAt,
      expires_at: expiresAt,
    };
  }

  async findSession(rawToken: string): Promise<{ session: Session; user: User } | null> {
    if (!rawToken || typeof rawToken !== "string") return null;

    const hashedToken = await hashSessionToken(rawToken);

    // 1. Try hashed token lookup
    let row = await this.querySessionRow(hashedToken);
    let isLegacy = false;

    // 2. Legacy raw token fallback lookup
    if (!row) {
      row = await this.querySessionRow(rawToken);
      if (row) {
        isLegacy = true;
      }
    }

    if (!row) return null;

    const now = new Date().toISOString();
    if (String(row.expires_at) < now) {
      await this.db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(String(row.session_id)).run();
      return null;
    }

    // BANNED/currently-SUSPENDED users are treated as logged out everywhere — this is the one
    // choke point every authenticated request passes through (requireAuth in routes/auth.ts and
    // the scores route both call findSession directly), so this single check is sufficient to
    // block login app-wide without touching every route individually. The session row itself is
    // deliberately left alone here (not deleted) — a suspension is expected to end and the
    // session to become valid again; an admin ban/suspend proactively revokes sessions at
    // action time (see UserModerationUseCases.suspendUser/banUser), this is just defense in
    // depth for a session created in the gap between the action and this read.
    if (this.isLoginBlocked(row)) return null;

    // 3. Migrate legacy raw row to hashed token
    if (isLegacy) {
      try {
        await this.db
          .prepare(`UPDATE sessions SET id = ? WHERE id = ?`)
          .bind(hashedToken, rawToken)
          .run();
      } catch {
        // Ignore migration error if row was modified concurrently
      }
    }

    const userId = Number(row.user_id);
    const providersRes = await this.db
      .prepare(`SELECT provider FROM oauth_accounts WHERE user_id = ?`)
      .bind(userId)
      .all<{ provider: string }>();

    const providers = (providersRes.results || []).map((r) => r.provider);

    // Lazily advance the "consecutive active days" streak. Same-day repeat requests
    // (the overwhelming majority of calls through this method) are a pure no-op — only
    // the first authenticated request of a new UTC day writes anything.
    const streakUpdate = nextStreakState(
      {
        currentStreak: Number(row.current_streak ?? 0),
        longestStreak: Number(row.longest_streak ?? 0),
        lastActiveDate: row.last_active_date ? String(row.last_active_date) : null,
      },
      todayServiceDateString(),
    );
    if (streakUpdate.changed) {
      try {
        await this.db
          .prepare(
            `UPDATE users SET current_streak = ?, longest_streak = ?, last_active_date = ? WHERE id = ?`,
          )
          .bind(
            streakUpdate.currentStreak,
            streakUpdate.longestStreak,
            streakUpdate.lastActiveDate,
            userId,
          )
          .run();
      } catch {
        // Non-critical — never fail auth over streak bookkeeping. Falls back to the
        // pre-update values below, retried on the next request.
      }
    }

    return {
      session: {
        id: rawToken,
        user_id: userId,
        created_at: String(row.session_created_at),
        expires_at: String(row.expires_at),
      },
      user: {
        id: userId,
        nickname: String(row.nickname),
        email: row.email ? String(row.email) : null,
        avatar_url: row.avatar_url ? String(row.avatar_url) : null,
        avatar_provider: row.avatar_provider ? String(row.avatar_provider) : null,
        created_at: String(row.user_created_at),
        updated_at: String(row.updated_at),
        providers,
        country: row.country ? String(row.country) : null,
        nickname_updated_at: row.nickname_updated_at ? String(row.nickname_updated_at) : null,
        country_updated_at: row.country_updated_at ? String(row.country_updated_at) : null,
        locale: row.locale ? String(row.locale) : null,
        current_streak: streakUpdate.changed
          ? streakUpdate.currentStreak
          : Number(row.current_streak ?? 0),
        longest_streak: streakUpdate.changed
          ? streakUpdate.longestStreak
          : Number(row.longest_streak ?? 0),
        last_active_date: streakUpdate.changed
          ? streakUpdate.lastActiveDate
          : row.last_active_date
            ? String(row.last_active_date)
            : null,
        score_submission_blocked: Number(row.score_submission_blocked ?? 0) === 1,
      },
    };
  }

  async deleteSession(rawToken: string): Promise<void> {
    if (!rawToken || typeof rawToken !== "string") return;
    const hashedToken = await hashSessionToken(rawToken);
    await this.db
      .prepare(`DELETE FROM sessions WHERE id = ? OR id = ?`)
      .bind(hashedToken, rawToken)
      .run();
  }

  async deleteAllSessionsForUser(userId: number): Promise<void> {
    await this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
  }
}
