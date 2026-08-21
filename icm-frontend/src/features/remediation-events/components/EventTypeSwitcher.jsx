import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { REMEDIATION_EVENT_CATALOG } from "../constants";
import { REMEDIATION_EVENTS_BASE } from "../paths";

export default function EventTypeSwitcher({ activeSlug }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = REMEDIATION_EVENT_CATALOG.find((c) => c.slug === activeSlug);

  return (
    <div className="re-type-switcher" ref={ref}>
      <button
        type="button"
        className="re-btn re-btn--secondary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {active?.title || "Event types"}
        <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, ml: 0.5 }} />
      </button>
      {open && (
        <div className="re-type-switcher__menu" role="listbox">
          <Link
            to={REMEDIATION_EVENTS_BASE}
            className="re-type-switcher__item"
            onClick={() => setOpen(false)}
          >
            All event types
          </Link>
          {REMEDIATION_EVENT_CATALOG.map((t) => (
            <Link
              key={t.slug}
              to={`${REMEDIATION_EVENTS_BASE}/${t.slug}`}
              className={`re-type-switcher__item ${t.slug === activeSlug ? "is-active" : ""}`}
              onClick={() => setOpen(false)}
            >
              {t.title}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
