const pad = (n: number): string => String(n).padStart(2, '0')

/** Unix seconds -> local "YYYY-MM-DDTHH:mm" (datetime-local value). */
export function toLocalInput(ts: number): string {
  const d = new Date(ts * 1000)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local datetime-local value -> unix seconds, or null if empty/invalid. */
export function fromLocalInput(value: string): number | null {
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}
