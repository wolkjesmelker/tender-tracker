import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { IPC } from '../../shared/constants'
import type { AppReleaseRow } from '../../shared/types'
import { getSupabaseClient } from '../db/supabase-client'
import {
  normalizeReleaseSemver,
  verifyGithubReleaseExists,
  readGithubRepoFromPackage,
  applyRolloutFeedUrlSerialized,
} from '../release-rollout-service'

const TABLE = 'tender_tracker_app_releases'

function mapRow(r: Record<string, unknown>): AppReleaseRow {
  return {
    id: String(r.id),
    version: String(r.version ?? ''),
    description: String(r.description ?? ''),
    status: r.status as AppReleaseRow['status'],
    created_at: String(r.created_at ?? ''),
    launched_at: r.launched_at == null ? null : String(r.launched_at),
  }
}

export function registerReleaseRolloutHandlers(): void {
  ipcMain.handle(IPC.RELEASE_LIST, async () => {
    try {
      const sb = getSupabaseClient()
      const { data, error } = await sb
        .from(TABLE)
        .select('id, version, description, status, created_at, launched_at')
        .order('created_at', { ascending: false })

      if (error) {
        return { ok: false as const, message: error.message, rows: [] as AppReleaseRow[] }
      }
      const rows = (data ?? []).map((x) => mapRow(x as Record<string, unknown>))
      return { ok: true as const, rows }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.warn('[release-rollout] list', e)
      return { ok: false as const, message: msg, rows: [] as AppReleaseRow[] }
    }
  })

  ipcMain.handle(IPC.RELEASE_CREATE_DRAFT, async (_e, payload: { version: string; description: string }) => {
    try {
      const clean = normalizeReleaseSemver(payload.version)
      if (!clean) {
        return { ok: false as const, message: 'Ongeldig versienummer. Gebruik semver (bijv. 1.2.0).' }
      }
      const sb = getSupabaseClient()
      const { error } = await sb.from(TABLE).insert({
        version: clean,
        description: (payload.description ?? '').trim(),
        status: 'draft',
      })
      if (error) {
        if (error.code === '23505') {
          return { ok: false as const, message: 'Deze versie bestaat al in de lijst.' }
        }
        return { ok: false as const, message: error.message }
      }
      return { ok: true as const }
    } catch (e: unknown) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC.RELEASE_DELETE_DRAFT, async (_e, id: string) => {
    try {
      const sb = getSupabaseClient()
      const { data: row, error: fetchErr } = await sb.from(TABLE).select('status').eq('id', id).maybeSingle()
      if (fetchErr) return { ok: false as const, message: fetchErr.message }
      if (!row || row.status !== 'draft') {
        return { ok: false as const, message: 'Alleen conceptversies kunnen worden verwijderd.' }
      }
      const { error } = await sb.from(TABLE).delete().eq('id', id)
      if (error) return { ok: false as const, message: error.message }
      return { ok: true as const }
    } catch (e: unknown) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC.RELEASE_PROMOTE_LIVE, async (_e, id: string) => {
    try {
      const sb = getSupabaseClient()
      const { data: target, error: tErr } = await sb
        .from(TABLE)
        .select('id, version, status')
        .eq('id', id)
        .maybeSingle()

      if (tErr) return { ok: false as const, message: tErr.message }
      if (!target?.version) return { ok: false as const, message: 'Versieregel niet gevonden.' }

      const clean = normalizeReleaseSemver(String(target.version))
      if (!clean) return { ok: false as const, message: 'Ongeldig versienummer in database.' }

      const gh = await verifyGithubReleaseExists(clean)
      if (!gh.ok) return { ok: false as const, message: gh.message }

      const { error: archErr } = await sb.from(TABLE).update({ status: 'archived' }).eq('status', 'live')
      if (archErr) return { ok: false as const, message: archErr.message }

      const launchedAt = new Date().toISOString()
      const { error: upErr } = await sb
        .from(TABLE)
        .update({
          status: 'live',
          launched_at: launchedAt,
        })
        .eq('id', id)

      if (upErr) return { ok: false as const, message: upErr.message }

      const repo = readGithubRepoFromPackage()
      log.info(`[release-rollout] Versie ${clean} is nu live voor gebruikers (GitHub: ${repo.owner}/${repo.repo}).`)

      if (app.isPackaged) {
        void applyRolloutFeedUrlSerialized()
          .then(() => autoUpdater.checkForUpdates())
          .then((r) => {
            if (r?.isUpdateAvailable && r.updateInfo) {
              for (const w of BrowserWindow.getAllWindows()) {
                if (!w.isDestroyed()) w.webContents.send(IPC.APP_UPDATE_AVAILABLE, r.updateInfo)
              }
            }
          })
          .catch((e) => log.warn('[release-rollout] check na launch', e))
      }

      return { ok: true as const }
    } catch (e: unknown) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  })
}
