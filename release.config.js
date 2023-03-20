// sequential number 100
module.exports = {
  "dryRun": false,
  "branches": ["main", "development"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      {
        "changelogFile": "docs/CHANGELOG.md"
      }
    ],
    // "@semantic-release/npm",
    // "@semantic-release/github",
    [
      "@semantic-release/git",
      {
        "assets": [
          "docs/CHANGELOG.md",
          "package.json",
          "package-lock.json"
        ],
        "message": "chore(release): update changelogs for ${nextRelease.version} [skip release][skip ci]"
      }
    ]
  ]
};
