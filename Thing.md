name: smarthome-os-platform overview: > Phase 1 planning artifacts and full-stack implementation roadmap for SmartHomeOS — a universal IoT control platform. Produces all planning documents (PRD, architecture, database schema, API specs, security, deployment) in Wave 1, then implements backend (Fastify/TypeScript/PostgreSQL/MQTT) in Waves 2–4, and frontend (React/Vite) in Waves 5–7, with production hardening in Wave 8. Self-hosted Docker Compose deployment. todos:

id: w1-monorepo content: "Wave 1: Initialize monorepo structure (Turborepo + pnpm)" status: pending
id: w1-prd content: "Wave 1: Create Product Requirements Document (PRD)" status: pending
id: w1-architecture content: "Wave 1: Create system architecture document" status: pending
id: w1-db-schema content: "Wave 1: Design database schema (ER diagrams + Prisma schema)" status: pending
id: w1-api-specs content: "Wave 1: Create REST + GraphQL API specifications" status: pending
id: w1-frontend-arch content: "Wave 1: Create frontend component architecture" status: pending
id: w1-device-arch content: "Wave 1: Create device integration architecture" status: pending
id: w1-security-arch content: "Wave 1: Create security architecture document" status: pending
id: w1-deploy-arch content: "Wave 1: Create deployment architecture document" status: pending
id: w1-test-strategy content: "Wave 1: Create testing strategy document" status: pending
id: w1-roadmap content: "Wave 1: Create implementation roadmap (Phases 2–8)" status: pending
id: w2-db-implement content: "Wave 2: Implement database — PostgreSQL, Prisma, migrations, seed" status: pending
id: w2-auth-service content: "Wave 2: Implement auth service — registration, login, MFA, RBAC, JWT" status: pending
id: w2-user-home content: "Wave 2: Implement user & home management service" status: pending
id: w2-api-gateway content: "Wave 2: Build API gateway — Fastify routes, middleware, validation" status: pending
id: w2-realtime content: "Wave 2: Implement real-time event system — Redis pub/sub + WebSockets" status: pending
id: w3-mqtt-bridge content: "Wave 3: Set up MQTT broker + device bridge" status: pending
id: w3-adapter-framework content: "Wave 3: Build device adapter framework + unified device model" status: pending
id: w3-discovery content: "Wave 3: Implement device discovery & registration" status: pending
id: w3-protocol-stubs content: "Wave 3: Create protocol adapter stubs (Matter, Zigbee, Z-Wave, ONVIF)" status: pending
id: w4-camera content: "Wave 4: Build camera service — stream management, recording, AI vision" status: pending
id: w4-automation content: "Wave 4: Build automation engine — rules, conditions, actions, scheduler" status: pending
id: w4-notifications content: "Wave 4: Build notification service — push, email, SMS channels" status: pending
id: w4-scenes content: "Wave 4: Build scene management service" status: pending
id: w4-analytics content: "Wave 4: Build analytics & reporting service" status: pending
id: w5-react-shell content: "Wave 5: Scaffold React app — Vite, routing, layout, state management" status: pending
id: w5-auth-ui content: "Wave 5: Build authentication UI — login, register, MFA, passkeys" status: pending
id: w5-theme-system content: "Wave 5: Build theme system — dark/light/custom, responsive framework" status: pending
id: w5-navigation content: "Wave 5: Implement navigation — sidebar, tabs, mobile bottom bar, 2-tap target" status: pending
id: w6-dashboard content: "Wave 6: Build main dashboard — status cards, real-time updates, alerts" status: pending
id: w6-device-views content: "Wave 6: Build device cards, detail views, and universal controls" status: pending
id: w6-camera-grid content: "Wave 6: Build camera grid view, live streaming, PTZ controls" status: pending
id: w6-scenes-ui content: "Wave 6: Build scene management UI — create, edit, activate scenes" status: pending
id: w6-automation-ui content: "Wave 6: Build automation builder UI — IF/THEN editor, triggers, actions" status: pending
id: w7-ai-assistant content: "Wave 7: Implement AI assistant — NLP commands, insights, recommendations" status: pending
id: w7-analytics-dash content: "Wave 7: Build analytics dashboards — energy, water, security, occupancy" status: pending
id: w7-notifications-ui content: "Wave 7: Build notification center — history, preferences, alert rules" status: pending
id: w7-accessibility content: "Wave 7: Accessibility audit + i18n framework + voice control" status: pending
id: w8-docker-prod content: "Wave 8: Production Docker Compose — multi-service, volumes, secrets" status: pending
id: w8-cicd content: "Wave 8: CI/CD pipeline — GitHub Actions, testing, builds, deploy" status: pending
id: w8-monitoring content: "Wave 8: Monitoring & alerting — health checks, logging, metrics" status: pending
id: w8-runbooks content: "Wave 8: Production runbooks & disaster recovery documentation" status: pending
id: w8-security-audit content: "Wave 8: Security hardening — audit, penetration test plan, compliance" status: pending isProject: true
SmartHomeOS — Universal IoT Control Platform
Date: 2026-06-18
Goal: Deliver all Phase 1 planning artifacts, then implement a production-ready, self-hosted universal IoT control platform with Fastify/TypeScript backend and React/Vite frontend.
Granularity: medium

Context
SmartHomeOS is a greenfield project. The working directory is empty — no code, no repository, no configuration exists yet. The platform must serve as a single unified control hub for all home IoT devices regardless of manufacturer (Ring, Nest, Hue, Lutron, Matter, Z-Wave, Zigbee, etc.).

The user's directive is:

Phase 1 (Wave 1): Produce all planning artifacts (PRD, architecture docs, database schema, API specs, security, deployment, testing strategy, roadmap). Do not write application code until these are reviewed.
Phase 2+ (Waves 2–8): Implement backend first, then frontend. Backend and frontend go in their respective waves.
Tech stack (recommended):

Layer	Technology	Rationale
Language	TypeScript (strict)	Type safety across full stack
Monorepo	Turborepo + pnpm workspaces	Fast, incremental builds; shared packages
Backend	Fastify v5 (Node.js)	2–3x faster than Express; native TS, schema validation, plugin system, built-in WebSocket
Frontend	React 18 + Vite	Fast HMR, tree-shaking, TS-native
Styling	TailwindCSS + Radix UI	Utility-first + accessible primitives
ORM	Prisma	Type-safe queries, migrations, multi-provider
Database	PostgreSQL 16	Primary store — users, homes, devices, automations
Cache / Events	Redis 7 (Stack)	Session store, pub/sub, real-time events, rate limiting
Message Queue	MQTT (Aedes broker)	Device communication; lightweight, self-hosted
Real-time	WebSockets (Fastify WS)	Push device state, alerts to UI
Auth	Better Auth v1	Passkeys, OAuth2, MFA, RBAC; self-hosted
Container	Docker Compose	Self-hosted deployment target
CI/CD	GitHub Actions	Lint → test → build → deploy
Constraints:

Self-hosted first (Docker Compose on a single VM or bare metal). Cloud-native later.
Modular monolith initially; microservices extraction is planned but deferred.
All device protocols normalized through an adapter framework.
99.99% uptime target (applies to production hardening wave).
UI target: any device reachable in ≤ 2 taps.
Architecture / Key Files
File	Role	Action
pnpm-workspace.yaml	Monorepo workspace definition	CREATE
turbo.json	Turborepo pipeline config	CREATE
packages/backend/	Fastify API server package	CREATE
packages/frontend/	React Vite SPA package	CREATE
packages/shared/	Shared types, schemas, constants	CREATE
packages/device-bridge/	MQTT bridge + adapter framework	CREATE
packages/docs/	Planning artifacts (PRD, architecture, etc.)	CREATE
docker/docker-compose.yml	Local dev services (PG, Redis, MQTT)	CREATE
docker/docker-compose.prod.yml	Production deployment	CREATE
.github/workflows/	CI/CD pipeline definitions	CREATE
Wave Breakdown
Wave 1 — Planning Artifacts & Project Scaffold
Goal: Produce every required planning document as markdown in packages/docs/, and initialize the monorepo skeleton. Zero application code is written. All tasks in this wave are independent and can run concurrently.

Task W1-A: Initialize monorepo structure
Build:

Create root package.json with "private": true and pnpm packageManager field.
Create pnpm-workspace.yaml defining packages: packages/*.
Create turbo.json with pipelines: build, lint, test, dev, db:migrate, db:seed.
Create root tsconfig.base.json with strict TypeScript settings (strict, noUncheckedIndexedAccess, paths).
Create package directories: packages/backend/, packages/frontend/, packages/shared/, packages/device-bridge/, packages/docs/.
Create packages/shared/package.json with "name": "@smarthome/shared" and "main": "./src/index.ts".
Create packages/shared/src/index.ts as an empty barrel export.
Create .gitignore (node_modules, dist, .env, *.log, docker volumes).
Create .env.example at root with placeholder keys (DB URL, Redis URL, JWT secret, MQTT port).
Create docker/docker-compose.yml with services: postgres (16-alpine), redis (7-alpine), mqtt (eclipse-mosquitto).
Test:

Run pnpm install — must succeed with zero errors.
Run pnpm exec turbo --version — must output Turborepo version.
Run docker compose -f docker/docker-compose.yml up -d — all three services must start healthy.
Run docker compose -f docker/docker-compose.yml down — clean shutdown.
Task W1-B: Create Product Requirements Document (PRD)
Build:

Create packages/docs/prd.md.
Include sections: Executive Summary, Target Users (homeowners, property managers, vacation rentals, enterprises), Core Features, User Stories, Non-Functional Requirements (latency targets: UI <100ms, device commands <500ms, camera <2s), Scope Boundaries (what's in v1 vs. later).
Document device organization structure (Indoor → Cameras, Doorbells, Locks, Lights, Climate, Sensors, Audio, Appliances, Energy; Outdoor → Cameras, Lighting, Irrigation, Gates, Pools, Energy, Security).
Document dashboard requirements: online/offline devices, active alerts, camera events, security status, energy, water, climate, device health. Near-real-time refresh.
Document smart control features: universal controls, scenes, automations (IF/THEN chains).
Document AI features: NLP control, insights, anomaly detection, predictive maintenance.
Document camera platform: RTSP/WebRTC/ONVIF/HLS, multi-view grid, PTZ, AI vision, recording (7/30/90 day retention).
Document UX requirements: mobile-first, tablet, desktop, wall panels, dark/light/custom themes, accessibility (WCAG 2.1 AA), voice control, 2-tap target.
Document notification requirements: push, SMS, email, voice calls; alert types: security, device failure, water leak, fire, offline.
Document analytics: energy, water, occupancy, security events, device reliability.
Test:

Verify file exists at packages/docs/prd.md.
Verify word count ≥ 2000 (substantive document).
Verify all required sections are present (grep for section headings).
Manual review: check that device organization tree matches the spec.
Task W1-C: Create system architecture document
Build:

Create packages/docs/architecture.md.
Include high-level system diagram (described as Mermaid or ASCII art).
Document service boundaries: Auth Service, Device Service, Camera Service, Notification Service, Automation Service, AI Service, Analytics Service, User Service, Integration Service.
Document communication patterns: REST for CRUD, GraphQL for complex queries, WebSockets for real-time push, MQTT for device telemetry/commands.
Document data flow: Device → MQTT Bridge → Adapter → Normalization → Unified Device Model → API → UI.
Document the modular monolith approach with clear module boundaries (each service is a Fastify plugin with its own routes, services, and database access).
Document how the system scales: stateless API servers behind load balancer, Redis for pub/sub across instances, MQTT broker clustering.
Document tech stack rationale per layer.
Test:

Verify file exists at packages/docs/architecture.md.
Verify that each service is documented with its responsibilities and API surface.
Verify Mermaid diagram renders correctly (paste into a Mermaid live editor).
Task W1-D: Design database schema
Build:

Create packages/docs/database-schema.md.
Include an ER diagram in Mermaid format showing all tables and relationships.
Document each table with columns, types, constraints, and indexes.
Core tables required:

Table	Key Columns	Notes
users	id, email, name, password_hash, mfa_enabled, created_at	
sessions	id, user_id, token, expires_at, ip_address	
homes	id, name, address, timezone, owner_id	One owner, many members
home_members	home_id, user_id, role (OWNER/ADMIN/MEMBER/GUEST/MANAGER)	RBAC junction
rooms	id, home_id, name, floor, type (indoor/outdoor)	
devices	id, home_id, room_id, type, manufacturer, model, status, protocol, capabilities (JSONB), last_seen	Unified device record
device_telemetry	id, device_id, metric, value, timestamp	Time-series, partitioned by month
device_events	id, device_id, event_type, payload (JSONB), timestamp	
scenes	id, home_id, name, icon, is_active, created_by	
scene_actions	id, scene_id, device_id, capability, desired_state (JSONB), order	
automations	id, home_id, name, enabled, trigger (JSONB), conditions (JSONB), actions (JSONB)	IF/THEN/ELSE
automation_logs	id, automation_id, triggered_at, result, error	
cameras	id, device_id, stream_url, protocol (RTSP/WebRTC/HLS), recording_enabled, retention_days	Extends devices
recordings	id, camera_id, start_time, end_time, storage_path, size_bytes, ai_tags (JSONB)	
notifications	id, user_id, home_id, type, title, body, channel, read_at, created_at	
notification_preferences	id, user_id, alert_type, push, email, sms (booleans)	
analytics_snapshots	id, home_id, metric, value, period_start, period_end	Hourly/daily rollups
api_keys	id, user_id, key_hash, name, scopes, expires_at	For external integrations
Include index recommendations (e.g., devices(home_id, room_id), device_telemetry(device_id, timestamp DESC)).
Include partitioning strategy for device_telemetry and recordings.
Create packages/backend/prisma/schema.prisma with all models matching the documented schema.
Test:

Verify packages/docs/database-schema.md exists.
Verify packages/backend/prisma/schema.prisma exists and is valid Prisma syntax.
Verify at least 18 models are defined in the Prisma schema.
Verify Mermaid ER diagram is present in the markdown doc.
Task W1-E: Create API specifications
Build:

Create packages/docs/api-specifications.md.
Document API design principles: RESTful resource naming, versioning (/api/v1/), consistent error format ({ error: { code, message, details } }), pagination (cursor-based for lists), rate limiting.
Document each endpoint group with request/response schemas:
Endpoint groups required:

Auth: POST /auth/register, POST /auth/login, POST /auth/logout, POST /auth/refresh, POST /auth/mfa/setup, POST /auth/mfa/verify, POST /auth/passkey/register, POST /auth/passkey/verify
Users: GET /users/me, PATCH /users/me, DELETE /users/me
Homes: GET /homes, POST /homes, GET /homes/:id, PATCH /homes/:id, DELETE /homes/:id, GET /homes/:id/members, POST /homes/:id/members, PATCH /homes/:id/members/:userId, DELETE /homes/:id/members/:userId
Rooms: GET /homes/:homeId/rooms, POST /homes/:homeId/rooms, PATCH /rooms/:id, DELETE /rooms/:id
Devices: GET /homes/:homeId/devices, POST /homes/:homeId/devices, GET /devices/:id, PATCH /devices/:id, DELETE /devices/:id, POST /devices/:id/command, GET /devices/:id/telemetry
Scenes: GET /homes/:homeId/scenes, POST /homes/:homeId/scenes, GET /scenes/:id, PATCH /scenes/:id, DELETE /scenes/:id, POST /scenes/:id/activate
Automations: GET /homes/:homeId/automations, POST /homes/:homeId/automations, GET /automations/:id, PATCH /automations/:id, DELETE /automations/:id, POST /automations/:id/toggle
Cameras: GET /cameras/:id/stream, GET /cameras/:id/recordings, POST /cameras/:id/snapshot, GET /cameras/:id/ptz
Notifications: GET /notifications, PATCH /notifications/:id/read, GET /notifications/preferences, PATCH /notifications/preferences
Analytics: GET /homes/:homeId/analytics/energy, GET /homes/:homeId/analytics/water, GET /homes/:homeId/analytics/security, GET /homes/:homeId/analytics/occupancy
Dashboard: GET /homes/:homeId/dashboard (aggregated status, online/offline counts, active alerts, recent events)
AI: POST /ai/command (NLP → structured command), GET /ai/insights/:homeId, POST /ai/automation/suggest
WebSocket: WS /ws (auth via token query param; events: device.state.changed, alert.new, camera.motion.detected, device.offline, device.online)
For each endpoint: document request method, path, auth required, path/query/body params, success response shape, error responses.
Document WebSocket event protocol: event naming convention, payload schema, subscription mechanism.
Include GraphQL schema as an appendix (optional query layer for complex dashboard queries).
Test:

Verify packages/docs/api-specifications.md exists.
Verify all 12 endpoint groups are documented.
Verify WebSocket event types are enumerated.
Verify error format specification is present.
Task W1-F: Create frontend component architecture
Build:

Create packages/docs/frontend-architecture.md.
Document the SPA architecture: React 18, Vite, React Router v6, TanStack Query for server state, Zustand for client state.
Document the component tree:
App
├── AuthProvider (Better Auth context)
├── ThemeProvider (dark/light/custom)
├── WebSocketProvider (real-time events)
├── Layout
│   ├── Sidebar (desktop) / BottomNav (mobile)
│   ├── Header (home selector, notifications bell, user menu)
│   └── Main content area (React Router <Outlet>)
├── Pages
│   ├── DashboardPage
│   │   ├── StatusSummaryCard
│   │   ├── DeviceHealthWidget
│   │   ├── AlertBanner
│   │   ├── CameraPreviewGrid
│   │   ├── EnergyWidget
│   │   └── ClimateWidget
│   ├── DevicesPage
│   │   ├── DeviceList (filterable by room/type/status)
│   │   ├── DeviceCard (status, health, battery, firmware)
│   │   └── DeviceDetailPage
│   │       ├── UniversalControlPanel
│   │       ├── TelemetryChart
│   │       └── EventLog
│   ├── CamerasPage
│   │   ├── CameraGrid (2x2, 3x3, 4x4 selectable)
│   │   ├── CameraTile (WebRTC/RTSP player)
│   │   ├── PTZControls
│   │   └── RecordingTimeline
│   ├── ScenesPage
│   │   ├── SceneCard (activate with one tap)
│   │   └── SceneEditor (add/remove actions, set device states)
│   ├── AutomationsPage
│   │   ├── AutomationList
│   │   └── AutomationBuilder (IF trigger → THEN action, drag-drop)
│   ├── AnalyticsPage
│   │   ├── EnergyChart, WaterChart, SecurityChart
│   │   └── DateRangePicker
│   ├── SettingsPage
│   │   ├── HomeSettings, UserProfile, ThemePicker, NotificationPrefs
│   │   └── IntegrationsPanel (link third-party accounts)
│   └── AuthPages
│       ├── LoginPage, RegisterPage, MFAVerifyPage
│       └── PasskeyRegistration
└── Shared Components
    ├── Button, Input, Modal, Toast, Dropdown, Tabs
    ├── StatusBadge (online/offline/error)
    ├── LoadingSpinner, SkeletonCard
    └── EmptyState
Document state management strategy:
Server state: TanStack Query with WebSocket invalidation.
UI state: Zustand stores (theme, sidebar open, selected home, camera layout).
Real-time: WebSocket context pushes events → QueryClient invalidation.
Document routing table (paths, page components, auth requirements).
Document the 2-tap navigation target: Home → Devices list → Device detail.
Test:

Verify packages/docs/frontend-architecture.md exists.
Verify component tree covers all pages from the PRD.
Verify state management strategy is documented.
Verify routing table is complete.
Task W1-G: Create device integration architecture
Build:

Create packages/docs/device-integration-architecture.md.
Document the adapter pattern:
Physical Device
  → Protocol Layer (Matter/Thread/Zigbee/Z-Wave/MQTT/ONVIF/RTSP/BLE/WiFi)
    → Protocol Adapter (translates protocol-specific to unified)
      → Normalization Layer (maps to UnifiedDeviceModel)
        → Device Repository (PostgreSQL)
          → API Layer
            → UI Layer
Document the UnifiedDeviceModel TypeScript interface:
interface UnifiedDevice {
  id: string;
  homeId: string;
  roomId: string | null;
  type: DeviceType; // 'camera' | 'light' | 'lock' | 'thermostat' | 'sensor' | 'speaker' | 'appliance' | 'gate' | 'irrigation' | 'energy' | ...
  manufacturer: string;
  model: string;
  status: 'online' | 'offline' | 'error' | 'updating';
  capabilities: Capability[]; // 'onOff' | 'dimming' | 'colorTemp' | 'rgb' | 'lockUnlock' | 'stream' | 'ptz' | 'record' | 'temperature' | 'humidity' | 'motion' | ...
  state: Record<string, unknown>; // Current device state (varies by capabilities)
  health: { batteryLevel?: number; signalStrength?: number; lastSeen: Date; firmwareVersion: string; };
  protocol: Protocol; // 'matter' | 'zigbee' | 'zwave' | 'mqtt' | 'onvif' | 'rtsp' | ...
  metadata: Record<string, unknown>; // Protocol-specific metadata
}
Document each protocol adapter interface:
interface ProtocolAdapter {
  protocol: Protocol;
  discover(): Promise<DiscoveredDevice[]>;
  connect(deviceId: string): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  sendCommand(deviceId: string, capability: Capability, params: CommandParams): Promise<void>;
  subscribeToEvents(deviceId: string, handler: (event: DeviceEvent) => void): void;
  getTelemetry(deviceId: string, metric: string, range: TimeRange): Promise<TelemetryPoint[]>;
}
Document how device discovery works: mDNS/DNS-SD for Matter, MQTT topic scanning for Zigbee2MQTT, Z-Wave JS inclusion, ONVIF device discovery.
Document the MQTT topic structure for device communication:
smarthome/devices/{deviceId}/state — current state (retained)
smarthome/devices/{deviceId}/command — command messages
smarthome/devices/{deviceId}/telemetry/{metric} — telemetry streams
smarthome/devices/{deviceId}/events — event stream
Document how third-party cloud integrations work (Ring, Nest, etc.) via OAuth2 + webhook or polling.
Create packages/device-bridge/src/types.ts with the TypeScript interfaces defined above.
Create packages/shared/src/device-types.ts with the UnifiedDevice, DeviceType, Capability, Protocol types.
Test:

Verify packages/docs/device-integration-architecture.md exists.
Verify packages/device-bridge/src/types.ts exists with ProtocolAdapter interface.
Verify packages/shared/src/device-types.ts exists with UnifiedDevice type.
Verify MQTT topic structure is documented.
Task W1-H: Create security architecture document
Build:

Create packages/docs/security-architecture.md.
Document authentication flow: email/password, social login (Google, Apple, GitHub), passkeys (WebAuthn), MFA (TOTP + SMS fallback), biometric (platform authenticator).
Document authorization model: RBAC with roles (OWNER, ADMIN, FAMILY_MEMBER, GUEST, PROPERTY_MANAGER) and scoped permissions (device.control, camera.view, automation.edit, home.settings, billing.manage).
Document token management: JWT access tokens (15 min expiry), refresh tokens (7 days, stored hashed in DB), token rotation on refresh.
Document encryption standards:
TLS 1.3 for all API traffic (enforced via Fastify HTTPS).
AES-256-GCM for sensitive data at rest (device credentials, API keys).
MQTT TLS for device communication.
argon2id for password hashing.
Document API security: rate limiting (Redis), CORS whitelist, Helmet headers, input validation (Fastify schemas), CSRF protection.
Document device security: device identity verification, secure provisioning, certificate pinning, firmware signing.
Document data privacy: PII encryption, data retention policies, GDPR/CCPA compliance notes.
Document threat model: STRIDE analysis for key flows (device command, camera stream, user auth).
Document security monitoring: audit logs, anomaly detection, failed login alerts.
Test:

Verify packages/docs/security-architecture.md exists.
Verify all sections are present (grep section headings).
Verify RBAC role/permission matrix is documented.
Verify encryption standards are specified.
Task W1-I: Create deployment architecture document
Build:

Create packages/docs/deployment-architecture.md.
Document target: self-hosted Docker Compose (single VM or bare metal).
Document service topology:
┌─────────────────────────────────────────────┐
│              NGINX (TLS termination)          │
│  :443 → Fastify API, :80 → React SPA static  │
├─────────────────────────────────────────────┤
│  Fastify API (stateless, N instances)        │
│  React SPA (static files served by NGINX)    │
├─────────────────────────────────────────────┤
│  PostgreSQL 16 (primary + read replicas)     │
│  Redis 7 (cache + pub/sub)                   │
│  MQTT Broker (Aedes / Mosquitto)             │
│  MinIO (S3-compatible object storage)        │
├─────────────────────────────────────────────┤
│  Optional: Grafana + Prometheus monitoring   │
│  Optional: ELK / Loki log aggregation        │
└─────────────────────────────────────────────┘
Document Docker Compose production file structure: docker/docker-compose.prod.yml with proper restart policies, health checks, volume mounts, secrets management, resource limits.
Document backup strategy: PostgreSQL pg_dump nightly, MinIO bucket replication, Redis AOF persistence.
Document scaling plan: horizontal scaling of Fastify instances behind NGINX load balancer, PostgreSQL read replicas, Redis sentinel, MQTT bridge clustering.
Document monitoring: Prometheus metrics endpoints on each service, Grafana dashboards for API latency, device health, error rates, system resources.
Document CI/CD pipeline stages: lint → typecheck → unit test → integration test → build Docker images → push to registry → deploy via docker compose pull + up.
Include environment variable reference table.
Test:

Verify packages/docs/deployment-architecture.md exists.
Verify topology diagram is present.
Verify backup strategy is documented.
Verify CI/CD pipeline stages are enumerated.
Task W1-J: Create testing strategy document
Build:

Create packages/docs/testing-strategy.md.
Document testing pyramid:
Unit tests (Vitest): All service functions, utility functions, adapter logic. Target: 80% coverage.
Integration tests (Vitest + Supertest): API endpoints with real PostgreSQL (testcontainers or Docker). Device bridge with real MQTT broker.
E2E tests (Playwright): Critical user journeys (login → dashboard → control device → verify state).
Load tests (k6): API endpoints at scale (1000 concurrent WebSocket connections, 100 req/s REST).
Security tests: Dependency audit (npm audit), SAST (ESLint security plugin), secret scanning.
Document test organization:
packages/backend/src/__tests__/
├── unit/          # per-service unit tests
├── integration/   # API endpoint tests
└── fixtures/      # test data factories
packages/frontend/src/__tests__/
├── unit/          # component unit tests
├── integration/   # page-level tests
└── e2e/           # Playwright specs
Document test commands: pnpm test (all), pnpm test:unit, pnpm test:integration, pnpm test:e2e.
Document CI test matrix: Node 20 + 22, PostgreSQL 16, Redis 7.
Document device simulator strategy: mock MQTT devices for integration tests, fixture-based protocol adapters.
Test:

Verify packages/docs/testing-strategy.md exists.
Verify testing pyramid is documented with tool choices.
Verify test directory structure is specified.
Verify CI test matrix is enumerated.
Task W1-K: Create implementation roadmap
Build:

Create packages/docs/implementation-roadmap.md.
Document the phased approach:
Phase	Waves	Scope	Est. Duration
Phase 1	Wave 1	Planning artifacts (this wave)	1–2 weeks
Phase 2	Waves 2–4	Backend implementation	6–8 weeks
Phase 3	Waves 5–7	Frontend implementation	6–8 weeks
Phase 4	Wave 8	Production hardening	2–4 weeks
Include milestone definitions with acceptance criteria.
Note dependencies between phases.
Include risk register: technical risks (protocol compatibility, camera stream latency), mitigation strategies.
Test:

Verify packages/docs/implementation-roadmap.md exists.
Verify all 8 waves are listed with scope summaries.
Verify milestone acceptance criteria are defined.
Wave 2 — Backend Core Infrastructure
Goal: Stand up the backend monolith with database, authentication, user/home management, API gateway, and real-time events. This is the foundation all other backend services depend on.

Prerequisite: Wave 1 must be complete (planning artifacts reviewed).

Task W2-A: Implement PostgreSQL database with Prisma
Build:

In packages/backend/package.json, add dependencies: prisma, @prisma/client, pg.
Copy packages/backend/prisma/schema.prisma from W1-D (already created with 18+ models).
Run npx prisma generate to generate the Prisma client.
Create first migration: npx prisma migrate dev --name init.
Create packages/backend/src/db/prisma.ts — singleton Prisma client export.
Create packages/backend/prisma/seed.ts with seed data:
1 demo user (password: Demo1234!, argon2-hashed)
1 demo home ("My Home")
5 rooms (Living Room, Kitchen, Master Bedroom, Front Yard, Garage)
3 demo devices (Living Room Light — Zigbee, Front Door Lock — Z-Wave, Driveway Camera — ONVIF)
1 demo scene ("Good Night" — turns off all lights, locks all doors)
1 demo automation ("Motion → Light" trigger)
Add "prisma": { "seed": "tsx prisma/seed.ts" } to packages/backend/package.json.
Add db:migrate and db:seed scripts.
Test:

Run docker compose -f docker/docker-compose.yml up -d postgres.
Run cd packages/backend && npx prisma migrate dev — must succeed.
Run cd packages/backend && npx prisma db seed — must insert seed data.
Run cd packages/backend && npx prisma studio — verify models render in Prisma Studio.
Run npx prisma validate — no schema errors.
Task W2-B: Implement authentication service
Build:

Create packages/backend/src/plugins/auth.ts — Fastify plugin registering auth routes.
Create packages/backend/src/services/auth.service.ts with:
register(email, password, name) → User + JWT tokens
login(email, password) → User + JWT tokens
refreshToken(refreshToken) → new token pair
logout(refreshToken) → invalidate refresh token
setupMFA(userId) → TOTP secret + QR code URI
verifyMFA(userId, code) → validate TOTP
registerPasskey(userId) → WebAuthn credential creation options
verifyPasskey(userId, credential) → WebAuthn verification
validateSession(request) → Fastify preHandler hook
Create packages/backend/src/utils/crypto.ts:
hashPassword(plain) → argon2id hash
verifyPassword(plain, hash) → boolean
generateTokens(userId) → { accessToken, refreshToken }
verifyAccessToken(token) → decoded payload
Create packages/backend/src/schemas/auth.schema.ts — Fastify JSON schemas for register/login/MFA/refresh request/response validation.
Implement JWT with RS256 (generate keypair, store private key in env, public key for verification).
Implement RBAC decorator: request.hasRole('ADMIN'), request.hasPermission('device.control').
Implement rate limiting on auth endpoints (5 login attempts per minute per IP).
Test:

POST /api/v1/auth/register with valid body → 201, returns user + tokens.
POST /api/v1/auth/register with duplicate email → 409.
POST /api/v1/auth/login with valid credentials → 200, returns tokens.
POST /api/v1/auth/login with wrong password → 401.
GET /api/v1/users/me without auth header → 401.
GET /api/v1/users/me with valid token → 200, returns user.
POST /api/v1/auth/refresh with valid refresh token → 200, new token pair.
POST /api/v1/auth/refresh with revoked token → 401.
MFA setup → returns TOTP secret; verify with valid code → 200.
Rate limit: 6 rapid login failures → 429 on 6th attempt.
Task W2-C: Implement user & home management service
Build:

Create packages/backend/src/services/user.service.ts:
getProfile(userId) → user details
updateProfile(userId, data) → updated user
deleteAccount(userId) → soft delete
Create packages/backend/src/plugins/home.routes.ts:
listHomes(userId) → homes where user is member
createHome(userId, data) → new home
getHome(homeId) → home with rooms, device counts, member counts
updateHome(homeId, data) → updated home
deleteHome(homeId) → cascade delete rooms/devices/scenes
Create packages/backend/src/services/home.service.ts:
addMember(homeId, email, role) → invite user
updateMemberRole(homeId, userId, role) → change role
removeMember(homeId, userId) → revoke access
listMembers(homeId) → members with roles
Create packages/backend/src/plugins/room.routes.ts:
CRUD for rooms under a home
Assign room type (indoor/outdoor) and floor
Implement authorization: only OWNER can delete home; ADMIN+ can manage members; MEMBER+ can view.
Test:

Create home → 201, home is returned with owner membership.
List homes for user → 200, array includes created home.
Add member with valid email → 200, new member appears in list.
Add member with invalid role → 400.
Non-owner attempts delete home → 403.
Owner deletes home → 204, home and cascaded entities removed.
Create room under home → 201.
List rooms for home → 200, includes created room.
Task W2-D: Build API gateway & middleware
Build:

Create packages/backend/src/app.ts — Fastify instance factory with:
@fastify/cors (configured from env)
@fastify/helmet (security headers)
@fastify/rate-limit (global + per-route overrides)
@fastify/websocket (real-time)
@fastify/swagger + @fastify/swagger-ui (API docs)
@fastify/sensible (utility errors)
Custom error handler (standardized JSON error responses)
Request ID generation (UUID per request)
Request logging (pino, structured JSON)
Create packages/backend/src/server.ts — entry point that creates the app, registers plugins, and starts listening.
Create packages/backend/src/plugins/ directory with plugin files that register route groups:
auth.routes.ts, user.routes.ts, home.routes.ts, room.routes.ts
Create packages/backend/src/middleware/:
auth.guard.ts — Fastify preHandler that validates JWT and attaches user to request
rbac.guard.ts — Factory function: requireRole('ADMIN') returns preHandler
validate.ts — Wraps Fastify schema validation with custom error messages
Create packages/backend/src/utils/errors.ts — custom error classes (NotFoundError, UnauthorizedError, ForbiddenError, ValidationError) mapping to HTTP status codes.
Add pnpm dev script (tsx watch on server.ts) and pnpm build (tsc).
Test:

pnpm dev starts server and logs "Server listening on port 3001".
GET /api/v1/health → 200, { status: "ok", uptime: number }.
GET /api/v1/docs → Swagger UI renders.
Request with invalid JSON body → 400 with standardized error format.
Request to unknown route → 404 with standardized error.
CORS preflight → correct headers returned.
Security headers present (Helmet): Content-Security-Policy, X-Content-Type-Options, etc.
Task W2-E: Implement real-time event system
Build:

Create packages/backend/src/services/events.service.ts:
Uses Redis pub/sub (ioredis) for cross-instance event broadcasting.
publishEvent(event: AppEvent) → publishes to Redis channel.
subscribeToHome(homeId, userId) → filters events for user's homes.
Create packages/backend/src/plugins/websocket.routes.ts:
Upgrade GET /ws?token=<jwt> to WebSocket.
On connect: validate JWT, register client in connection pool.
On message: handle subscribe (homeId), unsubscribe (homeId), ping.
On disconnect: clean up subscriptions.
Push events to subscribed clients: device.state.changed, alert.new, camera.motion.detected, device.offline, device.online, automation.triggered.
Create packages/shared/src/events.ts — event type definitions:
type AppEvent =
  | { type: 'device.state.changed'; deviceId: string; state: Record<string, unknown>; timestamp: string }
  | { type: 'device.offline'; deviceId: string; lastSeen: string }
  | { type: 'device.online'; deviceId: string }
  | { type: 'alert.new'; alertId: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string }
  | { type: 'camera.motion.detected'; cameraId: string; snapshotUrl: string; timestamp: string }
  | { type: 'automation.triggered'; automationId: string; result: 'success' | 'failure' }
  | { type: 'scene.activated'; sceneId: string; userId: string };
Add Redis to Docker Compose (already in W1-A), verify connection.
Test:

Connect to ws://localhost:3001/ws?token=<valid_jwt> → connection accepted.
Send { type: "subscribe", homeId: "<homeId>" } → subscription acknowledged.
Publish device.state.changed via service → client receives event payload.
Connect with invalid token → connection rejected.
Client disconnects → server logs cleanup.
Two clients subscribed to same home → both receive events (Redis pub/sub test).
Wave 3 — Device Integration Layer
Goal: Build the MQTT bridge, adapter framework, unified device model, and protocol stubs. This connects the platform to physical devices.

Prerequisite: Wave 2 (backend core) must be complete.

Task W3-A: Set up MQTT broker & device bridge
Build:

Create packages/device-bridge/package.json with dependencies: aedes (MQTT broker), mqtt (client), ioredis.
Create packages/device-bridge/src/broker.ts:
Initialize Aedes MQTT broker on configurable port (default 1883).
Authenticate clients via JWT tokens in MQTT CONNECT password field.
Authorize publish/subscribe based on device ownership.
Persist retained messages to Redis.
Create packages/device-bridge/src/bridge.ts:
Subscribe to device command topics (smarthome/devices/+/command).
On command: validate, normalize, forward to appropriate protocol adapter.
Subscribe to device telemetry topics → batch insert into PostgreSQL.
Forward device state changes to Redis pub/sub → WebSocket service.
Create packages/device-bridge/src/client.ts:
MQTT client that connects to the broker.
Used by protocol adapters to publish device state/telemetry.
Add MQTT service to docker/docker-compose.yml (Mosquitto with config file for auth bridge) or embed Aedes in the device-bridge package.
Test:

Start MQTT broker → accepts connections on port 1883.
Connect an MQTT client with valid credentials → connected.
Connect with invalid credentials → rejected.
Publish to smarthome/devices/test/state → retained message stored.
Publish to smarthome/devices/test/command → bridge processes and logs.
Device state change appears in Redis pub/sub → WebSocket clients receive event.
Task W3-B: Build device adapter framework
Build:

Create packages/device-bridge/src/adapter-framework.ts:
AdapterRegistry — singleton registry for protocol adapters.
registerAdapter(adapter: ProtocolAdapter) — add adapter.
getAdapter(protocol: Protocol) — retrieve adapter by protocol.
routeCommand(deviceId, capability, params) — find adapter, send command.
normalizeDevice(discovered: DiscoveredDevice, adapter: ProtocolAdapter) → UnifiedDevice.
Implement the normalization pipeline:
Raw protocol data → capability detection → state mapping → unified model.
Capability detection rules: Zigbee cluster → Capability, Z-Wave command class → Capability, ONVIF profile → Capability.
Create packages/device-bridge/src/normalizers/ directory with per-protocol normalizers.
Create packages/device-bridge/src/repository.ts:
upsertDevice(unified: UnifiedDevice) → insert or update in PostgreSQL.
getDevice(deviceId) → UnifiedDevice from DB.
listDevices(homeId) → devices for a home.
updateDeviceState(deviceId, state) → partial state update.
Wire the bridge to the Fastify backend: expose device CRUD via API, device commands via MQTT.
Test:

Register a mock protocol adapter → AdapterRegistry.getAdapter('mock') returns it.
Discover a mock device → normalization produces valid UnifiedDevice.
upsertDevice with new device → INSERT into PostgreSQL.
upsertDevice with existing device → UPDATE.
Send command via API POST /devices/:id/command → bridge routes to adapter → command executed.
Task W3-C: Implement device discovery & registration
Build:

Create packages/backend/src/plugins/device.routes.ts:
POST /homes/:homeId/devices/discover → trigger discovery across all registered adapters.
GET /homes/:homeId/devices/discover/status → poll discovery progress.
POST /homes/:homeId/devices/register → manually register a device by protocol + address.
GET /devices/:id → device detail with current state, telemetry summary, event log.
PATCH /devices/:id → update device metadata (name, room assignment).
DELETE /devices/:id → remove device and associated data.
POST /devices/:id/command → send command to device via bridge.
Create packages/backend/src/services/device.service.ts:
discoverDevices(homeId) → trigger all adapters, collect results, return discovered list.
registerDevice(homeId, discovered) → normalize, upsert, assign to room.
sendCommand(deviceId, capability, params) → route through bridge, await acknowledgment.
getDeviceStatus(deviceId) → current state from PostgreSQL (fast) or live poll (on demand).
Implement discovery event flow: Adapter finds device → publishes to smarthome/discovery topic → bridge receives → inserts into discovered_devices table → API returns to frontend.
Test:

POST /homes/:homeId/devices/discover → returns discovery job ID.
Mock adapter returns 2 discovered devices → API returns them in status poll.
Register discovered device → 201, device appears in GET /homes/:homeId/devices.
POST /devices/:id/command { capability: "onOff", params: { on: true } } → bridge routes to adapter → adapter confirms → device state updated in DB.
Task W3-D: Create protocol adapter stubs
Build:

Create packages/device-bridge/src/adapters/ directory.
Create stub adapters (implement ProtocolAdapter interface, throw "not implemented" for complex operations):
matter.adapter.ts — Matter device discovery via mDNS, basic on/off/temperature.
zigbee.adapter.ts — Zigbee2MQTT bridge integration stub.
zwave.adapter.ts — Z-Wave JS integration stub.
onvif.adapter.ts — ONVIF camera discovery (WS-Discovery), RTSP stream URL extraction.
mock.adapter.ts — Fully functional mock adapter for testing (simulates lights, locks, cameras, sensors).
Each adapter must:
Accept configuration (MQTT broker URL, bridge address, credentials).
Implement discover() — returns DiscoveredDevice[].
Implement connect() / disconnect() lifecycle.
Implement sendCommand() for its protocol's capabilities.
Create packages/device-bridge/src/index.ts — exports AdapterRegistry, registers all adapters, exports bridge client.
Document each stub's limitations clearly (what's implemented vs. stubbed).
Test:

Import mock.adapter.ts → implements ProtocolAdapter interface.
mockAdapter.discover() → returns array of 5 mock devices (light, lock, camera, thermostat, motion sensor).
mockAdapter.connect('device-1') → resolves successfully.
mockAdapter.sendCommand('device-1', 'onOff', { on: true }) → resolves, mock device state flips.
Matter adapter discover() → handles "no Matter devices found" gracefully (returns []).
All adapters are registered in AdapterRegistry.
Wave 4 — Backend Feature Services
Goal: Implement camera management, automation engine, notifications, scenes, and analytics. These are the core smart-home features.

Prerequisite: Wave 3 (device integration) must be complete.

Task W4-A: Build camera service
Build:

Create packages/backend/src/plugins/camera.routes.ts:
GET /cameras/:id/stream → return stream URL (RTSP/WebRTC/HLS based on device capability).
POST /cameras/:id/snapshot → capture snapshot via ONVIF GetSnapshotUri or RTSP frame grab.
GET /cameras/:id/recordings → list recordings with time range filter and AI tags.
DELETE /recordings/:id → delete recording.
POST /cameras/:id/ptz → pan/tilt/zoom command (if camera supports ONVIF PTZ).
Create packages/backend/src/services/camera.service.ts:
getStreamUrl(cameraId) → resolve stream URL from device capabilities.
captureSnapshot(cameraId) → fetch JPEG frame, store in MinIO, return URL.
startRecording(cameraId) → begin RTSP→HLS transcoding (via FFmpeg subprocess).
stopRecording(cameraId) → terminate FFmpeg, finalize HLS segments.
listRecordings(cameraId, range) → query recordings table.
processAITags(recordingId) → run object detection on recording, store tags.
Create packages/backend/src/services/vision.service.ts:
Stub for AI vision pipeline: person detection, vehicle detection, animal detection, package detection.
analyzeSnapshot(imageBuffer) → { detections: Array<{ label, confidence, bbox }> }.
Use a lightweight local model or stub for v1.
Add MinIO service to docker/docker-compose.yml for object storage.
Document camera stream architecture: RTSP → FFmpeg → HLS segments → MinIO → NGINX HLS serving.
Test:

GET /cameras/:id/stream → returns { protocol: "rtsp", url: "rtsp://...", hlsUrl: "/hls/camera-id/master.m3u8" }.
POST /cameras/:id/snapshot → returns { url: "https://minio/snapshots/camera-id/timestamp.jpg" }.
GET /cameras/:id/recordings?from=...&to=... → returns array of recording metadata.
Mock vision analysis on snapshot → returns detection results.
FFmpeg transcoding starts and HLS segments are written.
Task W4-B: Build automation engine
Build:

Create packages/backend/src/plugins/automation.routes.ts:
CRUD for automations (list, create, get, update, delete).
POST /automations/:id/toggle → enable/disable.
GET /automations/:id/logs → execution history.
Create packages/backend/src/services/automation.service.ts:
evaluateAutomations() — main loop: every 500ms, evaluate all enabled automations.
Trigger evaluation: device state change events → check if any automation trigger matches.
Condition evaluation: all conditions must be true (AND logic within condition group; OR between groups).
Action execution: sequential or parallel execution of defined actions.
Cooldown: prevent re-triggering within configurable window.
Create packages/backend/src/services/automation-engine.ts:
registerTrigger(type, handler) — extensible trigger types.
registerCondition(type, evaluator) — extensible condition types.
registerAction(type, executor) — extensible action types.
Built-in triggers: device.state.equals, time.is, sunrise, sunset, motion.detected, device.offline, sensor.threshold.
Built-in conditions: home.occupied, time.between, device.state, security.mode.
Built-in actions: device.command, scene.activate, notification.send, wait.
Create packages/backend/src/schemas/automation.schema.ts — JSON schema for automation definition validation.
Test:

Create automation: "IF motion detected after sunset THEN turn on driveway lights" → 201.
Trigger matches → automation evaluates → conditions pass → action executes → device state changes.
Disabled automation → no evaluation on trigger.
Cooldown active → automation not re-triggered within window.
GET /automations/:id/logs → returns execution history with timestamps and results.
Invalid trigger definition → 400 validation error.
Task W4-C: Build notification service
Build:

Create packages/backend/src/plugins/notification.routes.ts:
GET /notifications → paginated list for user, filterable by type/read status.
PATCH /notifications/:id/read → mark as read.
PATCH /notifications/read-all → mark all as read.
GET /notifications/preferences → user's channel preferences.
PATCH /notifications/preferences → update preferences.
Create packages/backend/src/services/notification.service.ts:
send(notification) → determine channels from user prefs, dispatch to each channel.
sendPush(userId, title, body) → Firebase Cloud Messaging or Web Push API stub.
sendEmail(userId, subject, html) → SMTP via nodemailer.
sendSMS(userId, message) → Twilio API stub.
Create packages/backend/src/services/alert.service.ts:
createAlert(homeId, type, severity, title, body) → create notification, broadcast via WebSocket.
Alert types: security.breach, device.offline, water.leak, fire.alarm, co.alarm, battery.low, firmware.update.
Implement notification channels as a plugin system: each channel (push, email, SMS) is a module implementing NotificationChannel interface.
Test:

POST /notifications/test (dev-only) → create... (35 KB left)