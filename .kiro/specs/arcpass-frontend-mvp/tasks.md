# Implementation Plan: ArcPass Frontend MVP

## Overview

Build the ArcPass Frontend MVP as a Next.js 16 App Router application at `apps/web`. The implementation follows a bottom-up approach: project scaffolding and configuration first, then shared modules (types, config, API client), reusable UI components, and finally the four pages (Landing, Dashboard, Request, Infrastructure). TypeScript strict mode is enforced throughout, importing shared types from `@arcpass/shared`.

## Tasks

- [x] 1. Project scaffolding and configuration
  - [x] 1.1 Initialize `apps/web` with Next.js 16 App Router, Tailwind CSS, and TypeScript strict config
    - Create `apps/web/package.json` with dependencies: next, react, react-dom, tailwindcss, @arcpass/shared
    - Create `apps/web/tsconfig.json` with `strict: true`, path alias `@` → `./src`
    - Create `apps/web/next.config.ts` with transpilePackages for `@arcpass/shared`
    - Create `apps/web/tailwind.config.ts` with dark theme colors (neutral/gray ≤20% lightness backgrounds, ≥80% lightness text)
    - Create `apps/web/postcss.config.js` for Tailwind
    - Create `apps/web/.env.example` with all `NEXT_PUBLIC_*` variables documented
    - _Requirements: 1.2, 1.5, 8.3, 9.3, 10.6, 12.1–12.4_

  - [x] 1.2 Create folder structure under `apps/web/src/`
    - Create directories: `app/`, `app/dashboard/`, `app/request/`, `app/infrastructure/`, `components/ui/`, `components/layout/`, `components/features/`, `lib/`, `types/`, `config/`, `test/`
    - Create placeholder `index.ts` barrel files in `types/` and `config/`
    - _Requirements: 10.1–10.7_

  - [x] 1.3 Set up Vitest with React Testing Library and fast-check for the web app
    - Create `apps/web/vitest.config.ts` with jsdom environment, react plugin, path alias
    - Create `apps/web/src/test/setup.ts` with testing-library cleanup
    - Add test scripts to `apps/web/package.json`
    - _Requirements: Testing Strategy from design_

- [x] 2. Environment config and type definitions
  - [x] 2.1 Create centralized environment config module at `src/config/env.ts`
    - Export `AppConfig` interface and `config` object reading all `NEXT_PUBLIC_*` env vars
    - Default `apiUrl` to `http://localhost:4000`, `explorerUrl` to `https://testnet.arcscan.app/tx/`
    - Return `null` for missing optional vars (vault address, registry address, github URL)
    - Set `chainId` to `5042002`
    - _Requirements: 12.1–12.6_

  - [x] 2.2 Create API response types at `src/types/api.ts`
    - Define `HealthResponse`, `WalletResponse`, `WalletHistoryResponse`, `SponsorshipSummary`, `SponsorshipResponse`, `SponsorshipDetailResponse`, `RelayResponse`, `DashboardMetrics`, `ApiErrorResponse`
    - Import `SponsorshipStatusValue` and `RelayStatusValue` from `@arcpass/shared`
    - _Requirements: 9.1, 9.4, 6.7_

  - [x] 2.3 Create component prop types at `src/types/components.ts`
    - Define `ComponentStatus`, `ValidationState`, `PollingState`, `InfraComponentStatus`
    - Define prop interfaces: `StatusCardProps`, `DataTableProps<T>`, `ColumnDef<T>`, `FormInputProps`, `ButtonProps`, `BadgeProps`
    - _Requirements: 9.2, 9.4_

  - [x] 2.4 Create types barrel export at `src/types/index.ts`
    - Re-export all types from `api.ts` and `components.ts`
    - _Requirements: 9.4_

  - [ ]* 2.5 Write property test for missing environment variable fallback
    - **Property 11: Missing environment variables display "Not configured"**
    - **Validates: Requirements 12.5**

- [x] 3. API client module
  - [x] 3.1 Implement typed API client at `src/lib/api-client.ts`
    - Implement error classes: `ApiError`, `NetworkError`, `TimeoutError`
    - Implement `fetchWithTimeout` helper using `AbortController` with 10-second timeout
    - Implement typed functions: `checkHealth`, `registerWallet`, `lookupWallet`, `getWalletHistory`, `createSponsorshipRequest`, `getSponsorshipStatus`, `getRelayByHash`, `getRelayById`
    - Set `Content-Type: application/json` for POST requests, serialize body with `JSON.stringify`
    - Read base URL from config module (not `process.env` directly)
    - _Requirements: 6.1–6.7_

  - [ ]* 3.2 Write property test for wallet address validation
    - **Property 1: Wallet address validation accepts only valid addresses**
    - **Validates: Requirements 4.1**

  - [ ]* 3.3 Write property test for POST request serialization
    - **Property 3: API client POST requests serialize body as JSON with correct headers**
    - **Validates: Requirements 6.2**

  - [ ]* 3.4 Write property test for ApiError on non-2xx responses
    - **Property 4: API client throws ApiError for non-2xx responses**
    - **Validates: Requirements 6.4**

  - [ ]* 3.5 Write property test for NetworkError on fetch failures
    - **Property 5: API client throws NetworkError for fetch failures**
    - **Validates: Requirements 6.5**

- [x] 4. Checkpoint - Verify foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Reusable UI components
  - [x] 5.1 Implement StatusCard component at `src/components/ui/status-card.tsx`
    - Accept `label`, `value`, and optional `status` ('healthy', 'degraded', 'offline') props
    - Render visually distinct indicator per status state using color-coded dot/icon
    - Use semantic HTML with ARIA attributes for accessibility
    - _Requirements: 7.1, 7.7_

  - [ ]* 5.2 Write property test for StatusCard
    - **Property 6: StatusCard renders label, value, and correct status indicator**
    - **Validates: Requirements 7.1, 5.6**

  - [x] 5.3 Implement DataTable component at `src/components/ui/data-table.tsx`
    - Accept typed `data` array, `columns` definitions with TypeScript generics, and optional `emptyMessage`
    - Render table with correct row/column structure
    - Display configurable empty-state message when data array is empty
    - Wrap in scrollable container on mobile viewports
    - Use semantic HTML (`<table>`, `<thead>`, `<tbody>`, `<th>`, `<td>`)
    - _Requirements: 7.2, 7.3, 7.7, 8.5_

  - [ ]* 5.4 Write property test for DataTable
    - **Property 7: DataTable renders correct row and column structure**
    - **Validates: Requirements 7.2**

  - [x] 5.5 Implement FormInput component at `src/components/ui/form-input.tsx`
    - Accept `label`, `name`, `value`, `onChange`, `validationState`, `errorMessage` props
    - Show error message below input only when `validationState` is 'invalid'
    - Minimum touch target 44x44px on mobile
    - Use semantic HTML with `<label>` association and ARIA attributes
    - _Requirements: 7.4, 7.7, 8.2_

  - [ ]* 5.6 Write property test for FormInput
    - **Property 8: FormInput displays error message only in invalid state**
    - **Validates: Requirements 7.4**

  - [x] 5.7 Implement Button component at `src/components/ui/button.tsx`
    - Accept `children`, `onClick`, `type`, `variant`, `loading`, `disabled` props
    - Show loading spinner and disable pointer interaction when `loading` is true
    - Support 'primary' and 'secondary' variants
    - Minimum touch target 44x44px on mobile
    - _Requirements: 7.5, 7.7, 8.2_

  - [ ]* 5.8 Write property test for Button
    - **Property 9: Button is disabled and shows loading indicator when loading**
    - **Validates: Requirements 7.5**

  - [x] 5.9 Implement Badge component at `src/components/ui/badge.tsx`
    - Accept `status` prop of type `SponsorshipStatusValue | RelayStatusValue`
    - Render unique color-coded indicator per status value
    - Use semantic `<span>` with ARIA label for accessibility
    - _Requirements: 7.6, 7.7_

  - [ ]* 5.10 Write property test for Badge
    - **Property 10: Badge renders visually distinct indicator per status value**
    - **Validates: Requirements 7.6, 4.4**

- [x] 6. Layout components
  - [x] 6.1 Implement root layout at `src/app/layout.tsx` (Server Component)
    - Configure Geist Sans and Geist Mono fonts via `next/font/google`
    - Apply dark background (neutral/gray ≤20% lightness), light text (≥80% lightness)
    - Include HTML metadata: page title, meta description, Open Graph tags
    - Render persistent navigation header and page content area
    - No `"use client"` directive
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 11.1_

  - [x] 6.2 Implement navigation header at `src/components/layout/header.tsx` (Client Component)
    - Mark with `"use client"` directive for mobile menu toggle state
    - Render links to `/`, `/dashboard`, `/request`, `/infrastructure`
    - Visually distinguish active route link
    - Collapse to toggleable mobile menu below 768px viewport
    - Minimum 44x44px touch targets for mobile links
    - _Requirements: 1.3, 1.4, 1.7, 8.2, 11.2_

  - [x] 6.3 Implement footer component at `src/components/layout/footer.tsx`
    - Display GitHub link from config (or "Not configured" if missing)
    - _Requirements: 2.7, 12.5_

- [x] 7. Landing page
  - [x] 7.1 Implement landing page at `src/app/page.tsx` (Server Component)
    - Render hero section with ArcPass name, tagline, and CTA button linking to `/request`
    - Render problem section explaining cold-start gas barrier
    - Render solution section explaining sponsored first transaction
    - Display deployed contract addresses from config (or "Not configured" if missing)
    - Render architecture overview section with system component visual
    - Display GitHub repository link from config
    - Include page-specific metadata (title ≤60 chars, description ≤160 chars, OG tags)
    - No `"use client"` directive on page file
    - _Requirements: 2.1–2.8, 1.6, 11.1, 12.5_

  - [x] 7.2 Implement landing status indicator at `src/components/features/landing-status.tsx` (Client Component)
    - Mark with `"use client"` directive
    - Fetch API health endpoint on mount with 5-second timeout
    - Display healthy or degraded state based on response
    - Show degraded state on failure/timeout without blocking page render
    - _Requirements: 2.4, 2.8, 11.2_

- [x] 8. Dashboard page
  - [x] 8.1 Implement dashboard page at `src/app/dashboard/page.tsx` (Server Component)
    - Fetch sponsorship metrics (total, approved, rejected, pending) via API client during SSR
    - Fetch 20 most recent sponsorship requests ordered by timestamp descending
    - Render metric cards using StatusCard component
    - Render recent requests table with columns: wallet address, status (Badge), timestamp
    - Display relay transaction link to explorer when available
    - Display health indicators for API and worker services
    - Show error state with retry button if API unreachable within 10 seconds
    - Include page-specific metadata
    - No `"use client"` directive on page file
    - _Requirements: 3.1–3.6, 1.6, 11.1, 11.3_

  - [x] 8.2 Implement dashboard refresh component at `src/components/features/dashboard-refresh.tsx` (Client Component)
    - Mark with `"use client"` directive
    - Provide manual refresh button that re-fetches metrics and recent requests
    - Show loading state during refresh
    - _Requirements: 3.6, 11.2_

- [x] 9. Request sponsorship page
  - [x] 9.1 Implement request form component at `src/components/features/request-form.tsx` (Client Component)
    - Mark with `"use client"` directive
    - Render wallet address input validated against `^0x[0-9a-fA-F]{40}$`
    - Disable submit button while request is in flight
    - On successful submission, display request ID and begin polling at 3-second intervals
    - Display current status with visual Badge indicators for each lifecycle stage
    - Stop polling on terminal status (completed, failed, rejected)
    - Display explorer link when relay transaction hash is available
    - Show validation error below input on API 400 response
    - Show rate limit message with retry-after time on API 429 response
    - Retry polling up to 3 times on network error, then show manual retry option
    - _Requirements: 4.1–4.9, 11.2_

  - [ ]* 9.2 Write property test for polling terminal status
    - **Property 2: Polling stops on terminal sponsorship status**
    - **Validates: Requirements 4.5**

  - [x] 9.3 Implement request page at `src/app/request/page.tsx` (Server Component)
    - Render page title and description
    - Compose Server Component wrapper around RequestForm Client Component island
    - Include page-specific metadata
    - No `"use client"` directive on page file
    - _Requirements: 4.1, 1.6, 11.1, 11.4_

- [x] 10. Infrastructure page
  - [x] 10.1 Implement infrastructure refresh component at `src/components/features/infra-refresh.tsx` (Client Component)
    - Mark with `"use client"` directive
    - Check API health (5-second timeout), derive database status from API health
    - Derive worker status from most recent relay activity via API
    - Display RPC connectivity status for Arc testnet (chain ID 5042002)
    - Display contract addresses from config (or "Not configured" if missing)
    - Represent each component as healthy, degraded, or offline
    - Show degraded/offline with visual warning indicator on HTTP error or timeout
    - Provide manual refresh button with loading indicator during re-check
    - _Requirements: 5.1–5.8, 11.2, 12.5_

  - [x] 10.2 Implement infrastructure page at `src/app/infrastructure/page.tsx` (Server Component)
    - Render page title and description
    - Compose Server Component wrapper around InfraRefresh Client Component island
    - Include page-specific metadata
    - No `"use client"` directive on page file
    - _Requirements: 5.1, 1.6, 11.1, 11.4_

- [x] 11. Checkpoint - Verify all pages render
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Responsive design and accessibility pass
  - [x] 12.1 Apply responsive Tailwind utilities across all pages and components
    - Ensure no horizontal overflow from 320px to 1920px viewport width
    - Stack layout elements vertically below 768px
    - Size all interactive elements to minimum 44x44px touch target on mobile
    - Maintain minimum 14px body text, 12px captions/labels
    - Use Tailwind responsive utility classes (`sm:`, `md:`, `lg:`) for all breakpoint styling
    - _Requirements: 8.1–8.5_

  - [x] 12.2 Verify semantic HTML and ARIA attributes on all components
    - Ensure all interactive elements have accessible names
    - Verify form inputs have associated labels
    - Confirm status indicators have ARIA labels describing their state
    - _Requirements: 7.7_

- [x] 13. Final checkpoint - Ensure all tests pass and TypeScript compiles
  - Ensure all tests pass, ask the user if questions arise.
  - Run `tsc --noEmit` to verify zero type errors under strict mode
  - Verify no `any` type annotations in source files

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All components import shared types from `@arcpass/shared` — no local type redefinition
- Server Components are the default; `"use client"` is only added where browser interactivity is required
- The `src/config/env.ts` module is the single source for environment variables — no direct `process.env` reads in components

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4", "2.5", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5"] },
    { "id": 4, "tasks": ["5.1", "5.3", "5.5", "5.7", "5.9"] },
    { "id": 5, "tasks": ["5.2", "5.4", "5.6", "5.8", "5.10", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3"] },
    { "id": 7, "tasks": ["7.1", "7.2", "8.1", "8.2"] },
    { "id": 8, "tasks": ["9.1", "9.3", "10.1", "10.2"] },
    { "id": 9, "tasks": ["9.2", "12.1", "12.2"] }
  ]
}
```
