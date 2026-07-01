# Render deployment guide

## Build command
npm install

## Start command
npm start

## Required environment variables
- PORT
- ADMIN_USERNAME
- ADMIN_PASSWORD
- ADMIN_PASSWORD_SALT
- SESSION_SECRET
- DB_TYPE
- DB_PATH

## Notes
- Render will inject the PORT environment variable automatically.
- Keep the admin password and session secret in Render environment variables.
- SQLite is used for local/dev persistence. For production-scale durability, migrate to PostgreSQL later.
