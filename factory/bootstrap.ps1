param([switch]$NoHealthCheck)
$ErrorActionPreference='Stop'
$cfg=Get-Content "$PSScriptRoot\factory.config.json" -Raw | ConvertFrom-Json
if($cfg.gateway -ne 'http://127.0.0.1:20128'){throw 'Factory requires loopback gateway on port 20128.'}
if($cfg.model -ne 'auto/coding:free' -or -not $cfg.free_only){throw 'Factory must remain free-only.'}
if($cfg.allow_full_pool_fallback){throw 'Unrestricted paid-pool fallback is forbidden.'}
$profile=Join-Path $HOME '.claude\profiles\free'
New-Item -ItemType Directory -Force $profile | Out-Null
$settingsPath=Join-Path $profile 'settings.json'
$existing=$null
if(Test-Path $settingsPath){$existing=Get-Content $settingsPath -Raw | ConvertFrom-Json}
$envMap=[ordered]@{
 ANTHROPIC_BASE_URL=$cfg.gateway
 ANTHROPIC_MODEL=$cfg.model
 ANTHROPIC_DEFAULT_OPUS_MODEL=$cfg.model
 ANTHROPIC_DEFAULT_SONNET_MODEL=$cfg.model
 ANTHROPIC_DEFAULT_HAIKU_MODEL=$cfg.model
 CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY='1'
 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1'
}
$out=[ordered]@{env=$envMap;permissions=[ordered]@{defaultMode='default'}}
$out | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $settingsPath
[Environment]::SetEnvironmentVariable('OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL','false','Process')
if(-not $NoHealthCheck){
 $health=Invoke-RestMethod -Uri "$($cfg.gateway)/api/monitoring/health" -TimeoutSec 5
 if($health.status -ne 'healthy'){throw 'Gateway health check failed.'}
}
Write-Output "Factory profile ready: $settingsPath"
Write-Output 'Live provider credentials and failover acceptance were not modified.'
