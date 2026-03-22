'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  BrainCircuit,
  Pencil,
  Trash2,
  Check,
  X,
  Copy,
  GitBranch,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AIPrompt } from '@/types';
import { createClient } from '@/lib/supabase/client';

const TYPE_LABELS: Record<AIPrompt['type'], string> = {
  orchestrator: 'Orchestrator',
  agent: 'Agent',
  gatekeeper: 'Gatekeeper',
};

const TYPE_COLORS: Record<AIPrompt['type'], string> = {
  orchestrator: 'bg-purple-100 text-purple-800 border-purple-200',
  agent: 'bg-blue-100 text-blue-800 border-blue-200',
  gatekeeper: 'bg-orange-100 text-orange-800 border-orange-200',
};

const TYPE_DESCRIPTIONS: Record<AIPrompt['type'], string> = {
  orchestrator: 'Coördineert de volledige AI pipeline en delegeert taken',
  agent: 'Voert specifieke analyse taken uit',
  gatekeeper: 'Valideert en keurt de output van agents goed of af',
};

export default function AIPromptsPage() {
  const [prompts, setPrompts] = useState<AIPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<AIPrompt | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<AIPrompt>>({
    naam: '',
    type: 'agent',
    agent_naam: '',
    prompt_tekst: '',
    beschrijving: '',
    is_actief: true,
  });

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('ai_prompts')
        .select('*')
        .order('type')
        .order('naam');
      if (data) {
        setPrompts(
          data.map((p) => ({
            id: p.id,
            naam: p.naam,
            type: p.type as AIPrompt['type'],
            agent_naam: p.agent_naam ?? undefined,
            prompt_tekst: p.prompt_tekst,
            versie: p.versie,
            is_actief: p.is_actief,
            beschrijving: p.beschrijving ?? undefined,
          }))
        );
      }
      setLoading(false);
    }
    load();
  }, []);

  const openAdd = () => {
    setEditingPrompt(null);
    setForm({ naam: '', type: 'agent', agent_naam: '', prompt_tekst: '', beschrijving: '', is_actief: true });
    setShowDialog(true);
  };

  const openEdit = (p: AIPrompt) => {
    setEditingPrompt(p);
    setForm({ ...p });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.naam || !form.prompt_tekst) return;
    if (editingPrompt) {
      const newVersie = editingPrompt.versie + 1;
      const { data } = await supabase
        .from('ai_prompts')
        .update({
          naam: form.naam,
          type: form.type,
          agent_naam: form.agent_naam ?? null,
          prompt_tekst: form.prompt_tekst,
          beschrijving: form.beschrijving ?? null,
          versie: newVersie,
        })
        .eq('id', editingPrompt.id)
        .select()
        .single();
      if (data) {
        setPrompts((prev) =>
          prev.map((p) =>
            p.id === editingPrompt.id
              ? { ...p, ...form, versie: newVersie } as AIPrompt
              : p
          )
        );
      }
    } else {
      const { data } = await supabase
        .from('ai_prompts')
        .insert({
          naam: form.naam,
          type: form.type ?? 'agent',
          agent_naam: form.agent_naam ?? null,
          prompt_tekst: form.prompt_tekst,
          beschrijving: form.beschrijving ?? null,
          versie: 1,
          is_actief: form.is_actief ?? true,
        })
        .select()
        .single();
      if (data) {
        setPrompts((prev) => [
          ...prev,
          {
            id: data.id,
            naam: data.naam,
            type: data.type as AIPrompt['type'],
            agent_naam: data.agent_naam ?? undefined,
            prompt_tekst: data.prompt_tekst,
            versie: data.versie,
            is_actief: data.is_actief,
            beschrijving: data.beschrijving ?? undefined,
          },
        ]);
      }
    }
    setShowDialog(false);
  };

  const handleDelete = async (id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id));
    await supabase.from('ai_prompts').delete().eq('id', id);
  };

  const toggleActive = async (id: string) => {
    const p = prompts.find((x) => x.id === id);
    if (!p) return;
    const newVal = !p.is_actief;
    setPrompts((prev) => prev.map((x) => (x.id === id ? { ...x, is_actief: newVal } : x)));
    await supabase.from('ai_prompts').update({ is_actief: newVal }).eq('id', id);
  };

  const copyPrompt = (id: string, tekst: string) => {
    navigator.clipboard.writeText(tekst);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const byType = (type: AIPrompt['type']) => prompts.filter((p) => p.type === type);

  const renderPromptCard = (prompt: AIPrompt) => (
    <Card key={prompt.id} className={`transition-opacity ${!prompt.is_actief ? 'opacity-60' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">{prompt.naam}</CardTitle>
              <Badge variant="outline" className={`shrink-0 border text-[10px] ${TYPE_COLORS[prompt.type]}`}>
                {TYPE_LABELS[prompt.type]}
              </Badge>
              <Badge variant="secondary" className="shrink-0 text-[10px]">v{prompt.versie}</Badge>
            </div>
            {prompt.beschrijving && (
              <CardDescription className="mt-1 text-xs">{prompt.beschrijving}</CardDescription>
            )}
            {prompt.agent_naam && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                agent: {prompt.agent_naam}
              </p>
            )}
          </div>
          <Switch checked={prompt.is_actief} onCheckedChange={() => toggleActive(prompt.id)} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md bg-muted/50 p-3">
          <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">
            {prompt.prompt_tekst}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={() => copyPrompt(prompt.id, prompt.prompt_tekst)}
          >
            {copiedId === prompt.id ? (
              <><Check className="mr-1.5 size-3 text-green-600" />Gekopieerd</>
            ) : (
              <><Copy className="mr-1.5 size-3" />Kopieer</>
            )}
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(prompt)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={() => handleDelete(prompt.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-36" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-56" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Prompts</h1>
          <p className="text-muted-foreground">Beheer de AI prompts voor de analyse pipeline</p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-2 size-3.5" />
          Prompt toevoegen
        </Button>
      </div>

      {/* Pipeline overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="size-4 text-blue-600" />
            Pipeline architectuur
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {(['orchestrator', 'agent', 'gatekeeper'] as const).map((type, idx, arr) => (
              <div key={type} className="flex items-center gap-2">
                <div className="rounded-lg border px-3 py-2 text-center">
                  <p className="text-xs font-semibold">{TYPE_LABELS[type]}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {byType(type).filter((p) => p.is_actief).length} actief
                  </p>
                </div>
                {idx < arr.length - 1 && <div className="h-px w-6 bg-border" />}
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(['orchestrator', 'agent', 'gatekeeper'] as const).map((type) => (
              <p key={type} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{TYPE_LABELS[type]}:</span>{' '}
                {TYPE_DESCRIPTIONS[type]}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="orchestrator">
        <TabsList>
          {(['orchestrator', 'agent', 'gatekeeper'] as const).map((type) => (
            <TabsTrigger key={type} value={type}>
              <BrainCircuit className="mr-1.5 size-3.5" />
              {TYPE_LABELS[type]}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {byType(type).length}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {(['orchestrator', 'agent', 'gatekeeper'] as const).map((type) => (
          <TabsContent key={type} value={type} className="mt-4">
            {byType(type).length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
                <BrainCircuit className="size-10 text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium">Geen {TYPE_LABELS[type].toLowerCase()} prompts</p>
                  <p className="text-xs text-muted-foreground">Voeg een prompt toe om te beginnen</p>
                </div>
                <Button size="sm" onClick={openAdd}>
                  <Plus className="mr-1.5 size-3.5" />
                  Toevoegen
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {byType(type).map(renderPromptCard)}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingPrompt ? 'Prompt bewerken' : 'Prompt toevoegen'}
            </DialogTitle>
            <DialogDescription>
              {editingPrompt
                ? `Versie wordt automatisch verhoogd naar v${(editingPrompt.versie ?? 1) + 1}`
                : 'Voeg een nieuwe AI prompt toe aan de pipeline'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Naam *</Label>
                <Input
                  placeholder="bijv. Score Agent v2"
                  value={form.naam ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, naam: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <Select
                  value={form.type ?? 'agent'}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v as AIPrompt['type'] }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['orchestrator', 'agent', 'gatekeeper'] as const).map((t) => (
                      <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.type === 'agent' && (
              <div className="space-y-1.5">
                <Label>Agent naam</Label>
                <Input
                  placeholder="bijv. summarizer"
                  value={form.agent_naam ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, agent_naam: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Beschrijving</Label>
              <Input
                placeholder="Korte omschrijving van de functie"
                value={form.beschrijving ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, beschrijving: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Prompt tekst *</Label>
              <Textarea
                placeholder="Schrijf hier de systeemprompt…"
                value={form.prompt_tekst ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, prompt_tekst: e.target.value }))}
                className="min-h-40 resize-none font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              <X className="mr-1.5 size-3.5" />
              Annuleren
            </Button>
            <Button onClick={handleSave} disabled={!form.naam || !form.prompt_tekst}>
              <Check className="mr-1.5 size-3.5" />
              {editingPrompt ? 'Opslaan' : 'Toevoegen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
