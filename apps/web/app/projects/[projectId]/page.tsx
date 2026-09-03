import Link from "next/link";

import { ProjectDetailManager } from "../../../src/components/project-forms.js";
import { getServerApiClient } from "../../../src/lib/team-scope.js";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  try {
    const detail = await getServerApiClient().getProject(projectId);
    const [members, schedule, taxonomy] = await Promise.all([
      getServerApiClient().listMembers(detail.project.teamId),
      getServerApiClient().getLatestSchedule(detail.project.teamId),
      getServerApiClient().getTaxonomy(detail.project.teamId),
    ]);
    return (
      <section>
        <header className="page-heading">
          <div>
            <Link href="/projects">← 项目组合</Link>
            <h1>{detail.project.name}</h1>
            <p>
              <span
                className={`tag tag--${detail.project.priority.toLowerCase()}`}
              >
                {detail.project.priority}
              </span>{" "}
              当前状态 {projectStatusLabel[detail.project.status]} · 目标日期{" "}
              {detail.project.targetDate}
            </p>
            <div className="tag-row">
              {(detail.project.tags ?? []).map((tag) => (
                <span
                  className="taxonomy-tag"
                  key={tag.id}
                  style={{ borderColor: tag.color, color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        </header>
        <ProjectDetailManager
          detail={detail}
          members={members}
          schedule={schedule}
          taxonomy={taxonomy}
        />
      </section>
    );
  } catch {
    return (
      <section className="empty-state">
        <h1>项目暂不可用</h1>
        <p>项目可能不存在，或 API 服务暂不可用。</p>
      </section>
    );
  }
}

const projectStatusLabel = {
  PLANNING: "规划中",
  IN_PROGRESS: "进行中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  CANCELED: "已取消",
} as const;
