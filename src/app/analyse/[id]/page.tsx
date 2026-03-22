'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, PlayCircle, FileText, Trash2, Plus, Calendar, Building2,
  Tag, Hash, MapPin, DollarSign, BarChart2, Loader2, CheckCircle2,
  AlertCircle, Clock, Pencil, Check, X, Upload,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { AnalyseSessie, SessieBestand, SESSIE_STATUS_LABELS, SESSIE_STATUS_COLORS } from '@/types';
import { createClient } from '@/lib/supabase/client';

const STATUS_ICONS = {
  nieuw: Clock,
  analyse_bezig: Loader2,
  gereed: CheckCircle2,
  fout: AlertCircle,
};

export default function SessieDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [sessie, setSessie] = useState<AnalyseSessie | null>(null);
  const [bestanden, setBestanden] = useState<SessieBestand[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [editingNaam, setEditingNaam] = useState(false);
  const [newNaam, setNewNaam] = useState('');
  const [notities, setNotities] = useState('');
  const [savingNotities, setSavingNotities] = useState(false);
  const [addingFiles, setAddingFiles] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase.from('analyse_sessies').select('*').eq('id', id).single(),
      supabase.from('sessie_bestanden').select('*').eq('sessie_id', id).order('created_at'),
    ]);

    if (s) {
      const mapped: AnalyseSessie = {
        id: s.id, naam: s.naam,
        status: s.status as AnalyseSessie['status'],
        notities: s.notities ?? undefined,
        ai_samenvatting: s.ai_samenvatting ?? undefined,
        metadata: s.metadata as AnalyseSessie['metadata'],
        criteria_scores: s.criteria_scores as Record<string, number>,
        totaal_score: s.totaal_score ?? undefined,
        aantal_bestanden: s.aantal_bestanden,
        created_at: s.created_at,
        updated_at: s.updated_at,
      };
      setSessie(mapped);
      setNewNaam(s.naam);
      setNotities(s.notities ?? '');
    }
    if (b) {
      setBestanden(b.map((f) => ({
        id: f.id, sessie_id: f.sessie_id, naam: f.naam,
        storage_path: f.storage_path,
        mime_type: f.mime_type ?? undefined,
        grootte: f.grootte ?? undefined,
        created_at: f.created_at,
      })));
    }
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { load(); }, [load]);

  const runAnalyse = async () => {
    if (!sessie) return;
    setRunning(true);
    setSessie((s) => s ? { ...s, status: 'analyse_bezig' } : s);

    const res = await fetch(`/api/analyse/${id}/run`, { method: 'POST' });
    if (res.ok) await load();
    else setSessie((s) => s ? { ...s, status: 'fout' } : s);
    setRunning(false);
  };

  const saveNaam = async () => {
    if (!newNaam.trim()) return;
    await supabase.from('analyse_sessies').update({ naam: newNaam.trim() }).eq('id', id);
    setSessie((s) => s ? { ...s, naam: newNaam.trim() } : s);
    setEditingNaam(false);
  };

  const saveNotities = async () => {
    setSavingNotities(true);
    await supabase.from('analyse_sessies').update({ notities }).eq('id', id);
    setSavingNotities(false);
  };

  const deleteBestand = async (bestand: SessieBestand) => {
    await supabase.storage.from('analyse-bestanden').remove([bestand.storage_path]);
    await supabase.from('sessie_bestanden').delete().eq('id', bestand.id);
    setBestanden((prev) => prev.filter((b) => b.id !== bestand.id));
    await supabase.from('analyse_sessies').update({ aantal_bestanden: bestanden.length - 1 }).eq('id', id);
    setSessie((s) => s ? { ...s, aantal_bestanden: s.aantal_bestanden - 1 } : s);
  };

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setAddingFiles(true);

    const formData = new FormData();
    arr.forEach((f) => formData.append('files', f));

    try {
      // Upload files directly to the existing session
      for (const file of arr) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        const storagePath = `${id}/${Date.now()}-${file.name}`;

        const { error } = await supabase.storage
          .from('analyse-bestanden')
          .upload(storagePath, buffer, { contentType: file.type, upsert: false });

        if (!error) {
          const { data: newBestand } = await supabase
            .from('sessie_bestanden')
            .insert({
              sessie_id: id, naam: file.name,
              storage_path: storagePath,
              mime_type: file.type,
              grootte: file.size,
            })
            .select()
            .single();

          if (newBestand) {
            setBestanden((prev) => [...prev, {
              id: newBestand.id, sessie_id: newBestand.sessie_id,
              naam: newBestand.naam, storage_path: newBestand.storage_path,
              mime_type: newBestand.mime_type ?? undefined,
              grootte: newBestand.grootte ?? undefined,
              created_at: newBestand.created_at,
            }]);
          }
        }
      }

      const newCount = bestanden.length + arr.length;
      await supabase.from('analyse_sessies').update({ aantal_bestanden: newCount }).eq('id', id);
      setSessie((s) => s ? { ...s, aantal_bestanden: newCount } : s);
    } finally {
      setAddingFiles(false);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso?: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return iso; }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32" /><Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!sessie) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <AlertCircle className="size-12 text-muted-foreground/40" />
        <p className="text-sm font-medium">Sessie niet gevonden</p>
        <Button variant="outline" onClick={() => router.push('/analyse')}>
          <ArrowLeft className="mr-2 size-4" />Terug
        </Button>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[sessie.status];
  const criteriaEntries = Object.entries(sessie.criteria_scores ?? {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={() => router.push('/analyse')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          {editingNaam ? (
            <div className="flex items-center gap-2">
              <Input
                value={newNaam}
                onChange={(e) => setNewNaam(e.target.value)}
                className="text-lg font-bold h-auto py-1"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') saveNaam(); if (e.key === 'Escape') setEditingNaam(false); }}
              />
              <Button size="icon" variant="ghost" className="size-8" onClick={saveNaam}><Check className="size-4" /></Button>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditingNaam(false)}><X className="size-4" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight">{sessie.naam}</h1>
              <button onClick={() => setEditingNaam(true)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
                <Pencil className="size-3.5" />
              </button>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-xs ${SESSIE_STATUS_COLORS[sessie.status]}`}>
              <StatusIcon className={`mr-1 size-3 ${sessie.status === 'analyse_bezig' ? 'animate-spin' : ''}`} />
              {SESSIE_STATUS_LABELS[sessie.status]}
            </Badge>
            <span className="text-xs text-muted-foreground">{sessie.aantal_bestanden} bestanden</span>
            <span className="text-xs text-muted-foreground">· aangemaakt {formatDate(sessie.created_at)}</span>
          </div>
        </div>

        <Button onClick={runAnalyse} disabled={running || sessie.status === 'analyse_bezig'} className="shrink-0">
          {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlayCircle className="mr-2 size-4" />}
          {sessie.status === 'gereed' ? 'Heranalyseer' : 'Analyseer'}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={sessie.status === 'gereed' ? 'analyse' : 'documenten'}>
        <TabsList>
          <TabsTrigger value="documenten">
            <FileText className="mr-1.5 size-3.5" />
            Documenten
            <Badge variant="secondary" className="ml-1.5 text-[10px]">{bestanden.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="analyse">
            <BarChart2 className="mr-1.5 size-3.5" />
            Analyse
          </TabsTrigger>
          <TabsTrigger value="notities">
            <Pencil className="mr-1.5 size-3.5" />
            Notities
          </TabsTrigger>
        </TabsList>

        {/* Tab: Documenten */}
        <TabsContent value="documenten" className="mt-4 space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 transition-all ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'
            }`}
          >
            <input ref={fileInputRef} type="file" multiple className="hidden"
              accept=".pdf,.txt,.md,.json,.docx,.doc"
              onChange={(e) => e.target.files && addFiles(e.target.files)} />
            {addingFiles ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : (
              <Plus className="size-4 text-muted-foreground" />
            )}
            <span className="text-sm text-muted-foreground">
              {addingFiles ? 'Bezig met toevoegen…' : 'Extra bestanden toevoegen (sleep of klik)'}
            </span>
          </div>

          {bestanden.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <Upload className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nog geen bestanden in deze sessie</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bestanden.map((bestand) => (
                <div key={bestand.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
                  <FileText className="size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{bestand.naam}</p>
                    <p className="text-xs text-muted-foreground">
                      {bestand.mime_type ?? 'onbekend'}{bestand.grootte ? ` · ${formatBytes(bestand.grootte)}` : ''}
                      {' · '}{formatDate(bestand.created_at)}
                    </p>
                  </div>
                  <Button
                    size="icon" variant="ghost"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => deleteBestand(bestand)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab: Analyse */}
        <TabsContent value="analyse" className="mt-4 space-y-4">
          {sessie.status === 'nieuw' && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
              <PlayCircle className="size-10 text-muted-foreground/40" />
              <div>
                <p className="text-sm font-medium">Nog geen analyse uitgevoerd</p>
                <p className="text-xs text-muted-foreground">Klik op "Analyseer" om de AI-analyse te starten</p>
              </div>
            </div>
          )}

          {sessie.status === 'analyse_bezig' && (
            <div className="flex flex-col items-center gap-4 rounded-xl border py-12 text-center">
              <Loader2 className="size-10 animate-spin text-primary" />
              <p className="text-sm font-medium">Analyse bezig…</p>
              <p className="text-xs text-muted-foreground">AI verwerkt de documenten. Dit duurt even.</p>
            </div>
          )}

          {sessie.status === 'fout' && (
            <div className="flex items-center gap-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              Analyse mislukt. Controleer de bestanden en probeer opnieuw.
            </div>
          )}

          {sessie.status === 'gereed' && (
            <div className="space-y-4">
              {/* Score */}
              {sessie.totaal_score != null && (
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">Totaalscore</span>
                      <span className="text-2xl font-bold text-primary">{Math.round(sessie.totaal_score)}/100</span>
                    </div>
                    <Progress value={sessie.totaal_score} className="h-2" />
                  </CardContent>
                </Card>
              )}

              {/* Samenvatting */}
              {sessie.ai_samenvatting && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">AI Samenvatting</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">{sessie.ai_samenvatting}</p>
                  </CardContent>
                </Card>
              )}

              {/* Metadata */}
              {sessie.metadata && Object.values(sessie.metadata).some(Boolean) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Gegevens</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid gap-2 sm:grid-cols-2">
                      {sessie.metadata.opdrachtgever && (
                        <MetaRow icon={Building2} label="Opdrachtgever" value={sessie.metadata.opdrachtgever} />
                      )}
                      {sessie.metadata.type_opdracht && (
                        <MetaRow icon={Tag} label="Type" value={sessie.metadata.type_opdracht} />
                      )}
                      {sessie.metadata.sluitingsdatum && (
                        <MetaRow icon={Calendar} label="Sluitingsdatum" value={formatDate(sessie.metadata.sluitingsdatum) ?? sessie.metadata.sluitingsdatum} />
                      )}
                      {sessie.metadata.publicatiedatum && (
                        <MetaRow icon={Calendar} label="Publicatiedatum" value={formatDate(sessie.metadata.publicatiedatum) ?? sessie.metadata.publicatiedatum} />
                      )}
                      {sessie.metadata.referentienummer && (
                        <MetaRow icon={Hash} label="Referentie" value={sessie.metadata.referentienummer} />
                      )}
                      {sessie.metadata.regio && (
                        <MetaRow icon={MapPin} label="Regio" value={sessie.metadata.regio} />
                      )}
                      {sessie.metadata.waarde && (
                        <MetaRow icon={DollarSign} label="Waarde" value={sessie.metadata.waarde} />
                      )}
                    </dl>
                  </CardContent>
                </Card>
              )}

              {/* Criteria scores */}
              {criteriaEntries.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Criteria scores</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {criteriaEntries.map(([naam, score]) => (
                      <div key={naam}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="font-medium">{naam}</span>
                          <span className="text-muted-foreground">{Math.round(score)}/100</span>
                        </div>
                        <Progress value={score} className="h-1.5" />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* Tab: Notities */}
        <TabsContent value="notities" className="mt-4 space-y-3">
          <Textarea
            value={notities}
            onChange={(e) => setNotities(e.target.value)}
            placeholder="Voeg notities toe over deze aanbesteding, aandachtspunten, contactpersonen, etc."
            className="min-h-48 resize-none text-sm"
          />
          <Button onClick={saveNotities} disabled={savingNotities} size="sm">
            {savingNotities ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <Check className="mr-2 size-3.5" />}
            Notities opslaan
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetaRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium">{value}</dd>
      </div>
    </div>
  );
}
