'use client';

import { useState, useEffect } from 'react';
import { Plus, GripVertical, Pencil, Trash2, Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Criterium } from '@/types';
import { createClient } from '@/lib/supabase/client';

export default function CriteriaPage() {
  const [criteria, setCriteria] = useState<Criterium[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Criterium>>({});
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newCriterium, setNewCriterium] = useState<Partial<Criterium>>({
    naam: '',
    beschrijving: '',
    gewicht: 10,
    is_actief: true,
  });

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('criteria')
        .select('*')
        .order('volgorde');
      if (data) {
        setCriteria(
          data.map((c) => ({
            id: c.id,
            naam: c.naam,
            beschrijving: c.beschrijving ?? undefined,
            gewicht: Number(c.gewicht),
            is_actief: c.is_actief,
            volgorde: c.volgorde,
          }))
        );
      }
      setLoading(false);
    }
    load();
  }, []);

  const totalWeight = criteria
    .filter((c) => c.is_actief)
    .reduce((sum, c) => sum + c.gewicht, 0);

  const toggleActive = async (id: string) => {
    const c = criteria.find((x) => x.id === id);
    if (!c) return;
    const newVal = !c.is_actief;
    setCriteria((prev) => prev.map((x) => (x.id === id ? { ...x, is_actief: newVal } : x)));
    await supabase.from('criteria').update({ is_actief: newVal }).eq('id', id);
  };

  const startEdit = (c: Criterium) => {
    setEditingId(c.id);
    setEditForm({ naam: c.naam, beschrijving: c.beschrijving, gewicht: c.gewicht });
  };

  const saveEdit = async (id: string) => {
    setCriteria((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              naam: editForm.naam ?? c.naam,
              beschrijving: editForm.beschrijving,
              gewicht: editForm.gewicht ?? c.gewicht,
            }
          : c
      )
    );
    await supabase
      .from('criteria')
      .update({
        naam: editForm.naam,
        beschrijving: editForm.beschrijving ?? null,
        gewicht: editForm.gewicht,
      })
      .eq('id', id);
    setEditingId(null);
  };

  const deleteCriterium = async (id: string) => {
    setCriteria((prev) => prev.filter((c) => c.id !== id));
    await supabase.from('criteria').delete().eq('id', id);
  };

  const addCriterium = async () => {
    if (!newCriterium.naam) return;
    const { data } = await supabase
      .from('criteria')
      .insert({
        naam: newCriterium.naam,
        beschrijving: newCriterium.beschrijving ?? null,
        gewicht: newCriterium.gewicht ?? 10,
        is_actief: true,
        volgorde: criteria.length + 1,
      })
      .select()
      .single();
    if (data) {
      setCriteria((prev) => [
        ...prev,
        {
          id: data.id,
          naam: data.naam,
          beschrijving: data.beschrijving ?? undefined,
          gewicht: Number(data.gewicht),
          is_actief: data.is_actief,
          volgorde: data.volgorde,
        },
      ]);
    }
    setNewCriterium({ naam: '', beschrijving: '', gewicht: 10, is_actief: true });
    setShowAddDialog(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Criteria</h1>
          <p className="text-muted-foreground">
            Definieer en weeg de beoordelingscriteria voor aanbestedingen
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="mr-2 size-3.5" />
          Criterium toevoegen
        </Button>
      </div>

      {/* Weight overview */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Gewichtsverdeling</CardTitle>
            <Badge
              variant={totalWeight === 100 ? 'default' : 'destructive'}
              className="tabular-nums"
            >
              {totalWeight}% / 100%
            </Badge>
          </div>
          <CardDescription>
            De som van actieve criteria gewichten moet 100% zijn
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {criteria
              .filter((c) => c.is_actief)
              .map((c) => (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
                    {c.naam}
                  </span>
                  <Progress
                    value={(c.gewicht / Math.max(totalWeight, 1)) * 100}
                    className="h-2 flex-1"
                  />
                  <span className="w-10 text-right text-xs font-medium tabular-nums">
                    {c.gewicht}%
                  </span>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Criteria list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Criteria beheer</CardTitle>
          <CardDescription>
            Bewerk gewichten, namen en activeringsstatus van elk criterium
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {criteria.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-4 px-6 py-4 transition-colors ${
                  !c.is_actief ? 'opacity-50' : ''
                }`}
              >
                <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />

                <div className="flex-1 min-w-0">
                  {editingId === c.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editForm.naam ?? ''}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, naam: e.target.value }))
                        }
                        className="h-7 text-sm"
                      />
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={editForm.gewicht ?? 0}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            gewicht: Number(e.target.value),
                          }))
                        }
                        className="h-7 w-20 text-sm"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => saveEdit(c.id)}
                      >
                        <Check className="size-3.5 text-green-600" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{c.naam}</span>
                        <Badge variant="secondary" className="text-[10px] tabular-nums">
                          {c.gewicht}%
                        </Badge>
                      </div>
                      {c.beschrijving && (
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">
                          {c.beschrijving}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={c.is_actief}
                    onCheckedChange={() => toggleActive(c.id)}
                    aria-label={`${c.naam} activeren`}
                  />
                  {editingId !== c.id && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => startEdit(c)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => deleteCriterium(c.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Separator />
          <div className="flex items-center justify-between px-6 py-4">
            <span className="text-sm text-muted-foreground">
              {criteria.filter((c) => c.is_actief).length} actieve criteria
            </span>
            <Button size="sm" variant="outline" disabled={totalWeight !== 100}>
              Wijzigingen opgeslagen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Add dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criterium toevoegen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Naam</Label>
              <Input
                placeholder="bijv. Kwaliteit referenties"
                value={newCriterium.naam}
                onChange={(e) =>
                  setNewCriterium((f) => ({ ...f, naam: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Beschrijving</Label>
              <Textarea
                placeholder="Korte omschrijving van het criterium…"
                value={newCriterium.beschrijving ?? ''}
                onChange={(e) =>
                  setNewCriterium((f) => ({ ...f, beschrijving: e.target.value }))
                }
                className="resize-none"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Gewicht (%)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={newCriterium.gewicht}
                onChange={(e) =>
                  setNewCriterium((f) => ({
                    ...f,
                    gewicht: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Annuleren
            </Button>
            <Button onClick={addCriterium} disabled={!newCriterium.naam}>
              Toevoegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
