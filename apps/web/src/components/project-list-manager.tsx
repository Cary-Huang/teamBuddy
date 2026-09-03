"use client";

import type { ProjectDto, TaxonomyDto } from "@teambuddy/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiClient, createCorrelationId } from "../lib/api/client.js";

const statusLabel: Record<ProjectDto["status"], string> = {
  PLANNING: "规划中",
  IN_PROGRESS: "进行中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  CANCELED: "已归档",
};

export function ProjectListManager({
  projects,
  teamId,
  taxonomy,
}: {
  projects: ProjectDto[];
  teamId: string;
  taxonomy: TaxonomyDto;
}) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [filterTagId, setFilterTagId] = useState("");
  const [updatingProjectId, setUpdatingProjectId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const visibleProjects = projects.filter(
    (project) =>
      (showArchived || project.status !== "CANCELED") &&
      (!filterTagId ||
        (project.tags ?? []).some(({ id }) => id === filterTagId)),
  );
  const groupNameById = new Map(
    taxonomy.groups.map(({ id, name }) => [id, name]),
  );

  const setProjectArchived = async (project: ProjectDto, archived: boolean) => {
    setUpdatingProjectId(project.id);
    setMessage(undefined);
    try {
      await apiClient.updateProject(
        teamId,
        project.id,
        { status: archived ? "CANCELED" : "PLANNING" },
        { correlationId: createCorrelationId() },
      );
      setMessage(archived ? "项目已删除，可在归档列表恢复。" : "项目已恢复。");
      router.refresh();
    } catch {
      setMessage("项目状态更新失败，请稍后重试。");
    } finally {
      setUpdatingProjectId(undefined);
    }
  };

  const setProjectStatus = async (
    project: ProjectDto,
    status: ProjectDto["status"],
  ) => {
    if (status === project.status) return;
    setUpdatingProjectId(project.id);
    setMessage(undefined);
    try {
      await apiClient.updateProject(
        teamId,
        project.id,
        { status },
        { correlationId: createCorrelationId() },
      );
      setMessage(`${project.name} 已更新为“${statusLabel[status]}”。`);
      router.refresh();
    } catch {
      setMessage("项目状态更新失败，请稍后重试。");
    } finally {
      setUpdatingProjectId(undefined);
    }
  };

  return (
    <>
      <div className="list-toolbar">
        <label>
          标签筛选
          <select
            aria-label="标签筛选"
            onChange={(event) => setFilterTagId(event.target.value)}
            value={filterTagId}
          >
            <option value="">全部标签</option>
            {taxonomy.tags
              .filter(({ status }) => status === "ACTIVE")
              .map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {groupNameById.get(tag.groupId)} · {tag.name}
                </option>
              ))}
          </select>
        </label>
        <label className="archive-toggle">
          <input
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            type="checkbox"
          />
          显示已归档
        </label>
        {message ? <p role="status">{message}</p> : null}
      </div>
      {visibleProjects.length === 0 ? (
        <div className="empty-state">
          {showArchived ? (
            "尚无项目。"
          ) : (
            <>
              尚无进行中的项目。<Link href="/projects/new">创建项目</Link>
            </>
          )}
        </div>
      ) : (
        <div className="project-list">
          {visibleProjects.map((project) => (
            <article className="project-card" key={project.id}>
              <Link
                aria-label={`查看项目 ${project.name}`}
                className="project-card__link"
                href={`/projects/${project.id}`}
              >
                <div>
                  <span
                    className={`tag tag--${project.priority.toLowerCase()}`}
                  >
                    {project.priority}
                  </span>
                  <h2>{project.name}</h2>
                </div>
                <div className="tag-row">
                  {(project.tags ?? []).map((tag) => (
                    <span
                      className="taxonomy-tag"
                      key={tag.id}
                      style={{ borderColor: tag.color, color: tag.color }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
                <dl>
                  <div>
                    <dt>状态</dt>
                    <dd>{statusLabel[project.status]}</dd>
                  </div>
                  <div>
                    <dt>目标日期</dt>
                    <dd>{project.targetDate}</dd>
                  </div>
                </dl>
              </Link>
              <div className="project-card__actions">
                <label>
                  当前状态
                  <select
                    aria-label={`${project.name} 当前状态`}
                    disabled={updatingProjectId === project.id}
                    onChange={(event) =>
                      void setProjectStatus(
                        project,
                        event.target.value as ProjectDto["status"],
                      )
                    }
                    value={project.status}
                  >
                    {Object.entries(statusLabel).map(([status, label]) => (
                      <option key={status} value={status}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  aria-label={`${project.status === "CANCELED" ? "恢复" : "删除"}项目 ${project.name}`}
                  className={
                    project.status === "CANCELED"
                      ? "button-secondary"
                      : "button-danger"
                  }
                  disabled={updatingProjectId === project.id}
                  onClick={() =>
                    void setProjectArchived(
                      project,
                      project.status !== "CANCELED",
                    )
                  }
                  type="button"
                >
                  {updatingProjectId === project.id
                    ? "处理中…"
                    : project.status === "CANCELED"
                      ? "恢复"
                      : "删除"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
