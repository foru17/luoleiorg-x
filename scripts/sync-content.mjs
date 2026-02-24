import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const legacyRoot = path.resolve(projectRoot, "../luoleiorg/docs");
const targetRoot = path.resolve(projectRoot, "content/posts");
const legacyPublicRoot = path.resolve(projectRoot, "../luoleiorg/docs/public");
const targetPublicLegacyRoot = path.resolve(projectRoot, "public/legacy");
const legacyIconsRoot = path.resolve(
  projectRoot,
  "../luoleiorg/docs/.vitepress/theme/icons",
);
const targetIconsRoot = path.resolve(projectRoot, "public/icons");

if (!fs.existsSync(legacyRoot)) {
  console.error(`Legacy docs directory not found: ${legacyRoot}`);
  process.exit(1);
}

fs.mkdirSync(targetRoot, { recursive: true });
fs.mkdirSync(targetPublicLegacyRoot, { recursive: true });
fs.mkdirSync(targetIconsRoot, { recursive: true });

const entries = fs.readdirSync(legacyRoot, { withFileTypes: true });
let copied = 0;

for (const entry of entries) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith(".md")) continue;
  if (entry.name === "index.md") continue;

  const source = path.join(legacyRoot, entry.name);
  const target = path.join(targetRoot, entry.name);
  fs.copyFileSync(source, target);
  copied += 1;
}

console.log(`Synced ${copied} markdown files to ${targetRoot}`);

let copiedPublic = 0;
if (fs.existsSync(legacyPublicRoot)) {
  const publicEntries = fs.readdirSync(legacyPublicRoot, {
    withFileTypes: true,
  });
  for (const entry of publicEntries) {
    const source = path.join(legacyPublicRoot, entry.name);
    const target = path.join(targetPublicLegacyRoot, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(source, target, { recursive: true });
    } else {
      fs.copyFileSync(source, target);
    }
    copiedPublic += 1;
  }
}

let copiedIcons = 0;
if (fs.existsSync(legacyIconsRoot)) {
  const iconEntries = fs.readdirSync(legacyIconsRoot, { withFileTypes: true });
  for (const entry of iconEntries) {
    if (!entry.isFile()) continue;
    const source = path.join(legacyIconsRoot, entry.name);
    const target = path.join(targetIconsRoot, entry.name);
    fs.copyFileSync(source, target);
    copiedIcons += 1;
  }
}

console.log(
  `Synced ${copiedPublic} public assets to ${targetPublicLegacyRoot}`,
);
console.log(`Synced ${copiedIcons} icon assets to ${targetIconsRoot}`);
