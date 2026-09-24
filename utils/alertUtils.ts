// utils/alertUtils.ts
import { differenceInDays, addMonths, parseISO } from 'date-fns';
import { ROSystem, FILTER_SPECS } from '../constants/data';

export const SERVICE_INTERVAL_MONTHS = 6;

export function getFilterStatus(lastChangedDate: string, lifeMonths: number) {
  if (!lastChangedDate) {
    return { status: 'alert', daysLeft: 0, percentUsed: 100, label: 'Date not set' };
  }
  const changed = parseISO(lastChangedDate);
  const due = addMonths(changed, lifeMonths);
  const today = new Date();
  const totalDays = lifeMonths * 30;
  const daysUsed = differenceInDays(today, changed);
  const daysLeft = differenceInDays(due, today);
  const percentUsed = Math.min(100, Math.round((daysUsed / totalDays) * 100));

  let status = 'ok';
  if (daysLeft <= 0) status = 'alert';
  else if (daysLeft <= 14) status = 'alert';
  else if (daysLeft <= 30) status = 'warn';

  return {
    status,
    daysLeft,
    percentUsed,
    dueDate: due,
    label: status === 'alert' ? 'OVERDUE' : `${daysLeft}d left`,
  };
}

export function getServiceStatus(lastServiceDate: string) {
  if (!lastServiceDate) {
    return { status: 'alert', daysLeft: 0, label: 'Never Serviced' };
  }
  const serviced = parseISO(lastServiceDate);
  const due = addMonths(serviced, SERVICE_INTERVAL_MONTHS);
  const today = new Date();
  const daysLeft = differenceInDays(due, today);

  let status = 'ok';
  if (daysLeft <= 0) status = 'alert';
  else if (daysLeft <= 14) status = 'alert';
  else if (daysLeft <= 30) status = 'warn';

  return { status, daysLeft, dueDate: due, label: daysLeft <= 0 ? 'OVERDUE' : `${daysLeft}d left` };
}

export interface Alert {
  id: string;
  systemId: string;
  systemName: string;
  type: 'service' | 'filter';
  filterId?: string;
  severity: 'alert' | 'warn';
  title: string;
  detail: string;
  emoji: string;
}

export function generateAlerts(system: ROSystem): Alert[] {
  const alerts: Alert[] = [];

  const svc = getServiceStatus(system.lastServiceDate);
  if (svc.status !== 'ok') {
    alerts.push({
      id: `svc_${system.id}`,
      systemId: system.id,
      systemName: system.name,
      type: 'service',
      severity: svc.status as 'alert' | 'warn',
      title: `Service Due — ${system.name}`,
      detail:
        svc.daysLeft <= 0
          ? `Annual service is OVERDUE by ${Math.abs(svc.daysLeft)} days`
          : `Service due in ${svc.daysLeft} days`,
      emoji: '🔧',
    });
  }

  (system.filters || []).forEach((filter) => {
    const spec = FILTER_SPECS.find((s) => s.id === filter.filterId);
    if (!spec) return;
    const fs = getFilterStatus(filter.lastChanged, spec.lifeMonths);
    if (fs.status !== 'ok') {
      alerts.push({
        id: `filter_${system.id}_${filter.filterId}`,
        systemId: system.id,
        systemName: system.name,
        type: 'filter',
        filterId: filter.filterId,
        severity: fs.status as 'alert' | 'warn',
        title: `${spec.name} — ${system.name}`,
        detail:
          fs.daysLeft <= 0
            ? `Filter change OVERDUE by ${Math.abs(fs.daysLeft)} days`
            : `Filter change due in ${fs.daysLeft} days`,
        emoji: spec.emoji,
      });
    }
  });

  return alerts.sort((a, b) => {
    const order: Record<string, number> = { alert: 0, warn: 1 };
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
  });
}

export function buildWhatsAppMessage(system: ROSystem, alerts: Alert[]) {
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  let msg = `🚰 *AquaGuard Alert — ${system.name}*\n`;
  msg += `📅 Date: ${today}\n`;
  msg += `📍 Location: ${system.location || 'N/A'}\n\n`;

  if (alerts.length === 0) {
    msg += `✅ All filters and service are in good condition!\n`;
  } else {
    msg += `⚠️ *Action Required:*\n\n`;
    alerts.forEach((a) => {
      const icon = a.severity === 'alert' ? '🔴' : '🟡';
      msg += `${icon} *${a.title}*\n`;
      msg += `   ${a.detail}\n\n`;
    });
  }

  msg += `───────────────\n`;
  msg += `📞 Contact: ${system.technicianPhone || 'Not set'}\n`;
  msg += `🏠 Owner: ${system.ownerName || 'N/A'}\n`;
  msg += `\n_Sent via AquaGuard RO Manager_`;
  return msg;
}
