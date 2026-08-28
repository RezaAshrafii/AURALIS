export function createProductRouter({
  workspaceService,
  conversationService,
  understandingEngine,
  actionService,
  searchService,
  dashboardService,
  nativeCaptureBridge,
  onConversationReady,
  readJsonBody,
  requireState,
}) {
  return async function handleProductRoute(req, u, json) {
    const path = u.pathname;
    const method = req.method;
    const isMutation = !["GET", "HEAD"].includes(method);
    if (path.startsWith("/v1/") && isMutation && !requireState(req)) {
      return json(
        { error: { code: "AUTH_REQUIRED", message: "درخواست تغییر وضعیت معتبر نیست." } },
        403
      );
    }

    // --- Workspaces ---
    // GET/POST /v1/workspaces
    if (path === "/v1/workspaces") {
      if (method === "GET") {
        const workspaces = workspaceService.listWorkspaces();
        return json({ workspaces });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        try {
          const workspace = workspaceService.createWorkspace(body);
          return json({ workspace }, 201);
        } catch (e) {
          return json({ error: { code: "BAD_REQUEST", message: e.message } }, 400);
        }
      }
    }

    // Match /v1/workspaces/:id
    const wsMatch = path.match(/^\/v1\/workspaces\/([^/]+)$/);
    if (wsMatch) {
      const id = wsMatch[1];
      if (method === "GET") {
        const workspace = workspaceService.getWorkspace(id);
        if (!workspace)
          return json({ error: { code: "NOT_FOUND", message: "Workspace not found" } }, 404);
        return json({ workspace });
      }
      if (method === "PATCH") {
        const body = await readJsonBody(req);
        try {
          const workspace = workspaceService.updateWorkspace(id, body, body.revision);
          return json({ workspace });
        } catch (e) {
          const status = e.status || 400;
          return json({ error: { code: e.message, message: e.message } }, status);
        }
      }
    }

    // --- Projects ---
    // GET/POST /v1/workspaces/:id/projects
    const wsProjMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/projects$/);
    if (wsProjMatch) {
      const workspaceId = wsProjMatch[1];
      if (method === "GET") {
        const projects = workspaceService.listProjects(workspaceId);
        return json({ projects });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        try {
          const project = workspaceService.createProject(workspaceId, body);
          searchService.rebuildIndex(workspaceId);
          return json({ project }, 201);
        } catch (e) {
          return json({ error: { code: "BAD_REQUEST", message: e.message } }, 400);
        }
      }
    }

    // PATCH /v1/projects/:id
    const projMatch = path.match(/^\/v1\/projects\/([^/]+)$/);
    if (projMatch) {
      const id = projMatch[1];
      if (method === "GET") {
        const project = workspaceService.getProject(id);
        if (!project)
          return json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
        return json({ project });
      }
      if (method === "PATCH") {
        const body = await readJsonBody(req);
        try {
          const project = workspaceService.updateProject(id, body, body.revision);
          searchService.rebuildIndex(project.workspaceId);
          return json({ project });
        } catch (e) {
          const status = e.status || 400;
          return json({ error: { code: e.message, message: e.message } }, status);
        }
      }
      if (method === "DELETE") {
        try {
          const project = workspaceService.deleteProject(
            id,
            Number.isFinite(Number(u.searchParams.get("revision")))
              ? Number(u.searchParams.get("revision"))
              : null
          );
          searchService.rebuildIndex(project.workspaceId);
          return json({ deleted: true, deletionMode: "ARCHIVED", project });
        } catch (e) {
          return json({ error: { code: e.message, message: e.message } }, e.status || 400);
        }
      }
    }

    // --- People ---
    // GET/POST /v1/workspaces/:id/people
    const wsPeopleMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/people$/);
    if (wsPeopleMatch) {
      const workspaceId = wsPeopleMatch[1];
      if (method === "GET") {
        const people = workspaceService.listPeople(workspaceId);
        return json({ people });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        try {
          const person = workspaceService.createPerson(workspaceId, body);
          searchService.rebuildIndex(workspaceId);
          return json({ person }, 201);
        } catch (e) {
          return json({ error: { code: "BAD_REQUEST", message: e.message } }, 400);
        }
      }
    }

    // PATCH /v1/people/:id
    const personMatch = path.match(/^\/v1\/people\/([^/]+)$/);
    if (personMatch) {
      const id = personMatch[1];
      if (method === "GET") {
        const person = workspaceService.getPerson(id);
        if (!person)
          return json({ error: { code: "NOT_FOUND", message: "Person not found" } }, 404);
        return json({ person });
      }
      if (method === "PATCH") {
        const body = await readJsonBody(req);
        try {
          const person = workspaceService.updatePerson(id, body, body.revision);
          searchService.rebuildIndex(person.workspaceId);
          return json({ person });
        } catch (e) {
          const status = e.status || 400;
          return json({ error: { code: e.message, message: e.message } }, status);
        }
      }
      if (method === "DELETE") {
        try {
          const person = workspaceService.deletePerson(
            id,
            Number.isFinite(Number(u.searchParams.get("revision")))
              ? Number(u.searchParams.get("revision"))
              : null
          );
          searchService.rebuildIndex(person.workspaceId);
          return json({ deleted: true, deletionMode: "ARCHIVED", person });
        } catch (e) {
          return json({ error: { code: e.message, message: e.message } }, e.status || 400);
        }
      }
    }

    // --- Conversations ---
    // GET/POST /v1/workspaces/:id/conversations
    const wsConvMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/conversations$/);
    if (wsConvMatch) {
      const workspaceId = wsConvMatch[1];
      if (method === "GET") {
        const projectId = u.searchParams.get("projectId");
        const status = u.searchParams.get("status");
        const limit = parseInt(u.searchParams.get("limit") || "50", 10);
        const offset = parseInt(u.searchParams.get("offset") || "0", 10);
        const conversations = conversationService.listConversations(workspaceId, {
          projectId,
          status,
          limit,
          offset,
        });
        return json({ conversations });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        try {
          const conversation = conversationService.createConversation(workspaceId, body);
          searchService.rebuildIndex(workspaceId);
          return json({ conversation }, 201);
        } catch (e) {
          return json({ error: { code: "BAD_REQUEST", message: e.message } }, 400);
        }
      }
    }

    // Match /v1/conversations/:id
    const convMatch = path.match(/^\/v1\/conversations\/([^/]+)$/);
    if (convMatch) {
      const id = convMatch[1];
      if (method === "GET") {
        const conversation = conversationService.getConversation(id);
        if (!conversation)
          return json({ error: { code: "NOT_FOUND", message: "Conversation not found" } }, 404);
        return json({ conversation });
      }
      if (method === "PATCH") {
        const body = await readJsonBody(req);
        try {
          const conversation = conversationService.updateConversation(id, body, body.revision);
          searchService.rebuildIndex(conversation.workspaceId);
          return json({ conversation });
        } catch (e) {
          const status = e.status || 400;
          return json({ error: { code: e.message, message: e.message } }, status);
        }
      }
      if (method === "DELETE") {
        try {
          const conversation = conversationService.deleteFinishedConversation(
            id,
            Number.isFinite(Number(u.searchParams.get("revision")))
              ? Number(u.searchParams.get("revision"))
              : null
          );
          searchService.rebuildIndex(conversation.workspaceId);
          return json({ deleted: true, deletionMode: "ARCHIVED", conversation });
        } catch (e) {
          return json({ error: { code: e.message, message: e.message } }, e.status || 400);
        }
      }
    }

    // POST /v1/conversations/:id/start
    const convStartMatch = path.match(/^\/v1\/conversations\/([^/]+)\/start$/);
    if (convStartMatch && method === "POST") {
      const id = convStartMatch[1];
      const conv = conversationService.getConversation(id);
      if (!conv)
        return json({ error: { code: "NOT_FOUND", message: "Conversation not found" } }, 404);

      if (nativeCaptureBridge && typeof nativeCaptureBridge.startCapture === "function") {
        try {
          const captureSession = await nativeCaptureBridge.startCapture({
            mode: conv.kind === "MEETING" ? "meeting" : "study",
            conversationId: id,
          });
          conversationService.updateConversation(id, {
            state: "LIVE",
            captureSessionId: captureSession.id,
          });
          return json({ success: true, conversationId: id, captureSessionId: captureSession.id });
        } catch (err) {
          return json({ error: { code: "CAPTURE_START_FAILED", message: err.message } }, 500);
        }
      }
      conversationService.updateConversation(id, { state: "LIVE" });
      return json({ success: true, conversationId: id });
    }

    // POST /v1/conversations/:id/stop
    const convStopMatch = path.match(/^\/v1\/conversations\/([^/]+)\/stop$/);
    if (convStopMatch && method === "POST") {
      const id = convStopMatch[1];
      const conv = conversationService.getConversation(id);
      if (!conv)
        return json({ error: { code: "NOT_FOUND", message: "Conversation not found" } }, 404);

      if (
        nativeCaptureBridge &&
        typeof nativeCaptureBridge.stopCapture === "function" &&
        conv.captureSessionId
      ) {
        try {
          await nativeCaptureBridge.stopCapture(conv.captureSessionId);
        } catch (e) {
          console.error("Stop capture warning:", e);
        }
      }
      conversationService.updateConversation(id, {
        state: "READY",
        endedAt: new Date().toISOString(),
      });
      if (typeof onConversationReady === "function") onConversationReady(id);
      return json({ success: true, conversationId: id });
    }

    // GET /v1/conversations/:id/audio
    const convAudioMatch = path.match(/^\/v1\/conversations\/([^/]+)\/audio$/);
    if (convAudioMatch && method === "GET") {
      const id = convAudioMatch[1];
      try {
        const audio = conversationService.getAudioDetails(id);
        return json({ audio });
      } catch (e) {
        return json({ error: { code: "NOT_FOUND", message: e.message } }, 404);
      }
    }

    // GET /v1/conversations/:id/transcript
    const convTranscriptMatch = path.match(/^\/v1\/conversations\/([^/]+)\/transcript$/);
    if (convTranscriptMatch && method === "GET") {
      const id = convTranscriptMatch[1];
      const limit = parseInt(u.searchParams.get("limit") || "100", 10);
      const cursor = u.searchParams.get("cursor");
      try {
        const transcript = conversationService.getTranscriptTimeline(id, { limit, cursor });
        return json({ transcript });
      } catch (e) {
        return json({ error: { code: "NOT_FOUND", message: e.message } }, 404);
      }
    }

    // GET /v1/conversations/:id/understanding
    const convUnderMatch = path.match(/^\/v1\/conversations\/([^/]+)\/understanding$/);
    if (convUnderMatch && method === "GET") {
      const id = convUnderMatch[1];
      const type = u.searchParams.get("type");
      const status = u.searchParams.get("status");
      const insights = understandingEngine.listInsights(id, { type, status });
      return json({ insights });
    }

    // POST /v1/conversations/:id/understanding-runs
    const convRunMatch = path.match(/^\/v1\/conversations\/([^/]+)\/understanding-runs$/);
    if (convRunMatch && method === "POST") {
      const id = convRunMatch[1];
      const body = await readJsonBody(req);
      try {
        const result = await understandingEngine.runUnderstanding(id, body);
        const conv = conversationService.getConversation(id);
        if (conv) searchService.rebuildIndex(conv.workspaceId);
        return json({ result }, 200);
      } catch (e) {
        return json({ error: { code: "UNDERSTANDING_FAILED", message: e.message } }, 500);
      }
    }

    // POST /v1/insights/:id/confirm
    const insConfirmMatch = path.match(/^\/v1\/insights\/([^/]+)\/confirm$/);
    if (insConfirmMatch && method === "POST") {
      const id = insConfirmMatch[1];
      const body = await readJsonBody(req);
      try {
        // If it's a TASK, atomically create a Task
        const insight = understandingEngine.getInsight(id);
        if (!insight)
          return json({ error: { code: "NOT_FOUND", message: "Insight not found" } }, 404);

        if (insight.type === "TASK") {
          const task = actionService.confirmInsightToTask(id, body);
          searchService.rebuildIndex(insight.workspaceId);
          return json({ insight: understandingEngine.getInsight(id), task });
        }
        const updated = understandingEngine.confirmInsight(id);
        searchService.rebuildIndex(insight.workspaceId);
        return json({ insight: updated });
      } catch (e) {
        return json({ error: { code: "CONFIRM_FAILED", message: e.message } }, 400);
      }
    }

    // POST /v1/insights/:id/dismiss
    const insDismissMatch = path.match(/^\/v1\/insights\/([^/]+)\/dismiss$/);
    if (insDismissMatch && method === "POST") {
      const id = insDismissMatch[1];
      try {
        const updated = understandingEngine.dismissInsight(id);
        searchService.rebuildIndex(updated.workspaceId);
        return json({ insight: updated });
      } catch (e) {
        return json({ error: { code: "DISMISS_FAILED", message: e.message } }, 400);
      }
    }

    // --- Tasks ---
    // GET/POST /v1/workspaces/:id/tasks
    const wsTasksMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/tasks$/);
    if (wsTasksMatch) {
      const workspaceId = wsTasksMatch[1];
      if (method === "GET") {
        const projectId = u.searchParams.get("projectId");
        const state = u.searchParams.get("state");
        const priority = u.searchParams.get("priority");
        const assigneePersonId = u.searchParams.get("assigneePersonId");
        const tasks = actionService.listTasks(workspaceId, {
          projectId,
          state,
          priority,
          assigneePersonId,
        });
        return json({ tasks });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        try {
          const task = actionService.createTask(workspaceId, body);
          searchService.rebuildIndex(workspaceId);
          return json({ task }, 201);
        } catch (e) {
          return json({ error: { code: "BAD_REQUEST", message: e.message } }, 400);
        }
      }
    }

    // PATCH /v1/tasks/:id
    const taskMatch = path.match(/^\/v1\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const id = taskMatch[1];
      if (method === "GET") {
        const task = actionService.getTask(id);
        if (!task) return json({ error: { code: "NOT_FOUND", message: "Task not found" } }, 404);
        return json({ task });
      }
      if (method === "PATCH") {
        const body = await readJsonBody(req);
        try {
          const task = actionService.updateTask(id, body, body.revision);
          searchService.rebuildIndex(task.workspaceId);
          return json({ task });
        } catch (e) {
          const status = e.status || 400;
          return json({ error: { code: e.message, message: e.message } }, status);
        }
      }
    }

    const taskDeleteMatch = path.match(/^\/v1\/tasks\/([^/]+)$/);
    if (taskDeleteMatch && method === "DELETE") {
      const id = taskDeleteMatch[1];
      try {
        const task = actionService.deleteTask(
          id,
          Number.isFinite(Number(u.searchParams.get("revision")))
            ? Number(u.searchParams.get("revision"))
            : null
        );
        searchService.rebuildIndex(task.workspaceId);
        return json({ deleted: true, deletionMode: "TOMBSTONE", task });
      } catch (e) {
        return json({ error: { code: e.message, message: e.message } }, e.status || 400);
      }
    }

    // POST /v1/tasks/:id/transitions
    const taskTransMatch = path.match(/^\/v1\/tasks\/([^/]+)\/transitions$/);
    if (taskTransMatch && method === "POST") {
      const id = taskTransMatch[1];
      const body = await readJsonBody(req);
      try {
        const task = actionService.transitionTaskState(id, body.state, body.actor || "user");
        searchService.rebuildIndex(task.workspaceId);
        return json({ task });
      } catch (e) {
        return json({ error: { code: "TRANSITION_FAILED", message: e.message } }, 400);
      }
    }

    // --- Search ---
    // GET /v1/workspaces/:id/search?q=&cursor=
    const wsSearchMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/search$/);
    if (wsSearchMatch && method === "GET") {
      const workspaceId = wsSearchMatch[1];
      const q = u.searchParams.get("q") || "";
      const cursor = parseInt(u.searchParams.get("cursor") || "0", 10);
      const limit = parseInt(u.searchParams.get("limit") || "30", 10);
      const result = searchService.search(workspaceId, q, { limit, cursor });
      return json(result);
    }

    // --- Dashboard ---
    // GET /v1/workspaces/:id/dashboard
    const wsDashMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/dashboard$/);
    if (wsDashMatch && method === "GET") {
      const workspaceId = wsDashMatch[1];
      const metrics = dashboardService.getDashboardMetrics(workspaceId);
      return json({ dashboard: metrics });
    }

    return null; // Not handled by product router
  };
}
