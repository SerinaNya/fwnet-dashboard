"use client"

import { useState, useSyncExternalStore } from "react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  type ColumnFiltersState,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Column,
  type SortingState,
} from "@tanstack/react-table"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Maintainer, AsnRecord } from "@/lib/network-data"

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
})

const columnHelper = createColumnHelper<typeof features, AsnRecord>()

const subscribeToHydration = () => () => {}
const getClientHydration = () => true
const getServerHydration = () => false

function formatUpdatedAt(value: number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

function isoDateTime(value: number) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString()
}

function formatLocalUpdatedAt(value: number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fullLocalDateTime(value: number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })
}

function geographicLocation(record: AsnRecord) {
  if (record.countryCode && record.subdivisionCode) {
    return `${record.countryCode}-${record.subdivisionCode}`
  }
  return record.countryCode
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

export function AsnDataTable({
  data,
  maintainers,
  onEdit,
  onCreate,
  onDelete,
}: {
  data: AsnRecord[]
  maintainers: Maintainer[]
  onEdit: (record: AsnRecord) => void
  onCreate?: () => void
  onDelete: (record: AsnRecord) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [asnQuery, setAsnQuery] = useState("")
  const hasHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydration,
    getServerHydration
  )
  const asnFilter = columnFilters.find((filter) => filter.id === "asn")?.value
  const rowCount = data.filter(
    (record) => asnFilter == null || String(record.asn).includes(String(asnFilter))
  ).length
  const maintainerByUuid = new Map(
    maintainers.map((maintainer) => [maintainer.uuid, maintainer] as const)
  )

  const columns = columnHelper.columns([
    columnHelper.accessor("asn", {
      header: ({ column }) => (
        <SortableHeader column={column} label="ASN" />
      ),
      cell: ({ row }) => (
        <span className="font-mono font-medium">{row.original.asn}</span>
      ),
      filterFn: (row, _columnId, filterValue) =>
        String(row.original.asn).includes(String(filterValue ?? "")),
      enableHiding: false,
    }),
    columnHelper.accessor("maintainerUuids", {
      header: "维护者",
      enableSorting: false,
      cell: ({ row }) => {
        const linkedMaintainers = row.original.maintainerUuids
          .map((uuid) => maintainerByUuid.get(uuid))
          .filter((maintainer) => maintainer !== undefined)

        if (linkedMaintainers.length === 0) {
          return row.original.maintainerUuids.length === 0 ? "" : "未知维护者"
        }

        return (
          <ItemGroup
            aria-label={`ASN ${row.original.asn} 的维护者`}
            className="gap-1"
          >
            {linkedMaintainers.map((maintainer) => (
              <Item
                key={maintainer.uuid}
                role="listitem"
                size="xs"
                className="min-w-0 flex-nowrap gap-2 border-0 p-0"
              >
                <ItemMedia variant="image">
                  <Avatar size="sm" aria-hidden="true">
                    <AvatarFallback>{getInitials(maintainer.name) || "?"}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle
                    className="block min-w-0 max-w-full truncate"
                    title={maintainer.name}
                  >
                    {maintainer.name}
                  </ItemTitle>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )
      },
    }),
    columnHelper.accessor((record) => geographicLocation(record), {
      id: "location",
      header: "地理位置",
      enableSorting: false,
      cell: ({ getValue }) => (
        <div className="truncate" title={getValue()}>{getValue()}</div>
      ),
    }),
    columnHelper.accessor("descr", {
      header: "描述",
      enableSorting: false,
      cell: ({ row }) => (
        <div
          className="line-clamp-2 whitespace-normal break-words"
          title={row.original.descr || undefined}
        >
          {row.original.descr}
        </div>
      ),
    }),
    columnHelper.accessor("remark", {
      header: "备注",
      enableSorting: false,
      cell: ({ row }) => (
        <div
          className="line-clamp-2 whitespace-normal break-words"
          title={row.original.remark || undefined}
        >
          {row.original.remark}
        </div>
      ),
    }),
    columnHelper.accessor("updatedAt", {
      id: "updatedAt",
      header: ({ column }) => (
        <SortableHeader column={column} label="最后更新" />
      ),
      cell: ({ row }) => (
        <time
          className="font-mono text-xs"
          dateTime={isoDateTime(row.original.updatedAt)}
          title={hasHydrated ? fullLocalDateTime(row.original.updatedAt) || undefined : undefined}
        >
          {hasHydrated
            ? formatLocalUpdatedAt(row.original.updatedAt)
            : formatUpdatedAt(row.original.updatedAt)}
        </time>
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">操作</span>,
      cell: ({ row }) => {
        const editable = row.original.maintainerUuids.some(
          (uuid) => maintainerByUuid.get(uuid)?.canEdit
        )

        return (
          <div className="flex items-center justify-end gap-1">
            {editable && (
              <TooltipProvider>
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`编辑 ASN ${row.original.asn}`}
                          onClick={() => onEdit(row.original)}
                        >
                          <Pencil />
                        </Button>
                      }
                    />
                    <TooltipContent>编辑 ASN</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          aria-label={`删除 ASN ${row.original.asn}`}
                          onClick={() => onDelete(row.original)}
                        >
                          <Trash2 />
                        </Button>
                      }
                    />
                    <TooltipContent>删除 ASN</TooltipContent>
                  </Tooltip>
                </>
              </TooltipProvider>
            )}
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
    }),
  ])

  const table = useTable({
    features,
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnFilters },
  })

  const rows = table.getRowModel().rows

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-full sm:max-w-sm">
          <label htmlFor="asn-search" className="sr-only">按 ASN 搜索</label>
          <Input
            id="asn-search"
            type="search"
            placeholder="按 ASN 搜索…"
            value={asnQuery}
            onChange={(event) => {
              const value = event.target.value
              const query = value.trim().replace(/^as\s*/i, "")
              setAsnQuery(value)
              table.getColumn("asn")?.setFilterValue(query || undefined)
            }}
          />
        </div>
        {onCreate && maintainers.some((maintainer) => maintainer.canEdit) && (
          <Button type="button" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            新增 ASN
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-md border">
      <Table className="min-w-[1002px] table-fixed">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  colSpan={header.colSpan}
                  className={columnWidths[header.id]}
                >
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.id === "actions" ? "py-0" : undefined}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-muted-foreground">
                无匹配结果
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>

      <div className="flex justify-end text-sm text-muted-foreground">
        共 {rowCount} 条
      </div>
    </div>
  )
}

function SortableHeader({
  column,
  label,
}: {
  column: Column<typeof features, AsnRecord, number>
  label: string
}) {
  const sort = column.getIsSorted()
  const nextDirection = sort === "asc" ? "desc" : "asc"

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2 text-muted-foreground hover:text-foreground"
      aria-label={`按${label}排序（${nextDirection === "asc" ? "升序" : "降序"}）`}
      onClick={() => column.toggleSorting(sort === "asc")}
    >
      {label}
      {sort === "asc" ? <ArrowUp /> : sort === "desc" ? <ArrowDown /> : <ArrowUpDown />}
    </Button>
  )
}

const columnWidths: Record<string, string> = {
  asn: "w-[120px]",
  maintainerUuids: "w-[155px]",
  location: "w-[120px]",
  descr: "w-[190px]",
  remark: "w-[190px]",
  updatedAt: "w-[155px]",
  actions: "w-[72px]",
}
