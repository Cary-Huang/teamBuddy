import Link from "next/link";
import type { ReactNode } from "react";

const links = [
  { href: "/", label: "驾驶舱" },
  { href: "/projects", label: "项目组合" },
  { href: "/schedule", label: "团队排期" },
  { href: "/team", label: "团队成员" },
  { href: "/tags", label: "标签管理" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="brand" href="/">
          TeamBuddy
        </Link>
        <p className="brand-caption">团队交付管理</p>
        <nav aria-label="主导航">
          {links.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="app-content">
        <header className="app-topbar">
          <span>Asia/Shanghai · 四周滚动排期</span>
          <span className="topbar-status">负责人视图</span>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
