import { escapeHtml, normalizeText } from "./domain-models.mjs";

export class SearchService {
  constructor(db) {
    this.db = db;
  }

  rebuildIndex(workspaceId = null) {
    this.db.exec("DELETE FROM search_projection;");

    // 1. Projects
    const projects = this.db.query("SELECT * FROM projects WHERE status != ?").all("ARCHIVED");
    for (const p of projects) {
      this.db
        .query(`
        INSERT INTO search_projection (item_id, item_type, workspace_id, project_id, conversation_id, title, subtitle, body)
        VALUES (?, 'project', ?, ?, NULL, ?, ?, ?)
      `)
        .run(p.id, p.workspace_id, p.id, p.name, p.status, p.description || "");
    }

    // 2. People
    const people = this.db.query("SELECT * FROM people WHERE status != ?").all("ARCHIVED");
    for (const per of people) {
      this.db
        .query(`
        INSERT INTO search_projection (item_id, item_type, workspace_id, project_id, conversation_id, title, subtitle, body)
        VALUES (?, 'person', ?, NULL, NULL, ?, ?, ?)
      `)
        .run(
          per.id,
          per.workspace_id,
          per.display_name,
          per.role_title || per.organization_name || "",
          `${per.email || ""} ${per.phone || ""} ${per.notes || ""}`
        );
    }

    // 3. Conversations
    const convs = this.db.query("SELECT * FROM conversations WHERE state != ?").all("ARCHIVED");
    for (const c of convs) {
      this.db
        .query(`
        INSERT INTO search_projection (item_id, item_type, workspace_id, project_id, conversation_id, title, subtitle, body)
        VALUES (?, 'conversation', ?, ?, ?, ?, ?, ?)
      `)
        .run(c.id, c.workspace_id, c.project_id || null, c.id, c.title, c.kind, c.goal || "");
    }

    // 4. Tasks
    const tasks = this.db.query("SELECT * FROM tasks WHERE state != 'CANCELLED'").all();
    for (const t of tasks) {
      this.db
        .query(`
        INSERT INTO search_projection (item_id, item_type, workspace_id, project_id, conversation_id, title, subtitle, body)
        VALUES (?, 'task', ?, ?, ?, ?, ?, ?)
      `)
        .run(
          t.id,
          t.workspace_id,
          t.project_id || null,
          t.conversation_id || null,
          t.title,
          `${t.state} · ${t.priority}`,
          t.description || ""
        );
    }

    // 5. Insights
    const insights = this.db
      .query("SELECT * FROM insight_items WHERE status != ?")
      .all("DISMISSED");
    for (const ins of insights) {
      this.db
        .query(`
        INSERT INTO search_projection (item_id, item_type, workspace_id, project_id, conversation_id, title, subtitle, body)
        VALUES (?, 'insight', ?, NULL, ?, ?, ?, ?)
      `)
        .run(
          ins.id,
          ins.workspace_id,
          ins.conversation_id,
          ins.title,
          `${ins.type} · ${ins.status}`,
          ins.body || ""
        );
    }

    // 6. Documents
    const docs = this.db.query("SELECT * FROM source_documents").all();
    for (const d of docs) {
      const chunks = this.db
        .query("SELECT text_raw FROM source_chunks WHERE document_id = ?")
        .all(d.id);
      const text = chunks.map((c) => c.text_raw).join(" ");
      this.db
        .query(`
        INSERT INTO search_projection (item_id, item_type, workspace_id, project_id, conversation_id, title, subtitle, body)
        VALUES (?, 'document', 'default-workspace', NULL, NULL, ?, ?, ?)
      `)
        .run(d.id, d.title, d.mime_type, text);
    }

    return { success: true };
  }

  search(workspaceId, query, { limit = 30, cursor = 0 } = {}) {
    const q = normalizeText(query);
    if (!q) return { results: [], total: 0 };

    // FTS query with match
    const ftsQuery = q
      .split(/\s+/)
      .map((term) => `"${term.replace(/"/g, '""')}*"`)
      .join(" AND ");

    const sql = `
      SELECT item_id, item_type, workspace_id, project_id, conversation_id, title, subtitle, body, bm25(search_projection) as rank
      FROM search_projection
      WHERE search_projection MATCH ? AND workspace_id = ?
      ORDER BY rank ASC
      LIMIT ? OFFSET ?
    `;

    try {
      const rows = this.db.query(sql).all(ftsQuery, workspaceId, limit, cursor);
      const results = rows.map((r) => ({
        id: r.item_id,
        type: r.item_type,
        workspaceId: r.workspace_id,
        projectId: r.project_id,
        conversationId: r.conversation_id,
        title: r.title,
        subtitle: r.subtitle,
        snippet: this._makeSnippet(r.body, q),
        score: -r.rank,
      }));

      return {
        results,
        count: results.length,
        nextCursor: results.length === limit ? cursor + limit : null,
      };
    } catch (e) {
      // Fallback simple query if MATCH expression fails on special chars
      const fallbackSql = `
        SELECT item_id, item_type, workspace_id, project_id, conversation_id, title, subtitle, body
        FROM search_projection
        WHERE workspace_id = ? AND (title LIKE ? OR body LIKE ?)
        LIMIT ? OFFSET ?
      `;
      const like = `%${q}%`;
      const rows = this.db.query(fallbackSql).all(workspaceId, like, like, limit, cursor);
      return {
        results: rows.map((r) => ({
          id: r.item_id,
          type: r.item_type,
          workspaceId: r.workspace_id,
          projectId: r.project_id,
          conversationId: r.conversation_id,
          title: r.title,
          subtitle: r.subtitle,
          snippet: this._makeSnippet(r.body, q),
          score: 1,
        })),
        count: rows.length,
        nextCursor: rows.length === limit ? cursor + limit : null,
      };
    }
  }

  _makeSnippet(text = "", query = "") {
    if (!text) return "";
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) {
      return text.slice(0, 120) + (text.length > 120 ? "..." : "");
    }
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 80);
    const snippet =
      (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
    return escapeHtml(snippet);
  }
}
