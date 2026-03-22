import { FileText, TrendingUp, Clock, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { StatusChart } from '@/components/dashboard/status-chart';
import { StatusBadge } from '@/components/aanbestedingen/status-badge';
import { buttonVariants } from '@/lib/button-variants';
import { formatDate } from '@/lib/utils';
import { createClient } from '@/lib/supabase/server';
import { AanbestedingStatus } from '@/types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: aanbestedingen = [] } = await supabase
    .from('aanbestedingen')
    .select('id, titel, opdrachtgever, sluitingsdatum, status, totaal_score')
    .order('updated_at', { ascending: false })
    .limit(50);

  const list = aanbestedingen ?? [];

  const statusCounts = list.reduce(
    (acc, item) => {
      const s = item.status as AanbestedingStatus;
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    {} as Record<AanbestedingStatus, number>
  );

  const totalAanbestedingen = list.length;
  const inAanbieding = statusCounts['in_aanbieding'] ?? 0;
  const gevonden = statusCounts['gevonden'] ?? 0;
  const urgentDeadline = list.filter((a) => {
    if (!a.sluitingsdatum) return false;
    const days = Math.ceil((new Date(a.sluitingsdatum).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 7;
  }).length;

  const recent = list.slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overzicht van uw aanbestedingspijplijn</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Totaal aanbestedingen"
          value={totalAanbestedingen}
          description="Alle aanbestedingen"
          icon={FileText}
          iconClassName="bg-blue-50 text-blue-600"
        />
        <KpiCard
          title="In aanbieding"
          value={inAanbieding}
          description="Actieve aanbiedingen"
          icon={TrendingUp}
          iconClassName="bg-green-50 text-green-600"
        />
        <KpiCard
          title="Nieuw gevonden"
          value={gevonden}
          description="Wachten op kwalificatie"
          icon={CheckCircle}
          iconClassName="bg-yellow-50 text-yellow-600"
        />
        <KpiCard
          title="Urgente deadlines"
          value={urgentDeadline}
          description="Sluitingsdatum binnen 7 dagen"
          icon={AlertCircle}
          iconClassName="bg-red-50 text-red-600"
        />
      </div>

      {/* Chart + Recent */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status verdeling</CardTitle>
            <CardDescription>Huidige pijplijn per status</CardDescription>
          </CardHeader>
          <CardContent>
            {totalAanbestedingen === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
                <FileText className="size-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Nog geen aanbestedingen</p>
              </div>
            ) : (
              <StatusChart
                data={{
                  gevonden: statusCounts['gevonden'] ?? 0,
                  gekwalificeerd: statusCounts['gekwalificeerd'] ?? 0,
                  in_aanbieding: statusCounts['in_aanbieding'] ?? 0,
                  afgewezen: statusCounts['afgewezen'] ?? 0,
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recente aanbestedingen</CardTitle>
              <CardDescription>Meest recent bijgewerkt</CardDescription>
            </div>
            <Link href="/aanbestedingen" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Alle bekijken
              <ArrowRight className="ml-1 size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <FileText className="size-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Nog geen aanbestedingen. Voeg er een toe om te beginnen.
                </p>
                <Link href="/aanbestedingen" className={buttonVariants({ size: 'sm' })}>
                  Aanbestedingen beheren
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recent.map((item) => {
                  const daysLeft = item.sluitingsdatum
                    ? Math.ceil(
                        (new Date(item.sluitingsdatum).getTime() - Date.now()) / 86400000
                      )
                    : null;
                  return (
                    <Link
                      key={item.id}
                      href={`/aanbestedingen/${item.id}`}
                      className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.titel}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.opdrachtgever ?? '—'}
                        </p>
                      </div>
                      <div className="ml-4 flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge status={item.status as AanbestedingStatus} />
                        {daysLeft !== null && (
                          <span
                            className={`text-xs ${
                              daysLeft < 0
                                ? 'text-muted-foreground line-through'
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
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming deadlines */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-4 text-orange-500" />
            Aankomende sluitingsdata
          </CardTitle>
          <CardDescription>Aanbestedingen met een deadline binnen 14 dagen</CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const upcoming = list
              .filter((a) => {
                if (!a.sluitingsdatum) return false;
                const days = Math.ceil(
                  (new Date(a.sluitingsdatum).getTime() - Date.now()) / 86400000
                );
                return days >= 0 && days <= 14;
              })
              .sort(
                (a, b) =>
                  new Date(a.sluitingsdatum!).getTime() -
                  new Date(b.sluitingsdatum!).getTime()
              );

            if (upcoming.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  Geen aankomende deadlines binnen 14 dagen
                </p>
              );
            }

            return (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {upcoming.map((item) => {
                  const days = Math.ceil(
                    (new Date(item.sluitingsdatum!).getTime() - Date.now()) / 86400000
                  );
                  return (
                    <Link
                      key={item.id}
                      href={`/aanbestedingen/${item.id}`}
                      className="rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-tight">{item.titel}</p>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                            days <= 3
                              ? 'bg-red-100 text-red-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}
                        >
                          {days}d
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(item.sluitingsdatum)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
