[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,

    [Parameter(Mandatory = $true)]
    [string]$DestinationPath
)

$sourceItem = Get-Item -LiteralPath $SourceDirectory -ErrorAction Stop
if (-not $sourceItem.PSIsContainer) {
    throw "ZIP source is not a directory: $SourceDirectory"
}

$destinationFull = [System.IO.Path]::GetFullPath($DestinationPath)
if ([System.IO.Path]::GetExtension($destinationFull) -ne '.zip') {
    throw "ZIP destination must end with .zip: $destinationFull"
}
if (Test-Path -LiteralPath $destinationFull) {
    throw "Refusing to overwrite existing ZIP: $destinationFull"
}

$destinationDirectory = Split-Path -Parent $destinationFull
New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
# Entries are written one by one with "/" separators, the ZIP standard: Compress-Archive of Windows PowerShell 5.1
# stores "\", which other unzip tools take as part of the file name. The top folder is kept, as before.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$base = Split-Path -Parent $sourceItem.FullName
$zip = [System.IO.Compression.ZipFile]::Open($destinationFull, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -LiteralPath $sourceItem.FullName -Recurse -File | Sort-Object FullName | ForEach-Object {
        $name = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $_.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
}
finally {
    $zip.Dispose()
}

if (-not (Test-Path -LiteralPath $destinationFull -PathType Leaf)) {
    throw "ZIP creation did not produce an output: $destinationFull"
}

Write-Output $destinationFull
