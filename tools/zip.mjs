// Zip a folder (with the folder itself as the top entry) through tools/zip-directory.ps1: Windows PowerShell's .NET
// ZipArchive, with "/" separators. Used by the release package and the source archive.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "zip-directory.ps1");

export function zipDirectory(sourceDirectory, destinationPath) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-SourceDirectory",
      sourceDirectory,
      "-DestinationPath",
      destinationPath,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`ZIP creation failed:\n${result.stdout}${result.stderr}`);
  if (!existsSync(destinationPath)) throw new Error(`ZIP output is missing: ${destinationPath}`);
  return destinationPath;
}
