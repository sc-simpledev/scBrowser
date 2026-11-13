import { describe, expect, it } from 'vitest'
import { isWorkspaceSchedule, workspaceScheduledNow, workspaceScheduleLabel } from '@scbrowser/shared'

// 13 November 2026 is a Friday.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)

describe('workspace hours', () => {
  const work = { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }
  it('covers its hours on its days only', () => {
    expect(workspaceScheduledNow(work, at(13, 9))).toBe(true)
    expect(workspaceScheduledNow(work, at(13, 16, 59))).toBe(true)
    expect(workspaceScheduledNow(work, at(13, 17))).toBe(false)
    expect(workspaceScheduledNow(work, at(14, 10))).toBe(false)
  })

  it('runs past midnight as part of the day it started', () => {
    const night = { days: [5], from: '22:00', to: '02:00' }
    expect(workspaceScheduledNow(night, at(13, 23))).toBe(true)
    expect(workspaceScheduledNow(night, at(14, 1))).toBe(true)
    expect(workspaceScheduledNow(night, at(14, 3))).toBe(false)
    expect(workspaceScheduledNow(night, at(12, 23))).toBe(false)
  })

  it('checks and labels schedules', () => {
    expect(isWorkspaceSchedule(work)).toBe(true)
    expect(isWorkspaceSchedule({ ...work, from: '9:00' })).toBe(false)
    expect(isWorkspaceSchedule({ ...work, to: '09:00' })).toBe(false)
    expect(workspaceScheduleLabel(work)).toBe('Mon–Fri, 09:00–17:00')
    expect(workspaceScheduleLabel({ ...work, days: [6, 0] })).toBe('Weekends, 09:00–17:00')
  })
})
