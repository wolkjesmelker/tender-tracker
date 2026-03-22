'use client';

import { useState } from 'react';
import {
  Plus,
  Globe,
  Pencil,
  Trash2,
  RefreshCw,
  Check,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
import { BronWebsite } from '@/types';
import { formatDateTime } from '@/lib/utils';

const initialBronnen: BronWebsite[] = [
  {
    id: '1',
    naam: 'TenderNed',
    url: 'https://www.tenderned.nl',
    zoekpad: '/aankondigingen/overzicht',
    vakgebied: 'Algemeen',
    is_actief: true,
    laatste_sync: new Date(Date.now() - 2 * 3600000).toISOString(),
    sync_interval_uren: 6,
  },
  {
    id: '2',
    naam: 'Negometrix',
    url: 'https://www.negometrix.com',
    login_url: 'https://www.negometrix.com/login',
    gebruikersnaam: 'gebruiker@bedrijf.nl',
    wachtwoord: '••••••••',
    vakgebied: 'ICT',
    is_actief: true,
    laatste_sync: new Date(Date.now() - 8 * 3600000).toISOString(),
    sync_interval_uren: 12,
  },
  {
    id: '3',
    naam: 'Aanbestedingskalender',
    url: 'https://www.aanbestedingskalender.nl',
    vakgebied: 'Bouw',
    is_actief: false,
    sync_interval_uren: 24,
  },
];

const VAKGEBIEDEN = ['Algemeen', 'ICT', 'Bouw', 'Groen', 'Beveiliging', 'Schoonmaak', 'Overig'];

type FormData = Partial<BronWebsite>;

export default function BronnenPage() {
  const [bronnen, setBronnen] = useState<BronWebsite[]>(initialBronnen);
  const [showDialog, setShowDialog] = useState(false);
  const [editingBron, setEditingBron] = useState<BronWebsite | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState<FormData>({
    naam: '',
    url: '',
    zoekpad: '',
    login_url: '',
    gebruikersnaam: '',
    wachtwoord: '',
    vakgebied: 'Algemeen',
    sync_interval_uren: 12,
    is_actief: true,
  });

  const openAdd = () => {
    setEditingBron(null);
    setForm({
      naam: '',
      url: '',
      zoekpad: '',
      login_url: '',
      gebruikersnaam: '',
      wachtwoord: '',
      vakgebied: 'Algemeen',
      sync_interval_uren: 12,
      is_actief: true,
    });
    setShowDialog(true);
  };

  const openEdit = (bron: BronWebsite) => {
    setEditingBron(bron);
    setForm({ ...bron });
    setShowDialog(true);
  };

  const handleSave = () => {
    if (!form.naam || !form.url) return;
    if (editingBron) {
      setBronnen((prev) =>
        prev.map((b) =>
          b.id === editingBron.id ? { ...b, ...form } as BronWebsite : b
        )
      );
    } else {
      setBronnen((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          naam: form.naam!,
          url: form.url!,
          zoekpad: form.zoekpad,
          login_url: form.login_url,
          gebruikersnaam: form.gebruikersnaam,
          wachtwoord: form.wachtwoord,
          vakgebied: form.vakgebied,
          is_actief: form.is_actief ?? true,
          sync_interval_uren: form.sync_interval_uren,
        },
      ]);
    }
    setShowDialog(false);
  };

  const handleDelete = (id: string) => {
    setBronnen((prev) => prev.filter((b) => b.id !== id));
  };

  const toggleActive = (id: string) => {
    setBronnen((prev) =>
      prev.map((b) => (b.id === id ? { ...b, is_actief: !b.is_actief } : b))
    );
  };

  const activeBronnen = bronnen.filter((b) => b.is_actief).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bronnen</h1>
          <p className="text-muted-foreground">
            Beheer de websites die worden gescand voor nieuwe aanbestedingen
          </p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-2 size-3.5" />
          Bron toevoegen
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{bronnen.length}</div>
            <p className="text-xs text-muted-foreground">Totaal bronnen</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{activeBronnen}</div>
            <p className="text-xs text-muted-foreground">Actief</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-muted-foreground">
              {bronnen.length - activeBronnen}
            </div>
            <p className="text-xs text-muted-foreground">Inactief</p>
          </CardContent>
        </Card>
      </div>

      {/* Bronnen grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {bronnen.map((bron) => (
          <Card
            key={bron.id}
            className={`transition-opacity ${!bron.is_actief ? 'opacity-60' : ''}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-blue-50">
                    <Globe className="size-4 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">{bron.naam}</CardTitle>
                    {bron.vakgebied && (
                      <Badge variant="secondary" className="mt-0.5 text-[10px]">
                        {bron.vakgebied}
                      </Badge>
                    )}
                  </div>
                </div>
                <Switch
                  checked={bron.is_actief}
                  onCheckedChange={() => toggleActive(bron.id)}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <a
                href={bron.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-xs text-blue-600 hover:underline"
              >
                {bron.url}
              </a>

              {bron.laatste_sync && (
                <p className="text-xs text-muted-foreground">
                  Laatste sync: {formatDateTime(bron.laatste_sync)}
                </p>
              )}

              {bron.sync_interval_uren && (
                <p className="text-xs text-muted-foreground">
                  Interval: elke {bron.sync_interval_uren}u
                </p>
              )}

              {bron.login_url && (
                <Badge variant="outline" className="text-[10px]">
                  Login vereist
                </Badge>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-7 text-xs"
                  disabled={!bron.is_actief}
                >
                  <RefreshCw className="mr-1.5 size-3" />
                  Synchroniseer
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => openEdit(bron)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(bron.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBron ? 'Bron bewerken' : 'Bron toevoegen'}</DialogTitle>
            <DialogDescription>
              Configureer de website die gescand wordt voor aanbestedingen
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Naam *</Label>
                <Input
                  placeholder="bijv. TenderNed"
                  value={form.naam ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, naam: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Vakgebied</Label>
                <Select
                  value={form.vakgebied ?? 'Algemeen'}
                  onValueChange={(v) => setForm((f) => ({ ...f, vakgebied: v || undefined }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAKGEBIEDEN.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Website URL *</Label>
              <Input
                placeholder="https://www.example.nl"
                value={form.url ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Zoekpad</Label>
              <Input
                placeholder="/aankondigingen/overzicht"
                value={form.zoekpad ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, zoekpad: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sync interval (uren)</Label>
              <Input
                type="number"
                min={1}
                max={168}
                value={form.sync_interval_uren ?? 12}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    sync_interval_uren: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Login URL (optioneel)</Label>
              <Input
                placeholder="https://www.example.nl/login"
                value={form.login_url ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, login_url: e.target.value }))}
              />
            </div>
            {form.login_url && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Gebruikersnaam</Label>
                  <Input
                    value={form.gebruikersnaam ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, gebruikersnaam: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Wachtwoord</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={form.wachtwoord ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, wachtwoord: e.target.value }))
                      }
                      className="pr-9"
                    />
                    <button
                      type="button"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              <X className="mr-1.5 size-3.5" />
              Annuleren
            </Button>
            <Button onClick={handleSave} disabled={!form.naam || !form.url}>
              <Check className="mr-1.5 size-3.5" />
              {editingBron ? 'Opslaan' : 'Toevoegen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
