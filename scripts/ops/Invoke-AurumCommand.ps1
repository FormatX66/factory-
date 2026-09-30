# Shared current-user client. No credential copy, regeneration, retry or remote host.
function Invoke-AurumCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][hashtable]$Body,
        [string]$ConfigPath = (Join-Path $env:USERPROFILE 'AurumCommanderRuntime\config.json')
    )
    $ErrorActionPreference = 'Stop'
    $token = $null; $headers = $null
    try {
        if (-not [IO.Path]::IsPathRooted($ConfigPath)) { throw 'invalid-config' }
        $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
        if ($cfg.schema -ne 'aurum.commander.install.v1' -or
            -not [IO.Path]::IsPathRooted($cfg.tokenFile) -or
            -not [IO.Path]::IsPathRooted($cfg.workspace)) { throw 'invalid-config' }
        if ($cfg.PSObject.Properties['host'] -and $cfg.host -ne '127.0.0.1') { throw 'nonlocal-host' }
        $port = 0
        if (-not [int]::TryParse([string]$cfg.port, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw 'invalid-port' }
        $workspace = [IO.Path]::GetFullPath($cfg.workspace).TrimEnd('\') + '\'
        $tokenPath = [IO.Path]::GetFullPath($cfg.tokenFile)
        if ($tokenPath.StartsWith($workspace, [StringComparison]::OrdinalIgnoreCase)) { throw 'token-in-workspace' }
        $token = [IO.File]::ReadAllText($tokenPath).Trim()
        if ($token -notmatch '^[A-Za-z0-9_-]{24,256}$') { throw 'invalid-token' }
        if ($Body.action -notin @('read','write','run') -or
            [string]$Body.operationId -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{2,127}$') { throw 'invalid-request' }
        $timeout = 5000
        if ($Body.action -eq 'run') {
            if ($Body.commandId -notin @('node','git')) { throw 'command-not-allowed' }
            if ($Body.ContainsKey('timeoutMs')) {
                if (-not [int]::TryParse([string]$Body.timeoutMs,[ref]$timeout)) { throw 'invalid-timeout' }
            }
            if ($timeout -lt 1 -or $timeout -gt 300000) { throw 'invalid-timeout' }
        }
        $json = $Body | ConvertTo-Json -Compress -Depth 12
        if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 100000) { throw 'request-too-large' }
        $headers = @{ Authorization = 'Bearer ' + $token }
        $result = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$port/v1/command" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -MaximumRedirection 0 -TimeoutSec ([int][Math]::Ceiling($timeout/1000)+8)
        if (-not $result.receipt -or $result.receipt.operationId -ne $Body.operationId -or
            $result.receipt.schema -ne 'aurum.commander.receipt.v1' -or $result.receipt.ok -ne $true) { throw 'receipt-not-verified' }
        if ($Body.action -eq 'run' -and ($result.ok -ne $true -or $result.exitCode -ne 0 -or $result.timedOut)) { throw 'command-failed' }
        return $result
    } catch {
        # Never include headers, config, raw server errors or credential values.
        throw 'Aurum command failed; inspect local receipt/connection evidence. No automatic retry was attempted.'
    } finally { $token = $null; $headers = $null }
}
