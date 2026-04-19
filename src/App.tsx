import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { GoogleGenAI } from "@google/genai";
import {
  ExternalLink,
  Loader2,
  Menu,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Persisted project */
interface Project {
  id: string;
  name: string;
  description: string;
  ticketLink?: string;
}

/** Persisted task (projectId supports future filtering) */
interface Task {
  id: string;
  content: string;
  projectId: string;
}

const STORAGE_PROJECTS = "devcontext-projects";
const STORAGE_TASKS = "devcontext-tasks";
const STORAGE_GEMINI_KEY = "devcontext-gemini-api-key";
/** Legacy single global AI blob — migrated into {@link STORAGE_AI_BY_PROJECT} once. */
const STORAGE_AI_OUTPUT_LEGACY = "devcontext-ai-output";
const STORAGE_AI_BY_PROJECT = "devcontext-ai-by-project";
const STORAGE_ACTIVE_PROJECT = "devcontext-active-project";

const GEMINI_MODEL = "gemini-3-flash-preview";

function newId(): string {
  return crypto.randomUUID();
}

function loadProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
}

function loadTasks(): Task[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_TASKS);
    return raw ? (JSON.parse(raw) as Task[]) : [];
  } catch {
    return [];
  }
}

function loadGeminiApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_GEMINI_KEY) ?? "";
}

function loadActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_ACTIVE_PROJECT);
    return raw && raw !== "" ? raw : null;
  } catch {
    return null;
  }
}

/** Per-project AI markdown; migrates legacy single-key storage on first read. */
function loadAiByProject(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_AI_BY_PROJECT);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === "object" ? parsed : {};
    }
    const legacy = localStorage.getItem(STORAGE_AI_OUTPUT_LEGACY);
    if (legacy?.trim()) {
      const plist = loadProjects();
      if (plist[0]) {
        return { [plist[0].id]: legacy };
      }
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * AI prompt for the currently selected project and its tasks/notes.
 */
function buildAiPromptForProject(
  active: Project,
  allProjects: Project[],
  tasksForProject: Task[],
): string {
  const linkPart = active.ticketLink ? ` (${active.ticketLink})` : "";
  const activeBlock = `${active.name} — ${active.description || "(no description)"}${linkPart}`;

  const others = allProjects.filter((p) => p.id !== active.id);
  const othersBlock =
    others.length > 0
      ? others.map((p) => `- ${p.name}`).join("\n")
      : "(none)";

  const taskBlock =
    tasksForProject.length > 0
      ? tasksForProject.map((t, i) => `${i + 1}. ${t.content}`).join("\n")
      : "(No tasks or notes yet for this project.)";

  return `You are helping prioritize work for ONE active project.

Active project:
${activeBlock}

Other projects (names only, for cross-repo context):
${othersBlock}

Tasks and notes for "${active.name}":
${taskBlock}

As a senior web developer, create a prioritized daily task list for me that minimizes context switching.
Focus on the active project. Group related items when helpful.
For each item suggest rough time estimate and any important context or link.
Output only clean markdown with High / Medium / Low priority labels.`;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [tasks, setTasks] = useState<Task[]>(loadTasks);

  /** User selection; may be stale if a project was removed — see `activeProjectId`. */
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    loadActiveProjectId,
  );
  const [geminiApiKey, setGeminiApiKey] = useState(loadGeminiApiKey);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiByProject, setAiByProject] =
    useState<Record<string, string>>(loadAiByProject);

  const [newTaskContent, setNewTaskContent] = useState("");

  const activeProjectId = useMemo(() => {
    if (projects.length === 0) return null;
    if (
      selectedProjectId &&
      projects.some((p) => p.id === selectedProjectId)
    ) {
      return selectedProjectId;
    }
    return projects[0].id;
  }, [projects, selectedProjectId]);

  const activeProject =
    activeProjectId == null
      ? undefined
      : projects.find((p) => p.id === activeProjectId);

  const tasksForActive = activeProjectId
    ? tasks.filter((t) => t.projectId === activeProjectId)
    : [];

  const currentAiOutput =
    activeProjectId && aiByProject[activeProjectId]
      ? aiByProject[activeProjectId]
      : null;

  const [isNarrow, setIsNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 768px)").matches,
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectTicketLink, setProjectTicketLink] = useState("");

  // Track viewport for responsive sidebar
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => {
      setIsNarrow(mq.matches);
      if (!mq.matches) setMobileMenuOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Auto-save projects
  useEffect(() => {
    localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
  }, [projects]);

  // Auto-save tasks
  useEffect(() => {
    localStorage.setItem(STORAGE_TASKS, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_GEMINI_KEY, geminiApiKey);
  }, [geminiApiKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_AI_BY_PROJECT, JSON.stringify(aiByProject));
    if (Object.keys(aiByProject).length > 0) {
      localStorage.removeItem(STORAGE_AI_OUTPUT_LEGACY);
    }
  }, [aiByProject]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem(STORAGE_ACTIVE_PROJECT, activeProjectId);
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_PROJECT);
    }
  }, [activeProjectId]);

  const clearAiError = useCallback(() => setAiError(null), []);

  const closeMobileSidebar = useCallback(() => setMobileMenuOpen(false), []);

  const resolvedGeminiKey =
    import.meta.env.VITE_GEMINI_API_KEY?.trim() || geminiApiKey.trim();

  const handleAddProject = (e: React.FormEvent) => {
    e.preventDefault();
    const name = projectName.trim();
    if (!name) return;

    const project: Project = {
      id: newId(),
      name,
      description: projectDescription.trim(),
      ticketLink: projectTicketLink.trim() || undefined,
    };

    setProjects((prev) => [...prev, project]);
    setProjectName("");
    setProjectDescription("");
    setProjectTicketLink("");
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setTasks((prev) => prev.filter((t) => t.projectId !== id));
    setAiByProject((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleDragEnd = (result: DropResult) => {
    if (!activeProjectId) return;
    if (!result.destination) return;
    if (result.destination.droppableId !== "tasks") return;
    const { source, destination } = result;
    if (source.droppableId !== destination.droppableId) return;
    if (source.index === destination.index) return;

    const pid = activeProjectId;

    setTasks((prev) => {
      const mine = prev.filter((t) => t.projectId === pid);
      if (mine.length === 0) return prev;
      const reord = [...mine];
      const [removed] = reord.splice(source.index, 1);
      reord.splice(destination.index, 0, removed);
      const firstIdx = prev.findIndex((t) => t.projectId === pid);
      if (firstIdx === -1) return prev;
      return [
        ...prev.slice(0, firstIdx),
        ...reord,
        ...prev.slice(firstIdx + mine.length),
      ];
    });
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    const content = newTaskContent.trim();
    if (!content || !activeProjectId) return;

    setTasks((prev) => {
      const idxs = prev
        .map((t, i) => (t.projectId === activeProjectId ? i : -1))
        .filter((i) => i >= 0);
      const insertAfter = idxs.length > 0 ? idxs[idxs.length - 1]! : -1;
      const insert = insertAfter + 1;
      const next = [...prev];
      next.splice(insert, 0, {
        id: newId(),
        content,
        projectId: activeProjectId,
      });
      return next;
    });
    setNewTaskContent("");
  };

  const handleGenerateWithGemini = async () => {
    if (!resolvedGeminiKey) {
      setAiError(
        "Add your Gemini API key below, or set VITE_GEMINI_API_KEY in a .env file.",
      );
      return;
    }
    if (!activeProject || !activeProjectId) {
      setAiError("Select an active project first.");
      return;
    }

    const prompt = buildAiPromptForProject(
      activeProject,
      projects,
      tasksForActive,
    );
    setAiLoading(true);
    setAiError(null);

    const projectKey = activeProjectId;

    try {
      const ai = new GoogleGenAI({ apiKey: resolvedGeminiKey });
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
      });
      const text = response.text;
      const out = text?.trim()
        ? text
        : "The model returned no text. Try again.";
      setAiByProject((prev) => ({ ...prev, [projectKey]: out }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gemini request failed.";
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  };

  const sidebarVisible = !isNarrow || mobileMenuOpen;

  return (
    <div className="app-shell">
      {/* Mobile: open sidebar */}
      <button
        type="button"
        className="sidebar__toggle"
        onClick={() => setMobileMenuOpen(true)}
        aria-label="Open sidebar"
        aria-expanded={sidebarVisible}
      >
        <Menu size={20} aria-hidden />
        Menu
      </button>

      {/* Mobile overlay */}
      <div
        className={`sidebar__backdrop ${isNarrow && mobileMenuOpen ? "is-visible" : ""}`}
        onClick={closeMobileSidebar}
        aria-hidden={!mobileMenuOpen}
      />

      <aside
        className={`sidebar ${sidebarVisible ? "sidebar--visible" : ""}`}
        aria-label="Project and AI tools"
      >
        <div className="sidebar__header">
          <h1 className="sidebar__title">Dev Context</h1>
          <button
            type="button"
            className="sidebar__close"
            onClick={closeMobileSidebar}
            aria-label="Close sidebar"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <p className="sidebar__section-title">Add New Project</p>
        <form className="sidebar__form" onSubmit={handleAddProject}>
          <div>
            <label className="field-label" htmlFor="project-name">
              Project name <span aria-hidden>(required)</span>
            </label>
            <input
              id="project-name"
              className="input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Requests-handler"
              required
              autoComplete="off"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="project-desc">
              Short description / current context
            </label>
            <textarea
              id="project-desc"
              className="textarea"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="What you’re working on right now…"
              rows={4}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="project-link">
              Ticket / PR / Jira link (optional)
            </label>
            <input
              id="project-link"
              className="input"
              type="url"
              inputMode="url"
              value={projectTicketLink}
              onChange={(e) => setProjectTicketLink(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <button type="submit" className="btn btn--primary">
            <Plus size={18} aria-hidden />
            Add Project
          </button>
        </form>

        <div className="sidebar__footer">
          <p className="sidebar__section-title sidebar__section-title--footer">
            Gemini API
          </p>
          <div className="sidebar__api-block">
            <label className="field-label" htmlFor="gemini-api-key">
              API key (optional if .env set)
            </label>
            <input
              id="gemini-api-key"
              className="input input--mono"
              type="password"
              autoComplete="off"
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              placeholder="AIza…"
            />
            <p className="sidebar__api-hint">
              Free key from{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="sidebar__inline-link"
              >
                Google AI Studio
              </a>
              . Stored in this browser only.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--accent-outline"
            onClick={() => {
              void handleGenerateWithGemini();
            }}
            disabled={
              aiLoading || !resolvedGeminiKey || !activeProject || !activeProjectId
            }
          >
            {aiLoading ? (
              <Loader2 size={18} className="icon-spin" aria-hidden />
            ) : (
              <Sparkles size={18} aria-hidden />
            )}
            {aiLoading ? "Generating…" : "Generate Daily Priorities with AI"}
          </button>
          <p className="sidebar__footer-note">
            Built as AI-powered solution for context switching
          </p>
        </div>
      </aside>

      <main className="main">
        <div className="main__toolbar">
          <label className="main__toolbar-label" htmlFor="active-project">
            Active project
          </label>
          <select
            id="active-project"
            className="main__project-select"
            value={activeProjectId ?? ""}
            onChange={(e) => {
              clearAiError();
              setSelectedProjectId(e.target.value ? e.target.value : null);
            }}
            disabled={projects.length === 0}
            aria-describedby="active-project-hint"
          >
            {projects.length === 0 ? (
              <option value="">Add a project in the sidebar</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
          <p id="active-project-hint" className="main__toolbar-hint">
            AI priorities and task notes below are saved per project.
          </p>
        </div>

        <h2 className="page-title">All projects</h2>

        {projects.length === 0 ? (
          <p className="empty-projects">
            No projects yet. Add one from the sidebar to track context across
            repos.
          </p>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <article
                key={p.id}
                className={`project-card ${p.id === activeProjectId ? "project-card--active" : ""}`}
                onClick={() => {
                  clearAiError();
                  setSelectedProjectId(p.id);
                }}
                aria-current={p.id === activeProjectId ? "true" : undefined}
              >
                <button
                  type="button"
                  className="btn btn--icon project-card__delete"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    handleDeleteProject(p.id);
                  }}
                  aria-label={`Delete project ${p.name}`}
                >
                  <Trash2 size={18} aria-hidden />
                </button>
                <h3 className="project-card__name">{p.name}</h3>
                {p.description ? (
                  <p className="project-card__desc">{p.description}</p>
                ) : (
                  <p className="project-card__desc">No description yet.</p>
                )}
                {p.ticketLink ? (
                  <a
                    className="project-card__link"
                    href={p.ticketLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <ExternalLink size={16} aria-hidden />
                    Link
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        )}

        <h2 className="section-heading">
          AI Daily Priorities
          {activeProject ? (
            <span className="section-heading__for">
              {" "}
              — {activeProject.name}
            </span>
          ) : null}
        </h2>
        <p className="section-hint">
          Gemini ({GEMINI_MODEL}) uses this project&apos;s context and the task
          notes below. Each project keeps its own saved answer.
        </p>
        <div
          className="ai-output-panel"
          role="region"
          aria-label="Gemini generated priorities"
          aria-busy={aiLoading}
        >
          {aiError ? (
            <p className="ai-output__error" role="alert">
              {aiError}
            </p>
          ) : null}
          {aiLoading ? (
            <p className="ai-output__loading">
              <Loader2 size={20} className="icon-spin" aria-hidden /> Contacting
              Gemini…
            </p>
          ) : null}
          {currentAiOutput ? (
            <div className="ai-output__markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {currentAiOutput}
              </ReactMarkdown>
            </div>
          ) : null}
          {!aiLoading && !currentAiOutput && !aiError ? (
            <p className="ai-output__empty">
              {activeProject
                ? `No saved priorities for "${activeProject.name}" yet. Generate in the sidebar.`
                : "Add and select a project to store AI priorities."}
            </p>
          ) : null}
        </div>

        <h2 className="section-heading">
          Today&apos;s prioritized tasks &amp; notes
          {activeProject ? (
            <span className="section-heading__for">
              {" "}
              — {activeProject.name}
            </span>
          ) : null}
        </h2>
        <p className="section-hint">
          Drag to reorder • Saved per project • Add notes for this repo only
        </p>

        <div className="tasks-panel">
          {!activeProjectId ? (
            <p className="tasks-placeholder" role="status">
              Select an active project to add tasks and notes.
            </p>
          ) : tasksForActive.length === 0 ? (
            <p className="tasks-placeholder" role="status">
              No tasks or notes for this project yet. Add lines below.
            </p>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="tasks">
                {(droppableProvided) => (
                  <div
                    ref={droppableProvided.innerRef}
                    {...droppableProvided.droppableProps}
                    className="tasks-list"
                    role="list"
                    aria-label="Prioritized tasks (drag to reorder)"
                  >
                    {tasksForActive.map((task, index) => (
                      <Draggable
                        key={task.id}
                        draggableId={task.id}
                        index={index}
                      >
                        {(draggableProvided, snapshot) => (
                          <div
                            ref={draggableProvided.innerRef}
                            {...draggableProvided.draggableProps}
                            className={`task-row ${snapshot.isDragging ? "task-row--dragging" : ""}`}
                            role="listitem"
                          >
                            {/* div handle: native <button> can block pointer drags in some browsers */}
                            <div
                              className="task-row__handle"
                              {...draggableProvided.dragHandleProps}
                              aria-label={`Drag to reorder: ${task.content}`}
                            >
                              <span aria-hidden>☰</span>
                            </div>
                            <div className="task-row__text">{task.content}</div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {droppableProvided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
          <form className="task-add-form" onSubmit={handleAddTask}>
            <input
              className="input task-add-form__input"
              value={newTaskContent}
              onChange={(e) => setNewTaskContent(e.target.value)}
              placeholder={
                activeProject
                  ? `Note or task for ${activeProject.name}…`
                  : "Select a project first…"
              }
              aria-label="New task or note"
              maxLength={2000}
              disabled={!activeProjectId}
            />
            <button
              type="submit"
              className="btn btn--primary task-add-form__btn"
              disabled={!activeProjectId}
            >
              <Plus size={18} aria-hidden />
              Add note
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
