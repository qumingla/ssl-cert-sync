import { NavLink } from "react-router-dom";
import { LayoutDashboard, Globe, Server, ListTree, Activity, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "../LocaleProvider";

export const navigation = [
  { labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard },
  { labelKey: "nav.domains", href: "/domains", icon: Globe },
  { labelKey: "nav.nodes", href: "/nodes", icon: Server },
  { labelKey: "nav.dnsChannels", href: "/dns-channels", icon: ListTree },
  { labelKey: "nav.jobs", href: "/jobs", icon: Activity },
  { labelKey: "nav.settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar() {
  const { t } = useI18n();

  return (
    <div className="hidden lg:flex flex-col w-64 bg-card border-r border-border h-full flex-shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-border">
        <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" />
          {t("app.name")}
        </h1>
      </div>
      <div className="flex-1 py-4 overflow-y-auto">
        <nav className="px-3 space-y-1">
          {navigation.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
