$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-AurumCommand.ps1')
$body = @{
 operationId = "next-build-live-summary-v1"
 action = "run"
 commandId = "node"
 args = @("next-build\cli.mjs",".aurum-commander\receipts.jsonl")
 timeoutMs = 5000
}
Invoke-AurumCommand -Body $body | ConvertTo-Json -Depth 8
