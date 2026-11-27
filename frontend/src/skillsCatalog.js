/**
 * Yogatik Studio — Autonomous Skills & Workflow Engine (v12.1.0 Compatible)
 * 
 * Provides 100% offline, standalone discovery, dynamic @skill injection,
 * role-based bundles, and execution workflows matching the Stable Skills Manifest v1.
 */

export const SKILL_CATEGORIES = [
  { id: 'all', label: 'All Skills', icon: 'Sparkles' },
  { id: 'architecture', label: 'Architecture & Design', icon: 'Boxes' },
  { id: 'frontend', label: 'Frontend & UI/UX', icon: 'Layout' },
  { id: 'backend', label: 'Backend & Systems', icon: 'Server' },
  { id: 'security', label: 'Security & Pentest', icon: 'ShieldCheck' },
  { id: 'devops', label: 'Cloud & DevOps', icon: 'Cloud' },
  { id: 'testing', label: 'QA & TDD', icon: 'CheckCircle2' },
  { id: 'ai_ml', label: 'AI & Data Science', icon: 'Cpu' },
  { id: 'science', label: 'Scientific & Bio', icon: 'Atom' },
  { id: 'product_growth', label: 'Product & CRO', icon: 'TrendingUp' },
]

export const AUTONOMOUS_WORKFLOWS = [
  {
    id: 'wf_saas_mvp',
    name: 'SaaS MVP Launch Loop',
    description: 'Autonomous end-to-end cycle from product ideation to hardened production release.',
    category: 'product_growth',
    steps: [
      { step: 1, skill: 'brainstorming', label: 'Ideation & MVP Scope' },
      { step: 2, skill: 'architect-review', label: 'System Topology & DB Design' },
      { step: 3, skill: 'frontend-design', label: 'Design System & Component Specs' },
      { step: 4, skill: 'test-driven-development', label: 'TDD Red-Green Implementation' },
      { step: 5, skill: 'security-auditor', label: 'Pre-flight Vulnerability Audit' },
      { step: 6, skill: 'create-pr', label: 'Release & PR Packaging' },
    ],
  },
  {
    id: 'wf_security_hardening',
    name: 'Zero-Trust Security & Audit Audit',
    description: 'Comprehensive static analysis, dependency scanning, secret safety, and differential code review.',
    category: 'security',
    steps: [
      { step: 1, skill: 'differential-review', label: 'Git Diff Security Inspection' },
      { step: 2, skill: 'codebase-cleanup-deps-audit', label: 'Dependency & CVE Audit' },
      { step: 3, skill: 'security-auditor', label: 'OWASP Top 10 & Auth Review' },
      { step: 4, skill: 'constant-time-analysis', label: 'Crypto & Memory Leaks' },
      { step: 5, skill: 'gdpr-data-handling', label: 'Data Privacy & Compliance' },
    ],
  },
  {
    id: 'wf_codebase_modernize',
    name: 'Deep Codebase Refactor & Modernization',
    description: 'Systematic technical debt elimination, AST pattern simplification, and regression test suites.',
    category: 'architecture',
    steps: [
      { step: 1, skill: 'orchestrate-batch-refactor', label: 'Dependency Graph Analysis' },
      { step: 2, skill: 'code-refactoring-tech-debt', label: 'Modular Decomposition' },
      { step: 3, skill: 'simplify-code', label: 'AST Simplification & Dead Code Wipe' },
      { step: 4, skill: 'unit-testing-test-generate', label: 'Automated Regression Suite' },
      { step: 5, skill: 'performance-profiling', label: 'Runtime & Memory Benchmark' },
    ],
  },
  {
    id: 'wf_fullstack_feature',
    name: 'Full-Stack Feature Delivery',
    description: 'Production-ready feature implementation with schema, typed API endpoints, and reactive UI.',
    category: 'frontend',
    steps: [
      { step: 1, skill: 'database-design', label: 'Schema & Indexing Strategy' },
      { step: 2, skill: 'api-design-principles', label: 'REST / tRPC API Contracts' },
      { step: 3, skill: 'react-patterns', label: 'Reactive Component Implementation' },
      { step: 4, skill: 'webapp-testing', label: 'Playwright E2E UI Flow' },
    ],
  },
  {
    id: 'wf_animated_shorts',
    name: '3D Animated Story Short Pipeline',
    description: 'End-to-end 55–70s vertical story short: fact verification, beat script, word-synced 3D/Remotion choreography, audio ducking, and frame QA.',
    category: 'frontend',
    steps: [
      { step: 1, skill: 'brainstorming', label: 'Topic, Cause-Effect & Analogy' },
      { step: 2, skill: 'cartoon-3d-shorts', label: 'Beat Script & Word-Synced Shot Plan' },
      { step: 3, skill: 'cartoon-3d-shorts', label: '3D Scene, Ink/DOF Post & Audio Mix' },
      { step: 4, skill: 'cartoon-3d-shorts', label: '2K Render & Frame-by-Frame QA' },
    ],
  },
  {
    id: 'wf_egm_spec_review',
    name: 'Elephant-Goldfish Spec & Review (EGM)',
    description: 'Spec-driven workflow: Elephant brainstorming & drafting followed by isolated zero-context Goldfish 5-stage review.',
    category: 'architecture',
    steps: [
      { step: 1, skill: 'egm-brainstorm', label: 'Elephant Brainstorm & Concept Brief' },
      { step: 2, skill: 'egm-draft', label: 'Compile Spec (FeatureRange + DetailedRange)' },
      { step: 3, skill: 'egm-review', label: '5-Stage Isolated Goldfish Review' },
      { step: 4, skill: 'egm-drift-report', label: 'Codebase Alignment & Drift Check' },
    ],
  },
]

export const AWESOME_SKILLS_CATALOG = [
  // Architecture
  {
    id: 'architect-review',
    name: 'Master Software Architect',
    category: 'architecture',
    risk: 'safe',
    tags: ['design-patterns', 'scalability', 'system-topology', 'clean-code'],
    description: 'Master software architect specializing in modern high-concurrency architecture, bounded contexts, and system design.',
    systemPrompt: 'You are an elite principal software architect. Review architectures for scalability, resilience, failure modes, and clear module boundaries.',
    tools: ['fs_find_files', 'fs_read', 'git_status'],
  },
  {
    id: 'senior-architect',
    name: 'Senior Systems Architect',
    category: 'architecture',
    risk: 'safe',
    tags: ['systems', 'infrastructure', 'c4', 'scalability'],
    description: 'Complete toolkit for enterprise software architecture, C4 diagrams, and event-driven patterns.',
    systemPrompt: 'Design scalable, decoupled systems. Provide clear C4 models, interface contracts, and fault tolerance strategies.',
    tools: ['fs_find_files', 'fs_read'],
  },
  {
    id: 'ddd-strategic-design',
    name: 'Domain-Driven Design (DDD)',
    category: 'architecture',
    risk: 'safe',
    tags: ['ddd', 'bounded-contexts', 'ubiquitous-language'],
    description: 'Strategic and tactical Domain-Driven Design patterns for resilient service boundaries.',
    systemPrompt: 'Apply DDD principles: identify aggregates, value objects, entities, domain events, and anti-corruption layers.',
    tools: ['fs_find_files', 'fs_read'],
  },
  {
    id: 'microservices-patterns',
    name: 'Microservices & Event-Driven Patterns',
    category: 'architecture',
    risk: 'safe',
    tags: ['microservices', 'eda', 'kafka', 'grpc'],
    description: 'Production patterns for decoupled microservices, Saga orchestration, and distributed workflows.',
    systemPrompt: 'Design resilient microservice systems using asynchronous messaging, event sourcing, and idempotent consumers.',
    tools: ['fs_find_files', 'fs_read'],
  },
  {
    id: 'egm-brainstorm',
    name: 'EGM Brainstorm (Elephant)',
    category: 'architecture',
    risk: 'safe',
    tags: ['egm', 'spec-driven', 'brainstorm', 'yagni'],
    description: 'Explore a feature idea with deep project context, challenge assumptions via fresh-context Goldfish reviewers, and write concepts_brief.md.',
    systemPrompt: 'Act as the EGM Elephant: clarify requirements and constraints, spawn fresh_context Goldfish reviewers (agent_egm_zoom_out, agent_egm_design_critic) to shoot down weak assumptions, and write the agreed direction to concepts_brief.md without writing production code.',
    tools: ['spawn_agents', 'ask_user', 'fs_read', 'fs_write', 'fs_find_files', 'fs_search'],
    enforceTools: true,
  },
  {
    id: 'egm-draft',
    name: 'EGM Spec Drafter (Elephant)',
    category: 'architecture',
    risk: 'safe',
    tags: ['egm', 'spec-driven', 'design-doc'],
    description: 'Compile a concepts brief into a structured technical specification in docs/designs/ with FeatureRange and DetailedRange.',
    systemPrompt: 'Act as the EGM Elephant Drafter: turn concepts_brief.md or discussion notes into docs/designs/<feature>.md with clear Problem, Architecture (FeatureRange), Trade-offs, and Actionable Plan (DetailedRange). Write to file rather than dumping in chat.',
    tools: ['fs_read', 'fs_write', 'fs_edit', 'fs_find_files', 'fs_search', 'ask_user'],
    enforceTools: true,
  },
  {
    id: 'egm-review',
    name: 'EGM 5-Stage Goldfish Review',
    category: 'architecture',
    risk: 'safe',
    tags: ['egm', 'goldfish', 'review', 'architecture'],
    description: 'Run the 5-stage isolated Goldfish review pipeline (Zoom Out, Comprehension, Design Critique, Intermediate Zoom Out, Implementation Readiness).',
    systemPrompt: 'Orchestrate the 5-stage EGM Goldfish review using spawn_agents with fresh_context: true: (1) agent_egm_zoom_out, (2) agent_egm_comprehension (doc only), (3) agent_egm_design_critic, (4) agent_egm_zoom_out on additions, (5) agent_egm_readiness on DetailedRange. Consolidate findings into Blocker/Major/Nit.',
    tools: ['spawn_agents', 'ask_user', 'fs_read', 'fs_write', 'fs_find_files', 'fs_search'],
    enforceTools: true,
  },
  {
    id: 'egm-resolve',
    name: 'EGM Finding Resolver',
    category: 'architecture',
    risk: 'safe',
    tags: ['egm', 'resolve', 'review', 'triage'],
    description: 'Triage Goldfish review findings (PROPOSE FIX, CONTEST, ESCALATE, DECLINE) and apply approved patches to the design doc.',
    systemPrompt: 'Act as the EGM Resolver: read the review report and target design doc, classify each finding as PROPOSE FIX, CONTEST, ESCALATE, or DECLINE, confirm trade-offs with ask_user, and apply approved edits to the design doc (never production code).',
    tools: ['ask_user', 'fs_read', 'fs_write', 'fs_edit', 'fs_find_files', 'fs_search'],
    enforceTools: true,
  },
  {
    id: 'egm-lite',
    name: 'EGM Lite (Fast-Track)',
    category: 'architecture',
    risk: 'safe',
    tags: ['egm', 'lite', 'refactor', 'bugfix'],
    description: 'Fast-track EGM workflow for small iterations, spec revisions, refactors, and bug fixes.',
    systemPrompt: 'Act as EGM Lite: quickly scope the change, run a single-pass Goldfish sanity check (agent_egm_zoom_out + agent_egm_readiness with fresh_context: true), confirm any trade-offs with ask_user, and proceed cleanly.',
    tools: ['spawn_agents', 'ask_user', 'fs_read', 'fs_write', 'fs_edit', 'fs_find_files', 'fs_search', 'git_diff'],
    enforceTools: true,
  },
  {
    id: 'egm-bootstrap',
    name: 'EGM Bootstrap Docs',
    category: 'architecture',
    risk: 'safe',
    tags: ['egm', 'bootstrap', 'documentation', 'architecture'],
    description: 'Generate or update living architecture and design documentation for an existing codebase.',
    systemPrompt: 'Act as EGM Bootstrap: map existing modules bottom-up using fs_file_tree, fs_find_files, and fs_read, then draft accurate living architecture docs in docs/designs/ verified by agent_egm_drift (fresh_context: true).',
    tools: ['spawn_agents', 'fs_read', 'fs_write', 'fs_edit', 'fs_find_files', 'fs_search', 'fs_file_tree'],
    enforceTools: true,
  },
  {
    id: 'egm-drift-report',
    name: 'EGM Drift Report',
    category: 'architecture',
    risk: 'safe',
    tags: ['egm', 'drift', 'docs', 'audit'],
    description: 'Compare checked-in design documents in docs/designs/ against live source code and report divergences.',
    systemPrompt: 'Delegate to agent_egm_drift with fresh_context: true to audit checked-in design docs against live source files, symbols, and signatures, and produce a structured drift report.',
    tools: ['spawn_agents', 'fs_read', 'fs_find_files', 'fs_search', 'git_status', 'git_diff'],
    enforceTools: true,
  },

  // Frontend & UI/UX
  {
    id: 'frontend-design',
    name: 'Frontend Designer-Engineer',
    category: 'frontend',
    risk: 'safe',
    tags: ['ui', 'ux', 'css', 'animations', 'modern-web'],
    description: 'Expert frontend designer-engineer producing stunning, high-taste interfaces with premium micro-interactions.',
    systemPrompt: 'You are a world-class UI/UX designer and frontend engineer. Create gorgeous, responsive layouts with bespoke typography, glassmorphism, and micro-animations.',
    tools: ['fs_read', 'fs_write', 'browser_control'],
  },
  {
    id: 'react-patterns',
    name: 'Modern React Architecture',
    category: 'frontend',
    risk: 'safe',
    tags: ['react', 'hooks', 'performance', 'typescript'],
    description: 'Modern React patterns, hooks composition, referential stability, and high-performance rendering.',
    systemPrompt: 'Implement clean React code with optimal hook composition, custom hooks, referential stability, and zero unnecessary re-renders.',
    tools: ['fs_read', 'fs_write'],
  },
  {
    id: 'nextjs-best-practices',
    name: 'Next.js App Router Master',
    category: 'frontend',
    risk: 'safe',
    tags: ['nextjs', 'react-server-components', 'ssr', 'routing'],
    description: 'Next.js App Router principles: React Server Components, streaming, server actions, and route handlers.',
    systemPrompt: 'Architect Next.js applications using Server Components by default, minimal client boundaries, and optimized caching.',
    tools: ['fs_read', 'fs_write'],
  },
  {
    id: 'tailwind-patterns',
    name: 'Tailwind CSS v4 Pro',
    category: 'frontend',
    risk: 'safe',
    tags: ['tailwind', 'css', 'design-tokens', 'responsive'],
    description: 'Tailwind CSS v4 principles: CSS-first configuration, container queries, and design token architecture.',
    systemPrompt: 'Craft pixel-perfect, accessible Tailwind designs with consistent token hierarchies, dark modes, and modern responsive grids.',
    tools: ['fs_read', 'fs_write'],
  },
  {
    id: 'animejs-animation',
    name: 'Anime.js & Motion Design',
    category: 'frontend',
    risk: 'safe',
    tags: ['animation', 'motion', 'interactive', 'webgl'],
    description: 'Advanced JavaScript animation library skill for creating fluid, 60fps web animations and transitions.',
    systemPrompt: 'Design rich, GPU-accelerated micro-animations, timeline orchestrations, and interactive UI motion.',
    tools: ['fs_read', 'fs_write'],
  },

  // Backend & Systems
  {
    id: 'golang-pro',
    name: 'Go Microservices & Concurrency',
    category: 'backend',
    risk: 'safe',
    tags: ['go', 'golang', 'concurrency', 'grpc', 'performance'],
    description: 'Master Go 1.22+ with goroutine safety, context propagation, channels, and zero-allocation patterns.',
    systemPrompt: 'Write idiomatic, high-throughput Go code with proper error handling, context cancellation, and concurrent safety.',
    tools: ['fs_read', 'fs_write', 'terminal_run'],
  },
  {
    id: 'rust-pro',
    name: 'Rust Systems & Async Expert',
    category: 'backend',
    risk: 'safe',
    tags: ['rust', 'tokio', 'memory-safety', 'wasm'],
    description: 'Master Rust with zero-cost abstractions, async Tokio runtime, strict lifetimes, and WebAssembly.',
    systemPrompt: 'Deliver safe, blazing-fast Rust code with idiomatic error handling (Result/Option), traits, and memory safety.',
    tools: ['fs_read', 'fs_write', 'terminal_run'],
  },
  {
    id: 'fastapi-pro',
    name: 'FastAPI & Async Python',
    category: 'backend',
    risk: 'safe',
    tags: ['python', 'fastapi', 'pydantic', 'async'],
    description: 'Modern async Python backend services with Pydantic v2, dependency injection, and OpenAPI schemas.',
    systemPrompt: 'Build production-ready FastAPI applications with async endpoints, strict Pydantic schemas, and structured logging.',
    tools: ['fs_read', 'fs_write', 'terminal_run'],
  },
  {
    id: 'dotnet-backend',
    name: '.NET 8/9 Enterprise Services',
    category: 'backend',
    risk: 'safe',
    tags: ['dotnet', 'csharp', 'ef-core', 'aspnet'],
    description: 'Build high-performance ASP.NET Core backend services with EF Core, auth, and resilient API patterns.',
    systemPrompt: 'Deliver clean C#/.NET 8+ web APIs with clean architecture, dependency injection, and Entity Framework optimizations.',
    tools: ['fs_read', 'fs_write', 'terminal_run'],
  },

  // Security & Pentesting
  {
    id: 'security-auditor',
    name: 'Enterprise Security Auditor',
    category: 'security',
    risk: 'low',
    tags: ['security', 'owasp', 'cve', 'audit', 'devsecops'],
    description: 'Expert security auditor specializing in DevSecOps, OWASP Top 10, auth flows, and penetration testing defenses.',
    systemPrompt: 'Perform rigorous security reviews. Identify XSS, SQLi, IDOR, SSRF, broken access control, and insecure cryptographic usage.',
    tools: ['fs_find_files', 'fs_read', 'git_diff'],
  },
  {
    id: 'differential-review',
    name: 'Differential PR & Diff Security Review',
    category: 'security',
    risk: 'low',
    tags: ['security', 'diff', 'pr-review', 'code-review'],
    description: 'Security-focused code review specifically targeted at PR diffs, commits, and permission surface changes.',
    systemPrompt: 'Review git diffs for introduced vulnerabilities, leaked secrets, privilege escalation paths, or regression risks.',
    tools: ['git_diff', 'git_status', 'fs_read'],
  },
  {
    id: 'ethical-hacking-methodology',
    name: 'Ethical Hacking & Defense',
    category: 'security',
    risk: 'safe',
    tags: ['ctf', 'defensive', 'hardening', 'cryptography'],
    description: 'Authorised defensive security testing, vulnerability mitigation, and secure coding practices.',
    systemPrompt: 'Help understand and defend against security exploits. Always emphasize mitigation, hardening, and ethical boundary testing.',
    tools: ['fs_read', 'web_search'],
  },

  // Cloud & DevOps
  {
    id: 'docker-expert',
    name: 'Docker & Containerization Pro',
    category: 'devops',
    risk: 'safe',
    tags: ['docker', 'containers', 'multi-stage', 'security'],
    description: 'Master multi-stage Docker builds, minimal Alpine/distroless images, caching layers, and container security.',
    systemPrompt: 'Create optimized, minimal, non-root Dockerfiles with multi-stage caching and strict security baselines.',
    tools: ['fs_read', 'fs_write', 'terminal_run'],
  },
  {
    id: 'kubernetes-architect',
    name: 'Kubernetes & Helm Infrastructure',
    category: 'devops',
    risk: 'safe',
    tags: ['kubernetes', 'k8s', 'helm', 'cloud-native'],
    description: 'Production Kubernetes manifests, Helm charts, ingress, resource limits, and auto-scaling topologies.',
    systemPrompt: 'Architect robust Kubernetes workloads with liveness/readiness probes, pod disruption budgets, and HPA.',
    tools: ['fs_read', 'fs_write', 'terminal_run'],
  },
  {
    id: 'terraform-module-library',
    name: 'Terraform & Cloud IaC',
    category: 'devops',
    risk: 'safe',
    tags: ['terraform', 'iac', 'aws', 'azure', 'gcp'],
    description: 'Production-ready Infrastructure as Code patterns for AWS, Azure, and GCP with state locking and modularity.',
    systemPrompt: 'Write clean, reusable Terraform HCL modules with strict input validation, outputs, and least-privilege IAM.',
    tools: ['fs_read', 'fs_write'],
  },

  // Testing & QA
  {
    id: 'test-driven-development',
    name: 'TDD Red-Green-Refactor Master',
    category: 'testing',
    risk: 'safe',
    tags: ['tdd', 'unit-tests', 'vitest', 'jest', 'clean-code'],
    description: 'Test-Driven Development workflow: write failing test (RED) -> write minimal code (GREEN) -> clean up (REFACTOR).',
    systemPrompt: 'Enforce strict Test-Driven Development. Always specify assertions and edge cases before writing implementation code.',
    tools: ['fs_read', 'fs_write', 'terminal_run'],
  },
  {
    id: 'webapp-testing',
    name: 'Playwright & E2E Test Suite',
    category: 'testing',
    risk: 'safe',
    tags: ['playwright', 'e2e', 'automation', 'browser-tests'],
    description: 'Comprehensive end-to-end browser testing with Playwright, visual regression, and network mocking.',
    systemPrompt: 'Author resilient Playwright test specs with robust locators (data-testid, role), network mocking, and failure artifacts.',
    tools: ['fs_read', 'fs_write', 'terminal_run', 'browser_control'],
  },

  // AI & Data Science
  {
    id: 'crewai',
    name: 'CrewAI & Multi-Agent Swarms',
    category: 'ai_ml',
    risk: 'safe',
    tags: ['multi-agent', 'crewai', 'llm', 'orchestration'],
    description: 'Orchestrate role-based collaborative AI agent teams with sequential and hierarchical task delegation.',
    systemPrompt: 'Design autonomous multi-agent systems with specialized agent roles, memory, tool access, and deterministic outputs.',
    tools: ['fs_read', 'fs_write', 'terminal_run'],
  },
  {
    id: 'rag-engineer',
    name: 'RAG & Vector Search Architect',
    category: 'ai_ml',
    risk: 'safe',
    tags: ['rag', 'vector-db', 'embeddings', 'chunking', 'search'],
    description: 'Production Retrieval-Augmented Generation: hybrid search, semantic re-ranking, and context compression.',
    systemPrompt: 'Build accurate RAG pipelines with optimized chunking, vector indexing, cross-encoder re-ranking, and hallucination checks.',
    tools: ['fs_read', 'fs_write'],
  },

  // Product & Growth
  {
    id: 'brainstorming',
    name: 'Interactive Product Strategist',
    category: 'product_growth',
    risk: 'safe',
    tags: ['planning', 'strategy', 'mvp', 'ideation'],
    description: 'Turn ideas into structured, actionable MVP specs, user journeys, and technical implementation roadmaps.',
    systemPrompt: 'Act as a senior product strategist. Break down fuzzy ideas into concrete milestones, edge cases, and high-impact MVP scope.',
    tools: ['fs_read', 'fs_write'],
  },
  {
    id: 'page-cro',
    name: 'Conversion Rate Optimization (CRO)',
    category: 'product_growth',
    risk: 'safe',
    tags: ['cro', 'conversion', 'ux', 'copywriting', 'growth'],
    description: 'Analyze and optimize landing pages, signup flows, and microcopy for maximum user conversion.',
    systemPrompt: 'Audit layouts and copy for clarity, value proposition, friction reduction, trust signals, and conversion triggers.',
    tools: ['fs_read', 'browser_control'],
  },
  {
    id: 'cartoon-3d-shorts',
    name: 'Cartoon 3D Animated Shorts',
    category: 'frontend',
    risk: 'safe',
    tags: ['video', 'shorts', 'remotion', 'threejs', 'animation', 'storytelling'],
    description: 'Create 55–70s vertical (9:16) animated story shorts using Three.js + Remotion (Desktop/CLI) or browser-native video_render with beat scripting and word-synced choreography.',
    systemPrompt: 'Direct 55-70s vertical animated story shorts using the beat formula (Hook, Setting, Escalation, Snap, Deadpan double line, Everyday analogy, Consequence, Callback), word-timestamped visual cues (0-3 frames ahead), Three.js/Remotion 2D-in-3D toon staging with ink/lens-blur/grade post-processing, ducked SFX/score mixing, and frame QA — or fall back to 1080x1920 video_render + image_generate + tts in browser-only environments.',
    tools: ['video_render', 'threeui', 'manim_anim', 'image_generate', 'tts', 'web_search', 'fs_read', 'fs_write', 'terminal_run'],
  },
]

/**
 * Searches the catalog for skills matching text or category
 */
export function searchSkillsCatalog(query = '', category = 'all') {
  const q = String(query || '').trim().toLowerCase()
  return AWESOME_SKILLS_CATALOG.filter(s => {
    const matchesCat = category === 'all' || s.category === category
    if (!matchesCat) return false
    if (!q) return true
    return (
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.tags && s.tags.some(t => t.toLowerCase().includes(q)))
    )
  })
}

/**
 * Resolves @skill mentions in user prompt text and returns augmented context
 */
export function resolveSkillMentions(text = '') {
  const matches = text.match(/@([a-zA-Z0-9_-]+)/g) || []
  const resolved = []

  for (const raw of matches) {
    const skillId = raw.replace(/^@/, '').toLowerCase()
    const found = AWESOME_SKILLS_CATALOG.find(s => s.id.toLowerCase() === skillId)
    if (found && !resolved.some(r => r.id === found.id)) {
      resolved.push(found)
    }
  }

  return resolved
}
