import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { savedProject } from "../src/editorBlock.ts";
import { createSourceArchive, zipDirectory } from "./source-package.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageInfo = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageInfo.version;
const releaseRoot = join(root, "release");
const releaseName = `AnimationInjectorEditor-${version}`;
const output = join(releaseRoot, releaseName);
const binaryArchive = join(releaseRoot, `${releaseName}-windows-x64.zip`);
const sourceArchive = join(releaseRoot, `${releaseName}-source.zip`);
const releaseChecksums = join(releaseRoot, `${releaseName}-SHA256SUMS.txt`);
const stageOutput = output;

// Every file in examples/ ships; tests/examples-open.test.mjs opens each one the way File > Open does.
const EXAMPLES = readdirSync(join(root, "examples"))
  .filter((name) => /\.(?:xml|aitemplate)$/i.test(name))
  .sort();
const RELEASE_DOCUMENTS = [
  "docs/P6-마감.md",
  "docs/p6-verification/ui-results.json",
  "docs/p6-verification/ko-workspace.png",
  "docs/p6-verification/en-workspace.png",
  "docs/p6-verification/ja-workspace.png",
  "docs/p6-verification/zh-workspace.png",
  "docs/p6-verification/ko-export-1080.png",
  "docs/P5-뷰어.md",
  "docs/p5-verification/native-results.md",
  "docs/p5-verification/ui-results.json",
  "docs/p5-verification/approved-screenshots.json",
];

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isInside(parent, candidate) {
  const local = relative(parent, candidate);
  return local !== "" && !local.startsWith(`..${sep}`) && local !== ".." && !isAbsolute(local);
}

function safeRemoveGenerated(path) {
  if (!existsSync(path)) return;
  if (!isInside(releaseRoot, path)) throw new Error(`unsafe generated cleanup path: ${path}`);
  rmSync(path, { recursive: true, force: true });
}

function copyRelative(relativePath) {
  const source = join(root, relativePath);
  const destination = join(stageOutput, relativePath);
  if (!existsSync(source)) throw new Error(`required package file is missing: ${relativePath}`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function verifyVersion() {
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  if (tauri.version !== version) {
    throw new Error(`version mismatch: package.json=${version}, tauri.conf.json=${tauri.version}`);
  }
  for (const readme of ["README.ko.md", "README.en.md", "README.ja.md", "README.zh.md"]) {
    const heading = readFileSync(join(root, readme), "utf8").split(/\r?\n/, 1)[0];
    if (!heading.includes(`· ${version}`)) throw new Error(`version heading mismatch: ${readme}`);
  }
}

function verifyPortableExamples() {
  const absolutePathPattern = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/;
  for (const file of EXAMPLES.filter((name) => /\.(?:xml|aitemplate)$/i.test(name))) {
    // A template is JSON; an XML the editor saved holds its project in the editor's block (a plain one holds none).
    const text = readFileSync(join(root, "examples", file), "utf8");
    const json = file.endsWith(".xml") ? savedProject(text).project : text;
    if (!json) continue;
    const values = [JSON.parse(json)];
    let containsAbsolutePath = false;
    while (values.length > 0) {
      const value = values.pop();
      if (typeof value === "string") containsAbsolutePath ||= absolutePathPattern.test(value);
      else if (Array.isArray(value)) values.push(...value);
      else if (value && typeof value === "object") values.push(...Object.values(value));
    }
    if (containsAbsolutePath) throw new Error(`release example contains a local absolute path: ${file}`);
  }
}

function copyApprovedScreenshots() {
  const manifestRelative = "docs/p5-verification/approved-screenshots.json";
  const manifest = JSON.parse(readFileSync(join(root, manifestRelative), "utf8"));
  if (!Array.isArray(manifest.files)) throw new Error(`${manifestRelative} must contain a files array`);

  const seen = new Set();
  for (const value of manifest.files) {
    if (typeof value !== "string") throw new Error("approved screenshot entries must be strings");
    const normalized = value.replaceAll("\\", "/");
    if (
      seen.has(normalized) ||
      !normalized.startsWith("docs/p5-verification/") ||
      normalized.includes("../") ||
      !new Set([".jpg", ".jpeg", ".png", ".webp"]).has(extname(normalized).toLowerCase())
    ) {
      throw new Error(`invalid or duplicate approved screenshot path: ${value}`);
    }
    seen.add(normalized);
    copyRelative(normalized);
  }
}

function buildThirdPartyNotices() {
  const notices = [
    `Animation Injector Editor ${version} — third-party notices`,
    "Generated from the locked local dependency sources.",
    "",
  ];
  const collected = new Set();

  function appendText(path, label) {
    const key = `${label}\0${path}`;
    if (collected.has(key)) return;
    collected.add(key);
    notices.push("=".repeat(72), label, readFileSync(path, "utf8"), "");
  }

  function collect(directory, label) {
    if (!existsSync(directory)) return 0;
    const licenseFiles = readdirSync(directory)
      .filter(
        (file) =>
          /^(licen[cs]e|copying|notice|copyright)([.-]|$)/i.test(file) &&
          statSync(join(directory, file)).isFile(),
      )
      .sort();
    for (const file of licenseFiles) appendText(join(directory, file), `${label} / ${file}`);
    return licenseFiles.length;
  }

  appendText(join(root, "THIRD_PARTY.md"), "Project third-party and porting notice");
  appendText(join(root, "src-tauri", "assets", "PORTING_SOURCE.md"), "P5 modified port source notice");
  appendText(
    join(root, "src-tauri", "assets", "HKX_VIEWER_LICENSE_GPL-3.0.txt"),
    "HKX_Viewer and HavokLib port license / GPLv3",
  );
  collect(
    join(root, "vendor", "serde-hkx"),
    "serde-hkx e8bc1abc015d42567e6b7e7bb3e99447370f306a (MIT OR Apache-2.0)",
  );

  const modules = join(root, "node_modules");
  if (!existsSync(modules)) throw new Error("node_modules is missing; run npm ci before packaging");
  for (const name of readdirSync(modules).filter((entry) => !entry.startsWith(".")).sort()) {
    const directories = name.startsWith("@")
      ? readdirSync(join(modules, name))
          .sort()
          .map((entry) => join(name, entry))
      : [name];
    for (const directory of directories) {
      const manifestPath = join(modules, directory, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      collect(join(modules, directory), `${manifest.name} ${manifest.version} (${manifest.license ?? "see source"})`);
    }
  }

  const registryRoot = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry", "src");
  if (existsSync(registryRoot)) {
    const registries = readdirSync(registryRoot)
      .sort()
      .map((directory) => join(registryRoot, directory));
    const cargoLock = readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8");
    for (const match of cargoLock.matchAll(/\[\[package\]\]\s+name = "([^"]+)"\s+version = "([^"]+)"/g)) {
      for (const registry of registries) collect(join(registry, `${match[1]}-${match[2]}`), `${match[1]} ${match[2]}`);
    }
  }

  writeFileSync(join(stageOutput, "THIRD_PARTY_NOTICES.txt"), notices.join("\n"));
}

function listFiles(directory, outputFiles = []) {
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) listFiles(path, outputFiles);
    else outputFiles.push(path);
  }
  return outputFiles;
}

function verifyReleaseContents() {
  for (const file of listFiles(stageOutput)) {
    const local = relative(stageOutput, file).split(sep).join("/");
    const extension = extname(local).toLowerCase();
    if (extension === ".hkx" || extension === ".glb") {
      throw new Error(`private viewer asset entered release output: ${local}`);
    }
    if (
      local.includes("native-pair-response.json") ||
      local.includes("ui-viewer-fixture.json") ||
      local.includes("ui-regression-run/")
    ) {
      throw new Error(`local or decoded verification artifact entered release output: ${local}`);
    }
  }
}

function writeOutputChecksums() {
  const checksums = [];
  for (const file of listFiles(stageOutput)) {
    if (basename(file) === "SHA256SUMS.txt") continue;
    checksums.push(`${hashFile(file)}  ${relative(stageOutput, file).split(sep).join("/")}`);
  }
  writeFileSync(join(stageOutput, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
}

function main() {
  verifyVersion();
  verifyPortableExamples();
  for (const path of [output, binaryArchive, sourceArchive, releaseChecksums]) {
    if (existsSync(path)) throw new Error(`refusing to overwrite existing release output: ${path}`);
  }
  const executable = join(root, "src-tauri", "target", "release", "animation-injector-editor.exe");
  if (!existsSync(executable)) throw new Error(`release executable is missing: ${executable}`);
  // Runtime XML checker: the plugin's own parser, required beside the editor for export validation.
  const checker = resolve(root, "..", "AnimationInjector", "build", "Release", "AnimationInjectorXmlCheck.exe");
  if (!existsSync(checker)) throw new Error(`runtime XML checker is missing: ${checker} (build AnimationInjectorXmlCheck)`);

  mkdirSync(stageOutput, { recursive: true });
  let createdSourceArchive = false;
  let createdBinaryArchive = false;
  try {
    createSourceArchive({ quiet: true });
    createdSourceArchive = true;

    copyFileSync(executable, join(stageOutput, "AnimationInjectorEditor.exe"));
    copyFileSync(checker, join(stageOutput, "AnimationInjectorXmlCheck.exe"));
    for (const file of ["LICENSE", "README.en.md", "README.ko.md", "README.ja.md", "README.zh.md", "THIRD_PARTY.md"]) copyRelative(file);
    for (const file of EXAMPLES) copyRelative(`examples/${file}`);
    for (const file of RELEASE_DOCUMENTS) copyRelative(file);
    copyApprovedScreenshots();

    mkdirSync(join(stageOutput, "source"), { recursive: true });
    copyFileSync(sourceArchive, join(stageOutput, "source", basename(sourceArchive)));
    buildThirdPartyNotices();
    verifyReleaseContents();
    writeOutputChecksums();

    zipDirectory(output, binaryArchive);
    createdBinaryArchive = true;

    const lines = [
      `${hashFile(binaryArchive)}  ${basename(binaryArchive)}`,
      `${hashFile(sourceArchive)}  ${basename(sourceArchive)}`,
    ];
    writeFileSync(releaseChecksums, `${lines.join("\n")}\n`);

    console.log(output);
    console.log(binaryArchive);
    console.log(sourceArchive);
    console.log(lines.join("\n"));
    console.log(`${hashFile(join(output, "AnimationInjectorEditor.exe"))}  AnimationInjectorEditor.exe`);
  } catch (error) {
    if (existsSync(output)) safeRemoveGenerated(output);
    if (createdBinaryArchive || existsSync(binaryArchive)) safeRemoveGenerated(binaryArchive);
    if (createdSourceArchive || existsSync(sourceArchive)) safeRemoveGenerated(sourceArchive);
    if (existsSync(releaseChecksums)) safeRemoveGenerated(releaseChecksums);
    throw error;
  }

}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
