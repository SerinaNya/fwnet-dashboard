import { AppSidebar } from "@/components/app-sidebar"
import { RoasManager } from "@/components/roas/roas-manager"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function RoasPage() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader title="ROA" />
        <RoasManager />
      </SidebarInset>
    </SidebarProvider>
  )
}
