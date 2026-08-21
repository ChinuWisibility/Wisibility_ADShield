# Wisibility ADShield

Active Directory security platform (ported from Wisibility IGA UI/stack).

## Quick start

```bash
cp icm-backend/.env.example icm-backend/.env
# Set MONGODB_URI, secrets, and keep DB_NAME=ADShield
cp icm-frontend/.env.example icm-frontend/.env  # if present; otherwise use existing .env
npm install
npm run dev
```

- Frontend: http://localhost:3002  
- Backend API: http://localhost:8083  
- MongoDB database: **ADShield** (`DB_NAME`)

Super Admin uses `/admin/*`. Product nav includes Applications (AD LDAP), Identities, AD Security, Workflows/Remediation, Certifications, Audit, and Data Hygiene.
