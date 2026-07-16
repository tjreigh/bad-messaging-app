const { createHash } = require("node:crypto");
const {
  cpSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { join, resolve } = require("node:path");

const sourceDirectory = resolve(__dirname, "../web");
const outputDirectory = resolve(__dirname, "../dist/src/public");
const migrationsSourceDirectory = resolve(__dirname, "../database/migrations");
const migrationsOutputDirectory = resolve(__dirname, "../dist/src/migrations");
const serverEntrypoint = resolve(__dirname, "../dist/server.js");

rmSync(outputDirectory, { recursive: true, force: true });
cpSync(sourceDirectory, outputDirectory, { recursive: true });
rmSync(migrationsOutputDirectory, { recursive: true, force: true });
cpSync(migrationsSourceDirectory, migrationsOutputDirectory, { recursive: true });
writeFileSync(
  serverEntrypoint,
  `"use strict";

const { startServer } = require("./src/server.js");

module.exports = { startServer };

if (require.main === module) {
  startServer();
}
`,
);

const indexPath = join(outputDirectory, "index.html");
let indexHtml = readFileSync(indexPath, "utf8");

indexHtml = versionAsset(indexHtml, "style.css", "href");
indexHtml = versionAsset(indexHtml, "index.js", "src");

writeFileSync(indexPath, indexHtml);

function versionAsset(html, fileName, attribute) {
  const assetPath = join(outputDirectory, fileName);
  const version = createHash("sha256")
    .update(readFileSync(assetPath))
    .digest("hex")
    .slice(0, 8);
  const assetReference = new RegExp(
    `${attribute}="/${escapeRegExp(fileName)}(?:\\?v=[^"]*)?"`,
  );
  const versionedReference = `${attribute}="/${fileName}?v=${version}"`;

  if (!assetReference.test(html)) {
    throw new Error(`Could not find ${attribute} reference for ${fileName}`);
  }

  return html.replace(assetReference, versionedReference);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
