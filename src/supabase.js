import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = 'https://kfjykimfkeyvuphkiouv.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmanlraW1ma2V5dnVwaGtpb3V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MjMwNjgsImV4cCI6MjA5OTA5OTA2OH0.aV8PQIZUFXfrCFvHvhnaVGJ2Xlzbdi0fF0uYuZ4u7ZA'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// ── Task helpers ──────────────────────────────────────────────────────────────
const toRow = (t) => ({
  id:           t.id,
  type:         t.type        || 'Project',
  status:       t.status      || 'Inbox',
  title:        t.title       || '',
  dept:         t.dept        || '',
  assignee:     t.assignee    || '',
  est_hours:    t.estHours    || '',
  weekly_hours: t.weeklyHours || '',
  week_of:      t.weekOf      || null,
  hours_logged: t.hoursLogged || '0',
  priority:     +t.priority   || 5,
  due_date:     t.dueDate     || null,
  machine:      t.machine     || '',
  notes:        t.notes       || '',
  source:       t.source      || '',
  added_by:     t.addedBy     || '',
  completed_by: t.completedBy || '',
  completed_at: t.completedAt || null,
  scheduled_by: t.scheduledBy || '',
  pm_id:        t.pmId        || '',
  created_at:   t.createdAt   || new Date().toISOString(),
  progress_status:          t.progressStatus         || 'On Track',
  original_scheduled_date:  t.originalScheduledDate   || null,
  reschedule_count:         +t.rescheduleCount        || 0,
})

// Columns that may not exist yet on older databases — dropped from the
// upsert payload and retried once if Postgres/PostgREST reports them missing.
const OPTIONAL_COLUMNS = ['progress_status', 'original_scheduled_date', 'reschedule_count']
const isMissingColumnError = (error) =>
  !!error && (error.code === '42703' || error.code === 'PGRST204' ||
    /column .* does not exist|could not find.*column/i.test(error.message || ''))
const withoutOptionalColumns = (row) => {
  const copy = { ...row }
  OPTIONAL_COLUMNS.forEach(c => delete copy[c])
  return copy
}

const fromRow = (r) => ({
  id:           r.id,
  type:         r.type,
  status:       r.status,
  title:        r.title,
  dept:         r.dept,
  assignee:     r.assignee,
  estHours:     r.est_hours,
  weeklyHours:  r.weekly_hours,
  weekOf:       r.week_of    ? r.week_of.slice(0,10) : '',
  hoursLogged:  r.hours_logged,
  priority:     r.priority,
  dueDate:      r.due_date   ? r.due_date.slice(0,10) : '',
  machine:      r.machine,
  notes:        r.notes,
  source:       r.source,
  addedBy:      r.added_by,
  completedBy:  r.completed_by,
  completedAt:  r.completed_at,
  scheduledBy:  r.scheduled_by,
  pmId:         r.pm_id,
  createdAt:    r.created_at,
  updatedAt:    r.updated_at,
  progressStatus:         r.progress_status || 'On Track',
  originalScheduledDate:  r.original_scheduled_date ? r.original_scheduled_date.slice(0,10) : '',
  rescheduleCount:        r.reschedule_count || 0,
})

const pmToRow = (p) => ({
  id:            p.id,
  machine:       p.machine,
  dept:          p.dept         || 'Millwright',
  type:          p.type         || 'Mechanical',
  frequency:     p.frequency    || 'Weekly',
  last_done:     p.lastDone     || null,
  default_hours: p.defaultHours || '5',
  form_url:      p.formUrl      || '',
})

const pmFromRow = (r) => ({
  id:           r.id,
  machine:      r.machine,
  dept:         r.dept,
  type:         r.type,
  frequency:    r.frequency,
  lastDone:     r.last_done ? r.last_done.slice(0,10) : '',
  defaultHours: r.default_hours,
  formUrl:      r.form_url,
})

// ── Tasks API ─────────────────────────────────────────────────────────────────
export const db = {
  // Get all tasks
  async getTasks() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data || []).map(fromRow)
  },

  // Upsert a single task
  async saveTask(task) {
    const row = toRow(task)
    const { error } = await supabase.from('tasks').upsert(row, { onConflict: 'id' })
    if (error) {
      if (!isMissingColumnError(error)) throw error
      console.warn('tasks table is missing new columns — run the migration in supabase/migrations. Saving without them for now.')
      const { error: retryError } = await supabase
        .from('tasks')
        .upsert(withoutOptionalColumns(row), { onConflict: 'id' })
      if (retryError) throw retryError
    }
  },

  // Upsert multiple tasks
  async saveTasks(tasks) {
    if (!tasks.length) return
    const rows = tasks.map(toRow)
    // Batch in chunks of 500
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i+500)
      const { error } = await supabase.from('tasks').upsert(batch, { onConflict: 'id' })
      if (error) {
        if (!isMissingColumnError(error)) throw error
        console.warn('tasks table is missing new columns — run the migration in supabase/migrations. Saving without them for now.')
        const { error: retryError } = await supabase
          .from('tasks')
          .upsert(batch.map(withoutOptionalColumns), { onConflict: 'id' })
        if (retryError) throw retryError
      }
    }
  },

  // Delete a task
  async deleteTask(id) {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) throw error
  },

  // Get PM Register
  async getPMItems() {
    const { data, error } = await supabase
      .from('pm_register')
      .select('*')
      .order('machine')
    if (error) throw error
    return (data || []).map(pmFromRow)
  },

  // Save PM Register (full replace)
  async savePMItems(items) {
    // Delete all and re-insert
    await supabase.from('pm_register').delete().neq('id', 'x')
    const { error } = await supabase.from('pm_register').insert(items.map(pmToRow))
    if (error) throw error
  },

  // Update single PM item
  async updatePMItem(item) {
    const { error } = await supabase
      .from('pm_register')
      .upsert(pmToRow(item), { onConflict: 'id' })
    if (error) throw error
  },

  // Get parts for a PM
  async getParts() {
    const { data, error } = await supabase.from('parts').select('*')
    if (error) throw error
    // Return as { pmId: [parts] } map
    const map = {}
    ;(data || []).forEach(p => {
      if (!map[p.pm_id]) map[p.pm_id] = []
      map[p.pm_id].push({ id:p.id, name:p.name, partNo:p.part_no, description:p.description, vendor:p.vendor })
    })
    return map
  },

  // Save parts for a PM machine
  async saveParts(pmId, parts) {
    await supabase.from('parts').delete().eq('pm_id', pmId)
    if (parts.length > 0) {
      const { error } = await supabase.from('parts').insert(
        parts.map(p => ({ id:p.id, pm_id:pmId, name:p.name, part_no:p.partNo||'', description:p.description||'', vendor:p.vendor||'' }))
      )
      if (error) throw error
    }
  },

  // Get machine documents (Google Drive metadata) as { pmId: [docs] }
  async getDocs() {
    const { data, error } = await supabase
      .from('pm_documents')
      .select('*')
      .order('uploaded_at', { ascending: false })
    if (error) throw error
    const map = {}
    ;(data || []).forEach(d => {
      if (!map[d.pm_id]) map[d.pm_id] = []
      map[d.pm_id].push({ id:d.id, pmId:d.pm_id, name:d.name, mimeType:d.mime_type, size:+d.size_bytes||0,
        driveFileId:d.drive_file_id, url:d.url, uploadedBy:d.uploaded_by, uploadedAt:d.uploaded_at })
    })
    return map
  },

  async addDoc(d) {
    const { error } = await supabase.from('pm_documents').insert({
      id:d.id, pm_id:d.pmId, name:d.name, mime_type:d.mimeType||'', size_bytes:d.size||0,
      drive_file_id:d.driveFileId, url:d.url||'', uploaded_by:d.uploadedBy||'', uploaded_at:d.uploadedAt,
    })
    if (error) throw error
  },

  async deleteDoc(id) {
    const { error } = await supabase.from('pm_documents').delete().eq('id', id)
    if (error) throw error
  },

  // Get settings
  async getSettings() {
    const { data } = await supabase.from('settings').select('data').eq('id', 1).single()
    return data?.data || null
  },

  // Save settings
  async saveSettings(settings) {
    const { error } = await supabase
      .from('settings')
      .upsert({ id: 1, data: settings }, { onConflict: 'id' })
    if (error) throw error
  },

  // Subscribe to task changes (real-time)
  subscribeToTasks(callback) {
    return supabase
      .channel('tasks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, callback)
      .subscribe()
  },

  // Subscribe to PM changes
  subscribeToPM(callback) {
    return supabase
      .channel('pm-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pm_register' }, callback)
      .subscribe()
  },

  unsubscribe(channel) {
    supabase.removeChannel(channel)
  }
}
// v2
