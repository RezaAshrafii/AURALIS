export class DashboardService {
  constructor(db) {
    this.db = db;
  }

  getDashboardMetrics(workspaceId) {
    // 1. Total conversations
    const totalConvRow = this.db.query("SELECT COUNT(*) as count FROM conversations WHERE workspace_id = ? AND state != 'ARCHIVED'").get(workspaceId);
    const totalConversations = totalConvRow ? totalConvRow.count : 0;

    // 2. Active projects
    const activeProjectsRow = this.db.query("SELECT COUNT(*) as count FROM projects WHERE workspace_id = ? AND status = 'ACTIVE'").get(workspaceId);
    const activeProjects = activeProjectsRow ? activeProjectsRow.count : 0;

    // 3. People
    const peopleRow = this.db.query("SELECT COUNT(*) as count FROM people WHERE workspace_id = ? AND status = 'ACTIVE'").get(workspaceId);
    const totalPeople = peopleRow ? peopleRow.count : 0;

    // 4. Tasks counts
    const openTasksRow = this.db.query("SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ? AND state IN ('TODO', 'IN_PROGRESS', 'SUGGESTED')").get(workspaceId);
    const openTasks = openTasksRow ? openTasksRow.count : 0;

    const completedTasksRow = this.db.query("SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ? AND state = 'DONE'").get(workspaceId);
    const completedTasks = completedTasksRow ? completedTasksRow.count : 0;

    const nowIso = new Date().toISOString();
    const overdueTasksRow = this.db.query(`
      SELECT COUNT(*) as count FROM tasks
      WHERE workspace_id = ? AND state IN ('TODO', 'IN_PROGRESS') AND due_at_utc IS NOT NULL AND due_at_utc < ?
    `).get(workspaceId, nowIso);
    const overdueTasks = overdueTasksRow ? overdueTasksRow.count : 0;

    // 5. Recent Decisions count
    const recentDecisionsCountRow = this.db.query(`
      SELECT COUNT(*) as count FROM insight_items
      WHERE workspace_id = ? AND type = 'DECISION' AND status != 'DISMISSED'
    `).get(workspaceId);
    const recentDecisionsCount = recentDecisionsCountRow ? recentDecisionsCountRow.count : 0;

    // 6. Recent conversations list
    const recentConversations = this.db.query(`
      SELECT id, workspace_id, project_id, capture_session_id, title, goal, kind, state, started_at, created_at, revision
      FROM conversations
      WHERE workspace_id = ? AND state != 'ARCHIVED'
      ORDER BY started_at DESC
      LIMIT 6
    `).all(workspaceId);

    // 7. Upcoming tasks list
    const upcomingTasks = this.db.query(`
      SELECT t.id, t.workspace_id, t.project_id, t.title, t.state, t.priority, t.due_at_utc, t.due_original_text, t.created_at,
             p.name as project_name, p.color_token as project_color,
             per.display_name as assignee_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN people per ON t.assignee_person_id = per.id
      WHERE t.workspace_id = ? AND t.state IN ('TODO', 'IN_PROGRESS')
      ORDER BY CASE WHEN t.due_at_utc IS NULL THEN 1 ELSE 0 END, t.due_at_utc ASC, t.created_at DESC
      LIMIT 6
    `).all(workspaceId);

    // 8. Recent Decisions list
    const recentDecisions = this.db.query(`
      SELECT id, workspace_id, conversation_id, title, body, status, confidence, created_at
      FROM insight_items
      WHERE workspace_id = ? AND type = 'DECISION' AND status != 'DISMISSED'
      ORDER BY created_at DESC
      LIMIT 6
    `).all(workspaceId);

    return {
      totalConversations,
      activeProjects,
      totalPeople,
      openTasks,
      completedTasks,
      overdueTasks,
      recentDecisionsCount,
      recentConversations,
      upcomingTasks,
      recentDecisions
    };
  }
}
