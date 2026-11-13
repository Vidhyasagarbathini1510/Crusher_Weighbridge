import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

/**
 * Drop-in replacement for a native <select> that lets the user type to search.
 * Looks and behaves like the existing `form-select saas-input` dropdowns.
 *
 * options    - array of strings, or objects { value, label }
 * emptyLabel - when provided, adds a first row with value '' (e.g. "ALL PARTIES")
 * placeholder- grey hint text shown when nothing is selected
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Search or select...',
  emptyLabel = null,
  className = '',
  style,
  disabled = false,
  required = false,
  id,
  name,
  noResultsText = 'No matches found',
  allowCustom = false,
  openOnFocus = true
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState(null);

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  // True only when the highlight was last moved by the keyboard, so hover does
  // not trigger auto-scrolling. See the scrollIntoView effect below.
  const keyboardNavRef = useRef(false);

  const allOptions = useMemo(() => {
    const norm = (options || []).map(o =>
      o !== null && typeof o === 'object'
        ? { value: o.value, label: o.label != null ? String(o.label) : String(o.value) }
        : { value: o, label: String(o) }
    );
    return emptyLabel != null ? [{ value: '', label: emptyLabel }, ...norm] : norm;
  }, [options, emptyLabel]);

  const selectedLabel = useMemo(() => {
    const hit = allOptions.find(o => String(o.value) === String(value ?? ''));
    if (hit) return hit.label;
    // value not in list (custom / stale master data) - still show it
    return value != null && value !== '' ? String(value) : '';
  }, [allOptions, value]);

  // The menu only ever lists real options. Typing narrows the list; it never
  // adds a `Use "..."` row for the raw text. Every one of these pickers is
  // backed by master data (party, material, vehicle, source, destination), so
  // a free-typed value would only enter a record or a report filter that
  // matches nothing downstream.
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return allOptions;
    const qLower = q.toLowerCase();
    return allOptions.filter(o => o.label.toLowerCase().includes(qLower));
  }, [allOptions, query]);

  // Only push a new rect when the control has actually moved. Without this the
  // scroll listener allocates a fresh object per scroll event and re-renders the
  // portal ~60x/sec — visible as stutter on pages that also run live camera
  // video and scale readings.
  const updateRect = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect(prev => {
      if (prev &&
          prev.left === r.left && prev.top === r.top &&
          prev.bottom === r.bottom && prev.width === r.width) {
        return prev;
      }
      return { left: r.left, top: r.top, bottom: r.bottom, width: r.width };
    });
  };

  const openMenu = (overrideQuery = null) => {
    if (disabled) return;
    if (overrideQuery !== null) {
      setQuery(overrideQuery);
    } else {
      setQuery(allowCustom ? (value != null ? String(value) : '') : '');
    }
    const idx = allOptions.findIndex(o => String(o.value) === String(value ?? ''));
    setHighlight(idx > 0 ? idx : 0);
    updateRect();
    setOpen(true);
  };

  // Closing (blur / Tab / click-away) commits ONLY an exact match unless allowCustom is true.
  const closeMenu = (commit = false) => {
    if (commit && query.trim() !== '') {
      if (allowCustom) {
        if (onChange) onChange(query);
      } else {
        const qLower = query.trim().toLowerCase();
        const matched = allOptions.find(o => o.label.toLowerCase() === qLower);
        if (matched && onChange) onChange(matched.value);
      }
    }
    setOpen(false);
    setQuery('');
  };

  const select = (opt) => {
    if (!opt) return;
    setOpen(false);
    setQuery('');
    if (onChange) onChange(opt.value);
  };

  // Reposition on scroll/resize and close on outside click
  useEffect(() => {
    if (!open) return;
    updateRect();
    const reposition = () => updateRect();
    const onDown = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      closeMenu(true);
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, query, allOptions, onChange]);

  // Keep the highlighted row visible — but ONLY when the highlight moved via the
  // keyboard. On mouse hover the row is already under the cursor, and calling
  // scrollIntoView there scrolls the page behind the menu, which makes the form
  // lurch as the pointer travels down a long list.
  useEffect(() => {
    if (!open || !keyboardNavRef.current || !menuRef.current) return;
    keyboardNavRef.current = false;
    const el = menuRef.current.querySelector('[data-idx="' + highlight + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { openMenu(); return; }
      keyboardNavRef.current = true;
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openMenu(); return; }
      keyboardNavRef.current = true;
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();
        if (filtered.length > 0 && highlight >= 0 && highlight < filtered.length) {
          select(filtered[highlight]);
        } else {
          closeMenu(allowCustom);
        }
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); closeMenu(false); }
    } else if (e.key === 'Tab') {
      if (open) closeMenu(true);
    }
  };

  const menuStyle = () => {
    if (!rect) return { display: 'none' };
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropUp = spaceBelow < 200 && rect.top > spaceBelow;
    return dropUp
      ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 2 }
      : { left: rect.left, width: rect.width, top: rect.bottom + 2 };
  };

  return (
    <div className="ss-wrap" ref={wrapRef}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        /* The input's text is blanked while the menu is open so the full list
           shows, so `required` would report a false "please fill out this
           field" even when a value is selected. Only enforce it when closed,
           where the text always mirrors the real selection. */
        required={required && !open}
        className={`form-select ss-input ${className}`}
        style={style}
        value={open ? query : selectedLabel}
        placeholder={open ? (selectedLabel || placeholder) : placeholder}
        onFocus={() => { if (!open && openOnFocus) openMenu(); }}
        onMouseDown={() => { if (!open && openOnFocus) openMenu(); }}
        onChange={(e) => {
          const val = e.target.value;
          setHighlight(0);
          if (allowCustom && onChange) {
            onChange(val);
          }
          if (val.trim() !== '') {
            if (!open) openMenu(val);
            else setQuery(val);
            setOpen(true);
          } else if (!openOnFocus) {
            setOpen(false);
            setQuery('');
          } else {
            if (!open) openMenu(val);
            else setQuery(val);
            setOpen(true);
          }
        }}
        onBlur={() => {
          setTimeout(() => {
            if (menuRef.current && menuRef.current.contains(document.activeElement)) return;
            if (wrapRef.current && wrapRef.current.contains(document.activeElement)) return;
            closeMenu(true);
          }, 150);
        }}
        onKeyDown={handleKeyDown}
      />

      {open && rect && (filtered.length > 0 || (!allowCustom && noResultsText)) && createPortal(
        <div className="ss-menu" ref={menuRef} style={menuStyle()}>
          {filtered.length === 0 && !allowCustom && noResultsText && <div className="ss-empty">{noResultsText}</div>}
          {filtered.map((opt, idx) => (
            <div
              key={String(opt.value) + '::' + idx}
              data-idx={idx}
              className={
                'ss-item' +
                (idx === highlight ? ' active' : '') +
                (String(opt.value) === String(value ?? '') ? ' selected' : '')
              }
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(opt)}
              title={opt.label}
            >
              {opt.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
