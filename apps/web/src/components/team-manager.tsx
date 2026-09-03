"use client";

import { useRouter } from "next/navigation";
import type { MemberDto } from "@teambuddy/contracts";
import { useState } from "react";

import { apiClient, createCorrelationId } from "../lib/api/client.js";
import { EntityForm } from "./entity-form.js";

export function TeamManager({
  teamId,
  members,
}: {
  teamId: string;
  members: MemberDto[];
}) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [updatingMemberId, setUpdatingMemberId] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();
  const activeMembers = members.filter(({ status }) => status === "ACTIVE");
  const visibleMembers = showArchived
    ? members
    : members.filter(({ status }) => status === "ACTIVE");

  const setMemberArchived = async (member: MemberDto, archived: boolean) => {
    setUpdatingMemberId(member.id);
    setActionMessage(undefined);
    try {
      await apiClient.updateMember(
        teamId,
        member.id,
        { status: archived ? "INACTIVE" : "ACTIVE" },
        { correlationId: createCorrelationId() },
      );
      setActionMessage(
        archived ? "成员已删除，可在归档列表恢复。" : "成员已恢复。",
      );
      router.refresh();
    } catch {
      setActionMessage("成员状态更新失败，请稍后重试。");
    } finally {
      setUpdatingMemberId(undefined);
    }
  };

  return (
    <div className="page-grid page-grid--two">
      <section className="panel">
        <div className="panel-heading">
          <h2>成员</h2>
          <label className="archive-toggle">
            <input
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              type="checkbox"
            />
            显示已归档
          </label>
        </div>
        <EntityForm
          onSubmit={(data) =>
            apiClient.createMember(
              teamId,
              {
                name: required(data, "name"),
                status: "ACTIVE",
                defaultDailyHours: number(data, "dailyHours"),
              },
              { correlationId: createCorrelationId() },
            )
          }
          onSuccess={() => router.refresh()}
          submitLabel="创建成员"
        >
          <label>
            成员姓名
            <input name="name" placeholder="例如：张三" required />
          </label>
          <label>
            每日可用工时
            <input
              defaultValue="8"
              max="24"
              min="0"
              name="dailyHours"
              required
              step="0.5"
              type="number"
            />
          </label>
        </EntityForm>
        <ul className="entity-list">
          {visibleMembers.map((member) => (
            <li key={member.id}>
              <div className="entity-summary">
                <strong>{member.name}</strong>
                <span>
                  {member.defaultDailyHours ?? 0}h/日 ·{" "}
                  {member.status === "ACTIVE" ? "在岗" : "已归档"}
                </span>
              </div>
              <button
                aria-label={`${member.status === "ACTIVE" ? "删除" : "恢复"}成员 ${member.name}`}
                className={
                  member.status === "ACTIVE"
                    ? "button-danger"
                    : "button-secondary"
                }
                disabled={updatingMemberId === member.id}
                onClick={() =>
                  void setMemberArchived(member, member.status === "ACTIVE")
                }
                type="button"
              >
                {updatingMemberId === member.id
                  ? "处理中…"
                  : member.status === "ACTIVE"
                    ? "删除"
                    : "恢复"}
              </button>
            </li>
          ))}
          {visibleMembers.length === 0 ? (
            <li className="empty-state">
              {showArchived ? "尚无成员。" : "尚无在岗成员。"}
            </li>
          ) : null}
        </ul>
        {actionMessage ? <p role="status">{actionMessage}</p> : null}
      </section>
      <section className="panel">
        <h2>日期产能例外</h2>
        <p className="muted">将工作日设为 0h 后，自动排期会跳过该日期。</p>
        <EntityForm
          onSubmit={(data) =>
            apiClient.upsertCapacityException(
              required(data, "memberId"),
              required(data, "date"),
              {
                availableHours: number(data, "availableHours"),
                reason: optional(data, "reason"),
              },
              { correlationId: createCorrelationId() },
            )
          }
          onSuccess={() => router.refresh()}
          submitLabel="设置日期产能"
        >
          <label>
            成员
            <select
              defaultValue=""
              disabled={activeMembers.length === 0}
              name="memberId"
              required
            >
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
            不可用日期
            <input name="date" required type="date" />
          </label>
          <label>
            可用工时
            <input
              defaultValue="0"
              max="24"
              min="0"
              name="availableHours"
              required
              step="0.5"
              type="number"
            />
          </label>
          <label>
            原因（可选）
            <input name="reason" placeholder="例如：请假" />
          </label>
        </EntityForm>
        <p className="helper-text">设置 weekday 0h 后，排期跳过不可用日。</p>
      </section>
    </div>
  );
}

const required = (data: FormData, key: string): string =>
  String(data.get(key) ?? "").trim();
const optional = (data: FormData, key: string): string | undefined => {
  const value = required(data, key);
  return value || undefined;
};
const number = (data: FormData, key: string): number => Number(data.get(key));
