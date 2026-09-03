"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import type { TagDto, TagGroupDto, TaxonomyDto } from "@teambuddy/contracts";
import { useRouter } from "next/navigation";

import { apiClient, createCorrelationId } from "../lib/api/client.js";

export function TaxonomyManager({
  teamId,
  taxonomy,
}: {
  teamId: string;
  taxonomy: TaxonomyDto;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();

  const run = async (
    action: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> => {
    setPending(true);
    setMessage(undefined);
    try {
      await action();
      setMessage(success);
      router.refresh();
      return true;
    } catch {
      setMessage("操作失败，请检查编码是否重复或标签是否仍被使用。");
      return false;
    } finally {
      setPending(false);
    }
  };

  const createGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(
      () =>
        apiClient.createTagGroup(
          teamId,
          {
            code: text(data, "code"),
            name: text(data, "name"),
            selectionMode: text(data, "selectionMode") as "SINGLE" | "MULTIPLE",
            scope: text(data, "scope") as "PROJECT" | "TASK" | "BOTH",
            requiredOnProject: data.get("requiredOnProject") === "on",
          },
          { correlationId: createCorrelationId() },
        ),
      "标签组已创建。",
    ).then((succeeded) => {
      if (succeeded) form.reset();
    });
  };

  const createTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(
      () =>
        apiClient.createTag(
          teamId,
          {
            groupId: text(data, "groupId"),
            code: text(data, "code"),
            name: text(data, "name"),
            color: text(data, "color"),
            description: text(data, "description") || undefined,
          },
          { correlationId: createCorrelationId() },
        ),
      "标签已创建。",
    ).then((succeeded) => {
      if (succeeded) form.reset();
    });
  };

  const saveGroup = (event: FormEvent<HTMLFormElement>, group: TagGroupDto) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(
      () =>
        apiClient.updateTagGroup(
          teamId,
          group.id,
          {
            name: text(data, "name"),
            selectionMode: text(data, "selectionMode") as "SINGLE" | "MULTIPLE",
            scope: text(data, "scope") as "PROJECT" | "TASK" | "BOTH",
            requiredOnProject: data.get("requiredOnProject") === "on",
            status: text(data, "status") as "ACTIVE" | "ARCHIVED",
          },
          { correlationId: createCorrelationId() },
        ),
      `${group.name} 已更新。`,
    );
  };

  const saveTag = (event: FormEvent<HTMLFormElement>, tag: TagDto) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(
      () =>
        apiClient.updateTag(
          teamId,
          tag.id,
          {
            name: text(data, "name"),
            color: text(data, "color"),
            description: text(data, "description") || undefined,
            status: text(data, "status") as "ACTIVE" | "ARCHIVED",
          },
          { correlationId: createCorrelationId() },
        ),
      `${tag.name} 已更新。`,
    );
  };

  return (
    <div className="taxonomy-page">
      <div className="page-heading">
        <div>
          <h1>标签管理</h1>
          <p>统一维护项目分类，并为未来任务标签保留复用能力。</p>
        </div>
        {message ? <p role="status">{message}</p> : null}
      </div>
      <div className="page-grid page-grid--two">
        <section className="panel">
          <h2>创建标签组</h2>
          <form className="entity-form" onSubmit={createGroup}>
            <label>
              标签组名称
              <input name="name" placeholder="例如：业务线" required />
            </label>
            <label>
              稳定编码
              <input
                name="code"
                pattern="[a-z][a-z0-9_]*"
                placeholder="business_line"
                required
              />
            </label>
            <label>
              选择方式
              <select defaultValue="MULTIPLE" name="selectionMode">
                <option value="SINGLE">单选</option>
                <option value="MULTIPLE">多选</option>
              </select>
            </label>
            <label>
              适用范围
              <select defaultValue="PROJECT" name="scope">
                <option value="PROJECT">项目</option>
                <option value="TASK">任务（预留）</option>
                <option value="BOTH">项目和任务</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input name="requiredOnProject" type="checkbox" />
              项目必填
            </label>
            <button disabled={pending} type="submit">
              创建标签组
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>创建标签</h2>
          <form className="entity-form" onSubmit={createTag}>
            <label>
              所属标签组
              <select name="groupId" required>
                {taxonomy.groups
                  .filter(({ status }) => status === "ACTIVE")
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              标签名称
              <input name="name" placeholder="例如：客户定制" required />
            </label>
            <label>
              稳定编码
              <input
                name="code"
                pattern="[a-z][a-z0-9_]*"
                placeholder="customer_custom"
                required
              />
            </label>
            <label>
              颜色
              <input defaultValue="#2563eb" name="color" type="color" />
            </label>
            <label>
              说明
              <input name="description" placeholder="统计口径或使用说明" />
            </label>
            <button
              disabled={
                pending ||
                taxonomy.groups.every(({ status }) => status !== "ACTIVE")
              }
              type="submit"
            >
              创建标签
            </button>
          </form>
        </section>
      </div>
      {taxonomy.groups.map((group) => (
        <section className="panel taxonomy-group" key={group.id}>
          <form
            className="taxonomy-group-editor"
            onSubmit={(event) => saveGroup(event, group)}
          >
            <label>
              标签组
              <input defaultValue={group.name} name="name" required />
            </label>
            <label>
              选择方式
              <select defaultValue={group.selectionMode} name="selectionMode">
                <option value="SINGLE">单选</option>
                <option value="MULTIPLE">多选</option>
              </select>
            </label>
            <label>
              适用范围
              <select defaultValue={group.scope} name="scope">
                <option value="PROJECT">项目</option>
                <option value="TASK">任务（预留）</option>
                <option value="BOTH">项目和任务</option>
              </select>
            </label>
            <label>
              状态
              <select defaultValue={group.status} name="status">
                <option value="ACTIVE">启用</option>
                <option value="ARCHIVED">归档</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input
                defaultChecked={group.requiredOnProject}
                name="requiredOnProject"
                type="checkbox"
              />
              项目必填
            </label>
            <button disabled={pending} type="submit">
              保存分组
            </button>
            <code>{group.code}</code>
          </form>
          <div className="taxonomy-tag-list">
            {taxonomy.tags
              .filter(({ groupId }) => groupId === group.id)
              .map((tag) => (
                <form
                  className="taxonomy-tag-editor"
                  key={tag.id}
                  onSubmit={(event) => saveTag(event, tag)}
                >
                  <span
                    className="taxonomy-tag"
                    style={{ borderColor: tag.color, color: tag.color }}
                  >
                    {tag.name}
                  </span>
                  <input
                    defaultValue={tag.name}
                    aria-label={`${tag.name} 名称`}
                    name="name"
                    required
                  />
                  <input
                    defaultValue={tag.color}
                    aria-label={`${tag.name} 颜色`}
                    name="color"
                    type="color"
                  />
                  <input
                    defaultValue={tag.description}
                    aria-label={`${tag.name} 说明`}
                    name="description"
                    placeholder="说明"
                  />
                  <select
                    defaultValue={tag.status}
                    aria-label={`${tag.name} 状态`}
                    name="status"
                  >
                    <option value="ACTIVE">启用</option>
                    <option value="ARCHIVED">归档</option>
                  </select>
                  <button disabled={pending} type="submit">
                    保存
                  </button>
                  <code>{tag.code}</code>
                </form>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const text = (data: FormData, key: string): string =>
  String(data.get(key) ?? "").trim();
