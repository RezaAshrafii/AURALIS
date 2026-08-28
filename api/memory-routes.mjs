function errorStatus(error) {
  if (error?.status) return error.status;
  if (/NOT_FOUND/.test(error?.message || "")) return 404;
  if (/CONFLICT/.test(error?.message || "")) return 409;
  if (/DISABLED|CONSENT_REQUIRED|NOT_READY|NOT_CONFIRMABLE/.test(error?.message || "")) return 409;
  return 400;
}

function workspaceHeader(req) {
  return String(req.headers?.get?.("x-auralis-workspace-id") || "").trim();
}

export function createMemoryRouter({ memoryEngine, readJsonBody, requireState, scheduleBackfill }) {
  const mutationAllowed = (req) => requireState(req);
  const itemWorkspace = (req) => {
    const workspaceId = workspaceHeader(req);
    if (!workspaceId) throw new Error("WORKSPACE_CONTEXT_REQUIRED");
    return workspaceId;
  };

  return async function handleMemoryRoute(req, url, json) {
    const path = url.pathname;
    const method = req.method;

    const settingsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/memory-settings$/);
    if (settingsMatch) {
      const workspaceId = settingsMatch[1];
      if (method === "GET") {
        try {
          return json({ settings: memoryEngine.getSettings(workspaceId) });
        } catch (error) {
          return json(
            { error: { code: error.message, message: error.message } },
            errorStatus(error)
          );
        }
      }
      if (method === "PATCH") {
        if (!mutationAllowed(req))
          return json(
            { error: { code: "AUTH_REQUIRED", message: "Authentication required" } },
            403
          );
        const body = await readJsonBody(req);
        try {
          return json({ settings: memoryEngine.configureMemory(workspaceId, body, body.revision) });
        } catch (error) {
          return json(
            { error: { code: error.message, message: error.message } },
            errorStatus(error)
          );
        }
      }
    }

    const listMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/memories$/);
    if (listMatch && method === "GET") {
      const workspaceId = listMatch[1];
      try {
        return json(
          memoryEngine.listMemories(workspaceId, {
            scope: url.searchParams.get("scope"),
            type: url.searchParams.get("type"),
            status: url.searchParams.get("status"),
            query: url.searchParams.get("q"),
            cursor: url.searchParams.get("cursor"),
            limit: url.searchParams.get("limit"),
          })
        );
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const reviewMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/memory-review$/);
    if (reviewMatch && method === "GET") {
      try {
        return json(
          memoryEngine.listReviewInbox(reviewMatch[1], {
            cursor: url.searchParams.get("cursor"),
            limit: url.searchParams.get("limit"),
          })
        );
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const extractionMatch = path.match(/^\/v1\/conversations\/([^/]+)\/memory-extractions$/);
    if (extractionMatch && method === "POST") {
      if (!mutationAllowed(req))
        return json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } }, 403);
      const body = await readJsonBody(req);
      try {
        return json(
          memoryEngine.extractMemoryCandidates(itemWorkspace(req), extractionMatch[1], {
            ...body,
            manual: true,
          }),
          201
        );
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const backfillsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/memory-backfills$/);
    if (backfillsMatch) {
      const workspaceId = backfillsMatch[1];
      if (method === "GET") {
        try {
          return json({ jobs: memoryEngine.listBackfillJobs(workspaceId) });
        } catch (error) {
          return json(
            { error: { code: error.message, message: error.message } },
            errorStatus(error)
          );
        }
      }
      if (method === "POST") {
        if (!mutationAllowed(req))
          return json(
            { error: { code: "AUTH_REQUIRED", message: "Authentication required" } },
            403
          );
        const body = await readJsonBody(req);
        try {
          const job = memoryEngine.startBackfill(workspaceId, body);
          if (typeof scheduleBackfill === "function") scheduleBackfill(workspaceId, job.id);
          return json({ job }, 202);
        } catch (error) {
          return json(
            { error: { code: error.message, message: error.message } },
            errorStatus(error)
          );
        }
      }
    }

    const backfillControlMatch = path.match(
      /^\/v1\/memory-backfills\/([^/]+)\/(pause|resume|cancel)$/
    );
    if (backfillControlMatch && method === "POST") {
      if (!mutationAllowed(req))
        return json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } }, 403);
      try {
        const workspaceId = itemWorkspace(req),
          command = backfillControlMatch[2],
          job = memoryEngine.controlBackfill(workspaceId, backfillControlMatch[1], command);
        if (command === "resume" && typeof scheduleBackfill === "function")
          scheduleBackfill(workspaceId, job.id);
        return json({ job });
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const usageMatch = path.match(/^\/v1\/memories\/([^/]+)\/usage$/);
    if (usageMatch && method === "GET") {
      try {
        return json({ usage: memoryEngine.listUsage(itemWorkspace(req), usageMatch[1]) });
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const commandMatch = path.match(/^\/v1\/memories\/([^/]+)\/(confirm|reject|archive)$/);
    if (commandMatch && method === "POST") {
      if (!mutationAllowed(req))
        return json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } }, 403);
      const body = await readJsonBody(req);
      try {
        const workspaceId = itemWorkspace(req),
          id = commandMatch[1],
          command = commandMatch[2];
        const memory =
          command === "confirm"
            ? memoryEngine.confirmMemory(workspaceId, id, body)
            : command === "reject"
              ? memoryEngine.rejectMemory(workspaceId, id, body)
              : memoryEngine.archiveMemory(workspaceId, id, body);
        return json({ memory });
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const itemMatch = path.match(/^\/v1\/memories\/([^/]+)$/);
    if (itemMatch) {
      let workspaceId;
      try {
        workspaceId = itemWorkspace(req);
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, 400);
      }
      const id = itemMatch[1];
      if (method === "GET") {
        const memory = memoryEngine.getMemory(workspaceId, id);
        return memory
          ? json({ memory })
          : json({ error: { code: "NOT_FOUND", message: "Memory not found" } }, 404);
      }
      if (method === "PATCH") {
        if (!mutationAllowed(req))
          return json(
            { error: { code: "AUTH_REQUIRED", message: "Authentication required" } },
            403
          );
        const body = await readJsonBody(req);
        try {
          return json({
            memory: memoryEngine.editMemory(workspaceId, id, body, {
              expectedRevision: body.revision,
              idempotencyKey: body.idempotencyKey,
            }),
          });
        } catch (error) {
          return json(
            { error: { code: error.message, message: error.message } },
            errorStatus(error)
          );
        }
      }
      if (method === "DELETE") {
        if (!mutationAllowed(req))
          return json(
            { error: { code: "AUTH_REQUIRED", message: "Authentication required" } },
            403
          );
        try {
          return json(
            memoryEngine.deleteMemory(workspaceId, id, {
              idempotencyKey: req.headers?.get?.("idempotency-key") || undefined,
            })
          );
        } catch (error) {
          return json(
            { error: { code: error.message, message: error.message } },
            errorStatus(error)
          );
        }
      }
    }

    const contradictionsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/memory-contradictions$/);
    if (contradictionsMatch && method === "GET") {
      try {
        return json({
          contradictions: memoryEngine.listContradictions(
            contradictionsMatch[1],
            url.searchParams.get("state")
          ),
        });
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const resolveMatch = path.match(/^\/v1\/memory-contradictions\/([^/]+)\/resolve$/);
    if (resolveMatch && method === "POST") {
      if (!mutationAllowed(req))
        return json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } }, 403);
      const body = await readJsonBody(req);
      try {
        return json({
          contradiction: memoryEngine.resolveContradiction(
            itemWorkspace(req),
            resolveMatch[1],
            body.resolution,
            body
          ),
        });
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const exportsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/memory-exports$/);
    if (exportsMatch && method === "POST") {
      if (!mutationAllowed(req))
        return json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } }, 403);
      const body = await readJsonBody(req);
      try {
        return json(
          { export: memoryEngine.exportMemories(exportsMatch[1], body.format || "BOTH") },
          202
        );
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    const exportGetMatch = path.match(/^\/v1\/memory-exports\/([^/]+)$/);
    if (exportGetMatch && method === "GET") {
      try {
        const result = memoryEngine.getExport(itemWorkspace(req), exportGetMatch[1]);
        return result
          ? json({ export: result })
          : json({ error: { code: "NOT_FOUND", message: "Export not found" } }, 404);
      } catch (error) {
        return json({ error: { code: error.message, message: error.message } }, errorStatus(error));
      }
    }

    return null;
  };
}
