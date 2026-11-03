"use client";

import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { ChevronLeft, ChevronRight, FileText, MessageSquare, X } from "lucide-react";

import { cn } from "../lib/cn.js";
import { Tabs, TabsList, TabsTrigger } from "../shadcn/tabs.js";
import { Button } from "../shadcn/button.js";

export type SessionTabItem = {
  tabId: string;
  title: string;
  kind: "session" | "document";
};

export type SessionTabsProps = {
  tabs: SessionTabItem[];
  activeId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
};

type ScrollState = {
  atStart: boolean;
  atEnd: boolean;
};

// The tab strip scrolls horizontally without a visible scrollbar. Orca shows
// chevron arrows at the edges when there are hidden tabs; we mirror that and
// auto-scroll the active tab into view instead of letting rows wrap or push
// the chat wider.
export function SessionTabs({ tabs, activeId, onActivate, onClose }: SessionTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState<ScrollState>({ atStart: true, atEnd: false });

  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const maxLeft = el.scrollWidth - el.clientWidth;
    setScroll({
      atStart: el.scrollLeft <= 1,
      atEnd: maxLeft <= 1 || el.scrollLeft >= maxLeft - 1,
    });
  }, []);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    measure(event.currentTarget);
  }, [measure]);

  const nudge = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  // Keep the active tab in view as it changes; report overflow state on mount
  // and whenever the tab set changes width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure(el);
    if (!activeId) return;
    const active = el.querySelector<HTMLElement>('[data-state="active"]');
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tabs, activeId, measure]);

  if (tabs.length === 0) return null;

  return (
    <Tabs
      value={activeId ?? undefined}
      onValueChange={onActivate}
      className="flex shrink-0 items-stretch gap-0 border-b border-line bg-surface"
    >
      <div className="flex min-w-0 flex-1 items-center">
        {!scroll.atStart && (
          <Button
            type="button"
            variant="quiet"
            size="icon"
            onClick={() => nudge(-200)}
            aria-label="Scroll tabs left"
            className="size-7 shrink-0"
          >
            <ChevronLeft size={16} />
          </Button>
        )}
        <TabsList
          ref={scrollRef}
          aria-label="Open sessions"
          onScroll={onScroll}
          className="tab-strip-scroll min-h-0 min-w-0 flex-1 gap-1 overflow-x-auto px-1 py-1"
        >
          {tabs.map((tab) => {
            const active = tab.tabId === activeId;
            const Icon = tab.kind === "document" ? FileText : MessageSquare;
            return (
              <div
                key={tab.tabId}
                className={cn(
                  "group relative flex shrink-0 items-center rounded-[var(--radius-control)] transition-colors duration-100",
                  active ? "bg-hover-2" : "hover:bg-hover",
                )}
              >
                <TabsTrigger
                  value={tab.tabId}
                  className="max-w-[200px] gap-1.5 truncate py-1.5 pl-2.5 pr-1 data-[state=active]:bg-transparent"
                >
                  <Icon size={13} className="shrink-0 text-ink-3" aria-hidden />
                  <span className="truncate">{tab.title}</span>
                </TabsTrigger>
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  onClick={() => onClose(tab.tabId)}
                  aria-label={`Close ${tab.title}`}
                  className={cn(
                    "mr-1 size-5 rounded-[4px] text-ink-3 hover:bg-line-strong hover:text-ink",
                    active
                      ? "opacity-100"
                      : "opacity-100 group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
                  )}
                >
                  <X size={12} />
                </Button>
              </div>
            );
          })}
        </TabsList>
        {!scroll.atEnd && (
          <Button
            type="button"
            variant="quiet"
            size="icon"
            onClick={() => nudge(200)}
            aria-label="Scroll tabs right"
            className="size-7 shrink-0"
          >
            <ChevronRight size={16} />
          </Button>
        )}
      </div>
    </Tabs>
  );
}
