import { canWorkSlot, type DayAssignments, type GenerationContext } from './context'
import { jobForGroup } from './jobs'
import { checkShift } from './constraints'
import { dayCoverage } from './coverage'
import { actualHoursForShifts, fToT } from './time'

/** A relay that extended someone's shift to cover part of another slot. */
export type RelayAdjustment = {
  type: 'relay'
  date: string
  slotKey: string
  staffId: string
  start: number
  end: number
}

/**
 * Second pass: for each slot that is empty or only partly covered, extend the
 * shift of a same-role colleague whose shift ends exactly where the gap starts
 * (or starts where it ends), if they are available for the longer shift.
 * Ties are broken by name, then id.
 */
export const fillGapsWithRelays = (context: GenerationContext, assignmentsByDate: Map<string, DayAssignments>): RelayAdjustment[] => {
  const { staffList, scheduleStaff, staffIndexById } = context
  const adjustments: RelayAdjustment[] = []

  for (const [dateStr, dayData] of assignmentsByDate) {
    for (const targetSlot of dayData.slots) {
      const role = jobForGroup(targetSlot.group)
      if (!role) continue
      const slotKey = `${targetSlot.group}_${targetSlot.slotIndex}`
      const assignedShift = dayData.shifts.find(shift => shift.slotKey === slotKey)
      const gaps = assignedShift
        ? [
            { start: targetSlot.start, end: Math.min(assignedShift.start, targetSlot.end) },
            { start: Math.max(assignedShift.end, targetSlot.start), end: targetSlot.end },
          ].filter(gap => gap.end - gap.start > 0.001)
        : [{ start: targetSlot.start, end: targetSlot.end }]

      for (const gap of gaps) {
        const relayCandidates = dayData.shifts
          .filter(shift => shift.job === role && shift.staffId !== assignedShift?.staffId)
          .map(shift => {
            const staffIndex = staffIndexById.get(shift.staffId)
            const staff = staffIndex === undefined ? undefined : staffList[staffIndex]
            const row = staffIndex === undefined ? undefined : scheduleStaff[staffIndex]
            const ownSlot = dayData.slots.find(slot => slot.staffId === shift.staffId)
            const extendsAfter = Math.abs(shift.end - gap.start) <= 0.001
            const extendsBefore = Math.abs(shift.start - gap.end) <= 0.001
            const conflictsWithAnotherSlot = dayData.slots.some(slot =>
              slot !== targetSlot
              && (slot.staffId === shift.staffId || slot.relayStaffIds.includes(shift.staffId))
              && slot.start < gap.end
              && slot.end > gap.start
            )
            if (
              !staff
              || !row
              || !ownSlot
              || (!extendsAfter && !extendsBefore)
              || conflictsWithAnotherSlot
            ) return null

            const start = extendsBefore ? gap.start : shift.start
            const end = extendsAfter ? gap.end : shift.end
            if (!canWorkSlot(context, staff, dateStr, { group: ownSlot.group, start, end })) return null
            const staffIndexOfRelay = staffIndexById.get(shift.staffId)
            if (staffIndexOfRelay === undefined || checkShift(context, staffIndexOfRelay, dateStr, start, end)) return null
            if (context.rules.noviceRule === 'hard') {
              const extended = dayData.shifts.map(item => item === shift ? { staffId: item.staffId, start, end } : item)
              if (dayCoverage(context, extended).noviceOnlyHours > dayCoverage(context, dayData.shifts).noviceOnlyHours + 1e-9) return null
            }
            return { staff, row, shift, start, end }
          })
          .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
          .sort((left, right) => left.staff.name.localeCompare(right.staff.name, 'ja') || left.staff.id.localeCompare(right.staff.id))

        const relay = relayCandidates[0]
        if (!relay) continue
        relay.shift.start = relay.start
        relay.shift.end = relay.end
        relay.row.shifts[dateStr] = `${fToT(relay.start)}-${fToT(relay.end)}`
        relay.row.assignedHours = actualHoursForShifts(relay.row.shifts)
        if (!targetSlot.relayStaffIds.includes(relay.staff.id)) targetSlot.relayStaffIds.push(relay.staff.id)
        adjustments.push({ type: 'relay', date: dateStr, slotKey, staffId: relay.staff.id, start: relay.start, end: relay.end })
      }
    }
  }
  return adjustments
}
