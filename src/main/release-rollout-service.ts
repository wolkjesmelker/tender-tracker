import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import semver from 'semver'
import { autoUpdater } from 'electron-updater'
import { getSupabaseClient } from './db/supabase-client'

const TABLE = 'tender_tracker_app_releases'

let feedApplyChain: Promise<void> = Promise.resolve()

export type GithubRepoIds = { owner: string; repo: string }

export function readGithubRepoFromPackage(): GithubRepoIds {
  const candidates = [
    path.join(app.getAppPath(), 'package.json'),
    path.join(process.resourcesPath || '', 'app', 'package.json'),
  ]
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8')) as { repository?: { url?: string } }
      const url = pkg.repository?.url
      const m = url?.match(/github\.com[/:]([^/]+)\/([^/.]+)/i)
      if (m) return { owner: m[1], repo: m[2] }
    } catch {
      /* volgende candidate */
    }
  }
  return { owner: 'wolkjesmelker', repo: 'tender-tracker' }
}

export function normalizeReleaseSemver(raw: string): string | null {
  const t = raw.trim().replace(/^v/i, '')
  if (!semver.valid(t)) return null
  return semver.clean(t) || t
}

export async function fetchLiveRolloutVersion(): Promise<string | null> {
  try {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from(TABLE)
      .select('version')
      .eq('status', 'live')
      .order('launched_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      log.warn('[release-rollout] live versie lezen:', error.message)
      return null
    }
    const v = data?.version
    if (typeof v !== 'string' || !v.trim()) return null
    return normalizeReleaseSemver(v)
  } catch (e: unknown) {
    log.warn('[release-rollout] geen Supabase of tabel ontbreekt — vrij updates naar GitHub-latest:', e)
    return null
  }
}

/** Controleer dat de release-tag bestaat en updater-metadata heeft (macOS). */
export async function verifyGithubReleaseExists(version: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const clean = normalizeReleaseSemver(version)
  if (!clean) return { ok: false, message: 'Ongeldig versienummer (gebruik semver, bijv. 1.2.0).' }

  const tag = `v${clean}`
  const { owner, repo } = readGithubRepoFromPackage()
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'TenderTracker-release-check',
      },
    })

    if (res.status === 404) {
      return {
        ok: false,
        message: `Geen GitHub-release voor ${tag}. Maak eerst een release met electron-builder en tag ${tag}.`,
      }
    }
    if (!res.ok) {
      return { ok: false, message: `GitHub API (${res.status}). Probeer later opnieuw.` }
    }

    const body = (await res.json()) as { assets?: { name: string }[] }
    const names = body.assets?.map((a) => a.name) ?? []
    const hasUpdaterMeta = names.includes('latest-mac.yml') || names.includes('latest.yml')
    if (!hasUpdaterMeta) {
      return {
        ok: false,
        message: `Release ${tag} mist updater-metadata (latest-mac.yml / latest.yml). Publiceer met electron-builder naar GitHub Releases.`,
      }
    }
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Stelt de electron-updater feed in:
 * - Heeft Supabase een «live»-versie → generic URL naar die GitHub-release (gebruikers krijgen alleen die build).
 * - Anders → standaard GitHub-provider (nieuwste release op GitHub).
 */
export async function applyRolloutFeedUrl(): Promise<void> {
  const live = await fetchLiveRolloutVersion()
  const { owner, repo } = readGithubRepoFromPackage()

  if (!live) {
    autoUpdater.setFeedURL({ provider: 'github', owner, repo })
    log.info('[release-rollout] Geen live rollout in Supabase — updates volgen GitHub-latest.')
    return
  }

  const base = `https://github.com/${owner}/${repo}/releases/download/v${live}`
  autoUpdater.setFeedURL({ provider: 'generic', url: base })
  log.info(`[release-rollout] Feed ingesteld op vrijgegeven versie v${live}: ${base}`)
}

export function applyRolloutFeedUrlSerialized(): Promise<void> {
  feedApplyChain = feedApplyChain.then(() => applyRolloutFeedUrl())
  return feedApplyChain
}
