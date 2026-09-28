$ErrorActionPreference='Stop'
$cfg=Get-Content "$PSScriptRoot\factory.config.json" -Raw | ConvertFrom-Json
$checks=[ordered]@{}
$checks.gateway_loopback=$cfg.gateway -eq 'http://127.0.0.1:20128'
$checks.free_route=$cfg.model -eq 'auto/coding:free'
$checks.no_full_pool_fallback=$cfg.allow_full_pool_fallback -eq $false
$checks.rtk_staged=$cfg.compression.mode -eq 'rtk' -and $cfg.compression.auto_trigger_tokens -eq 20000 -and $cfg.compression.ultra -eq $false
$checks.two_provider_acceptance=$cfg.acceptance.min_distinct_providers -ge 2 -and $cfg.acceptance.require_same_task_continuity
$profile=Join-Path $HOME '.claude\profiles\free\settings.json'
$checks.profile_exists=Test-Path $profile
if($checks.profile_exists){
 $s=Get-Content $profile -Raw | ConvertFrom-Json
 $checks.profile_route=$s.env.ANTHROPIC_MODEL -eq 'auto/coding:free'
 $checks.profile_base=$s.env.ANTHROPIC_BASE_URL -eq 'http://127.0.0.1:20128'
 $checks.permission_default=$s.permissions.defaultMode -eq 'default'
}
try{$h=Invoke-RestMethod -Uri 'http://127.0.0.1:20128/api/monitoring/health' -TimeoutSec 5;$checks.gateway_healthy=$h.status -eq 'healthy'}catch{$checks.gateway_healthy=$false}
$live=[ordered]@{provider_count_verified=0;live_inference_verified=$false;provider_handoff_verified=$false;reason='Requires two authenticated free providers and a synthetic continuity test.'}
$result=[ordered]@{schema='factory.acceptance.v1';checked_at=(Get-Date).ToUniversalTime().ToString('o');static_and_local_checks=$checks;live_acceptance=$live}
$result | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 "$PSScriptRoot\acceptance.json"
$result | ConvertTo-Json -Depth 6
if(@($checks.Values) -contains $false){exit 1}
