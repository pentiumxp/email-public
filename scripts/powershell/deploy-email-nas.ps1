param(
  [string]$WorkspacePath = "C:\Users\xuxin\Documents\email",
  [string]$NasHost = "192.168.10.99",
  [int]$NasPort = 2222,
  [string]$NasUser = "xuxinxp",
  [string]$SshKeyPath = "C:\Users\xuxin\.ssh\synology_codex_admin_192_168_10_99_20260507_ed25519",
  [string]$SudoPasswordFile = "C:\Users\xuxin\OneDrive\Desktop\nas.txt",
  [string]$RemoteRoot = "/volume1/docker/email-plugin",
  [switch]$SkipLocalCheck
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([string[]]$GitArgs)
  & git -C $WorkspacePath @GitArgs
  if ($LASTEXITCODE -ne 0) {
    throw "git $($GitArgs -join ' ') failed"
  }
}

function Invoke-Remote {
  param([string]$Command)
  & ssh -p $NasPort -i $SshKeyPath -o BatchMode=yes -o IdentitiesOnly=yes "$NasUser@$NasHost" $Command
  if ($LASTEXITCODE -ne 0) {
    throw "remote command failed"
  }
}

if (!(Test-Path $WorkspacePath)) {
  throw "Workspace not found: $WorkspacePath"
}
if (!(Test-Path $SshKeyPath)) {
  throw "SSH key not found: $SshKeyPath"
}
if (!(Test-Path $SudoPasswordFile)) {
  throw "sudo password file not found: $SudoPasswordFile"
}

$commit = (& git -C $WorkspacePath rev-parse --short HEAD).Trim()
if (!$commit) {
  throw "Could not resolve HEAD"
}

$dirty = (& git -C $WorkspacePath status --porcelain)
if ($dirty) {
  Write-Warning "Working tree is dirty; deploying committed HEAD only: $commit"
}

if (!$SkipLocalCheck) {
  Push-Location $WorkspacePath
  try {
    & npm run check
    if ($LASTEXITCODE -ne 0) {
      throw "npm run check failed"
    }
  } finally {
    Pop-Location
  }
}

$tempDir = Join-Path $env:TEMP "email-deploy-$commit"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$archive = Join-Path $tempDir "email-plugin-$commit.tar"
$b64 = Join-Path $tempDir "email-plugin-$commit.tar.b64"

Invoke-Git -GitArgs @("archive", "--format=tar", "--output=$archive", "HEAD")
$raw = [Convert]::ToBase64String([IO.File]::ReadAllBytes($archive))
$wrapped = ($raw -split "(.{1,76})" | Where-Object { $_ }) -join "`n"
[IO.File]::WriteAllText($b64, $wrapped, [Text.Encoding]::ASCII)

$remoteArchive = "/tmp/email-plugin-$commit.tar"
$decodeCommand = "python3 -c 'import sys,base64,pathlib; data=base64.b64decode(sys.stdin.read()); pathlib.Path(sys.argv[1]).write_bytes(data); print(len(data))' $remoteArchive"
Get-Content $b64 | ssh -p $NasPort -i $SshKeyPath -o BatchMode=yes -o IdentitiesOnly=yes "$NasUser@$NasHost" $decodeCommand
if ($LASTEXITCODE -ne 0) {
  throw "upload failed"
}

$sudoPassword = (Get-Content $SudoPasswordFile -Raw).Trim()
if (!$sudoPassword) {
  throw "sudo password file is empty"
}
$sudoB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sudoPassword))

$remoteScript = @"
set -eu
COMMIT="$commit"
REMOTE_ROOT="$RemoteRoot"
SOURCE_DIR="`$REMOTE_ROOT/source"
RUNTIME_DIR="`$REMOTE_ROOT/runtime"
BACKUP_DIR="`$REMOTE_ROOT/backups/`$COMMIT-`$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$remoteArchive"
DOCKER="/usr/local/bin/docker"
SUDO_PASS=`$(python3 -c 'import base64; print(base64.b64decode("$sudoB64").decode())')

sudo_docker() {
  printf '%s\n' "`$SUDO_PASS" | sudo -S "`$DOCKER" "`$@"
}

mkdir -p "`$SOURCE_DIR" "`$RUNTIME_DIR" "`$BACKUP_DIR"
tar -czf "`$BACKUP_DIR/source-before.tar.gz" -C "`$SOURCE_DIR" . 2>/dev/null || true
find "`$SOURCE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -xf "`$ARCHIVE" -C "`$SOURCE_DIR"
cd "`$SOURCE_DIR"
npm ci --include=dev
npm run check

if sudo_docker image inspect email-plugin:local >/dev/null 2>&1; then
  sudo_docker image tag email-plugin:local "email-plugin:backup-before-`$COMMIT-`$(date +%Y%m%d-%H%M%S)"
fi
sudo_docker build -t email-plugin:local .
if sudo_docker ps -a --format '{{.Names}}' | grep -qx email-plugin; then
  sudo_docker stop email-plugin >/dev/null 2>&1 || true
  sudo_docker rm email-plugin >/dev/null 2>&1 || true
fi
sudo_docker run -d --name email-plugin --network host \
  -v "`$RUNTIME_DIR:/data" \
  -e EMAIL_PLUGIN_RUNTIME_DIR=/data \
  -e EMAIL_SERVICE_HOST=127.0.0.1 \
  -e EMAIL_SERVICE_PORT=5175 \
  -e HTTPS_PROXY=http://127.0.0.1:7890 \
  -e HTTP_PROXY=http://127.0.0.1:7890 \
  -e ALL_PROXY=http://127.0.0.1:7890 \
  email-plugin:local
sleep 5
curl -fsS http://127.0.0.1:5175/api/app-version
curl -fsS http://127.0.0.1:5175/manifest.webmanifest >/dev/null
curl -fsS 'http://127.0.0.1:5175/api/accounts' | python3 -c 'import json,sys; data=json.load(sys.stdin); print("accounts="+str(len(data.get("accounts", []))))'
curl -fsS 'http://127.0.0.1:5175/api/messages?folderId=gmail-folder-INBOX&limit=5' | python3 -c 'import json,sys; data=json.load(sys.stdin); print("messages="+str(len(data.get("messages", []))))'
printf 'backup=%s\n' "`$BACKUP_DIR/source-before.tar.gz"
"@

$remoteScript | ssh -p $NasPort -i $SshKeyPath -o BatchMode=yes -o IdentitiesOnly=yes "$NasUser@$NasHost" sh
if ($LASTEXITCODE -ne 0) {
  throw "NAS deployment failed"
}

Write-Host "Deployed Email plugin commit $commit to $NasHost"
