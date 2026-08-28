import { ALLOWED_COLOR_TOKENS, generateId, nowIso } from "./domain-models.mjs";
import {
  assertEntityExists,
  assertPositiveInteger,
  assertRevision,
  assertSameWorkspace,
  assertValidEnum,
  assertWorkspaceExists,
  ENTITY_STATES,
  parsePagination,
  ValidationError,
} from "./validation.mjs";

export class WorkspaceService {
  constructor(db) {
    this.db = db;
  }

  // Local Profile
  getDefaultProfile() {
    return this.db.query("SELECT * FROM local_profiles WHERE id = ?").get("default-profile");
  }

  updateProfile(id, updates) {
    const now = nowIso();
    const current = this.db.query("SELECT * FROM local_profiles WHERE id = ?").get(id);
    if (!current) throw new ValidationError("PROFILE_NOT_FOUND", "Profile not found", 404);

    const displayName = updates.displayName ?? current.display_name;
    const locale = updates.locale ?? current.locale;
    const timezone = updates.timezone ?? current.timezone;

    this.db
      .query(`
      UPDATE local_profiles
      SET display_name = ?, locale = ?, timezone = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(displayName, locale, timezone, now, id);

    return this.db.query("SELECT * FROM local_profiles WHERE id = ?").get(id);
  }

  // Workspaces
  listWorkspaces() {
    return this.db
      .query("SELECT * FROM workspaces ORDER BY created_at ASC")
      .all()
      .map(this._mapWorkspace);
  }

  getWorkspace(id) {
    const row = this.db.query("SELECT * FROM workspaces WHERE id = ?").get(id);
    return row ? this._mapWorkspace(row) : null;
  }

  createWorkspace(data) {
    const id = data.id || generateId("ws");
    const now = nowIso();
    const name = (data.name || "").trim();
    if (!name) throw new Error("WORKSPACE_NAME_REQUIRED");

    const profileId = data.localProfileId || "default-profile";
    const description = data.description || null;

    this.db
      .query(`
      INSERT INTO workspaces (id, local_profile_id, name, description, status, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, ?)
    `)
      .run(id, profileId, name, description, now, now);

    const hasMemorySettings = this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_settings'")
      .get();
    if (hasMemorySettings) {
      this.db
        .query(`INSERT OR IGNORE INTO memory_settings
        (workspace_id,enabled,candidate_extraction_enabled,auto_confirm_user_preferences,retention_days,
         sensitive_memory_enabled,context_budget_items,context_budget_chars,revision,created_at,updated_at)
        VALUES (?,0,0,0,NULL,0,6,1800,1,?,?)`)
        .run(id, now, now);
    }

    return this.getWorkspace(id);
  }

  updateWorkspace(id, data, expectedRevision = null) {
    const current = this.getWorkspace(id);
    if (!current) throw new Error("WORKSPACE_NOT_FOUND");

    if (expectedRevision !== null && current.revision !== expectedRevision) {
      const err = new Error("CONCURRENCY_CONFLICT");
      err.status = 409;
      throw err;
    }

    const name = data.name !== undefined ? (data.name || "").trim() : current.name;
    if (!name) throw new Error("WORKSPACE_NAME_REQUIRED");
    const description = data.description !== undefined ? data.description : current.description;
    const status = data.status !== undefined ? data.status : current.status;
    const now = nowIso();
    const newRev = current.revision + 1;

    this.db
      .query(`
      UPDATE workspaces
      SET name = ?, description = ?, status = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(name, description, status, newRev, now, id);

    return this.getWorkspace(id);
  }

  // Projects
  listProjects(workspaceId, includeArchived = false) {
    let sql = "SELECT * FROM projects WHERE workspace_id = ?";
    if (!includeArchived) {
      sql += " AND status != 'ARCHIVED'";
    }
    sql += " ORDER BY created_at DESC";
    return this.db.query(sql).all(workspaceId).map(this._mapProject);
  }

  getProject(id) {
    const row = this.db.query("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row) return null;
    const project = this._mapProject(row);
    const people = this.db
      .query(`
      SELECT p.*, pp.relationship_label, pp.created_at as linked_at
      FROM project_people pp
      JOIN people p ON pp.person_id = p.id
      WHERE pp.project_id = ?
    `)
      .all(id)
      .map(this._mapPerson);
    project.people = people;
    return project;
  }

  createProject(workspaceId, data) {
    const name = (data.name || "").trim();
    if (!name) throw new ValidationError("PROJECT_NAME_REQUIRED", "Project name is required", 400);
    const id = data.id || generateId("proj");
    const now = nowIso();
    const colorToken = ALLOWED_COLOR_TOKENS.includes(data.colorToken) ? data.colorToken : "blue";
    if (data.status !== undefined) {
      assertValidEnum(data.status, ENTITY_STATES.project, "status");
    }
    const status = data.status || "ACTIVE";

    // Validate personIds exist and belong to the same workspace
    if (Array.isArray(data.personIds) && data.personIds.length > 0) {
      for (const personId of data.personIds) {
        assertSameWorkspace(this.db, workspaceId, "people", "id", personId);
      }
    }

    assertWorkspaceExists(this.db, workspaceId);

    this.db.transaction(() => {
      this.db
        .query(`
        INSERT INTO projects (id, workspace_id, name, description, status, color_token, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
        .run(id, workspaceId, name, data.description || null, status, colorToken, now, now);

      if (Array.isArray(data.personIds)) {
        for (const personId of data.personIds) {
          this.linkPersonToProject(id, personId);
        }
      }
    })();

    return this.getProject(id);
  }

  updateProject(id, data, expectedRevision = null) {
    const current = this.getProject(id);
    if (!current) throw new ValidationError("PROJECT_NOT_FOUND", "Project not found", 404);

    assertRevision(current.revision, expectedRevision, "Project");

    const name = data.name !== undefined ? (data.name || "").trim() : current.name;
    if (!name) throw new ValidationError("PROJECT_NAME_REQUIRED", "Project name is required", 400);
    const description = data.description !== undefined ? data.description : current.description;
    let status = current.status;
    if (data.status !== undefined) {
      assertValidEnum(data.status, ENTITY_STATES.project, "status");
      status = data.status;
    }
    const colorToken =
      data.colorToken !== undefined && ALLOWED_COLOR_TOKENS.includes(data.colorToken)
        ? data.colorToken
        : current.colorToken;
    const now = nowIso();
    const newRev = current.revision + 1;

    this.db
      .query(`
      UPDATE projects
      SET name = ?, description = ?, status = ?, color_token = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(name, description, status, colorToken, newRev, now, id);

    return this.getProject(id);
  }

  deleteProject(id, expectedRevision = null) {
    const current = this.getProject(id);
    if (!current) throw new ValidationError("PROJECT_NOT_FOUND", "Project not found", 404);
    assertRevision(current.revision, expectedRevision, "Project");
    if (current.status === "ARCHIVED") return current;
    return this.updateProject(id, { status: "ARCHIVED" }, current.revision);
  }

  // People
  listPeople(workspaceId, includeArchived = false) {
    let sql = "SELECT * FROM people WHERE workspace_id = ?";
    if (!includeArchived) {
      sql += " AND status != 'ARCHIVED'";
    }
    sql += " ORDER BY display_name ASC";
    return this.db.query(sql).all(workspaceId).map(this._mapPerson);
  }

  getPerson(id) {
    const row = this.db.query("SELECT * FROM people WHERE id = ?").get(id);
    return row ? this._mapPerson(row) : null;
  }

  createPerson(workspaceId, data) {
    const displayName = (data.displayName || "").trim();
    if (!displayName)
      throw new ValidationError("PERSON_NAME_REQUIRED", "Person name is required", 400);
    const id = data.id || generateId("per");
    const now = nowIso();

    assertWorkspaceExists(this.db, workspaceId);

    this.db
      .query(`
      INSERT INTO people (id, workspace_id, display_name, organization_name, role_title, email, phone, notes, status, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)
    `)
      .run(
        id,
        workspaceId,
        displayName,
        data.organizationName || null,
        data.roleTitle || null,
        data.email || null,
        data.phone || null,
        data.notes || null,
        now,
        now
      );

    return this.getPerson(id);
  }

  updatePerson(id, data, expectedRevision = null) {
    const current = this.getPerson(id);
    if (!current) throw new ValidationError("PERSON_NOT_FOUND", "Person not found", 404);

    assertRevision(current.revision, expectedRevision, "Person");

    const displayName =
      data.displayName !== undefined ? (data.displayName || "").trim() : current.displayName;
    if (!displayName)
      throw new ValidationError("PERSON_NAME_REQUIRED", "Person name is required", 400);

    if (data.status !== undefined) {
      assertValidEnum(data.status, ENTITY_STATES.person, "status");
    }

    const now = nowIso();
    const newRev = current.revision + 1;

    this.db
      .query(`
      UPDATE people
      SET display_name = ?, organization_name = ?, role_title = ?, email = ?, phone = ?, notes = ?, status = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(
        displayName,
        data.organizationName !== undefined ? data.organizationName : current.organizationName,
        data.roleTitle !== undefined ? data.roleTitle : current.roleTitle,
        data.email !== undefined ? data.email : current.email,
        data.phone !== undefined ? data.phone : current.phone,
        data.notes !== undefined ? data.notes : current.notes,
        data.status !== undefined ? data.status : current.status,
        newRev,
        now,
        id
      );

    return this.getPerson(id);
  }

  deletePerson(id, expectedRevision = null) {
    const current = this.getPerson(id);
    if (!current) throw new ValidationError("PERSON_NOT_FOUND", "Person not found", 404);
    assertRevision(current.revision, expectedRevision, "Person");
    if (current.status === "ARCHIVED") return current;
    return this.updatePerson(id, { status: "ARCHIVED" }, current.revision);
  }

  linkPersonToProject(projectId, personId, relationshipLabel = "member") {
    const now = nowIso();
    this.db
      .query(`
      INSERT OR REPLACE INTO project_people (project_id, person_id, relationship_label, created_at)
      VALUES (?, ?, ?, ?)
    `)
      .run(projectId, personId, relationshipLabel, now);
  }

  unlinkPersonFromProject(projectId, personId) {
    this.db
      .query("DELETE FROM project_people WHERE project_id = ? AND person_id = ?")
      .run(projectId, personId);
  }

  // Helper mappers
  _mapWorkspace(row) {
    return {
      id: row.id,
      localProfileId: row.local_profile_id,
      name: row.name,
      description: row.description,
      status: row.status,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _mapProject(row) {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      status: row.status,
      colorToken: row.color_token,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _mapPerson(row) {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      displayName: row.display_name,
      organizationName: row.organization_name,
      roleTitle: row.role_title,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
      status: row.status,
      revision: row.revision,
      relationshipLabel: row.relationship_label || null,
      linkedAt: row.linked_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
