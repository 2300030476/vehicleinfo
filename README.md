# Private Vehicle ERP Portal

Admin-only, login-protected portal to manage personal vehicle records, tax history, insurance, and documents.

## Features
- Secure admin login (single-user/private)
- Global search after login by:
  - Vehicle number
  - Partial vehicle number (`AP09`, `TS07`)
  - Engine number
  - Chassis number
- Full vehicle detail page includes:
  - Basic vehicle profile
  - Tax details with paid/expired status
  - Insurance details
  - Document uploads/downloads (RC, Permit, FC, Pollution, Other)
  - History log (tax, insurance, FC renewals)
- Dashboard expiry alerts for 30-day and 7-day windows
- Non-public indexing guard (`X-Robots-Tag: noindex, nofollow`)

## Run
```bash
npm install
npm start
```
Open `http://localhost:3000`

Default credentials (change using env vars):
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=admin123`

Optional env vars:
- `PORT=3000`
- `SESSION_SECRET=change-me`

## Notes
- Data is stored in SQLite at `data/vehicleerp.sqlite`.
- Uploaded files are stored in `uploads/` and are accessible only after login.
