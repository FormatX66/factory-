$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-AurumCommand.ps1')
$body = @{
  operationId = "next-build-factory-health-v1"
  action = "write"
  path = "next-build\SPEC.md"
  data = @"
# Factory Health Dashboard v0.1
Build a dependency-free Node.js CLI that reads Factory evidence JSON files and prints one compact JSON health summary.
Requirements: never mutate source evidence; tolerate missing/malformed evidence; show healthy/held/failed counts; include last verified timestamp; tests must cover malformed and missing input; output must be machine-readable.
"@
}
Invoke-AurumCommand -Body $body | ConvertTo-Json -Depth 8
