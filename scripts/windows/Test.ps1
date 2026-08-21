cd D:\Isphere\Wisibility_IGA
 
$OutDir = ".\installer\payload"
$hasher = [System.Security.Cryptography.SHA256]::Create()
$files = Get-ChildItem -Path $OutDir -Recurse -File | ForEach-Object {
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  $hash = ($hasher.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
  [PSCustomObject]@{
    path = $_.FullName.Substring((Resolve-Path $OutDir).Path.Length).TrimStart('\','/')
    sha256 = $hash
    size = $_.Length
  }
}
$manifestHashInput = ($files | Sort-Object path | ForEach-Object { $_.path + ":" + $_.sha256 }) -join "`n"
$manifestSha = ($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifestHashInput)) | ForEach-Object { $_.ToString("x2") }) -join ""
 
@{
  productVersion = "1.0.0"
  schemaVersion = 1
  nodeVersion = (node -v)
  mongoVersion = "8.x"
  sha256 = $manifestSha
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  gitCommit = (git rev-parse HEAD 2>$null)
  branch = (git rev-parse --abbrev-ref HEAD 2>$null)
  buildMachine = $env:COMPUTERNAME
  files = $files
} | ConvertTo-Json -Depth 6 | Set-Content "$OutDir\payload-manifest.json" -Encoding UTF8
 
Test-Path .\installer\payload\payload-manifest.json