'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from './status-badge';
import { Aanbesteding, AanbestedingStatus, STATUS_LABELS } from '@/types';
import { formatDate } from '@/lib/utils';
import {
  MoreHorizontal,
  ExternalLink,
  Pencil,
  Trash2,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';

type SortKey = 'titel' | 'opdrachtgever' | 'sluitingsdatum' | 'totaal_score' | 'status';
type SortDir = 'asc' | 'desc';

interface TenderTableProps {
  data: Aanbesteding[];
  onDelete?: (id: string) => void;
}

export function TenderTable({ data, onDelete }: TenderTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AanbestedingStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('sluitingsdatum');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = data
    .filter((item) => {
      const matchesSearch =
        item.titel.toLowerCase().includes(search.toLowerCase()) ||
        (item.opdrachtgever ?? '').toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortKey === 'titel') comparison = a.titel.localeCompare(b.titel);
      else if (sortKey === 'opdrachtgever')
        comparison = (a.opdrachtgever ?? '').localeCompare(b.opdrachtgever ?? '');
      else if (sortKey === 'sluitingsdatum')
        comparison =
          (a.sluitingsdatum ?? '').localeCompare(b.sluitingsdatum ?? '');
      else if (sortKey === 'totaal_score')
        comparison = (a.totaal_score ?? 0) - (b.totaal_score ?? 0);
      else if (sortKey === 'status')
        comparison = a.status.localeCompare(b.status);
      return sortDir === 'asc' ? comparison : -comparison;
    });

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column)
      return <ArrowUpDown className="ml-1 inline size-3 opacity-40" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="ml-1 inline size-3" />
    ) : (
      <ArrowDown className="ml-1 inline size-3" />
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Zoeken op titel of opdrachtgever…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as AanbestedingStatus | 'all')}
        >
          <SelectTrigger className="w-44">
            <SlidersHorizontal className="mr-2 size-3.5 text-muted-foreground" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            {(Object.keys(STATUS_LABELS) as AanbestedingStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="ml-auto">
          {filtered.length} resultaten
        </Badge>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => handleSort('titel')}
              >
                Titel <SortIcon column="titel" />
              </TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => handleSort('opdrachtgever')}
              >
                Opdrachtgever <SortIcon column="opdrachtgever" />
              </TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => handleSort('status')}
              >
                Status <SortIcon column="status" />
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => handleSort('sluitingsdatum')}
              >
                Sluitingsdatum <SortIcon column="sluitingsdatum" />
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => handleSort('totaal_score')}
              >
                Score <SortIcon column="totaal_score" />
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  Geen aanbestedingen gevonden
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => {
                const daysLeft = item.sluitingsdatum
                  ? Math.ceil(
                      (new Date(item.sluitingsdatum).getTime() - Date.now()) / 86400000
                    )
                  : null;

                return (
                  <TableRow key={item.id} className="group">
                    <TableCell className="font-medium">
                      <Link
                        href={`/aanbestedingen/${item.id}`}
                        className="hover:underline"
                      >
                        {item.titel}
                      </Link>
                      {item.is_upload && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Upload
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.opdrachtgever ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-sm">{formatDate(item.sluitingsdatum)}</span>
                        {daysLeft !== null && (
                          <span
                            className={`text-xs ${
                              daysLeft < 0
                                ? 'text-muted-foreground'
                                : daysLeft <= 7
                                ? 'font-medium text-red-600'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {daysLeft < 0
                              ? `${Math.abs(daysLeft)}d geleden`
                              : `${daysLeft}d resterend`}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.totaal_score !== undefined && item.totaal_score !== null ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm font-semibold">
                            {item.totaal_score}
                          </span>
                          <Progress
                            value={item.totaal_score}
                            className="h-1 w-16"
                          />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<button className="size-7 inline-flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 hover:bg-muted" />}
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem render={<Link href={`/aanbestedingen/${item.id}`} />}>
                            <Pencil className="mr-2 size-3.5" />
                            Bekijk detail
                          </DropdownMenuItem>
                          {item.bron_url && (
                            <DropdownMenuItem
                              render={<a href={item.bron_url} target="_blank" rel="noopener noreferrer" />}
                            >
                              <ExternalLink className="mr-2 size-3.5" />
                              Open bron
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onDelete?.(item.id)}
                          >
                            <Trash2 className="mr-2 size-3.5" />
                            Verwijderen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
