export const officialV1Games = Object.freeze([
  Object.freeze({
    slug: "official-omok",
    artifactVersion: "1.0.8",
    files: Object.freeze([
      "index.html",
      "style.css",
      "rules.js",
      "game.js",
      "owogg.json",
      "owogg.logo.svg",
      "description.md",
      "description_kr.md",
      "description_ja.md",
      "description_zh.md",
    ]),
  }),
  ...[
    ["reaction-time", "1.0.1"],
    ["aim-test", "1.0.2"],
    ["typing-test", "1.0.3"],
    ["memory-test", "1.0.5"],
  ].map(([slug, artifactVersion]) =>
    Object.freeze({
      slug,
      artifactVersion,
      files: Object.freeze([
        "index.html",
        "style.css",
        "rules.js",
        "game.js",
        "owogg.json",
        "owogg.logo.svg",
        "description.md",
        "description_kr.md",
        "description_ja.md",
        "description_zh.md",
      ]),
    }),
  ),
]);
