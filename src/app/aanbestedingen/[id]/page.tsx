import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ExternalLink,
  Calendar,
  Building,
  Tag,
  FileText,
  BrainCircuit,
  StickyNote,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/aanbestedingen/status-badge';
import { createClient } from '@/lib/supabase/server';
import { Aanbesteding, Criterium, AanbestedingStatus } from '@/types';
import { buttonVariants } from '@/lib/button-variants';
import { formatDate, formatDateTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TenderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: row }, { data: criteriaRows }] = await Promise.all([
    supabase.from('aanbestedingen').select('*').eq('id', id).single(),
    supabase.from('criteria').select('*').eq('is_actief', true).order('volgorde'),
  ]);

  if (!row) notFound();

  const item: Aanbesteding = {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    titel: row.titel,
    beschrijving: row.beschrijving ?? undefined,
    opdrachtgever: row.opdrachtgever ?? undefined,
    publicatiedatum: row.publicatiedatum ?? undefined,
    sluitingsdatum: row.sluitingsdatum ?? undefined,
    bron_url: row.bron_url ?? undefined,
    bron_website: row.bron_website ?? undefined,
    status: row.status as AanbestedingStatus,
    pre_kwalificatie_nummer: row.pre_kwalificatie_nummer ?? undefined,
    definitief_nummer: row.definitief_nummer ?? undefined,
    ruwe_tekst: row.ruwe_tekst ?? undefined,
    document_urls: row.document_urls ?? undefined,
    criteria_scores: (row.criteria_scores as Record<string, number>) ?? undefined,
    totaal_score: row.totaal_score ?? undefined,
    ai_samenvatting: row.ai_samenvatting ?? undefined,
    highlight_data: (row.highlight_data as Record<string, string[]>) ?? undefined,
    is_upload: row.is_upload,
    bestandsnaam: row.bestandsnaam ?? undefined,
    notities: row.notities ?? undefined,
  };

  const criteria: Criterium[] = (criteriaRows ?? []).map((c) => ({
    id: c.id,
    naam: c.naam,
    beschrijving: c.beschrijving ?? undefined,
    gewicht: Number(c.gewicht),
    is_actief: c.is_actief,
    volgorde: c.volgorde,
  }));

  const daysLeft = item.sluitingsdatum
    ? Math.ceil((new Date(item.sluitingsdatum).getTime() - Date.now()) / 86400000)
    : null;

  const weightedScore =
    item.criteria_scores && criteria.length > 0
      ? Math.round(
          criteria.reduce((acc, c) => {
            const score = item.criteria_scores?.[c.naam] ?? 0;
            return acc + (score * c.gewicht) / 100;
          }, 0)
        )
      : item.totaal_score;

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-start gap-4">
        <Link
          href="/aanbestedingen"
          className={buttonVariants({ variant: 'ghost', size: 'icon', className: '-mt-0.5' })}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">{item.titel}</h1>
            <StatusBadge status={item.status} />
            {item.is_upload && (
              <Badge variant="outline" className="text-xs">Upload</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Bijgewerkt {formatDateTime(item.updated_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {item.bron_url && (
            <a
              href={item.bron_url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ExternalLink className="mr-1.5 size-3.5" />
              Open bron
            </a>
          )}
          <Button size="sm">Aanbieding opstellen</Button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-4">
        {item.opdrachtgever && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building className="size-3.5" />
            <span>{item.opdrachtgever}</span>
          </div>
        )}
        {item.publicatiedatum && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="size-3.5" />
            <span>Gepubliceerd: {formatDate(item.publicatiedatum)}</span>
          </div>
        )}
        {item.sluitingsdatum && (
          <div
            className={`flex items-center gap-1.5 text-sm font-medium ${
              daysLeft !== null && daysLeft <= 7 ? 'text-red-600' : 'text-muted-foreground'
            }`}
          >
            <Calendar className="size-3.5" />
            <span>
              Sluitingsdatum: {formatDate(item.sluitingsdatum)}
              {daysLeft !== null && ` (${daysLeft}d resterend)`}
            </span>
          </div>
        )}
        {item.bron_website && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Tag className="size-3.5" />
            <span>{item.bron_website}</span>
          </div>
        )}
      </div>

      <Separator />

      <Tabs defaultValue="overzicht">
        <TabsList>
          <TabsTrigger value="overzicht">
            <FileText className="mr-1.5 size-3.5" />
            Overzicht
          </TabsTrigger>
          <TabsTrigger value="ai">
            <BrainCircuit className="mr-1.5 size-3.5" />
            AI Analyse
          </TabsTrigger>
          <TabsTrigger value="scores">
            <BarChart3 className="mr-1.5 size-3.5" />
            Scores
          </TabsTrigger>
          <TabsTrigger value="notities">
            <StickyNote className="mr-1.5 size-3.5" />
            Notities
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overzicht" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Beschrijving</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {item.beschrijving ?? 'Geen beschrijving beschikbaar.'}
                </p>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Totaalscore</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <span className="text-4xl font-bold tabular-nums">
                      {weightedScore ?? '—'}
                    </span>
                    <span className="mb-1 text-sm text-muted-foreground">/ 100</span>
                  </div>
                  {weightedScore !== undefined && weightedScore !== null && (
                    <Progress value={weightedScore} className="mt-3 h-2" />
                  )}
                </CardContent>
              </Card>

              {item.pre_kwalificatie_nummer && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Pre-kwalificatie
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-mono text-sm">{item.pre_kwalificatie_nummer}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {item.highlight_data && Object.keys(item.highlight_data).length > 0 && (
            <div className="grid gap-4 sm:grid-cols-3">
              {Object.entries(item.highlight_data).map(([category, items]) => (
                <Card key={category}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{category}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5">
                      {(items as string[]).map((point, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BrainCircuit className="size-4 text-blue-600" />
                AI Samenvatting
              </CardTitle>
              <CardDescription>
                Gegenereerd door GPT-4 op basis van de aanbestedingstekst
              </CardDescription>
            </CardHeader>
            <CardContent>
              {item.ai_samenvatting ? (
                <div className="rounded-lg bg-blue-50 p-4 text-sm leading-relaxed text-blue-900 dark:bg-blue-950 dark:text-blue-100">
                  {item.ai_samenvatting}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <BrainCircuit className="size-10 text-muted-foreground/40" />
                  <div>
                    <p className="text-sm font-medium">Geen AI analyse beschikbaar</p>
                    <p className="text-xs text-muted-foreground">
                      Start een AI analyse om een samenvatting te genereren
                    </p>
                  </div>
                  <Button size="sm">
                    <BrainCircuit className="mr-1.5 size-3.5" />
                    Analyse starten
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scores" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Criteria scores</CardTitle>
              <CardDescription>
                Gewogen score per criterium op basis van de aanbestedingstekst
              </CardDescription>
            </CardHeader>
            <CardContent>
              {item.criteria_scores ? (
                <div className="space-y-4">
                  {criteria.map((c) => {
                    const score = item.criteria_scores?.[c.naam];
                    return (
                      <div key={c.id}>
                        <div className="mb-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{c.naam}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              gewicht {c.gewicht}%
                            </Badge>
                          </div>
                          <span className="text-sm font-semibold tabular-nums">
                            {score !== undefined ? score : '—'}
                          </span>
                        </div>
                        <Progress value={score ?? 0} className="h-2" />
                      </div>
                    );
                  })}
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Gewogen totaalscore</span>
                    <span className="text-lg font-bold">{weightedScore ?? '—'}</span>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Nog geen scores beschikbaar
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notities" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notities</CardTitle>
              <CardDescription>
                Interne notities voor dit aanbestedingsdossier
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Voeg notities toe…"
                defaultValue={item.notities}
                className="min-h-48 resize-none"
              />
              <div className="mt-3 flex justify-end">
                <Button size="sm">Opslaan</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
