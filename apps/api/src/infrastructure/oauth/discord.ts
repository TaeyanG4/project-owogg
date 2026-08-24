import { hasGuildManagementPermission } from "@owogg/core";

export interface DiscordUserProfile {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface DiscordUserGuildRaw {
  id: string;
  name: string;
  icon: string | null;
  owner?: boolean;
  permissions?: string;
}

export function buildDiscordAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const discordUrl = new URL("https://discord.com/oauth2/authorize");
  discordUrl.searchParams.set("client_id", params.clientId);
  discordUrl.searchParams.set("redirect_uri", params.redirectUri);
  discordUrl.searchParams.set("response_type", "code");
  discordUrl.searchParams.set("scope", params.scope || "identify email");
  discordUrl.searchParams.set("state", params.state);
  return discordUrl.toString();
}

export async function exchangeDiscordCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{
  valid: boolean;
  profile?: DiscordUserProfile;
  accessToken?: string;
  reason?: string;
}> {
  try {
    const tokenParams = new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
    });

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      return { valid: false, reason: "Failed to exchange code for token" };
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return { valid: false, reason: "Invalid token response from Discord" };
    }

    const accessToken = tokenData.access_token;

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return { valid: false, reason: "Failed to fetch Discord user info" };
    }

    const userInfo = (await userRes.json()) as {
      id: string;
      username: string;
      email?: string;
      avatar?: string;
    };

    const defaultAvatarIndex = Number((BigInt(userInfo.id) >> 22n) % 6n);
    const avatarUrl = userInfo.avatar
      ? `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;

    return {
      valid: true,
      accessToken,
      profile: {
        id: userInfo.id,
        username: userInfo.username,
        email: userInfo.email ?? null,
        avatarUrl,
      },
    };
  } catch (err) {
    console.error("Discord OAuth exchange failed:", err instanceof Error ? err.name : "unknown");
    return {
      valid: false,
      reason: "Discord auth exchange failed",
    };
  }
}

export async function fetchUserManageableGuilds(accessToken: string): Promise<{
  valid: boolean;
  guilds?: { guildId: string; name: string; iconUrl: string | null }[];
  reason?: string;
}> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      return { valid: false, reason: `Discord API returned status ${res.status}` };
    }

    const rawGuilds = (await res.json()) as DiscordUserGuildRaw[];
    if (!Array.isArray(rawGuilds)) {
      return { valid: false, reason: "Invalid response array from Discord guilds API" };
    }

    const manageable = rawGuilds
      .filter((g) => hasGuildManagementPermission(g.permissions, g.owner))
      .map((g) => ({
        guildId: g.id,
        name: g.name,
        iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
      }));

    return { valid: true, guilds: manageable };
  } catch (err) {
    console.error("Discord guild lookup failed:", err instanceof Error ? err.name : "unknown");
    return {
      valid: false,
      reason: "Failed to fetch user guilds",
    };
  }
}
