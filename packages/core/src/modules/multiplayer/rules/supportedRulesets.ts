import type { ApprovedMultiplayerProfileV1 } from "../domain/multiplayerProfile.js";
import {
  OMOK_RULESET_KEY,
  isOmokResolvedConfigJson,
  isSupportedOmokRulesetRevision,
} from "./omokRules.js";

/**
 * Static server-build allowlist. An approved D1 profile is necessary but never sufficient to
 * execute a ruleset: its exact immutable semantics must also exist in this Worker build.
 */
export function isSupportedMultiplayerRuntimeProfile(
  profile: ApprovedMultiplayerProfileV1,
): boolean {
  if (
    profile.rulesetKey !== OMOK_RULESET_KEY ||
    !isSupportedOmokRulesetRevision(profile.rulesetRevision)
  ) {
    return false;
  }
  return (
    profile.resolvedClass === "M1" &&
    profile.simulationModel === "turn" &&
    profile.lifecycle === "match" &&
    profile.persistence === "match" &&
    profile.reconnectPolicy === "resume" &&
    profile.minPlayers === 2 &&
    profile.maxPlayers === 2 &&
    isOmokResolvedConfigJson(profile.resolvedConfigJson, profile.rulesetRevision)
  );
}
