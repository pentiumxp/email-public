param(
  [string]$WorkspacePath = "C:\Users\xuxin\Documents\email"
)

$ErrorActionPreference = "Stop"

$workspace = Resolve-Path -LiteralPath $WorkspacePath
$out = Join-Path $workspace "runtime\email-service.out.log"
$err = Join-Path $workspace "runtime\email-service.err.log"
New-Item -ItemType Directory -Force -Path (Join-Path $workspace "runtime") | Out-Null

$existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -like "*scripts/email-service.ts*" -and
    $_.Name -eq "node.exe"
  }

if ($existing) {
  "Email service already running: $($existing.ProcessId -join ', ')"
  exit 0
}

Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "service") `
  -WorkingDirectory $workspace `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -WindowStyle Hidden

"Email service start requested. Logs: $out ; $err"
