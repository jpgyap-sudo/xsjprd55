# Push AI Consultant migration to Supabase - split into individual statements
param()

$ErrorActionPreference = "Stop"

$sql = Get-Content -Raw "supabase/migrations/20260515_ai_consultant_mode.sql"

# Split into individual statements
$statements = $sql -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' -and $_ -notmatch '^--' }

Write-Output "Found $($statements.Count) SQL statements"

$headers = @{
    'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xY2dud3BmeG5idGRydnRrd2VqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIxMDI3NCwiZXhwIjoyMDkyNzg2Mjc0fQ.X3N2peEGhK2_WEwiuVC3gLX930dTce4Y_OonbfZ9HhY'
    'Content-Type' = 'application/json'
}

$ok = 0
$fail = 0

for ($i = 0; $i -lt $statements.Count; $i++) {
    $stmt = $statements[$i] + ';'
    $body = @{ query = $stmt } | ConvertTo-Json -Depth 3
    
    try {
        $res = Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects/nqcgnwpfxnbtdrvtkwej/database/query' -Method Post -Headers $headers -Body $body
        $ok++
        Write-Host "." -NoNewline
    } catch {
        $errMsg = $_.Exception.Message
        if ($errMsg -match 'already exists' -or $errMsg -match 'duplicate' -or $errMsg -match 'exist') {
            $ok++
            Write-Host "e" -NoNewline
        } else {
            $fail++
            Write-Host "`n[$($i+1)] FAIL: $errMsg" -ForegroundColor Red
            if ($_.Exception.Response) {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $reader.BaseStream.Position = 0
                $reader.DiscardBufferedData()
                Write-Host ($reader.ReadToEnd())
            }
        }
    }
}

Write-Host "`n`nOK: $ok, Fail: $fail"

# Verify tables
Write-Host "`n=== Verification ==="
$tables = @('advisor_requests','advisor_reports','strategy_hypotheses','strategy_backtests','simulation_agents','simulated_trades','signal_outcomes','advisor_learning_memory')
$SUPABASE_URL = 'https://nqcgnwpfxnbtdrvtkwej.supabase.co'

foreach ($table in $tables) {
    try {
        $checkHeaders = @{
            'apikey' = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xY2dud3BmeG5idGRydnRrd2VqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIxMDI3NCwiZXhwIjoyMDkyNzg2Mjc0fQ.X3N2peEGhK2_WEwiuVC3gLX930dTce4Y_OonbfZ9HhY'
            'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xY2dud3BmeG5idGRydnRrd2VqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIxMDI3NCwiZXhwIjoyMDkyNzg2Mjc0fQ.X3N2peEGhK2_WEwiuVC3gLX930dTce4Y_OonbfZ9HhY'
        }
        $checkRes = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$table`?select=count&limit=1" -Method Get -Headers $checkHeaders
        Write-Host "  [OK] $table" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] $table" -ForegroundColor Red
    }
}
