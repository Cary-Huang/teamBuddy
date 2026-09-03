import { expect, test } from "@playwright/test";

const CORE_DEMO_TEAM_ID = "70fc9bea-9d01-5174-8d0d-8a66b183a4f2";
const teamId = process.env.TEAM_ID ?? CORE_DEMO_TEAM_ID;

test(`manager can create a constrained task and see it skip an unavailable day (${teamId})`, async ({
  page,
}) => {
  const suffix = `验收-${Date.now()}`;
  const memberName = `张三-${suffix}`;
  const projectName = `支付重构-${suffix}`;
  const taskName = `支付联调-${suffix}`;
  const unavailableDate = firstShanghaiWeekday();
  if (isWeekend(unavailableDate)) {
    throw new Error(`Core E2E requires a weekday, received ${unavailableDate}`);
  }
  const targetDate = addDays(unavailableDate, 28);

  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "团队成员" })).toBeVisible();
  await page.getByLabel("成员姓名").fill(memberName);
  await page.getByLabel("每日可用工时").fill("6");
  await page.getByRole("button", { name: "创建成员" }).click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: memberName })
      .getByText(memberName, { exact: true }),
  ).toBeVisible();

  const memberSelect = page.getByRole("combobox", { name: "成员" });
  const memberOption = memberSelect.getByRole("option", { name: memberName });
  await expect(memberOption).toHaveCount(1);
  const memberId = await memberOption.getAttribute("value");
  if (!memberId)
    throw new Error(`Missing member option value for ${memberName}`);
  await memberSelect.selectOption(memberId);
  await page.getByLabel("不可用日期").fill(unavailableDate);
  await page.getByLabel("可用工时", { exact: true }).fill("0");
  await page.getByRole("button", { name: "设置日期产能" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  await page.getByRole("link", { name: "项目组合" }).click();
  await page.getByRole("link", { name: "创建项目" }).click();
  await expect(page.getByRole("heading", { name: "创建项目" })).toBeVisible();
  await page.getByLabel("项目名称").fill(projectName);
  await page.getByLabel("优先级").selectOption("P0");
  await page.getByLabel("目标日期").fill(targetDate);
  await page.getByLabel("项目负责人").selectOption({ label: memberName });
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("link", { name: projectName }).click();

  await page.getByLabel("里程碑名称").fill("联调完成");
  await page.getByLabel("目标日期", { exact: true }).first().fill(targetDate);
  await page.getByRole("button", { name: "创建里程碑" }).click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "联调完成" })
      .getByText("联调完成", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("任务名称").fill(taskName);
  await page.getByLabel("负责人").selectOption({ label: memberName });
  await page.getByLabel("关联里程碑").selectOption({ label: "联调完成" });
  await page.getByLabel("预估工时").fill("12");
  await page.getByLabel("剩余工时").fill("12");
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "团队排期" }).click();
  await page.getByLabel("排期开始日期").fill(unavailableDate);
  await page.getByRole("button", { name: "触发重算" }).click();
  await expect(page.getByRole("status")).toHaveText("草案已生成", {
    timeout: 45_000,
  });

  const allocation = page.getByRole("img", { name: new RegExp(taskName) });
  await expect(allocation).toBeVisible();
  await expect(allocation).not.toContainText(unavailableDate);
  await expect(allocation).not.toHaveAttribute(
    "aria-label",
    new RegExp(unavailableDate),
  );

  await page.getByRole("link", { name: "项目组合" }).click();
  await page.getByRole("button", { name: `删除项目 ${projectName}` }).click();
  await expect(page.getByRole("status")).toContainText("项目已删除");
  await expect(
    page.getByRole("link", { name: `查看项目 ${projectName}` }),
  ).toHaveCount(0);
  await page.getByLabel("显示已归档").check();
  await expect(
    page.getByRole("link", { name: `查看项目 ${projectName}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: `恢复项目 ${projectName}` }).click();
  await expect(page.getByRole("status")).toContainText("项目已恢复");

  await page.getByRole("link", { name: "团队成员" }).click();
  await page.getByRole("button", { name: `删除成员 ${memberName}` }).click();
  await expect(page.getByRole("status")).toContainText("成员已删除");
  await expect(
    page.getByRole("listitem").filter({ hasText: memberName }),
  ).toHaveCount(0);
  await page.getByLabel("显示已归档").check();
  await expect(
    page.getByRole("listitem").filter({ hasText: memberName }),
  ).toBeVisible();
  await page.getByRole("button", { name: `恢复成员 ${memberName}` }).click();
  await expect(page.getByRole("status")).toContainText("成员已恢复");
});

function shanghaiDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function firstShanghaiWeekday(): string {
  const today = shanghaiDate();
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(today, offset);
    if (!isWeekend(candidate)) return candidate;
  }
  throw new Error("Unable to select a Shanghai weekday within seven days");
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function addDays(date: string, count: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
