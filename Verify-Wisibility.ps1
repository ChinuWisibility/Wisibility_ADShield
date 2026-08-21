#Requires -Version 5.1
<#
.SYNOPSIS
    Wisibility AD anomaly verification framework (deterministic validation).

.DESCRIPTION
    Validates that intentionally seeded Active Directory anomalies still exist.
    Development Mode (default) scopes LDAP to configured OUs and filters WIS-Seed/WIS-Sd objects.
    Use -ProductionMode to scan the entire directory.

.PARAMETER ProductionMode
    When set, search the entire domain instead of development OUs.

.PARAMETER UserSearchBase
    LDAP search base for user attribute verification. Defaults to OU=wisibility under domain DN in dev mode.

.PARAMETER GroupSearchBase
    LDAP search base for group attribute verification. Defaults to OU=Security,OU=Groups,OU=wisibility in dev mode.

.PARAMETER ComputerSearchBase
    LDAP search base for computer attribute verification. Defaults to OU=Computers,OU=wisibility in dev mode.

.PARAMETER SeedSummaryPath
    Path to SeedSummary.json for expected counts. Defaults to SeedSummary.json beside this script.

.EXAMPLE
    .\Verify-Wisibility.ps1

.EXAMPLE
    .\Verify-Wisibility.ps1 -GroupSearchBase 'OU=Security,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl'

.EXAMPLE
    .\Verify-Wisibility.ps1 -ProductionMode
#>
[CmdletBinding()]
param(
    [string]$Server = '192.168.68.107',
    [string]$Username = 'icmadmin@wisibility.lcl',
    [switch]$ProductionMode,
    [string]$UserSearchBase = '',
    [string]$GroupSearchBase = '',
    [string]$ComputerSearchBase = '',
    [string]$SeedSummaryPath = (Join-Path $PSScriptRoot 'SeedSummary.json'),
    [int]$InactiveComputerDays = 90,
    [int]$DormantPrivilegedDays = 90,
    [int]$ExcessivePrivilegeThreshold = 3,
    [string[]]$UnsupportedOsTokens = @(
        'windows xp', 'windows 7', 'windows server 2003', 'windows server 2008'
    ),
    [string[]]$WorkstationOuPatterns = @(
        'ou=workstations', 'ou=desktop', 'ou=desktops', 'ou=laptops'
    ),
    [string]$OutputRoot = (Join-Path $PSScriptRoot 'VerificationReports')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ProductionMode = [bool]$ProductionMode
$script:UserSearchBaseParam = $UserSearchBase
$script:GroupSearchBaseParam = $GroupSearchBase
$script:ComputerSearchBaseParam = $ComputerSearchBase
$script:SeedSummaryPath = $SeedSummaryPath

. (Join-Path $PSScriptRoot 'Verify-FrameworkHelpers.ps1')
$script:FrameworkRoot = $PSScriptRoot

#region Configuration

# UAC bit flags (Microsoft AD semantics)
$script:UacDisabled              = 0x2
$script:UacLockout               = 0x10
$script:UacPasswordNotRequired   = 0x20
$script:UacReversibleEncryption  = 0x80
$script:UacPasswordNeverExpires  = 0x10000
$script:UacSmartcardRequired     = 0x40000
$script:UacTrustedForDelegation  = 0x80000
$script:UacTrustedToAuthForDel   = 0x1000000
$script:UacDontRequirePreauth    = 0x400000

$script:PrivilegedGroupNames = @(
    'Domain Admins',
    'Enterprise Admins',
    'Schema Admins',
    'Administrators',
    'Account Operators',
    'Backup Operators',
    'Server Operators',
    'Print Operators'
)

# Extensible toxic privilege SoD rules (all listed groups must be reachable)
$script:ToxicPrivilegeRules = @(
    [PSCustomObject]@{ RuleName = 'Domain Admins + Backup Operators'; RequiredGroups = @('Domain Admins', 'Backup Operators') }
    [PSCustomObject]@{ RuleName = 'Domain Admins + Account Operators'; RequiredGroups = @('Domain Admins', 'Account Operators') }
    [PSCustomObject]@{ RuleName = 'Domain Admins + Server Operators'; RequiredGroups = @('Domain Admins', 'Server Operators') }
    [PSCustomObject]@{ RuleName = 'Enterprise Admins + Schema Admins'; RequiredGroups = @('Enterprise Admins', 'Schema Admins') }
    [PSCustomObject]@{ RuleName = 'Domain Admins + Print Operators'; RequiredGroups = @('Domain Admins', 'Print Operators') }
)

$script:ShadowAdminAceMasks = @(
    0x10000000  # GENERIC_ALL
    0x40000000  # GENERIC_WRITE
    0x00040000  # WRITE_DAC
    0x00080000  # WRITE_OWNER
)

$script:AdDomainDn = $null
$script:AdServer = $null
$script:AdCredential = $null
$script:DomainCatalog = $null
$script:GroupCatalog = $null
$script:PrivilegeGraph = $null
$script:AclModuleSupported = $false
$script:AclSkipReason = ''

#endregion

#region Helpers

function Write-VerificationLog {
    param(
        [Parameter(Mandatory)]
        [string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')]
        [string]$Level = 'INFO'
    )
    if (-not $script:LogPath) { return }
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $script:LogPath -Value $line -Encoding UTF8
}

function Format-ExecutionTime {
    param([TimeSpan]$Elapsed)
    if ($Elapsed.TotalSeconds -ge 60) {
        return ('{0:N1} min' -f $Elapsed.TotalMinutes)
    }
    return ('{0:N1} sec' -f $Elapsed.TotalSeconds)
}

function New-VerificationResult {
    param(
        [string]$Feature,
        [int]$Count = 0,
        [array]$Records = @(),
        [string]$ExecutionTime = '',
        [ValidateSet('PASS', 'FAIL', 'SKIP')]
        [string]$Status = 'PASS',
        [string]$Error = '',
        [string]$WorksheetName = '',
        [string]$CsvFileName = '',
        [int]$ExpectedCount = 0,
        [array]$ExpectedObjects = @(),
        [array]$ActualObjects = @()
    )
    [PSCustomObject]@{
        Feature         = $Feature
        Count           = $Count
        ActualCount     = $Count
        ExpectedCount   = $ExpectedCount
        ExpectedObjects = @($ExpectedObjects)
        ActualObjects   = @($ActualObjects)
        Records         = @($Records)
        ExecutionTime   = $ExecutionTime
        Status          = $Status
        Error           = $Error
        WorksheetName   = $WorksheetName
        CsvFileName     = $CsvFileName
    }
}

function Get-AdSplat {
    return @{
        Server     = $script:AdServer
        Credential = $script:AdCredential
    }
}

function Test-UacFlag {
    param(
        [object]$UserAccountControl,
        [int]$Flag
    )
    $uac = 0
    if ($null -ne $UserAccountControl -and $UserAccountControl -ne '') {
        $uac = [int]$UserAccountControl
    }
    return (($uac -band $Flag) -eq $Flag)
}

function ConvertFrom-AdFileTime {
    param([object]$FileTime)
    if ($null -eq $FileTime -or $FileTime -eq '' -or [int64]$FileTime -le 0) {
        return $null
    }
    try {
        return [datetime]::FromFileTime([int64]$FileTime)
    }
    catch {
        return $null
    }
}

function Get-EnabledUserFilter {
    return '(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))'
}

function Get-EnabledComputerFilter {
    return '(&(objectCategory=computer)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))'
}

function Get-AdDomainDn {
    if (-not $script:AdDomainDn) {
        $ad = Get-AdSplat
        $script:AdDomainDn = (Get-ADDomain @ad).DistinguishedName
    }
    return $script:AdDomainDn
}

function Normalize-LdapDn {
    param([string]$Dn)
    return ([string]$Dn).Trim().ToLowerInvariant()
}

function Test-DnUnderSearchBase {
    param(
        [string]$DistinguishedName,
        [string]$SearchBase
    )
    $dn = Normalize-LdapDn $DistinguishedName
    $base = Normalize-LdapDn $SearchBase
    if (-not $dn -or -not $base) { return $false }
    return ($dn -eq $base) -or $dn.EndsWith(",$base")
}

function Format-AdDateTime {
    param([object]$FileTime)
    $dt = ConvertFrom-AdFileTime -FileTime $FileTime
    if ($dt) { return $dt.ToString('yyyy-MM-dd HH:mm:ss') }
    return 'Never / Not Set'
}

function Test-IsInactiveByFileTime {
    param(
        [object]$LastLogonTimestamp,
        [int]$ThresholdDays
    )
    $last = ConvertFrom-AdFileTime -FileTime $LastLogonTimestamp
    if (-not $last) { return $false }
    $cutoff = (Get-Date).AddDays(-1 * $ThresholdDays)
    return ($last -le $cutoff)
}

function Test-IsLockedAccount {
    param(
        [object]$LockoutTime,
        [object]$UserAccountControl
    )
    if ($null -ne $LockoutTime -and $LockoutTime -ne '' -and [int64]$LockoutTime -gt 0) {
        return $true
    }
    return (Test-UacFlag -UserAccountControl $UserAccountControl -Flag $script:UacLockout)
}

function Test-IsServerOperatingSystem {
    param([string]$OperatingSystem)
    if (-not $OperatingSystem) { return $false }
    return ($OperatingSystem -match '(?i)server')
}

function Test-IsUnsupportedOperatingSystem {
    param(
        [string]$OperatingSystem,
        [string]$OperatingSystemVersion
    )
    $combined = ('{0} {1}' -f $OperatingSystem, $OperatingSystemVersion).ToLowerInvariant()
    foreach ($token in $UnsupportedOsTokens) {
        if ($combined.Contains($token.ToLowerInvariant())) { return $true }
    }
    return $false
}

function Test-IsWorkstationOu {
    param([string]$DistinguishedName)
    $dn = Normalize-LdapDn $DistinguishedName
    foreach ($pattern in $WorkstationOuPatterns) {
        if ($dn.Contains($pattern.ToLowerInvariant())) { return $true }
    }
    return $false
}

function Test-IsMalformedSpn {
    param([string]$Spn)
    if (-not $Spn -or -not $Spn.Trim()) { return $true }
    if ($Spn -match '[\s<>"]') { return $true }
    $parts = $Spn -split '/', 2
    if ($parts.Count -lt 2) { return $true }
    if (-not $parts[0].Trim() -or -not $parts[1].Trim()) { return $true }
    return $false
}

function ConvertFrom-SidBytes {
    param([byte[]]$Bytes)
    if (-not $Bytes -or $Bytes.Count -lt 1) { return $null }
    try {
        return (New-Object System.Security.Principal.SecurityIdentifier($Bytes, 0)).Value
    }
    catch {
        return $null
    }
}

function ConvertFrom-SidString {
    param([string]$SidString)
    if (-not $SidString) { return $null }
    try {
        return (New-Object System.Security.Principal.SecurityIdentifier($SidString)).Value
    }
    catch {
        return $SidString
    }
}

function Get-LdapEntryValue {
    param(
        $Entry,
        [Parameter(Mandatory)]
        [string]$Name
    )
    if (-not $Entry.Attributes.Contains($Name)) { return $null }
    $attr = $Entry.Attributes[$Name]
    if ($attr.Count -eq 0) { return $null }
    return $attr[0]
}

function Get-LdapEntryValues {
    param(
        $Entry,
        [Parameter(Mandatory)]
        [string]$Name
    )
    if (-not $Entry.Attributes.Contains($Name)) { return @() }
    return @($Entry.Attributes[$Name].GetValues([string]))
}

function ConvertFrom-LdapGeneralizedTime {
    param([object]$Value)
    if ($null -eq $Value -or $Value -eq '') { return $null }
    try {
        return [datetime]::Parse([string]$Value)
    }
    catch {
        return [string]$Value
    }
}

function Resolve-LdapUserAttributes {
    param([Parameter(Mandatory)][string[]]$Properties)

    $map = @{
        SamAccountName       = 'sAMAccountName'
        UserPrincipalName    = 'userPrincipalName'
        DisplayName          = 'displayName'
        UserAccountControl   = 'userAccountControl'
        LastLogonTimestamp   = 'lastLogonTimestamp'
        LockoutTime          = 'lockoutTime'
        PasswordLastSet      = 'pwdLastSet'
        whenCreated          = 'whenCreated'
        whenChanged          = 'whenChanged'
        ServicePrincipalName = 'servicePrincipalName'
        MemberOf             = 'memberOf'
        ObjectSid            = 'objectSid'
        SidHistory           = 'sIDHistory'
        ManagedBy            = 'managedBy'
        AllowedToDelegateTo  = 'msDS-AllowedToDelegateTo'
        AllowedToActOnBehalf = 'msDS-AllowedToActOnBehalfOfOtherIdentity'
        'msDS-AllowedToDelegateTo' = 'msDS-AllowedToDelegateTo'
        'msDS-AllowedToActOnBehalfOfOtherIdentity' = 'msDS-AllowedToActOnBehalfOfOtherIdentity'
        Enabled              = $null
        DistinguishedName    = $null
    }

    $attrs = [System.Collections.Generic.List[string]]::new()
    foreach ($prop in $Properties) {
        if ($map.ContainsKey($prop)) {
            if ($map[$prop]) { [void]$attrs.Add($map[$prop]) }
            continue
        }
        [void]$attrs.Add($prop)
    }

    if (($Properties -contains 'Enabled') -and -not ($attrs -contains 'userAccountControl')) {
        [void]$attrs.Add('userAccountControl')
    }

    return @($attrs | Select-Object -Unique)
}

function Resolve-LdapComputerAttributes {
    param([Parameter(Mandatory)][string[]]$Properties)

    $map = @{
        Name                   = 'name'
        SamAccountName         = 'sAMAccountName'
        UserAccountControl     = 'userAccountControl'
        LastLogonTimestamp     = 'lastLogonTimestamp'
        OperatingSystem        = 'operatingSystem'
        OperatingSystemVersion = 'operatingSystemVersion'
        whenCreated            = 'whenCreated'
        ServicePrincipalName   = 'servicePrincipalName'
        ManagedBy              = 'managedBy'
        AllowedToDelegateTo    = 'msDS-AllowedToDelegateTo'
        AllowedToActOnBehalf   = 'msDS-AllowedToActOnBehalfOfOtherIdentity'
        'msDS-AllowedToDelegateTo' = 'msDS-AllowedToDelegateTo'
        'msDS-AllowedToActOnBehalfOfOtherIdentity' = 'msDS-AllowedToActOnBehalfOfOtherIdentity'
        ObjectSid              = 'objectSid'
        Enabled                = $null
        DistinguishedName      = $null
    }

    $attrs = [System.Collections.Generic.List[string]]::new()
    foreach ($prop in $Properties) {
        if ($map.ContainsKey($prop)) {
            if ($map[$prop]) { [void]$attrs.Add($map[$prop]) }
            continue
        }
        [void]$attrs.Add($prop)
    }

    if (($Properties -contains 'Enabled') -and -not ($attrs -contains 'userAccountControl')) {
        [void]$attrs.Add('userAccountControl')
    }

    return @($attrs | Select-Object -Unique)
}

function ConvertFrom-LdapUserEntry {
    param($Entry)

    $uacRaw = Get-LdapEntryValue -Entry $Entry -Name 'userAccountControl'
    $uac = if ($null -ne $uacRaw -and $uacRaw -ne '') { [int]$uacRaw } else { 0 }

    $pwdRaw = Get-LdapEntryValue -Entry $Entry -Name 'pwdLastSet'
    $passwordLastSet = $null
    if ($null -ne $pwdRaw -and $pwdRaw -ne '' -and [int64]$pwdRaw -gt 0) {
        try { $passwordLastSet = [datetime]::FromFileTime([int64]$pwdRaw) }
        catch { $passwordLastSet = $null }
    }

    $sidBytes = $null
    if ($Entry.Attributes.Contains('objectSid')) {
        $sidBytes = $Entry.Attributes['objectSid'][0]
    }
    $sid = ConvertFrom-SidBytes -Bytes $sidBytes

    $sidHistory = @()
    if ($Entry.Attributes.Contains('sIDHistory')) {
        foreach ($hist in @($Entry.Attributes['sIDHistory'])) {
            $histSid = ConvertFrom-SidBytes -Bytes $hist
            if ($histSid) { [void]$sidHistory.Add($histSid) }
        }
    }

    return [PSCustomObject]@{
        SamAccountName       = Get-LdapEntryValue -Entry $Entry -Name 'sAMAccountName'
        UserPrincipalName    = Get-LdapEntryValue -Entry $Entry -Name 'userPrincipalName'
        DisplayName          = Get-LdapEntryValue -Entry $Entry -Name 'displayName'
        Enabled              = -not (Test-UacFlag -UserAccountControl $uac -Flag $script:UacDisabled)
        UserAccountControl   = $uac
        DistinguishedName    = $Entry.DistinguishedName
        LastLogonTimestamp   = Get-LdapEntryValue -Entry $Entry -Name 'lastLogonTimestamp'
        LockoutTime          = Get-LdapEntryValue -Entry $Entry -Name 'lockoutTime'
        PasswordLastSet      = $passwordLastSet
        whenCreated          = ConvertFrom-LdapGeneralizedTime -Value (Get-LdapEntryValue -Entry $Entry -Name 'whenCreated')
        whenChanged          = ConvertFrom-LdapGeneralizedTime -Value (Get-LdapEntryValue -Entry $Entry -Name 'whenChanged')
        ServicePrincipalName = @(Get-LdapEntryValues -Entry $Entry -Name 'servicePrincipalName')
        MemberOf             = @(Get-LdapEntryValues -Entry $Entry -Name 'memberOf')
        ObjectSid            = $sid
        SidHistory           = @($sidHistory)
        ManagedBy            = Get-LdapEntryValue -Entry $Entry -Name 'managedBy'
        AllowedToDelegateTo  = @(Get-LdapEntryValues -Entry $Entry -Name 'msDS-AllowedToDelegateTo')
        AllowedToActOnBehalf = @(Get-LdapEntryValues -Entry $Entry -Name 'msDS-AllowedToActOnBehalfOfOtherIdentity')
    }
}

function Get-GroupCategoryScopeFromType {
    param([object]$GroupTypeRaw)

    if ($null -eq $GroupTypeRaw -or $GroupTypeRaw -eq '') {
        return @{
            GroupCategory = ''
            GroupScope    = ''
        }
    }

    $groupType = [int]$GroupTypeRaw
    $category = if (($groupType -band 0x80000000) -ne 0) { 'Security' } else { 'Distribution' }
    $scope = switch ($groupType -band 0x00000007) {
        0x00000001 { 'BuiltIn' }
        0x00000002 { 'Global' }
        0x00000004 { 'DomainLocal' }
        0x00000008 { 'Universal' }
        default { 'Unknown' }
    }

    return @{
        GroupCategory = $category
        GroupScope    = $scope
    }
}

function Get-LdapEntryMemberDns {
    param($Entry)

    $members = [System.Collections.Generic.List[string]]::new()
    foreach ($attrName in $Entry.Attributes.Keys) {
        if ($attrName -eq 'member' -or $attrName -like 'member;range=*') {
            foreach ($value in @($Entry.Attributes[$attrName].GetValues([string]))) {
                [void]$members.Add([string]$value)
            }
        }
    }

    return @($members.ToArray())
}

function Test-LdapMembersLikelyTruncated {
    param($Entry)

    foreach ($attrName in $Entry.Attributes.Keys) {
        if ($attrName -notlike 'member;range=*') { continue }

        if ($attrName -match 'member;range=(\d+)-(\d+|\*)') {
            $start = [int]$Matches[1]
            $endToken = $Matches[2]
            $values = @($Entry.Attributes[$attrName].GetValues([string]))
            if ($endToken -eq '*') { return $false }
            $end = [int]$endToken
            if ($values.Count -ge ($end - $start + 1)) { return $true }
        }
    }

    return $false
}

function Get-GroupMemberDnsByRange {
    param(
        [Parameter(Mandatory)]
        [string]$GroupDn
    )

    Add-Type -AssemblyName System.DirectoryServices.Protocols

    $nc = $script:AdCredential.GetNetworkCredential()
    $identifier = New-Object System.DirectoryServices.Protocols.LdapDirectoryIdentifier($script:AdServer, 389)
    $conn = New-Object System.DirectoryServices.Protocols.LdapConnection($identifier)
    $conn.SessionOptions.Sealing = $true
    $conn.SessionOptions.Signing = $true
    $conn.Credential = New-Object System.Net.NetworkCredential($nc.UserName, $nc.Password)
    $conn.AuthType = [System.DirectoryServices.Protocols.AuthType]::Negotiate
    $conn.Bind()

    $members = [System.Collections.Generic.List[string]]::new()
    $rangeStart = 0
    $pageSize = 1500

    try {
        while ($true) {
            $rangeEnd = $rangeStart + $pageSize - 1
            $attrName = "member;range=$rangeStart-$rangeEnd"
            $request = New-Object System.DirectoryServices.Protocols.SearchRequest(
                $GroupDn,
                '(objectClass=*)',
                [System.DirectoryServices.Protocols.SearchScope]::Base,
                @($attrName)
            )
            $response = $conn.SendRequest($request)
            if ($response.Entries.Count -eq 0) { break }

            $entry = $response.Entries[0]
            $foundAttr = $false
            foreach ($key in $entry.Attributes.Keys) {
                if ($key -ne 'member' -and $key -notlike 'member;range=*') { continue }

                $foundAttr = $true
                $values = @($entry.Attributes[$key].GetValues([string]))
                foreach ($value in $values) {
                    [void]$members.Add([string]$value)
                }

                if ($key -eq 'member') {
                    return @($members.ToArray())
                }

                if ($key -match 'member;range=(\d+)-(\d+|\*)') {
                    $endToken = $Matches[2]
                    if ($endToken -eq '*') {
                        return @($members.ToArray())
                    }
                    $start = [int]$Matches[1]
                    $end = [int]$endToken
                    if ($values.Count -lt ($end - $start + 1)) {
                        return @($members.ToArray())
                    }
                }
            }

            if (-not $foundAttr) { break }
            $rangeStart += $pageSize
        }
    }
    finally {
        $conn.Dispose()
    }

    return @($members.ToArray())
}

function Resolve-LdapGroupAttributes {
    param([Parameter(Mandatory)][string[]]$Properties)

    $map = @{
        Name              = 'cn'
        SamAccountName    = 'sAMAccountName'
        GroupCategory     = 'groupType'
        GroupScope        = 'groupType'
        DistinguishedName = $null
        Description       = 'description'
        ManagedBy         = 'managedBy'
        MemberOf          = 'memberOf'
        Members           = 'member'
        ObjectGuid        = 'objectGUID'
        ObjectSid         = 'objectSid'
        whenCreated       = 'whenCreated'
        whenChanged       = 'whenChanged'
    }

    $attrs = [System.Collections.Generic.List[string]]::new()
    foreach ($prop in $Properties) {
        if ($map.ContainsKey($prop)) {
            if ($map[$prop]) { [void]$attrs.Add($map[$prop]) }
            continue
        }
        [void]$attrs.Add($prop)
    }

    return @($attrs | Select-Object -Unique)
}

function ConvertFrom-LdapGroupEntry {
    param($Entry)

    $gtInfo = Get-GroupCategoryScopeFromType -GroupTypeRaw (Get-LdapEntryValue -Entry $Entry -Name 'groupType')

    $guidBytes = $null
    if ($Entry.Attributes.Contains('objectGUID')) {
        $guidBytes = $Entry.Attributes['objectGUID'][0]
    }
    $guid = if ($guidBytes) { [guid]::New($guidBytes).ToString() } else { $null }

    $sidBytes = $null
    if ($Entry.Attributes.Contains('objectSid')) {
        $sidBytes = $Entry.Attributes['objectSid'][0]
    }

    return [PSCustomObject]@{
        Name              = Get-LdapEntryValue -Entry $Entry -Name 'cn'
        SamAccountName    = Get-LdapEntryValue -Entry $Entry -Name 'sAMAccountName'
        GroupCategory     = $gtInfo.GroupCategory
        GroupScope        = $gtInfo.GroupScope
        DistinguishedName = $Entry.DistinguishedName
        Description       = Get-LdapEntryValue -Entry $Entry -Name 'description'
        ManagedBy         = Get-LdapEntryValue -Entry $Entry -Name 'managedBy'
        MemberOf          = @(Get-LdapEntryValues -Entry $Entry -Name 'memberOf')
        Members           = @(Get-LdapEntryMemberDns -Entry $Entry)
        ObjectGuid        = $guid
        ObjectSid         = ConvertFrom-SidBytes -Bytes $sidBytes
        whenCreated       = ConvertFrom-LdapGeneralizedTime -Value (Get-LdapEntryValue -Entry $Entry -Name 'whenCreated')
        whenChanged       = ConvertFrom-LdapGeneralizedTime -Value (Get-LdapEntryValue -Entry $Entry -Name 'whenChanged')
    }
}

function ConvertFrom-LdapComputerEntry {
    param($Entry)

    $uacRaw = Get-LdapEntryValue -Entry $Entry -Name 'userAccountControl'
    $uac = if ($null -ne $uacRaw -and $uacRaw -ne '') { [int]$uacRaw } else { 0 }

    $sidBytes = $null
    if ($Entry.Attributes.Contains('objectSid')) {
        $sidBytes = $Entry.Attributes['objectSid'][0]
    }

    return [PSCustomObject]@{
        Name                   = Get-LdapEntryValue -Entry $Entry -Name 'name'
        SamAccountName         = Get-LdapEntryValue -Entry $Entry -Name 'sAMAccountName'
        Enabled                = -not (Test-UacFlag -UserAccountControl $uac -Flag $script:UacDisabled)
        UserAccountControl     = $uac
        DistinguishedName      = $Entry.DistinguishedName
        OperatingSystem        = Get-LdapEntryValue -Entry $Entry -Name 'operatingSystem'
        OperatingSystemVersion = Get-LdapEntryValue -Entry $Entry -Name 'operatingSystemVersion'
        LastLogonTimestamp     = Get-LdapEntryValue -Entry $Entry -Name 'lastLogonTimestamp'
        whenCreated            = ConvertFrom-LdapGeneralizedTime -Value (Get-LdapEntryValue -Entry $Entry -Name 'whenCreated')
        ServicePrincipalName   = @(Get-LdapEntryValues -Entry $Entry -Name 'servicePrincipalName')
        ManagedBy              = Get-LdapEntryValue -Entry $Entry -Name 'managedBy'
        AllowedToDelegateTo    = @(Get-LdapEntryValues -Entry $Entry -Name 'msDS-AllowedToDelegateTo')
        AllowedToActOnBehalf   = @(Get-LdapEntryValues -Entry $Entry -Name 'msDS-AllowedToActOnBehalfOfOtherIdentity')
        ObjectSid              = ConvertFrom-SidBytes -Bytes $sidBytes
    }
}

function Invoke-PagedLdapSearch {
    param(
        [Parameter(Mandatory)]
        [string]$SearchBase,
        [Parameter(Mandatory)]
        [string]$LdapFilter,
        [Parameter(Mandatory)]
        [string[]]$AttributeNames,
        [Parameter(Mandatory)]
        [string]$StatusMessage,
        [Parameter(Mandatory)]
        [scriptblock]$MapEntry,
        [int]$PageSize = 1000
    )

    Write-Host "  $StatusMessage" -ForegroundColor DarkYellow
    Write-VerificationLog -Message $StatusMessage
    Write-VerificationLog -Message ("LDAP filter: {0}" -f $LdapFilter)

    Add-Type -AssemblyName System.DirectoryServices.Protocols

    $nc = $script:AdCredential.GetNetworkCredential()
    $identifier = New-Object System.DirectoryServices.Protocols.LdapDirectoryIdentifier($script:AdServer, 389)
    $conn = New-Object System.DirectoryServices.Protocols.LdapConnection($identifier)
    $conn.SessionOptions.Sealing = $true
    $conn.SessionOptions.Signing = $true
    $conn.Credential = New-Object System.Net.NetworkCredential($nc.UserName, $nc.Password)
    $conn.AuthType = [System.DirectoryServices.Protocols.AuthType]::Negotiate
    $conn.Bind()

    $attrs = @($AttributeNames | Where-Object { $_ } | Select-Object -Unique)
    $request = New-Object System.DirectoryServices.Protocols.SearchRequest(
        $SearchBase,
        $LdapFilter,
        [System.DirectoryServices.Protocols.SearchScope]::Subtree,
        $attrs
    )
    $pageControl = New-Object System.DirectoryServices.Protocols.PageResultRequestControl($PageSize)
    [void]$request.Controls.Add($pageControl)

    $all = [System.Collections.Generic.List[object]]::new()

    while ($true) {
        $response = $conn.SendRequest($request)
        foreach ($entry in $response.Entries) {
            $mapped = & $MapEntry $entry
            [void]$all.Add($mapped)
        }
        Write-Host ("  Retrieved {0} objects so far..." -f $all.Count) -ForegroundColor DarkGray

        $pageResponse = $null
        foreach ($ctrl in $response.Controls) {
            if ($ctrl -is [System.DirectoryServices.Protocols.PageResultResponseControl]) {
                $pageResponse = $ctrl
                break
            }
        }
        if (-not $pageResponse -or $pageResponse.Cookie.Length -eq 0) { break }
        $pageControl.Cookie = $pageResponse.Cookie
    }

    $conn.Dispose()
    Write-VerificationLog -Message ("LDAP search finished: {0} objects" -f $all.Count)
    return @($all.ToArray())
}

function Invoke-AdUserSearch {
    param(
        [Parameter(Mandatory)]
        [string]$LdapFilter,
        [Parameter(Mandatory)]
        [string[]]$Properties,
        [string]$SearchBase = '',
        [string]$StatusMessage = 'Querying Active Directory...'
    )

    if (-not $SearchBase) { $SearchBase = Get-EffectiveUserSearchBase }
    $attrs = Resolve-LdapUserAttributes -Properties $Properties
    return Invoke-PagedLdapSearch -SearchBase $SearchBase -LdapFilter $LdapFilter `
        -AttributeNames $attrs -StatusMessage $StatusMessage `
        -MapEntry { param($Entry) ConvertFrom-LdapUserEntry -Entry $Entry }
}

function Invoke-AdComputerSearch {
    param(
        [Parameter(Mandatory)]
        [string]$LdapFilter,
        [Parameter(Mandatory)]
        [string[]]$Properties,
        [string]$SearchBase = '',
        [string]$StatusMessage = 'Querying Active Directory...'
    )

    if (-not $SearchBase) { $SearchBase = Get-EffectiveComputerSearchBase }
    $attrs = Resolve-LdapComputerAttributes -Properties $Properties
    return Invoke-PagedLdapSearch -SearchBase $SearchBase -LdapFilter $LdapFilter `
        -AttributeNames $attrs -StatusMessage $StatusMessage `
        -MapEntry { param($Entry) ConvertFrom-LdapComputerEntry -Entry $Entry }
}

function Invoke-AdGroupSearch {
    param(
        [Parameter(Mandatory)]
        [string]$LdapFilter,
        [Parameter(Mandatory)]
        [string[]]$Properties,
        [string]$SearchBase = '',
        [string]$StatusMessage = 'Querying Active Directory...'
    )

    if (-not $SearchBase) { $SearchBase = Get-EffectiveGroupSearchBase }
    $attrs = Resolve-LdapGroupAttributes -Properties $Properties
    return Invoke-PagedLdapSearch -SearchBase $SearchBase -LdapFilter $LdapFilter `
        -AttributeNames $attrs -StatusMessage $StatusMessage `
        -MapEntry { param($Entry) ConvertFrom-LdapGroupEntry -Entry $Entry }
}

function Write-ModuleHeader {
    param(
        [int]$Index,
        [int]$Total,
        [string]$FeatureName
    )
    Write-Host ('[{0}/{1}]' -f $Index, $Total) -ForegroundColor Yellow
    Write-Host $FeatureName -ForegroundColor Yellow
    Write-Progress -Activity 'Wisibility AD Verification' `
        -Status $FeatureName `
        -PercentComplete ([math]::Min(99, [int](($Index / $Total) * 100)))
}

function Write-ModuleSuccess {
    param(
        [int]$Count,
        [string]$ExecutionTime,
        [string]$Status = 'PASS'
    )
    if ($Status -eq 'SKIP') {
        Write-Host 'SKIPPED' -ForegroundColor Yellow
    }
    else {
        Write-Host 'Completed' -ForegroundColor Green
        Write-Host ('{0} Found' -f $Count) -ForegroundColor Green
    }
    Write-Host ('Execution Time {0}' -f $ExecutionTime) -ForegroundColor Green
    Write-Host '-----------------------------------' -ForegroundColor DarkGray
}

function Write-ModuleFailure {
    param([string]$Message)
    Write-Host 'FAILED' -ForegroundColor Red
    Write-Host $Message -ForegroundColor Red
    Write-Host '-----------------------------------' -ForegroundColor DarkGray
}

function Invoke-VerificationModule {
    param(
        [Parameter(Mandatory)]
        [int]$Index,
        [Parameter(Mandatory)]
        [int]$Total,
        [Parameter(Mandatory)]
        [string]$FeatureName,
        [Parameter(Mandatory)]
        [scriptblock]$ScriptBlock
    )

    Write-ModuleHeader -Index $Index -Total $Total -FeatureName $FeatureName
    Write-VerificationLog -Message "Starting module: $FeatureName"

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $result = & $ScriptBlock
        $sw.Stop()
        if (-not $result.ExecutionTime) {
            $result.ExecutionTime = Format-ExecutionTime -Elapsed $sw.Elapsed
        }
        if (-not $result.Status) { $result.Status = 'PASS' }

        if ($result.Status -ne 'SKIP') {
            $result.Records = @(Select-SeededVerificationRecords -Records @($result.Records))
            $result.Count = @($result.Records).Count
            $result = Complete-VerificationResult -Result $result
        }
        else {
            if ($null -eq $result.ActualCount) { $result | Add-Member -NotePropertyName ActualCount -NotePropertyValue 0 -Force }
            if ($null -eq $result.ExpectedCount) { $result | Add-Member -NotePropertyName ExpectedCount -NotePropertyValue 0 -Force }
        }

        $displayCount = if ($null -ne $result.ActualCount) { $result.ActualCount } else { $result.Count }
        Write-ModuleSuccess -Count $displayCount -ExecutionTime $result.ExecutionTime -Status $result.Status
        if ($result.Status -ne 'SKIP') {
            Write-Host ('Expected {0} / Actual {1} — {2}' -f $result.ExpectedCount, $result.ActualCount, $result.Status) -ForegroundColor $(if ($result.Status -eq 'PASS') { 'Green' } else { 'Red' })
            Write-VerificationLog -Message ("Completed {0}: Expected={1} Actual={2} Status={3} Duration={4}" -f `
                $FeatureName, $result.ExpectedCount, $result.ActualCount, $result.Status, $result.ExecutionTime)
        }
        else {
            Write-VerificationLog -Message ("Skipped {0}: Duration={1}" -f $FeatureName, $result.ExecutionTime)
        }
        return $result
    }
    catch {
        $sw.Stop()
        $msg = $_.Exception.Message
        Write-ModuleFailure -Message $msg
        Write-VerificationLog -Message ("Failed {0}: {1}" -f $FeatureName, $msg) -Level 'ERROR'
        return (New-VerificationResult -Feature $FeatureName -Status 'FAIL' -Error $msg `
            -ExecutionTime (Format-ExecutionTime -Elapsed $sw.Elapsed))
    }
}

function Add-MapListValue {
    param(
        [System.Collections.Generic.Dictionary[string, System.Collections.Generic.List[string]]]$Map,
        [string]$Key,
        [string]$Value
    )
    $normKey = Normalize-LdapDn $Key
    if (-not $normKey) { return }
    if (-not $Map.ContainsKey($normKey)) {
        $Map[$normKey] = [System.Collections.Generic.List[string]]::new()
    }
    $list = $Map[$normKey]
    $normValue = Normalize-LdapDn $Value
    foreach ($existing in $list) {
        if ((Normalize-LdapDn $existing) -eq $normValue) { return }
    }
    [void]$list.Add($Value)
}

function Get-MapListCount {
    param(
        [System.Collections.Generic.Dictionary[string, System.Collections.Generic.List[string]]]$Map,
        [string]$Key
    )
    $normKey = Normalize-LdapDn $Key
    if (-not $normKey) { return 0 }
    if (-not $Map.ContainsKey($normKey)) { return 0 }
    return $Map[$normKey].Count
}

function Initialize-DomainCatalog {
    if ($script:DomainCatalog) { return $script:DomainCatalog }

    Initialize-SearchBases | Out-Null
    $bases = $script:SearchBases

    Write-Host ''
    $modeLabel = if ($script:ProductionMode) { 'Production' } else { 'Development' }
    Write-Host ("Loading catalog [{0} mode] (single LDAP pass per object type)..." -f $modeLabel) -ForegroundColor Yellow
    Write-VerificationLog -Message ("Initializing domain catalog Mode={0}" -f $modeLabel)

    $userFilter = '(&(objectCategory=person)(objectClass=user))'
    $users = Invoke-AdUserSearch -LdapFilter $userFilter -SearchBase $bases.User `
        -StatusMessage ("Loading users from {0}..." -f $bases.User) `
        -Properties @(
            'SamAccountName', 'UserPrincipalName', 'DisplayName', 'Enabled', 'UserAccountControl',
            'DistinguishedName', 'LastLogonTimestamp', 'LockoutTime', 'ServicePrincipalName',
            'MemberOf', 'ObjectSid', 'SidHistory', 'AllowedToDelegateTo', 'AllowedToActOnBehalf'
        )

    $computerFilter = '(&(objectCategory=computer))'
    $computers = Invoke-AdComputerSearch -LdapFilter $computerFilter -SearchBase $bases.Computer `
        -StatusMessage ("Loading computers from {0}..." -f $bases.Computer) `
        -Properties @(
            'Name', 'SamAccountName', 'Enabled', 'UserAccountControl', 'DistinguishedName',
            'LastLogonTimestamp', 'OperatingSystem', 'OperatingSystemVersion', 'ServicePrincipalName',
            'ManagedBy', 'AllowedToDelegateTo', 'AllowedToActOnBehalf', 'ObjectSid'
        )

    $groupFilter = '(&(objectCategory=group)(objectClass=group))'
    $graphGroupBase = Get-EffectiveGraphGroupSearchBase
    $groupEntries = Invoke-PagedLdapSearch -SearchBase $graphGroupBase -LdapFilter $groupFilter `
        -AttributeNames @('cn', 'groupType', 'member', 'sAMAccountName', 'managedBy', 'description', 'memberOf', 'objectGUID', 'objectSid') `
        -StatusMessage ("Loading groups from {0}..." -f $graphGroupBase) `
        -MapEntry { param($Entry) $Entry }

    $allGroups = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $groupEntries) {
        $g = ConvertFrom-LdapGroupEntry -Entry $entry
        if (@($g.Members).Count -eq 0 -and (Test-LdapMembersLikelyTruncated -Entry $entry)) {
            $g = [PSCustomObject]@{
                Name              = $g.Name
                SamAccountName    = $g.SamAccountName
                GroupCategory     = $g.GroupCategory
                GroupScope        = $g.GroupScope
                DistinguishedName = $g.DistinguishedName
                Description       = $g.Description
                ManagedBy         = $g.ManagedBy
                MemberOf          = @($g.MemberOf)
                Members           = @(Get-GroupMemberDnsByRange -GroupDn $g.DistinguishedName)
                ObjectGuid        = $g.ObjectGuid
                ObjectSid         = $g.ObjectSid
                whenCreated       = $g.whenCreated
                whenChanged       = $g.whenChanged
            }
        }
        [void]$allGroups.Add($g)
    }
    $allGroups = @($allGroups.ToArray())

    $groupDnSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $groupByDn = @{}
    $parentGroupMap = New-Object 'System.Collections.Generic.Dictionary[string, System.Collections.Generic.List[string]]' ([StringComparer]::OrdinalIgnoreCase)
    $childGroupMap = New-Object 'System.Collections.Generic.Dictionary[string, System.Collections.Generic.List[string]]' ([StringComparer]::OrdinalIgnoreCase)
    $nestedAdj = @{}
    $globalSpnIndex = @{}
    $sidRegistry = @{}

    foreach ($g in $allGroups) {
        [void]$groupDnSet.Add($g.DistinguishedName)
    }

    foreach ($g in $allGroups) {
        $key = Normalize-LdapDn $g.DistinguishedName
        $members = @($g.Members)
        $childGroupKeys = @($members | Where-Object { $groupDnSet.Contains($_) } | ForEach-Object { Normalize-LdapDn $_ })
        $groupByDn[$key] = [PSCustomObject]@{
            Name              = $g.Name
            SamAccountName    = $g.SamAccountName
            DistinguishedName = $g.DistinguishedName
            Description       = $g.Description
            ManagedBy         = $g.ManagedBy
            MemberOf          = @($g.MemberOf)
            Members           = @($members)
            ChildGroupKeys    = @($childGroupKeys)
            ObjectGuid        = $g.ObjectGuid
            ObjectSid         = $g.ObjectSid
            GroupCategory     = $g.GroupCategory
            GroupScope        = $g.GroupScope
        }
        if ($g.ObjectSid) { $sidRegistry[$g.ObjectSid] = $g.DistinguishedName }
    }

    foreach ($g in $allGroups) {
        $parentKey = Normalize-LdapDn $g.DistinguishedName
        $group = $groupByDn[$parentKey]
        foreach ($childKey in @($group.ChildGroupKeys)) {
            if (-not $groupByDn.ContainsKey($childKey)) { continue }
            $childDn = $groupByDn[$childKey].DistinguishedName
            Add-MapListValue -Map $parentGroupMap -Key $childDn -Value $g.DistinguishedName
            Add-MapListValue -Map $childGroupMap -Key $g.DistinguishedName -Value $childDn
        }
        if (@($group.ChildGroupKeys).Count -gt 0) {
            $nestedAdj[$parentKey] = @($group.ChildGroupKeys)
        }
    }

    foreach ($u in $users) {
        if ($u.ObjectSid) { $sidRegistry[$u.ObjectSid] = $u.DistinguishedName }
        foreach ($spn in @($u.ServicePrincipalName)) {
            $normSpn = $spn.ToLowerInvariant()
            if (-not $globalSpnIndex.ContainsKey($normSpn)) {
                $globalSpnIndex[$normSpn] = [System.Collections.Generic.List[object]]::new()
            }
            [void]$globalSpnIndex[$normSpn].Add([PSCustomObject]@{
                ObjectType        = 'User'
                SamAccountName    = $u.SamAccountName
                DistinguishedName = $u.DistinguishedName
                Spn               = $spn
            })
        }
    }

    foreach ($c in $computers) {
        if ($c.ObjectSid) { $sidRegistry[$c.ObjectSid] = $c.DistinguishedName }
        foreach ($spn in @($c.ServicePrincipalName)) {
            $normSpn = $spn.ToLowerInvariant()
            if (-not $globalSpnIndex.ContainsKey($normSpn)) {
                $globalSpnIndex[$normSpn] = [System.Collections.Generic.List[object]]::new()
            }
            [void]$globalSpnIndex[$normSpn].Add([PSCustomObject]@{
                ObjectType        = 'Computer'
                SamAccountName    = $c.SamAccountName
                DistinguishedName = $c.DistinguishedName
                Spn               = $spn
            })
        }
    }

    $userByDn = @{}
    foreach ($u in $users) {
        $userByDn[(Normalize-LdapDn $u.DistinguishedName)] = $u
    }

    $script:DomainCatalog = [PSCustomObject]@{
        Users           = @($users)
        Computers       = @($computers)
        AllGroups       = @($allGroups)
        GroupByDn       = $groupByDn
        GroupDnSet      = $groupDnSet
        NestedAdj       = $nestedAdj
        ParentGroupMap  = $parentGroupMap
        ChildGroupMap   = $childGroupMap
        GlobalSpnIndex  = $globalSpnIndex
        SidRegistry     = $sidRegistry
        UserByDn        = $userByDn
        SearchBases     = $bases
    }

    Write-VerificationLog -Message ("Domain catalog ready: Users={0} Computers={1} Groups={2}" -f $users.Count, $computers.Count, $allGroups.Count)
    return $script:DomainCatalog
}

function Build-GroupCatalog {
    if ($script:GroupCatalog) { return $script:GroupCatalog }

    $catalog = Initialize-DomainCatalog
    $searchBase = Get-EffectiveGroupSearchBase
    Write-Host ("Building group intelligence catalog (SearchBase: {0})..." -f $searchBase) -ForegroundColor Yellow
    Write-VerificationLog -Message ("Building group catalog SearchBase={0}" -f $searchBase)

    $scopedGroups = @{}
    foreach ($key in $catalog.GroupByDn.Keys) {
        $group = $catalog.GroupByDn[$key]
        if (-not (Test-DnUnderSearchBase -DistinguishedName $group.DistinguishedName -SearchBase $searchBase)) {
            continue
        }
        if (-not $script:ProductionMode -and -not (Test-IsSeededName -Name $group.SamAccountName) -and -not (Test-IsSeededName -Name $group.Name)) {
            continue
        }
        $scopedGroups[$key] = $group
    }

    $script:GroupCatalog = [PSCustomObject]@{
        SearchBase     = $searchBase
        Groups         = $scopedGroups
        ParentGroupMap = $catalog.ParentGroupMap
        ChildGroupMap  = $catalog.ChildGroupMap
        NestedAdj      = @{}
        GroupCount     = $scopedGroups.Count
    }

    foreach ($key in $scopedGroups.Keys) {
        $group = $scopedGroups[$key]
        $childKeys = @($group.ChildGroupKeys | Where-Object { $scopedGroups.ContainsKey($_) })
        if ($childKeys.Count -gt 0) {
            $script:GroupCatalog.NestedAdj[$key] = $childKeys
        }
    }

    Write-VerificationLog -Message ("Group catalog ready: Groups={0}" -f $script:GroupCatalog.GroupCount)
    return $script:GroupCatalog
}

function Find-NestedGroupCycles {
    param([hashtable]$NestedAdj)

    $allCycles = [System.Collections.Generic.List[object]]::new()
    $seenKeys = @{}
    $globalVisited = @{}

    function Invoke-CycleDfs {
        param(
            [string]$NodeKey,
            [hashtable]$Adj,
            [System.Collections.Generic.HashSet[string]]$Stack,
            [System.Collections.Generic.List[string]]$Path
        )

        if ($globalVisited.ContainsKey($NodeKey)) { return }
        [void]$Stack.Add($NodeKey)
        [void]$Path.Add($NodeKey)

        $children = @()
        if ($Adj.ContainsKey($NodeKey)) { $children = @($Adj[$NodeKey]) }

        foreach ($childKey in $children) {
            $child = Normalize-LdapDn $childKey
            if (-not $child) { continue }
            if ($Stack.Contains($child)) {
                $startIdx = $Path.IndexOf($child)
                if ($startIdx -ge 0) {
                    $cycle = @($Path[$startIdx..($Path.Count - 1)])
                    $cycleKey = ($cycle -join '>')
                    if (-not $seenKeys.ContainsKey($cycleKey)) {
                        $seenKeys[$cycleKey] = $true
                        [void]$allCycles.Add(@($cycle))
                    }
                }
                continue
            }
            Invoke-CycleDfs -NodeKey $child -Adj $Adj -Stack $Stack -Path $Path
        }

        [void]$Stack.Remove($NodeKey)
        if ($Path.Count -gt 0) { [void]$Path.RemoveAt($Path.Count - 1) }
        $globalVisited[$NodeKey] = $true
    }

    foreach ($startKey in $NestedAdj.Keys) {
        $stack = New-Object 'System.Collections.Generic.HashSet[string]'
        $path = [System.Collections.Generic.List[string]]::new()
        Invoke-CycleDfs -NodeKey $startKey -Adj $NestedAdj -Stack $stack -Path $path
    }

    return @($allCycles.ToArray())
}

function Get-PrivilegedGroupContext {
    if (-not $script:PrivilegeGraph) {
        Initialize-PrivilegeGraph | Out-Null
    }
    return $script:PrivilegeGraph
}

function Get-ReachablePrivilegedGroupsFromGroup {
    param([string]$StartGroupDn)

    $catalog = Initialize-DomainCatalog
    $ctx = Get-PrivilegedGroupContext
    $results = [System.Collections.Generic.List[object]]::new()
    $visited = @{}
    $queue = [System.Collections.Generic.Queue[object]]::new()
    $queue.Enqueue(@{ Key = (Normalize-LdapDn $StartGroupDn); Path = @($StartGroupDn); Depth = 0 })

    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        if ($visited.ContainsKey($item.Key)) { continue }
        $visited[$item.Key] = $true

        $currentDn = $item.Path[-1]
        if ($ctx.PrivilegedGroupDns.Contains($currentDn)) {
            $name = if ($catalog.GroupByDn.ContainsKey($item.Key)) { $catalog.GroupByDn[$item.Key].Name } else { $currentDn }
            [void]$results.Add([PSCustomObject]@{
                PrivilegedGroupDn   = $currentDn
                PrivilegedGroupName = $name
                Path                = @($item.Path)
                Depth               = $item.Depth
            })
        }

        if ($item.Depth -ge 16) { continue }
        if (-not $catalog.GroupByDn.ContainsKey($item.Key)) { continue }

        foreach ($childKey in @($catalog.GroupByDn[$item.Key].ChildGroupKeys)) {
            if (-not $catalog.GroupByDn.ContainsKey($childKey)) { continue }
            $childDn = $catalog.GroupByDn[$childKey].DistinguishedName
            $queue.Enqueue(@{
                Key   = $childKey
                Path  = @($item.Path + $childDn)
                Depth = ($item.Depth + 1)
            })
        }
    }

    return @($results.ToArray())
}

function Get-UserPrivilegedMembershipPaths {
    param([object]$User)

    $allPaths = [System.Collections.Generic.List[object]]::new()
    foreach ($groupDn in @($User.MemberOf)) {
        foreach ($p in (Get-ReachablePrivilegedGroupsFromGroup -StartGroupDn $groupDn)) {
            [void]$allPaths.Add([PSCustomObject]@{
                PrivilegedGroupDn   = $p.PrivilegedGroupDn
                PrivilegedGroupName = $p.PrivilegedGroupName
                Path                = @($User.DistinguishedName) + @($p.Path)
                Depth               = $p.Depth + 1
                InheritedFrom       = $groupDn
            })
        }
    }
    return @($allPaths.ToArray())
}

function Initialize-PrivilegeGraph {
    if ($script:PrivilegeGraph) { return $script:PrivilegeGraph }

    $null = Initialize-DomainCatalog
    $ad = Get-AdSplat
    $domainDn = Get-AdDomainDn
    $builtinBase = "CN=Builtin,$domainDn"

    Write-Host 'Resolving privileged groups...' -ForegroundColor Yellow
    $privilegedGroupDns = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $privilegedGroupByName = @{}

    foreach ($groupName in $script:PrivilegedGroupNames) {
        try {
            if ($groupName -eq 'Administrators') {
                $groups = @(Get-ADGroup -Filter 'Name -eq "Administrators"' -SearchBase $builtinBase @ad -ErrorAction Stop)
            }
            else {
                $groups = @(Get-ADGroup -Filter "Name -eq '$groupName'" -SearchBase $domainDn @ad -ErrorAction Stop)
            }
            foreach ($g in $groups) {
                [void]$privilegedGroupDns.Add($g.DistinguishedName)
                $privilegedGroupByName[$groupName] = $g.DistinguishedName
            }
        }
        catch {
            Write-VerificationLog -Message ("Privileged group not found: {0} - {1}" -f $groupName, $_.Exception.Message) -Level 'WARN'
        }
    }

    $script:PrivilegeGraph = [PSCustomObject]@{
        PrivilegedGroupDns    = $privilegedGroupDns
        PrivilegedGroupByName = $privilegedGroupByName
    }

    return $script:PrivilegeGraph
}

<#
# SID & ACL helpers — disabled for now
function Test-AclModuleSupport {
    try {
        $ad = Get-AdSplat
        $domainDn = Get-AdDomainDn
        $null = Get-ADObject -SearchBase $domainDn -SearchScope Base -Filter * -Properties nTSecurityDescriptor @ad -ErrorAction Stop
        $script:AclModuleSupported = $true
        $script:AclSkipReason = ''
        return $true
    }
    catch {
        $script:AclModuleSupported = $false
        $script:AclSkipReason = $_.Exception.Message
        Write-VerificationLog -Message ("ACL modules unavailable: {0}" -f $script:AclSkipReason) -Level 'WARN'
        return $false
    }
}

function Get-SkipVerificationResult {
    param(
        [string]$Feature,
        [string]$WorksheetName,
        [string]$CsvFileName,
        [string]$Reason
    )
    return (New-VerificationResult -Feature $Feature -Status 'SKIP' -Error $Reason `
        -WorksheetName $WorksheetName -CsvFileName $CsvFileName -Records @(
            [PSCustomObject]@{ Status = 'SKIP'; Reason = $Reason }
        ))
}
#>

function Ensure-ImportExcelModule {
    if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
        Write-Host 'ImportExcel module not found. Installing for current user...' -ForegroundColor Yellow
        Write-VerificationLog -Message 'Installing ImportExcel module' -Level 'WARN'
        Install-Module -Name ImportExcel -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
    }
    Import-Module ImportExcel -ErrorAction Stop
}

function Export-DetailWorksheet {
    param(
        [Parameter(Mandatory)]
        $Data,
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$WorksheetName,
        [switch]$Append
    )

    $params = @{
        Path           = $Path
        WorksheetName  = $WorksheetName
        AutoSize       = $true
        FreezeTopRow   = $true
        BoldTopRow     = $true
        AutoFilter     = $true
        TableName      = ($WorksheetName -replace '[^A-Za-z0-9]', '')
    }
    if ($Append) { $params.Append = $true }

    if (-not $Data -or @($Data).Count -eq 0) {
        [PSCustomObject]@{ Message = 'No records returned for this feature.' } | Export-Excel @params
    }
    else {
        $Data | Export-Excel @params
    }
}

function Export-VerificationReports {
    param(
        [Parameter(Mandatory)]
        [array]$Results,
        [Parameter(Mandatory)]
        [string]$ReportFolder,
        [Parameter(Mandatory)]
        [datetime]$GeneratedAt
    )

    $xlsxPath = Join-Path $ReportFolder 'Verification.xlsx'
    $jsonPath = Join-Path $ReportFolder 'Verification.json'

    # Summary worksheet
    $summaryRows = foreach ($r in $Results) {
        [PSCustomObject]@{
            Feature          = $r.Feature
            'Expected Count' = $r.ExpectedCount
            'Actual Count'   = $r.ActualCount
            Count            = $r.ActualCount
            Status           = $r.Status
            'Execution Time' = $r.ExecutionTime
            Worksheet        = $r.WorksheetName
            'Generated At'   = $GeneratedAt.ToString('yyyy-MM-dd HH:mm:ss')
            Error            = $r.Error
        }
    }

    if (Test-Path $xlsxPath) { Remove-Item $xlsxPath -Force }

    $summaryRows | Export-Excel -Path $xlsxPath -WorksheetName 'Summary' `
        -AutoSize -FreezeTopRow -BoldTopRow -AutoFilter -TableName 'Summary'

    $first = $true
    foreach ($r in $Results) {
        if (-not $r.WorksheetName) { continue }
        Export-DetailWorksheet -Data $r.Records -Path $xlsxPath `
            -WorksheetName $r.WorksheetName -Append:(-not $first)
        $first = $false

        if ($r.CsvFileName) {
            $csvPath = Join-Path $ReportFolder $r.CsvFileName
            if ($r.Records -and @($r.Records).Count -gt 0) {
                $r.Records | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
            }
            else {
                'Message' | Out-File -FilePath $csvPath -Encoding UTF8
                'No records returned for this feature.' | Out-File -FilePath $csvPath -Append -Encoding UTF8
            }
        }
    }

    $jsonPayload = @{
        GeneratedAt     = $GeneratedAt.ToString('o')
        Mode            = if ($script:ProductionMode) { 'Production' } else { 'Development' }
        Server          = $script:AdServer
        SearchBases     = @{
            User     = (Get-EffectiveUserSearchBase)
            Group    = (Get-EffectiveGroupSearchBase)
            Computer = (Get-EffectiveComputerSearchBase)
        }
        Modules         = @($Results | ForEach-Object {
            @{
                Feature         = $_.Feature
                ExpectedCount   = $_.ExpectedCount
                ActualCount     = $_.ActualCount
                ExpectedObjects = @($_.ExpectedObjects)
                ActualObjects   = @($_.ActualObjects)
                ExecutionTime   = $_.ExecutionTime
                Status          = $_.Status
                Error           = $_.Error
                Records         = @($_.Records)
            }
        })
    }
    $jsonPayload | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8
}

#endregion

#region Verification Modules

function New-UserSecurityRecord {
    param([object]$User, [hashtable]$Extra = @{})
    $base = [ordered]@{
        User               = $User.SamAccountName
        DistinguishedName  = $User.DistinguishedName
        UserAccountControl = $User.UserAccountControl
        LastLogon          = Format-AdDateTime -FileTime $User.LastLogonTimestamp
        DisplayName        = $User.DisplayName
        Enabled            = $User.Enabled
    }
    foreach ($key in $Extra.Keys) { $base[$key] = $Extra[$key] }
    return [PSCustomObject]$base
}

function Get-LockedAccountsVerification {
    $catalog = Initialize-DomainCatalog
    $records = foreach ($u in $catalog.Users) {
        if (-not (Test-IsLockedAccount -LockoutTime $u.LockoutTime -UserAccountControl $u.UserAccountControl)) { continue }
        New-UserSecurityRecord -User $u -Extra @{ LockoutTime = $u.LockoutTime }
    }
    return (New-VerificationResult -Feature 'Locked Accounts' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Locked Accounts' -CsvFileName 'LockedAccounts.csv')
}

function Get-ReversibleEncryptionVerification {
    $catalog = Initialize-DomainCatalog
    $records = foreach ($u in $catalog.Users) {
        if (-not (Test-UacFlag -UserAccountControl $u.UserAccountControl -Flag $script:UacReversibleEncryption)) { continue }
        New-UserSecurityRecord -User $u
    }
    return (New-VerificationResult -Feature 'Reversible Encryption Enabled' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Reversible Encryption' -CsvFileName 'ReversibleEncryption.csv')
}

function Get-SmartcardNotRequiredVerification {
    $catalog = Initialize-DomainCatalog
    $records = foreach ($u in $catalog.Users) {
        if (Test-UacFlag -UserAccountControl $u.UserAccountControl -Flag $script:UacSmartcardRequired) { continue }
        New-UserSecurityRecord -User $u
    }
    return (New-VerificationResult -Feature 'Smartcard Not Required' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Smartcard Not Required' -CsvFileName 'SmartcardNotRequired.csv')
}

function Get-GroupsWithoutOwnersVerification {
    $catalog = Build-GroupCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($key in $catalog.Groups.Keys) {
        $g = $catalog.Groups[$key]
        if ($g.ManagedBy -and $g.ManagedBy.Trim()) { continue }
        $records.Add([PSCustomObject]@{
            GroupName         = $g.Name
            SamAccountName    = $g.SamAccountName
            DistinguishedName = $g.DistinguishedName
            ObjectSid         = $g.ObjectSid
            ObjectGuid        = $g.ObjectGuid
            Description       = $g.Description
        })
    }
    return (New-VerificationResult -Feature 'Groups Without Owners' -Count $records.Count `
        -Records @($records) -WorksheetName 'Groups Without Owners' -CsvFileName 'GroupsWithoutOwners.csv')
}

function Get-UnusedGroupsVerification {
    $catalog = Build-GroupCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($key in $catalog.Groups.Keys) {
        $g = $catalog.Groups[$key]
        if (@($g.Members).Count -ne 0) { continue }
        $parentCount = Get-MapListCount -Map $catalog.ParentGroupMap -Key $g.DistinguishedName
        if ($parentCount -gt 0) { continue }
        $records.Add([PSCustomObject]@{
            GroupName         = $g.Name
            SamAccountName    = $g.SamAccountName
            DistinguishedName = $g.DistinguishedName
            ObjectSid         = $g.ObjectSid
            DirectMemberCount = 0
            ParentGroupCount  = $parentCount
        })
    }
    return (New-VerificationResult -Feature 'Unused Groups' -Count $records.Count `
        -Records @($records) -WorksheetName 'Unused Groups' -CsvFileName 'UnusedGroups.csv')
}

function Get-OrphanGroupsVerification {
    $catalog = Build-GroupCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($key in $catalog.Groups.Keys) {
        $g = $catalog.Groups[$key]
        if (@($g.Members).Count -ne 0) { continue }
        $parentCount = Get-MapListCount -Map $catalog.ParentGroupMap -Key $g.DistinguishedName
        $memberOfCount = @($g.MemberOf).Count
        if ($parentCount -gt 0 -or $memberOfCount -gt 0) { continue }
        if ($g.ManagedBy -and $g.ManagedBy.Trim()) { continue }
        $records.Add([PSCustomObject]@{
            GroupName         = $g.Name
            SamAccountName    = $g.SamAccountName
            DistinguishedName = $g.DistinguishedName
            ObjectSid         = $g.ObjectSid
            ManagedBy         = ''
            IncomingRefs      = $parentCount + $memberOfCount
        })
    }
    return (New-VerificationResult -Feature 'Orphan Groups' -Count $records.Count `
        -Records @($records) -WorksheetName 'Orphan Groups' -CsvFileName 'OrphanGroups.csv')
}

function Get-DuplicateGroupsVerification {
    $catalog = Build-GroupCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    $fields = @(
        @{ Field = 'Name'; Key = 'Name' }
        @{ Field = 'SamAccountName'; Key = 'SamAccountName' }
        @{ Field = 'ObjectSid'; Key = 'ObjectSid' }
        @{ Field = 'Description'; Key = 'Description'; Optional = $true }
    )

    foreach ($fieldDef in $fields) {
        $byValue = @{}
        foreach ($key in $catalog.Groups.Keys) {
            $g = $catalog.Groups[$key]
            $val = [string]$g.($fieldDef.Key)
            if ($fieldDef.Optional -and (-not $val.Trim())) { continue }
            if (-not $val.Trim()) { continue }
            $norm = $val.ToLowerInvariant()
            if (-not $byValue.ContainsKey($norm)) { $byValue[$norm] = [System.Collections.Generic.List[object]]::new() }
            [void]$byValue[$norm].Add($g)
        }
        foreach ($norm in $byValue.Keys) {
            $groups = @($byValue[$norm])
            if ($groups.Count -lt 2) { continue }
            $records.Add([PSCustomObject]@{
                DuplicateField    = $fieldDef.Field
                DuplicateValue    = $groups[0].($fieldDef.Key)
                DuplicateCount    = $groups.Count
                GroupNames        = (($groups | ForEach-Object { $_.Name }) -join '; ')
                DistinguishedNames = (($groups | ForEach-Object { $_.DistinguishedName }) -join '; ')
            })
        }
    }

    return (New-VerificationResult -Feature 'Duplicate Groups' -Count $records.Count `
        -Records @($records) -WorksheetName 'Duplicate Groups' -CsvFileName 'DuplicateGroups.csv')
}

function Get-CircularMembershipVerification {
    $catalog = Build-GroupCatalog
    $cycles = Find-NestedGroupCycles -NestedAdj $catalog.NestedAdj
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($cycle in $cycles) {
        $names = @($cycle | ForEach-Object {
            if ($catalog.Groups.ContainsKey($_)) { $catalog.Groups[$_].Name } else { $_ }
        })
        $dns = @($cycle | ForEach-Object {
            if ($catalog.Groups.ContainsKey($_)) { $catalog.Groups[$_].DistinguishedName } else { $_ }
        })
        $records.Add([PSCustomObject]@{
            CycleLength             = @($cycle).Count
            CyclePath               = ($names -join ' > ') + ' > ' + $names[0]
            CycleGroups             = ($names -join ' > ')
            CycleDistinguishedNames = ($dns -join '; ')
        })
    }
    return (New-VerificationResult -Feature 'Circular Membership' -Count $records.Count `
        -Records @($records) -WorksheetName 'Circular Membership' -CsvFileName 'CircularMembership.csv')
}

function Get-ToxicPrivilegeCombinationsVerification {
    $null = Initialize-PrivilegeGraph
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    $seen = @{}

    foreach ($u in $catalog.Users) {
        $paths = Get-UserPrivilegedMembershipPaths -User $u
        if ($paths.Count -eq 0) { continue }

        $reachableNames = @($paths | ForEach-Object { $_.PrivilegedGroupName } | Select-Object -Unique)
        foreach ($rule in $script:ToxicPrivilegeRules) {
            $matched = @($rule.RequiredGroups | Where-Object { $reachableNames -contains $_ })
            if ($matched.Count -lt @($rule.RequiredGroups).Count) { continue }
            $dedupeKey = '{0}|{1}' -f $u.SamAccountName, $rule.RuleName
            if ($seen[$dedupeKey]) { continue }
            $seen[$dedupeKey] = $true
            $records.Add([PSCustomObject]@{
                User                = $u.SamAccountName
                DistinguishedName   = $u.DistinguishedName
                RuleName            = $rule.RuleName
                ConflictingGroups   = ($rule.RequiredGroups -join '; ')
                ReachablePrivileged = ($reachableNames -join '; ')
            })
        }
    }

    return (New-VerificationResult -Feature 'Toxic Privilege Combinations' -Count $records.Count `
        -Records @($records) -WorksheetName 'Toxic Privilege' -CsvFileName 'ToxicPrivilegeCombinations.csv')
}

function Get-NestedPrivilegedAccessVerification {
    $null = Initialize-PrivilegeGraph
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()

    foreach ($u in $catalog.Users) {
        foreach ($p in (Get-UserPrivilegedMembershipPaths -User $u)) {
            if ($p.Depth -le 1) { continue }
            $pathNames = @($p.Path | ForEach-Object {
                $k = Normalize-LdapDn $_
                if ($catalog.GroupByDn.ContainsKey($k)) { $catalog.GroupByDn[$k].Name }
                elseif ($catalog.UserByDn.ContainsKey($k)) { $catalog.UserByDn[$k].SamAccountName }
                else { $_ }
            })
            $records.Add([PSCustomObject]@{
                User          = $u.SamAccountName
                PrivilegePath = ($pathNames -join ' > ')
                InheritedFrom = $p.InheritedFrom
                Depth         = $p.Depth
                PrivilegedGroup = $p.PrivilegedGroupName
            })
        }
    }

    return (New-VerificationResult -Feature 'Nested Privileged Access' -Count $records.Count `
        -Records @($records) -WorksheetName 'Nested Privileged' -CsvFileName 'NestedPrivilegedAccess.csv')
}

function Get-DormantPrivilegedUsersVerification {
    param([int]$ThresholdDays = 90)
    $null = Initialize-PrivilegeGraph
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()

    foreach ($u in $catalog.Users) {
        if (-not $u.Enabled) { continue }
        $paths = Get-UserPrivilegedMembershipPaths -User $u
        if ($paths.Count -eq 0) { continue }
        if (-not (Test-IsInactiveByFileTime -LastLogonTimestamp $u.LastLogonTimestamp -ThresholdDays $ThresholdDays)) { continue }
        $privGroups = @($paths | ForEach-Object { $_.PrivilegedGroupName } | Select-Object -Unique)
        $records.Add([PSCustomObject]@{
            User               = $u.SamAccountName
            DistinguishedName  = $u.DistinguishedName
            UserAccountControl = $u.UserAccountControl
            LastLogon          = Format-AdDateTime -FileTime $u.LastLogonTimestamp
            PrivilegedGroups   = ($privGroups -join '; ')
            InactiveDays       = $ThresholdDays
        })
    }

    return (New-VerificationResult -Feature 'Dormant Privileged Users' -Count $records.Count `
        -Records @($records) -WorksheetName 'Dormant Privileged' -CsvFileName 'DormantPrivilegedUsers.csv')
}

function Get-ExcessivePrivilegesVerification {
    param([int]$Threshold = 3)
    $null = Initialize-PrivilegeGraph
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()

    foreach ($u in $catalog.Users) {
        $paths = Get-UserPrivilegedMembershipPaths -User $u
        $privGroups = @($paths | ForEach-Object { $_.PrivilegedGroupName } | Select-Object -Unique)
        if ($privGroups.Count -le $Threshold) { continue }
        $records.Add([PSCustomObject]@{
            User                 = $u.SamAccountName
            DistinguishedName    = $u.DistinguishedName
            PrivilegedGroupCount = $privGroups.Count
            Threshold            = $Threshold
            PrivilegedGroups     = ($privGroups -join '; ')
        })
    }

    return (New-VerificationResult -Feature 'Excessive Privileges' -Count $records.Count `
        -Records @($records) -WorksheetName 'Excessive Privileges' -CsvFileName 'ExcessivePrivileges.csv')
}

function Get-PrivilegeEscalationPathsVerification {
    $null = Initialize-PrivilegeGraph
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()

    foreach ($u in $catalog.Users) {
        foreach ($p in (Get-UserPrivilegedMembershipPaths -User $u)) {
            if ($p.Depth -lt 3) { continue }
            $pathNames = @($p.Path | ForEach-Object {
                $k = Normalize-LdapDn $_
                if ($catalog.GroupByDn.ContainsKey($k)) { $catalog.GroupByDn[$k].Name }
                elseif ($catalog.UserByDn.ContainsKey($k)) { $catalog.UserByDn[$k].SamAccountName }
                else { $_ }
            })
            $records.Add([PSCustomObject]@{
                User          = $u.SamAccountName
                CompletePath  = ($pathNames -join ' > ')
                PrivilegedGroup = $p.PrivilegedGroupName
                Depth         = $p.Depth
            })
        }
    }

    return (New-VerificationResult -Feature 'Privilege Escalation Paths' -Count $records.Count `
        -Records @($records) -WorksheetName 'Privilege Escalation' -CsvFileName 'PrivilegeEscalationPaths.csv')
}

<#
# SID & ACL verification modules — disabled for now
function Get-OrphanSidVerification {
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($u in $catalog.Users) {
        foreach ($histSid in @($u.SidHistory)) {
            if ($catalog.SidRegistry.ContainsKey($histSid)) { continue }
            $records.Add([PSCustomObject]@{
                User              = $u.SamAccountName
                DistinguishedName = $u.DistinguishedName
                OrphanSid         = $histSid
                Source            = 'sIDHistory'
            })
        }
    }
    return (New-VerificationResult -Feature 'Orphan SID' -Count $records.Count `
        -Records @($records) -WorksheetName 'Orphan SID' -CsvFileName 'OrphanSid.csv')
}

function Get-ShadowAdminVerification {
    if (-not $script:AclModuleSupported) {
        return (Get-SkipVerificationResult -Feature 'Shadow Admin' -WorksheetName 'Shadow Admin' `
            -CsvFileName 'ShadowAdmin.csv' -Reason $script:AclSkipReason)
    }
    $null = Initialize-PrivilegeGraph
    $catalog = Initialize-DomainCatalog
    $ad = Get-AdSplat
    $records = [System.Collections.Generic.List[object]]::new()
    $checked = 0

    foreach ($privDn in @($script:PrivilegeGraph.PrivilegedGroupDns)) {
        $checked++
        try {
            $obj = Get-ADObject -Identity $privDn -Properties nTSecurityDescriptor @ad -ErrorAction Stop
            if (-not $obj.nTSecurityDescriptor) { continue }
            $sd = New-Object System.DirectoryServices.ActiveDirectorySecurity
            $sd.SetSecurityDescriptorBinaryForm($obj.nTSecurityDescriptor)
            foreach ($ace in $sd.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
                if ($ace.AccessControlType -ne 'Allow') { continue }
                $mask = [int]$ace.ActiveDirectoryRights
                $isDangerous = $false
                foreach ($dangerMask in $script:ShadowAdminAceMasks) {
                    if (($mask -band $dangerMask) -eq $dangerMask) { $isDangerous = $true; break }
                }
                if (-not $isDangerous) { continue }
                $trusteeSid = $ace.IdentityReference.Value
                if (-not $catalog.SidRegistry.ContainsKey($trusteeSid)) { continue }
                $trusteeDn = $catalog.SidRegistry[$trusteeSid]
                $trusteeKey = Normalize-LdapDn $trusteeDn
                if (-not $catalog.UserByDn.ContainsKey($trusteeKey)) { continue }
                $trustee = $catalog.UserByDn[$trusteeKey]
                $privPaths = Get-UserPrivilegedMembershipPaths -User $trustee
                if ($privPaths.Count -gt 0) { continue }
                $records.Add([PSCustomObject]@{
                    User              = $trustee.SamAccountName
                    DistinguishedName = $trustee.DistinguishedName
                    PrivilegedObject  = $privDn
                    AceRights         = $ace.ActiveDirectoryRights
                    TrusteeSid        = $trusteeSid
                })
            }
        }
        catch {
            Write-VerificationLog -Message ("Shadow admin ACL read failed for {0}: {1}" -f $privDn, $_.Exception.Message) -Level 'WARN'
        }
    }

    return (New-VerificationResult -Feature 'Shadow Admin' -Count $records.Count `
        -Records @($records) -WorksheetName 'Shadow Admin' -CsvFileName 'ShadowAdmin.csv')
}

function Get-SidHistoryAnalysisVerification {
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($u in $catalog.Users) {
        if (@($u.SidHistory).Count -eq 0) { continue }
        $histDetails = @($u.SidHistory | ForEach-Object {
            $known = $catalog.SidRegistry.ContainsKey($_)
            '{0} ({1})' -f $_, $(if ($known) { 'known' } else { 'unknown' })
        })
        $records.Add([PSCustomObject]@{
            User              = $u.SamAccountName
            DistinguishedName = $u.DistinguishedName
            CurrentSid        = $u.ObjectSid
            SidHistory        = ($histDetails -join '; ')
            SidHistoryCount   = @($u.SidHistory).Count
        })
    }
    return (New-VerificationResult -Feature 'SID History Analysis' -Count $records.Count `
        -Records @($records) -WorksheetName 'SID History' -CsvFileName 'SidHistoryAnalysis.csv')
}

function Get-ForeignSecurityPrincipalsVerification {
    $filter = '(&(objectClass=foreignSecurityPrincipal))'
    $entries = Invoke-PagedLdapSearch -SearchBase (Get-AdDomainDn) -LdapFilter $filter `
        -AttributeNames @('cn', 'objectSid', 'name') `
        -StatusMessage 'Loading foreign security principals...' `
        -MapEntry { param($Entry)
            $sidBytes = $null
            if ($Entry.Attributes.Contains('objectSid')) { $sidBytes = $Entry.Attributes['objectSid'][0] }
            [PSCustomObject]@{
                Name              = (Get-LdapEntryValue -Entry $Entry -Name 'cn')
                DistinguishedName = $Entry.DistinguishedName
                ObjectSid         = (ConvertFrom-SidBytes -Bytes $sidBytes)
            }
        }
    $records = @($entries | ForEach-Object { $_ })
    return (New-VerificationResult -Feature 'Foreign Security Principals' -Count @($records).Count `
        -Records $records -WorksheetName 'Foreign SP' -CsvFileName 'ForeignSecurityPrincipals.csv')
}

function Get-UnknownSidBindingsVerification {
    if (-not $script:AclModuleSupported) {
        return (Get-SkipVerificationResult -Feature 'Unknown SID Bindings' -WorksheetName 'Unknown SID' `
            -CsvFileName 'UnknownSidBindings.csv' -Reason $script:AclSkipReason)
    }
    $catalog = Initialize-DomainCatalog
    $ad = Get-AdSplat
    $records = [System.Collections.Generic.List[object]]::new()
    $sampleObjects = @($catalog.AllGroups | Select-Object -First 50)

    foreach ($g in $sampleObjects) {
        try {
            $obj = Get-ADObject -Identity $g.DistinguishedName -Properties nTSecurityDescriptor @ad -ErrorAction Stop
            if (-not $obj.nTSecurityDescriptor) { continue }
            $sd = New-Object System.DirectoryServices.ActiveDirectorySecurity
            $sd.SetSecurityDescriptorBinaryForm($obj.nTSecurityDescriptor)
            foreach ($ace in $sd.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
                $sid = $ace.IdentityReference.Value
                if ($sid -match '^S-1-5-21-' -and -not $catalog.SidRegistry.ContainsKey($sid)) {
                    $records.Add([PSCustomObject]@{
                        ObjectDn    = $g.DistinguishedName
                        ObjectName  = $g.Name
                        UnknownSid  = $sid
                        AceRights   = $ace.ActiveDirectoryRights
                    })
                }
            }
        }
        catch {
            Write-VerificationLog -Message ("Unknown SID scan failed for {0}" -f $g.DistinguishedName) -Level 'WARN'
        }
    }

    return (New-VerificationResult -Feature 'Unknown SID Bindings' -Count $records.Count `
        -Records @($records) -WorksheetName 'Unknown SID' -CsvFileName 'UnknownSidBindings.csv')
}

function Get-BrokenAclsVerification {
    if (-not $script:AclModuleSupported) {
        return (Get-SkipVerificationResult -Feature 'Broken ACLs' -WorksheetName 'Broken ACLs' `
            -CsvFileName 'BrokenAcls.csv' -Reason $script:AclSkipReason)
    }
    $catalog = Initialize-DomainCatalog
    $ad = Get-AdSplat
    $records = [System.Collections.Generic.List[object]]::new()
    $targets = @($catalog.AllGroups | Select-Object -First 50)

    foreach ($g in $targets) {
        try {
            $obj = Get-ADObject -Identity $g.DistinguishedName -Properties nTSecurityDescriptor @ad -ErrorAction Stop
            if (-not $obj.nTSecurityDescriptor) {
                $records.Add([PSCustomObject]@{
                    ObjectName = $g.Name
                    ObjectDn   = $g.DistinguishedName
                    Issue      = 'Missing nTSecurityDescriptor'
                })
                continue
            }
            $sd = New-Object System.DirectoryServices.ActiveDirectorySecurity
            $sd.SetSecurityDescriptorBinaryForm($obj.nTSecurityDescriptor)
            if (-not $sd.AreAccessRulesProtected -and $sd.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]).Count -eq 0) {
                $records.Add([PSCustomObject]@{
                    ObjectName = $g.Name
                    ObjectDn   = $g.DistinguishedName
                    Issue      = 'Empty DACL'
                })
            }
        }
        catch {
            $records.Add([PSCustomObject]@{
                ObjectName = $g.Name
                ObjectDn   = $g.DistinguishedName
                Issue      = $_.Exception.Message
            })
        }
    }

    return (New-VerificationResult -Feature 'Broken ACLs' -Count $records.Count `
        -Records @($records) -WorksheetName 'Broken ACLs' -CsvFileName 'BrokenAcls.csv')
}
#>

function Get-DisabledComputersVerification {
    $catalog = Initialize-DomainCatalog
    $records = foreach ($c in $catalog.Computers) {
        if ($c.Enabled) { continue }
        [PSCustomObject]@{
            Computer           = $c.SamAccountName
            DistinguishedName  = $c.DistinguishedName
            UserAccountControl = $c.UserAccountControl
            LastLogon          = Format-AdDateTime -FileTime $c.LastLogonTimestamp
            OperatingSystem    = $c.OperatingSystem
        }
    }
    return (New-VerificationResult -Feature 'Disabled Computers' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Disabled Computers' -CsvFileName 'DisabledComputers.csv')
}

function Get-InactiveComputersVerification {
    param([int]$ThresholdDays = 90)
    $catalog = Initialize-DomainCatalog
    $records = foreach ($c in $catalog.Computers) {
        if (-not $c.Enabled) { continue }
        if (-not (Test-IsInactiveByFileTime -LastLogonTimestamp $c.LastLogonTimestamp -ThresholdDays $ThresholdDays)) { continue }
        [PSCustomObject]@{
            Computer           = $c.SamAccountName
            DistinguishedName  = $c.DistinguishedName
            UserAccountControl = $c.UserAccountControl
            LastLogon          = Format-AdDateTime -FileTime $c.LastLogonTimestamp
            OperatingSystem    = $c.OperatingSystem
            InactiveDays       = $ThresholdDays
        }
    }
    return (New-VerificationResult -Feature 'Inactive Computers' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Inactive Computers' -CsvFileName 'InactiveComputers.csv')
}

function Get-MissingOperatingSystemVerification {
    $catalog = Initialize-DomainCatalog
    $records = foreach ($c in $catalog.Computers) {
        if ($c.OperatingSystem -and $c.OperatingSystem.Trim()) { continue }
        [PSCustomObject]@{
            Computer          = $c.SamAccountName
            DistinguishedName = $c.DistinguishedName
            OperatingSystem   = $c.OperatingSystem
            LastLogon         = Format-AdDateTime -FileTime $c.LastLogonTimestamp
        }
    }
    return (New-VerificationResult -Feature 'Missing Operating System' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Missing OS' -CsvFileName 'MissingOperatingSystem.csv')
}

function Get-UnsupportedOperatingSystemsVerification {
    $catalog = Initialize-DomainCatalog
    $records = foreach ($c in $catalog.Computers) {
        if (-not (Test-IsUnsupportedOperatingSystem -OperatingSystem $c.OperatingSystem -OperatingSystemVersion $c.OperatingSystemVersion)) { continue }
        [PSCustomObject]@{
            Computer                 = $c.SamAccountName
            DistinguishedName        = $c.DistinguishedName
            OperatingSystem          = $c.OperatingSystem
            OperatingSystemVersion   = $c.OperatingSystemVersion
            LastLogon                = Format-AdDateTime -FileTime $c.LastLogonTimestamp
        }
    }
    return (New-VerificationResult -Feature 'Unsupported Operating Systems' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Unsupported OS' -CsvFileName 'UnsupportedOperatingSystems.csv')
}

function Get-ServersInWorkstationOuVerification {
    $catalog = Initialize-DomainCatalog
    $records = foreach ($c in $catalog.Computers) {
        if (-not (Test-IsServerOperatingSystem -OperatingSystem $c.OperatingSystem)) { continue }
        if (-not (Test-IsWorkstationOu -DistinguishedName $c.DistinguishedName)) { continue }
        [PSCustomObject]@{
            Computer          = $c.SamAccountName
            DistinguishedName = $c.DistinguishedName
            OperatingSystem   = $c.OperatingSystem
            Issue             = 'Server OS in workstation OU'
        }
    }
    return (New-VerificationResult -Feature 'Servers inside Workstation OU' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Servers Wrong OU' -CsvFileName 'ServersInWorkstationOu.csv')
}

function Get-DuplicateSpnsVerification {
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($spnKey in $catalog.GlobalSpnIndex.Keys) {
        $holders = @($catalog.GlobalSpnIndex[$spnKey])
        if ($holders.Count -lt 2) { continue }
        $records.Add([PSCustomObject]@{
            Spn           = $holders[0].Spn
            DuplicateCount = $holders.Count
            Holders       = (($holders | ForEach-Object { '{0}:{1}' -f $_.ObjectType, $_.SamAccountName }) -join '; ')
        })
    }
    return (New-VerificationResult -Feature 'Duplicate SPNs' -Count $records.Count `
        -Records @($records) -WorksheetName 'Duplicate SPNs' -CsvFileName 'DuplicateSpns.csv')
}

function Get-ComputersWithoutOwnersVerification {
    $catalog = Initialize-DomainCatalog
    $records = foreach ($c in $catalog.Computers) {
        if ($c.ManagedBy -and $c.ManagedBy.Trim()) { continue }
        [PSCustomObject]@{
            Computer          = $c.SamAccountName
            DistinguishedName = $c.DistinguishedName
            ManagedBy         = ''
            OperatingSystem   = $c.OperatingSystem
        }
    }
    return (New-VerificationResult -Feature 'Computers Without Owners' -Count @($records).Count `
        -Records @($records) -WorksheetName 'Computers No Owner' -CsvFileName 'ComputersWithoutOwners.csv')
}

function Get-PreAuthenticationDisabledVerification {
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($u in $catalog.Users) {
        if (-not (Test-UacFlag -UserAccountControl $u.UserAccountControl -Flag $script:UacDontRequirePreauth)) { continue }
        $records.Add([PSCustomObject]@{
            ObjectType         = 'User'
            SamAccountName     = $u.SamAccountName
            DistinguishedName  = $u.DistinguishedName
            UserAccountControl = $u.UserAccountControl
            LastLogon          = Format-AdDateTime -FileTime $u.LastLogonTimestamp
        })
    }
    foreach ($c in $catalog.Computers) {
        if (-not (Test-UacFlag -UserAccountControl $c.UserAccountControl -Flag $script:UacDontRequirePreauth)) { continue }
        $records.Add([PSCustomObject]@{
            ObjectType         = 'Computer'
            SamAccountName     = $c.SamAccountName
            DistinguishedName  = $c.DistinguishedName
            UserAccountControl = $c.UserAccountControl
            LastLogon          = Format-AdDateTime -FileTime $c.LastLogonTimestamp
        })
    }
    return (New-VerificationResult -Feature 'Pre-authentication Disabled' -Count $records.Count `
        -Records @($records) -WorksheetName 'Preauth Disabled' -CsvFileName 'PreAuthenticationDisabled.csv')
}

function Get-SpnMisconfigurationVerification {
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    $allObjects = @()
    foreach ($u in $catalog.Users) {
        $allObjects += [PSCustomObject]@{ ObjectType = 'User'; Object = $u }
    }
    foreach ($c in $catalog.Computers) {
        $allObjects += [PSCustomObject]@{ ObjectType = 'Computer'; Object = $c }
    }

    foreach ($item in $allObjects) {
        $obj = $item.Object
        foreach ($spn in @($obj.ServicePrincipalName)) {
            $issues = [System.Collections.Generic.List[string]]::new()
            if (Test-IsMalformedSpn -Spn $spn) { [void]$issues.Add('Malformed') }
            $normSpn = $spn.ToLowerInvariant()
            if ($catalog.GlobalSpnIndex.ContainsKey($normSpn) -and @($catalog.GlobalSpnIndex[$normSpn]).Count -gt 1) {
                [void]$issues.Add('Duplicate')
            }
            if ($spn -match '[/]{2,}') { [void]$issues.Add('Invalid') }
            if ($spn -match '^\s|\s$') { [void]$issues.Add('Broken') }
            if ($issues.Count -eq 0) { continue }
            $records.Add([PSCustomObject]@{
                ObjectType        = $item.ObjectType
                SamAccountName    = $obj.SamAccountName
                DistinguishedName = $obj.DistinguishedName
                Spn               = $spn
                Issues            = ($issues -join '; ')
            })
        }
    }

    return (New-VerificationResult -Feature 'SPN Misconfiguration' -Count $records.Count `
        -Records @($records) -WorksheetName 'SPN Misconfiguration' -CsvFileName 'SpnMisconfiguration.csv')
}

function Get-UnconstrainedDelegationVerification {
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($item in @($catalog.Users + $catalog.Computers)) {
        if (-not (Test-UacFlag -UserAccountControl $item.UserAccountControl -Flag $script:UacTrustedForDelegation)) { continue }
        $isComputer = ($null -ne $item.Name)
        $records.Add([PSCustomObject]@{
            ObjectType         = if ($isComputer) { 'Computer' } else { 'User' }
            SamAccountName     = $item.SamAccountName
            DistinguishedName  = $item.DistinguishedName
            UserAccountControl = $item.UserAccountControl
            DelegationType     = 'Unconstrained'
        })
    }
    return (New-VerificationResult -Feature 'Unconstrained Delegation' -Count $records.Count `
        -Records @($records) -WorksheetName 'Unconstrained Del' -CsvFileName 'UnconstrainedDelegation.csv')
}

function Get-ConstrainedDelegationVerification {
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($item in @($catalog.Users + $catalog.Computers)) {
        $hasUac = (Test-UacFlag -UserAccountControl $item.UserAccountControl -Flag $script:UacTrustedToAuthForDel)
        $hasTargets = @($item.AllowedToDelegateTo).Count -gt 0
        if (-not $hasUac -and -not $hasTargets) { continue }
        $isComputer = ($null -ne $item.Name)
        $records.Add([PSCustomObject]@{
            ObjectType          = if ($isComputer) { 'Computer' } else { 'User' }
            SamAccountName      = $item.SamAccountName
            DistinguishedName   = $item.DistinguishedName
            UserAccountControl  = $item.UserAccountControl
            DelegationType      = 'Constrained'
            AllowedToDelegateTo = ($item.AllowedToDelegateTo -join '; ')
        })
    }
    return (New-VerificationResult -Feature 'Constrained Delegation' -Count $records.Count `
        -Records @($records) -WorksheetName 'Constrained Del' -CsvFileName 'ConstrainedDelegation.csv')
}

function Get-RbcdVerification {
    $catalog = Initialize-DomainCatalog
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($item in @($catalog.Users + $catalog.Computers)) {
        if (@($item.AllowedToActOnBehalf).Count -eq 0) { continue }
        $isComputer = ($null -ne $item.Name)
        $records.Add([PSCustomObject]@{
            ObjectType        = if ($isComputer) { 'Computer' } else { 'User' }
            SamAccountName    = $item.SamAccountName
            DistinguishedName = $item.DistinguishedName
            DelegationType    = 'Resource Based Constrained Delegation'
            RbcdDescriptor    = ($item.AllowedToActOnBehalf -join '; ')
        })
    }
    return (New-VerificationResult -Feature 'Resource Based Constrained Delegation' -Count $records.Count `
        -Records @($records) -WorksheetName 'RBCD' -CsvFileName 'ResourceBasedConstrainedDelegation.csv')
}

# Disabled — Delegation Exposure Summary
# function Get-DelegationExposureSummaryVerification {
#     $catalog = Initialize-DomainCatalog
#     $records = [System.Collections.Generic.List[object]]::new()
#     foreach ($item in @($catalog.Users + $catalog.Computers)) {
#         $exposures = [System.Collections.Generic.List[string]]::new()
#         if (Test-UacFlag -UserAccountControl $item.UserAccountControl -Flag $script:UacTrustedForDelegation) {
#             [void]$exposures.Add('Unconstrained')
#         }
#         if ((Test-UacFlag -UserAccountControl $item.UserAccountControl -Flag $script:UacTrustedToAuthForDel) -or (@($item.AllowedToDelegateTo).Count -gt 0)) {
#             [void]$exposures.Add('Constrained')
#         }
#         if (@($item.AllowedToActOnBehalf).Count -gt 0) {
#             [void]$exposures.Add('RBCD')
#         }
#         if ($exposures.Count -eq 0) { continue }
#         $isComputer = ($null -ne $item.Name)
#         $records.Add([PSCustomObject]@{
#             ObjectType         = if ($isComputer) { 'Computer' } else { 'User' }
#             SamAccountName     = $item.SamAccountName
#             DistinguishedName  = $item.DistinguishedName
#             UserAccountControl = $item.UserAccountControl
#             ExposureTypes      = ($exposures -join '; ')
#             ExposureCount      = $exposures.Count
#         })
#     }
#     return (New-VerificationResult -Feature 'Delegation Exposure Summary' -Count $records.Count `
#         -Records @($records) -WorksheetName 'Delegation Summary' -CsvFileName 'DelegationExposureSummary.csv')
# }

#endregion
#region Main

function Start-WisibilityVerification {
    $generatedAt = Get-Date
    $timestamp = $generatedAt.ToString('yyyy-MM-dd_HH-mm-ss')
    $reportFolder = Join-Path $OutputRoot $timestamp

    if (-not (Test-Path $OutputRoot)) {
        New-Item -Path $OutputRoot -ItemType Directory -Force | Out-Null
    }
    New-Item -Path $reportFolder -ItemType Directory -Force | Out-Null

    $script:LogPath = Join-Path $reportFolder 'Verification.log'
    Set-Content -Path $script:LogPath -Value '' -Encoding UTF8
    $script:AdServer = $Server

    Write-Host ''
    Write-Host '==========================================' -ForegroundColor Cyan
    Write-Host 'Wisibility Anomaly Verification Framework' -ForegroundColor Cyan
    Write-Host ('Mode: {0}' -f $(if ($script:ProductionMode) { 'Production' } else { 'Development' })) -ForegroundColor Cyan
    Write-Host '==========================================' -ForegroundColor Cyan
    Write-Host ''

    Write-VerificationLog -Message 'Verification run started'
    Write-VerificationLog -Message ("Server={0} User={1} Mode={2}" -f $Server, $Username, $(if ($script:ProductionMode) { 'Production' } else { 'Development' }))

    $script:AnomalyManifestEntries = [System.Collections.Generic.List[object]]::new()

    # Module prerequisites
    if (-not (Get-Module -ListAvailable -Name ActiveDirectory)) {
        throw 'ActiveDirectory module is not available. Install RSAT AD PowerShell tools.'
    }
    Import-Module ActiveDirectory -ErrorAction Stop
    Ensure-ImportExcelModule

    Write-Host 'Connecting to Active Directory...' -ForegroundColor Yellow
    $password = Read-Host 'Password' -AsSecureString
    $script:AdCredential = New-Object PSCredential($Username, $password)

    try {
        $null = Get-ADDomain -Server $script:AdServer -Credential $script:AdCredential
        $script:AdDomainDn = $null
        $null = Get-AdDomainDn
        Write-Host 'Connected.' -ForegroundColor Green
        Write-VerificationLog -Message 'AD connection successful'

        Initialize-SearchBases | Out-Null
        Initialize-SeedExpectations | Out-Null

        Write-Host ("Search bases — User: {0}" -f (Get-EffectiveUserSearchBase)) -ForegroundColor DarkGray
        Write-Host ("Search bases — Group: {0}" -f (Get-EffectiveGroupSearchBase)) -ForegroundColor DarkGray
        Write-Host ("Search bases — Computer: {0}" -f (Get-EffectiveComputerSearchBase)) -ForegroundColor DarkGray

        Write-Host 'Pre-loading domain catalog...' -ForegroundColor Yellow
        Initialize-DomainCatalog | Out-Null
        Initialize-PrivilegeGraph | Out-Null
        Build-GroupCatalog | Out-Null
        # SID & ACL module probe — disabled for now
        # Test-AclModuleSupport | Out-Null
        # if ($script:AclModuleSupported) {
        #     Write-Host 'ACL/SID modules: supported' -ForegroundColor Green
        # }
        # else {
        #     Write-Host ('ACL/SID modules: SKIP ({0})' -f $script:AclSkipReason) -ForegroundColor Yellow
        # }
    }
    catch {
        Write-Host ('Connection failed: {0}' -f $_.Exception.Message) -ForegroundColor Red
        Write-VerificationLog -Message ("AD connection failed: {0}" -f $_.Exception.Message) -Level 'ERROR'
        throw
    }

    $modules = @(
        @{ Name = 'Locked Accounts'; Worksheet = 'Locked Accounts'; Csv = 'LockedAccounts.csv'; Block = { Get-LockedAccountsVerification } }
        @{ Name = 'Reversible Encryption Enabled'; Worksheet = 'Reversible Encryption'; Csv = 'ReversibleEncryption.csv'; Block = { Get-ReversibleEncryptionVerification } }
        @{ Name = 'Smartcard Not Required'; Worksheet = 'Smartcard Not Required'; Csv = 'SmartcardNotRequired.csv'; Block = { Get-SmartcardNotRequiredVerification } }
        @{ Name = 'Groups Without Owners'; Worksheet = 'Groups Without Owners'; Csv = 'GroupsWithoutOwners.csv'; Block = { Get-GroupsWithoutOwnersVerification } }
        @{ Name = 'Unused Groups'; Worksheet = 'Unused Groups'; Csv = 'UnusedGroups.csv'; Block = { Get-UnusedGroupsVerification } }
        @{ Name = 'Orphan Groups'; Worksheet = 'Orphan Groups'; Csv = 'OrphanGroups.csv'; Block = { Get-OrphanGroupsVerification } }
        @{ Name = 'Duplicate Groups'; Worksheet = 'Duplicate Groups'; Csv = 'DuplicateGroups.csv'; Block = { Get-DuplicateGroupsVerification } }
        @{ Name = 'Circular Membership'; Worksheet = 'Circular Membership'; Csv = 'CircularMembership.csv'; Block = { Get-CircularMembershipVerification } }
        @{ Name = 'Toxic Privilege Combinations'; Worksheet = 'Toxic Privilege'; Csv = 'ToxicPrivilegeCombinations.csv'; Block = { Get-ToxicPrivilegeCombinationsVerification } }
        @{ Name = 'Nested Privileged Access'; Worksheet = 'Nested Privileged'; Csv = 'NestedPrivilegedAccess.csv'; Block = { Get-NestedPrivilegedAccessVerification } }
        @{ Name = 'Dormant Privileged Users'; Worksheet = 'Dormant Privileged'; Csv = 'DormantPrivilegedUsers.csv'; Block = { Get-DormantPrivilegedUsersVerification -ThresholdDays $DormantPrivilegedDays } }
        @{ Name = 'Excessive Privileges'; Worksheet = 'Excessive Privileges'; Csv = 'ExcessivePrivileges.csv'; Block = { Get-ExcessivePrivilegesVerification -Threshold $ExcessivePrivilegeThreshold } }
        @{ Name = 'Privilege Escalation Paths'; Worksheet = 'Privilege Escalation'; Csv = 'PrivilegeEscalationPaths.csv'; Block = { Get-PrivilegeEscalationPathsVerification } }
        # SID & ACL modules — disabled for now
        # @{ Name = 'Orphan SID'; Worksheet = 'Orphan SID'; Csv = 'OrphanSid.csv'; Block = { Get-OrphanSidVerification } }
        # @{ Name = 'Shadow Admin'; Worksheet = 'Shadow Admin'; Csv = 'ShadowAdmin.csv'; Block = { Get-ShadowAdminVerification } }
        # @{ Name = 'SID History Analysis'; Worksheet = 'SID History'; Csv = 'SidHistoryAnalysis.csv'; Block = { Get-SidHistoryAnalysisVerification } }
        # @{ Name = 'Foreign Security Principals'; Worksheet = 'Foreign SP'; Csv = 'ForeignSecurityPrincipals.csv'; Block = { Get-ForeignSecurityPrincipalsVerification } }
        # @{ Name = 'Unknown SID Bindings'; Worksheet = 'Unknown SID'; Csv = 'UnknownSidBindings.csv'; Block = { Get-UnknownSidBindingsVerification } }
        # @{ Name = 'Broken ACLs'; Worksheet = 'Broken ACLs'; Csv = 'BrokenAcls.csv'; Block = { Get-BrokenAclsVerification } }
        @{ Name = 'Disabled Computers'; Worksheet = 'Disabled Computers'; Csv = 'DisabledComputers.csv'; Block = { Get-DisabledComputersVerification } }
        @{ Name = 'Inactive Computers'; Worksheet = 'Inactive Computers'; Csv = 'InactiveComputers.csv'; Block = { Get-InactiveComputersVerification -ThresholdDays $InactiveComputerDays } }
        @{ Name = 'Missing Operating System'; Worksheet = 'Missing OS'; Csv = 'MissingOperatingSystem.csv'; Block = { Get-MissingOperatingSystemVerification } }
        @{ Name = 'Unsupported Operating Systems'; Worksheet = 'Unsupported OS'; Csv = 'UnsupportedOperatingSystems.csv'; Block = { Get-UnsupportedOperatingSystemsVerification } }
        @{ Name = 'Servers inside Workstation OU'; Worksheet = 'Servers Wrong OU'; Csv = 'ServersInWorkstationOu.csv'; Block = { Get-ServersInWorkstationOuVerification } }
        @{ Name = 'Duplicate SPNs'; Worksheet = 'Duplicate SPNs'; Csv = 'DuplicateSpns.csv'; Block = { Get-DuplicateSpnsVerification } }
        @{ Name = 'Computers Without Owners'; Worksheet = 'Computers No Owner'; Csv = 'ComputersWithoutOwners.csv'; Block = { Get-ComputersWithoutOwnersVerification } }
        @{ Name = 'Pre-authentication Disabled'; Worksheet = 'Preauth Disabled'; Csv = 'PreAuthenticationDisabled.csv'; Block = { Get-PreAuthenticationDisabledVerification } }
        @{ Name = 'SPN Misconfiguration'; Worksheet = 'SPN Misconfiguration'; Csv = 'SpnMisconfiguration.csv'; Block = { Get-SpnMisconfigurationVerification } }
        @{ Name = 'Unconstrained Delegation'; Worksheet = 'Unconstrained Del'; Csv = 'UnconstrainedDelegation.csv'; Block = { Get-UnconstrainedDelegationVerification } }
        @{ Name = 'Constrained Delegation'; Worksheet = 'Constrained Del'; Csv = 'ConstrainedDelegation.csv'; Block = { Get-ConstrainedDelegationVerification } }
        @{ Name = 'Resource Based Constrained Delegation'; Worksheet = 'RBCD'; Csv = 'ResourceBasedConstrainedDelegation.csv'; Block = { Get-RbcdVerification } }
        # @{ Name = 'Delegation Exposure Summary'; Worksheet = 'Delegation Summary'; Csv = 'DelegationExposureSummary.csv'; Block = { Get-DelegationExposureSummaryVerification } }
    )

    $total = @($modules).Count
    $results = [System.Collections.Generic.List[object]]::new()
    $runStart = Get-Date

    for ($i = 0; $i -lt $total; $i++) {
        $mod = $modules[$i]
        $result = Invoke-VerificationModule -Index ($i + 1) -Total $total `
            -FeatureName $mod.Name -ScriptBlock $mod.Block
        if (-not $result.WorksheetName) {
            $result | Add-Member -NotePropertyName WorksheetName -NotePropertyValue $mod.Worksheet -Force
        }
        if (-not $result.CsvFileName) {
            $result | Add-Member -NotePropertyName CsvFileName -NotePropertyValue $mod.Csv -Force
        }
        $results.Add($result)
    }

    Write-Progress -Activity 'Wisibility AD Verification' -Completed

    Write-Host ''
    Write-Host 'Exporting reports...' -ForegroundColor Yellow
    try {
        Export-VerificationReports -Results @($results) -ReportFolder $reportFolder -GeneratedAt $generatedAt
        Export-AnomalyManifest -ReportFolder $reportFolder -GeneratedAt $generatedAt
        Write-Host ('Reports saved to: {0}' -f $reportFolder) -ForegroundColor Green
        Write-VerificationLog -Message 'Report export completed'
    }
    catch {
        Write-Host ('Report export failed: {0}' -f $_.Exception.Message) -ForegroundColor Red
        Write-VerificationLog -Message ("Report export failed: {0}" -f $_.Exception.Message) -Level 'ERROR'
    }

    $runEnd = Get-Date
    $duration = $runEnd - $runStart
    $passCount = @($results | Where-Object { $_.Status -eq 'PASS' }).Count
    $failCount = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
    $skipCount = @($results | Where-Object { $_.Status -eq 'SKIP' }).Count

    Write-Host ''
    Write-Host '==========================================' -ForegroundColor Cyan
    Write-Host 'Summary' -ForegroundColor Cyan
    Write-Host ('  Modules PASS : {0}/{1}' -f $passCount, $total) -ForegroundColor $(if ($failCount) { 'Yellow' } else { 'Green' })
    Write-Host ('  Modules FAIL : {0}' -f $failCount) -ForegroundColor $(if ($failCount) { 'Red' } else { 'Green' })
    Write-Host ('  Modules SKIP : {0}' -f $skipCount) -ForegroundColor $(if ($skipCount) { 'Yellow' } else { 'Green' })
    Write-Host ('  Mode           : {0}' -f $(if ($script:ProductionMode) { 'Production' } else { 'Development' })) -ForegroundColor Cyan
    Write-Host ('  Group Scope    : {0}' -f (Get-EffectiveGroupSearchBase)) -ForegroundColor Cyan
    Write-Host ('  User Scope     : {0}' -f (Get-EffectiveUserSearchBase)) -ForegroundColor Cyan
    Write-Host ('  Computer Scope : {0}' -f (Get-EffectiveComputerSearchBase)) -ForegroundColor Cyan
    Write-Host ('  Total Duration: {0}' -f (Format-ExecutionTime -Elapsed $duration)) -ForegroundColor Cyan
    Write-Host ('  Output Folder : {0}' -f $reportFolder) -ForegroundColor Cyan
    Write-Host '==========================================' -ForegroundColor Cyan

    Write-VerificationLog -Message ("Run finished. PASS={0} FAIL={1} SKIP={2} Duration={3}" -f $passCount, $failCount, $skipCount, (Format-ExecutionTime -Elapsed $duration))
    Write-VerificationLog -Message ("Start={0} End={1}" -f $runStart.ToString('o'), $runEnd.ToString('o'))

    return [PSCustomObject]@{
        ReportFolder = $reportFolder
        Results      = @($results)
        PassCount    = $passCount
        FailCount    = $failCount
        Duration     = Format-ExecutionTime -Elapsed $duration
    }
}

Start-WisibilityVerification

#endregion
