'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Play, RefreshCw, Clock, CheckCircle2, AlertCircle, Loader2,
  Webhook, Copy, Check, ExternalLink, Globe, Search,
  Info, ChevronDown, ChevronUp, FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';

interface Bron {
  id: string;
  naam: string;
  url: string;
  vakgebied?: string;
  is_actief: boolean;
  laatste_sync?: string;
  gebruikersnaam?: string;
}

interface ScrapeJob {
  id: string;
  bron_naam: string;
  bron_url: string;
  zoekterm?: string;
  status: 'wachtend' | 'bezig' | 'gereed' | 'fout';
  aantal_gevonden: number;
  fout_melding?: string;
  triggered_by: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  resultaten?: object[];
}

const JOB_STATUS_CONFIG = {
  wachtend: { label: 'Wachtend', color: 'bg-slate-100 text-slate-700', icon: Clock },
  bezig: { label: 'Bezig', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  gereed: { label: 'Gereed', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  fout: { label: 'Fout', color: 'bg-red-100 text-red-700', icon: AlertCircle },
};

const WEBHOOK_URL = typeof window !== 'undefined'
  ? `${window.location.origin}/api/webhook/cowork`
  : '/api/webhook/cowork';

const WEBHOOK_SECRET = process.env.NEXT_PUBLIC_WEBHOOK_SECRET ?? '(zie .env.local → WEBHOOK_SECRET)';

const COWORK_PAYLOAD_EXAMPLE = `{
  "bron_naam": "TenderNed",
  "bron_url": "https://www.tenderned.nl",
  "zoekterm": "riool",
  "tenders": [
    {
      "titel": "Rioolrenovatie Centrum Maastricht",
      "opdrachtgever": "Gemeente Maastricht",
      "sluitingsdatum": "2026-05-01",
      "publicatiedatum": "2026-03-15",
      "referentienummer": "MAS-2026-042",
      "type_opdracht": "Werken",
      "regio": "Limburg",
      "waarde": "€ 450.000",
      "url": "https://www.tenderned.nl/tender/12345"
    }
  ]
}`;

const COWORK_CLAUDE_PROMPT = `Je bent een web scraper agent voor aanbestedingen.

TAAK:
1. Bezoek de website: {WEBSITE_URL}
2. Log in met: gebruikersnaam={USERNAME}, wachtwoord={PASSWORD}
3. Zoek op: {ZOEKTERM}
4. Extraheer alle gevonden aanbestedingen
5. Stuur de resultaten naar de webhook

WEBHOOK INSTRUCTIES:
- URL: {WEBHOOK_URL}
- Methode: POST
- Header: X-Webhook-Secret: {WEBHOOK_SECRET}
- Content-Type: application/json

Per tender minimaal: titel, opdrachtgever, sluitingsdatum, referentienummer, url

Payload formaat:
{
  "bron_naam": "naam van de website",
  "bron_url": "url van de website",
  "zoekterm": "gebruikte zoekterm",
  "tenders": [ ... ]
}`;

export default function ScrapenPage() {
  const [bronnen, setBronnen] = useState<Bron[]>([]);
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBron, setSelectedBron] = useState('');
  const [zoekterm, setZoekterm] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [generatedPrompt, setGeneratedPrompt] = useState('');

  const supabase = createClient();

  const load = useCallback(async () => {
    const [{ data: b }, { data: j }] = await Promise.all([
      supabase.from('bron_websites').select('*').eq('is_actief', true).order('naam'),
      supabase.from('scrape_jobs').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    if (b) setBronnen(b.map((x) => ({ ...x, vakgebied: x.vakgebied ?? undefined, gebruikersnaam: x.gebruikersnaam ?? undefined, laatste_sync: x.laatste_sync ?? undefined })));
    if (j) setJobs(j as ScrapeJob[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh voor actieve jobs
  useEffect(() => {
    const actief = jobs.some((j) => j.status === 'bezig' || j.status === 'wachtend');
    if (!actief) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [jobs, load]);

  const startJob = async () => {
    if (!selectedBron) return;
    setStarting(true);
    setStartError(null);

    const res = await fetch('/api/scrape/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bron_id: selectedBron, zoekterm: zoekterm || undefined }),
    });
    const data = await res.json();

    if (!res.ok && res.status !== 202) {
      setStartError(data.error ?? 'Starten mislukt');
    } else {
      await load();
    }
    setStarting(false);
  };

  const generatePrompt = () => {
    const bron = bronnen.find((b) => b.id === selectedBron);
    if (!bron) return;
    const prompt = COWORK_CLAUDE_PROMPT
      .replace('{WEBSITE_URL}', bron.url)
      .replace('{USERNAME}', bron.gebruikersnaam ?? '(niet geconfigureerd)')
      .replace('{PASSWORD}', '(zie Bronnen pagina)')
      .replace('{ZOEKTERM}', zoekterm || bron.vakgebied || 'aanbesteding')
      .replace('{WEBHOOK_URL}', WEBHOOK_URL)
      .replace('{WEBHOOK_SECRET}', WEBHOOK_SECRET);
    setGeneratedPrompt(prompt);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const CopyButton = ({ text, field }: { text: string; field: string }) => (
    <button
      onClick={() => copyToClipboard(text, field)}
      className="ml-2 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copiedField === field ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
    </button>
  );

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scrapen</h1>
        <p className="text-muted-foreground">
          Start Claude-gestuurde scrapesessies of koppel een externe Computer Use agent via de webhook.
        </p>
      </div>

      <Tabs defaultValue="starten">
        <TabsList>
          <TabsTrigger value="starten"><Play className="mr-1.5 size-3.5" />Scrape starten</TabsTrigger>
          <TabsTrigger value="jobs">
            <RefreshCw className="mr-1.5 size-3.5" />Jobs
            {jobs.filter((j) => j.status === 'bezig').length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] bg-blue-100 text-blue-700">
                {jobs.filter((j) => j.status === 'bezig').length} actief
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="webhook"><Webhook className="mr-1.5 size-3.5" />Webhook & Cowork</TabsTrigger>
        </TabsList>

        {/* Tab: Starten */}
        <TabsContent value="starten" className="mt-4">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scrape configuratie</CardTitle>
                <CardDescription>Selecteer een bron en start een Claude-gestuurde scrapesessie</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Bron *</Label>
                  <Select value={selectedBron} onValueChange={(v) => setSelectedBron(v ?? '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kies een bronwebsite..." />
                    </SelectTrigger>
                    <SelectContent>
                      {bronnen.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          <div className="flex items-center gap-2">
                            <Globe className="size-3.5 text-muted-foreground" />
                            {b.naam}
                            {b.gebruikersnaam && (
                              <Badge variant="outline" className="text-[9px] py-0">login</Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {bronnen.length === 0 && !loading && (
                    <p className="text-xs text-muted-foreground">Geen actieve bronnen. Voeg ze toe via de Bronnen pagina.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Zoekterm</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="bijv. riool, ICT-dienstverlening, bouw..."
                      value={zoekterm}
                      onChange={(e) => setZoekterm(e.target.value)}
                    />
                  </div>
                </div>

                {startError && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {startError}
                  </div>
                )}

                {selectedBron && bronnen.find((b) => b.id === selectedBron)?.gebruikersnaam && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                    <Info className="size-3.5 mt-0.5 shrink-0" />
                    <span>Deze bron vereist inloggen. Claude probeert publieke pagina&apos;s te scrapen. Voor login-vereiste data: gebruik de <strong>Cowork webhook</strong>.</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={startJob} disabled={!selectedBron || starting} className="flex-1">
                    {starting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
                    {starting ? 'Claude start…' : 'Start Claude scraper'}
                  </Button>
                  {selectedBron && (
                    <Button variant="outline" onClick={generatePrompt}>
                      Cowork prompt
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Gegenereerde Cowork prompt */}
            {generatedPrompt && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Claude Cowork prompt</CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => copyToClipboard(generatedPrompt, 'prompt')}
                    >
                      {copiedField === 'prompt' ? (
                        <><Check className="mr-1.5 size-3 text-green-600" />Gekopieerd</>
                      ) : (
                        <><Copy className="mr-1.5 size-3" />Kopieer</>
                      )}
                    </Button>
                  </div>
                  <CardDescription className="text-xs">
                    Plak dit in Claude.ai &rsaquo; Projects &rsaquo; New task of in de Computer Use API
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-auto rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-80">
                    {generatedPrompt}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Tab: Jobs */}
        <TabsContent value="jobs" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{jobs.length} jobs totaal</p>
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw className="mr-1.5 size-3.5" />Vernieuwen
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
              <Clock className="size-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nog geen scrape jobs</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => {
                const cfg = JOB_STATUS_CONFIG[job.status];
                const Icon = cfg.icon;
                const isExpanded = expandedJob === job.id;

                return (
                  <div key={job.id} className="rounded-lg border bg-card overflow-hidden">
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                    >
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${cfg.color}`}>
                        <Icon className={`mr-1 size-2.5 ${job.status === 'bezig' ? 'animate-spin' : ''}`} />
                        {cfg.label}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{job.bron_naam}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.zoekterm && <><Search className="inline size-2.5 mr-1" />{job.zoekterm} · </>}
                          {formatDate(job.created_at)}
                          {job.status === 'gereed' && (
                            <span className="ml-2 text-green-600 font-medium">
                              {job.aantal_gevonden} gevonden
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-[9px]">{job.triggered_by}</Badge>
                        {isExpanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t px-4 py-3 bg-muted/20 space-y-2">
                        {job.fout_melding && (
                          <p className="text-xs text-destructive">{job.fout_melding}</p>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <span>Gestart: {formatDate(job.started_at)}</span>
                          <span>Afgerond: {formatDate(job.completed_at)}</span>
                        </div>
                        {job.resultaten && job.resultaten.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium">Gevonden tenders:</p>
                            {(job.resultaten as Array<{titel?: string; url?: string}>).slice(0, 5).map((t, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <FileText className="size-3 text-primary shrink-0" />
                                <span className="truncate">{t.titel ?? 'Zonder titel'}</span>
                                {t.url && (
                                  <a href={t.url} target="_blank" rel="noopener noreferrer"
                                    className="text-primary hover:underline shrink-0"
                                    onClick={(e) => e.stopPropagation()}>
                                    <ExternalLink className="size-3" />
                                  </a>
                                )}
                              </div>
                            ))}
                            {job.resultaten.length > 5 && (
                              <p className="text-xs text-muted-foreground">+{job.resultaten.length - 5} meer</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Tab: Webhook & Cowork */}
        <TabsContent value="webhook" className="mt-4">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Webhook configuratie */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Webhook className="size-4 text-primary" />
                  Webhook endpoint
                </CardTitle>
                <CardDescription>
                  Externe agents (Claude Computer Use, Kimi, Python scripts) kunnen data naar dit endpoint sturen
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Webhook URL</Label>
                  <div className="flex items-center rounded-md border bg-muted/50 px-3 py-2">
                    <code className="flex-1 text-xs break-all">{WEBHOOK_URL}</code>
                    <CopyButton text={WEBHOOK_URL} field="webhook_url" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Methode</Label>
                  <div className="rounded-md border bg-muted/50 px-3 py-2">
                    <code className="text-xs">POST</code>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Authenticatie header</Label>
                  <div className="flex items-center rounded-md border bg-muted/50 px-3 py-2">
                    <code className="flex-1 text-xs">X-Webhook-Secret: {WEBHOOK_SECRET}</code>
                    <CopyButton text={WEBHOOK_SECRET} field="secret" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Content-Type</Label>
                  <div className="rounded-md border bg-muted/50 px-3 py-2">
                    <code className="text-xs">application/json</code>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payload voorbeeld */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Payload formaat</CardTitle>
                <CardDescription className="text-xs">JSON die de externe agent moet sturen</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <pre className="overflow-auto rounded-md bg-muted/50 p-3 text-[10px] leading-relaxed text-muted-foreground max-h-72">
                    {COWORK_PAYLOAD_EXAMPLE}
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute top-2 right-2 h-6 text-[10px] px-2"
                    onClick={() => copyToClipboard(COWORK_PAYLOAD_EXAMPLE, 'payload')}
                  >
                    {copiedField === 'payload' ? <Check className="size-3" /> : <Copy className="size-3" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Claude Cowork instructies */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="size-4 text-primary" />
                  Claude Cowork instellen
                </CardTitle>
                <CardDescription>Stap-voor-stap koppeling met Claude Computer Use</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    {
                      stap: '1',
                      titel: 'Anthropic API key',
                      beschrijving: 'Ga naar console.anthropic.com, maak een API key aan en voeg toe aan .env.local als ANTHROPIC_API_KEY.',
                      link: 'https://console.anthropic.com',
                      linkTekst: 'Naar Anthropic Console',
                    },
                    {
                      stap: '2',
                      titel: 'Cowork prompt genereren',
                      beschrijving: 'Selecteer een bron in "Scrape starten", klik "Cowork prompt" en kopieer de gegenereerde instructies voor Claude.',
                      link: null,
                    },
                    {
                      stap: '3',
                      titel: 'Prompt uitvoeren in Claude',
                      beschrijving: 'Plak de prompt in Claude.ai › Projects of gebruik de Anthropic API met computer_use tool. Claude POST resultaten automatisch naar de webhook.',
                      link: 'https://claude.ai',
                      linkTekst: 'Naar Claude.ai',
                    },
                  ].map(({ stap, titel, beschrijving, link, linkTekst }) => (
                    <div key={stap} className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                          {stap}
                        </span>
                        <p className="text-sm font-semibold">{titel}</p>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{beschrijving}</p>
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="size-3" />
                          {linkTekst}
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-lg bg-muted/50 border p-4 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Wat doet de Computer Use agent?</p>
                  <p>Claude opent een echte browser, navigeert naar de website, logt in met de geconfigureerde credentials (via Bronnen), vult de zoekterm in, en extraheert alle aanbestedingen. De resultaten worden via POST naar de webhook gestuurd, waarna de app automatisch sessiekaarten aanmaakt in de Analyse sectie.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
