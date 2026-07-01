# Gift Card Checker Backend

This project now includes:

- A secure Node.js backend for validation and purchase requests
- Password-protected admin login
- An admin dashboard at /admin
- A local JSON store for development
- A deployment-ready structure for hosting on Render, Railway, Fly.io, or similar

## Local development

1. Copy config/env.example to .env
2. Update the admin credentials and secret
3. Run `npm install`
4. Run `node server.js`
5. Open http://127.0.0.1:3000

## Production deployment

Use a managed host such as Render or Railway and set these environment variables:

- PORT
- ADMIN_USERNAME
- ADMIN_PASSWORD
- SESSION_SECRET
- DB_TYPE=json
- DB_PATH=./data/requests.json

For a real production deployment, replace the JSON store with PostgreSQL or MongoDB.
