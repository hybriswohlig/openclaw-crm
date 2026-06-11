"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileTopBar } from "@/components/layout/mobile-top-bar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { CommandPalette } from "@/components/layout/command-palette";
import { ApprovalGate } from "@/components/layout/approval-gate";
import { WhatsappStatusBanner } from "@/components/layout/whatsapp-status-banner";
import { PushPromptBanner } from "@/components/pwa/push-prompt-banner";
import { BackgroundJobsProvider } from "@/components/background-jobs";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <ApprovalGate>
      <BackgroundJobsProvider>
        <div className="flex h-screen overflow-hidden">
          {/* Mobile overlay (drawer for the full sidebar when "menu" tapped) */}
          {mobileNavOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
              onClick={() => setMobileNavOpen(false)}
            />
          )}

          {/* Sidebar — desktop static, mobile slide-in drawer */}
          <div
            className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${
              mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
            }`}
          >
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>

          {/* Main content */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <MobileTopBar onMenuClick={() => setMobileNavOpen(true)} />
            <WhatsappStatusBanner />
            <PushPromptBanner />
            <main className="flex-1 overflow-auto pb-[calc(env(safe-area-inset-bottom)+76px)] md:pb-0">
              {children}
            </main>
          </div>

          <MobileTabBar />
          <CommandPalette />
        </div>
      </BackgroundJobsProvider>
    </ApprovalGate>
  );
}
