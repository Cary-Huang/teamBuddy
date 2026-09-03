import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  read() {
    return { status: "ok" as const, service: "api" as const };
  }
}
