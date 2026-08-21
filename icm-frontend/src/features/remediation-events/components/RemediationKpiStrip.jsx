export default function RemediationKpiStrip({ items = [] }) {
  return (
    <div className="re-kpi-strip" role="group" aria-label="Summary metrics">
      {items.map((item) => (
        <div
          key={item.label}
          className={`re-kpi-card ${item.tone ? `re-kpi-card--${item.tone}` : ""}`}
        >
          <span className="re-kpi-card__label">{item.label}</span>
          <span className="re-kpi-card__value">{item.value ?? 0}</span>
          {item.hint && <span className="re-kpi-card__hint">{item.hint}</span>}
        </div>
      ))}
    </div>
  );
}
