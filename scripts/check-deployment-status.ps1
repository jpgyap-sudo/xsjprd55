# ============================================================
# Check Deployment Status Script (Windows PowerShell)
# Run: powershell -ExecutionPolicy Bypass -File scripts\check-deployment-status.ps1
# ============================================================

$VPS_IP = if ($env:VPS_IP) { $env:VPS_IP } else { "165.22.110.111" }
$VPS_USER = if ($env:VPS_USER) { $env:VPS_USER } else { "root" }

function Write-Section($title) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host $title -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
}

function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "  [ERR] $msg" -ForegroundColor Red }

Write-Section "DEPLOYMENT STATUS CHECK"
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC')"
Write-Host "VPS:  ${VPS_USER}@${VPS_IP}"
Write-Host ""

# --- Local Git Status ---
Write-Section "LOCAL GIT STATUS"
$branch = git branch --show-current 2>$null
$commit = git rev-parse --short HEAD 2>$null
$msg = git log -1 --pretty=%s 2>$null
Write-Host "Branch: $branch"
Write-Host "Commit: $commit"
Write-Host "Message: $msg"
Write-Host ""

$porcelain = git status --porcelain 2>$null
if ($porcelain) {
    Write-Warn "Uncommitted changes detected"
    $porcelain | ForEach-Object { Write-Host "    $_" }
} else {
    Write-Ok "No uncommitted changes"
}
Write-Host ""

# --- Remote Sync ---
Write-Section "REMOTE SYNC STATUS"
try {
    $local = git rev-parse HEAD
    $remote = git rev-parse "@{u}" 2>$null
    if ($remote) {
        if ($local -eq $remote) {
            Write-Ok "In sync with origin"
        } else {
            $behind = git rev-list --count HEAD.."@{u}" 2>$null
            $ahead = git rev-list --count "@{u}"..HEAD 2>$null
            if ([int]$behind -gt 0) { Write-Warn "Behind origin by $behind commit(s). Run: git pull origin main" }
            if ([int]$ahead -gt 0) { Write-Warn "Ahead of origin by $ahead commit(s). Run: git push origin main" }
        }
    } else {
        Write-Warn "No upstream branch set"
    }
} catch {
    Write-Warn "Could not determine remote sync status"
}
Write-Host ""

# --- Agent Changes ---
Write-Section "AGENT CHANGES"
if (Test-Path ".agent-changes.json") {
    try {
        $data = Get-Content ".agent-changes.json" | ConvertFrom-Json
        Write-Host "Agent: $($data.agent_type)"
        Write-Host "Status: $($data.deployment_status)"
        Write-Host "Files: $($data.files_changed.total) total"
        Write-Host "Detected: $($data.timestamp)"
    } catch {
        Write-Warn "Could not parse .agent-changes.json"
    }
} else {
    Write-Host "No agent changes tracked"
}
Write-Host ""

# --- VPS Reachability ---
Write-Section "VPS REACHABILITY"

# Try SSH
$sshOk = $false
try {
    $sshOutput = ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_IP}" "echo OK" 2>$null
    if ($sshOutput -match "OK") {
        $sshOk = $true
        Write-Ok "SSH connection successful"
    } else {
        Write-Err "SSH connection failed"
    }
} catch {
    Write-Err "SSH unavailable or timed out"
}

# Try HTTP health
$httpOk = $false
try {
    $resp = Invoke-WebRequest -Uri "http://${VPS_IP}:3000/api/health" -TimeoutSec 5 -ErrorAction Stop
    if ($resp.StatusCode -eq 200) {
        $httpOk = $true
        Write-Ok "HTTP health check OK ($($resp.StatusCode))"
    } else {
        Write-Warn "HTTP health check returned $($resp.StatusCode)"
    }
} catch {
    Write-Err "HTTP health check FAILED ($_"
}
Write-Host ""

# --- VPS Git Commit (if SSH works) ---
if ($sshOk) {
    Write-Section "VPS DEPLOYMENT STATUS"
    try {
        $vpsCommit = ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_IP}" "cd /root/xsjprd55 && git rev-parse --short HEAD" 2>$null
        Write-Host "VPS Commit: $vpsCommit"
        if ($vpsCommit -eq $commit) {
            Write-Ok "VPS is up to date with local"
        } else {
            Write-Warn "VPS is BEHIND local"
            Write-Host ""
            Write-Host "  To deploy, open DigitalOcean Web Console and run:"
            Write-Host "    cd /root/xsjprd55 && git pull origin main && pm2 reload all" -ForegroundColor DarkGray
        }
    } catch {
        Write-Err "Could not read VPS commit"
    }
    Write-Host ""

    # PM2 status
    Write-Section "PM2 STATUS (VPS)"
    try {
        $pm2 = ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_IP}" "pm2 status 2>$null" 2>$null
        if ($pm2) {
            $pm2 -split "`n" | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
        } else {
            Write-Warn "PM2 not running or no output"
        }
    } catch {
        Write-Warn "Could not get PM2 status"
    }
    Write-Host ""
} else {
    Write-Section "VPS DEPLOYMENT STATUS"
    Write-Warn "Cannot verify VPS status (SSH unreachable)"
    Write-Host ""
    Write-Host "  Likely causes:"
    Write-Host "    1. Droplet is powered off"
    Write-Host "    2. Firewall blocking port 22 / 3000"
    Write-Host "    3. SSH key not configured on this machine"
    Write-Host ""
    Write-Host "  Next step: Open DigitalOcean Web Console for ${VPS_IP}"
    Write-Host "    https://cloud.digitalocean.com/droplets"
}

Write-Host ""
Write-Section "CHECK COMPLETE"
