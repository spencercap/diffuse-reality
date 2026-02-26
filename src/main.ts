import './style.css'

const SHEET_ID = '2PACX-1vTWjeQgKt07lu9g7dpezFgMx4tSQBN8h4PkAoVjMvhDkvGNvtk7784qZNyZyyZJLrK_vioeOXOxWYTJ';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=135646171&single=true&output=csv`

/** true = newest first, false = oldest first */
const NEWEST_FIRST = false

let lastProcessedRowCount = 0
const loadedComments = new Map<string, SheetRow>()

function commentKey(serverTimestamp: string, clientTimestamp: string): string {
  return serverTimestamp
    ? `${serverTimestamp}_${clientTimestamp}`
    : `_${clientTimestamp || 'unknown'}`
}

function sortKeyForCompare(row: SheetRow): number {
  const s = row.serverTimestamp || row.clientTimestamp || ''
  const t = new Date(s).getTime()
  return isNaN(t) ? 0 : t
}

function toSafeId(key: string): string {
  return 'comment-' + key.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function fetchCSV(url: string): Promise<string> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch {
    const proxyUrl = 'https://corsproxy.io/?url=' + encodeURIComponent(url)
    const res = await fetch(proxyUrl)
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`)
    return await res.text()
  }
}

interface SheetRow {
  name: string
  comment: string
  serverTimestamp: string
  clientTimestamp: string
  blocked?: string
}

function renderComment(item: SheetRow, key: string) {
  if (item.blocked) return null
  const div = document.createElement('div')
  div.className = 'comment_item'
  div.id = toSafeId(key)
  div.dataset.commentKey = key
  div.innerHTML = `
    <div class="comment_author">
      <span>Name:</span>
      <span class="comment_author_name">${escapeHtml(item.name)}</span>
    </div>
    <div class="comment_content">
      <span>Comment:</span>
      <span class="comment_content_text">${escapeHtml(item.comment)}</span>
    </div>
  `
  return div
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      row.push(cell.replace(/""/g, '"'))
      cell = ''
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell.replace(/""/g, '"'))
      cell = ''
      rows.push(row)
      row = []
    } else {
      cell += c
    }
  }
  row.push(cell.replace(/""/g, '"'))
  if (row.some((c) => c)) rows.push(row)
  return rows
}

async function loadComments(appendOnly = false) {
  const list = document.getElementById('comments-list')
  if (!list) return

  try {
    const text = await fetchCSV(SHEET_CSV_URL)
    if (text.trim().startsWith('<')) {
      throw new Error('Received HTML instead of CSV. Publish the sheet: File → Share → Publish to web')
    }
    const parsed = parseCSV(text)
    const [header, ...dataRows] = parsed
    const tsIdx = header?.findIndex((h) => /^timestamp$/i.test(h.replace(/\s+/g, ''))) ?? 0
    const clientTsIdx = header?.findIndex((h) => /client_timestamp/i.test(h)) ?? 1
    const nameIdx = header?.findIndex((h) => /^name$/i.test(h.replace(/\s+/g, ''))) ?? 2
    const commentIdx = header?.findIndex((h) => /^comment$/i.test(h.replace(/\s+/g, ''))) ?? 3
    const blockedIdx = header?.findIndex((h) => /blocked/i.test(h)) ?? 4
    const rows: SheetRow[] = dataRows.map((row) => ({
      name: row[nameIdx] ?? '',
      comment: row[commentIdx] ?? '',
      serverTimestamp: row[tsIdx] ?? '',
      clientTimestamp: row[clientTsIdx] ?? '',
      blocked: row[blockedIdx] ?? '',
    }))

    const rowsToRender = appendOnly ? rows.slice(lastProcessedRowCount) : rows
    lastProcessedRowCount = rows.length

    if (!appendOnly) {
      list.innerHTML = ''
      loadedComments.clear()
    }

    for (const row of rowsToRender) {
      if (!row.name && !row.comment) continue
      const key = commentKey(row.serverTimestamp, row.clientTimestamp)
      if (loadedComments.has(key)) continue
      // Replace optimistic placeholder when server row arrives
      if (row.clientTimestamp) {
        const pendingKey = `_${row.clientTimestamp}`
        if (loadedComments.has(pendingKey)) {
          loadedComments.delete(pendingKey)
          const pendingEl = list.querySelector(`[data-client-ts="${CSS.escape(row.clientTimestamp)}"]`)
          pendingEl?.remove()
        }
      }
      loadedComments.set(key, row)
    }

    const sorted = [...loadedComments.entries()].sort(([_, a], [__, b]) => {
      const ta = sortKeyForCompare(a)
      const tb = sortKeyForCompare(b)
      return NEWEST_FIRST ? tb - ta : ta - tb
    })
    list.innerHTML = ''
    for (const [key, row] of sorted) {
      const el = renderComment(row, key)
      if (el) list.appendChild(el)
    }
  } catch (err) {
    console.error('Failed to load comments:', err)
  }
}

function addOptimisticComment(name: string, comment: string, clientTimestamp: string) {
  const list = document.getElementById('comments-list')
  if (!list || (!name && !comment)) return
  const row: SheetRow = { name, comment, serverTimestamp: '', clientTimestamp }
  const key = commentKey('', clientTimestamp)
  if (loadedComments.has(key)) return
  loadedComments.set(key, row)
  const el = renderComment(row, key)
  if (el) {
    el.dataset.clientTs = clientTimestamp
    insertCommentInOrder(list, el, row)
  }
}

function insertCommentInOrder(list: HTMLElement, newEl: HTMLElement, newRow: SheetRow) {
  const newT = sortKeyForCompare(newRow)
  for (const child of list.children) {
    const key = (child as HTMLElement).dataset.commentKey
    const row = key ? loadedComments.get(key) : undefined
    if (!row) continue
    const goesBefore = NEWEST_FIRST ? newT > sortKeyForCompare(row) : newT < sortKeyForCompare(row)
    if (goesBefore) {
      list.insertBefore(newEl, child)
      return
    }
  }
  list.appendChild(newEl)
}

interface Submission {
  name: string
  comment: string
  clientTimestamp: string
  submittedAt: string
}

const SUBMISSIONS_KEY = 'DR_user-submitted'
const SUCCESS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function logSubmissionToStorage(name: string, comment: string, clientTimestamp: string) {
  const submission: Submission = {
    name,
    comment,
    clientTimestamp,
    submittedAt: new Date().toISOString(),
  }
  try {
    const stored = localStorage.getItem(SUBMISSIONS_KEY)
    const submissions: Submission[] = stored ? JSON.parse(stored) : []
    submissions.push(submission)
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(submissions))
  } catch (e) {
    console.error('Failed to store submission:', e)
  }
}

function getLatestSubmission(): Submission | null {
  try {
    const stored = localStorage.getItem(SUBMISSIONS_KEY)
    if (!stored) return null
    const submissions: Submission[] = JSON.parse(stored)
    return submissions.length ? submissions[submissions.length - 1] : null
  } catch {
    return null
  }
}

function hasRecentSubmission(): boolean {
  const latest = getLatestSubmission()
  if (!latest) return false
  const submittedAt = new Date(latest.submittedAt).getTime()
  return Date.now() - submittedAt < SUCCESS_WINDOW_MS
}

function ensureRecentSubmissionInComments() {
  const latest = getLatestSubmission()
  if (!latest || !hasRecentSubmission()) return
  const alreadyLoaded = [...loadedComments.values()].some(
    (r) => r.clientTimestamp === latest.clientTimestamp
  )
  if (!alreadyLoaded) {
    addOptimisticComment(latest.name, latest.comment, latest.clientTimestamp)
  }
}

function checkSubmissionOnLoad() {
  if (hasRecentSubmission()) {
    enableDownload()
    ensureRecentSubmissionInComments()
  }
}

function onFeedbackComplete(name: string, comment: string, clientTimestamp: string) {
  addOptimisticComment(name, comment, clientTimestamp)
  logSubmissionToStorage(name, comment, clientTimestamp)
  enableDownload()
  setTimeout(() => loadComments(true), 1500)
}

function initFeedbackForm() {
  const form = document.getElementById('feedback-form') as HTMLFormElement
  const iframe = document.getElementById('feedback-form-iframe') as HTMLIFrameElement

  if (!form || !iframe) return

  iframe.addEventListener('load', () => {
    if ((form as HTMLFormElement & { _feedbackSubmitted?: boolean })._feedbackSubmitted) {
      const name = form.querySelector<HTMLInputElement>('[name="entry.980453823"]')?.value ?? ''
      const comment = form.querySelector<HTMLTextAreaElement>('[name="entry.371553560"]')?.value ?? ''
      const clientTimestamp = form.querySelector<HTMLInputElement>('#form-client-timestamp')?.value ?? ''
      onFeedbackComplete(name, comment, clientTimestamp)
      form.reset()
      ;(form as HTMLFormElement & { _feedbackSubmitted?: boolean })._feedbackSubmitted = false
    }
  })

  form.addEventListener('submit', () => {
    const tsInput = form.querySelector<HTMLInputElement>('#form-client-timestamp')
    if (tsInput) tsInput.value = new Date().toISOString()
    ;(form as HTMLFormElement & { _feedbackSubmitted?: boolean })._feedbackSubmitted = true
  })
}


//
let downloadAvailable = false;
const btnDownload = document.querySelector('.btn-download')
if (btnDownload) {
  btnDownload.addEventListener('click', () => {
    console.log('btn-download clicked')

    if (!downloadAvailable) {
      // scroll element into view "feedback_wrapper"
      const feedbackWrapper = document.querySelector('.feedback_wrapper')
      if (feedbackWrapper) {
        feedbackWrapper.scrollIntoView({ behavior: 'smooth' });

        feedbackWrapper.classList.add('shake-it');
        setTimeout(() => {
          feedbackWrapper.classList.remove('shake-it');
        }, 1000);
      }

    } else {
      alert('download album + thank you');
    }
  })
}

function enableDownload() {
  downloadAvailable = true;
  const btnDownload = document.querySelector('.btn-download')
  if (btnDownload) {
    btnDownload.classList.remove('is-disabled')
  }
}

initFeedbackForm()
loadComments().then(() => checkSubmissionOnLoad())
setInterval(() => loadComments(true), 5000)
