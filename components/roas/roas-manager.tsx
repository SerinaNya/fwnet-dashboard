"use client"

import { useState } from "react"

import { RoaDataTable } from "@/components/roas/roa-data-table"
import { useNetworkData } from "@/components/network-data-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { AsnRecord, RoaRecord } from "@/lib/network-data"

type RoaDraft = {
  route: string
  maxLength: string
  asn: number | null
  regionCode: string
  descr: string
  remark: string
}

type RoaErrors = Partial<Record<keyof RoaDraft | "general", string>>

const emptyDraft: RoaDraft = {
  route: "",
  maxLength: "",
  asn: null,
  regionCode: "",
  descr: "",
  remark: "",
}

function location(record: RoaRecord) {
  if (record.countryCode && record.subdivisionCode) {
    return `${record.countryCode}-${record.subdivisionCode}`
  }
  return record.countryCode || ""
}

function canEditAsn(record: AsnRecord, maintainers: ReturnType<typeof useNetworkData>["maintainers"]) {
  return record.maintainerUuids.some((uuid) =>
    maintainers.some((maintainer) => maintainer.uuid === uuid && maintainer.canEdit)
  )
}

function prefixLength(route: string) {
  const match = /\/(\d{1,3})$/.exec(route.trim())
  return match ? match[1] : ""
}

export function RoasManager() {
  const {
    roas,
    asns,
    maintainers,
    createRoa,
    saveRoa,
    deleteRoa,
    isAdmin,
    loading,
    loadError,
    retry,
  } = useNetworkData()
  const [mode, setMode] = useState<"create" | "edit" | null>(null)
  const [editingRoa, setEditingRoa] = useState<RoaRecord | null>(null)
  const [draft, setDraft] = useState<RoaDraft>(emptyDraft)
  const [errors, setErrors] = useState<RoaErrors>({})
  const [maxLengthEdited, setMaxLengthEdited] = useState(false)
  const [deletingRoa, setDeletingRoa] = useState<RoaRecord | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const editableAsns = isAdmin
    ? asns
    : asns.filter((record) => canEditAsn(record, maintainers))

  const openCreate = () => {
    setMode("create")
    setEditingRoa(null)
    setDraft({ ...emptyDraft, asn: editableAsns[0]?.asn ?? null })
    setErrors({})
    setMaxLengthEdited(false)
  }

  const openEdit = (record: RoaRecord) => {
    setMode("edit")
    setEditingRoa(record)
    setDraft({
      route: record.route,
      maxLength: String(record.maxLength),
      asn: record.asn,
      regionCode: location(record),
      descr: record.descr,
      remark: record.remark,
    })
    setErrors({})
    setMaxLengthEdited(true)
  }

  const closeEditor = () => {
    setMode(null)
    setEditingRoa(null)
    setDraft(emptyDraft)
    setErrors({})
    setMaxLengthEdited(false)
  }

  const updateDraft = <K extends keyof RoaDraft>(key: K, value: RoaDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined, general: undefined }))
  }

  const save = async () => {
    if (!mode || saving) return

    const nextErrors: RoaErrors = {}
    const maxLength = Number(draft.maxLength)
    const regionCode = draft.regionCode.trim().toUpperCase()

    if (!draft.route.trim()) nextErrors.route = "请输入路由 CIDR。"
    if (
      (draft.asn === null && !isAdmin) ||
      (draft.asn !== null && !editableAsns.some((asn) => asn.asn === draft.asn))
    ) {
      nextErrors.asn = "请选择有编辑权限的 ASN。"
    }
    if (
      !/^\d+$/.test(draft.maxLength.trim()) ||
      !Number.isInteger(maxLength) ||
      maxLength < 0 ||
      maxLength > 128
    ) {
      nextErrors.maxLength = "最大长度必须是 0 到 128 之间的整数。"
    }
    if (!/^(?:[A-Z]{2}(?:-[A-Z0-9]{1,3})?)?$/.test(regionCode)) {
      nextErrors.regionCode = "请输入有效地区代码，例如 CN 或 CN-SH。"
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    const [countryCode = "", subdivisionCode = ""] = regionCode
      ? regionCode.split("-")
      : []
    const fields = {
      route: draft.route.trim(),
      maxLength,
      asn: draft.asn,
      descr: draft.descr,
      remark: draft.remark,
      countryCode,
      subdivisionCode,
    }
    setSaving(true)
    setErrors({})
    const message = await (mode === "create"
      ? createRoa({
          uuid: crypto.randomUUID(),
          ...fields,
          updatedAt: Date.now(),
        })
      : editingRoa
        ? saveRoa({ ...editingRoa, ...fields })
        : Promise.resolve("找不到要编辑的 ROA 记录。"))

    setSaving(false)
    if (message) {
      setErrors({ general: message })
      return
    }
    closeEditor()
  }

  const confirmDelete = async () => {
    if (!deletingRoa || deleting) return
    setDeleting(true)
    const message = await deleteRoa(deletingRoa.uuid)
    setDeleting(false)
    if (message) {
      setDeleteError(message)
      return
    }
    setDeletingRoa(null)
    setDeleteError(null)
  }

  if (loading) {
    return (
      <main className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 text-sm text-muted-foreground md:px-6 md:py-8">
          正在加载网络数据…
        </div>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-start gap-3 px-4 py-6 md:px-6 md:py-8">
          <p role="alert" className="text-sm text-destructive">{loadError}</p>
          <Button type="button" variant="outline" onClick={retry}>重试</Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-6 md:py-8">
        <RoaDataTable
          data={roas}
          asns={asns}
          maintainers={maintainers}
          isAdmin={isAdmin}
          onCreate={openCreate}
          onEdit={openEdit}
          onDelete={(record) => {
            setDeletingRoa(record)
            setDeleteError(null)
          }}
        />
      </div>

      <Dialog open={mode !== null} onOpenChange={(open) => !open && !saving && closeEditor()}>
        <DialogContent showCloseButton={!saving} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "新增 ROA" : `编辑 ROA ${editingRoa?.route ?? ""}`}
            </DialogTitle>
            {mode === "edit" && (
              <DialogDescription>更新路由授权信息。</DialogDescription>
            )}
          </DialogHeader>

          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(errors.route)}>
                <FieldLabel htmlFor="roa-route">路由 CIDR</FieldLabel>
                <Input
                  id="roa-route"
                  autoFocus
                  disabled={saving}
                  placeholder="例如 203.0.113.0/24 或 2001:db8::/32"
                  value={draft.route}
                  aria-invalid={Boolean(errors.route)}
                  onChange={(event) => {
                    const route = event.target.value
                    setDraft((current) => ({
                      ...current,
                      route,
                      maxLength:
                        mode === "create" && !maxLengthEdited
                          ? prefixLength(route)
                          : current.maxLength,
                    }))
                    setErrors((current) => ({ ...current, route: undefined, maxLength: undefined, general: undefined }))
                  }}
                />
                {errors.route && <FieldError>{errors.route}</FieldError>}
              </Field>

              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
                <Field data-invalid={Boolean(errors.asn)}>
                  <FieldLabel htmlFor="roa-asn">ASN</FieldLabel>
                  <Combobox
                    items={editableAsns.map((record) => record.asn)}
                    autoHighlight
                    disabled={saving}
                    value={draft.asn}
                    onValueChange={(value) => updateDraft("asn", value)}
                    itemToStringLabel={(asn) => String(asn)}
                    itemToStringValue={(asn) => String(asn)}
                  >
                    <ComboboxInput
                      id="roa-asn"
                      className="w-full"
                      autoComplete="off"
                      disabled={saving}
                      placeholder="搜索并选择 ASN…"
                      aria-invalid={Boolean(errors.asn)}
                      showClear={isAdmin}
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>没有可选择的 ASN。</ComboboxEmpty>
                      <ComboboxList>
                        {(asn) => (
                          <ComboboxItem key={asn} value={asn}>
                            {asn}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  {errors.asn && <FieldError>{errors.asn}</FieldError>}
                </Field>

                <Field data-invalid={Boolean(errors.maxLength)}>
                  <FieldLabel htmlFor="roa-max-length">最大长度</FieldLabel>
                  <Input
                    id="roa-max-length"
                    type="text"
                    inputMode="numeric"
                    disabled={saving}
                    value={draft.maxLength}
                    aria-invalid={Boolean(errors.maxLength)}
                    onChange={(event) => {
                      setMaxLengthEdited(true)
                      updateDraft("maxLength", event.target.value)
                    }}
                  />
                  {errors.maxLength && <FieldError>{errors.maxLength}</FieldError>}
                </Field>
              </FieldGroup>

              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
                <Field data-invalid={Boolean(errors.regionCode)}>
                  <FieldLabel htmlFor="roa-region">地区代码</FieldLabel>
                  <Input
                    id="roa-region"
                    autoComplete="off"
                    disabled={saving}
                    placeholder="CN 或 CN-SH"
                    value={draft.regionCode}
                    aria-invalid={Boolean(errors.regionCode)}
                    onChange={(event) => updateDraft("regionCode", event.target.value)}
                  />
                  {errors.regionCode && <FieldError>{errors.regionCode}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="roa-description">描述</FieldLabel>
                  <Input
                    id="roa-description"
                    disabled={saving}
                    value={draft.descr}
                    onChange={(event) => updateDraft("descr", event.target.value)}
                  />
                </Field>
              </FieldGroup>

              <Field>
                <FieldLabel htmlFor="roa-remark">备注</FieldLabel>
                <Textarea
                  id="roa-remark"
                  rows={4}
                  className="font-mono"
                  disabled={saving}
                  value={draft.remark}
                  onChange={(event) => updateDraft("remark", event.target.value)}
                />
              </Field>
            </FieldGroup>

            {errors.general && <FieldError>{errors.general}</FieldError>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeEditor} disabled={saving}>取消</Button>
              <Button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingRoa !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (deleting) return
            setDeletingRoa(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 ROA？</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除路由 {deletingRoa?.route} 的 ROA 记录？
            </AlertDialogDescription>
            {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} onClick={() => setDeleteError(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                confirmDelete()
              }}
            >
              {deleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
