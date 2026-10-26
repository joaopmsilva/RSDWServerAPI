# Uploads this project to the VPS and, optionally, runs the update scripts there.
#
#   .\deploy\upload.ps1              upload only
#   .\deploy\upload.ps1 -Bot         upload, then update and restart the bot
#   .\deploy\upload.ps1 -Mod         upload, then build the mod for the next server restart
#   .\deploy\upload.ps1 -Bot -Mod    both
#   .\deploy\upload.ps1 -Mod -Restart   build the mod, warn players, restart in 2 minutes
#
# Without -Restart the new mod loads at the next server start (the 05:00 restart).
#
# Uses your SSH key if you've set one up (see DEPLOY.md), otherwise asks for the password.

param(
    [switch]$Bot,
    [switch]$Mod,
    [switch]$Restart,
    [string]$Target = 'user@your-vps-ip'
)

$ErrorActionPreference = 'Stop'
if ($Restart -and -not $Mod) { throw '-Restart goes with -Mod (to restart without a new mod, use /server restart)' }

$repo = Split-Path $PSScriptRoot -Parent
$parent = Split-Path $repo -Parent
$name = Split-Path $repo -Leaf
$archive = Join-Path $env:TEMP 'rsdw.tgz'

Write-Host "Packing $repo" -ForegroundColor Cyan
tar -czf $archive -C $parent `
    --exclude=node_modules --exclude=.git --exclude=bot/data --exclude=bot/.env `
    --exclude=dist --exclude=build --exclude='*.o' $name
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }

Write-Host "Uploading to $Target" -ForegroundColor Cyan
scp $archive "${Target}:/tmp/rsdw.tgz"
if ($LASTEXITCODE -ne 0) { throw 'scp failed' }

# Unpack into the login user's home. Scripts edited on Windows can pick up CRLF
# line endings, which bash refuses, so strip them.
$remote = 'set -e; rm -rf ~/' + $name + '; tar xzf /tmp/rsdw.tgz -C ~; ' +
    'find ~/' + $name + ' -name ''*.sh'' -exec sed -i ''s/\r$//'' {} +; ' +
    'chmod +x ~/' + $name + '/deploy/*.sh ~/' + $name + '/bot/deploy/scripts/*.sh; ' +
    'echo Unpacked into ~/' + $name
# Bot first, so a failed mod build doesn't hold back the bot update.
if ($Bot) { $remote += '; ~/' + $name + '/deploy/update-bot.sh' }
if ($Mod) {
    $remote += '; ~/' + $name + '/deploy/update-mod.sh'
    if ($Restart) { $remote += ' --restart' }
}

Write-Host 'Running on the VPS' -ForegroundColor Cyan
ssh -t $Target $remote
if ($LASTEXITCODE -ne 0) { throw 'a step on the VPS failed - see above' }

Write-Host 'Done.' -ForegroundColor Green
