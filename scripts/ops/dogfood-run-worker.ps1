$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-AurumCommand.ps1')
$body = @{
 operationId = "next-build-worker-plan-v1"
 action = "run"
 commandId = "node"
 args = @("next-build\worker.mjs")
 timeoutMs = 70000
}
Invoke-AurumCommand -Body $body | ConvertTo-Json -Depth 8
