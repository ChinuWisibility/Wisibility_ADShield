<#
.SYNOPSIS
    Privileged Access posture verification (AD source of truth).
.DESCRIPTION
    Verifies Privileged Access findings against Active Directory using the same
    thresholds and heuristics as Wisibility Security Posture (GRAPH features):
      - Nested Privileged Access
      - Dormant Privileged Users (90 days)
      - Toxic Privilege Combinations (>= 2 privileged groups)
      - Excessive Privileges (>= 5 privileged groups)
      - Privilege Escalation Paths (path length >= 3)

    Lab SearchBase is configurable below for this test harness only.
    Product code must resolve search base from the application connection.
.NOTES
    Outputs under Reports/Scan5:
      PrivilegedAccessReport.csv, PrivilegedAccessSummary.csv, PrivilegedAccessReport.json
#>

$ErrorActionPreference = "Stop"
$scriptStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

# =========================================================================
# HARDCODED CONFIGURATION (lab harness only — not used by product)
# =========================================================================
$Server       = "192.168.68.107"
$Username     = "icmadmin@wisibility.lcl"
$PasswordText = "gSo4|2@22*Gg"
$SearchBase   = "OU=wisibility,DC=wisibility,DC=lcl"
$OutputFolder = "D:\Work\Wisibility_IGA\Reports\Scan5"

# Align with icm-backend graphConstants / privilegedAccessService
$DormantPrivilegedDays         = 90
$ToxicPrivilegeMinGroups       = 2
$ExcessivePrivilegeThreshold   = 5
$EscalationMinPathLength       = 3
$MaxTraversalDepth             = 16

$PrivilegedNameTokens = @(
    "domain admins",
    "enterprise admins",
    "schema admins",
    "administrators",
    "account operators",
    "backup operators",
    "server operators",
    "privileged",
    "admin"
)

$UAC_ACCOUNTDISABLE = 0x0002

# =========================================================================
# INITIALIZATION
# =========================================================================
try {
    if (-not (Test-Path -Path $OutputFolder)) {
        $null = New-Item -Path $OutputFolder -ItemType Directory -Force
    }
}
catch {
    Write-Error "Failed to create output directory: $_"
    exit 1
}

$reportCsvPath  = Join-Path -Path $OutputFolder -ChildPath "PrivilegedAccessReport.csv"
$summaryCsvPath = Join-Path -Path $OutputFolder -ChildPath "PrivilegedAccessSummary.csv"
$jsonReportPath = Join-Path -Path $OutputFolder -ChildPath "PrivilegedAccessReport.json"

$global:reportData  = [System.Collections.Generic.List[object]]::new()
$global:summaryData = [System.Collections.Generic.List[object]]::new()

$SecurePassword = ConvertTo-SecureString $PasswordText -AsPlainText -Force
$Credential     = New-Object System.Management.Automation.PSCredential($Username, $SecurePassword)

try {
    Import-Module ActiveDirectory -ErrorAction Stop
}
catch {
    Write-Error "ActiveDirectory module is not installed or available."
    exit 1
}

# =========================================================================
# HELPERS
# =========================================================================
function Add-ReportRecord {
    param (
        [string]$Feature,
        [string]$Object,
        [string]$SamAccountName,
        [string]$DistinguishedName,
        [string]$Reason,
        [string]$Details,
        [string]$Status = "Detected"
    )

    $global:reportData.Add([PSCustomObject]@{
        Feature           = $Feature
        Object            = $Object
        SamAccountName    = $SamAccountName
        DistinguishedName = $DistinguishedName
        Reason            = $Reason
        Details           = $Details
        Status            = $Status
    })
}

function Normalize-Dn {
    param([string]$Dn)
    if ([string]::IsNullOrWhiteSpace($Dn)) { return "" }
    return $Dn.Trim().ToLowerInvariant()
}

function Test-IsPrivilegedName {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) { return $false }
    $n = $Name.Trim().ToLowerInvariant()
    foreach ($token in $PrivilegedNameTokens) {
        if ($n.Contains($token)) { return $true }
    }
    return $false
}

function Test-IsOlderThanDays {
    param(
        $LastLogonTimestamp,
        [int]$Days,
        [switch]$TreatNeverLoggedOnAsDormant
    )
    if ($null -eq $LastLogonTimestamp -or $LastLogonTimestamp -eq 0 -or $LastLogonTimestamp -eq "0") {
        return [bool]$TreatNeverLoggedOnAsDormant
    }
    try {
        $dt = if ($LastLogonTimestamp -is [datetime]) {
            $LastLogonTimestamp
        }
        else {
            [datetime]::FromFileTimeUtc([int64]$LastLogonTimestamp)
        }
        return ((Get-Date).ToUniversalTime() - $dt.ToUniversalTime()).TotalDays -ge $Days
    }
    catch {
        return [bool]$TreatNeverLoggedOnAsDormant
    }
}

function Get-ShortestPathLength {
    param(
        [string]$StartDnKey,
        [string]$TargetDnKey,
        [hashtable]$Adj,
        [int]$MaxDepth
    )

    if (-not $StartDnKey -or -not $TargetDnKey) { return -1 }
    if ($StartDnKey -eq $TargetDnKey) { return 1 }

    $visited = @{}
    $queue = [System.Collections.Generic.Queue[object]]::new()
    $queue.Enqueue(@{ Key = $StartDnKey; Depth = 1 })
    $visited[$StartDnKey] = $true

    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        if ($item.Depth -ge $MaxDepth) { continue }
        $neighbors = @($Adj[$item.Key])
        foreach ($next in $neighbors) {
            if (-not $next -or $visited.ContainsKey($next)) { continue }
            $nextDepth = $item.Depth + 1
            if ($next -eq $TargetDnKey) { return $nextDepth }
            $visited[$next] = $true
            $queue.Enqueue(@{ Key = $next; Depth = $nextDepth })
        }
    }
    return -1
}

function Get-UsersReachingPrivilegedGroups {
    param(
        [hashtable]$ReverseAdj,
        [hashtable]$PrivilegeGroupKeys,
        [hashtable]$UserByDn,
        [int]$MaxDepth
    )

    # uKey → @{ PrivKeys = HashSet; MinPath = int; BestTarget = string }
    $result = @{}
    foreach ($privKey in @($PrivilegeGroupKeys.Keys)) {
        $visited = @{}
        $queue = [System.Collections.Generic.Queue[object]]::new()
        $queue.Enqueue(@{ Key = $privKey; Depth = 1 })
        $visited[$privKey] = $true

        while ($queue.Count -gt 0) {
            $item = $queue.Dequeue()
            if ($UserByDn.ContainsKey($item.Key)) {
                if (-not $result.ContainsKey($item.Key)) {
                    $result[$item.Key] = @{
                        PrivKeys   = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
                        MinPath    = $item.Depth
                        BestTarget = $privKey
                    }
                }
                [void]$result[$item.Key].PrivKeys.Add($privKey)
                if ($item.Depth -lt $result[$item.Key].MinPath) {
                    $result[$item.Key].MinPath = $item.Depth
                    $result[$item.Key].BestTarget = $privKey
                }
            }
            if ($item.Depth -ge $MaxDepth) { continue }
            foreach ($prev in @($ReverseAdj[$item.Key])) {
                if (-not $prev -or $visited.ContainsKey($prev)) { continue }
                $visited[$prev] = $true
                $queue.Enqueue(@{ Key = $prev; Depth = ($item.Depth + 1) })
            }
        }
    }
    return $result
}

# =========================================================================
# DATA FETCH
# =========================================================================
$adParams = @{
    SearchBase = $SearchBase
    Server     = $Server
    Credential = $Credential
}

Write-Host "Fetching users and groups from $SearchBase ..." -ForegroundColor Yellow

try {
    Write-Host "  Loading users..." -ForegroundColor DarkGray
    $allUsers = @(Get-ADUser @adParams -Filter * -Properties @(
        "SamAccountName", "Name", "DistinguishedName", "MemberOf",
        "UserAccountControl", "LastLogonTimestamp", "Enabled"
    ))
    Write-Host ("  Users loaded: {0}" -f $allUsers.Count) -ForegroundColor DarkGray
}
catch {
    Write-Error "Failed to retrieve users from AD: $($_.Exception.Message)"
    exit 1
}

try {
    # Prefer MemberOf over Members (Members range retrieval is slow / can hang).
    Write-Host "  Loading groups..." -ForegroundColor DarkGray
    $allGroups = @(Get-ADGroup @adParams -Filter * -Properties @(
        "SamAccountName", "Name", "DistinguishedName", "MemberOf"
    ))
    Write-Host ("  Groups loaded: {0}" -f $allGroups.Count) -ForegroundColor DarkGray
}
catch {
    Write-Error "Failed to retrieve groups from AD: $($_.Exception.Message)"
    exit 1
}

Write-Host ("Fetched {0} users, {1} groups" -f $allUsers.Count, $allGroups.Count) -ForegroundColor DarkGray

# =========================================================================
# BUILD IN-MEMORY GRAPH (product-aligned)
# MEMBER_OF: user → group
# NESTED_MEMBER_OF: container group → member group (derived from memberOf)
# =========================================================================
$groupByDn = @{}
$privilegedGroupKeys = @{}
$adj = @{}  # nodeKey → list of neighbor keys

foreach ($g in $allGroups) {
    $key = Normalize-Dn $g.DistinguishedName
    if (-not $key) { continue }
    $groupByDn[$key] = $g
    $adj[$key] = [System.Collections.Generic.List[string]]::new()
    if (Test-IsPrivilegedName -Name $g.Name) {
        $privilegedGroupKeys[$key] = $g
    }
}

# Nested edges from MemberOf: child.memberOf includes parent → edge parent → child
foreach ($g in $allGroups) {
    $childKey = Normalize-Dn $g.DistinguishedName
    if (-not $childKey) { continue }
    foreach ($parentDn in @($g.MemberOf)) {
        $parentKey = Normalize-Dn $parentDn
        if (-not $parentKey) { continue }
        if (-not $groupByDn.ContainsKey($parentKey)) { continue }
        if (-not $adj.ContainsKey($parentKey)) {
            $adj[$parentKey] = [System.Collections.Generic.List[string]]::new()
        }
        if (-not ($adj[$parentKey] -contains $childKey)) {
            [void]$adj[$parentKey].Add($childKey)
        }
    }
}

# User nodes + MEMBER_OF edges + reverse adjacency for privilege fan-in
$userByDn = @{}
$reverseAdj = @{}
foreach ($u in $allUsers) {
    $uKey = Normalize-Dn $u.DistinguishedName
    if (-not $uKey) { continue }
    $userByDn[$uKey] = $u
    $neighbors = [System.Collections.Generic.List[string]]::new()
    foreach ($groupDn in @($u.MemberOf)) {
        $gKey = Normalize-Dn $groupDn
        if (-not $gKey) { continue }
        if (-not $groupByDn.ContainsKey($gKey)) { continue }
        [void]$neighbors.Add($gKey)
        if (-not $reverseAdj.ContainsKey($gKey)) {
            $reverseAdj[$gKey] = [System.Collections.Generic.List[string]]::new()
        }
        [void]$reverseAdj[$gKey].Add($uKey)
    }
    if ($neighbors.Count -gt 0) {
        $adj[$uKey] = $neighbors
    }
}

# Reverse nested edges: child ← parent becomes parent in reverseAdj[child]
foreach ($parentKey in @($adj.Keys)) {
    if ($userByDn.ContainsKey($parentKey)) { continue }
    foreach ($childKey in @($adj[$parentKey])) {
        if (-not $reverseAdj.ContainsKey($childKey)) {
            $reverseAdj[$childKey] = [System.Collections.Generic.List[string]]::new()
        }
        [void]$reverseAdj[$childKey].Add($parentKey)
    }
}

# Privilege group IDs with at least one direct user member (PRIVILEGED_ACCESS analog)
$privilegeGroupIdsWithDirectAccess = @{}
foreach ($gKey in @($privilegedGroupKeys.Keys)) {
    foreach ($src in @($reverseAdj[$gKey])) {
        if ($userByDn.ContainsKey($src)) {
            $privilegeGroupIdsWithDirectAccess[$gKey] = $true
            break
        }
    }
}

Write-Host ("Users={0} Groups={1} PrivilegedGroups={2} DirectPrivAccess={3}" -f `
    $allUsers.Count, $allGroups.Count, $privilegedGroupKeys.Count, $privilegeGroupIdsWithDirectAccess.Count) `
    -ForegroundColor DarkGray

# =========================================================================
# FEATURE EVALUATION
# =========================================================================
$swNested      = [System.Diagnostics.Stopwatch]::new()
$swDormant     = [System.Diagnostics.Stopwatch]::new()
$swToxic       = [System.Diagnostics.Stopwatch]::new()
$swExcessive   = [System.Diagnostics.Stopwatch]::new()
$swEscalation  = [System.Diagnostics.Stopwatch]::new()

$countNested = 0; $countDormant = 0; $countToxic = 0; $countExcessive = 0; $countEscalation = 0
$statusNested = "Success"; $statusDormant = "Success"; $statusToxic = "Success"
$statusExcessive = "Success"; $statusEscalation = "Success"

# 1) Nested Privileged Access — privileged group with a parent group
Write-Host "Evaluating Nested Privileged Access..." -ForegroundColor DarkGray
$swNested.Start()
try {
    foreach ($privKey in @($privilegedGroupKeys.Keys)) {
        if (-not $privilegeGroupIdsWithDirectAccess.ContainsKey($privKey)) { continue }

        $g = $privilegedGroupKeys[$privKey]
        $parentGroups = [System.Collections.Generic.List[string]]::new()
        foreach ($parentDn in @($g.MemberOf)) {
            $pKey = Normalize-Dn $parentDn
            if ($groupByDn.ContainsKey($pKey)) {
                [void]$parentGroups.Add($groupByDn[$pKey].Name)
            }
        }
        if ($parentGroups.Count -eq 0) { continue }

        Add-ReportRecord -Feature "Nested Privileged Access" `
            -Object $g.Name `
            -SamAccountName $g.SamAccountName `
            -DistinguishedName $g.DistinguishedName `
            -Reason "Privileged group reachable via nested group chain (has parent group)" `
            -Details ("parentGroupCount={0}; parents={1}" -f $parentGroups.Count, ($parentGroups -join '; '))
        $countNested++
    }
}
catch { $statusNested = "Failed: $($_.Exception.Message)" }
$swNested.Stop()

Write-Host "Resolving users that reach privileged groups (reverse BFS)..." -ForegroundColor DarkGray
$userPrivInfo = Get-UsersReachingPrivilegedGroups `
    -ReverseAdj $reverseAdj `
    -PrivilegeGroupKeys $privilegeGroupIdsWithDirectAccess `
    -UserByDn $userByDn `
    -MaxDepth $MaxTraversalDepth
Write-Host ("Privileged-reaching users: {0}" -f $userPrivInfo.Count) -ForegroundColor DarkGray

# 2) Dormant Privileged Users
Write-Host "Evaluating Dormant Privileged Users..." -ForegroundColor DarkGray
$swDormant.Start()
try {
    foreach ($uKey in @($userPrivInfo.Keys)) {
        $u = $userByDn[$uKey]
        $uac = $u.UserAccountControl
        $isDisabled = ($null -ne $uac) -and (($uac -band $UAC_ACCOUNTDISABLE) -eq $UAC_ACCOUNTDISABLE)
        if ($isDisabled -or ($u.Enabled -eq $false)) { continue }
        if (-not (Test-IsOlderThanDays -LastLogonTimestamp $u.LastLogonTimestamp -Days $DormantPrivilegedDays -TreatNeverLoggedOnAsDormant)) {
            continue
        }

        $privKeys = @($userPrivInfo[$uKey].PrivKeys)
        $names = @($privKeys | ForEach-Object {
            if ($groupByDn.ContainsKey($_)) { $groupByDn[$_].Name } else { $_ }
        })
        Add-ReportRecord -Feature "Dormant Privileged Users" `
            -Object $u.Name `
            -SamAccountName $u.SamAccountName `
            -DistinguishedName $u.DistinguishedName `
            -Reason ("Active privileged user inactive >= {0} days" -f $DormantPrivilegedDays) `
            -Details ("privilegedGroupCount={0}; groups={1}" -f $names.Count, ($names -join '; '))
        $countDormant++
    }
}
catch { $statusDormant = "Failed: $($_.Exception.Message)" }
$swDormant.Stop()

# 3) Toxic Privilege Combinations (>= 2 privileged groups)
Write-Host "Evaluating Toxic Privilege Combinations..." -ForegroundColor DarkGray
$swToxic.Start()
try {
    foreach ($uKey in @($userPrivInfo.Keys)) {
        $u = $userByDn[$uKey]
        $privKeys = @($userPrivInfo[$uKey].PrivKeys)
        if ($privKeys.Count -lt $ToxicPrivilegeMinGroups) { continue }

        $names = @($privKeys | ForEach-Object {
            if ($groupByDn.ContainsKey($_)) { $groupByDn[$_].Name } else { $_ }
        })
        Add-ReportRecord -Feature "Toxic Privilege Combinations" `
            -Object $u.Name `
            -SamAccountName $u.SamAccountName `
            -DistinguishedName $u.DistinguishedName `
            -Reason ("User reaches {0}+ privileged groups" -f $ToxicPrivilegeMinGroups) `
            -Details ("privilegedGroupCount={0}; groups={1}" -f $names.Count, ($names -join '; '))
        $countToxic++
    }
}
catch { $statusToxic = "Failed: $($_.Exception.Message)" }
$swToxic.Stop()

# 4) Excessive Privileges (>= 5)
Write-Host "Evaluating Excessive Privileges..." -ForegroundColor DarkGray
$swExcessive.Start()
try {
    foreach ($uKey in @($userPrivInfo.Keys)) {
        $u = $userByDn[$uKey]
        $privKeys = @($userPrivInfo[$uKey].PrivKeys)
        if ($privKeys.Count -lt $ExcessivePrivilegeThreshold) { continue }

        $names = @($privKeys | ForEach-Object {
            if ($groupByDn.ContainsKey($_)) { $groupByDn[$_].Name } else { $_ }
        })
        Add-ReportRecord -Feature "Excessive Privileges" `
            -Object $u.Name `
            -SamAccountName $u.SamAccountName `
            -DistinguishedName $u.DistinguishedName `
            -Reason ("Privileged group count >= {0}" -f $ExcessivePrivilegeThreshold) `
            -Details ("privilegedGroupCount={0}; groups={1}" -f $names.Count, ($names -join '; '))
        $countExcessive++
    }
}
catch { $statusExcessive = "Failed: $($_.Exception.Message)" }
$swExcessive.Stop()

# 5) Privilege Escalation Paths (shortest path length >= 3)
Write-Host "Evaluating Privilege Escalation Paths..." -ForegroundColor DarkGray
$swEscalation.Start()
try {
    foreach ($uKey in @($userPrivInfo.Keys)) {
        $info = $userPrivInfo[$uKey]
        $pathLen = [int]$info.MinPath
        if ($pathLen -lt $EscalationMinPathLength) { continue }

        $u = $userByDn[$uKey]
        $target = $info.BestTarget
        $targetName = if ($target -and $groupByDn.ContainsKey($target)) { $groupByDn[$target].Name } else { $target }
        Add-ReportRecord -Feature "Privilege Escalation Paths" `
            -Object $u.Name `
            -SamAccountName $u.SamAccountName `
            -DistinguishedName $u.DistinguishedName `
            -Reason ("Escalation path length >= {0}" -f $EscalationMinPathLength) `
            -Details ("pathLength={0}; privilegedGroup={1}" -f $pathLen, $targetName)
        $countEscalation++
    }
}
catch { $statusEscalation = "Failed: $($_.Exception.Message)" }
$swEscalation.Stop()

# =========================================================================
# SUMMARY + EXPORT
# =========================================================================
$global:summaryData.Add([PSCustomObject]@{ Feature = "Nested Privileged Access"; Count = $countNested; ExecutionTime = $swNested.Elapsed.ToString("hh\:mm\:ss\.fff"); Status = $statusNested })
$global:summaryData.Add([PSCustomObject]@{ Feature = "Dormant Privileged Users"; Count = $countDormant; ExecutionTime = $swDormant.Elapsed.ToString("hh\:mm\:ss\.fff"); Status = $statusDormant })
$global:summaryData.Add([PSCustomObject]@{ Feature = "Toxic Privilege Combinations"; Count = $countToxic; ExecutionTime = $swToxic.Elapsed.ToString("hh\:mm\:ss\.fff"); Status = $statusToxic })
$global:summaryData.Add([PSCustomObject]@{ Feature = "Excessive Privileges"; Count = $countExcessive; ExecutionTime = $swExcessive.Elapsed.ToString("hh\:mm\:ss\.fff"); Status = $statusExcessive })
$global:summaryData.Add([PSCustomObject]@{ Feature = "Privilege Escalation Paths"; Count = $countEscalation; ExecutionTime = $swEscalation.Elapsed.ToString("hh\:mm\:ss\.fff"); Status = $statusEscalation })

try {
    if ($global:reportData.Count -gt 0) {
        $global:reportData | Export-Csv -Path $reportCsvPath -NoTypeInformation -Force -Encoding UTF8
    }
    else {
        Set-Content -Path $reportCsvPath -Value "Feature,Object,SamAccountName,DistinguishedName,Reason,Details,Status" -Encoding UTF8
    }

    $global:summaryData | Export-Csv -Path $summaryCsvPath -NoTypeInformation -Force -Encoding UTF8

    $jsonOutput = [PSCustomObject]@{
        GeneratedAt = (Get-Date).ToUniversalTime().ToString("o")
        SearchBase  = $SearchBase
        Thresholds  = [PSCustomObject]@{
            DormantDays                  = $DormantPrivilegedDays
            ToxicMinGroups               = $ToxicPrivilegeMinGroups
            ExcessiveMinGroups           = $ExcessivePrivilegeThreshold
            EscalationMinPathLength      = $EscalationMinPathLength
        }
        Summary     = $global:summaryData
        Findings    = $global:reportData
    }
    $jsonOutput | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonReportPath -Force -Encoding UTF8
}
catch {
    Write-Error "Failed to write report files: $($_.Exception.Message)"
    exit 1
}

$scriptStopwatch.Stop()
$totalExecutionTime = $scriptStopwatch.Elapsed.ToString("hh\:mm\:ss\.fff")

Write-Host ""
Write-Host "=================================================="
Write-Host "Privileged Access Checks"
Write-Host "=================================================="
Write-Host ("Search Base: {0}" -f $SearchBase)
Write-Host "--------------------------------------------------"
foreach ($sum in $global:summaryData) {
    $paddedFeature = $sum.Feature.PadRight(40, ' ')
    Write-Host "$paddedFeature $($sum.Count)"
}
Write-Host "=================================================="
Write-Host "Execution Time                             $totalExecutionTime"
Write-Host "=================================================="
Write-Host ("Report : {0}" -f $reportCsvPath)
Write-Host ("Summary: {0}" -f $summaryCsvPath)
Write-Host ("JSON   : {0}" -f $jsonReportPath)
