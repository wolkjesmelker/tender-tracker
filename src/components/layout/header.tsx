'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ROUTE_LABELS: Record<string, string> = {
  '': 'Dashboard',
  analyse: 'Analyse',
  aanbestedingen: 'Aanbestedingen',
  criteria: 'Criteria',
  bronnen: 'Bronnen',
  'ai-prompts': 'AI Prompts',
};

function useBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  const crumbs = [{ label: 'Dashboard', href: '/' }];

  segments.forEach((seg, idx) => {
    const href = '/' + segments.slice(0, idx + 1).join('/');
    const label = ROUTE_LABELS[seg] ?? seg;
    crumbs.push({ label, href });
  });

  return crumbs;
}

export function Header() {
  const crumbs = useBreadcrumbs();

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />

      <Breadcrumb className="flex-1">
        <BreadcrumbList>
          {crumbs.map((crumb, idx) => (
            <span key={crumb.href} className="flex items-center gap-1.5">
              {idx < crumbs.length - 1 ? (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink render={<Link href={crumb.href} />}>
                      {crumb.label}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </>
              ) : (
                <BreadcrumbItem>
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                </BreadcrumbItem>
              )}
            </span>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-4" />
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-blue-600" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger render={<button className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted" />}>
            <Avatar className="size-8">
              <AvatarFallback className="bg-blue-600 text-white text-xs font-semibold">
                TT
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Mijn account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Instellingen</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">Uitloggen</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
