# Walkthrough: SSL Certificate Management Console

This document outlines the architecture, setup instructions, and the recent enhancements made to the Web Management Console for the SSL Certificate Automatic Sync System.

## Overview
The web frontend is built using React, TypeScript, and Vite. It utilizes `shadcn/ui` for a clean, professional, and dark-mode-supported interface suitable for operations and maintenance tasks.

## Recent Enhancements & Fixes
The recent work focused on resolving technical debt, improving type safety, and ensuring full functionality parity between the mock environment and the backend API contract.

### 1. Mock Initialization Race Condition Fixed
**Problem:** In `VITE_USE_MOCKS=true` mode, early API calls triggered by React Query could fire before the mock fetch interceptor was fully registered in `App.tsx`.
**Solution:** The mock loading logic was moved to `main.tsx` using top-level `await import("./lib/mock")` prior to rendering the React root. This ensures that the mock intercepts all network traffic successfully.

### 2. Type Safety & ESLint Compliance
**Problem:** Widespread use of `any` types bypassed TypeScript's strict checks, and Vite's ESLint setup surfaced multiple errors, including React Fast Refresh constraints.
**Solution:**
- Replaced `any` with strong typing (`unknown`, generic interfaces, or `Record<string, unknown>`) across API clients and components (`Nodes.tsx`, `Settings.tsx`, `Login.tsx`, etc.).
- Adjusted `eslint.config.js` to intelligently handle `shadcn/ui` components without disabling core rules.
- Suppressed legacy regex escape issues safely via file-level lint instructions.
- `npm run lint` and `npm run build` now pass with zero errors.

### 3. DNS Channels & Dynamic Providers
**Problem:** The UI needed to support multiple DNS providers (Cloudflare, Aliyun, Tencent Cloud, DNSPod, etc.) and allow a custom key/value configuration.
**Solution:**
- The `DnsChannels` page was heavily refactored to support conditional field rendering based on the selected provider.
- Masked credentials logic (showing `***`) was properly integrated to prevent accidental exposure when editing an existing channel.
- A "Custom" provider fallback was added, utilizing a dynamic key/value list.

### 4. Jobs Logs & Status Filters
**Problem:** Finding a specific job or inspecting its log was difficult due to the lack of filters and an easy way to copy logs.
**Solution:**
- `Jobs.tsx` was enhanced with `Type` and `Status` dropdown filters.
- A "Copy Logs" button was added directly inside the active log viewing sheet.
- Live SSE/polling ensures log content updates smoothly when jobs are actively running.

### 5. Node Detailed Assignments
**Problem:** The `NodeDetail` view was missing an interface to attach or detach domain assignments.
**Solution:**
- A new multi-select dialog allows users to edit which certificates should be synced to the target node.
- The underlying Mock Store was updated to correctly emulate the assignment patching logic (`PUT /api/admin/nodes/:id/assignments`).

## Running the Application

### Environment Variables
Create a `.env` file in `web/frontend`:
```env
VITE_API_BASE_URL=/api
VITE_USE_MOCKS=true
```
*Note: Setting `VITE_USE_MOCKS=true` utilizes an in-memory storage layer allowing complete frontend development without needing the actual backend server.*

### Commands
- **Install dependencies:** `npm install`
- **Run local server:** `npm run dev`
- **Lint the code:** `npm run lint`
- **Build for production:** `npm run build`

### Authentication (Mock Mode)
In local development with mock enabled, use the following credentials:
- **Username:** `admin`
- **Password:** `admin`

## UI/UX Design System
We leverage `shadcn/ui` and `Tailwind CSS`. 
- The styling focuses on high info-density and operational efficiency.
- Dark mode is automatically applied, maintaining a muted, professional zinc palette rather than deep blacks or distracting gradients.
- Micro-interactions (like hover highlights on SHA256 hashes) provide utility without clutter.
