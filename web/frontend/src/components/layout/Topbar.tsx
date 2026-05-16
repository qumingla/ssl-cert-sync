import { Moon, Sun, LogOut, Menu, Server } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { Button } from "../ui/button";
import { useAuth } from "../AuthProvider";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";
import { navigation } from "./Sidebar";
import { NavLink } from "react-router-dom";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "../LocaleProvider";

export function Topbar() {
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const { t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="h-16 flex items-center justify-between lg:justify-end px-4 sm:px-6 border-b border-border bg-card flex-shrink-0">
      <div className="flex items-center gap-2 lg:hidden">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" />}>
            <Menu className="h-5 w-5" />
            <span className="sr-only">{t("topbar.toggleNav")}</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 max-w-[85vw]">
            <SheetHeader className="mb-6">
              <SheetTitle className="flex items-center gap-2 text-lg">
                <Server className="w-5 h-5 text-primary" />
                {t("app.name")}
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col space-y-1">
              {navigation.map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
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
          </SheetContent>
        </Sheet>
        <span className="font-semibold tracking-tight lg:hidden">{t("app.name")}</span>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t("topbar.toggleTheme")}</span>
        </Button>
        <Button variant="ghost" size="icon" onClick={logout}>
          <LogOut className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t("topbar.logout")}</span>
        </Button>
      </div>
    </header>
  );
}
