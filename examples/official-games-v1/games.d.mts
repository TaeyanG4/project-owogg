export interface OfficialV1GameSource {
  readonly slug: string;
  readonly artifactVersion: number;
  readonly files: readonly string[];
}

export const officialV1Games: readonly OfficialV1GameSource[];
