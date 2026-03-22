'use client';

import { useState } from 'react';
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

const initialPrompts: AIPrompt[] = [
  {
    id: '1',
    naam: 'Orchestrator v1',
    type: 'orchestrator',
    prompt_tekst:
      'Je bent een aanbestedingsexpert. Analyseer de aanbestedingstekst en coördineer de andere agents om een complete analyse te produceren. Focus op: geschiktheid voor ons bedrijf, kansen, risicos en een aanbevelingsscore.',
    versie: 1,
    is_actief: true,
    beschrijving: 'Hoofd-orchestrator voor de analyse pipeline',
  },
  {
    id: '2',
    naam: 'Samenvattings Agent',
    type: 'agent',
    agent_naam: 'summarizer',
    prompt_tekst:
      'Maak een beknopte samenvatting (max. 300 tekens) van de aanbestedingstekst. Vermeld: opdrachtgever, type opdracht, geschatte waarde en deadline.',
    versie: 2,
    is_actief: true,
    beschrijving: 'Genereert een korte samenvatting van de aanbesteding',
  },
  {
    id: '3',
    naam: 'Score Agent',
    type: 'agent',
    agent_naam: 'scorer',
    prompt_tekst:
      'Beoordeel de aanbesteding op de volgende criteria en geef een score van 0-100 per criterium: Ervaring, Prijs, Planning, Duurzaamheid, Team kwaliteit. Geef ook een totaalscore.',
    versie: 1,
    is_actief: true,
    beschrijving: 'Scoort de aanbesteding op basis van criteria',
  },
  {
    id: '4',
    naam: 'Kwaliteitscheck',
    type: 'gatekeeper',
    prompt_tekst:
      'Controleer of de gegenereerde analyse volledig en correct is. Verificeer dat: alle criteria zijn gescoord, de samenvatting accuraat is, en geen hallucinaties aanwezig zijn. Keur de analyse goed of af.',
    versie: 1,
    is_actief: true,
    beschrijving: 'Valideert de output van de analyse agents',
  },
];

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
  const [prompts, setPrompts] = useState<AIPrompt[]>(initialPrompts);
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

  const handleSave = () => {
    if (!form.naam || !form.prompt_tekst) return;
    if (editingPrompt) {
      setPrompts((prev) =>
        prev.map((p) =>
          p.id === editingPrompt.id
            ? { ...p, ...form, versie: p.versie + 1 } as AIPrompt
            : p
        )
      );
    } else {
      setPrompts((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          naam: form.naam!,
          type: form.type as AIPrompt['type'],
          agent_naam: form.agent_naam,
          prompt_tekst: form.prompt_tekst!,
          beschrijving: form.beschrijving,
          versie: 1,
          is_actief: form.is_actief ?? true,
        },
      ]);
    }
    setShowDialog(false);
  };

  const handleDelete = (id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id));
  };

  const toggleActive = (id: string) => {
    setPrompts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, is_actief: !p.is_actief } : p))
    );
  };

  const copyPrompt = (id: string, tekst: string) => {
    navigator.clipboard.writeText(tekst);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const renderPromptCard = (prompt: AIPrompt) => (
    <Card
      key={prompt.id}
      className={`transition-opacity ${!prompt.is_actief ? 'opacity-60' : ''}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">{prompt.naam}</CardTitle>
              <Badge variant="outline" className={`shrink-0 border text-[10px] ${TYPE_COLORS[prompt.type]}`}>
                {TYPE_LABELS[prompt.type]}
              </Badge>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                v{prompt.versie}
              </Badge>
            </div>
            {prompt.beschrijving && (
              <CardDescription className="mt-1 text-xs">
                {prompt.beschrijving}
              </CardDescription>
            )}
            {prompt.agent_naam && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                agent: {prompt.agent_naam}
              </p>
            )}
          </div>
          <Switch
            checked={prompt.is_actief}
            onCheckedChange={() => toggleActive(prompt.id)}
          />
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
              <>
                <Check className="mr-1.5 size-3 text-green-600" />
                Gekopieerd
              </>
            ) : (
              <>
                <Copy className="mr-1.5 size-3" />
                Kopieer
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => openEdit(prompt)}
          >
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

  const byType = (type: AIPrompt['type']) =>
    prompts.filter((p) => p.type === type);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Prompts</h1>
          <p className="text-muted-foreground">
            Beheer de AI prompts voor de analyse pipeline
          </p>
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
                {idx < arr.length - 1 && (
                  <div className="h-px w-6 bg-border" />
                )}
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

      {/* Tabs per type */}
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
                  <p className="text-sm font-medium">
                    Geen {TYPE_LABELS[type].toLowerCase()} prompts
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Voeg een prompt toe om te beginnen
                  </p>
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
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, type: v as AIPrompt['type'] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['orchestrator', 'agent', 'gatekeeper'] as const).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
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
                  onChange={(e) =>
                    setForm((f) => ({ ...f, agent_naam: e.target.value }))
                  }
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Beschrijving</Label>
              <Input
                placeholder="Korte omschrijving van de functie"
                value={form.beschrijving ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, beschrijving: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Prompt tekst *</Label>
              <Textarea
                placeholder="Schrijf hier de systeemprompt…"
                value={form.prompt_tekst ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, prompt_tekst: e.target.value }))
                }
                className="min-h-40 resize-none font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              <X className="mr-1.5 size-3.5" />
              Annuleren
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.naam || !form.prompt_tekst}
            >
              <Check className="mr-1.5 size-3.5" />
              {editingPrompt ? 'Opslaan' : 'Toevoegen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
