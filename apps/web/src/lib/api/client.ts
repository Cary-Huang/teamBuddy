import {
  apiErrorResponseSchema,
  capacityExceptionSchema,
  createMemberRequestSchema,
  createMilestoneRequestSchema,
  createProjectRequestSchema,
  createTaskRequestSchema,
  createTagGroupRequestSchema,
  createTagRequestSchema,
  latestScheduleSchema,
  memberListSchema,
  memberSchema,
  milestoneSchema,
  projectDetailSchema,
  projectListSchema,
  projectSchema,
  projectTagsSchema,
  queuedRecalculationSchema,
  replaceProjectTagsRequestSchema,
  taskSchema,
  taskScheduleWindowRequestSchema,
  tagGroupSchema,
  tagSchema,
  taxonomySchema,
  updateMemberSchema,
  updateProjectSchema,
  updateTaskSchema,
  updateTagGroupRequestSchema,
  updateTagRequestSchema,
  upsertCapacityExceptionRequestSchema,
  type ApiErrorResponse,
  type CapacityExceptionDto,
  type CreateMemberRequestDto,
  type CreateMilestoneRequestDto,
  type CreateProjectRequestDto,
  type CreateTaskRequestDto,
  type CreateTagGroupRequestDto,
  type CreateTagRequestDto,
  type MemberDto,
  type MilestoneDto,
  type ProjectDetailDto,
  type ProjectDto,
  type ProjectTagsDto,
  type QueuedRecalculationDto,
  type ScheduleVersionWithAllocationsDto,
  type TaskDto,
  type TaskScheduleWindowRequestDto,
  type TagDto,
  type TagGroupDto,
  type TaxonomyDto,
  type UpdateMemberDto,
  type UpdateProjectDto,
  type UpdateTaskDto,
  type UpdateTagGroupRequestDto,
  type UpdateTagRequestDto,
  type UpsertCapacityExceptionRequestDto,
} from "@teambuddy/contracts";

interface PublicSchema<T> {
  safeParse(
    value: unknown,
  ):
    { success: true; data: T } | { success: false; error: { message: string } };
}

export const DEFAULT_API_BASE_URL = "http://localhost:3001";

// This direct public environment reference is intentionally compiled into browser bundles by Next.js.
const browserApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

export interface RequestOptions {
  correlationId?: string;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  createCorrelationId?: () => string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId?: string;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    correlationId?: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "ApiClientError";
    this.status = input.status;
    this.code = input.code;
    this.correlationId = input.correlationId;
    this.details = input.details;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly createCorrelationId: () => string;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? browserApiBaseUrl).replace(/\/$/, "");
    // Native browser fetch validates its receiver. Keep injected test/custom
    // fetchers untouched, but bind the default global implementation once.
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.createCorrelationId =
      options.createCorrelationId ?? createCorrelationId;
  }

  listMembers(teamId: string, options?: RequestOptions): Promise<MemberDto[]> {
    return this.request(
      `/v1/teams/${teamId}/members`,
      memberListSchema,
      {},
      options,
    );
  }

  createMember(
    teamId: string,
    input: CreateMemberRequestDto,
    options?: RequestOptions,
  ): Promise<MemberDto> {
    return this.request(
      `/v1/teams/${teamId}/members`,
      memberSchema,
      { method: "POST", body: createMemberRequestSchema.parse(input) },
      options,
    );
  }

  updateMember(
    teamId: string,
    memberId: string,
    input: UpdateMemberDto,
    options?: RequestOptions,
  ): Promise<MemberDto> {
    return this.request(
      `/v1/teams/${teamId}/members/${memberId}`,
      memberSchema,
      { method: "PATCH", body: updateMemberSchema.parse(input) },
      options,
    );
  }

  upsertCapacityException(
    memberId: string,
    date: string,
    input: UpsertCapacityExceptionRequestDto,
    options?: RequestOptions,
  ): Promise<CapacityExceptionDto> {
    return this.request(
      `/v1/members/${memberId}/capacity-exceptions/${date}`,
      capacityExceptionSchema,
      {
        method: "PUT",
        body: upsertCapacityExceptionRequestSchema.parse(input),
      },
      options,
    );
  }

  getTaxonomy(teamId: string, options?: RequestOptions): Promise<TaxonomyDto> {
    return this.request(
      `/v1/teams/${teamId}/taxonomy`,
      taxonomySchema,
      {},
      options,
    );
  }

  createTagGroup(
    teamId: string,
    input: CreateTagGroupRequestDto,
    options?: RequestOptions,
  ): Promise<TagGroupDto> {
    return this.request(
      `/v1/teams/${teamId}/tag-groups`,
      tagGroupSchema,
      { method: "POST", body: createTagGroupRequestSchema.parse(input) },
      options,
    );
  }

  updateTagGroup(
    teamId: string,
    groupId: string,
    input: UpdateTagGroupRequestDto,
    options?: RequestOptions,
  ): Promise<TagGroupDto> {
    return this.request(
      `/v1/teams/${teamId}/tag-groups/${groupId}`,
      tagGroupSchema,
      { method: "PATCH", body: updateTagGroupRequestSchema.parse(input) },
      options,
    );
  }

  createTag(
    teamId: string,
    input: CreateTagRequestDto,
    options?: RequestOptions,
  ): Promise<TagDto> {
    return this.request(
      `/v1/teams/${teamId}/tags`,
      tagSchema,
      { method: "POST", body: createTagRequestSchema.parse(input) },
      options,
    );
  }

  updateTag(
    teamId: string,
    tagId: string,
    input: UpdateTagRequestDto,
    options?: RequestOptions,
  ): Promise<TagDto> {
    return this.request(
      `/v1/teams/${teamId}/tags/${tagId}`,
      tagSchema,
      { method: "PATCH", body: updateTagRequestSchema.parse(input) },
      options,
    );
  }

  listProjects(
    teamId: string,
    options?: RequestOptions,
  ): Promise<ProjectDto[]> {
    return this.request(
      `/v1/teams/${teamId}/projects`,
      projectListSchema,
      {},
      options,
    );
  }

  createProject(
    teamId: string,
    input: CreateProjectRequestDto,
    options?: RequestOptions,
  ): Promise<ProjectDto> {
    return this.request(
      `/v1/teams/${teamId}/projects`,
      projectSchema,
      { method: "POST", body: createProjectRequestSchema.parse(input) },
      options,
    );
  }

  updateProject(
    teamId: string,
    projectId: string,
    input: UpdateProjectDto,
    options?: RequestOptions,
  ): Promise<ProjectDto> {
    return this.request(
      `/v1/teams/${teamId}/projects/${projectId}`,
      projectSchema,
      { method: "PATCH", body: updateProjectSchema.parse(input) },
      options,
    );
  }

  replaceProjectTags(
    teamId: string,
    projectId: string,
    tagIds: string[],
    options?: RequestOptions,
  ): Promise<ProjectTagsDto> {
    return this.request(
      `/v1/teams/${teamId}/projects/${projectId}/tags`,
      projectTagsSchema,
      {
        method: "PUT",
        body: replaceProjectTagsRequestSchema.parse({ tagIds }),
      },
      options,
    );
  }

  getProject(
    projectId: string,
    options?: RequestOptions,
  ): Promise<ProjectDetailDto> {
    return this.request(
      `/v1/projects/${projectId}`,
      projectDetailSchema,
      {},
      options,
    );
  }

  createMilestone(
    projectId: string,
    input: CreateMilestoneRequestDto,
    options?: RequestOptions,
  ): Promise<MilestoneDto> {
    return this.request(
      `/v1/projects/${projectId}/milestones`,
      milestoneSchema,
      { method: "POST", body: createMilestoneRequestSchema.parse(input) },
      options,
    );
  }

  createTask(
    projectId: string,
    input: CreateTaskRequestDto,
    options?: RequestOptions,
  ): Promise<TaskDto> {
    return this.request(
      `/v1/projects/${projectId}/tasks`,
      taskSchema,
      { method: "POST", body: createTaskRequestSchema.parse(input) },
      options,
    );
  }

  updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskDto,
    options?: RequestOptions,
  ): Promise<TaskDto> {
    return this.request(
      `/v1/projects/${projectId}/tasks/${taskId}`,
      taskSchema,
      { method: "PATCH", body: updateTaskSchema.parse(input) },
      options,
    );
  }

  setTaskScheduleWindow(
    teamId: string,
    taskId: string,
    input: TaskScheduleWindowRequestDto,
    options?: RequestOptions,
  ): Promise<QueuedRecalculationDto> {
    return this.request(
      `/v1/teams/${teamId}/planning/tasks/${taskId}/window`,
      queuedRecalculationSchema,
      {
        method: "PUT",
        body: taskScheduleWindowRequestSchema.parse(input),
      },
      options,
    );
  }

  recalculate(
    teamId: string,
    options?: RequestOptions,
  ): Promise<QueuedRecalculationDto> {
    return this.request(
      `/v1/teams/${teamId}/planning/recalculate`,
      queuedRecalculationSchema,
      { method: "POST" },
      options,
    );
  }

  getLatestSchedule(
    teamId: string,
    options?: RequestOptions,
  ): Promise<ScheduleVersionWithAllocationsDto | null> {
    return this.request(
      `/v1/teams/${teamId}/schedules/latest`,
      latestScheduleSchema,
      {},
      options,
    );
  }

  private async request<T>(
    path: string,
    schema: PublicSchema<T>,
    init: { method?: string; body?: unknown },
    options: RequestOptions = {},
  ): Promise<T> {
    const correlationId = options.correlationId ?? this.createCorrelationId();
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          "x-correlation-id": correlationId,
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: options.signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ApiClientError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "无法连接到 TeamBuddy API，请检查服务是否已启动。",
        correlationId,
      });
    }

    if (response.status === 204) {
      throw new ApiClientError({
        status: 204,
        code: "NO_CONTENT",
        message: "API 未返回此操作所需的数据。",
        correlationId,
      });
    }

    const body = await parseJsonBody(response, correlationId);
    if (!response.ok) throw asApiError(response.status, body, correlationId);

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiClientError({
        status: response.status,
        code: "INVALID_RESPONSE",
        message: "API 返回了不符合公共契约的数据。",
        correlationId,
        details: { validation: parsed.error.message },
      });
    }
    return parsed.data;
  }
}

const parseJsonBody = async (
  response: Response,
  correlationId: string,
): Promise<unknown> => {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiClientError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "读取 TeamBuddy API 响应时连接中断。",
      correlationId,
    });
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiClientError({
      status: response.status,
      code: "INVALID_RESPONSE",
      message: "API 返回了非 JSON 响应。",
      correlationId,
    });
  }
};

const asApiError = (
  status: number,
  body: unknown,
  fallbackCorrelationId: string,
): ApiClientError => {
  const parsed = apiErrorResponseSchema.safeParse(body);
  if (parsed.success) return apiErrorToClientError(status, parsed.data);
  return new ApiClientError({
    status,
    code: "HTTP_ERROR",
    message: "请求未成功完成，且 API 未返回标准错误信息。",
    correlationId: fallbackCorrelationId,
  });
};

const apiErrorToClientError = (
  status: number,
  body: ApiErrorResponse,
): ApiClientError => new ApiClientError({ status, ...body });

export const resolveBrowserApiBaseUrl = (value?: string): string =>
  value ?? DEFAULT_API_BASE_URL;

export const getApiBaseUrl = (): string => browserApiBaseUrl;

export const createCorrelationId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("当前运行环境不支持安全的 UUID 生成。");
};

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name?: unknown }).name === "AbortError";

export const apiClient = new ApiClient();
