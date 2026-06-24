"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ThemeSwitcher() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted ? resolvedTheme : "dark";

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-border/60 bg-card/80 p-1 shadow-sm backdrop-blur">
      <Button
        type="button"
        variant={activeTheme === "light" ? "secondary" : "ghost"}
        size="sm"
        className={cn("h-8 px-2.5", activeTheme !== "light" && "text-muted-foreground")}
        onClick={() => setTheme("light")}
        aria-pressed={activeTheme === "light"}
      >
        <Sun className="size-4" />
        <span className="hidden sm:inline">Light</span>
      </Button>
      <Button
        type="button"
        variant={activeTheme === "dark" ? "secondary" : "ghost"}
        size="sm"
        className={cn("h-8 px-2.5", activeTheme !== "dark" && "text-muted-foreground")}
        onClick={() => setTheme("dark")}
        aria-pressed={activeTheme === "dark"}
      >
        <Moon className="size-4" />
        <span className="hidden sm:inline">Dark</span>
      </Button>
    </div>
  );
}
