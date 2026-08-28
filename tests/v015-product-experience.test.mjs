import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createProductRouter } from "../api/product-routes.mjs";
import { ActionService } from "../core/action-service.mjs";
import { ConversationService } from "../core/conversation-service.mjs";
import { DashboardService } from "../core/dashboard-service.mjs";
import { parseDeadline } from "../core/domain-models.mjs";
import { applySchemaV10 } from "../core/schema-v10.mjs";
import { SearchService } from "../core/search-service.mjs";
import { PROMPT_VERSION, UnderstandingEngine } from "../core/understanding-engine.mjs";
import { WorkspaceService } from "../core/workspace-service.mjs";

function createTestDatabase() {
  const raw = new DatabaseSync(":memory:");
  const db = {
    raw,
    exec: (sql) => raw.exec(sql),
    query: (sql) => {
      const stmt = raw.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
      };
    },
    transaction: (fn) => {
      return (...args) => {
        raw.exec("BEGIN");
        try {
          const res = fn(...args);
          raw.exec("COMMIT");
          return res;
        } catch (e) {
          raw.exec("ROLLBACK");
          throw e;
        }
      };
    },
  };

  // Base legacy tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      mode TEXT NOT NULL,
      state TEXT NOT NULL,
      context_text TEXT
    );
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      source_role TEXT NOT NULL,
      kind TEXT NOT NULL,
      text_raw TEXT NOT NULL,
      text_normalized TEXT NOT NULL,
      route_reason TEXT NOT NULL,
      route_score REAL NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answer_results (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      lane TEXT NOT NULL,
      model TEXT NOT NULL,
      answer_text TEXT NOT NULL,
      grounding TEXT NOT NULL,
      source_chunk_ids_json TEXT NOT NULL,
      retrieved_json TEXT NOT NULL,
      invalid_citation_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audio_channels (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      sample_rate INTEGER,
      channels INTEGER,
      state TEXT NOT NULL,
      last_sequence INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS speech_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      seq_start INTEGER NOT NULL,
      seq_end INTEGER NOT NULL,
      duration_ms REAL NOT NULL,
      audio_path TEXT NOT NULL,
      endpoint_reason TEXT NOT NULL,
      vad_engine TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gaps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      seq_start INTEGER,
      seq_end INTEGER,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      text_raw TEXT NOT NULL,
      text_normalized TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL
    );
  `);

  applySchemaV10(db);
  return db;
}

test("v0.15 schema migration creates default profile, default workspace, and idempotent session mapping", () => {
  const db = createTestDatabase();

  const profile = db.query("SELECT * FROM local_profiles WHERE id = ?").get("default-profile");
  assert.ok(profile, "Default profile should exist");
  assert.equal(profile.locale, "fa-IR");

  const workspace = db.query("SELECT * FROM workspaces WHERE id = ?").get("default-workspace");
  assert.ok(workspace, "Default workspace should exist");
  assert.equal(workspace.status, "ACTIVE");

  // Insert legacy session and re-run migration
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO sessions (id, started_at, mode, state, context_text)
    VALUES ('sess-100', ?, 'meeting', 'CLOSED', 'بررسی معماری v0.15')
  `).run(now);

  applySchemaV10(db); // Re-run migration idempotently

  const conv = db.query("SELECT * FROM conversations WHERE capture_session_id = ?").get("sess-100");
  assert.ok(conv, "Session should be mapped to a conversation");
  assert.equal(conv.workspace_id, "default-workspace");
  assert.equal(conv.kind, "MEETING");
  assert.equal(conv.state, "READY");
  assert.equal(conv.goal, "بررسی معماری v0.15");
});

test("WorkspaceService handles CRUD, color tokens, and optimistic concurrency", () => {
  const db = createTestDatabase();
  const service = new WorkspaceService(db);

  // 1. Create Workspace
  const ws = service.createWorkspace({ name: "فضای پروژه آلفا", description: "تست تیم توسعه" });
  assert.ok(ws.id.startsWith("ws-"));
  assert.equal(ws.name, "فضای پروژه آلفا");
  assert.equal(ws.revision, 1);

  // 2. Update Workspace
  const updatedWs = service.updateWorkspace(ws.id, { description: "توضیحات به‌روزشده" }, 1);
  assert.equal(updatedWs.revision, 2);
  assert.equal(updatedWs.description, "توضیحات به‌روزشده");

  // 3. Concurrency conflict
  assert.throws(() => {
    service.updateWorkspace(ws.id, { name: "نام جدید" }, 1); // Stale revision 1
  }, /CONCURRENCY_CONFLICT/);

  // 4. Create Project
  const project = service.createProject(ws.id, {
    name: "سامانه تحلیل مکالمه",
    colorToken: "purple",
  });
  assert.ok(project.id.startsWith("proj-"));
  assert.equal(project.colorToken, "purple");

  // 5. Create Person
  const person = service.createPerson(ws.id, {
    displayName: "رضا اشرفی",
    roleTitle: "معمار سیستم",
    email: "reza@example.com",
  });
  assert.ok(person.id.startsWith("per-"));
  assert.equal(person.displayName, "رضا اشرفی");

  // 6. Link Person to Project
  service.linkPersonToProject(project.id, person.id, "lead");
  const loadedProj = service.getProject(project.id);
  assert.equal(loadedProj.people.length, 1);
  assert.equal(loadedProj.people[0].displayName, "رضا اشرفی");
});

test("ConversationService manages conversations, participants, audio timeline, and pagination", () => {
  const db = createTestDatabase();
  const wsService = new WorkspaceService(db);
  const convService = new ConversationService(db);

  const ws = wsService.createWorkspace({ name: "تست مکالمات" });
  const person = wsService.createPerson(ws.id, { displayName: "علی مرادی" });

  // 1. Create conversation with participant
  const conv = convService.createConversation(ws.id, {
    title: "جلسه برنامه‌ریزی فاز اول",
    kind: "MEETING",
    participantIds: [person.id],
  });
  assert.ok(conv.id.startsWith("conv-"));
  assert.equal(conv.participants.length, 1);
  assert.equal(conv.participants[0].displayName, "علی مرادی");

  // 2. Add turns to conversation capture session
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO turns (id, session_id, ordinal, source_role, kind, text_raw, text_normalized, route_reason, route_score, state, created_at)
    VALUES
      ('t1', ?, 1, 'user', 'statement', 'سلام، باید مستندات نسخه ۱۵ را تا فردا آماده کنیم.', 'سلام باید مستندات نسخه ۱۵ را تا فردا آماده کنیم', 'exact', 1.0, 'FINAL', ?),
      ('t2', ?, 2, 'user', 'statement', 'تصمیم بر این شد که معماری به صورت ماژولار پیاده شود.', 'تصمیم بر این شد که معماری به صورت ماژولار پیاده شود', 'exact', 1.0, 'FINAL', ?)
  `).run(conv.id, now, conv.id, now);

  // 3. Get transcript timeline
  const timeline = convService.getTranscriptTimeline(conv.id, { limit: 10 });
  assert.equal(timeline.turns.length, 2);
  assert.equal(timeline.turns[0].textRaw, "سلام، باید مستندات نسخه ۱۵ را تا فردا آماده کنیم.");
});

test("UnderstandingEngine extracts Decisions, Tasks, and Risks with exact quote citations", async () => {
  const db = createTestDatabase();
  const wsService = new WorkspaceService(db);
  const convService = new ConversationService(db);
  const engine = new UnderstandingEngine(db);

  const ws = wsService.createWorkspace({ name: "تست تحلیل هوشمند" });
  const person = wsService.createPerson(ws.id, { displayName: "سارا احمدی" });

  const conv = convService.createConversation(ws.id, {
    title: "جلسه بازبینی طراحی محصول",
    kind: "MEETING",
  });

  const now = new Date().toISOString();
  db.query(`
    INSERT INTO turns (id, session_id, ordinal, source_role, kind, text_raw, text_normalized, route_reason, route_score, state, created_at)
    VALUES
      ('t1', ?, 1, 'user', 'statement', 'تصمیم گرفته شد که برای جستجو از موتور FTS5 استفاده شود.', 'تصمیم گرفته شد', 'exact', 1.0, 'FINAL', ?),
      ('t2', ?, 2, 'user', 'statement', 'سارا احمدی باید گزارش تست را تا فردا ارسال کند.', 'سارا احمدی باید گزارش تست را تا فردا ارسال کند', 'exact', 1.0, 'FINAL', ?),
      ('t3', ?, 3, 'user', 'statement', 'یک ریسک جدی وجود دارد که مهلت نهایی پروژه با تاخیر مواجه شود.', 'یک ریسک جدی', 'exact', 1.0, 'FINAL', ?)
  `).run(conv.id, now, conv.id, now, conv.id, now);

  const result = await engine.runUnderstanding(conv.id);
  assert.equal(result.cached, false);
  assert.ok(result.insights.length >= 3, "Should extract at least 3 insights");

  const decision = result.insights.find((i) => i.type === "DECISION");
  assert.ok(decision, "Should extract decision");
  assert.ok(decision.evidence.length > 0, "Decision must have evidence citation");
  assert.equal(decision.evidence[0].turnId, "t1");

  const task = result.insights.find((i) => i.type === "TASK");
  assert.ok(task, "Should extract task");
  assert.equal(task.assigneePersonId, person.id, "Task should resolve assignee to person id");
  assert.ok(task.dueAtUtc, "Task should have parsed deadline");
  assert.ok(task.evidence[0].exactQuote.includes("سارا احمدی"));

  const risk = result.insights.find((i) => i.type === "RISK");
  assert.ok(risk, "Should extract risk");
});

test("ActionService transitions tasks, records audit events, and confirms insights atomically", () => {
  const db = createTestDatabase();
  const wsService = new WorkspaceService(db);
  const convService = new ConversationService(db);
  const engine = new UnderstandingEngine(db);
  const actionService = new ActionService(db);

  const ws = wsService.createWorkspace({ name: "تست اکشن سنتر" });
  const conv = convService.createConversation(ws.id, { title: "بررسی تسک‌ها" });

  // 1. Direct Task creation
  const task = actionService.createTask(ws.id, {
    title: "تکمیل سناریوهای آزمون رگرسیون",
    priority: "HIGH",
    dueOriginalText: "تا پایان هفته",
  });
  assert.equal(task.state, "TODO");
  assert.equal(task.priority, "HIGH");
  assert.equal(task.events.length, 1);
  assert.equal(task.events[0].eventType, "TASK_CREATED");

  // 2. Transition state
  const inProgress = actionService.transitionTaskState(task.id, "IN_PROGRESS", "engineer");
  assert.equal(inProgress.state, "IN_PROGRESS");

  const done = actionService.transitionTaskState(task.id, "DONE", "engineer");
  assert.equal(done.state, "DONE");
  assert.ok(done.completedAt);
  assert.equal(done.events.length, 3);

  // 3. Confirm insight into task atomically
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO turns (id, session_id, ordinal, source_role, kind, text_raw, text_normalized, route_reason, route_score, state, created_at)
    VALUES ('t1', ?, 1, 'user', 'statement', 'باید مدل پایگاه داده را بازنویسی کنیم.', 'باید مدل پایگاه داده را بازنویسی کنیم', 'exact', 1.0, 'FINAL', ?)
  `).run(conv.id, now);

  const runRes = db
    .query(`
    INSERT INTO understanding_runs (id, conversation_id, input_fingerprint, prompt_version, provider, provider_model, state, attempt, created_at, updated_at)
    VALUES ('run-1', ?, 'fp-1', '${PROMPT_VERSION}', 'gemini', 'gemini-1.5-flash', 'COMPLETED', 1, ?, ?)
  `)
    .run(conv.id, now, now);

  const insightId = "ins-test-1";
  db.query(`
    INSERT INTO insight_items (id, workspace_id, conversation_id, run_id, type, title, body, status, confidence, fingerprint, created_by, revision, created_at, updated_at)
    VALUES (?, ?, ?, 'run-1', 'TASK', 'بازنویسی مدل داده', 'باید مدل پایگاه داده را بازنویسی کنیم.', 'SUGGESTED', 0.9, 'fp-ins', 'AI', 1, ?, ?)
  `).run(insightId, ws.id, conv.id, now, now);

  const confirmedTask = actionService.confirmInsightToTask(insightId);
  assert.ok(confirmedTask.id.startsWith("task-"));
  assert.equal(confirmedTask.sourceInsightId, insightId);
  assert.equal(confirmedTask.title, "بازنویسی مدل داده");

  const updatedInsight = engine.getInsight(insightId);
  assert.equal(updatedInsight.status, "CONFIRMED");
});

test("SearchService indexes entities and performs full-text query", () => {
  const db = createTestDatabase();
  const wsService = new WorkspaceService(db);
  const convService = new ConversationService(db);
  const actionService = new ActionService(db);
  const searchService = new SearchService(db);

  const ws = wsService.createWorkspace({ name: "فضای جستجوی فراگیر" });
  wsService.createProject(ws.id, {
    name: "پروژه یادگیری تقویتی",
    description: "توسعه الگوریتم‌های PPO",
  });
  wsService.createPerson(ws.id, { displayName: "دکتر حسینی", notes: "متخصص یادگیری ماشین" });
  convService.createConversation(ws.id, {
    title: "جلسه ارزیابی عملکرد مدل یادگیری",
    goal: "بررسی دقت",
  });
  actionService.createTask(ws.id, { title: "تنظیم پارامترهای مدل یادگیری تقویتی" });

  searchService.rebuildIndex(ws.id);

  const searchRes = searchService.search(ws.id, "یادگیری");
  assert.ok(
    searchRes.results.length >= 3,
    "Should find project, person, conversation, and task matching query"
  );
  assert.ok(searchRes.results.some((r) => r.type === "project"));
  assert.ok(searchRes.results.some((r) => r.type === "person"));
  assert.ok(searchRes.results.some((r) => r.type === "task"));
});

test("DashboardService aggregates workspace metrics correctly", () => {
  const db = createTestDatabase();
  const wsService = new WorkspaceService(db);
  const convService = new ConversationService(db);
  const actionService = new ActionService(db);
  const dashboardService = new DashboardService(db);

  const ws = wsService.createWorkspace({ name: "فضای متریک‌ها" });
  wsService.createProject(ws.id, { name: "پروژه اول" });
  wsService.createProject(ws.id, { name: "پروژه دوم" });
  wsService.createPerson(ws.id, { displayName: "مریم کمالی" });

  convService.createConversation(ws.id, { title: "مکالمه ۱" });
  convService.createConversation(ws.id, { title: "مکالمه ۲" });

  actionService.createTask(ws.id, { title: "تسک ۱", state: "TODO" });
  actionService.createTask(ws.id, { title: "تسک ۲", state: "DONE" });

  const metrics = dashboardService.getDashboardMetrics(ws.id);
  assert.equal(metrics.totalConversations, 2);
  assert.equal(metrics.activeProjects, 2);
  assert.equal(metrics.totalPeople, 1);
  assert.equal(metrics.openTasks, 1);
  assert.equal(metrics.completedTasks, 1);
});

test("Deterministic Persian deadline parsing handles key relative and absolute phrases", () => {
  const base = new Date("2026-08-23T10:00:00.000Z");

  const today = parseDeadline("باید امروز انجام شود", base);
  assert.ok(today.dueAtUtc);
  assert.equal(today.confidence, 0.95);

  const tomorrow = parseDeadline("تحویل تا فردا عصر", base);
  assert.ok(tomorrow.dueAtUtc);
  assert.equal(tomorrow.confidence, 0.95);

  const threeDays = parseDeadline("۳ روز دیگر تحویل داده شود", base);
  assert.ok(threeDays.dueAtUtc);
  assert.equal(threeDays.confidence, 0.9);

  const ambiguous = parseDeadline("در آینده نزدیک", base);
  assert.equal(ambiguous.dueAtUtc, null);
  assert.equal(ambiguous.confidence, 0.3);
});

test("Product router handles REST endpoints", async () => {
  const db = createTestDatabase();
  const workspaceService = new WorkspaceService(db);
  const conversationService = new ConversationService(db);
  const understandingEngine = new UnderstandingEngine(db);
  const actionService = new ActionService(db);
  const searchService = new SearchService(db);
  const dashboardService = new DashboardService(db);

  const router = createProductRouter({
    workspaceService,
    conversationService,
    understandingEngine,
    actionService,
    searchService,
    dashboardService,
    nativeCaptureBridge: null,
    readJsonBody: (request) => (request.json ? request.json() : {}),
    requireState: (request) => request.authenticated === true,
  });

  const jsonHelper = (data, status = 200) => ({ status, body: data });

  // 1. GET /v1/workspaces
  const getWsReq = { method: "GET" };
  const getWsRes = await router(getWsReq, new URL("http://localhost/v1/workspaces"), jsonHelper);
  assert.equal(getWsRes.status, 200);
  assert.ok(getWsRes.body.workspaces.length >= 1);

  // 2. POST /v1/workspaces
  const rejectedMutation = await router(
    { method: "POST", authenticated: false, json: async () => ({ name: "نباید ساخته شود" }) },
    new URL("http://localhost/v1/workspaces"),
    jsonHelper
  );
  assert.equal(rejectedMutation.status, 403);

  const postWsReq = {
    method: "POST",
    authenticated: true,
    json: async () => ({ name: "فضای تستی جدید" }),
  };
  const postWsRes = await router(postWsReq, new URL("http://localhost/v1/workspaces"), jsonHelper);
  assert.equal(postWsRes.status, 201);
  assert.equal(postWsRes.body.workspace.name, "فضای تستی جدید");

  const wsId = postWsRes.body.workspace.id;

  // 3. POST /v1/workspaces/:id/projects
  const postProjReq = {
    method: "POST",
    authenticated: true,
    json: async () => ({ name: "پروژه روتر", colorToken: "emerald" }),
  };
  const postProjRes = await router(
    postProjReq,
    new URL(`http://localhost/v1/workspaces/${wsId}/projects`),
    jsonHelper
  );
  assert.equal(postProjRes.status, 201);
  assert.equal(postProjRes.body.project.colorToken, "emerald");

  // 4. GET /v1/workspaces/:id/dashboard
  const dashReq = { method: "GET" };
  const dashRes = await router(
    dashReq,
    new URL(`http://localhost/v1/workspaces/${wsId}/dashboard`),
    jsonHelper
  );
  assert.equal(dashRes.status, 200);
  assert.equal(dashRes.body.dashboard.activeProjects, 1);
});

test("Product UI keeps form submission and the first conversation turn reachable", async () => {
  const [uiKit, productApp] = await Promise.all([
    readFile(new URL("../apps/web/public/ui-kit.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/web/public/app-react.js", import.meta.url), "utf8"),
  ]);

  assert.match(uiKit, /type:props\.type\|\|'button'/);
  assert.match(productApp, /ثبت و پاسخ/);
  assert.match(productApp, /سؤال یا درخواست خود را بنویس/);
  assert.doesNotMatch(
    productApp,
    /disabled:!this\.state\.turns\.length,onClick:this\.openConversationHub/
  );
});
