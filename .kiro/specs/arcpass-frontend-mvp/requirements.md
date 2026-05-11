# Requirements Document

## Introduction

ArcPass Frontend MVP is a production-oriented SaaS frontend for the ArcPass gas sponsorship infrastructure on Arc Network. Built inside `apps/web` using Next.js 16 App Router and TypeScript, the frontend provides a dark, modern infrastructure-style interface for Circle Grant reviewers to interact with the existing Fastify API. The frontend covers four core pages: Landing, Dashboard, Request Sponsorship, and Infrastructure Status. No authentication, no external backend rewrite, and no overengineering — the goal is a polished, functional demo that integrates cleanly with the existing monorepo architecture.

## Glossary

- **Frontend**: The Next.js 16 App Router application located at `apps/web` in the ArcPass monorepo
- **API**: The existing Fastify 5.x REST API running on port 4000 at `apps/api`
- **Dashboard**: The page displaying sponsorship metrics, recent requests, and system health indicators
- **Landing_Page**: The public-facing page introducing ArcPass with hero content, architecture overview, and live infrastructure status
- **Request_Page**: The page where users submit sponsorship requests and poll for transaction status
- **Infrastructure_Page**: The page displaying real-time health status of all ArcPass system components
- **Status_Card**: A reusable UI component displaying a labeled metric or status indicator
- **Explorer**: The Arc testnet block explorer at `https://testnet.arcscan.app/tx/`
- **Sponsorship_Request**: A request submitted via the API to sponsor a wallet's first transaction
- **Server_Component**: A React Server Component rendered on the server by default in Next.js App Router
- **Client_Component**: A React component marked with `"use client"` directive for browser interactivity
- **API_Client**: A typed fetch-based module for communicating with the Fastify API

## Requirements

### Requirement 1: Application Shell and Layout

**User Story:** As a grant reviewer, I want a consistent dark infrastructure-style layout across all pages, so that the application feels like a cohesive production SaaS product.

#### Acceptance Criteria

1. THE Frontend SHALL render a root layout with a persistent navigation header visible on every page and a page content area below it
2. THE Frontend SHALL apply a dark color scheme where the background uses neutral/gray tones at or below 20% lightness and text uses neutral tones at or above 80% lightness, styled via Tailwind CSS utility classes
3. THE Frontend SHALL display a responsive navigation bar containing links to Landing ("/"), Dashboard ("/dashboard"), Request Sponsorship ("/request"), and Infrastructure ("/infrastructure") pages
4. WHEN the viewport width is below 768px, THE Frontend SHALL collapse the navigation links into a toggleable mobile menu that is hidden by default
5. THE Frontend SHALL use the Geist font family (Geist Sans for body text, Geist Mono for code/monospace elements) for all text content
6. THE Frontend SHALL include HTML metadata for each page consisting of a page-specific title (maximum 60 characters), a meta description (maximum 160 characters), and Open Graph tags for og:title, og:description, and og:type
7. WHEN a navigation link corresponds to the currently active route, THE Frontend SHALL visually distinguish that link from inactive links

### Requirement 2: Landing Page

**User Story:** As a grant reviewer, I want to see a compelling landing page that explains ArcPass, so that I understand the product value and technical architecture at a glance.

#### Acceptance Criteria

1. THE Landing_Page SHALL display a hero section with the ArcPass product name, a tagline describing gas sponsorship infrastructure, and a call-to-action button linking to the Request_Page
2. THE Landing_Page SHALL display a section explaining the Arc onboarding problem (cold-start gas barrier for new wallets)
3. THE Landing_Page SHALL display a section explaining the ArcPass solution (sponsored first transaction via relay infrastructure)
4. WHEN the Landing_Page loads, THE Landing_Page SHALL fetch the API health endpoint with a timeout of 5 seconds and display an infrastructure status indicator showing either a healthy state or a degraded state based on the response
5. THE Landing_Page SHALL display the deployed contract addresses for SponsorVault and SponsorshipRegistry read from the `NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS` and `NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS` environment variables
6. THE Landing_Page SHALL display an architecture overview section with a visual representation of the system components including the Frontend, API, Worker, Database, and Smart Contracts
7. THE Landing_Page SHALL display a link to the ArcPass GitHub repository read from the `NEXT_PUBLIC_GITHUB_URL` environment variable
8. IF the API health endpoint request fails or exceeds the 5-second timeout, THEN THE Landing_Page SHALL display the status indicator in a degraded state visually distinct from the healthy state, without preventing the rest of the page from rendering

### Requirement 3: Dashboard Page

**User Story:** As a grant reviewer, I want to see sponsorship metrics and recent activity, so that I can verify the system is processing transactions correctly.

#### Acceptance Criteria

1. THE Dashboard SHALL display sponsorship metric cards showing total requests, approved count, rejected count, and pending count fetched from the API
2. THE Dashboard SHALL display a table of the 20 most recent sponsorship requests ordered by requested timestamp descending, with columns for wallet address, sponsorship status, and requested timestamp
3. WHEN a sponsorship request has a relay transaction, THE Dashboard SHALL display the relay transaction status and a clickable link to the block explorer using the stored explorer URL
4. THE Dashboard SHALL display health indicators for the API service and worker service, where healthy is defined as receiving a successful response from each service's health endpoint within 5 seconds
5. IF the API does not respond within 10 seconds or returns a non-success status code, THEN THE Dashboard SHALL display an error state indicating the service is unreachable and provide a retry button that re-initiates the health check and data fetch
6. THE Dashboard SHALL use Server Component rendering for initial data fetch and Client Component for interactive refresh via a manual refresh button that re-fetches metrics and the recent requests table

### Requirement 4: Request Sponsorship Page

**User Story:** As a grant reviewer, I want to submit a sponsorship request and watch it progress through the lifecycle, so that I can demonstrate the end-to-end flow.

#### Acceptance Criteria

1. THE Request_Page SHALL display a form with a wallet address input field validated to match the pattern `0x` followed by 40 hexadecimal characters
2. THE Request_Page SHALL display a submit button that sends a POST request to the sponsorship API endpoint and is disabled while the request is in flight to prevent duplicate submissions
3. WHEN a sponsorship request is submitted successfully, THE Request_Page SHALL display the request ID and begin polling the status endpoint at an interval of 3 seconds
4. WHILE polling is active, THE Request_Page SHALL display the current sponsorship status with visual state indicators for each lifecycle stage (pending, approved, rejected, relayed, completed, failed)
5. WHEN the sponsorship request reaches a terminal status (completed, failed, or rejected), THE Request_Page SHALL stop polling
6. WHEN the sponsorship request has a confirmed relay transaction, THE Request_Page SHALL display a link to the Explorer with the transaction hash
7. IF the API returns a validation error, THEN THE Request_Page SHALL display the error message below the form input
8. IF the API returns a rate limit error, THEN THE Request_Page SHALL display a message indicating the request was rate-limited and include the retry wait time from the API response
9. IF a polling request fails due to a network error, THEN THE Request_Page SHALL display an error indicator and retry polling up to 3 consecutive attempts before stopping with a manual retry option

### Requirement 5: Infrastructure Page

**User Story:** As a grant reviewer, I want to see the health status of all ArcPass infrastructure components, so that I can verify the system is operational.

#### Acceptance Criteria

1. THE Infrastructure_Page SHALL display a status card for the API service health fetched from the `/health` endpoint with a request timeout of 5 seconds
2. THE Infrastructure_Page SHALL display a status card for the PostgreSQL database connectivity, showing healthy when the API `/health` endpoint responds successfully and degraded when the API is unreachable
3. THE Infrastructure_Page SHALL display a status card for the Worker service status derived from the most recent sponsorship relay activity available via the API
4. THE Infrastructure_Page SHALL display the deployed contract addresses for SponsorVault and SponsorshipRegistry read from environment variables
5. THE Infrastructure_Page SHALL display the Arc testnet chain ID (5042002) and RPC connectivity status
6. THE Infrastructure_Page SHALL represent each component using one of three states: healthy, degraded, or offline
7. IF a component status check returns an HTTP error response or does not respond within 5 seconds, THEN THE Infrastructure_Page SHALL display that component as degraded or offline with a visual warning indicator distinguishing the two states
8. WHEN the user activates the manual refresh button, THE Infrastructure_Page SHALL re-check all component statuses and display a loading indicator until all checks complete or time out

### Requirement 6: API Client Module

**User Story:** As a developer, I want a typed API client module, so that all API calls are centralized, type-safe, and easy to maintain.

#### Acceptance Criteria

1. THE API_Client SHALL export typed functions for each API endpoint: health check (`GET /health`), wallet registration (`POST /wallets/register`), wallet lookup (`GET /wallets/:address`), wallet history (`GET /wallets/:address/history`), sponsorship request creation (`POST /sponsorship/request`), sponsorship status retrieval (`GET /sponsorship/:id`), relay transaction lookup by hash (`GET /sponsorship/tx/:hash`), and relay transaction lookup by ID (`GET /relay/:id`)
2. THE API_Client SHALL use the native fetch API for all HTTP requests, setting the `Content-Type` header to `application/json` for POST requests and serializing request bodies as JSON
3. THE API_Client SHALL read the API base URL from the `NEXT_PUBLIC_API_URL` environment variable with a default of `http://localhost:4000`
4. IF the API returns a non-2xx HTTP status code, THEN THE API_Client SHALL throw a typed error containing the HTTP status code and the error message from the response body
5. IF a fetch request fails due to a network error (request never received a response), THEN THE API_Client SHALL throw a typed error distinguishing network failures from API error responses
6. THE API_Client SHALL apply a request timeout of 10 seconds to all fetch calls and throw a typed timeout error if the deadline is exceeded
7. THE API_Client SHALL return typed response objects from each function matching the API's response shapes, using TypeScript interfaces aligned with the `packages/shared` sponsorship types

### Requirement 7: Reusable UI Components

**User Story:** As a developer, I want reusable UI components for status cards, data tables, and form elements, so that the interface is consistent and maintainable.

#### Acceptance Criteria

1. THE Frontend SHALL provide a reusable Status_Card component that accepts a label, value, and optional status indicator (healthy, degraded, offline) and renders a visually distinct indicator for each status state
2. THE Frontend SHALL provide a reusable data table component that accepts typed row data and column definitions with TypeScript generics for row type safety
3. WHEN the data table component receives an empty row array, THE Frontend SHALL display a configurable empty-state message instead of an empty table body
4. THE Frontend SHALL provide a reusable form input component with label, validation state (idle, valid, invalid), and error message display that renders the error message text below the input when in the invalid state
5. THE Frontend SHALL provide a reusable button component that accepts a loading prop and, WHILE loading is true, SHALL display a visual loading indicator and disable pointer interaction
6. THE Frontend SHALL provide a reusable badge component that accepts any SponsorshipStatusValue (pending, approved, rejected, relayed, completed, failed) or RelayStatusValue (queued, submitted, confirmed, failed) and renders a visually distinct color-coded indicator per status value
7. THE Frontend SHALL ensure all reusable UI components use semantic HTML elements and include appropriate ARIA attributes for accessibility

### Requirement 8: Responsive Design

**User Story:** As a grant reviewer, I want the application to work well on different screen sizes, so that I can demo it on any device.

#### Acceptance Criteria

1. THE Frontend SHALL render all pages on viewports from 320px to 1920px width without horizontal overflow, content clipping, or overlapping elements
2. WHILE the viewport width is below 768px, THE Frontend SHALL stack layout elements vertically and size all interactive elements (buttons, links, inputs) to a minimum touch target of 44x44px
3. THE Frontend SHALL use Tailwind CSS responsive utility classes for all breakpoint-dependent styling
4. THE Frontend SHALL maintain a minimum text size of 14px for body text and 12px for captions and labels across all viewport widths
5. WHILE the viewport width is below 768px, THE Frontend SHALL render data tables in a scrollable container or stacked card layout to prevent horizontal page overflow

### Requirement 9: TypeScript Type Safety

**User Story:** As a developer, I want strict TypeScript types throughout the frontend, so that the codebase is maintainable and catches errors at compile time.

#### Acceptance Criteria

1. THE Frontend SHALL import and use TypeScript interfaces from `packages/shared` (including `SponsorshipStatusValue`, `RelayStatusValue`, `SponsorshipRequestPayload`, `RelayStatusUpdatePayload`, and Prisma-generated model types) for all API response shapes rather than redefining equivalent types locally
2. THE Frontend SHALL define explicit TypeScript interfaces for all component props such that no component accepts untyped or inline `Record<string, any>` prop definitions
3. THE Frontend SHALL use a `tsconfig.json` with `strict` set to `true` (enabling `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, and `strictPropertyInitialization`) and the project SHALL compile with zero type errors under this configuration
4. THE Frontend SHALL export shared frontend-specific types (component prop interfaces, UI state types, and API client types) from a dedicated `types/` directory at the frontend package root
5. IF `any` type annotations exist in frontend application source files (excluding auto-generated files, type declaration files, and test fixtures), THEN THE Frontend SHALL fail the TypeScript compilation or lint check

### Requirement 10: Production Folder Structure

**User Story:** As a developer, I want a clean, scalable folder structure, so that the codebase is navigable and follows Next.js App Router conventions.

#### Acceptance Criteria

1. THE Frontend SHALL organize pages under `src/app/` following Next.js App Router file conventions with `page.tsx` and `layout.tsx` files, including route directories for `/` (landing), `/dashboard`, `/request`, and `/infrastructure`
2. THE Frontend SHALL organize reusable components under `src/components/` with subdirectories `ui/`, `layout/`, and `features/`
3. THE Frontend SHALL organize the API client and utility functions under `src/lib/`
4. THE Frontend SHALL organize TypeScript type definitions under `src/types/`
5. THE Frontend SHALL organize static configuration (contract addresses, chain config) under `src/config/`
6. THE Frontend SHALL include project configuration files (`next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `package.json`) at the `apps/web` root level
7. THE Frontend SHALL limit directory nesting to a maximum depth of 4 levels below `src/` to maintain navigability

### Requirement 11: Server and Client Component Strategy

**User Story:** As a developer, I want a clear boundary between server and client components, so that the application maximizes server rendering while supporting interactivity where needed.

#### Acceptance Criteria

1. THE Frontend SHALL use Server_Component rendering by default for all page-level components and data-fetching layouts, meaning `page.tsx` and `layout.tsx` files SHALL NOT include the `"use client"` directive
2. THE Frontend SHALL mark components with the `"use client"` directive only when they require browser interactivity: form inputs, polling mechanisms, and manual refresh buttons
3. THE Frontend SHALL pass server-fetched data to Client_Component children via props rather than re-fetching on the client
4. WHEN a page requires both static content and interactive elements, THE Frontend SHALL compose Server_Component wrappers around Client_Component islands, placing the `"use client"` boundary at the lowest possible component in the tree that requires interactivity
5. THE Frontend SHALL NOT import React client hooks (useState, useEffect, useRef with DOM access) in any file that lacks the `"use client"` directive

### Requirement 12: Environment Configuration

**User Story:** As a developer, I want environment-based configuration, so that the frontend can target different API endpoints and display correct contract addresses per environment.

#### Acceptance Criteria

1. THE Frontend SHALL read the API base URL from the `NEXT_PUBLIC_API_URL` environment variable with a default of `http://localhost:4000`
2. THE Frontend SHALL read contract addresses from `NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS` and `NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS` environment variables
3. THE Frontend SHALL read the Explorer base URL from `NEXT_PUBLIC_EXPLORER_URL` environment variable with a default of `https://testnet.arcscan.app/tx/`
4. THE Frontend SHALL read the GitHub repository URL from `NEXT_PUBLIC_GITHUB_URL` environment variable
5. IF any of the environment variables `NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS`, `NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS`, or `NEXT_PUBLIC_GITHUB_URL` is missing or empty, THEN THE Frontend SHALL display the text "Not configured" in place of the value rather than crashing or rendering an empty string
6. THE Frontend SHALL export all environment configuration from a single centralized config module under `src/config/` so that no component reads `process.env` directly
