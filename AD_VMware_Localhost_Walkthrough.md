# Active Directory on VMware + Localhost App Walkthrough

This guide helps you collect the exact values needed in the **App Registry > AD connector** form when:

- AD is running inside a **VMware VM**
- Your React app runs on **localhost**
- Backend API also runs locally on the host machine

---

## 1) Understand what must connect to AD

Even if React runs in browser on `localhost`, the LDAP call is made by your **backend** (`icm-backend`), not by browser JS.

So, this path must work:

`Host machine (Node backend) -> VMware VM (Domain Controller) -> LDAP/LDAPS port`

---

## 2) VMware network mode (important)

Open VMware settings for the AD VM and check the NIC mode:

- **Bridged**: VM gets LAN IP (easiest if host + VM are on same LAN)
- **Host-only**: host can still reach VM directly (good for local lab)
- **NAT**: can work, but may require checking NAT network details

For local lab on same system, **Host-only** or **Bridged** is usually easiest.

---

## 3) Get the Domain Controller IP/FQDN from the VM

Inside the Windows Server VM (AD DC), run:

```powershell
ipconfig
hostname
```

You need one of:

- VM IP (example: `192.168.56.10`)
- VM FQDN (example: `dc01.corp.local`)

If host DNS cannot resolve FQDN, use IP in LDAP URL.

---

## 4) Find your Base DN

Base DN is usually your AD domain components:

- Domain `corp.local` -> `DC=corp,DC=local`
- Domain `example.internal` -> `DC=example,DC=internal`

Ways to confirm:

1. **Active Directory Users and Computers**  
   Domain root in tree gives your domain name.
2. **ADSI Edit** (`adsiedit.msc`)  
   Connect to *Default naming context* and copy DN.
3. PowerShell in VM:

```powershell
[System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain().GetDirectoryEntry().distinguishedName
```

---

## 5) Create/Get Bind DN (service account)

Use a dedicated read-only service account (recommended), e.g. `svc-iga-reader`.

### Create account (if not already)

In **Active Directory Users and Computers**:

- Create user in an OU like `Service Accounts`
- Set strong password
- Mark password never expires if your policy allows (lab choice)
- Keep permissions minimal (read rights are enough for user sync)

### Get full Bind DN

Open account properties -> **Attribute Editor** -> `distinguishedName`

Example:

`CN=svc-iga-reader,OU=Service Accounts,DC=corp,DC=local`

That full DN is your **Bind DN**.

---

## 6) LDAP URL to use

Use one of:

- LDAP (non-TLS): `ldap://<dc-ip-or-name>:389`
- LDAPS (TLS): `ldaps://<dc-ip-or-name>:636`

Examples:

- `ldap://192.168.56.10:389`
- `ldaps://dc01.corp.local:636`

For production, prefer **LDAPS**.

---

## 7) If using LDAPS, certificate requirement

For LDAPS on 636, the DC needs a valid server certificate.

Lab options:

- If cert chain is not trusted on host, enable app checkbox:  
  **Allow self-signed TLS (development only)**
- For proper setup, import CA chain to host trust store and keep strict TLS.

---

## 8) Verify connectivity from host machine (where backend runs)

From host PowerShell:

```powershell
Test-NetConnection 192.168.56.10 -Port 389
Test-NetConnection 192.168.56.10 -Port 636
```

Expected `TcpTestSucceeded : True` for the port you plan to use.

If False:

- Check Windows Firewall on VM
- Check VMware network mode
- Check DC is listening on that port

Inside VM, verify listeners:

```powershell
netstat -an | findstr :389
netstat -an | findstr :636
```

---

## 9) Values to fill in App Registry (AD connector)

Use:

- **LDAP URL**: `ldap://192.168.56.10:389` (or LDAPS URL)
- **Base DN**: `DC=corp,DC=local`
- **Bind DN**: `CN=svc-iga-reader,OU=Service Accounts,DC=corp,DC=local`
- **Bind Password**: password of service account
- **User Search Filter**: keep default unless you need OU-specific filter

Default filter:

`(&(objectClass=user)(objectCategory=person))`

---

## 10) Localhost architecture note

If frontend is `http://localhost:5173` and backend is `http://localhost:8080`, AD connectivity still depends on backend host -> VM route.

Browser does **not** directly connect to AD.

---

## 11) Quick troubleshooting matrix

- **Invalid credentials**: Bind DN format wrong or wrong password
- **No such object**: Base DN incorrect
- **Timeout / connect ECONNREFUSED**: IP/port/network/firewall issue
- **TLS handshake errors**: certificate trust mismatch (for LDAPS)
- **Connected but 0 users**: filter too restrictive or wrong search base

---

## 12) Suggested first working test (lab)

1. Start with `ldap://<vm-ip>:389`
2. Base DN = domain DN
3. Bind with service account DN
4. Test connection in App Registry
5. Sync users
6. Move to LDAPS once basic path works

---

If you want, next I can add a second file with **VMware screenshots checklist** (where exactly to click for NIC mode, ADUC, ADSI Edit, firewall rule screens).
