export const SECURE_STREAMER_OAUTH_PROVIDERS = ["YOUTUBE", "TWITCH", "CHZZK"] as const;

export type SecureStreamerOAuthProvider = (typeof SECURE_STREAMER_OAUTH_PROVIDERS)[number];

type Environment = Record<string, string | undefined>;

export interface StreamerOAuthEnvironmentOptions {
  deploymentLabel: "Staging" | "Production";
  apiUrl: string;
  variablePrefix: "STAGING_" | "PRODUCTION_";
}

const CALLBACK_PATHS: Record<SecureStreamerOAuthProvider, string> = {
  YOUTUBE: "/api/streamers/verify/youtube/callback",
  TWITCH: "/api/streamers/verify/twitch/callback",
  CHZZK: "/api/streamers/verify/chzzk/callback",
};

function required(env: Environment, name: string, errors: string[]): string {
  const value = env[name]?.trim() ?? "";
  if (!value) errors.push(`${name} is required`);
  return value;
}

/**
 * Validate the GitHub Environment-facing Streamer OAuth configuration before any deployment
 * mutation. GitHub names stay environment-prefixed and are mapped to the Worker's generic
 * bindings only after this contract succeeds.
 */
export function validateStreamerOAuthEnvironment(
  env: Environment,
  options: StreamerOAuthEnvironmentOptions,
): string[] {
  const errors: string[] = [];
  const { deploymentLabel, apiUrl, variablePrefix } = options;
  const enabledName = `${variablePrefix}STREAMER_ENABLED_PROVIDERS`;
  const enabledRaw = required(env, enabledName, errors);
  if (!enabledRaw) return errors;

  const entries = enabledRaw.split(",").map((entry) => entry.trim().toUpperCase());
  if (entries.some((entry) => !entry)) {
    errors.push(`${enabledName} must not contain empty entries`);
  }

  const enabled = new Set<SecureStreamerOAuthProvider>();
  for (const entry of entries) {
    if (entry === "SOOP") {
      errors.push(
        `SOOP must not be enabled in ${deploymentLabel} until its OAuth callback supports secure request binding`,
      );
      continue;
    }
    if (!(SECURE_STREAMER_OAUTH_PROVIDERS as readonly string[]).includes(entry)) {
      if (entry) {
        errors.push(
          `Unsupported ${deploymentLabel} Streamer provider ${entry}; allowed values are ${SECURE_STREAMER_OAUTH_PROVIDERS.join(", ")}`,
        );
      }
      continue;
    }
    const provider = entry as SecureStreamerOAuthProvider;
    if (enabled.has(provider)) {
      errors.push(`${enabledName} contains duplicate ${provider}`);
    }
    enabled.add(provider);
  }

  for (const provider of enabled) {
    const clientIdName = `${variablePrefix}${provider}_CLIENT_ID`;
    const clientSecretName = `${variablePrefix}${provider}_CLIENT_SECRET`;
    const redirectUriName = `${variablePrefix}${provider}_REDIRECT_URI`;
    const clientId = required(env, clientIdName, errors);
    const clientSecret = required(env, clientSecretName, errors);
    const redirectUri = required(env, redirectUriName, errors);

    for (const [name, value] of [
      [clientIdName, clientId],
      [clientSecretName, clientSecret],
      [redirectUriName, redirectUri],
    ] as const) {
      if (env[name] !== undefined && env[name] !== value) {
        errors.push(`${name} must not have surrounding whitespace`);
      }
    }

    const expectedRedirectUri = `${apiUrl}${CALLBACK_PATHS[provider]}`;
    if (redirectUri && redirectUri !== expectedRedirectUri) {
      errors.push(`${redirectUriName} must equal ${expectedRedirectUri}`);
    }

    if (provider === "YOUTUBE") {
      const apiKeyName = `${variablePrefix}YOUTUBE_API_KEY`;
      const apiKey = required(env, apiKeyName, errors);
      if (env[apiKeyName] !== undefined && env[apiKeyName] !== apiKey) {
        errors.push(`${apiKeyName} must not have surrounding whitespace`);
      }
    }
  }

  for (const provider of SECURE_STREAMER_OAUTH_PROVIDERS) {
    if (enabled.has(provider)) continue;
    const disabledNames = [
      `${variablePrefix}${provider}_CLIENT_ID`,
      `${variablePrefix}${provider}_CLIENT_SECRET`,
      `${variablePrefix}${provider}_REDIRECT_URI`,
      ...(provider === "YOUTUBE" ? [`${variablePrefix}YOUTUBE_API_KEY`] : []),
    ];
    for (const name of disabledNames) {
      if (env[name]?.trim()) {
        errors.push(`${name} must be empty unless ${provider} is listed in ${enabledName}`);
      }
    }
  }

  return errors;
}
