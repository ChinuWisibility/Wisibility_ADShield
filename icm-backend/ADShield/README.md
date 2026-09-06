# ADShield

Standalone .NET Active Directory security engine foundation for IdentitySphere / ADShield.

This service is **not** domain-join dependent. It talks to Active Directory over LDAP/LDAPS using
**runtime-supplied** host, bind identity, password, base DN, and transport settings.

## Requirements

- .NET 8 SDK
- Network path to a Domain Controller (LAN, VPN, or private routing)
- Bind account with rights to read the probed object (and optionally `nTSecurityDescriptor`)

## Project structure

```text
ADShield/
├── ADShield.sln
└── src/
    ├── ADShield.Api/               # ASP.NET Core host + controllers
    ├── ADShield.Application/       # Use cases (connectivity test)
    ├── ADShield.ActiveDirectory/   # IActiveDirectoryClient + LDAP implementation
    ├── ADShield.Security/          # Placeholder for future detectors
    ├── ADShield.Models/            # Request/response DTOs
    ├── ADShield.Configuration/     # Runtime AD connection options + validation
    └── ADShield.Infrastructure/    # DI registration
```

## Start the service

```bash
cd icm-backend/ADShield
dotnet restore
dotnet run --project src/ADShield.Api
```

Default URL: `http://localhost:5088`  
Swagger (Development): `http://localhost:5088/swagger`

## Endpoints

### `GET /health`

Liveness probe.

### `POST /api/v1/ad/connectivity-test`

Body (all AD settings supplied per request — nothing is hard-coded):

```json
{
  "connection": {
    "host": "dc.example.local",
    "port": 636,
    "useSsl": true,
    "useStartTls": false,
    "bindDn": "ADSHIELD\\svc_adshield",
    "bindPassword": "***",
    "baseDn": "DC=example,DC=local",
    "searchBaseDn": "DC=example,DC=local",
    "timeoutMs": 30000,
    "acceptInvalidCertificate": false,
    "authType": "Basic"
  },
  "objectDn": null,
  "readSecurityDescriptor": true
}
```

Example:

```bash
curl -s http://localhost:5088/api/v1/ad/connectivity-test \
  -H 'Content-Type: application/json' \
  -d @payload.json
```

Response shape:

```json
{
  "success": true,
  "endpoint": "ldaps://dc.example.local:636",
  "bindSucceeded": true,
  "objectReadSucceeded": true,
  "securityDescriptorReadSucceeded": true,
  "securityDescriptorDecodeSucceeded": true,
  "elapsedMs": 1234,
  "errors": [],
  "objectDn": "CN=Users,DC=example,DC=local",
  "securityDescriptorByteLength": 184,
  "ownerSid": "S-1-5-21-...",
  "groupSid": "S-1-5-21-...",
  "aceCount": 12,
  "aces": [
    {
      "aclType": "DACL",
      "aceTypeName": "ACCESS_ALLOWED",
      "accessMaskHex": "0x10000000",
      "trusteeSid": "S-1-5-32-544",
      "isAllowed": true,
      "rights": ["GenericAll"]
    }
  ]
}
```

Passwords are never written to logs.

## Security-descriptor proof

`POST /api/v1/ad/connectivity-test` with `readSecurityDescriptor: true`:

1. Bind over LDAP/LDAPS (VPN-reachable DC; host need not be domain-joined)
2. Read the known object DN
3. Retrieve `nTSecurityDescriptor`
4. Decode the self-relative SECURITY_DESCRIPTOR
5. Enumerate DACL/SACL ACEs (trustee SID, access mask, rights labels)

### Live proof (credentials never committed)

```bash
cd icm-backend/ADShield
cp .env.example .env.local   # fill with IdentitySphere App Registry AD values
dotnet run --project src/ADShield.Api
# other terminal:
./scripts/live-sd-proof.sh
```

`.env.local` is gitignored.

## Design notes

- Uses `System.DirectoryServices.Protocols` (LDAP), not ADSI / RSAT / WinRM / PowerShell.
- Host need not be domain-joined; bind is explicit (`AuthType.Basic` by default).
- Works inside the customer AD network or over VPN/private routing as long as TCP 389/636 is reachable.
- Accepts IdentitySphere-style `url` (`ldap://host:389`) in addition to Host/Port.
- No Node.js integration in this slice.

## Not implemented yet

- `ReadUsersAsync` / `ReadGroupsAsync`
- Security detectors (shadow admin, privilege graph, …) — ACE enumeration only
- Node.js adapter / finding pipeline integration
- Authentication between Node and ADShield
- Job/async scan orchestration
