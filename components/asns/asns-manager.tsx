"use client"

import { useState } from "react"

import { AsnDataTable } from "@/components/asns/asn-data-table"
import { useNetworkData } from "@/components/network-data-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
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
import type { AsnRecord } from "@/lib/network-data"

type AsnDraft = Pick<
  AsnRecord,
  "maintainerUuids" | "descr" | "remark"
> & { regionCode: string }

type FormErrors = Partial<Record<keyof AsnDraft | "asn" | "general", string>>

const blankDraft: AsnDraft = {
  maintainerUuids: [],
  regionCode: "",
  descr: "",
  remark: "",
}

function getInitials(name: string) {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export function AsnsManager() {
  const { asns, maintainers, saveAsn, createAsn, deleteAsn, loading, loadError, retry } = useNetworkData()
  const [editingAsn, setEditingAsn] = useState<AsnRecord | null>(null)
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null)
  const [draftAsn, setDraftAsn] = useState("")
  const [draft, setDraft] = useState<AsnDraft>(blankDraft)
  const [errors, setErrors] = useState<FormErrors>({})
  const [deletingAsn, setDeletingAsn] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const openEditor = (record: AsnRecord) => {
    setFormMode("edit")
    setEditingAsn(record)
    setDraftAsn(String(record.asn))
    setDraft({
      maintainerUuids: [...record.maintainerUuids],
      regionCode: record.subdivisionCode
        ? `${record.countryCode}-${record.subdivisionCode}`
        : record.countryCode,
      descr: record.descr,
      remark: record.remark,
    })
    setErrors({})
  }

  const openCreator = () => {
    const currentMaintainer = maintainers.find(
      (maintainer) => maintainer.isMine && maintainer.canEdit
    )
    setFormMode("create")
    setEditingAsn(null)
    setDraftAsn("")
    setDraft({
      ...blankDraft,
      maintainerUuids: currentMaintainer ? [currentMaintainer.uuid] : [],
    })
    setErrors({})
  }

  const closeEditor = () => {
    if (saving) return
    setFormMode(null)
    setEditingAsn(null)
    setDraftAsn("")
    setDraft(blankDraft)
    setErrors({})
  }

  const updateDraft = <K extends keyof AsnDraft>(key: K, value: AsnDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined, general: undefined }))
  }

  const save = async () => {
    if (!formMode || saving) return

    const nextErrors: FormErrors = {}
    const asn = Number(draftAsn)
    if (
      formMode === "create" &&
      (!Number.isInteger(asn) || asn < 1 || asn > 4_294_967_295)
    ) {
      nextErrors.asn = "ASN 必须是 1 到 4294967295 之间的整数。"
    }
    if (draft.maintainerUuids.length === 0) {
      nextErrors.maintainerUuids = "至少选择一位维护者。"
    }
    const regionCode = draft.regionCode.trim().toUpperCase()
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
    const editableFields = {
      maintainerUuids: draft.maintainerUuids,
      countryCode,
      subdivisionCode,
      descr: draft.descr,
      remark: draft.remark,
    }
    setSaving(true)
    setErrors({})
    const message = await (formMode === "create"
      ? createAsn({
          asn,
          ...editableFields,
          updatedAt: Date.now(),
        })
      : editingAsn
        ? saveAsn({ ...editingAsn, ...editableFields })
        : Promise.resolve("找不到要编辑的 ASN 记录。"))
    setSaving(false)
    if (message) {
      setErrors({ general: message })
      return
    }

    closeEditor()
  }

  const confirmDelete = async () => {
    if (deletingAsn === null || deleting) return
    setDeleting(true)
    const message = await deleteAsn(deletingAsn)
    setDeleting(false)
    if (message) {
      setDeleteError(message)
      return
    }
    setDeletingAsn(null)
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
        <AsnDataTable
          data={asns}
          maintainers={maintainers}
          onEdit={openEditor}
          onCreate={openCreator}
          onDelete={(record) => {
            setDeletingAsn(record.asn)
            setDeleteError(null)
          }}
        />
      </div>

      <Dialog
        open={formMode !== null}
        onOpenChange={(open) => !open && !saving && closeEditor()}
      >
        <DialogContent showCloseButton={!saving} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {formMode === "create" ? "新增 ASN" : `编辑 ASN ${editingAsn?.asn}`}
            </DialogTitle>
            {formMode === "edit" && (
              <DialogDescription>更新 ASN 的维护者关联与信息。</DialogDescription>
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
              {formMode === "create" && (
                <Field data-invalid={Boolean(errors.asn)}>
                  <FieldLabel htmlFor="asn-number">ASN</FieldLabel>
                  <Input
                    id="asn-number"
                    type="number"
                    min={1}
                    max={4_294_967_295}
                    step={1}
                    autoFocus
                    disabled={saving}
                    value={draftAsn}
                    aria-invalid={Boolean(errors.asn)}
                    onChange={(event) => {
                      setDraftAsn(event.target.value)
                      setErrors((current) => ({ ...current, asn: undefined, general: undefined }))
                    }}
                  />
                  {errors.asn && <FieldError>{errors.asn}</FieldError>}
                </Field>
              )}

              <Field data-invalid={Boolean(errors.maintainerUuids)}>
                <FieldLabel htmlFor="asn-maintainers">维护者</FieldLabel>
                <Combobox
                  items={maintainers.map((maintainer) => maintainer.uuid)}
                  multiple
                  disabled={saving}
                  value={draft.maintainerUuids}
                  onValueChange={(value) => updateDraft("maintainerUuids", value)}
                  itemToStringLabel={(uuid) =>
                    maintainers.find((maintainer) => maintainer.uuid === uuid)?.name ?? ""
                  }
                  itemToStringValue={(uuid) =>
                    maintainers.find((maintainer) => maintainer.uuid === uuid)?.name ?? ""
                  }
                  filter={(uuid, query) => {
                    if (query === "") return true
                    const name = maintainers.find(
                      (maintainer) => maintainer.uuid === uuid
                    )?.name
                    return name?.toLowerCase().includes(query.toLowerCase()) ?? false
                  }}
                >
                  <ComboboxChips aria-invalid={Boolean(errors.maintainerUuids)}>
                    <ComboboxValue>
                      {(selectedUuids: string[]) => selectedUuids.map((uuid) => {
                        const name = maintainers.find(
                          (maintainer) => maintainer.uuid === uuid
                        )?.name ?? "未知维护者"
                        return (
                          <ComboboxChip key={uuid}>
                            <Avatar size="sm" className="size-4 after:hidden" aria-hidden="true">
                              <AvatarFallback>{getInitials(name) || "?"}</AvatarFallback>
                            </Avatar>
                            <span className="max-w-32 truncate" title={name}>{name}</span>
                          </ComboboxChip>
                        )
                      })}
                    </ComboboxValue>
                    <ComboboxChipsInput
                      id="asn-maintainers"
                      autoFocus={formMode === "edit"}
                      disabled={saving}
                      placeholder="选择维护者…"
                    />
                  </ComboboxChips>
                  <ComboboxContent>
                    <ComboboxEmpty>没有匹配的维护者。</ComboboxEmpty>
                    <ComboboxList>
                      {(uuid) => {
                        const maintainer = maintainers.find(
                          (item) => item.uuid === uuid
                        )
                        if (!maintainer) return null
                        return (
                          <ComboboxItem key={uuid} value={uuid}>
                            <Avatar size="sm" aria-hidden="true">
                              <AvatarFallback>{getInitials(maintainer.name) || "?"}</AvatarFallback>
                            </Avatar>
                            {maintainer.name}
                          </ComboboxItem>
                        )
                      }}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                {errors.maintainerUuids && <FieldError>{errors.maintainerUuids}</FieldError>}
              </Field>

              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
                <Field data-invalid={Boolean(errors.regionCode)}>
                  <FieldLabel htmlFor="asn-region">地区代码</FieldLabel>
                  <Input
                    id="asn-region"
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
                  <FieldLabel htmlFor="asn-description">描述</FieldLabel>
                  <Input
                    id="asn-description"
                    disabled={saving}
                    value={draft.descr}
                    onChange={(event) => updateDraft("descr", event.target.value)}
                  />
                </Field>
              </FieldGroup>

              <Field>
                <FieldLabel htmlFor="asn-remark">备注</FieldLabel>
                <Textarea
                  id="asn-remark"
                  rows={4}
                  disabled={saving}
                  className="font-mono"
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
        open={deletingAsn !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (deleting) return
            setDeletingAsn(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 ASN {deletingAsn}？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作会永久删除这条 ASN 记录。
            </AlertDialogDescription>
            {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} onClick={() => setDeleteError(null)}>
              取消
            </AlertDialogCancel>
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
