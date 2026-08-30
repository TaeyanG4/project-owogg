export const officialV1Games = Object.freeze([
  Object.freeze({
    slug: "official-omok",
    artifactVersion: "1.0.6",
    files: Object.freeze([
      "index.html",
      "style.css",
      "rules.js",
      "game.js",
      "owogg.json",
      "owogg.logo.svg",
    ]),
  }),
  ...[
    ["reaction-time", "1.0.0"],
    ["aim-test", "1.0.1"],
    ["typing-test", "1.0.0"],
    ["memory-test", "1.0.1"],
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
      ]),
    }),
  ),
]);
