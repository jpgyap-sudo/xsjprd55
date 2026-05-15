# Push AI Consultant migration to Supabase via Management API
param()

$ErrorActionPreference = "Stop"

$sql = Get-Content -Raw "supabase/migrations/20260515_ai_consultant_mode.sql"
Write-Output "SQL length: $($sql.Length) chars"

$body = @{ query = $sql } | ConvertTo-Json -Depth 5

$headers = @{
    'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xY2dud3BmeG5idGRydnRrd2VqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIxMDI3NCwiZXhwIjoyMDkyNzg2Mjc0fQ.X3N2peEGhK2_WEwiuVC3gLX930dTce4Y_OonbfZ9HhY'
    'Content-Type' = 'application/json'
}

Write-Output "Calling Supabase Management API..."

try {
    $res = Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects/nqcgnwpfxnbtdrvtkwej/database/query' -Method Post -Headers $headers -Body $body
    Write-Output "SUCCESS"
    Write-Output ($res | ConvertTo-Json -Depth 5)
} catch {
    Write-Output "FAILED: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        $responseText = $reader.ReadToEnd()
        Write-Output "Response: $responseText"
    }
}

# Also verify tables
Write-Output "`n=== Verification ==="
$tables = @('advisor_requests','advisor_reports','strategy_hypotheses','strategy_backtests','simulation_agents','simulated_trades','signal_outcomes','advisor_learning_memory')

$SUPABASE_URL = 'https://nqcgnwpfxnbtdrvtkwej.supabase.co'
foreach ($table in $tables) {
    try {
        $checkHeaders = @{
            'apikey' = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xY2dud3BmeG5idGRydnRrd2VqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIxMDI3NCwiZXhwIjoyMDkyNzg2Mjc0fQ.X3N2peEGhK2_WEwiuVC3gLX930dTce4Y_OonbfZ9HhY'
            'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xY2dud3BmeG5idGRydnRrd2VqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIxMDI3NCwiZXhwIjoyMDkyNzg2Mjc0fQ.X3N2peEGhK2_WEwiuVC3gLX930dTce4Y_OonbfZ9HhY'
        }
        $checkRes = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$table`?select=count&limit=1" -Method Get -Headers $checkHeaders
        Write-Output "  [OK] $table"
    } catch {
        Write-Output "  [FAIL] $table - $($_.Exception.Message)"
    }
}
