import { AppSidebar } from "@/components/app-sidebar"
import { AsnsManager } from "@/components/asns/asns-manager"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function AsnsPage() {
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
        <SiteHeader title="ASN" />
        <AsnsManager />
      </SidebarInset>
    </SidebarProvider>
  )
}
