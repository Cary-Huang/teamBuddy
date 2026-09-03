"use client";

import { useRouter } from "next/navigation";
import type {
  MemberDto,
  MilestoneDto,
  ProjectDetailDto,
  ScheduleVersionWithAllocationsDto,
  TaskDto,
  TaxonomyDto,
} from "@teambuddy/contracts";
import type { FormEvent } from "react";
import { useState } from "react";

import { apiClient, createCorrelationId } from "../lib/api/client.js";
import { EntityForm } from "./entity-form.js";

export function ProjectCreateForm({
  teamId,
  members,
  taxonomy,
}: {
  teamId: string;
  members: MemberDto[];
  taxonomy: TaxonomyDto;
}) {
  const router = useRouter();
  const activeMembers = members.filter(({ status }) => status === "ACTIVE");
  return (
    <section className="panel form-panel">
      <h1>创建项目</h1>
      <EntityForm
        submitLabel="创建项目"
        onSuccess={() => router.push("/projects")}
        onSubmit={async (data) => {
          await apiClient.createProject(
            teamId,
            {
              name: value(data, "name"),
              priority: value(data, "priority") as "P0" | "P1" | "P2" | "P3",
              targetDate: value(data, "targetDate"),
              ownerMemberId: optionalValue(data, "ownerMemberId"),
              tagIds: data.getAll("tagIds").map(String).filter(Boolean),
              status: "PLANNING",
              health: "HEALTHY",
            },
            { correlationId: createCorrelationId() },
          );
        }}
      >
        <label>
          项目名称
          <input name="name" placeholder="例如：支付重构" required />
        </label>
        <label>
          优先级
          <select defaultValue="P1" name="priority">
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
        </label>
        <label>
          目标日期
          <input name="targetDate" required type="date" />
        </label>
        <label>
          项目负责人
          <select defaultValue="" name="ownerMemberId">
            <option value="">暂不指定</option>
            {activeMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <TagFields taxonomy={taxonomy} />
      </EntityForm>
    </section>
  );
}

export function ProjectDetailManager({
  detail,
  members,
  schedule,
  taxonomy,
}: {
  detail: ProjectDetailDto;
  members: MemberDto[];
  schedule: ScheduleVersionWithAllocationsDto | null;
  taxonomy: TaxonomyDto;
}) {
  const router = useRouter();
  const [updatingTaskId, setUpdatingTaskId] = useState<string>();
  const [editingTaskId, setEditingTaskId] = useState<string>();
  const [taskActionMessage, setTaskActionMessage] = useState<string>();
  const [tagMessage, setTagMessage] = useState<string>();
  const [savingTags, setSavingTags] = useState(false);
  const activeMembers = members.filter(({ status }) => status === "ACTIVE");
  const projectArchived = detail.project.status === "CANCELED";
  const saveProjectTags = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingTags(true);
    setTagMessage(undefined);
    try {
      const data = new FormData(event.currentTarget);
      await apiClient.replaceProjectTags(
        detail.project.teamId,
        detail.project.id,
        data.getAll("tagIds").map(String).filter(Boolean),
        { correlationId: createCorrelationId() },
      );
      setTagMessage("项目标签已更新。");
      router.refresh();
    } catch {
      setTagMessage("项目标签更新失败，请检查必填标签和单选限制。");
    } finally {
      setSavingTags(false);
    }
  };
  const setTaskStatus = async (task: TaskDto, status: TaskDto["status"]) => {
    if (status === task.status) return;
    setUpdatingTaskId(task.id);
    setTaskActionMessage(undefined);
    try {
      await apiClient.updateTask(
        detail.project.id,
        task.id,
        { status },
        {
          correlationId: createCorrelationId(),
        },
      );
      setTaskActionMessage(
        `${task.name} 已更新为“${taskStatusLabel[status]}”。`,
      );
      router.refresh();
    } catch {
      setTaskActionMessage("任务状态更新失败，请稍后重试。");
    } finally {
      setUpdatingTaskId(undefined);
    }
  };
  const saveTask = async (event: FormEvent<HTMLFormElement>, task: TaskDto) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setUpdatingTaskId(task.id);
    setTaskActionMessage(undefined);
    let taskUpdated = false;
    try {
      await apiClient.updateTask(
        detail.project.id,
        task.id,
        {
          name: value(data, "name"),
          assigneeId: value(data, "assigneeId"),
          estimatedHours: numberValue(data, "estimatedHours"),
          remainingHours: numberValue(data, "remainingHours"),
        },
        { correlationId: createCorrelationId() },
      );
      taskUpdated = true;
      const startDate = optionalValue(data, "startDate");
      const endDate = optionalValue(data, "endDate");
      if (startDate || endDate) {
        if (!startDate || !endDate) throw new Error("TASK_WINDOW_INCOMPLETE");
        await apiClient.setTaskScheduleWindow(
          detail.project.teamId,
          task.id,
          { startDate, endDate },
          { correlationId: createCorrelationId() },
        );
      }
      setTaskActionMessage(`${task.name} 的负责人和时间已更新。`);
      setEditingTaskId(undefined);
      router.refresh();
    } catch {
      setTaskActionMessage(
        taskUpdated
          ? "任务基础信息已保存，但排期日期更新失败，请检查日期和可用工时。"
          : "任务更新失败，请稍后重试。",
      );
    } finally {
      setUpdatingTaskId(undefined);
    }
  };
  return (
    <>
      <section className="panel project-tag-panel">
        <div className="panel-heading">
          <div>
            <h2>项目标签</h2>
            <p>标签用于项目筛选和后续大盘分析。</p>
          </div>
          {tagMessage ? <p role="status">{tagMessage}</p> : null}
        </div>
        <form className="project-tag-form" onSubmit={saveProjectTags}>
          <TagFields
            selectedIds={(detail.project.tags ?? []).map(({ id }) => id)}
            taxonomy={taxonomy}
          />
          <button disabled={savingTags} type="submit">
            {savingTags ? "保存中…" : "保存标签"}
          </button>
        </form>
      </section>
      <div className="page-grid page-grid--two">
        <section className="panel">
          <h2>里程碑</h2>
          {projectArchived ? (
            <p className="archive-notice">项目已归档，恢复后才能新增里程碑。</p>
          ) : (
            <EntityForm
              submitLabel="创建里程碑"
              onSuccess={() => router.refresh()}
              onSubmit={(data) =>
                apiClient.createMilestone(
                  detail.project.id,
                  {
                    name: value(data, "name"),
                    targetDate: value(data, "targetDate"),
                    manualRank: detail.milestones.length,
                  },
                  { correlationId: createCorrelationId() },
                )
              }
            >
              <label>
                里程碑名称
                <input name="name" placeholder="例如：联调完成" required />
              </label>
              <label>
                目标日期
                <input name="targetDate" required type="date" />
              </label>
            </EntityForm>
          )}
          <ul className="entity-list">
            {detail.milestones.map((milestone) => (
              <li key={milestone.id}>
                <strong>{milestone.name}</strong>
                <span>{milestone.targetDate}</span>
              </li>
            ))}
            {detail.milestones.length === 0 ? (
              <li className="empty-state">尚无里程碑。</li>
            ) : null}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>任务</h2>
            {taskActionMessage ? (
              <p role="status">{taskActionMessage}</p>
            ) : null}
          </div>
          {projectArchived ? (
            <p className="archive-notice">项目已归档，恢复后才能新增任务。</p>
          ) : (
            <EntityForm
              submitLabel="创建任务"
              onSuccess={() => router.refresh()}
              onSubmit={(data) =>
                apiClient.createTask(
                  detail.project.id,
                  {
                    name: value(data, "name"),
                    assigneeId: value(data, "assigneeId"),
                    milestoneId: optionalValue(data, "milestoneId"),
                    estimatedHours: numberValue(data, "estimatedHours"),
                    remainingHours: numberValue(data, "remainingHours"),
                    status: "NOT_STARTED",
                    manualRank: detail.tasks.length,
                    locked: false,
                  },
                  { correlationId: createCorrelationId() },
                )
              }
            >
              <label>
                任务名称
                <input name="name" placeholder="例如：支付接口联调" required />
              </label>
              <label>
                负责人
                <select defaultValue="" name="assigneeId" required>
                  <option disabled value="">
                    请选择成员
                  </option>
                  {activeMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                关联里程碑
                <select defaultValue="" name="milestoneId">
                  <option value="">无</option>
                  {detail.milestones.map((milestone: MilestoneDto) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                预估工时
                <input
                  defaultValue="12"
                  min="0"
                  name="estimatedHours"
                  required
                  step="0.5"
                  type="number"
                />
              </label>
              <label>
                剩余工时
                <input
                  defaultValue="12"
                  min="0"
                  name="remainingHours"
                  required
                  step="0.5"
                  type="number"
                />
              </label>
            </EntityForm>
          )}
          <ul className="entity-list">
            {detail.tasks.map((task) => {
              const window = taskWindow(task.id, schedule);
              const editing = editingTaskId === task.id;
              return (
                <li className="task-list-item" key={task.id}>
                  <div className="task-list-item__summary">
                    <div className="entity-summary">
                      <strong>{task.name}</strong>
                      <span>
                        {task.estimatedHours}h 预估 · {task.remainingHours}h
                        剩余
                      </span>
                    </div>
                    <div className="task-list-item__actions">
                      <label className="status-editor">
                        开发状态
                        <select
                          aria-label={`${task.name} 开发状态`}
                          disabled={
                            projectArchived || updatingTaskId === task.id
                          }
                          onChange={(event) =>
                            void setTaskStatus(
                              task,
                              event.target.value as TaskDto["status"],
                            )
                          }
                          value={task.status}
                        >
                          {Object.entries(taskStatusLabel).map(
                            ([status, label]) => (
                              <option key={status} value={status}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <button
                        className="button-secondary"
                        disabled={projectArchived || updatingTaskId === task.id}
                        onClick={() =>
                          setEditingTaskId(editing ? undefined : task.id)
                        }
                        type="button"
                      >
                        {editing ? "收起" : "编辑"}
                      </button>
                    </div>
                  </div>
                  {editing ? (
                    <form
                      className="task-edit-form"
                      onSubmit={(event) => void saveTask(event, task)}
                    >
                      <label>
                        任务名称
                        <input defaultValue={task.name} name="name" required />
                      </label>
                      <label>
                        负责人
                        <select
                          defaultValue={task.assigneeId}
                          name="assigneeId"
                          required
                        >
                          {activeMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        预估工时
                        <input
                          defaultValue={task.estimatedHours}
                          min="0"
                          name="estimatedHours"
                          required
                          step="0.5"
                          type="number"
                        />
                      </label>
                      <label>
                        剩余工时
                        <input
                          defaultValue={task.remainingHours}
                          min="0"
                          name="remainingHours"
                          required
                          step="0.5"
                          type="number"
                        />
                      </label>
                      <label>
                        计划开始
                        <input
                          defaultValue={window?.startDate}
                          name="startDate"
                          type="date"
                        />
                      </label>
                      <label>
                        计划结束
                        <input
                          defaultValue={window?.endDate}
                          name="endDate"
                          type="date"
                        />
                      </label>
                      <div className="task-edit-form__actions">
                        <button
                          disabled={updatingTaskId === task.id}
                          type="submit"
                        >
                          {updatingTaskId === task.id ? "保存中…" : "保存变更"}
                        </button>
                        <button
                          className="button-secondary"
                          disabled={updatingTaskId === task.id}
                          onClick={() => setEditingTaskId(undefined)}
                          type="button"
                        >
                          取消
                        </button>
                      </div>
                    </form>
                  ) : null}
                </li>
              );
            })}
            {detail.tasks.length === 0 ? (
              <li className="empty-state">尚无任务。</li>
            ) : null}
          </ul>
        </section>
      </div>
    </>
  );
}

const value = (data: FormData, key: string): string =>
  String(data.get(key) ?? "").trim();
const optionalValue = (data: FormData, key: string): string | undefined =>
  value(data, key) || undefined;
const numberValue = (data: FormData, key: string): number =>
  Number(data.get(key));

const taskStatusLabel: Record<TaskDto["status"], string> = {
  NOT_STARTED: "待开始",
  IN_PROGRESS: "进行中",
  BLOCKED: "已阻塞",
  COMPLETED: "已完成",
  CANCELED: "已取消",
};

const taskWindow = (
  taskId: string,
  schedule: ScheduleVersionWithAllocationsDto | null,
): { startDate: string; endDate: string } | undefined => {
  const dates = (schedule?.allocations ?? [])
    .filter((allocation) => allocation.taskId === taskId)
    .map(({ date }) => date)
    .sort();
  const startDate = dates[0];
  const endDate = dates.at(-1);
  return startDate && endDate ? { startDate, endDate } : undefined;
};

function TagFields({
  taxonomy,
  selectedIds = [],
}: {
  taxonomy: TaxonomyDto;
  selectedIds?: string[];
}) {
  const selected = new Set(selectedIds);
  return (
    <>
      {taxonomy.groups
        .filter((group) => group.status === "ACTIVE" && group.scope !== "TASK")
        .map((group) => {
          const options = taxonomy.tags.filter(
            (tag) => tag.groupId === group.id && tag.status === "ACTIVE",
          );
          if (group.selectionMode === "SINGLE") {
            return (
              <label key={group.id}>
                {group.name}
                <select
                  defaultValue={
                    options.find(({ id }) => selected.has(id))?.id ?? ""
                  }
                  name="tagIds"
                  required={group.requiredOnProject}
                >
                  <option value="">
                    {group.requiredOnProject ? "请选择" : "不设置"}
                  </option>
                  {options.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <fieldset className="tag-checkbox-group" key={group.id}>
              <legend>{group.name}</legend>
              {options.map((tag) => (
                <label key={tag.id}>
                  <input
                    defaultChecked={selected.has(tag.id)}
                    name="tagIds"
                    type="checkbox"
                    value={tag.id}
                  />
                  {tag.name}
                </label>
              ))}
            </fieldset>
          );
        })}
    </>
  );
}
