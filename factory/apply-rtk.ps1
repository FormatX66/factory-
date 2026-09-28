param()
$ErrorActionPreference='Stop'
if(-not $env:FACTORY_GATEWAY_TOKEN){throw 'Set FACTORY_GATEWAY_TOKEN locally; do not paste it into chat or commit it.'}
$cfg=Get-Content "$PSScriptRoot\factory.config.json" -Raw | ConvertFrom-Json
if($cfg.compression.mode -ne 'rtk' -or $cfg.compression.ultra){throw 'Factory compression policy mismatch.'}
$headers=@{Authorization="Bearer $env:FACTORY_GATEWAY_TOKEN"}
$body=[ordered]@{
 enabled=$true
 defaultMode='rtk'
 autoTriggerMode='rtk'
 autoTriggerTokens=[int]$cfg.compression.auto_trigger_tokens
 rtkConfig=[ordered]@{enabled=$true;intensity='standard';applyToToolResults=$true;applyToCodeBlocks=$false;applyToAssistantMessages=$false}
 ultra=[ordered]@{enabled=$false}
} | ConvertTo-Json -Depth 6
$uri="$($cfg.gateway)/api/settings/compression"
$result=Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 10
Write-Output 'RTK policy applied through authenticated OmniRoute API; Ultra remains disabled.'
$result | ConvertTo-Json -Depth 6
