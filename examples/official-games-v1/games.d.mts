export interface OfficialV1GameSource {
  readonly slug: string;
  readonly files: readonly string[];
}

export const officialV1Games: readonly OfficialV1GameSource[];
