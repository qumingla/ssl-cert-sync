# SSL Certificate Management Console

This is the frontend component of the SSL Certificate Automatic Sync System.

## Architecture
The application is built with:
- React + TypeScript
- Vite for fast bundling and development
- React Router DOM for routing
- TanStack Query (React Query) for state management and API communication
- Tailwind CSS and shadcn/ui for styling
- Zod for schema validation

## Getting Started

### 1. Environment Configuration
Create a `.env` file in the `web/frontend` directory:
```env
VITE_API_BASE_URL=/api
VITE_USE_MOCKS=true
```
When `VITE_USE_MOCKS=true` is set, an in-memory mock interceptor enables full UI development without the backend server.

### 2. Run the Application
```bash
npm install
npm run dev
```

### 3. Build & Verification
```bash
npm run lint
npm run build
```

## Features
- **Dashboard:** At-a-glance view of system status, expiring domains, online nodes, and failed jobs.
- **Domains Management:** Add domains, select DNS providers, toggle sync, and initiate operations (Issue/Renew/Sync).
- **DNS Channels:** Manage API credentials for multiple providers (Cloudflare, Aliyun, Custom).
- **Node Management:** Register edge servers and configure which certificates they sync.
- **Jobs & Event Streams:** Real-time tailing of log output using EventSource (SSE).
- **Settings:** WebDAV endpoints, Telegram Bot notifications, and Acme.sh paths.
