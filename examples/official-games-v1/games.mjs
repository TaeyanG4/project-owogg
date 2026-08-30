export const officialV1Games = Object.freeze([
  Object.freeze({
    slug: "official-omok",
    artifactVersion: 1,
    files: Object.freeze([
      "index.html",
      "style.css",
      "rules.js",
      "game.js",
      "owogg.json",
      "owogg.logo.svg",
    ]),
  }),
  ...["reaction-time", "aim-test", "typing-test", "memory-test"].map((slug) =>
    Object.freeze({
      slug,
      artifactVersion: 1,
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
