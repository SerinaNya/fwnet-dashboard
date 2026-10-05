"use client"

import { useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Pencil, X } from "lucide-react"
import { useNetworkData } from "@/components/network-data-provider"
import type { Maintainer } from "@/lib/network-data"

import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type MaintainerDraft = Pick<Maintainer, "name" | "remark" | "source">

const emptyDraft: MaintainerDraft = { name: "", remark: "", source: "fwnet" }

export function MaintainersManager() {
  const { maintainers, saveMaintainer, isAdmin, loading, loadError, retry } = useNetworkData()
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [draft, setDraft] = useState<MaintainerDraft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const editingRecord = maintainers.find((record) => record.uuid === editingUuid)

  const beginEdit = (record: Maintainer) => {
    setEditingUuid(record.uuid)
    setSaveError(null)
    setDraft({
      name: record.name,
      remark: record.remark,
      source: record.source,
    })
  }

  const closeEditor = () => {
    if (saving) return
    setEditingUuid(null)
    setDraft(emptyDraft)
    setSaveError(null)
  }

  const saveEdit = async () => {
    if (!editingRecord || saving) return
    setSaving(true)
    setSaveError(null)
    const error = await saveMaintainer({
      ...editingRecord,
      name: editingRecord.canEdit ? draft.name : editingRecord.name,
      remark: editingRecord.canEdit ? draft.remark : editingRecord.remark,
      source: isAdmin ? draft.source : editingRecord.source,
    })
    setSaving(false)
    if (error) {
      setSaveError(error)
      return
    }
    setEditingUuid(null)
    setDraft(emptyDraft)
  }

  const renderMaintainer = (record: Maintainer) => {
    const canOpenEditor = record.canEdit || isAdmin
    const initials = record.name
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()

    return (
      <Item key={record.uuid} size="sm" className="items-start">
        <ItemMedia variant="image">
          <Avatar size="sm" aria-label={record.name}>
            <AvatarFallback>{initials || "?"}</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1">
          <ItemTitle className="max-w-full flex-wrap break-words text-base font-semibold">
            {record.name}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {record.source}
            </span>
          </ItemTitle>
          {record.remark && (
            <ItemDescription className="whitespace-pre-wrap break-words">
              {record.remark}
            </ItemDescription>
          )}
        </ItemContent>
        {canOpenEditor && (
          <ItemActions>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`编辑 ${record.name}`}
                      onClick={() => beginEdit(record)}
                    >
                      <Pencil />
                    </Button>
                  }
                />
                <TooltipContent>编辑维护者</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </ItemActions>
        )}
      </Item>
    )
  }

  const mine = maintainers.filter((record) => record.isMine)

  if (loading) {
    return (
      <main className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 text-sm text-muted-foreground md:px-6 md:py-8">
          正在加载网络数据…
        </div>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 px-4 py-6 md:px-6 md:py-8">
          <p role="alert" className="text-sm text-destructive">{loadError}</p>
          <Button type="button" variant="outline" onClick={retry}>重试</Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
        <section className="flex flex-col gap-3" aria-labelledby="mine-heading">
          <h2 id="mine-heading" className="text-lg font-semibold">我</h2>
          <ItemGroup className="gap-2">
            {mine.map(renderMaintainer)}
          </ItemGroup>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="all-heading">
          <h2 id="all-heading" className="text-lg font-semibold">所有维护者</h2>
          <ItemGroup className="gap-2">
            {maintainers.map(renderMaintainer)}
          </ItemGroup>
        </section>
      </div>

      <Dialog.Root
        open={editingRecord !== undefined}
        onOpenChange={(open) => !open && !saving && closeEditor()}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-lg font-semibold">编辑维护者</Dialog.Title>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="maintainer-name">名称</Label>
                <Input
                  id="maintainer-name"
                  autoFocus
                  disabled={saving || !editingRecord?.canEdit}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      saveEdit()
                    }
                  }}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="maintainer-remark">备注</Label>
                <textarea
                  id="maintainer-remark"
                  disabled={saving || !editingRecord?.canEdit}
                  value={draft.remark}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, remark: event.target.value }))
                  }
                  rows={5}
                  className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="maintainer-source">来源</Label>
                {isAdmin ? (
                  <Select
                    value={draft.source}
                    disabled={saving}
                    onValueChange={(value) =>
                      value && setDraft((current) => ({ ...current, source: value }))
                    }
                  >
                    <SelectTrigger id="maintainer-source" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="fwnet">fwnet</SelectItem>
                        <SelectItem value="community">community</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input id="maintainer-source" value={draft.source} readOnly disabled={saving} />
                )}
              </div>
            </div>

            {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeEditor} disabled={saving}>
                <X data-icon="inline-start" />取消
              </Button>
              <Button type="button" onClick={saveEdit} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  )
}
