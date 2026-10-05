import { AppSidebar } from "@/components/app-sidebar"
import { MaintainersManager } from "@/components/maintainers/maintainers-manager"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function MaintainersPage() {
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
        <SiteHeader title="维护者" />
        <MaintainersManager />
      </SidebarInset>
    </SidebarProvider>
  )
}
