import { ApiClient, DEFAULT_API_BASE_URL } from "./api/client.js";
import { createElement } from "react";

export const getConfiguredTeamId = (): string | undefined =>
  process.env.TEAM_ID ?? process.env.NEXT_PUBLIC_TEAM_ID;

export const resolveServerApiBaseUrl = (value?: string): string =>
  value ?? DEFAULT_API_BASE_URL;

export const getServerApiClient = (): ApiClient =>
  new ApiClient({
    baseUrl: resolveServerApiBaseUrl(process.env.API_BASE_URL),
  });

export const TeamScopeGuide = () =>
  createElement(
    "section",
    { className: "empty-state", "aria-labelledby": "team-scope-title" },
    createElement("h1", { id: "team-scope-title" }, "需要配置团队范围"),
    createElement(
      "p",
      null,
      "请设置 ",
      createElement("code", null, "NEXT_PUBLIC_TEAM_ID"),
      "（浏览器）或 ",
      createElement("code", null, "TEAM_ID"),
      "（服务端），然后刷新页面。",
    ),
    createElement(
      "p",
      null,
      "可同时通过 ",
      createElement("code", null, "NEXT_PUBLIC_API_BASE_URL"),
      " 指向 API，默认地址为 http://localhost:3001。",
    ),
  );
