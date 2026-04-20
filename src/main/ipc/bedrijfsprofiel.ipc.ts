import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import type { BedrijfsProfiel } from '../../shared/types'

function rowToProfile(r: Record<string, unknown>): BedrijfsProfiel {
  return {
    id: String(r.id),
    naam: String(r.naam ?? ''),
    rechtsvorm: (r.rechtsvorm as string) ?? undefined,
    kvk: (r.kvk as string) ?? undefined,
    btw: (r.btw as string) ?? undefined,
    iban: (r.iban as string) ?? undefined,
    adres: (r.adres as string) ?? undefined,
    postcode: (r.postcode as string) ?? undefined,
    stad: (r.stad as string) ?? undefined,
    land: (r.land as string) ?? 'Nederland',
    email: (r.email as string) ?? undefined,
    telefoon: (r.telefoon as string) ?? undefined,
    website: (r.website as string) ?? undefined,
    contactpersoon: (r.contactpersoon as string) ?? undefined,
    functie_contactpersoon: (r.functie_contactpersoon as string) ?? undefined,
    is_standaard: Number(r.is_standaard) === 1,
    extra_velden: (r.extra_velden as string) ?? undefined,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  }
}

export function registerBedrijfsprofielHandlers(): void {
  ipcMain.handle(IPC.BEDRIJFSPROFIELEN_LIST, () => {
    const rows = getDb()
      .prepare(`SELECT * FROM bedrijfsprofielen ORDER BY is_standaard DESC, naam ASC`)
      .all() as Record<string, unknown>[]
    return rows.map(rowToProfile)
  })

  ipcMain.handle(IPC.BEDRIJFSPROFIELEN_GET, (_e, id: string) => {
    const row = getDb()
      .prepare(`SELECT * FROM bedrijfsprofielen WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined
    return row ? rowToProfile(row) : null
  })

  ipcMain.handle(IPC.BEDRIJFSPROFIELEN_CREATE, (_e, data: Partial<BedrijfsProfiel>) => {
    const db = getDb()
    const id = db
      .prepare(
        `INSERT INTO bedrijfsprofielen
           (naam, rechtsvorm, kvk, btw, iban, adres, postcode, stad, land,
            email, telefoon, website, contactpersoon, functie_contactpersoon,
            is_standaard, extra_velden)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.naam ?? '',
        data.rechtsvorm ?? null,
        data.kvk ?? null,
        data.btw ?? null,
        data.iban ?? null,
        data.adres ?? null,
        data.postcode ?? null,
        data.stad ?? null,
        data.land ?? 'Nederland',
        data.email ?? null,
        data.telefoon ?? null,
        data.website ?? null,
        data.contactpersoon ?? null,
        data.functie_contactpersoon ?? null,
        data.is_standaard ? 1 : 0,
        data.extra_velden ?? null,
      )
    const row = db
      .prepare(`SELECT * FROM bedrijfsprofielen WHERE rowid = last_insert_rowid()`)
      .get() as Record<string, unknown>
    return { ok: true, profile: rowToProfile(row) }
  })

  ipcMain.handle(IPC.BEDRIJFSPROFIELEN_UPDATE, (_e, id: string, data: Partial<BedrijfsProfiel>) => {
    const db = getDb()
    const existing = db
      .prepare(`SELECT * FROM bedrijfsprofielen WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined
    if (!existing) return { ok: false, error: 'Profiel niet gevonden' }

    db.prepare(
      `UPDATE bedrijfsprofielen SET
         naam = ?, rechtsvorm = ?, kvk = ?, btw = ?, iban = ?,
         adres = ?, postcode = ?, stad = ?, land = ?,
         email = ?, telefoon = ?, website = ?,
         contactpersoon = ?, functie_contactpersoon = ?,
         is_standaard = ?, extra_velden = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      data.naam ?? existing.naam,
      data.rechtsvorm !== undefined ? (data.rechtsvorm ?? null) : existing.rechtsvorm,
      data.kvk !== undefined ? (data.kvk ?? null) : existing.kvk,
      data.btw !== undefined ? (data.btw ?? null) : existing.btw,
      data.iban !== undefined ? (data.iban ?? null) : existing.iban,
      data.adres !== undefined ? (data.adres ?? null) : existing.adres,
      data.postcode !== undefined ? (data.postcode ?? null) : existing.postcode,
      data.stad !== undefined ? (data.stad ?? null) : existing.stad,
      data.land !== undefined ? (data.land ?? 'Nederland') : existing.land,
      data.email !== undefined ? (data.email ?? null) : existing.email,
      data.telefoon !== undefined ? (data.telefoon ?? null) : existing.telefoon,
      data.website !== undefined ? (data.website ?? null) : existing.website,
      data.contactpersoon !== undefined ? (data.contactpersoon ?? null) : existing.contactpersoon,
      data.functie_contactpersoon !== undefined
        ? (data.functie_contactpersoon ?? null)
        : existing.functie_contactpersoon,
      data.is_standaard !== undefined ? (data.is_standaard ? 1 : 0) : existing.is_standaard,
      data.extra_velden !== undefined ? (data.extra_velden ?? null) : existing.extra_velden,
      id,
    )
    const row = db
      .prepare(`SELECT * FROM bedrijfsprofielen WHERE id = ?`)
      .get(id) as Record<string, unknown>
    return { ok: true, profile: rowToProfile(row) }
  })

  ipcMain.handle(IPC.BEDRIJFSPROFIELEN_DELETE, (_e, id: string) => {
    getDb().prepare(`DELETE FROM bedrijfsprofielen WHERE id = ?`).run(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.BEDRIJFSPROFIELEN_SET_STANDAARD, (_e, id: string) => {
    const db = getDb()
    db.prepare(`UPDATE bedrijfsprofielen SET is_standaard = 0, updated_at = datetime('now')`).run()
    db.prepare(
      `UPDATE bedrijfsprofielen SET is_standaard = 1, updated_at = datetime('now') WHERE id = ?`,
    ).run(id)
    return { ok: true }
  })
}
