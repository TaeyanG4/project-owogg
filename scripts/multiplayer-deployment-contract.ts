type Environment = Record<string, string | undefined>;

export interface MultiplayerDeploymentEnvironmentOptions {
  deploymentLabel: "Staging" | "Production";
  variablePrefix: "STAGING_" | "PRODUCTION_";
}

function required(env: Environment, name: string, errors: string[]): string {
  const value = env[name]?.trim() ?? "";
  if (!value) errors.push(`${name} is required`);
  return value;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Validate GitHub-facing multiplayer configuration before a deployment can mutate D1 or a
 * Worker. GitHub names remain deployment-prefixed; the workflows map them to the Worker's
 * environment-neutral MULTIPLAYER_* bindings only after this contract succeeds.
 */
export function validateMultiplayerDeploymentEnvironment(
  env: Environment,
  options: MultiplayerDeploymentEnvironmentOptions,
): string[] {
  const errors: string[] = [];
  const { deploymentLabel, variablePrefix } = options;
  const enabledName = `${variablePrefix}MULTIPLAYER_ENABLED`;
  const activeKeyIdName = `${variablePrefix}MULTIPLAYER_TICKET_KEY_ID`;
  const activeSecretName = `${variablePrefix}MULTIPLAYER_TICKET_SECRET`;
  const previousKeyIdName = `${variablePrefix}MULTIPLAYER_TICKET_PREVIOUS_KEY_ID`;
  const previousSecretName = `${variablePrefix}MULTIPLAYER_TICKET_PREVIOUS_SECRET`;
  const requiredKeyIdPrefix = `${deploymentLabel.toLowerCase()}_`;

  const enabled = required(env, enabledName, errors);
  const activeKeyId = required(env, activeKeyIdName, errors);
  const activeSecret = required(env, activeSecretName, errors);

  if (enabled && !["true", "false"].includes(enabled)) {
    errors.push(`${enabledName} must be true or false`);
  }
  if (env[enabledName] !== undefined && env[enabledName] !== enabled) {
    errors.push(`${enabledName} must not have surrounding whitespace`);
  }
  if (activeKeyId && !/^[A-Za-z0-9_-]{1,32}$/.test(activeKeyId)) {
    errors.push(`${activeKeyIdName} must be 1-32 URL-safe characters`);
  }
  if (activeKeyId && !activeKeyId.startsWith(requiredKeyIdPrefix)) {
    errors.push(`${activeKeyIdName} must start with ${requiredKeyIdPrefix}`);
  }
  if (env[activeKeyIdName] !== undefined && env[activeKeyIdName] !== activeKeyId) {
    errors.push(`${activeKeyIdName} must not have surrounding whitespace`);
  }
  if (env[activeSecretName] !== undefined && env[activeSecretName] !== activeSecret) {
    errors.push(`${activeSecretName} must not have surrounding whitespace`);
  }
  if (activeSecret && utf8Length(activeSecret) < 32) {
    errors.push(`${activeSecretName} must be at least 32 UTF-8 bytes`);
  }

  const previousKeyId = env[previousKeyIdName]?.trim() ?? "";
  const previousSecret = env[previousSecretName]?.trim() ?? "";
  if (Boolean(previousKeyId) !== Boolean(previousSecret)) {
    errors.push(`${previousKeyIdName} and ${previousSecretName} must be configured together`);
  }
  if (previousKeyId && !/^[A-Za-z0-9_-]{1,32}$/.test(previousKeyId)) {
    errors.push(`${previousKeyIdName} must be 1-32 URL-safe characters`);
  }
  if (previousKeyId && !previousKeyId.startsWith(requiredKeyIdPrefix)) {
    errors.push(`${previousKeyIdName} must start with ${requiredKeyIdPrefix}`);
  }
  if (env[previousKeyIdName] !== undefined && env[previousKeyIdName] !== previousKeyId) {
    errors.push(`${previousKeyIdName} must not have surrounding whitespace`);
  }
  if (previousSecret && env[previousSecretName] !== previousSecret) {
    errors.push(`${previousSecretName} must not have surrounding whitespace`);
  }
  if (previousSecret && utf8Length(previousSecret) < 32) {
    errors.push(`${previousSecretName} must be at least 32 UTF-8 bytes`);
  }
  if (previousKeyId && previousKeyId === activeKeyId) {
    errors.push(`${deploymentLabel} active and previous multiplayer ticket key IDs must differ`);
  }

  return errors;
}
