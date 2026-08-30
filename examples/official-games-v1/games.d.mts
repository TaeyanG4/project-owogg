export interface OfficialV1GameSource {
  readonly slug: string;
  /** Immutable ZIP artifact version in SemVer form, without the leading `v`. */
  readonly artifactVersion: `${number}.${number}.${number}`;
  readonly files: readonly string[];
}

export const officialV1Games: readonly OfficialV1GameSource[];
