# Access Certification Profile Implementation

## Overview

This document tracks implementation of profile-level access certification defaults for three campaign categories:

- IDENTITY
- MANAGER
- ACCESS_ITEMS

The capability allows multiple named profiles per tenant and campaign binding through certificationProfileId.

## Backend Implementation

### New Data Model

File: icm-backend/src/models/certification/CertificationProfile.js

Collection: access_certification_profiles

Core fields:

- tenantId (required)
- applicationId (optional)
- name
- description
- status: ACTIVE | ARCHIVED
- supportedCategories: subset of [IDENTITY, MANAGER, ACCESS_ITEMS]
- defaults.identity
  - identityMode: ALL | SPECIFIC
  - identityFilter: ALL | NHI | CONTRACTOR
  - reviewerMode: DEFAULT | INTERNAL | EXTERNAL
- defaults.manager
  - reviewerResolution: AUTO_MANAGER | SELECTED_REVIEWERS
- defaults.accessItems
  - accessFilter: ALL | PRIVILEGED
  - reviewerMode: DEFAULT | INTERNAL | EXTERNAL

Indexes:

- unique (tenantId, name) for non-archived profiles

### New Profile API Endpoints

Mounted under /api/access-certification:

- GET /profiles
- GET /profiles/:id
- POST /profiles
- PUT /profiles/:id
- DELETE /profiles/:id

Controller file:

- icm-backend/src/controllers/certificationProfileController.js

Behavior:

- Enforces tenant scoping.
- Validates applicationId belongs to same tenant.
- Supports soft-delete via status=ARCHIVED.

### Campaign Integration

Files:

- icm-backend/src/models/certification/Campaign.js
- icm-backend/src/controllers/accessCertificationController.js

Changes:

- Campaign now includes certificationProfileId reference.
- createCampaign resolves and validates profile when certificationProfileId is provided.
- Profile usage is restricted to categories IDENTITY, MANAGER, ACCESS_ITEMS.
- Campaign payload values take precedence; profile defaults fill missing values:
  - identityMode
  - identityFilter
  - accessFilter

Validation:

- Profile must be ACTIVE.
- Profile must belong to current tenant.
- Profile must support the requested category.
- If profile is bound to an application, campaign applicationId must match.

## Frontend Implementation

### Service Layer

File: icm-frontend/src/services/accessCertificationService.js

Added API and controller methods:

- getCertificationProfiles(params)
- createCertificationProfile(payload)
- updateCertificationProfile(profileId, payload)
- archiveCertificationProfile(profileId)

### Wizard Integration

File: icm-frontend/src/pages/governance/accessCertification/AccessCertificationWizard.jsx

Changes:

- Loads ACTIVE certification profiles by selected category for:
  - IDENTITY
  - MANAGER
  - ACCESS_ITEMS
- Adds required Certification Profile selection in Step 4.
- Blocks Step 4 -> Step 5 if no profile selected for supported categories.
- Includes certificationProfileId in campaign create payload.
- Displays selected profile in Step 5 summary.

### Profile Management UI

File: icm-frontend/src/pages/governance/accessCertification/CertificationProfiles.jsx

Changes:

- Adds a dedicated profile manager view inside access certification.
- Lists active and archived profiles.
- Supports create, edit, archive, and reactivate actions.
- Edits category defaults for Identity, Manager, and Access Items in one dialog.

File: icm-frontend/src/pages/governance/accessCertification/AccessCertification.jsx

Changes:

- Adds a Profiles tab to the access certification dashboard.
- Mounts the new profile manager view alongside Analytics and Settings.

## Current Scope

Implemented now:

- Profile model + API + campaign binding + wizard selection + profile manager UI + implementation documentation.

Not included yet:

- Profile snapshot/versioning stored on campaign at creation time.
- Mandatory organization policy toggle for profile requirement.

## Testing Checklist

Backend:

- Create/update/archive profile endpoints.
- Campaign create with valid profile (each supported category).
- Campaign create with mismatched category/profile.
- Campaign create without profile (legacy path) remains functional.

Frontend:

- Wizard loads profiles for supported categories.
- Wizard prevents proceed without profile on supported categories.
- Payload contains certificationProfileId when selected.

Integration:

- Create profile -> create campaign with profile -> activate campaign.
- Verify reviewer assignment and review item generation remain unchanged.
