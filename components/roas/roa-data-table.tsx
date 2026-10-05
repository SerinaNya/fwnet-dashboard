"use client"

import { useState } from "react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  type Column,
  type ColumnFiltersState,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Plus, Trash2 } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AsnRecord, Maintainer, RoaRecord } from "@/lib/network-data"

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
})

const columnHelper = createColumnHelper<typeof features, RoaRecord>()

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`
}

function location(record: RoaRecord) {
  if (record.countryCode && record.subdivisionCode) {
    return `${record.countryCode}-${record.subdivisionCode}`
  }
  return record.countryCode
}

function canEditAsn(record: AsnRecord, maintainers: Maintainer[]) {
  return record.maintainerUuids.some((uuid) =>
    maintainers.some((maintainer) => maintainer.uuid === uuid && maintainer.canEdit)
  )
}

export function RoaDataTable({
  data,
  asns,
  maintainers,
  isAdmin,
  onCreate,
  onEdit,
  onDelete,
}: {
  data: RoaRecord[]
  asns: AsnRecord[]
  maintainers: Maintainer[]
  isAdmin: boolean
  onCreate: () => void
  onEdit: (record: RoaRecord) => void
  onDelete: (record: RoaRecord) => void
}) {
  const [family, setFamily] = useState<"all" | "ipv4" | "ipv6">("all")
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [query, setQuery] = useState("")
  const asnByNumber = new Map(asns.map((asn) => [asn.asn, asn] as const))
  const familyData = data.filter((record) => {
    if (family === "all") return true
    const address = record.route.split("/")[0]
    return family === "ipv6" ? address.includes(":") : !address.includes(":")
  })

  const columns = columnHelper.columns([
    columnHelper.accessor("route", {
      header: ({ column }) => <SortableHeader column={column} label="路由" />,
      cell: ({ row }) => (
        <span className="block truncate font-mono text-xs font-semibold" title={row.original.route}>
          {row.original.route}
        </span>
      ),
      filterFn: (row, _columnId, value) => {
        const filter = String(value ?? "").trim().replace(/^as\s*/i, "").toLowerCase()
        return filter === "" ||
          row.original.route.toLowerCase().includes(filter) ||
          (row.original.asn !== null && String(row.original.asn).includes(filter))
      },
    }),
    columnHelper.accessor("maxLength", {
      header: ({ column }) => <SortableHeader column={column} label="最大长度" />,
      cell: ({ row }) => <span className="font-mono">{row.original.maxLength}</span>,
    }),
    columnHelper.accessor("asn", {
      header: ({ column }) => <SortableHeader column={column} label="ASN" />,
      cell: ({ row }) => row.original.asn === null
        ? ""
        : <span className="font-mono">{row.original.asn}</span>,
    }),
    columnHelper.accessor("descr", {
      header: "描述",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="line-clamp-2 whitespace-normal break-words" title={row.original.descr || undefined}>
          {row.original.descr}
        </div>
      ),
    }),
    columnHelper.accessor("remark", {
      header: "备注",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="line-clamp-2 whitespace-normal break-words" title={row.original.remark || undefined}>
          {row.original.remark}
        </div>
      ),
    }),
    columnHelper.accessor((record) => location(record), {
      id: "location",
      header: "地区代码",
      enableSorting: false,
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span>,
    }),
    columnHelper.accessor((record) => new Date(record.updatedAt).getTime(), {
      id: "updatedAt",
      header: ({ column }) => <SortableHeader column={column} label="最后更新（UTC）" />,
      cell: ({ row }) => (
        <time className="font-mono text-xs" dateTime={row.original.updatedAt}>
          {formatUpdatedAt(row.original.updatedAt)}
        </time>
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">操作</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const originalAsn = row.original.asn === null
          ? undefined
          : asnByNumber.get(row.original.asn)
        const editable = isAdmin || Boolean(originalAsn && canEditAsn(originalAsn, maintainers))
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
                          aria-label={`编辑 ROA ${row.original.route}`}
                          onClick={() => onEdit(row.original)}
                        >
                          <Pencil />
                        </Button>
                      }
                    />
                    <TooltipContent>编辑 ROA</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          aria-label={`删除 ROA ${row.original.route}`}
                          onClick={() => onDelete(row.original)}
                        >
                          <Trash2 />
                        </Button>
                      }
                    />
                    <TooltipContent>删除 ROA</TooltipContent>
                  </Tooltip>
                </>
              </TooltipProvider>
            )}
          </div>
        )
      },
    }),
  ])

  const table = useTable({
    features,
    data: familyData,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnFilters },
  })

  const rowCount = table.getFilteredRowModel().rows.length

  return (
    <Tabs
      value={family}
      onValueChange={(value) => setFamily(value as typeof family)}
      className="flex w-full flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-auto sm:max-w-sm sm:flex-1">
          <label htmlFor="roa-search" className="sr-only">按路由或 ASN 搜索</label>
          <Input
            id="roa-search"
            type="search"
            placeholder="按路由或 ASN 搜索…"
            value={query}
            onChange={(event) => {
              const value = event.target.value
              setQuery(value)
              table.getColumn("route")?.setFilterValue(value || undefined)
            }}
          />
        </div>
        <TabsList aria-label="IP 地址族" className="max-w-full shrink-0">
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="ipv4">IPv4</TabsTrigger>
          <TabsTrigger value="ipv6">IPv6</TabsTrigger>
        </TabsList>
        {(isAdmin || asns.some((asn) => canEditAsn(asn, maintainers))) && (
          <Button type="button" className="ml-auto" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            新增 ROA
          </Button>
        )}
      </div>

      <TabsContent value={family} className="mt-0 min-w-0">
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-md border">
            <Table className="min-w-[1112px] table-fixed">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} colSpan={header.colSpan} className={columnWidths[header.id]}>
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length > 0 ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(row.original.asn === null && "bg-muted/50 hover:bg-muted/70")}
                    >
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
      </TabsContent>
    </Tabs>
  )
}

function SortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<typeof features, RoaRecord, TValue>
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
  route: "w-[180px]",
  maxLength: "w-[100px]",
  asn: "w-[100px]",
  descr: "w-[195px]",
  remark: "w-[195px]",
  location: "w-[120px]",
  updatedAt: "w-[150px]",
  actions: "w-[72px]",
}
