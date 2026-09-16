(function (CET) {
  const TZ = CET.CONFIG.timezone;

  const BLANK_VALUES = new Set(['', '—', '-', '(none)', 'none', 'null', 'undefined']);

  function isBlank(value) {
    if (value === null || value === undefined) return true;
    const s = String(value).trim();
    return BLANK_VALUES.has(s) || BLANK_VALUES.has(s.toLowerCase());
  }

  function plainText(value) {
    if (isBlank(value)) return '';
    let s = String(value).trim();
    if (!s.includes('<') && !s.includes('&lt;')) return s;
    if (s.includes('&lt;')) {
      const tmp = document.createElement('textarea');
      tmp.innerHTML = s;
      s = tmp.value;
    }
    const div = document.createElement('div');
    div.innerHTML = s;
    const text = (div.textContent || div.innerText || '').replace(/\u00a0/g, ' ');
    return text.replace(/\s+/g, ' ').trim();
  }

  function displayOr(value, fallback) {
    if (isBlank(value)) return fallback;
    return plainText(value);
  }

  function parseDateOnly(value) {
    if (isBlank(value)) return null;
    if (value instanceof Date) return value;
    let s = plainText(value);
    if (!s) return null;
    const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmy) {
      const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function toDateKey(value) {
    const d = parseDateOnly(value);
    if (!d) return '';
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDateRiyadh(value, options) {
    const d = parseDateOnly(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(options || {}),
    }).format(d);
  }

  function formatDateTimeRiyadh(value) {
    const d = parseDateOnly(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  }

  /** Monday 00:00 Riyadh → next Monday 00:00 Riyadh for a reference instant */
  function getRiyadhWeekBounds(referenceDate, weekOffset) {
    const ref = referenceDate ? new Date(referenceDate) : new Date();
    const offset = weekOffset || 0;

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(ref);

    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });

    const localMidnight = new Date(
      Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), 0, 0, 0)
    );
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(ref);
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = dowMap[weekday] ?? 0;
    const daysFromMonday = (dow + 6) % 7;

    const weekStart = new Date(localMidnight);
    weekStart.setUTCDate(weekStart.getUTCDate() - daysFromMonday + offset * 7);

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    return { start: weekStart, end: weekEnd };
  }

  function formatWeekLabel(bounds) {
    return `${formatDateRiyadh(bounds.start)} – ${formatDateRiyadh(new Date(bounds.end.getTime() - 86400000))}`;
  }

  function daysBetween(fromDate, toDate) {
    const a = parseDateOnly(fromDate);
    const b = parseDateOnly(toDate);
    if (!a || !b) return null;
    const ms = b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0);
    return Math.round(ms / 86400000);
  }

  function startOfTodayRiyadh() {
    const bounds = getRiyadhWeekBounds(new Date(), 0);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    return new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)));
  }

  function getCurrentWeekBounds() {
    return getRiyadhWeekBounds(new Date(), 0);
  }

  function normalizeNumber(value, decimals) {
    if (isBlank(value)) return '';
    const n = Number(value);
    if (Number.isNaN(n)) return String(value).trim();
    return n.toFixed(decimals ?? 2);
  }

  function personLogin(userField) {
    if (!userField) return '';
    if (Array.isArray(userField)) {
      return userField
        .map(personLogin)
        .filter(Boolean)
        .sort()
        .join(';');
    }
    if (typeof userField === 'object') {
      return (
        userField.Email ||
        userField.EMail ||
        userField.LoginName ||
        userField.Title ||
        ''
      ).trim();
    }
    return String(userField).trim();
  }

  function personDisplay(userField) {
    if (!userField) return '';
    if (Array.isArray(userField)) {
      const names = userField.map(personDisplay).filter(Boolean);
      return names.length ? names.join('; ') : '';
    }
    if (typeof userField === 'object') return userField.Title || personLogin(userField);
    return String(userField).trim();
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Plain text safe for HTML attributes and text nodes */
  function safeText(value) {
    return escapeHtml(plainText(value));
  }

  function ragPalette(ragValue) {
    const key = ragValue && CET.CONFIG.ragColors[ragValue] ? ragValue : 'Grey';
    return CET.CONFIG.ragColors[key];
  }

  function ragHex(ragValue) {
    return ragPalette(ragValue).hex;
  }

  function ragBadgeClass(ragValue) {
    const p = ragPalette(ragValue);
    return `${p.bg} ${p.text} ${p.ring}`;
  }

  function effortBarRagColor(row) {
    const p = row.project;
    const preDD = new Set([
      'Pre-Concept',
      'Concept',
      'Schematic Design',
      'Gap Assessment',
      'Other',
    ]).has(p.stage);
    if (row.pct >= 100) return ragHex('Red');
    if (preDD && row.pct >= 80) return ragHex('Amber');
    return ragHex(p.rag || 'Grey');
  }

  CET.utils = {
    isBlank,
    displayOr,
    parseDateOnly,
    toDateKey,
    formatDateRiyadh,
    formatDateTimeRiyadh,
    getRiyadhWeekBounds,
    getCurrentWeekBounds,
    formatWeekLabel,
    daysBetween,
    startOfTodayRiyadh,
    normalizeNumber,
    personLogin,
    personDisplay,
    plainText,
    safeText,
    escapeHtml,
    ragPalette,
    ragHex,
    ragBadgeClass,
    effortBarRagColor,
  };
})(window.CyberEffortsTracker);
