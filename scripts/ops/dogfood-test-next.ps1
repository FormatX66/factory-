$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-AurumCommand.ps1')
$body = @{
 operationId = "next-build-tests-v1"
 action = "run"
 commandId = "node"
 args = @("--test","next-build\test\health.test.mjs")
 timeoutMs = 15000
}
Invoke-AurumCommand -Body $body | ConvertTo-Json -Depth 8
